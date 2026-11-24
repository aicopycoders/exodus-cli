// B-roll, inserts and overlays in a One-take film (copy-coders docs/port/broll-in-app/PLAN.md, version 7, 4.7 and
// 0.2): what the cut reads of the manifest's `oneTakeCutaways` and where each item goes, in numbers only.
//
// A later part has the worker write the key (scout auto-cut.ts) from the run's approved plan: each kept item as the
// plan holds it (video/lib/cutawayPlan.ts CutawayItem), a paid item with its file in the folder. This file reads
// it and times its frame items (scheduleFrameTrack); first-cut.mjs lays them and writes `pace.cutaways`.
// Every time is a whole frame of the finished film's 24 fps clock, after the speed step (cutawayFrame).
//
// This file imports nothing, so the cut runs with `node` and no build, as the rest of the cut does. The names it
// shares with the app (the templates' tracks, the leave-out codes, the word match) are copies, checked against the
// app's own in exodus/__tests__/first-cut-cutaways.test.ts.

/** The manifest's key, and the one version of it this cut reads. */
export const CUTAWAYS_KEY = "oneTakeCutaways";
export const CUTAWAYS_VERSION = 1;

/** The finished film's clock (first-cut.mjs FPS). */
export const CUTAWAY_FPS = 24;

/**
 * The one way a time becomes a frame: the nearest frame of the finished film, as first-cut.mjs lays its own extra
 * shots (shotFrames: Math.round(seconds * FPS)).
 */
export const cutawayFrame = (sec) => Math.round(sec * CUTAWAY_FPS);

/**
 * Each template of Release 1 by its id (video/lib/cutawayTemplates.ts CUTAWAY_TEMPLATES) and the track the cut lays it
 * on: a b-roll shot or the insert on the frame track, every other item drawn (PR 8 of the plan).
 */
export const CUTAWAY_TRACKS = Object.freeze({
  "product-demo": "broll",
  "product-closeup": "broll",
  unboxing: "broll",
  prep: "broll",
  "daily-life": "broll",
  ingredient: "broll",
  "old-fixes": "broll",
  "out-with-old": "broll",
  problem: "broll",
  relief: "broll",
  "insert-3d": "insert",
  "insert-2d": "insert",
  "insert-style": "insert",
  label: "drawn",
  list: "drawn",
  timer: "drawn",
  "emoji-sticker": "drawn",
  "offer-card": "drawn",
  "chart-card": "drawn",
  "guarantee-card": "drawn",
  "ingredient-stickers": "drawn",
});

/** The plan's family of each track. */
const FAMILY_OF_TRACK = { broll: "broll", insert: "insert", drawn: "overlay" };

/** The four layouts an item may ask for (video/lib/cutawayTemplates.ts CUTAWAY_FRAMES). */
export const CUTAWAY_FRAMES = Object.freeze(["full", "split", "speakerTop", "corner"]);

/**
 * Why the cut left an item out, or laid none: closed codes, each with its member sentence in
 * video/lib/cutawayTemplates.ts CUTAWAY_LEFT_OUT.
 */
export const CUTAWAY_CUT_CODES = Object.freeze([
  // The key as a whole (cutawaysOf, and first-cut.mjs's gate).
  "cut-unread",
  "cut-version",
  "cut-both-keys",
  "cut-staged-text",
  "cut-mapped",
  "cut-template",
  // An item's file.
  "cut-no-file",
  "cut-file-unreadable",
  "cut-insert-short",
  "cut-clip-short",
  // Its word (cutawayAnchorOf).
  "cut-line-not-heard",
  "cut-word-not-found",
  // Its window (scheduleFrameTrack).
  "cut-first-last-line",
  "cut-too-early",
  "cut-too-close",
  "cut-too-short",
  "cut-end",
  // A drawn item: laid by a later part of the cut.
  "cut-drawn-later",
]);

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const hasText = (v) => typeof v === "string" && v.trim().length > 0;
const isCount = (v, least) => Number.isInteger(v) && v >= least;
const HEX64 = /^[0-9a-f]{64}$/;
/** A line's id as the board gives it, the one shape a plan holds (video/lib/cutawayPlan.ts CUTAWAY_LINE_ID). */
export const CUTAWAY_LINE_ID = /^take-[1-9][0-9]{0,2}-line-[1-9][0-9]{0,2}$/;
/** An anchor's word: one word, no space, at most this many characters (video/lib/cutawayPlan.ts). */
export const CUTAWAY_ANCHOR_WORD_MAX_CHARS = 30;
/** It also holds a letter or a digit and no control character, as the plan's record reads it (cardWordsPrintable). */
const isAnchorWord = (v) =>
  typeof v === "string" && /^\S+$/.test(v) && Array.from(v).length <= CUTAWAY_ANCHOR_WORD_MAX_CHARS && /[\p{L}\p{N}]/u.test(v) && !/\p{Cc}/u.test(v);
/**
 * A file of the cut's folder by its plain name: no folder, no way out of it, and no Windows device name. A name can
 * still be a link out of the folder: the part that opens the file checks where it really points.
 */
const PLAIN_FILE = /^(?!(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$))[\w][\w.-]*$/i;

/** A word as the shots match it (first-cut.mjs shotWord, video/lib/oneTakeBroll.ts oneTakeShotWord). */
export const cutawayWord = (word) => String(word ?? "").toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** The drawn item's own fields, carried as the plan holds them for the drawn track (PR 8), never read here. */
const DRAWN_FIELDS = ["subject", "text", "words", "points", "emoji", "arrow"];

/** One item of the key as the cut reads it, or null when a field it needs does not read. */
function itemOf(raw) {
  if (!isObject(raw) || !isCount(raw.n, 1) || !hasText(raw.key) || !HEX64.test(raw.key) || !hasText(raw.template)) return null;
  const track = Object.hasOwn(CUTAWAY_TRACKS, raw.template) ? CUTAWAY_TRACKS[raw.template] : null;
  const at = raw.at;
  if (!track || raw.family !== FAMILY_OF_TRACK[track]) return null;
  if (!isObject(at) || typeof at.lineId !== "string" || !CUTAWAY_LINE_ID.test(at.lineId) || !isAnchorWord(at.word) || !isCount(at.nth, 1)) return null;
  const item = { n: raw.n, key: raw.key, family: raw.family, template: raw.template, track, at: { lineId: at.lineId, word: at.word, nth: at.nth } };
  if (track === "drawn") {
    if (raw.frame !== undefined || raw.burst !== undefined || (raw.file !== undefined && raw.template !== "ingredient-stickers")) return null;
    for (const field of DRAWN_FIELDS) if (raw[field] !== undefined) item[field] = raw[field];
    if (raw.file !== undefined) {
      if (!hasText(raw.file) || !PLAIN_FILE.test(raw.file)) return null;
      item.file = raw.file;
    }
    return item;
  }
  // The insert is laid full screen, as the plan's record reads it (video/lib/cutawayPlan.ts itemOf).
  if (!CUTAWAY_FRAMES.includes(raw.frame) || (track === "insert" && raw.frame !== "full")) return null;
  item.frame = raw.frame;
  if (raw.file !== undefined) {
    if (!hasText(raw.file) || !PLAIN_FILE.test(raw.file)) return null;
    item.file = raw.file;
  }
  if (raw.burst !== undefined) {
    if (track !== "broll" || (raw.burst !== 1 && raw.burst !== 2)) return null;
    item.burst = raw.burst;
  }
  return item;
}

/**
 * The manifest's `oneTakeCutaways`, as the cut reads it, or null when the manifest does not hold the key:
 * - `refused`: the whole key is not laid: `cut-version` for another version, `cut-unread` when it is not an object or
 *   its plan id, items or whoosh do not read;
 * - `items`: each item that reads, in spoken order (`n`); `left`: each one that does not, with `cut-unread` (a repeated
 *   number or key does not read either).
 */
