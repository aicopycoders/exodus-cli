// The drawn items of b-roll, inserts and overlays in a One-take film (copy-coders docs/port/broll-in-app/PLAN.md,
// version 7, 3.3, 3.6 and 4.7 "Drawn items"): the words a drawn item may print, how big each item is drawn, and its
// events in the subtitle file the cut burns. first-cut-cutaways.mjs says when and where each goes; first-cut.mjs
// measures the font, finds the place and burns the file.
//
// Every time here is a whole frame of the finished film (the drawn track's windows), written into the file as it is:
// editAss divides the times it is given by the speed, and these never pass through that division (plan 4.7).
// Nothing a manifest holds reaches the file as a command: a string is printed only when it passes the card's shape rule
// (video/lib/sheet/ending.ts cardWordsPrintable), which holds no brace, backslash or line break.
//
// This file imports nothing, so the cut runs with `node` and no build.

/** The drawn kinds this cut lays (first-cut-cutaways.mjs CUTAWAY_DRAWN_KINDS); any other kind is left for a later part. */
export const DRAWN_KINDS_LAID = Object.freeze(["label", "list", "timer", "card", "emoji", "sticker"]);

/** The card's plain marks (video/lib/sheet/captions.ts CARD_MARKS, less the double quotes, plus the left single quote). */
const DRAWN_MARKS = [".", ",", "!", "?", "'", "’", "-", "–", "—", ":", ";", "%", "&", "(", ")", "/", "+", "$", "#", "‘"];
const DRAWN_CHAR = new RegExp(`^[\\p{Script=Latin}\\u{300}-\\u{36f}0-9 ${DRAWN_MARKS.map((m) => `\\u{${m.codePointAt(0).toString(16)}}`).join("")}]+$`, "u");

/**
 * The words exactly as the manifest gives them, when they take the card's shape (video/lib/sheet/ending.ts
 * cardWordsPrintable: Latin letters, the digits 0 to 9, spaces and the plain marks, no double quote, no line break, and
 * a letter or a digit), so no `{`, `}`, `\` or line break can reach the subtitle file as a command; else null.
 */
export function drawnWordsOf(words) {
  if (typeof words !== "string" || words.trim() === "") return null;
  if (!Array.from(words).every((char) => DRAWN_CHAR.test(char.normalize("NFD"))) || !/[\p{L}\p{N}]/u.test(words)) return null;
  return /[{}\\\r\n]/.test(words) ? null : words;
}

/**
 * The look of the drawn items, in pixels of the cut's 1080 by 1920 frame (scaled to another), from labels and cards
 * tried on stored films and the cut's own headline and ending: near-black words (the headline's
 * #141414) in Montserrat Black on a white rounded plate (alpha 245 of 255), with the ending's soft shadow under it.
 * A text is drawn at `em` pixels a em and may get smaller to `floorEm` to fit, never below; past that it is left out.
 * The floor is 0.8 of the captions' own size (first-cut.mjs editAss: 0.034 of the height, 65 px), so a drawn word is
 * never much smaller than a caption's.
 */
export const DRAWN_LOOK = Object.freeze({
  ink: "&H141414&",
  plate: "&HFFFFFF&",
  plateAlpha: "&H0A&",
  shadow: { down: 6, blur: 9, alpha: "&H91&" },
  red: "&H3024E6&",
  green: "&H3C9B2E&",
  em: { label: 64, list: 56, timer: 60 },
  floorEm: 52,
  lineShare: 1.05,
  padX: 34,
  padY: 22,
  radius: 30,
  side: 54,
  stackGap: 12,
  bullet: 0.42,
  clock: 0.95,
  iconGap: 16,
  maxLines: 2,
  pop: [0.7, 0.9],
  // A card: 0.50 of the frame's width, on the chest, the member's words in up
  // to three lines under its figure: the chart's ring (its track grey, filled green to the one number, from the top,
  // clockwise) or the guarantee's seal (red, a white tick). The offer card is words alone.
  // An emoji: one of our own drawings on a white round badge, 0.16 of the width; at its smallest (plan 0.40)
  // 0.11, 120 px, still twice a caption's height. A sticker: its cut-out, 0.40 of the width, never smaller; a card is
  // never smaller than its own words' floor.
  emoji: 170,
  emojiSmall: 120,
  stickerShare: 0.4,
  card: { share: 0.5, em: 60, maxLines: 3, pad: 30, figureGap: 18, radius: 34, ring: 200, ringWidth: 32, track: "&HE0E0E0&", seal: 120, sealColour: "&H241B8A&" },
});

