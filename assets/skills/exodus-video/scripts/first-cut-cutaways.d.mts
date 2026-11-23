// The types of first-cut-cutaways.mjs: b-roll, inserts and overlays in a One-take film (copy-coders
// docs/port/broll-in-app/PLAN.md, version 7, 4.7 and 0.2). Kept loose of the app's own types (video/lib/cutawayPlan.ts),
// as the rest of the cut's are: the shapes are checked against them in exodus/__tests__/first-cut-cutaways.test.ts.

export const CUTAWAYS_KEY: "oneTakeCutaways";
export const CUTAWAYS_VERSION: 1;
export const CUTAWAY_FPS: 24;
/** The one way a time (seconds of the finished film) becomes a frame: the nearest one. */
export function cutawayFrame(sec: number): number;

export type CutawayTrack = "broll" | "insert" | "drawn";
export const CUTAWAY_TRACKS: Readonly<Record<string, CutawayTrack>>;
export type CutawayCutFrame = "full" | "split" | "speakerTop" | "corner";
export const CUTAWAY_FRAMES: readonly CutawayCutFrame[];

export type CutawayCutCode =
  | "cut-unread" | "cut-version" | "cut-both-keys" | "cut-staged-text" | "cut-mapped" | "cut-template"
  | "cut-no-file" | "cut-file-unreadable" | "cut-insert-short"
  | "cut-line-not-heard" | "cut-word-not-found"
  | "cut-first-last-line" | "cut-too-early" | "cut-too-close" | "cut-too-short" | "cut-end"
  | "cut-captions-no-fit"
  | "cut-drawn-later";
export const CUTAWAY_CUT_CODES: readonly CutawayCutCode[];

/**
 * The manifest's `oneTakeCutaways`, version 1, as the worker writes it (scout auto-cut.ts writeOneTakeCutaways, PR 9 of
 * the plan): the approved plan's id, its kept items as the plan holds them (video/lib/cutawayPlan.ts CutawayItem), each
 * paid item with its file in the cut's folder, and the whoosh.
 */
export interface OneTakeCutawaysManifest {
  version: 1;
  /** The approved plan's id (64 hex characters). */
  planId: string;
  /** The whoosh laid once on each frame item (a b-roll shot, a burst's first picture, the insert): a file of the folder. */
  whoosh?: string;
  items: OneTakeCutawayManifestItem[];
}

export interface OneTakeCutawayManifestItem {
  /** 1 up, in spoken order, as the plan numbers it. */
  n: number;
  /** The item's key in the plan (64 hex characters). */
  key: string;
  family: "broll" | "insert" | "overlay";
  template: string;
  /** The word that brings it in: its line, the word, and which time the line says it (1 first). */
  at: { lineId: string; word: string; nth: number };
  /** A b-roll shot and the insert: the layout. */
  frame?: CutawayCutFrame;
  /** A paid item (b-roll, insert, sticker): its file of the folder, a plain name. Absent: not made. */
  file?: string;
  /** A b-roll picture of burst 1 or 2 (plan 0.2). */
  burst?: 1 | 2;
  /** A drawn item's own fields, as the plan holds them, for the drawn track (PR 8); the cut carries them unread. */
  subject?: unknown;
  text?: unknown;
  words?: unknown;
  points?: unknown;
  emoji?: unknown;
  arrow?: unknown;
  /** Any other field of the plan's item (`action`, `slot`) is not read by the cut. */
  [field: string]: unknown;
}

/** One item of the key as the cut read it. */
export interface CutawayCutItem {
  n: number;
  key: string;
  family: "broll" | "insert" | "overlay";
  template: string;
  track: CutawayTrack;
  at: { lineId: string; word: string; nth: number };
  frame?: CutawayCutFrame;
  file?: string;
  burst?: 1 | 2;
  subject?: unknown;
  text?: unknown;
  words?: unknown;
  points?: unknown;
  emoji?: unknown;
  arrow?: unknown;
}

/** An item the cut left out, and why. */
export interface CutawayCutLeft {
  n?: number;
  key?: string;
  template?: string;
  code: CutawayCutCode;
}

export interface CutawaysRead {
  /** The key's version, null when it has none that reads. */
  version: number | null;
  planId: string | null;
  whoosh?: string;
  items: CutawayCutItem[];
  left: CutawayCutLeft[];
  /** The whole key is not laid, and why. */
  refused?: CutawayCutCode;
}

/** A line id's one shape, `take-<n>-line-<m>`, and an anchor word's most characters (video/lib/cutawayPlan.ts). */
export const CUTAWAY_LINE_ID: RegExp;
export const CUTAWAY_ANCHOR_WORD_MAX_CHARS: number;
/** Whether the cut refuses the whole key, and why; null when it is laid. */
export function cutawaysRefusalOf(gate?: {
  bothKeys?: boolean; stagedText?: boolean; mapped?: boolean; template?: boolean; read?: CutawaysRead | null;
}): CutawayCutCode | null;
/** A word as the shots match it: lower case, its ends' punctuation off. */
export function cutawayWord(word: unknown): string;
/** The manifest's `oneTakeCutaways` as the cut reads it, or null when the manifest does not hold the key. */
export function cutawaysOf(manifest: unknown): CutawaysRead | null;
/** The row an item comes in on: the `nth` row of its line whose word matches, or the code why there is none. */
export function cutawayAnchorOf(
  at: { lineId: string; word: string; nth: number },
  rows: readonly { text: string; lineId?: string }[],
): { index: number } | { code: "cut-line-not-heard" | "cut-word-not-found" };
