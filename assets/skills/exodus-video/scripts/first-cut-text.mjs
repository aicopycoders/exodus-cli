// B32–B34: literal text and authored clocks only. This module performs no I/O.
// The consumer supplies its actual libass raster measurement and trusted media
// observation capabilities. Neither an item receipt nor a font-width estimate
// is evidence. Missing capabilities produce holds, never source mutations.
const hasText = (v) => typeof v === "string" && v.trim().length > 0;
const squash = (s) => String(s ?? "").replace(/\s+/gu, " ").trim();
const CONTROL = /[{}\\\u0000-\u001f\u007f]/u;
const validBox = (b) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[0] >= 0 && b[1] >= 0 && b[2] <= 1 && b[3] <= 1 && b[0] < b[2] && b[1] < b[3];
const overlapsTime = (a, b) => (a.in ?? -Infinity) < (b.out ?? Infinity) && (b.in ?? -Infinity) < (a.out ?? Infinity);
const meets = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const inside = (a, b) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];
const hold = (code, id, reason) => ({ code, id, reason, required: true });
const core = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}%°]+/gu, "");
const UNIT = /^(mg|mcg|µg|ug|g|kg|lb|lbs|oz|ml|l|mmoll|iu|units?|%|percent|hours?|minutes?|seconds?|days?|weeks?|months?|years?|people|customers|dollars?|cm|mm|ft|mph|kcal|cal|times)$/u;
const NEGATOR = /^(not|no|never|none|nothing|nobody|nowhere|neither|nor|without|cannot)$/u;
const AUX = /^(do|does|did|is|are|was|were|will|would|can|could|should|must|has|have|had|may|might)$/u;
const FUNC = /^(a|an|the|of|to|in|on|at|for|with|and|or|but|my|your|our|his|her|their|its|from|by|as|into|than|that|if|so)$/u;
const endSentence = (s) => /[.!?…]["'”’)]*$/u.test(s) && !/^(dr|mr|mrs|ms|prof|st|mt)\.$/iu.test(s);
const FONT_SHARE = { card: .036, hook: .026, end: .045, offer: .036, "question-sticker": .036 };
const MAX_LINES = { card: 3, hook: 2, end: 3, offer: 4, "question-sticker": 3 };
export const captionFontPx = (cap, H) => Math.round(H * (/thick black outline/iu.test(cap?.style ?? "") ? .05 : .034));

// Numeric punctuation is serialized without inserted spaces; no character,
// digit, case, apostrophe, negation or name is rewritten or removed.
function literalWords(words) {
  return words.map((w) => squash(w.text)).join(" ").replace(/(?<=\d)\s+([,.])\s+(?=\d)/gu, "$1").replace(/(?<=[\p{L}\p{N}])\s+([-–])\s+(?=[\p{L}\p{N}])/gu, "$1");
}

// No glyph widths or line-height guesses. A result is accepted only if the
// same renderer reports exact lines, resolved face, glyph coverage and ink.
function measured(request, measureText) {
  if (typeof measureText !== "function") return null;
  let m;
  try { m = measureText(request); } catch { return null; }
  const r = m?.inkRect;
  if (!hasText(m?.renderer?.ffmpeg) || ![true, "present"].includes(m?.renderer?.libass) || m?.font?.requested !== "Helvetica" || !hasText(m?.font?.resolved) || !Array.isArray(m?.coverage?.missingGlyphs) || m.coverage.missingGlyphs.length || !Array.isArray(m.lines) || m.lines.length !== request.lines.length || m.lines.some((l, i) => l !== request.lines[i]) || !r || ![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w <= 0 || r.h <= 0) return null;
  return { box: [r.x / request.W, r.y / request.H, (r.x + r.w) / request.W, (r.y + r.h) / request.H], measurement: m };
}

function fitText(text, { kind, fs: initialFs, box, xShare, yShare, style, W, H, maxLines, measureText }) {
  const words = text.split(" ");
  // Try authored geometry only. Balanced word-count wraps are candidates, not
  // measurements; every accepted candidate is actually rasterized in full.
  for (let fs = initialFs; fs >= Math.ceil(initialFs * .6); fs = Math.min(fs - 1, Math.floor(fs * .94))) {
    for (let n = 1; n <= Math.min(maxLines, words.length); n++) {
      const lines = [];
      for (let i = 0; i < n; i++) lines.push(words.slice(Math.floor(i * words.length / n), Math.floor((i + 1) * words.length / n)).join(" "));
      const request = { kind, lines, fs, W, H, style, xShare, yShare, box, maxWidthPx: (box[2] - box[0]) * W };
      const m = measured(request, measureText);
      if (!m) return { code: "measurement-missing" };
      if (validBox(m.box) && inside(m.box, box)) return { lines, fs, ...m };
    }
  }
  return { code: "text-overflow" };
}

export function planCaptionScreens(words, { cap = null, names = [], lyricLines = [], cuts = [], avoid = [], W, H, totalSec = null, measureText } = {}) {
  const holds = [], notes = [];
  const fail = (code, reason) => ({ screens: [], holds: [hold(code, "captions", reason)], notes });
  if (!Array.isArray(words) || !words.length) return fail("word-times-missing", "captions require heard words on the cut clock");
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!hasText(w?.text) || !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < 0 || w.end <= w.start || (i && w.start < words[i - 1].end) || (totalSec !== null && w.end > totalSec)) return fail("timing-invalid", `word ${i} has invalid heard timing`);
    if (CONTROL.test(w.text)) return fail("literal-unrenderable", `word ${i} contains a renderer control character; source is not altered`);
    if (cuts.some((t) => t > w.start && t < w.end)) return fail("word-crosses-cut", `word ${i} crosses a cut; no invented word clock`);
  }
  const glue = Array(words.length).fill(false), hard = Array(words.length).fill(false);
  const raw = words.map((w) => squash(w.text)), c = raw.map(core);
  for (let i = 0; i < words.length - 1; i++) {
    const neg = (k) => NEGATOR.test(c[k]) || /n['’]t$/iu.test(raw[k]);
    glue[i] = (/\d/u.test(raw[i]) && UNIT.test(c[i + 1])) || neg(i) || (AUX.test(c[i]) && neg(i + 1)) || FUNC.test(c[i]) || /^[$€£]$/u.test(raw[i]) || (/^[-–,.]$/u.test(raw[i + 1]) && /\d/u.test(raw[i])) || (/^[-–,.]$/u.test(raw[i]) && i > 0 && /\d/u.test(raw[i - 1])) || (/^\p{Lu}/u.test(raw[i]) && /^\p{Lu}/u.test(raw[i + 1]) && c[i] !== "i");
  }
  for (const name of names) {
    const p = squash(name).split(" ").map(core);
    for (let i = 0; i + p.length <= words.length; i++) if (p.every((t, k) => t === c[i + k])) for (let k = 0; k < p.length - 1; k++) glue[i + k] = true;
  }
  let from = 0;
  for (const line of lyricLines) {
    const p = squash(line).split(" ").map(core);
    let at = -1;
    for (let i = from; i + p.length <= words.length; i++) if (p.every((t, k) => t === c[i + k])) { at = i; break; }
    if (at < 0) return fail("lyric-not-heard", `lyric phrase not found in heard words: ${line}`);
    const end = at + p.length - 1;
    if (at) hard[at - 1] = true;
    hard[end] = true;
    for (let i = at; i < end; i++) glue[i] = true;
    from = end + 1;
  }
  // Source boundaries win BEFORE creating semantic units.
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i + 1].start - words[i].end > .8 || cuts.some((t) => t >= words[i].end && t <= words[i + 1].start) || endSentence(raw[i])) hard[i] = true;
    if (hard[i]) glue[i] = false;
  }
  const units = [];
  from = 0;
  for (let i = 0; i < words.length; i++) if (i === words.length - 1 || !glue[i]) { units.push({ a: from, b: i }); from = i + 1; }
  const groups = [], per = Math.max(1, Math.round(cap?.wordsPerLine?.median ?? 3));
  let cur = null;
  for (const u of units) {
    if (cur && (hard[cur.b] || cur.b - cur.a + 1 >= per || u.b - cur.a + 1 > per + 3)) { groups.push(cur); cur = null; }
    cur = cur ? { a: cur.a, b: u.b } : u;
  }
  if (cur) groups.push(cur);
  const box = cap?.box;
  if (box === undefined) return fail("geometry-missing", "captions require explicit authored box geometry");
  if (!validBox(box)) return fail("geometry-invalid", "caption box geometry is invalid");
  if (cap.place !== undefined && (!Array.isArray(cap.place) || cap.place.length !== 2 || !cap.place.every((y) => Number.isFinite(y) && y >= box[1] && y <= box[3]) || cap.place[0] > cap.place[1])) return fail("geometry-invalid", "explicit caption placement is outside its authored box");
  const xShare = (box[0] + box[2]) / 2;
  const yShare = cap.place === undefined ? (box[1] + box[3]) / 2 : (cap.place[0] + cap.place[1]) / 2;
  const screens = [];
  for (const [i, g] of groups.entries()) {
    const plain = literalWords(words.slice(g.a, g.b + 1));
    const m = fitText(plain, { kind: "caption", fs: captionFontPx(cap, H), box, xShare, yShare, style: cap?.style, W, H, maxLines: 2, measureText });
    if (m.code) { holds.push(hold(m.code, `caption ${i + 1}`, "no trusted raster measurement fits the authored caption geometry")); continue; }
    const s = words[g.a].start, e = words[g.b].end;
    if (avoid.some((a) => validBox(a.box) && overlapsTime({ in: s, out: e }, a) && meets(m.box, a.box))) { holds.push(hold("caption-geometry", `caption ${i + 1}`, "measured caption intersects reserved pixels; no invented relocation")); continue; }
    screens.push({ text: plain, plain, lines: m.lines, fs: m.fs, s, e, xShare, yShare, box: m.box, measurement: m.measurement });
  }
  return { screens: holds.length ? [] : screens, holds, notes };
}

