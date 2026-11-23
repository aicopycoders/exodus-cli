// B-roll, inserts and overlays in a One-take film (copy-coders docs/port/broll-in-app/PLAN.md, version 7, 4.7 and
// 0.2): what the cut reads of the manifest's `oneTakeCutaways` and where each item goes, in numbers only.
//
// A later part has the worker write the key (scout auto-cut.ts) from the run's approved plan: each kept item as the
// plan holds it (video/lib/cutawayPlan.ts CutawayItem), a paid item with its file in the folder. This part only reads
// it: first-cut.mjs does not call this file yet, and laying the items and writing `pace.cutaways` come in later parts.
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
