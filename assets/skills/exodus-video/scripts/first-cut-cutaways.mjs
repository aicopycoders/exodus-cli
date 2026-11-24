// B-roll, inserts and overlays in a One-take film (copy-coders docs/port/broll-in-app/PLAN.md, version 7, 4.7 and
// 0.2): what the cut reads of the manifest's `oneTakeCutaways` and where each item goes, in numbers only.
//
// A later part has the worker write the key (scout auto-cut.ts) from the run's approved plan: each kept item as the
// plan holds it (video/lib/cutawayPlan.ts CutawayItem), a paid item with its file in the folder. This file reads
// it and times its frame items (scheduleFrameTrack): first-cut.mjs does not call this file yet, and laying the items and
// writing `pace.cutaways` come in later parts.
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
  // Its word (cutawayAnchorOf).
  "cut-line-not-heard",
  "cut-word-not-found",
  // Its window (scheduleFrameTrack).
  "cut-first-last-line",
  "cut-too-early",
  "cut-too-close",
  "cut-too-short",
  "cut-end",
  // Its layout.
  "cut-captions-no-fit",
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
 *   of the cut; the insert carries `fileFrames`, its file's length in frames, when it was probed;
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
  const leave = (item, code) => left.push({ n: item.n, key: item.key, template: item.template, code });
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
  // A burst whose pictures stand apart is timed as runs, each its own unit, in spoken order with the rest.
  const queue = unitsOf(anchored.filter((p) => p.item.track === "broll"));
  while (queue.length > 0) {
    const { pictures, left: out, rests } = timeUnit(queue.shift(), ctx);
    for (const { pic, code } of out) leave(pic.item, code);
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
    for (const c of tries) {
      const w = c === ctx ? windows : timePictures(kept, c);
      if (!failsIn(w, c)) return { pictures: kept.map((pic, k) => laidOf(pic, w[k], k === 0)), left, rests };
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
  };
}