export function cutawaysOf(manifest) {
  if (!isObject(manifest) || manifest[CUTAWAYS_KEY] === undefined) return null;
  const raw = manifest[CUTAWAYS_KEY];
  const refused = (code, version = null) => ({ version, planId: null, items: [], left: [], refused: code });
  if (!isObject(raw)) return refused("cut-unread");
  if (!Number.isInteger(raw.version)) return refused("cut-unread");
  if (raw.version !== CUTAWAYS_VERSION) return refused("cut-version", raw.version);
  if (!hasText(raw.planId) || !HEX64.test(raw.planId) || !Array.isArray(raw.items)) return refused("cut-unread", CUTAWAYS_VERSION);
  if (raw.whoosh !== undefined && !(hasText(raw.whoosh) && PLAIN_FILE.test(raw.whoosh))) return refused("cut-unread", CUTAWAYS_VERSION);
  const items = [];
  const left = [];
  const seen = new Set();
  for (const one of raw.items) {
    const item = itemOf(one);
    if (!item || seen.has(`n:${item.n}`) || seen.has(`key:${item.key}`)) {
      // No free text reaches the left-out list (plan 3.3): a key of the item's own shape and a template of Release 1 only.
      left.push({
        ...(isObject(one) && isCount(one.n, 1) ? { n: one.n } : {}),
        ...(isObject(one) && typeof one.key === "string" && HEX64.test(one.key) ? { key: one.key } : {}),
        ...(isObject(one) && typeof one.template === "string" && Object.hasOwn(CUTAWAY_TRACKS, one.template) ? { template: one.template } : {}),
        code: "cut-unread",
      });
      continue;
    }
    seen.add(`n:${item.n}`);
    seen.add(`key:${item.key}`);
    items.push(item);
  }
  items.sort((a, b) => a.n - b.n);
  return { version: CUTAWAYS_VERSION, planId: raw.planId, ...(raw.whoosh !== undefined ? { whoosh: raw.whoosh } : {}), items, left };
}

/**
 * Whether the cut refuses the whole key (plan 4.7, "The gate"), and why: a manifest that also holds today's extra shots
 * (`bothKeys`), today's three refusals of extra shots (a cut whose words the text stage draws, a cut laid on its
 * measured map, a template launch), or the key's own (`read.refused`, another version or a key that does not read).
 * Null: the key is laid.
 */
export function cutawaysRefusalOf({ bothKeys = false, stagedText = false, mapped = false, template = false, read = null } = {}) {
  if (bothKeys) return "cut-both-keys";
  if (stagedText) return "cut-staged-text";
  if (mapped) return "cut-mapped";
  if (template) return "cut-template";
  return read?.refused ?? null;
}

/**
 * The row an item comes in on (plan 4.7, "Anchors"): the `nth` row of its line whose word matches, as the shots match
 * (cutawayWord). `rows` are the film's words, each with its `lineId`. Or the code why there is none: its line has no
 * row (a take with no heard words has none), or the line does not say the word that often.
 */
export function cutawayAnchorOf(at, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const onLine = isObject(at) ? list.flatMap((r, i) => (isObject(r) && r.lineId === at.lineId ? [i] : [])) : [];
  if (onLine.length === 0) return { code: "cut-line-not-heard" };
  // A word that is all punctuation matches nothing: a pause mark is a row of its own with no word.
  const word = cutawayWord(at.word);
  const hits = word === "" ? [] : onLine.filter((i) => cutawayWord(list[i].text) === word);
  const index = hits[at.nth - 1];
  return index === undefined ? { code: "cut-word-not-found" } : { index };
}

// ---------------------------------------------------------------------------------------------------- the frame track

/**
 * Luke's timing lock (D11) and the bursts (plan 0.2), in whole frames of the finished film (plan 4.7, "Whole frames"):
 * - a b-roll shot comes in `leadFrames` before its word's first frame, and lasts `brollMaxFrames` or to its line's
 *   last frame, whichever is first; under `brollMinFrames` it is left out;
 * - an edge may move up to `snapFrames` onto a picture cut (dev's FLASH_BARS.maxSec, 0.2 s), checked after its line's
 *   end (plan 0.6), so a sliver of the take never shows between a cut and an item;
 * - at least `gapFrames` between frame items, never before `notBeforeFrame` or the opening headline's end, never on
 *   a frame of the first or the last line, never past the end card or words over the last shot as laid, or the film's
 *   end; every check runs on the final frames, and an item that fails one is left out, never cut short;
 * - a picture of a burst lasts `burstMinFrames` or more, and goes out at the next picture's in when that is
 *   `burstChainFrames` or less after its own.
 */
export const CUTAWAY_TIMING = Object.freeze({
  leadFrames: 2,
  brollMinFrames: 29,
  brollMaxFrames: 41,
  snapFrames: 4,
  gapFrames: 17,
  notBeforeFrame: 15,
  burstMinFrames: 24,
  burstChainFrames: 59,
});

/** The insert's clip (plan 4.7): from its first frame at 1.0x, with no zoom, its whole window. A b-roll clip is today's (EXTRA_SHOTS). */
export const CUTAWAY_INSERT_CLIP = Object.freeze({ fromSec: 0, playSpeed: 1 });

/**
 * A b-roll clip (plan 4.7): read as today's extra shots are (first-cut.mjs EXTRA_SHOTS: from 0.3 s, at 1.5x; a test pins
 * the two equal). A clip too short for its window at 1.5x plays slower, down to `slowest` and no slower, from the same
 * start; still too short, its window ends where the clip does, or earlier clear of a picture cut (cutawayClipSpeed,
 * cutawayClipMostFrames, clipFitOf). The take never shows through a picture.
 */
export const CUTAWAY_BROLL_CLIP = Object.freeze({ fromSec: 0.3, playSpeed: 1.5, slowest: 1 });

/**
 * The frames of a b-roll clip of `fileFrames` frames that ffmpeg reads from CUTAWAY_BROLL_CLIP.fromSec on: a seek to
 * 0.3 s keeps the frames that start at it or after, so it skips ceil(0.3 x 24) = 8 frames, not 7.2.
 */
const clipReadFrames = (fileFrames) => fileFrames - Math.ceil(CUTAWAY_BROLL_CLIP.fromSec * CUTAWAY_FPS - 1e-9);

/**
 * The speed a b-roll clip of `fileFrames` frames plays at to cover a window of `frames` frames on the film, from
 * CUTAWAY_BROLL_CLIP.fromSec: its usual 1.5x when that covers it, else the fastest speed in hundredths that does, 1.0x at
 * the least; null when even 1.0x does not. A clip covers a window as the insert's file does (plan 4.7): it holds the
 * window and one frame more, the frame the overlay ends on. Played at speed s, the frames it reads give floor(read / s)
 * frames of film (measured with ffmpeg), so it covers `frames` when (frames + 1) x s is at most the frames it reads.
 * Today's 4 s clips (97 frames, 89 read) cover a shot's longest window, 41 frames, at 1.5x, and a chain's longest
 * picture, 59 frames, at 1.48x.
 */
export function cutawayClipSpeed(fileFrames, frames) {
  const C = CUTAWAY_BROLL_CLIP;
  const read = clipReadFrames(fileFrames);
  if (!(Number.isFinite(read) && Number.isFinite(frames) && frames > 0)) return null;
  if ((frames + 1) * C.playSpeed <= read) return C.playSpeed;
  const speed = Math.floor((read / (frames + 1)) * 100) / 100;
  return speed >= C.slowest ? speed : null;
}

/** The most frames of film a b-roll clip of `fileFrames` frames covers, at its slowest speed (and one frame more). */
export function cutawayClipMostFrames(fileFrames) {
  const most = Math.floor(clipReadFrames(fileFrames) / CUTAWAY_BROLL_CLIP.slowest) - 1;
  return Number.isFinite(most) ? Math.max(0, most) : 0;
}

