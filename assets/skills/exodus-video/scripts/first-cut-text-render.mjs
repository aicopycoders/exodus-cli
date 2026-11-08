import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const literal = (lines) => {
  if (!Array.isArray(lines) || lines.some((line) => typeof line !== "string" || /[{}\\\r\n]/.test(line))) {
    throw new Error("Text contains ASS controls or invalid literal lines");
  }
  return lines.join("\\N");
};
/** ASS centiseconds select exactly the SAME delivered frames as the heard
 * interval. Never round a boundary onto an extra frame or lose its last one.
 * Heard seconds themselves stay unchanged in the plan and evidence. */
export function textFrameWindow(start, end) {
  const startFrame = Math.ceil(start * 24 - 1e-6);
  const endFrame = Math.ceil(end * 24 - 1e-6);
  return { startFrame, frames: endFrame - startFrame, startCs: Math.floor(startFrame * 100 / 24), endCs: Math.floor(endFrame * 100 / 24) };
}
const assTime = (cs) => `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
const anchor = (box, W, H) => [Math.round((box[0] + box[2]) * W / 2), Math.round((box[1] + box[3]) * H / 2)];

/** Same literal serializer, styles and geometry for measurement and final burn. */
export function measuredTextAss(directives, { W = 1080, H = 1920, style = "" } = {}) {
  const thick = /thick black outline/i.test(style);
  const events = [];
  const event = (s, e, name, x, y, fs, lines) => {
    if (!(Number.isFinite(s) && Number.isFinite(e) && e > s && fs > 0)) throw new Error("Invalid text interval or font size");
    const window = textFrameWindow(s, e);
    if (window.frames <= 0) throw new Error("Text interval contains no delivered video frame");
    events.push(`Dialogue: 0,${assTime(window.startCs)},${assTime(window.endCs)},${name},,0,0,0,,{\\q2\\pos(${x},${y})\\fs${fs}}${literal(lines)}`);
  };
  for (const c of directives.captions ?? []) event(c.s, c.e, "Cap", Math.round(c.xShare * W), Math.round(c.yShare * H), c.fs, c.lines);
  for (const c of [...(directives.cards ?? []), directives.hook, directives.endCard].filter(Boolean)) {
    const [x, y] = anchor(c.renderBox, W, H);
    event(c.in, c.out, c.kind === "end" ? "End" : "Card", x, y, c.fs, c.lines);
  }
  return [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${W}`, `PlayResY: ${H}`, "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,Helvetica,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,${thick ? 7 : 1.5},${thick ? 4 : 2},5,0,0,0,1`,
    "Style: Card,Helvetica,60,&H00141414,&H00141414,&H00FFFFFF,&H50000000,-1,0,0,0,100,100,0,0,3,18,4,5,0,0,0,1",
    "Style: End,Helvetica,60,&H00FFFFFF,&H00FFFFFF,&H20101010,&H00000000,-1,0,0,0,100,100,2,0,3,40,0,5,0,0,0,1", "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", ...events, "",
  ].join("\n");
}

/** Resolve an observed renderer face, never a fontconfig-only guess. Some
 * providers report -1 instead of a collection index; the exact observed file
 * and a UNIQUE PostScript name across ALL its physical faces still prove it. */
export function fontSelectionEvidence(stderr, { file, index, faces }) {
  if (!faces.length || faces.some((face) => !Number.isSafeInteger(face.index) || face.index < 0 || typeof face.postscriptName !== "string" || !/^[^\s,|]+$/.test(face.postscriptName))) return null;
  const selected = faces.filter((face) => face.index === index);
  if (selected.length !== 1 || faces.filter((face) => face.postscriptName === selected[0].postscriptName).length !== 1) return null;
  const lines = stderr.split("\n").filter((line) => line.includes("fontselect:"));
  if (!lines.length) return null;
  const evidence = [];
  for (const line of lines) {
    const observed = / -> (.*), (-?\d+), ([^,\r\n]+)\s*$/.exec(line);
    if (!observed || observed[1] !== file || observed[3].trim() !== selected[0].postscriptName) return null;
    const reportedIndex = Number(observed[2]);
    if (reportedIndex !== index && reportedIndex !== -1) return null;
    evidence.push({ reportedIndex, physicalIndex: index, postscriptName: selected[0].postscriptName });
  }
  return evidence;
}