// Only the selected frozen format/Skeleton contract grants ending permission.
// The format identifier is a binding, not a name allowlist. Any of ALL20 uses
// the same explicit permission interface; nothing is selected automatically.
export function outputPermissions({ treatment, captions = false, selection = {} }) {
  const holds = [];
  const p = selection.outputPermission;
  const selected = !!(selection.ending || selection.endCard || selection.offer);
  const bound = hasText(p?.formatId) && p.formatId === treatment;
  if (selected && !bound) holds.push(hold("output-permission-missing", "permissions", "selected output requires its frozen format/Skeleton permission contract"));
  let ending = { kind: null, status: "unselected" };
  if (selection.ending) {
    const e = selection.ending;
    ending = { kind: e.kind, status: "hold" };
    if (!bound || e.kind !== p?.ending?.kind || e.mode !== p?.ending?.mode || !["native", "asset"].includes(e.mode)) holds.push(hold("ending-not-permitted", "ending", "ending does not match the explicitly selected output permission"));
    else if ((e.mode === "asset" || p.ending.assetRequired === true) && !hasText(e.asset)) holds.push(hold("ending-asset-missing", "ending", "selected ending requires its supplied asset"));
    else ending.status = e.mode === "native" ? "native" : "supplied";
  }
  let endCard = false, offer = null;
  if (selection.endCard) {
    if (!bound || p.endCard !== true) holds.push(hold("end-card-not-permitted", "end-card", "selected format/Skeleton contract does not permit this end card"));
    else if (!hasText(selection.endCard.text)) holds.push(hold("text-missing", "end-card", "selected card has no literal text"));
    else endCard = true;
  }
  if (selection.offer) {
    const o = selection.offer;
    if (!bound || p.offer !== true) holds.push(hold("offer-not-permitted", "offer", "selected format/Skeleton contract does not permit this offer"));
    else if (!hasText(o.text)) holds.push(hold("text-missing", "offer", "selected offer has no literal text"));
    else if (o.photo?.real !== true || !hasText(o.photo?.id)) holds.push(hold("offer-needs-real-photo", "offer", "selected offer requires a real product photo"));
    else offer = { text: squash(o.text), photo: o.photo.id };
  }
  return { treatment, captions: captions === true, requiredText: true, endCard, ending, offer, holds };
}