/** A row with a line and both its times, as the track reads one: a row without them times nothing. */
const isTimedRow = (r) => isObject(r) && typeof r.lineId === "string" && Number.isFinite(r.start) && Number.isFinite(r.end);
/** A line with both its frames. */
const isTimedLine = (l) => isObject(l) && typeof l.lineId === "string" && Number.isFinite(l.from) && Number.isFinite(l.to);
/** Spoken order on the film's clock, whatever order the list came in. */
const bySpokenOrder = (a, b) => a.from - b.from || a.to - b.to;

/**
 * The film's lines in spoken order, each from its first word's first frame to its last word's last: from the rows.
 * A row without its line or both its times adds nothing.
 */
export function cutawayLinesOf(rows) {
  const lines = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!isTimedRow(r)) continue;
    const from = cutawayFrame(r.start);
    const to = cutawayFrame(r.end);
    const line = lines.find((l) => l.lineId === r.lineId);
    if (line) {
      line.from = Math.min(line.from, from);
      line.to = Math.max(line.to, to);
    } else lines.push({ lineId: r.lineId, from, to });
  }
  return lines.sort(bySpokenOrder);
}

/**
 * Where each frame item of the key goes on the finished film (plan 4.7 and 0.2), in whole frames: the insert first, then
 * every b-roll shot in spoken order, each window checked against those already laid.
 * - `items`: as cutawaysOf reads them; a drawn item is left out (`cut-drawn-later`), as the drawn track is a later part
 *   of the cut; the insert and a b-roll item carry `fileFrames`, their file's length in frames, when it was probed;
 * - `rows`: the film's words (seconds of the finished film), each with its `lineId`; `lines`: the film's lines in
 *   spoken order (cutawayLinesOf, with any line no word was heard on placed by the caller);
 * - `joins`: the film's picture cuts, `notBefore`: where an opening headline ends, `stopAt`: where an end card or words
 *   over the last shot begin (all seconds of the finished film; none: null); `filmFrames`: the film's frames.
 * Returns each item laid, with its window `in` (its first frame) to `out` (the frame after its last), and each item
 * left out with its code.
 * A bound that does not read leaves items out, never lets one through: a film length or an end that is not a number
 * puts every item past the end (`cut-end`), a headline's end that is not a number puts every item before it
 * (`cut-too-early`), a word without its times is not found, a line without its frames is not heard, a cut that is not a
 * number is no cut.
 */
export function scheduleFrameTrack(items, opts) {
  // A snap is optional (plan 0.6, 0.15, 0.20): it is taken only when it costs no shot. The track is placed with no edge
  // snapped. Then, first, an item's in, its out, or both together snap when that lays an item left out without them and
  // leaves out none laid (again while one does); then each other edge snaps when every item laid without it is still
  // laid. So the track never leaves out an item it would lay with no snap at all.
  const keys = [...new Set((Array.isArray(items) ? items.filter(isObject) : []).map((item) => item.key))];
  const noSnap = new Set(keys.flatMap((key) => [`${key}:in`, `${key}:out`]));
  const idOf = (l) => `${l.n}:${l.key}`;
  let best = placeTrack(items, opts, noSnap);
  /** Snaps `edges` when, with them, no item laid now is left out and (when `gain`) fewer are left out. */
  const trySnap = (edges, gain) => {
    const off = edges.filter((e) => noSnap.has(e));
    if (off.length === 0) return false;
    for (const e of off) noSnap.delete(e);
    const trial = placeTrack(items, opts, noSnap);
    const leftNow = new Set(best.left.map(idOf));
    if (trial.left.every((l) => leftNow.has(idOf(l))) && (!gain || trial.left.length < best.left.length)) {
      best = trial;
      return true;
    }
    for (const e of off) noSnap.add(e);
    return false;
  };
  for (let gained = true; gained;) {
    gained = false;
    for (const key of keys) {
      for (const edges of [[`${key}:in`], [`${key}:out`], [`${key}:in`, `${key}:out`]]) if (trySnap(edges, true)) gained = true;
    }
  }
  for (const key of keys) for (const edge of [`${key}:in`, `${key}:out`]) trySnap([edge], false);
  return best;
}

/** The frame track placed once, with the snapped edges in `noSnap` (`<key>:in`, `<key>:out`) left where they were. */
function placeTrack(items, { rows, lines, joins = [], notBefore = 0, stopAt = null, filmFrames }, noSnap) {
  const T = CUTAWAY_TIMING;
  const laid = [];
  const left = [];
  const leave = (item, code, extra = {}) => left.push({ n: item.n, key: item.key, template: item.template, code, ...extra });
  const rowList = Array.isArray(rows) ? rows : [];
  const lineList = (Array.isArray(lines) ? lines.filter(isTimedLine) : cutawayLinesOf(rowList)).sort(bySpokenOrder);
  const cuts = [...new Set((Array.isArray(joins) ? joins : []).filter(Number.isFinite).map(cutawayFrame))].sort((a, b) => a - b);
  const filmEnd = Number.isFinite(filmFrames) ? filmFrames : 0;
  const endAt = stopAt === null || stopAt === undefined ? Infinity : Number.isFinite(stopAt) ? cutawayFrame(stopAt) : 0;
  const ctx = {
    cuts,
    first: lineList[0],
    last: lineList.at(-1),
    floor: Math.max(T.notBeforeFrame, notBefore === null ? 0 : Number.isFinite(notBefore) ? cutawayFrame(notBefore) : Infinity),
    stop: Math.min(filmEnd, endAt),
    placed: laid,
    noSnap,
  };
  // The key's own counts (plan 4.1, 0.2): one insert, and a burst of 4 pictures at most. The first insert in spoken
  // order (its number, `n`, as the plan numbers its items) is kept and any other left out; every picture of a burst of more than 4 is left out. Both as `cut-unread`,
  // since no approved plan holds them. A burst of fewer than 3 is kept: the member's drops and failed pictures leave
  // the rest of a burst to be timed as it is (0.2).
  const itemList = Array.isArray(items) ? items.filter(isObject) : [];
  const inserts = itemList.filter((item) => item.track === "insert");
  const firstInsert = inserts.reduce((first, item) => (item.n < first.n ? item : first), inserts[0]);
  const burstSize = new Map();
  for (const item of itemList) if (item.track === "broll" && item.burst) burstSize.set(item.burst, (burstSize.get(item.burst) ?? 0) + 1);
  const counted = itemList.filter((item) => {
    const off = (item.track === "insert" && item !== firstInsert) || (item.track === "broll" && item.burst && burstSize.get(item.burst) > 4);
    if (off) leave(item, "cut-unread");
    return !off;
  });
  // Each frame item's word, its row and its line; one on the first or the last line is left out.
  const anchored = [];
  for (const item of counted) {
    if (item.track === "drawn") {
      leave(item, "cut-drawn-later");
      continue;
    }
    const found = cutawayAnchorOf(item.at, rowList);
    if ("code" in found) {
      leave(item, found.code);
      continue;
    }
    const row = rowList[found.index];
    if (!isTimedRow(row)) {
      leave(item, "cut-word-not-found");
      continue;
    }
    const line = lineList.find((l) => l.lineId === row.lineId);
    if (!line) {
      leave(item, "cut-line-not-heard");
      continue;
    }
    if (line === ctx.first || line === ctx.last) {
      leave(item, "cut-first-last-line");
      continue;
    }
    anchored.push({ item, index: found.index, row, line, word: cutawayFrame(row.start) });
  }
  // The insert first (plan 4.7), then the shots in spoken order.
  for (const pic of anchored.filter((p) => p.item.track === "insert")) {
    // Its window snapped, else (when a snap would leave it out) each snapped edge where it was. Its file's length in
    // frames, when probed: a value that is not a number of frames is a file the cut could not read.
    const { fileFrames } = pic.item;
    const fileFails = (w) => (fileFrames === undefined ? null
      : !(Number.isFinite(fileFrames) && fileFrames >= 0) ? "cut-file-unreadable"
        : fileFrames < w.out - w.in + 1 ? "cut-insert-short" : null);
    const fails = (w, c) => windowFails(w, 1, c) ?? fileFails(w);
    const timedIn = (c) => snapped(pic.line.from - T.leadFrames, pic.line.to, c, pic.item.key);
    // When none holds, it is left out with the code of its window with no snap taken.
    const timed = timedIn(ctx);
    const windows = [timed, ...unsnappedTries(timed, timed, pic.item.key, pic.item.key, ctx).map((c) => timedIn(c))];
    const kept = windows.find((w) => !fails(w, ctx));
    if (kept) laid.push(laidOf(pic, kept, true));
    else leave(pic.item, fails(windows.at(-1), ctx));
  }
  // A b-roll clip's length in frames, when probed: a value that is not a number of frames is a file the cut could not
  // read, as the insert's.
  const shots = anchored.filter((p) => {
    if (p.item.track !== "broll") return false;
    const { fileFrames } = p.item;
    if (fileFrames === undefined || (Number.isFinite(fileFrames) && fileFrames >= 0)) return true;
    leave(p.item, "cut-file-unreadable");
    return false;
  });
  // A burst whose pictures stand apart is timed as runs, each its own unit, in spoken order with the rest.
  const queue = unitsOf(shots);
  while (queue.length > 0) {
    const { pictures, left: out, rests } = timeUnit(queue.shift(), ctx);
    for (const { pic, code, clip } of out) leave(pic.item, code, clip);
    laid.push(...pictures);
    if (rests.length > 0) queue.push(...rests);
    queue.sort((x, y) => x[0].word - y[0].word || x[0].index - y[0].index);
  }
  laid.sort((a, b) => a.in - b.in);
  return { laid, left };
}