/**
 * The share of its ring a chart card fills: the one number its words hold, 0 to 100 ("86% saw improvement" fills 0.86),
 * a decimal point or comma read as such and a comma before three digits as a thousands mark; null when the words hold
 * no number, more than one, or one past 100.
 */
export function chartShareOf(words) {
  const numbers = String(words).match(/\d+(?:[.,]\d+)*/g) ?? [];
  if (numbers.length !== 1) return null;
  const value = Number(numbers[0].replace(/,(?=\d{3}(?!\d))/g, "").replace(",", "."));
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value / 100 : null;
}

/**
 * The chart's ring filled to `share` (0 to 1) as an ASS drawing: a wedge from the ring's middle, from the top clockwise,
 * its arc a point every 2 degrees or less; the ring's hole is drawn over it. Null for nothing to fill.
 */
export function ringWedgePath(share, cx, cy, r) {
  if (!(share > 0)) return null;
  const sweep = Math.min(1, share) * 2 * Math.PI;
  const steps = Math.max(2, Math.ceil((sweep * 180) / Math.PI / 2));
  const pts = Array.from({ length: steps + 1 }, (_, k) => {
    const a = -Math.PI / 2 + (sweep * k) / steps;
    return `${px(cx + r * Math.cos(a))} ${px(cy + r * Math.sin(a))}`;
  });
  return `m ${px(cx)} ${px(cy)} l ${pts.join(" l ")}`;
}

const px = (n) => Math.round(n);
const pad2 = (n) => String(n).padStart(2, "0");
/** A centisecond count as an ASS time (first-cut.mjs csTime). */
const csTime = (cs) => `${Math.floor(cs / 360000)}:${pad2(Math.floor(cs / 6000) % 60)}:${pad2(Math.floor(cs / 100) % 60)}.${pad2(cs % 100)}`;
/**
 * A frame of the finished film as an ASS time: that frame's own time floored to the centisecond (first-cut.mjs
 * captionStartCs), so libass draws an event from its first frame and stops before the frame it ends on.
 */
export const drawnFrameTime = (frame, fps = 24) => csTime(Math.floor((frame * 100) / fps + 1e-9));

/** A rounded box `w` by `h` as an ASS drawing from its top left corner (first-cut.mjs roundedBoxPath). */
function boxPath(w, h, r) {
  const k = px(r * 0.5523);
  return [
    `m ${r} 0`, `l ${w - r} 0`, `b ${w - r + k} 0 ${w} ${r - k} ${w} ${r}`,
    `l ${w} ${h - r}`, `b ${w} ${h - r + k} ${w - r + k} ${h} ${w - r} ${h}`,
    `l ${r} ${h}`, `b ${r - k} ${h} 0 ${h - r + k} 0 ${h - r}`,
    `l 0 ${r}`, `b 0 ${r - k} ${r - k} 0 ${r} 0`,
  ].join(" ");
}

/** A circle of radius `r` centred on (cx, cy), four Bézier quarters. */
export function circlePath(cx, cy, r) {
  const k = r * 0.5523;
  const p = (x, y) => `${px(x)} ${px(y)}`;
  return [
    `m ${p(cx, cy - r)}`, `b ${p(cx + k, cy - r)} ${p(cx + r, cy - k)} ${p(cx + r, cy)}`,
    `b ${p(cx + r, cy + k)} ${p(cx + k, cy + r)} ${p(cx, cy + r)}`, `b ${p(cx - k, cy + r)} ${p(cx - r, cy + k)} ${p(cx - r, cy)}`,
    `b ${p(cx - r, cy - k)} ${p(cx - k, cy - r)} ${p(cx, cy - r)}`,
  ].join(" ");
}

/**
 * Words wrapped at their spaces into at most `maxLines` lines no wider than `maxW`, at the largest em from `em` down to
 * `floorEm` (2 px a step) where they fit; a word is never broken. Null when they fit at no em.
 */