function observe(item, { source, words = [], verifyObservation }) {
  // verifyObservation is a capability owned by the actual media consumer. Item
  // evidence/receipt strings are deliberately NEVER passed off as trusted proof.
  if (typeof verifyObservation !== "function") return null;
  let o;
  try { o = verifyObservation({ item, source }); } catch { return null; }
  const hash = (s) => typeof s === "string" && /^[a-f\d]{64}$/iu.test(s);
  if (!hasText(source?.id) || !hash(source?.sha256) || o?.source?.id !== source.id || o?.source?.sha256 !== source.sha256 || !hash(o?.frame?.sha256) || !Number.isFinite(o?.frame?.time) || o.frame.time < item.in || o.frame.time >= item.out || squash(o.text) !== squash(item.text) || !validBox(o.box) || !inside(o.box, item.box) || !inside(item.box, o.box)) return null;
  if (item.opening && (!hash(o?.opening?.sha256) || o.opening.time !== 0 || item.in !== 0 || squash(o.opening.text) !== squash(item.text) || !validBox(o.opening.box) || !inside(o.opening.box, item.box) || !inside(item.box, o.opening.box))) return null;
  if (item.provenance === "physical-readout") {
    const cue = words.filter((w) => w.lineId === item.cueLineId);
    if (!hasText(item.cueLineId) || o.cueLineId !== item.cueLineId || !cue.length || cue.some((w) => !Number.isFinite(w.start) || !Number.isFinite(w.end)) || !cue.some((w) => w.start < item.out && w.end > item.in) || !hasText(o.value) || !hasText(o.unit)) return null;
    const pair = `${o.value.trim()} ${o.unit.trim()}`;
    // Token adjacency and equality, not substring checks: 1/g != 10/mg.
    const adjacent = (s) => {
      const tokens = squash(s).split(" ");
      const needle = pair.split(" ");
      return tokens.some((_, i) => needle.every((t, k) => tokens[i + k] === t));
    };
    if (!adjacent(item.text) || !adjacent(literalWords(cue))) return null;
  }
  return o;
}