/**
 * The b-roll as the units the track lays, in spoken order of each unit's first picture (their words' frames): each
 * shot alone, and the pictures of each burst together (plan 0.2), in spoken order.
 */
function unitsOf(pics) {
  const units = [];
  const bursts = new Map();
  for (const pic of [...pics].sort((x, y) => x.word - y.word || x.index - y.index)) {
    const burst = pic.item.burst;
    if (!burst) units.push([pic]);
    else if (bursts.has(burst)) bursts.get(burst).push(pic);
    else {
      const unit = [pic];
      bursts.set(burst, unit);
      units.push(unit);
    }
  }
  return units;
}

/**
 * The snap (plan 0.6). When the in snaps onto a cut, the length rule runs from the
 * new in: the window shifts back, 41 frames at most, as dev's fixed-length shots do. When the out snaps, only the out
 * moves, and the window may get up to `snapFrames` longer, also past its line's last frame. The line's end bounds the
 * out before the out snaps.
 *
 * A snap is optional: an edge MAY move onto a cut. It is taken only when, with it, every rule still holds for the item
 * and for every item laid beside it. An item a snap would leave out is timed with that edge where it was (timeUnit, the
 * insert in placeTrack); an edge that would leave any other item out is not snapped (scheduleFrameTrack). An edge in
 * `ctx.noSnap` (`<key>:in`, `<key>:out`) is not snapped.
 *
 * The gap between frame items (plan 0.20): `gapFrames` between their edges as placed before any snap. Snaps may then
 * bring two items closer, the snaps on both sides together, but never closer than `gapFrames - snapFrames` (tooClose):
 * a gap of 17 frames before the snaps is 13 at the least after them.
 *
 * An in moved back onto a picture cut `snapFrames` or less before it, so no sliver of the take shows between them.
 */
function snapIn(inAt, { cuts, noSnap }, key = null) {
  if (noSnap?.has(`${key}:in`)) return inAt;
  return cuts.filter((c) => c < inAt && inAt - c <= CUTAWAY_TIMING.snapFrames).at(-1) ?? inAt;
}

/** An out moved on onto a picture cut `snapFrames` or less after it. */
function snapOut(outAt, { cuts, noSnap }, key = null) {
  if (noSnap?.has(`${key}:out`)) return outAt;
  return cuts.find((c) => c > outAt && c - outAt <= CUTAWAY_TIMING.snapFrames) ?? outAt;
}

/** A window from `inAt` to `outAt` with both edges snapped, and where each was before it moved. */
function snapped(inAt, outAt, ctx, key = null) {
  const w = { in: snapIn(inAt, ctx, key), out: snapOut(outAt, ctx, key) };
  const moved = { ...(w.in !== inAt ? { in: inAt } : {}), ...(w.out !== outAt ? { out: outAt } : {}) };
  return Object.keys(moved).length > 0 ? { ...w, snapped: moved } : w;
}

/**
 * The ways to time a window again with its snapped edges where they were: its in alone, its out alone, then both (the
 * first window's in and the last's out; `inKey` and `outKey` their items'). Each a context to time it in.
 */
function unsnappedTries(first, last, inKey, outKey, ctx) {
  const edges = [...(first.snapped?.in !== undefined ? [`${inKey}:in`] : []), ...(last.snapped?.out !== undefined ? [`${outKey}:out`] : [])];
  const tries = edges.length === 2 ? [[edges[0]], [edges[1]], edges] : edges.length === 1 ? [edges] : [];
  return tries.map((off) => ({ ...ctx, noSnap: new Set([...ctx.noSnap, ...off]) }));
}

/**
 * Whether window `w` is too close to the laid item `p` (plan 0.20): under `gapFrames` between their edges before any snap
 * (`rawIn`, `rawOut`; a laid item's from its record of where each edge was), or under `gapFrames - snapFrames` between
 * them as snapped.
 */
function tooClose(w, p) {
  const T = CUTAWAY_TIMING;
  const rawIn = w.rawIn ?? w.snapped?.in ?? w.in;
  const rawOut = w.rawOut ?? w.snapped?.out ?? w.out;
  const pIn = p.snapped?.in ?? p.in;
  const pOut = p.snapped?.out ?? p.out;
  const least = T.gapFrames - T.snapFrames;
  return (rawIn < pOut + T.gapFrames && rawOut + T.gapFrames > pIn) || (w.in < p.out + least && w.out + least > p.in);
}

/** The first check a window fails on its final frames, as its code, or null. */
function windowFails(w, least, ctx) {
  if (w.in < ctx.first.to || w.out > ctx.last.from) return "cut-first-last-line";
  if (w.in < ctx.floor) return "cut-too-early";
  if (w.out > ctx.stop) return "cut-end";
  if (ctx.placed.some((p) => tooClose(w, p))) return "cut-too-close";
  if (w.out - w.in < least) return "cut-too-short";
  return null;
}

/**
 * Each picture's window in a unit of b-roll (plan 4.7 and 0.2): in at its word less `leadFrames`; out at the next
 * picture's in when that is `burstChainFrames` or less after its own, else `brollMaxFrames` later or at its line's
 * last frame, whichever is first. Only the unit's first in and last out snap onto a picture cut, the out after its
 * line's end bounds it (plan 0.6). A shot alone is a unit of one picture.
 * Whether a picture runs to the next one is read from their words, before any snap: a snap only makes the first and
 * the last picture longer, so it never leaves a picture too short.
 */