/** Real fontconfig + libass raster measurements. No guessed glyph widths or fallback bands. */
export function createTextRenderer({ dir, W = 1080, H = 1920 }) {
  const run = (bin, args, extra = {}) => spawnSync(bin, args, { cwd: dir, maxBuffer: W * H * 3 + (1 << 20), ...extra });
  const version = run("ffmpeg", ["-version"]).stdout?.toString().split("\n")[0] ?? "";
  const filters = run("ffmpeg", ["-hide_banner", "-filters"]).stdout?.toString() ?? "";
  const libass = /^\s*\S+\s+subtitles\s/m.test(filters);
  const fontQuery = ["-f", "%{family}|%{file}|%{style}|%{index}", "Helvetica:weight=bold"];
  const face = run("fc-match", fontQuery);
  let font = null;
  let fontFile = null;
  let fontIndex = null;
  let charset = [];
  let faces = [];
  if (face.status === 0) {
    const resolved = face.stdout.toString().trim();
    const file = resolved.split("|")[1];
    const index = resolved.split("|")[3];
    try {
      const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
      if (!/^\d+$/.test(index ?? "")) throw new Error("The resolved font has no measured face index");
      const chars = run("fc-query", ["-i", index, "-f", "%{charset}", file]);
      const allFaces = run("fc-query", ["-f", "%{index}|%{postscriptname}\n", file]);
      if (allFaces.status === 0) faces = allFaces.stdout.toString().trim().split("\n").map((row) => {
        const [faceIndex, postscriptName = ""] = row.trim().split("|");
        return { index: Number(faceIndex), postscriptName };
      });
      if (chars.status === 0) {
        charset = chars.stdout.toString().trim().split(/\s+/).map((entry) => {
          const [a, b] = entry.split("-").map((x) => Number.parseInt(x, 16));
          return [a, b ?? a];
        }).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
        if (charset.length) font = { requested: "Helvetica", resolved: `${resolved}|sha256:${hash}` };
        if (font) fontFile = file;
        if (font) fontIndex = index;
      }
    } catch { /* Missing font file is missing measurement, not permission to substitute one. */ }
  }
  const cache = new Map();
  const backgrounds = new Map();
  let n = 0;
  const measureText = (request) => {
    const key = JSON.stringify(request);
    if (cache.has(key)) return cache.get(key);
    const measure = () => {
      if (!version || !libass || !font || request.W !== W || request.H !== H) return null;
      const missingGlyphs = [...new Set(Array.from(request.lines.join("")))].filter((char) => {
        if (/\s/u.test(char)) return false;
        const cp = char.codePointAt(0);
        return !charset.some(([a, b]) => cp >= a && cp <= b);
      });
      if (missingGlyphs.length) return null;
      const caption = request.kind === "caption";
      const entry = { kind: request.kind, lines: request.lines, fs: request.fs, renderBox: request.box, in: 0, out: 1 };
      const directives = caption
        ? { captions: [{ ...entry, xShare: request.xShare, yShare: request.yShare, s: 0, e: 1 }] }
        : { cards: [entry] };
      const name = `.text-measure-${process.pid}-${++n}.ass`;
      const file = path.join(dir, name);
      const bounds = { x: W, y: H, right: -1, bottom: -1 };
      const selections = [];
      try {
        // Decode the blank raster through the same filter/conversion as the
        // text. Limited-range YUV white can become RGB 253, not nominal 255.
        // Cache only its proven uniform RGB, never a guessed tolerance.
        if (backgrounds.size < 2) {
          writeFileSync(file, measuredTextAss({}, { W, H }));
          for (const color of ["black", "white"]) {
            const blank = run("ffmpeg", [
              "-hide_banner", "-loglevel", "error", "-filter_threads", "1", "-f", "lavfi", "-i", `color=c=${color}:s=${W}x${H}:r=24:d=1`,
              "-vf", `subtitles=filename=${name}`, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
            ]);
            if (blank.status !== 0 || blank.stdout?.length !== W * H * 3) return null;
            const rgb = [blank.stdout[0], blank.stdout[1], blank.stdout[2]];
            for (let at = 0; at < blank.stdout.length; at++) {
              if (blank.stdout[at] !== rgb[at % 3]) return null;
            }
            backgrounds.set(color, rgb);
          }
        }
        writeFileSync(file, measuredTextAss(directives, { W, H, style: request.style }));
        for (const color of ["black", "white"]) {
          const res = run("ffmpeg", [
            "-hide_banner", "-loglevel", "verbose", "-filter_threads", "1", "-f", "lavfi", "-i", `color=c=${color}:s=${W}x${H}:r=24:d=1`,
            "-vf", `subtitles=filename=${name}`, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
          ]);
          if (res.status !== 0 || res.stdout?.length !== W * H * 3 || /Glyph .* not found|failed to find.*font/iu.test(res.stderr?.toString() ?? "")) return null;
          const observed = fontSelectionEvidence(res.stderr?.toString() ?? "", { file: fontFile, index: Number(fontIndex), faces });
          if (!observed) return null;
          selections.push(...observed);
          const pixels = res.stdout;
          const bg = backgrounds.get(color);
          for (let y = 0, at = 0; y < H; y++) {
            for (let x = 0; x < W; x++, at += 3) {
              if (pixels[at] === bg[0] && pixels[at + 1] === bg[1] && pixels[at + 2] === bg[2]) continue;
              bounds.x = Math.min(bounds.x, x); bounds.y = Math.min(bounds.y, y);
              bounds.right = Math.max(bounds.right, x); bounds.bottom = Math.max(bounds.bottom, y);
            }
          }
        }
      } finally { rmSync(file, { force: true }); }
      if (bounds.right < bounds.x || bounds.bottom < bounds.y) return null;
      return {
        renderer: { ffmpeg: version, libass: "present" },
        font: { ...font, resolved: `${font.resolved}|libass:${JSON.stringify([...new Map(selections.map((entry) => [JSON.stringify(entry), entry])).values()])}` },
        lines: [...request.lines],
        inkRect: { x: bounds.x, y: bounds.y, w: bounds.right - bounds.x + 1, h: bounds.bottom - bounds.y + 1 }, coverage: { missingGlyphs: [] },
      };
    };
    const value = measure();
    cache.set(key, value);
    return value;
  };
  const assertFont = () => {
    if (!font || !fontFile) return false;
    const current = run("fc-match", fontQuery);
    if (current.status !== 0) return false;
    try {
      return `${current.stdout.toString().trim()}|sha256:${createHash("sha256").update(readFileSync(fontFile)).digest("hex")}` === font.resolved;
    } catch { return false; }
  };
  return { measureText, libass, font, version, assertFont };
}