export function planCards(items, { avoid = [], captionRects = [], W, H, totalSec = null, endCardAllowed = false, measureText, source, words, verifyObservation } = {}) {
  const holds = [], skipped = [], readouts = [], notes = [], reservations = [], cards = [];
  const placed = [...captionRects];
  const fail = (item, code, reason) => item.required === true || ["physical-readout", "authentic-lettering"].includes(item.provenance) ? holds.push(hold(code, item.id, reason)) : skipped.push({ id: item.id, code, reason });
  const valid = [];
  for (const item of items) {
    if (!hasText(item.text)) { fail(item, "text-missing", "no approved literal text"); continue; }
    if (CONTROL.test(item.text)) { fail(item, "literal-unrenderable", "renderer control characters are held, never stripped"); continue; }
    if (!Number.isFinite(item.in) || !Number.isFinite(item.out) || item.out <= item.in) { fail(item, "timing-missing", "explicit authored in/out are required"); continue; }
    if (item.in < 0 || (totalSec !== null && item.out > totalSec)) { fail(item, "timing-out-of-range", "authored interval lies outside the cut"); continue; }
    if (item.box === undefined) { fail(item, "geometry-missing", "text requires explicit authored rectangle geometry"); continue; }
    const box = item.box;
    if (!validBox(box)) { fail(item, "geometry-invalid", "invalid authored box"); continue; }
    const normalized = { ...item, box };
    if (["physical-readout", "authentic-lettering"].includes(item.provenance)) {
      // Reserve before all post graphics, even if this proof is missing/held.
      reservations.push({ box, in: item.in, out: item.out });
      const o = observe(normalized, { source, words, verifyObservation });
      readouts.push({ id: item.id, provenance: item.provenance, status: o ? "observed" : "hold", claimsObserved: !!o, observation: o });
      if (!o) fail(item, item.provenance === "physical-readout" ? "readout-unobserved" : "lettering-unobserved", "no trusted same-file frame/cue/opening observation with exact literal tokens");
      continue;
    }
    if (item.provenance && item.provenance !== "post") { fail(item, "provenance-unknown", "unknown text provenance"); continue; }
    valid.push(normalized);
  }
  for (const item of valid.sort((a, b) => Number(b.required === true) - Number(a.required === true))) {
    const kind = Object.hasOwn(FONT_SHARE, item.kind) ? item.kind : "card";
    if (kind === "end" && !endCardAllowed) { fail(item, "end-card-not-selected", "no explicit selected end-card permission"); continue; }
    if (item.minReadableSec !== undefined && (!Number.isFinite(item.minReadableSec) || item.minReadableSec <= 0 || item.out - item.in < item.minReadableSec)) { fail(item, "text-timing", "authored window fails its supplied minimum readable duration; not retimed"); continue; }
    if (["hook", "end"].includes(kind) && cards.some((c) => c.kind === kind)) { fail(item, "text-slot-conflict", "multiple authored items target a singleton renderer slot; none is silently dropped"); continue; }
    const text = squash(item.text);
    const m = fitText(text, { kind, fs: Math.round(H * FONT_SHARE[kind]), box: item.box, xShare: (item.box[0] + item.box[2]) / 2, yShare: (item.box[1] + item.box[3]) / 2, W, H, maxLines: MAX_LINES[kind], measureText });
    if (m.code) { fail(item, m.code, "no trusted raster measurement fits the authored box"); continue; }
    if ([...avoid, ...reservations, ...placed].some((a) => validBox(a.box) && overlapsTime(item, a) && meets(m.box, a.box))) { fail(item, "geometry-blocked", "measured text intersects reserved pixels; no invented relocation"); continue; }
    const card = { id: item.id, kind, label: text, lines: m.lines, fs: m.fs, box: m.box, renderBox: item.box, in: item.in, out: item.out, moved: false, measurement: m.measurement };
    placed.push(card); cards.push(card);
  }
  return { cards: cards.filter((c) => !["hook", "end"].includes(c.kind)).map((c, i) => ({ n: i + 1, ...c })), hook: cards.find((c) => c.kind === "hook") ?? null, endCard: cards.find((c) => c.kind === "end") ?? null, readouts, holds, skipped, notes, reservations };
}