function timePictures(kept, ctx) {
  const T = CUTAWAY_TIMING;
  const asked = kept.map((pic) => pic.word - T.leadFrames);
  const ins = [...asked];
  ins[0] = snapIn(asked[0], ctx, kept[0].item.key);
  return kept.map((pic, k) => {
    const next = ins[k + 1];
    const chained = next !== undefined && asked[k + 1] - asked[k] <= T.burstChainFrames;
    const end = chained ? next : Math.min(ins[k] + T.brollMaxFrames, pic.line.to);
    const out = k === kept.length - 1 ? snapOut(end, ctx, pic.item.key) : end;
    const moved = { ...(k === 0 && ins[0] !== asked[0] ? { in: asked[0] } : {}), ...(out !== end ? { out: end } : {}) };
    return { in: ins[k], out, ...(Object.keys(moved).length > 0 ? { snapped: moved } : {}) };
  });
}

/** A unit's pictures as one window, from its first in to its last out, with where each was before it snapped. */
const spanOf = (w) => ({ in: w[0].in, out: w.at(-1).out, rawIn: w[0].snapped?.in ?? w[0].in, rawOut: w.at(-1).snapped?.out ?? w.at(-1).out });

/**
 * One unit of b-roll on the track, a shot or a burst, timed on its final frames: with its edges snapped, else (when a
 * snap would leave a picture out) with each snapped edge where it was in turn, then both. When none holds, the unit
 * loses a picture as it would with no snap taken, with that timing's code: a picture under its least length
 * (`burstMinFrames` in a burst, `brollMinFrames` alone), the first in spoken order; else the picture at the end of the
 * span that fails a check (its first for a check before it, its last for one after it). The rest is timed again. A
 * burst left with one picture is timed as a shot. The whoosh comes in on its first picture.
 * A burst's pictures run back to back: where one would not run on to the next (its words more than `burstChainFrames`
 * apart, plan 0.2), the pictures from the next on are handed back (`rests`) as a unit of their own, timed after this
 * one is laid. So each run of pictures is a unit with its own edges, whoosh and gap, and a picture alone is a shot.
 * Each picture's clip is held to its window (clipFitOf), and the rules judge the windows as the clips play them: a
 * window its clip cannot cover breaks the run after that picture, or leaves the picture out (`cut-clip-short`), and the
 * rest is timed again. A run is laid only once laidRunFails passes it.
 */
function timeUnit(unit, ctx) {
  const T = CUTAWAY_TIMING;
  const left = [];
  const rests = [];
  const kept = [...unit];
  while (kept.length > 0) {
    const apart = kept.findIndex((pic, k) => k > 0 && pic.word - kept[k - 1].word > T.burstChainFrames);
    if (apart > 0) rests.push(kept.splice(apart));
    const least = kept.length === 1 ? T.brollMinFrames : T.burstMinFrames;
    const failsIn = (w, c) => (w.some((p) => p.out - p.in < least) ? "cut-too-short" : windowFails(spanOf(w), least, c));
    const windows = timePictures(kept, ctx);
    const tries = [ctx, ...unsnappedTries(windows[0], windows.at(-1), kept[0].item.key, kept.at(-1).item.key, ctx)];
    let clipShort = null;
    // The most snapped timing whose windows held their rules as timed but not once held to their clips (laidRunFails).
    let unlaid = null;
    for (const c of tries) {
      const w = c === ctx ? windows : timePictures(kept, c);
      // The windows as they play, each held to its clip, are the ones the rules judge: a window its clip shortened or
      // slowed is a window like any other. So a shot whose full window would run onto the end card, but whose clip ends it
      // before, is laid where it plays. Every run is laid only through laidRunFails, whatever branch timed it.
      const fit = clipFitOf(kept, w, least, c);
      if (fit.windows) {
        const fails = laidRunFails(kept, w, fit.windows, least, c);
        if (!fails) return { pictures: kept.map((pic, k) => laidOf(pic, fit.windows[k], k === 0)), left, rests };
        if (!failsIn(w, c)) unlaid ??= fails;
        continue;
      }
      // A run broken after a picture checks both its sides whole itself (clipFitOf), so a chain whose full windows fail
      // (its last picture's onto the end card, say) may still break there. Else the least snapped timing whose rules held
      // decides, and its window is the one the left-out entry gives.
      if (failsIn(w, c)) {
        if (fit.split) clipShort ??= fit;
        continue;
      }
      clipShort = fit;
    }
    if (clipShort) {
      if (clipShort.split) rests.push(kept.splice(clipShort.at + 1));
      else left.push({ pic: kept.splice(clipShort.at, 1)[0], code: "cut-clip-short", clip: clipShort.clip });
      continue;
    }
    if (unlaid) {
      left.push({ pic: kept.splice(unlaid.at, 1)[0], code: unlaid.code, ...(unlaid.clip ? { clip: unlaid.clip } : {}) });
      continue;
    }
    const bare = tries.at(-1);
    const plain = timePictures(kept, bare);
    const short = plain.findIndex((w) => w.out - w.in < least);
    if (short >= 0) {
      left.push({ pic: kept.splice(short, 1)[0], code: "cut-too-short" });
      continue;
    }
    const span = spanOf(plain);
    const code = windowFails(span, least, bare);
    const conflict = code === "cut-too-close" ? ctx.placed.find((p) => tooClose(span, p)) : null;
    const before = code === "cut-too-early" || (code === "cut-first-last-line" && span.in < ctx.first.to) || (conflict && conflict.in <= span.in);
    left.push({ pic: kept.splice(before ? 0 : kept.length - 1, 1)[0], code });
  }
  return { pictures: [], left, rests };
}

/**
 * Each picture's window held to its clip (CUTAWAY_BROLL_CLIP; one whose clip was not probed, or a window of no frames,
 * keeps its window), before laidRunFails judges the run as it plays:
 * 1. the clip covers its window at 1.5x: as timed;
 * 2. else it plays slower, at cutawayClipSpeed, 1.0x at the least;
 * 3. else the last picture of its run, or a shot alone, ends where its clip does (at 1.0x, its out not snapped), when
 *    that leaves it its floor (`least`), and never 1 to `snapFrames` frames before a picture cut (clearOfCuts: it ends
 *    earlier still, with that many frames of the take and one more before the cut). A picture in a chain cannot end
 *    early: the next comes in on its own word, and the take would show between them. The run is broken after it instead
 *    (as for pictures more than `burstChainFrames` apart, each side a run of its own), when both sides hold every rule
 *    whole: the side before it, this picture last and held to its clip, and the side after it, against what is laid and
 *    the side before it;
 * 4. else it is left out, `cut-clip-short`, with the clip's frames and the window's.
 * Returns the windows, each with its `playSpeed` when that is not 1.5x, or the first picture whose clip does not cover
 * it (`at`), with `split` when the run breaks after it.
 */