export function fitWords(text, measure, { maxW, em, floorEm, maxLines }) {
  const words = text.trim().split(/ +/);
  for (let e = em; e >= floorEm; e -= 2) {
    if (words.some((w) => measure(w, e) > maxW)) continue;
    const lines = [];
    for (const w of words) {
      const joined = lines.length > 0 ? `${lines.at(-1)} ${w}` : null;
      if (joined && measure(joined, e) <= maxW) lines[lines.length - 1] = joined;
      else lines.push(w);
    }
    if (lines.length <= maxLines) return { em: e, lines, width: Math.max(...lines.map((l) => measure(l, e))) };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------- the emoji

/**
 * The 12 emoji of the set (video/lib/cutawayTemplates.ts CUTAWAY_EMOJI), our own simple flat drawings, no picture from
 * any emoji set or font (plan 0.10: their licences): each a list of shapes in a 100-unit square, each shape a closed
 * path of straight lines (`l`) and Bézier curves (`b`) and its colour, drawn over a white round badge with the plates'
 * soft shadow, so it reads over any frame at phone size.
 */
const C = { ink: "&H141414&", white: "&HFFFFFF&", green: "&H3C9B2E&", red: "&H3024E6&", orange: "&H008AFF&", yellow: "&H1FD2FF&", gold: "&H009AD9&", blue: "&HFF8C2F&", leaf: "&H4AB53B&", darkLeaf: "&H2C7A1E&", heart: "&H3C28E8&" };
const poly = (pts) => `m ${pts[0][0]} ${pts[0][1]} ${pts.slice(1).map(([x, y]) => `l ${x} ${y}`).join(" ")}`;
const oval = (cx, cy, rx, ry) => {
  const kx = rx * 0.5523;
  const ky = ry * 0.5523;
  return `m ${cx} ${cy - ry} b ${cx + kx} ${cy - ry} ${cx + rx} ${cy - ky} ${cx + rx} ${cy} b ${cx + rx} ${cy + ky} ${cx + kx} ${cy + ry} ${cx} ${cy + ry} b ${cx - kx} ${cy + ry} ${cx - rx} ${cy + ky} ${cx - rx} ${cy} b ${cx - rx} ${cy - ky} ${cx - kx} ${cy - ry} ${cx} ${cy - ry}`;
};
const rect = (x0, y0, x1, y1) => poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
const star = (cx, cy, R, r, n) => poly(Array.from({ length: 2 * n }, (_, k) => {
  const a = -Math.PI / 2 + (k * Math.PI) / n;
  const d = k % 2 === 0 ? R : r;
  return [Math.round((cx + d * Math.cos(a)) * 10) / 10, Math.round((cy + d * Math.sin(a)) * 10) / 10];
}));
const rays = (cx, cy, r0, r1, n, half) => Array.from({ length: n }, (_, k) => {
  const a = (k * 2 * Math.PI) / n;
  const at = (d, t) => [Math.round((cx + d * Math.cos(t)) * 10) / 10, Math.round((cy + d * Math.sin(t)) * 10) / 10];
  return poly([at(r0, a - half), at(r1, a), at(r0, a + half)]);
});

export const DRAWN_EMOJI = Object.freeze({
  check: [[oval(50, 50, 38, 38), C.green], [poly([[27, 50], [34, 43], [43, 52], [66, 29], [73, 36], [43, 66]]), C.white]],
  cross: [[oval(50, 50, 38, 38), C.red], [poly([[35.5, 28.5], [71.5, 64.5], [64.5, 71.5], [28.5, 35.5]]), C.white], [poly([[64.5, 28.5], [71.5, 35.5], [35.5, 71.5], [28.5, 64.5]]), C.white]],
  fire: [
    ["m 50 10 b 58 28 80 40 78 64 b 76 82 64 90 50 90 b 36 90 24 82 22 64 b 20 46 40 36 50 10", C.orange],
    ["m 50 44 b 56 56 66 62 64 74 b 62 84 56 88 50 88 b 44 88 38 84 36 74 b 34 62 46 56 50 44", C.yellow],
  ],
  sparkles: [[star(42, 56, 32, 11, 4), C.yellow], [star(72, 27, 16, 5, 4), C.yellow], [star(75, 74, 11, 4, 4), C.yellow]],
  heart: [["m 50 84 b 30 68 16 56 16 40 b 16 28 26 20 36 20 b 43 20 48 24 50 30 b 52 24 57 20 64 20 b 74 20 84 28 84 40 b 84 56 70 68 50 84", C.heart]],
  star: [[star(50, 53, 38, 16, 5), C.yellow]],
  "thumbs-up": [
    [rect(18, 46, 30, 86), C.blue],
    ["m 30 48 l 42 48 l 46 20 b 46 16 56 16 56 22 l 56 46 l 66 46 b 74 46 74 56 72 58 b 76 60 76 68 72 70 b 76 72 76 80 70 82 b 72 86 68 88 64 88 l 30 88", C.yellow],
    [rect(50, 57, 72, 60), C.gold], [rect(50, 69, 72, 72), C.gold], [rect(50, 80, 68, 83), C.gold],
  ],
  eyes: [
    [oval(33, 50, 15, 24), C.ink], [oval(33, 50, 12, 21), C.white], [oval(37, 57, 7, 9), C.ink],
    [oval(67, 50, 15, 24), C.ink], [oval(67, 50, 12, 21), C.white], [oval(71, 57, 7, 9), C.ink],
  ],
  clock: [[oval(50, 50, 38, 38), C.ink], [oval(50, 50, 32, 32), C.white], [rect(47, 25, 53, 53), C.ink], [rect(47, 47, 72, 53), C.red]],
  drop: [["m 50 12 b 58 30 74 46 74 62 b 74 76 63 88 50 88 b 37 88 26 76 26 62 b 26 46 42 30 50 12", C.blue], [oval(39, 64, 5, 9), C.white]],
  leaf: [["m 20 80 b 20 42 44 18 82 18 b 82 56 58 80 20 80", C.leaf], [poly([[22, 76], [70, 28], [74, 32], [26, 80]]), C.darkLeaf]],
  sun: [[oval(50, 50, 20, 20), C.yellow], ...rays(50, 50, 26, 44, 8, 0.24).map((p) => [p, C.yellow])],
});

/** An emoji on its badge, `size` pixels across: each shape drawn in its 100-unit square, scaled to the badge. */
function emojiBadge(id, size, scale) {
  const L = DRAWN_LOOK;
  const k = size / 100;
  const badge = oval(50, 50, 50, 50);
  return {
    w: size,
    h: size,
    parts: [
      { layer: 10, x: 0, y: L.shadow.down * scale, path: badge, scale: k, tags: `\\1c&H000000&\\1a${L.shadow.alpha}\\blur${L.shadow.blur * scale}` },
      { layer: 11, x: 0, y: 0, path: badge, scale: k, tags: `\\1c${L.plate}` },
      ...DRAWN_EMOJI[id].map(([path, colour], i) => ({ layer: 12 + i, x: 0, y: 0, path, scale: k, tags: `\\1c${colour}` })),
    ],
  };
}

/** The red arrow at a drawn item (plan 3.6): it points right, at the item, from its left, a white edge round it. */
export const DRAWN_ARROW = Object.freeze({ w: 72, h: 56, gap: 12, border: 4 });
const arrowPath = () => {
  const { w, h } = DRAWN_ARROW;
  return `m 0 ${px(h * 0.36)} l ${px(w * 0.5)} ${px(h * 0.36)} l ${px(w * 0.5)} 0 l ${w} ${px(h / 2)} l ${px(w * 0.5)} ${h} l ${px(w * 0.5)} ${px(h * 0.64)} l 0 ${px(h * 0.64)}`;
};

/**
 * A card (plan 4.7): 0.50 of the width, its figure on top (the chart's ring, the guarantee's seal) and the member's
 * words under it, centred. Null when the words do not fit its width in three lines at the floor's size.
 */
function cardPlate(kind, words, measure, scale, W, share) {
  const L = DRAWN_LOOK;
  const K = L.card;
  const w = px(K.share * W);
  const pad = K.pad * scale;
  const fit = fitWords(words, (t, e) => measure(t, e) * scale, { maxW: w - 2 * pad, em: K.em, floorEm: L.floorEm, maxLines: K.maxLines });
  if (!fit) return null;
  const figure = kind === "chart-card" ? K.ring * scale : kind === "guarantee-card" ? K.seal * scale : 0;
  const lineH = fit.em * L.lineShare * scale;
  const top = pad + (figure > 0 ? figure + K.figureGap * scale : 0);
  const h = Math.ceil(top + fit.lines.length * lineH + pad);
  const cx = w / 2;
  const cy = pad + figure / 2;
  const r = figure / 2;
  const fig = kind === "chart-card"
    ? [
      { layer: 12, x: 0, y: 0, path: circlePath(cx, cy, r), tags: `\\1c${K.track}` },
      ...(ringWedgePath(share, cx, cy, r) ? [{ layer: 13, x: 0, y: 0, path: ringWedgePath(share, cx, cy, r), tags: `\\1c${L.green}` }] : []),
      { layer: 14, x: 0, y: 0, path: circlePath(cx, cy, r - K.ringWidth * scale), tags: `\\1c${L.plate}` },
    ]
    : kind === "guarantee-card"
      ? [
        { layer: 12, x: 0, y: 0, path: circlePath(cx, cy, r), tags: `\\1c${K.sealColour}` },
        { layer: 13, x: 0, y: 0, path: `m ${[[27, 50], [34, 43], [43, 52], [66, 29], [73, 36], [43, 66]].map(([x, y]) => `${px(cx - r + (x * 2 * r) / 100)} ${px(cy - r + (y * 2 * r) / 100)}`).join(" l ")}`, tags: `\\1c${L.plate}` },
      ]
      : [];
  const parts = [
    { layer: 10, x: 0, y: L.shadow.down * scale, path: boxPath(w, h, px(K.radius * scale)), tags: `\\1c&H000000&\\1a${L.shadow.alpha}\\blur${L.shadow.blur * scale}` },
    { layer: 11, x: 0, y: 0, path: boxPath(w, h, px(K.radius * scale)), tags: `\\1c${L.plate}\\1a${L.plateAlpha}` },
    ...fig,
    ...fit.lines.map((text, i) => ({ layer: 12, cx, cy: top + (i + 0.5) * lineH, em: fit.em * scale, text })),
  ];
  return { w, h, parts };
}

/**
 * A text row on a plate: an optional icon to the left of the words. `icon` is { w, parts(x, y, size) } in the plate's
 * own pixels. Returns the plate's size and its parts, each at the plate's top left.
 */
function plateRow(fit, look, scale, icon = null) {
  const L = look;
  const lineH = fit.em * L.lineShare * scale;
  const padX = L.padX * scale;
  const padY = L.padY * scale;
  const iconW = icon ? icon.w + L.iconGap * scale : 0;
  const w = Math.ceil(fit.width + iconW + 2 * padX);
  const h = Math.ceil(fit.lines.length * lineH + 2 * padY);
  const parts = [
    { layer: 10, x: 0, y: L.shadow.down * scale, path: boxPath(w, h, px(L.radius * scale)), tags: `\\1c&H000000&\\1a${L.shadow.alpha}\\blur${L.shadow.blur * scale}` },
    { layer: 11, x: 0, y: 0, path: boxPath(w, h, px(L.radius * scale)), tags: `\\1c${L.plate}\\1a${L.plateAlpha}` },
    ...(icon ? icon.parts(padX, h / 2, icon.w) : []),
    ...fit.lines.map((text, i) => ({ layer: 12, cx: padX + iconW + fit.width / 2, cy: padY + (i + 0.5) * lineH, em: fit.em * scale, text })),
  ];
  return { w, h, parts };
}

/** A green dot, a list's bullet. */
const bulletIcon = (size) => ({ w: size, parts: (x, cy, d) => [{ layer: 12, x: 0, y: 0, path: circlePath(x + d / 2, cy, d / 2), tags: `\\1c${DRAWN_LOOK.green}` }] });
/** A clock face with two hands, the timer's badge: it counts nothing (plan 4.4). */
const clockIcon = (size) => ({
  w: size,
  parts: (x, cy, d) => {
    const cx = x + d / 2;
    const r = d / 2;
    const t = Math.max(3, d * 0.09);
    const bar = (x0, y0, x1, y1) => `m ${px(x0)} ${px(y0)} l ${px(x1)} ${px(y0)} l ${px(x1)} ${px(y1)} l ${px(x0)} ${px(y1)}`;
    return [
      { layer: 12, x: 0, y: 0, path: circlePath(cx, cy, r), tags: `\\1c${DRAWN_LOOK.ink}` },
      { layer: 13, x: 0, y: 0, path: circlePath(cx, cy, r - t), tags: `\\1c${DRAWN_LOOK.plate}` },
      { layer: 14, x: 0, y: 0, path: `${bar(cx - t / 2, cy - r * 0.62, cx + t / 2, cy + t / 2)} ${bar(cx - t / 2, cy - t / 2, cx + r * 0.48, cy + t / 2)}`, tags: `\\1c${DRAWN_LOOK.ink}` },
    ];
  },
});

/**
 * How a drawn item is drawn, before it is placed: its size `w` by `h` and its groups, each a set of parts that comes in
 * on its own frame (a list's points one by one; every other item at once), each part at the item's top left. Or the
 * code why it cannot be drawn: its words do not print (`cut-words-unprintable`, `cut-unread` when it has none) or do
 * not fit across the frame at the floor's size (`cut-words-wide`). `font.measure(text, em)` is the words' width in
 * pixels in the burn's font. `small`: the smallest size the look allows, for an item that found no place at its own:
 * the words at the floor's size (DRAWN_LOOK.floorEm, 52 px at 1080 wide, 0.8 of the captions' 65 px), on one line
 * where they fit.
 */
export function drawnLayoutOf(laid, font, W = 1080, H = 1920, { small = false } = {}) {
  const L = DRAWN_LOOK;
  const scale = W / 1080;
  const item = laid.item;
  const arrow = item.arrow === true;
  // The arrow's white edge is inside the item's box too, so nothing placed beside it is drawn over.
  const arrowW = arrow ? (DRAWN_ARROW.border + DRAWN_ARROW.w + DRAWN_ARROW.gap) * scale : 0;
  const room = W - 2 * L.side * scale - 2 * L.padX * scale - arrowW;
  const fit = (words, em, iconW, maxLines) => fitWords(words, (t, e) => font.measure(t, e) * scale, { maxW: room - iconW, em, floorEm: L.floorEm, maxLines });
  // `small` (plan 0.40): the words at the floor's size, on one line where they fit, else on two.
  const fitOf = (words, em, iconW = 0) => (small ? fit(words, L.floorEm, iconW, 1) ?? fit(words, L.floorEm, iconW, L.maxLines) : fit(words, em, iconW, L.maxLines));
  // A sticker is its picture alone, cut out and sized when the cut read it (`item.sticker`), laid under the words.
  if (laid.kind === "sticker") {
    return item.sticker ? { w: item.sticker.size[0], h: item.sticker.size[1], groups: [], picture: item.sticker.file } : { code: "cut-no-file" };
  }
  const texts = laid.kind === "list" ? (Array.isArray(item.points) ? item.points.map((p) => p?.words) : []) : laid.kind === "emoji" ? [] : [item.words];
  if (laid.kind !== "emoji" && (texts.length === 0 || texts.some((t) => t === undefined))) return { code: "cut-unread" };
  const printed = texts.map(drawnWordsOf);
  if (printed.some((t) => t === null)) return { code: "cut-words-unprintable" };
  let rows;
  if (laid.kind === "emoji") {
    if (typeof item.emoji !== "string" || !Object.hasOwn(DRAWN_EMOJI, item.emoji)) return { code: "cut-unread" };
    rows = [emojiBadge(item.emoji, px((small ? L.emojiSmall : L.emoji) * scale), scale)];
  } else if (laid.kind === "label") {
    const fit = fitOf(printed[0], L.em.label);
    if (!fit) return { code: "cut-words-wide" };
    rows = [plateRow(fit, L, scale)];
  } else if (laid.kind === "timer") {
    const icon = clockIcon(px(L.em.timer * L.clock * scale));
    const fit = fitOf(printed[0], L.em.timer, icon.w + L.iconGap * scale);
    if (!fit) return { code: "cut-words-wide" };
    rows = [plateRow(fit, L, scale, clockIcon(px(fit.em * L.clock * scale)))];
  } else if (laid.kind === "list") {
    const iconW = px(L.em.list * L.bullet * scale);
    const fits = printed.map((t) => fitOf(t, L.em.list, iconW + L.iconGap * scale));
    if (fits.some((f) => f === null)) return { code: "cut-words-wide" };
    rows = fits.map((fit) => plateRow(fit, L, scale, bulletIcon(px(fit.em * L.bullet * scale))));
  } else if (laid.kind === "card") {
    const share = item.template === "chart-card" ? chartShareOf(printed[0]) : null;
    if (item.template === "chart-card" && share === null) return { code: "cut-chart-number" };
    const card = cardPlate(item.template, printed[0], font.measure, scale, W, share);
    if (!card) return { code: "cut-words-wide" };
    rows = [card];
  } else return { code: "cut-drawn-later" };
  // The rows stacked and centred, the arrow at the first row's left.
  const gap = L.stackGap * scale;
  const inner = Math.max(...rows.map((r) => r.w));
  const w = Math.ceil(inner + arrowW);
  const h = Math.ceil(rows.reduce((sum, r) => sum + r.h, 0) + gap * (rows.length - 1) + L.shadow.down * scale);
  let y = 0;
  const groups = rows.map((r, k) => {
    const x = arrowW + (inner - r.w) / 2;
    const parts = r.parts.map((p) => ({ ...p, ...(p.path !== undefined ? { x: p.x + x, y: p.y + y } : { cx: p.cx + x, cy: p.cy + y }) }));
    if (k === 0 && arrow) {
      const s = scale;
      parts.push({ layer: 12, x: x - DRAWN_ARROW.gap * s - DRAWN_ARROW.w * s, y: y + r.h / 2 - (DRAWN_ARROW.h * s) / 2, path: arrowPath(), scale: s, tags: `\\1c${L.red}\\3c${L.plate}\\bord${DRAWN_ARROW.border * s}` });
    }
    const group = { from: laid.points ? laid.points[k] : laid.in, cx: x + r.w / 2, cy: y + r.h / 2, parts };
    y += r.h + gap;
    return group;
  });
  return { w, h, groups, ...(arrow ? { arrow: true } : {}) };
}

/** The drawn items' style: the burn's font in the headline's ink, no edge or shadow, each event placing itself. */
export function drawnStyle(font, H = 1920) {
  return `Style: Drawn,${font.name},${font.fs(DRAWN_LOOK.em.label * (H / 1920))},&H00141414,&H00141414,&H00FFFFFF,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`;
}

/**
 * A laid drawn item's events: each group from its own frame to the item's out, popping in over its first frames at
 * DRAWN_LOOK.pop of its size about its own middle, then at its own size. `laid.place.box` is where the item sits
 * ([x0, y0, x1, y1], pixels), `laid.layout` its drawnLayoutOf. Times are frames of the finished film, written as they are.
 */
export function drawnEvents(laid, font, fps = 24) {
  const [bx, by] = laid.place.box;
  const out = [];
  for (const g of laid.layout.groups) {
    const steps = [...DRAWN_LOOK.pop.map((s, k) => ({ s, a: g.from + k, b: g.from + k + 1 })), { s: 1, a: g.from + DRAWN_LOOK.pop.length, b: laid.out }]
      .filter((st) => st.a < laid.out)
      .map((st) => ({ ...st, b: Math.min(st.b, laid.out) }));
    for (const { s, a, b } of steps) {
      const at = (x, y) => [bx + g.cx + (x - g.cx) * s, by + g.cy + (y - g.cy) * s];
      for (const p of g.parts) {
        const size = (p.scale ?? 1) * s * 100;
        if (p.path !== undefined) {
          const [x, y] = at(p.x, p.y);
          out.push(`Dialogue: ${p.layer},${drawnFrameTime(a, fps)},${drawnFrameTime(b, fps)},Drawn,,0,0,0,,{\\an7\\pos(${px(x)},${px(y)})\\fscx${px(size)}\\fscy${px(size)}\\bord0\\shad0${p.tags}\\p1}${p.path}`);
        } else {
          const [x, y] = at(p.cx, p.cy);
          out.push(`Dialogue: ${p.layer},${drawnFrameTime(a, fps)},${drawnFrameTime(b, fps)},Drawn,,0,0,0,,{\\an5\\pos(${px(x)},${px(y)})\\fs${font.fs(p.em * s)}}${p.text}`);
        }
      }
    }
  }
  return out;
}