export function planText({ treatment, words = [], captions = {}, items = [], avoid = [], selection = {}, libass = false, W, H, totalSec = null, inheritedHolds = [], measureText, source, verifyObservation, cuts = [] }) {
  const holds = inheritedHolds.map((h) => ({ ...h, required: true, inherited: true }));
  const permissions = outputPermissions({ treatment, captions: captions.on === true, selection });
  holds.push(...permissions.holds);
  const directives = { captions: [], cards: [], hook: null, endCard: null };
  const result = { ok: false, holds, notes: [], skipped: [], permissions, readouts: [], directives };
  if (!(Number.isInteger(W) && W > 0 && Number.isInteger(H) && H > 0)) { holds.push(hold("geometry-missing", "frame", "known frame dimensions are required")); return result; }
  const all = [];
  for (const item of items) {
    if (["end", "offer"].includes(item.kind)) {
      const reason = "ending/offer cards must come from the explicit frozen selection, not a global item";
      if (item.required === true) holds.push(hold("output-not-selected", item.id, reason));
      else result.skipped.push({ id: item.id, code: "output-not-selected", reason });
    } else all.push(item);
  }
  if (permissions.endCard) all.push({ ...selection.endCard, id: "end-card", kind: "end", required: true });
  if (permissions.offer) all.push({ ...selection.offer, id: "offer", kind: "offer", required: true });
  const cp = planCards(all, { avoid, W, H, totalSec, endCardAllowed: permissions.endCard, measureText, source, words, verifyObservation });
  holds.push(...cp.holds); result.skipped.push(...cp.skipped); result.readouts = cp.readouts;
  directives.cards = cp.cards; directives.hook = cp.hook; directives.endCard = cp.endCard;
  if (captions.on === true) {
    const cardAvoid = [...cp.cards, ...(cp.hook ? [cp.hook] : []), ...(cp.endCard ? [cp.endCard] : []), ...cp.reservations];
    const p = planCaptionScreens(words, { cap: captions.cap, names: captions.names, lyricLines: captions.lyricLines, cuts, avoid: [...avoid, ...cardAvoid], W, H, totalSec, measureText });
    holds.push(...p.holds); directives.captions = p.screens;
  }
  if (!libass && (captions.on === true || all.some((i) => !["physical-readout", "authentic-lettering"].includes(i.provenance)))) holds.push(hold("libass-missing", "burn", "actual subtitles filter is unavailable; text is not delivered"));
  result.ok = holds.length === 0;
  return result;
}