function clipFitOf(kept, w, least, ctx) {
  const T = CUTAWAY_TIMING;
  const C = CUTAWAY_BROLL_CLIP;
  const fitted = [];
  for (const [k, pic] of kept.entries()) {
    const { fileFrames } = pic.item;
    const frames = w[k].out - w[k].in;
    // A window of no frames is the rules' to leave out (cut-too-short): it is never lengthened to its clip.
    if (fileFrames === undefined || !(frames > 0)) {
      fitted.push(w[k]);
      continue;
    }
    const speed = cutawayClipSpeed(fileFrames, frames);
    if (speed !== null) {
      // The last of a run whose clip covers its window but could not reach a picture cut 1 to `snapFrames` frames after
      // it ends clear of that cut, as one its clip cuts short does, when that keeps its floor (else laidRunFails leaves
      // it out). A sliver its clip could close is the snap's to take or leave.
      const cut = k === kept.length - 1 ? sliverCutAfter(w[k].out, ctx) : undefined;
      if (cut !== undefined && cutawayClipSpeed(fileFrames, cut - w[k].in) === null) {
        const out = clearOfCuts(w[k].out, ctx);
        const cleared = out - w[k].in >= least ? cutawayClipSpeed(fileFrames, out - w[k].in) : null;
        if (cleared !== null) {
          const inOnly = w[k].snapped?.in !== undefined ? { snapped: { in: w[k].snapped.in } } : {};
          fitted.push({ in: w[k].in, out, ...inOnly, ...(cleared === C.playSpeed ? {} : { playSpeed: cleared }) });
          continue;
        }
      }
      fitted.push(speed === C.playSpeed ? w[k] : { ...w[k], playSpeed: speed });
      continue;
    }
    const most = cutawayClipMostFrames(fileFrames);
    const clip = { clipFrames: fileFrames, windowFrames: frames };
    if (k === kept.length - 1) {
      // A snap only lengthens an out, so the window with its out where it was before the snap holds every rule the
      // snapped one does (its raw edges are the ones the gap is read from). When the clip covers that, the picture keeps
      // it; it is never made longer than it: past its line, past `brollMaxFrames`, or nearer the next item.
      // Its out, wherever the clip ends it, keeps clear of a picture cut it could not snap onto (clearOfCuts).
      const inOnly = w[k].snapped?.in !== undefined ? { snapped: { in: w[k].snapped.in } } : {};
      const rawOut = w[k].snapped?.out;
      if (rawOut !== undefined && w[k].in + most >= rawOut) {
        const out = clearOfCuts(rawOut, ctx);
        const bare = cutawayClipSpeed(fileFrames, out - w[k].in);
        if (bare === null || out - w[k].in < least) return { at: k, clip };
        fitted.push({ in: w[k].in, out, ...inOnly, ...(bare === C.playSpeed ? {} : { playSpeed: bare }) });
        continue;
      }
      const out = clearOfCuts(w[k].in + most, ctx);
      if (out - w[k].in < least) return { at: k, clip };
      const speed = cutawayClipSpeed(fileFrames, out - w[k].in) ?? C.slowest;
      fitted.push({ in: w[k].in, out, ...inOnly, ...(speed === C.playSpeed ? {} : { playSpeed: speed }) });
      continue;
    }
    // A chain broken after this picture: both sides are runs of their own, and each is checked whole before the break is
    // taken. The side before it, this picture last, with its clip held to its window as above, keeps every rule; the
    // side after it, timed as a run with its own first in, keeps its floors and every rule against what is laid and the
    // side before it (the gap between them among them). Its clips are held when it is timed, by these same rules.
    const before = kept.slice(0, k + 1);
    const beforeLeast = before.length === 1 ? T.brollMinFrames : T.burstMinFrames;
    const beforeTimed = timePictures(before, ctx);
    const beforeFit = clipFitOf(before, beforeTimed, beforeLeast, ctx);
    const beforeHolds = Boolean(beforeFit.windows) && !laidRunFails(before, beforeTimed, beforeFit.windows, beforeLeast, ctx);
    let afterHolds = false;
    if (beforeHolds) {
      // The side before as it would be laid, with where each of its edges was before a snap (the gap is read from them).
      const first = beforeFit.windows[0];
      const last = beforeFit.windows.at(-1);
      const moved = { ...(first.snapped?.in !== undefined ? { in: first.snapped.in } : {}), ...(last.snapped?.out !== undefined ? { out: last.snapped.out } : {}) };
      const laidBefore = { in: first.in, out: last.out, ...(Object.keys(moved).length > 0 ? { snapped: moved } : {}) };
      const afterCtx = { ...ctx, placed: [...ctx.placed, laidBefore] };
      // Its clips held as they will be when it is timed: a picture of it its own clip leaves out is out of it either way,
      // so the rest is checked without it (none left, the break holds); one its clip breaks again is checked as timed.
      const after = kept.slice(k + 1);
      for (;;) {
        if (after.length === 0) {
          afterHolds = true;
          break;
        }
        const afterLeast = after.length === 1 ? T.brollMinFrames : T.burstMinFrames;
        const afterTimed = timePictures(after, afterCtx);
        const afterFit = clipFitOf(after, afterTimed, afterLeast, afterCtx);
        if (!afterFit.windows && !afterFit.split) {
          after.splice(afterFit.at, 1);
          continue;
        }
        afterHolds = !laidRunFails(after, afterTimed, afterFit.windows ?? afterTimed, afterLeast, afterCtx);
        break;
      }
    }
    return { at: k, clip, ...(afterHolds ? { split: true } : {}) };
  }
  return { windows: fitted };
}

/**
 * The picture cut of the film (a take or pause join, the in of an item laid, where the end card or the words over the
 * last shot begin) that falls 1 to `snapFrames` frames after `out`, or undefined: the take would show for that sliver
 * before the cut.
 */
function sliverCutAfter(out, ctx) {
  const cuts = [...ctx.cuts, ...ctx.placed.map((p) => p.in), ...(Number.isFinite(ctx.stop) ? [ctx.stop] : [])];
  return cuts.find((c) => c - out >= 1 && c - out <= CUTAWAY_TIMING.snapFrames);
}

/**
 * The out of a picture its clip ends early, moved earlier while a picture cut falls 1 to `snapFrames` frames after it
 * (sliverCutAfter): a snap cannot close that sliver of the take, since the clip has no more frames, so `snapFrames` + 1
 * frames of the take or more show before the cut instead.
 */
function clearOfCuts(out, ctx) {
  let at = out;
  for (let near = sliverCutAfter(at, ctx); near !== undefined; near = sliverCutAfter(at, ctx)) at = near - CUTAWAY_TIMING.snapFrames - 1;
  return at;
}

/**
 * The one check a run of b-roll passes before it is laid (timeUnit, and each side of a run clipFitOf breaks), whatever
 * branch timed it: `fitted`, its windows as their clips play them, against `timed`, the windows its timing gave.
 * - Each keeps its timed in and is never longer than its timed window: a clip only shortens one, and only the last of
 *   a run, so the run stays back to back (its bounds, the most frames and its line's end, are its timing's).
 * - Every picture keeps its floor (`least`) and the run's span every window rule (windowFails: the first and last line,
 *   the floor of the film, the end, the gap to every item laid).
 * - Its out is not 1 to `snapFrames` frames before a picture cut its clip could not reach (sliverCutAfter): the take
 *   would show there and no snap could close it. A sliver a clip could close is the snap's to take or leave (0.6: the
 *   snap is optional and never costs a shot).
 * Returns the picture it fails on (`at`) and its code, with the clip's frames for `cut-clip-short`, or null.
 */
function laidRunFails(kept, timed, fitted, least, ctx) {
  const clipOf = (k) => ({ clipFrames: kept[k].item.fileFrames, windowFrames: timed[k].out - timed[k].in });
  const last = fitted.length - 1;
  for (const [k, f] of fitted.entries()) {
    const asTimed = f.in === timed[k].in && (k === last ? f.out <= timed[k].out : f.out === timed[k].out);
    const shortened = f.out !== timed[k].out;
    if (!asTimed || (shortened && f.out - f.in < least)) return { at: k, code: "cut-clip-short", clip: clipOf(k) };
    if (f.out - f.in < least) return { at: k, code: "cut-too-short" };
  }
  // Only the last out can have moved, and only earlier: a rule the span newly fails is about that picture.
  const code = windowFails(spanOf(fitted), least, ctx);
  if (code) return { at: last, code };
  const cut = sliverCutAfter(fitted[last].out, ctx);
  const { fileFrames } = kept[last].item;
  if (cut !== undefined && fileFrames !== undefined && cutawayClipSpeed(fileFrames, cut - fitted[last].in) === null) {
    return { at: last, code: "cut-clip-short", clip: clipOf(last) };
  }
  return null;
}

/** An item as the track lays it. */
function laidOf(pic, w, whoosh) {
  const { item, row } = pic;
  return {
    n: item.n, key: item.key, template: item.template, family: item.family, track: item.track, frame: item.frame,
    ...(item.file ? { file: item.file } : {}),
    in: w.in, out: w.out, word: pic.word,
    ...(row.guessed ? { guessed: true } : {}),
    ...(item.burst ? { burst: item.burst } : {}),
    whoosh,
    ...(w.snapped ? { snapped: w.snapped } : {}),
    ...(w.playSpeed !== undefined ? { playSpeed: w.playSpeed } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------- the layouts

/**
 * The layouts this cut lays: `full`, `split` (first-cut.mjs splitLayout, the shot on top), `speakerTop` (the same split
 * the other way up, CUTAWAY_SPEAKER_TOP) and `corner` (the shot full frame, the speaker small, CUTAWAY_CORNER).
 */
export const CUTAWAY_LAID_FRAMES = Object.freeze(["full", "split", "speakerTop", "corner"]);

/**
 * The one place a frame item's layout is chosen (plan 4.7, "Layouts", and 0.10): the layout it asked for when the cut
 * lays it and its take's face was found (`face`, the take's box on the film, or null); else full screen, with `asked`
 * and the reason: `insert` (the insert is always full screen), `not-laid` (a frame this cut does not know) or `no-face`
 * (a crop could cut the head off, as dev lays a split shot). A run of a burst keeps one layout (oneLayoutPerRun).
 * A face box narrower or shorter than CUTAWAY_FACE_MIN counts as none: on the film it is a sliver (zoomedFaceBox
 * clamps a face a zoom pushes past the frame to its edge), with no face to frame the person around.
 */
export function cutawayLayoutOf(frame, face, track = "broll") {
  if (frame === "full") return { layout: "full" };
  if (track === "insert") return { layout: "full", asked: frame, why: "insert" };
  if (!CUTAWAY_LAID_FRAMES.includes(frame)) return { layout: "full", asked: frame, why: "not-laid" };
  if (!face || !(face.right - face.left >= CUTAWAY_FACE_MIN) || !(face.bottom - face.top >= CUTAWAY_FACE_MIN)) return { layout: "full", asked: frame, why: "no-face" };
  return { layout: frame };
}

/** The least a face box on the film must span, as a part of the width and of the height, to frame the person round it. */
export const CUTAWAY_FACE_MIN = 0.02;

/** The fields of a layout other than full screen, which a picture laid full screen after all does not keep. */
const LAYOUT_FIELDS = ["split", "corner", "faced", "captionBand", "captionsHow", "captionMoves", "captionKeeps", "captionsFit", "pictureFills"];

/**
 * The most of her part of a `split` or `speakerTop` layout that may be the blurred margin (the canvas filled past the
 * frame's edge, first-cut.mjs splitLayout), as a share of her crop's width. Over it the shot is laid full screen
 * (cutawayFillShare, oneLayoutPerRun). Set on one real take and two lab films (Nov 24): the Guided One-take run's
 * close selfie, whose face reaches the frame's right edge, has 0.28 of her half filled there, a smeared copy of her own
 * face, and looks worse than the shot alone; Smooche's take 2 (0.31 filled, in two even bands clear of her face) and
 * FurLife's split (0.375, today's split crop widened to the canvas) look right, so only fill beside her face counts.
 */
export const CUTAWAY_FILL_MAX = 0.15;

/** How near the frame's edge her face box must reach for the fill on that side to count, as a share of the width. */
export const CUTAWAY_FILL_EDGE = 0.02;

/**
 * The share of her crop that is fill beside her face, for a `split` or `speakerTop` layout (splitLayout's `margin` and
 * `crop` [width, height, x, y] on the canvas the frame sits in, `margin` from its left; `face` the take's box on the
 * film the layout was made from): the crop's part past the frame's left or right edge, counted on a side only where her
 * face box reaches within CUTAWAY_FILL_EDGE of that edge, so the blurred margin there continues her own face; over the
 * crop's width. Fill on a side her face does not reach is the blurred background today's split shows, and does not
 * count. The crop is set once for the item, so the share is the same on every frame of the shot. A `corner` crop stays
 * inside the frame: none.
 */
export function cutawayFillShare(layout, W = 1080, face = null) {
  const [wc, , x0] = layout.crop;
  const left = face && face.left > CUTAWAY_FILL_EDGE ? 0 : Math.max(0, layout.margin - x0);
  const right = face && face.right < 1 - CUTAWAY_FILL_EDGE ? 0 : Math.max(0, x0 + wc - (layout.margin + W));
  return Math.round(((left + right) / wc) * 10_000) / 10_000;
}

/**
 * The frame items laid, as the units the track timed them in, in film order: a shot alone, the insert, or a run of a
 * burst, its pictures back to back (each comes in on the out of the one before). A burst whose pictures stand apart is
 * timed as runs (scheduleFrameTrack), each with its own edges and whoosh, and the take shows between them, so a run is
 * the span that holds one frame. Each unit holds the items it was given, not copies.
 */
export function cutawayUnitsOf(laid) {
  const units = [];
  const open = new Map();
  for (const p of [...laid].sort((a, b) => a.in - b.in)) {
    const run = p.burst ? open.get(p.burst) : undefined;
    if (run && Number.isFinite(p.in) && run.at(-1).out === p.in) run.push(p);
    else {
      units.push([p]);
      if (p.burst) open.set(p.burst, units.at(-1));
    }
  }
  return units;
}

/**
 * One layout for each run of a burst, and plan 0.12: a paid picture is never left out only because its captions do not
 * fit its layout.
 * - Each item laid and marked so (`captionsFit: false`) is laid full screen instead, where the captions stay where they
 *   are, with `asked` and the reason `captions`, as a take with no face box is.
 * - A run of a burst (cutawayUnitsOf) has one frame for all its pictures, so the person never blinks in and out, or
 *   jumps, inside it: a run keeps its layout (split, speakerTop or corner) only when every picture of it is laid in that
 *   one layout around the same take's face. Otherwise every picture of it not laid full screen is laid full screen too,
 *   with the reason `run` (its own captions not fitting stay `captions`).
 * - The same for a picture whose crop of her would be more fill than CUTAWAY_FILL_MAX (`pictureFills: false`), with the
 *   reason `fill` (it wins over its own `captions`); the rest of its run say `run`.
 * Another run of the same burst, with the take between them, keeps its own layout.
 */
export function oneLayoutPerRun(placed) {
  const why = new Map();
  for (const unit of cutawayUnitsOf(placed)) {
    const oneLayout = unit.every((p) => p.layout !== "full" && p.layout === unit[0].layout && p.captionsFit !== false && p.pictureFills !== false && p.take === unit[0].take);
    for (const p of unit) {
      if (p.layout === "full") continue;
      if (p.pictureFills === false) why.set(p, "fill");
      else if (p.captionsFit === false) why.set(p, "captions");
      else if (!oneLayout) why.set(p, "run");
    }
  }
  return placed.map((p) => {
    if (!why.has(p)) return p;
    const full = { ...p, layout: "full", asked: p.frame, askedWhy: why.get(p) };
    for (const field of LAYOUT_FIELDS) delete full[field];
    return full;
  });
}

/**
 * `speakerTop` (plan 4.7): today's split (first-cut.mjs splitLayout, read with these numbers
 * in place of EXTRA_SHOTS') with four changes: the person's strip on top and the shot below it; the halves equal, the
 * seam at 0.50 of the height; the face larger in her half (its top `crop.faceTop`, its bottom at most `crop.faceBottom`
 * down the crop, the app's 0.12 and 0.46); the captions on the seam (`captionsAt`), in a band `captionsHalf` each side.
 * The crop's width and the blurred margin are the app's.
 */
export const CUTAWAY_SPEAKER_TOP = Object.freeze({
  splitShare: 0.5,
  faceAt: Object.freeze([0.5, 0.4]),
  crop: Object.freeze({ widthShare: 0.72, marginShare: 0.3, faceTop: 0.1, faceBottom: 0.78 }),
  captionsAt: 0.5,
  captionsHalf: 0.04,
});

/** Where the face sits in her top half while a `speakerTop` item is on (`layout` splitLayout's), as parts of the height. */
export function speakerTopFace(face, layout, H) {
  const [, hc, , y0] = layout.crop;
  const at = (v) => Math.round(((((v * H - y0) * layout.stripH) / hc) / H) * 10_000) / 10_000;
  return { top: at(face.top), bottom: at(face.bottom) };
}

/**
 * `corner` (plan 4.7): the shot full frame and the speaker's own frames in
 * a plain rectangle with no border, `widthShare` of the width and `heightShare` of the height (the lab's cards were
 * 0.33 tall), in the lower corner on `side`, touching the frame's edges. Her frames are cropped round the face: the crop
 * `faceWidths` face widths wide, of the box's shape, the face's top `faceTop` down it; taller when the face would pass
 * `faceBottom` of it; inside the frame. Never narrower than half the box (`minScale`, so her frames are scaled up 2x
 * at most): a face box on the film can be a sliver (zoomedFaceBox clamps a face cut off by a zoom to the frame's edge),
 * and a crop of a few pixels, or none, would be a smear or an ffmpeg error.
 */
export const CUTAWAY_CORNER = Object.freeze({ widthShare: 0.37, heightShare: 0.33, side: "right", faceWidths: 1.5, faceTop: 0.08, faceBottom: 0.75, minScale: 0.5 });

const evenDown = (v) => Math.floor(v / 2) * 2;

/**
 * A `corner` item's frame, in pixels of the film: `box` [x, y, width, height] where her rectangle is laid, and `crop`
 * [width, height, x, y] of the film's frame scaled into it. `face` is the take's box on the film (parts of the frame).
 */
export function cornerLayout(face, W, H) {
  const C = CUTAWAY_CORNER;
  const bw = evenDown(W * C.widthShare + 1);
  const bh = evenDown(H * C.heightShare + 1);
  const box = [C.side === "right" ? W - bw : 0, H - bh, bw, bh];
  const shape = bw / bh;
  const faceW = (face.right - face.left) * W;
  const faceH = (face.bottom - face.top) * H;
  const wide = Math.max(C.faceWidths * faceW, (faceH / (C.faceBottom - C.faceTop)) * shape, C.minScale * bw);
  const wc = evenDown(Math.min(wide, W, H * shape));
  const hc = evenDown(Math.min(H, wc / shape));
  const x0 = Math.round(Math.min(Math.max(((face.left + face.right) / 2) * W - wc / 2, 0), W - wc));
  const y0 = Math.round(Math.min(Math.max(face.top * H - C.faceTop * hc, 0), H - hc));
  return { box, crop: [wc, hc, x0, y0] };
}

/**
 * Where the caption screens shown over a `speakerTop` or `corner` item sit while the item is on (plan 4.7, "Layouts").
 * A screen is moved only for the frames of the item (cutawayCaptionPieces): outside them it stays in its own place, so
 * only her part of the layout matters here. Each screen of `over`: `band` [top, bottom] where it sits now.
 * `shareAt(screen, centre)`: its drawn height centred there, `clear` the room kept from a face (first-cut.mjs
 * FACE_CLEAR_SHARE), all parts of the height.
 * - `speakerTop`: every screen on the seam, clear of her face in her top half (`face`, speakerTopFace's);
 * - `corner`: a screen clear of her rectangle (`top`, its top) stays where it is, else it sits just above it.
 * Returns each screen moved with its band, each screen a corner item keeps where it is (`keeps`), `how` ("seam" or
 * "above"), and `fits` false when one cannot be placed so: then the item is laid full screen and the captions stay (plan
 * 0.12, oneLayoutPerRun).
 */
export function cutawayCaptionPlace(layout, { face = null, top = null, over, shareAt, clear }) {
  const half = CUTAWAY_SPEAKER_TOP.captionsHalf;
  const round4 = (v) => Math.round(v * 10_000) / 10_000;
  const bandAt = (centre) => [round4(centre - half), round4(centre + half)];
  const moves = [];
  const keeps = [];
  let fits = true;
  for (const screen of over) {
    let centre;
    let share;
    if (layout === "speakerTop") {
      centre = CUTAWAY_SPEAKER_TOP.captionsAt;
      share = shareAt(screen, centre);
      if (face && centre - share / 2 - clear < face.bottom) fits = false;
    } else {
      const now = (screen.band[0] + screen.band[1]) / 2;
      if (now + shareAt(screen, now) / 2 + clear <= top) {
        keeps.push({ screen, band: screen.band });
        continue;
      }
      share = shareAt(screen, top - clear - shareAt(screen, now) / 2);
      centre = top - clear - share / 2;
      if (centre - share / 2 < 0) fits = false;
    }
    moves.push({ screen, band: bandAt(centre) });
  }
  return { moves, keeps, how: layout === "speakerTop" ? "seam" : "above", fits };
}

/**
 * The frames a caption screen shows on, as the burn draws it (editAss): frame f when its start (`startCs`,
 * centiseconds) is at or before f/24 and its end (`endCs`) is after f/24. `first` is its first frame, `last` the first
 * frame after it.
 */
export function cutawayScreenFrames(startCs, endCs) {
  return { first: Math.ceil((startCs * CUTAWAY_FPS) / 100 - 1e-9), last: Math.ceil((endCs * CUTAWAY_FPS) / 100 - 1e-9) };
}

/**
 * A caption screen is split at a frame item's edges (plan 0.40): while the item is on, the screen sits where
 * the item's layout puts it; on its other frames, in its own place. Its words and their times do not change, and the
 * picture cut hides the jump. `screens`: the caption screens in burn order (times `s`, `e` on the cut's clock before
 * the speed step), each with `first` and `last` (cutawayScreenFrames). `windows`: each a screen's place over one item,
 * `{ s, e, from, to, band }` (the screen by its `s` and `e`; frames `from` to `to`, exclusive, of the finished film).
 * Returns the screens to burn, each whole or in pieces in time order, every piece the screen with its own `s`, `e` and
 * `band`: a piece's edge is the item's frame, `f / 24 * speed`, so editAss starts the next piece on that frame exactly.
 * Two windows that touch with one band make one piece. A screen with no window is returned as it was.
 */
export function cutawayCaptionPieces(screens, windows, speed = 1) {
  return screens.flatMap(({ first, last, ...c }) => {
    const mine = windows
      .filter((w) => w.s === c.s && w.e === c.e)
      .map((w) => ({ from: Math.max(first, w.from), to: Math.min(last, w.to), band: w.band }))
      .filter((w) => w.to > w.from)
      .sort((a, b) => a.from - b.from);
    if (mine.length === 0) return [c];
    const own = c.band;
    const spans = [];
    let at = first;
    // Items never overlap on the film; should two windows, the later one starts where the earlier ends, so no frame is
    // drawn twice and no piece runs backwards.
    for (const w of mine) {
      if (w.to <= at) continue;
      if (w.from > at) spans.push({ from: at, to: w.from, band: own });
      spans.push({ ...w, from: Math.max(w.from, at) });
      at = w.to;
    }
    if (at < last) spans.push({ from: at, to: last, band: own });
    const same = (a, b) => (a === b) || (Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1]);
    const joined = spans.reduce((out, sp) => {
      const prev = out.at(-1);
      if (prev && prev.to === sp.from && same(prev.band, sp.band)) prev.to = sp.to;
      else out.push({ ...sp });
      return out;
    }, []);
    const timeOf = (f) => (f / CUTAWAY_FPS) * speed;
    return joined.map((sp, k) => {
      const piece = { ...c, s: k === 0 ? c.s : timeOf(sp.from), e: k === joined.length - 1 ? c.e : timeOf(sp.to) };
      if (sp.band === undefined) delete piece.band;
      else piece.band = sp.band;
      return piece;
    });
  });
}
