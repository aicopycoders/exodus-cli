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
  | "cut-no-file" | "cut-file-unreadable" | "cut-insert-short" | "cut-clip-short"
  | "cut-line-not-heard" | "cut-word-not-found"
  | "cut-first-last-line" | "cut-too-early" | "cut-too-close" | "cut-too-short" | "cut-end" | "cut-near-cut"
  | "cut-drawn-later"
  | "cut-drawn-overlap" | "cut-drawn-no-face" | "cut-drawn-no-place" | "cut-drawn-no-filter" | "cut-drawn-no-font"
  | "cut-words-unprintable" | "cut-words-wide" | "cut-chart-number" | "cut-sticker-no-filter";
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
  /** `cut-clip-short`: the clip's frames, and the frames of the window it could not cover. */
  clipFrames?: number;
  windowFrames?: number;
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

/** Luke's timing lock and the bursts, in whole frames of the finished film. */
export const CUTAWAY_TIMING: Readonly<{
  leadFrames: number; brollMinFrames: number; brollMaxFrames: number; snapFrames: number; gapFrames: number;
  notBeforeFrame: number; burstMinFrames: number; burstChainFrames: number;
}>;
/** The insert's clip: from its first frame at 1.0x, with no zoom. */
export const CUTAWAY_INSERT_CLIP: Readonly<{ fromSec: number; playSpeed: number }>;
/** A b-roll clip: from `fromSec` at `playSpeed` (today's extra shots'), slower down to `slowest` when it is too short. */
export const CUTAWAY_BROLL_CLIP: Readonly<{ fromSec: number; playSpeed: number; slowest: number }>;
/** The speed a b-roll clip of `fileFrames` frames plays at to cover `frames` frames of film, or null when even the slowest does not. */
export function cutawayClipSpeed(fileFrames: number, frames: number): number | null;
/** The most frames of film a b-roll clip of `fileFrames` frames covers, at its slowest speed. */
export function cutawayClipMostFrames(fileFrames: number): number;

/** A line of the film, from its first word's first frame to its last word's last. */
export interface CutawayLine {
  lineId: string;
  from: number;
  to: number;
}
export function cutawayLinesOf(rows: readonly { start: number; end: number; lineId: string }[]): CutawayLine[];

/** A frame item as the track lays it: its window from `in` (its first frame) to `out` (the frame after its last). */
export interface CutawayLaid {
  n: number;
  key: string;
  template: string;
  family: "broll" | "insert";
  track: "broll" | "insert";
  /** The layout it asked for. */
  frame: CutawayCutFrame;
  file?: string;
  in: number;
  out: number;
  /** Its word's first frame. */
  word: number;
  /** Its word was not heard, and takes the time the script gives it between its neighbours. */
  guessed?: true;
  burst?: 1 | 2;
  /** The whoosh comes in on it: a shot, the insert, the first picture of each run of a burst (its pictures back to back). */
  whoosh: boolean;
  /** Where an edge was before it moved onto a picture cut. */
  snapped?: { in?: number; out?: number };
  /** A b-roll clip's speed when it is not the usual 1.5x: its clip is too short for its window at that speed. */
  playSpeed?: number;
}

/**
 * A bound that is given but is not a number leaves items out, never lets one through: `filmFrames` or `stopAt` puts
 * them past the end (`cut-end`), `notBefore` before the headline's end (`cut-too-early`), an insert's `fileFrames`
 * makes its file unreadable (`cut-file-unreadable`).
 */
export function scheduleFrameTrack(
  items: readonly (CutawayCutItem & {
    /**
     * The file, in frames, when it was probed. The insert's under its window plus one frame is left out; a b-roll
     * clip's is held to its window by CUTAWAY_BROLL_CLIP (slower, shorter, or left out as `cut-clip-short`).
     */
    fileFrames?: number;
  })[],
  opts: {
    /** The film's words, in seconds of the finished film. */
    rows: readonly { text: string; start: number; end: number; lineId: string; guessed?: boolean }[];
    /** The film's lines, in frames (cutawayLinesOf, with any line no word was heard on). Default: from `rows`. */
    lines?: readonly CutawayLine[];
    /** The film's picture cuts, in seconds. */
    joins?: readonly number[];
    /** Where an opening headline ends, in seconds; none: 0 or null. */
    notBefore?: number | null;
    /** Where an end card or words over the last shot begin, in seconds; none: null. */
    stopAt?: number | null;
    /** The film's length, in frames. */
    filmFrames: number;
  },
): { laid: CutawayLaid[]; left: CutawayCutLeft[] };

export type CutawayDrawnKind = "label" | "list" | "timer" | "emoji" | "card" | "sticker";
/** How the cut times each drawn template. */
export const CUTAWAY_DRAWN_KINDS: Readonly<Record<string, CutawayDrawnKind>>;
/** Which drawn item keeps a moment two want: the higher kind stays (a card, a list or a timer, a label, a sticker, an emoji). */
export const CUTAWAY_DRAWN_RANK: Readonly<Record<CutawayDrawnKind, number>>;
/** The drawn items' windows in frames of the finished film. */
export const CUTAWAY_DRAWN_TIMING: Readonly<{ label: number; card: number; listTail: number; timer: number; emoji: number; stickerMin: number }>;
/** Where a drawn item may sit, as shares of the frame. */
export const CUTAWAY_DRAWN_PLACE: Readonly<{ gap: number; safeTop: number; safeBottom: number; side: number }>;

/** A part of the frame top to bottom, as shares of its height. */
export interface CutawayBlock {
  top: number;
  bottom: number;
  /** What it is: a caption screen (the default), her moved part of the frame, the headline, a card the storyboard draws in a box. */
  kind?: "captions" | "person" | "headline" | "card";
}
export type CutawayDrawnBand = "chin" | "captions" | "person" | "headline" | "card" | "head" | "beside-left" | "beside-right";
/** A drawn item's place, its own size first, then its smallest: with the index of the size it was found at, or null. */
export function cutawayDrawnPlaceSized(
  sizes: readonly { w: number; h: number }[],
  opts: { face: CutawayBlock & { left?: number; right?: number }; blocks?: readonly CutawayBlock[] },
  W: number,
  H: number,
): { band: CutawayDrawnBand; box: [number, number, number, number]; size: number } | null;
/**
 * The first free band for a drawn item over its whole window, then the strip beside the face, or null when none is free
 * or a size, the face or a block does not read.
 */
export function cutawayDrawnPlace(
  opts: { w: number; h: number; face: CutawayBlock & { left?: number; right?: number }; blocks?: readonly CutawayBlock[] },
  W: number,
  H: number,
): { band: CutawayDrawnBand; box: [number, number, number, number] } | null;

/** The rows a list's points come in on, or the code why one is not found. */
export function cutawayPointsOf(
  item: { points?: unknown },
  rows: readonly { text: string; lineId?: string }[],
  first: number,
): { indexes: number[] } | { code: "cut-word-not-found" };

/** A drawn item before it is placed: its window, its word's frame, its points' frames (a list). */
export interface CutawayDrawnCandidate {
  item: CutawayCutItem;
  kind: CutawayDrawnKind;
  in: number;
  out: number;
  word: number;
  points?: number[];
  guessed?: true;
  /** A sticker that goes out when the next drawn item comes in. */
  cutShort?: true;
}
/** A drawn item as the track lays it. */
export interface CutawayDrawnLaid<P = unknown> extends Omit<CutawayDrawnCandidate, "item"> {
  n: number;
  key: string;
  template: string;
  family: "broll" | "insert" | "overlay";
  track: "drawn";
  item: CutawayCutItem;
  place: P;
}
export function scheduleDrawnTrack<P = unknown>(
  items: readonly CutawayCutItem[],
  opts: {
    rows: readonly { text: string; start: number; end: number; lineId: string; guessed?: boolean }[];
    lines?: readonly CutawayLine[];
    stopAt?: number | null;
    filmFrames: number;
    kinds?: readonly CutawayDrawnKind[];
    placeOf: (candidate: CutawayDrawnCandidate) => { place: P } | { code: CutawayCutCode };
  },
): { laid: CutawayDrawnLaid<P>[]; left: CutawayCutLeft[] };

export const CUTAWAY_LAID_FRAMES: readonly CutawayCutFrame[];
/** The one place a frame item's layout is chosen: its own when laid and its take's face was found, else full screen and why. */
export function cutawayLayoutOf(
  frame: CutawayCutFrame,
  face: unknown,
  track?: "broll" | "insert",
): { layout: CutawayCutFrame; asked?: CutawayCutFrame; why?: "insert" | "no-face" | "not-laid" };
/** The frame items laid, as units in film order: a shot alone, the insert, or a run of a burst (its pictures back to back). */
export function cutawayUnitsOf<P extends { in: number; out: number; burst?: number }>(laid: readonly P[]): P[][];
/** One layout per run of a burst: an item whose captions do not fit its layout or whose picture of her would be mostly fill, and every picture of a run that is not laid whole in one layout around one take's face, laid full screen instead. */
export function oneLayoutPerRun<P extends { in: number; out: number; layout: string; frame?: string; burst?: number; take?: number | null; captionsFit?: boolean; pictureFills?: boolean }>(
  placed: readonly P[],
): (P | (P & { layout: "full"; asked?: string; askedWhy: "captions" | "fill" | "run" }))[];
/** The most of her part of a split or speakerTop layout that may be blurred margin beside her face; over it, full screen. */
export const CUTAWAY_FILL_MAX: number;
/** The share of her crop that is fill past the frame's edge on a side her face reaches (splitLayout's `margin` and `crop`). */
export function cutawayFillShare(layout: { margin: number; crop: readonly number[] }, W?: number, face?: { left: number; right: number } | null): number;
/** How near the frame's edge her face must reach for the fill on that side to count. */
export const CUTAWAY_FILL_EDGE: number;

/** A face box as parts of the frame (first-cut.mjs faceBoxOf). */
export interface CutawayFace {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
/** `speakerTop`: today's split numbers with four changes (the person on top, equal halves, her face larger, the captions on the seam). */
export const CUTAWAY_SPEAKER_TOP: Readonly<{
  splitShare: number;
  faceAt: readonly [number, number];
  crop: Readonly<{ widthShare: number; marginShare: number; faceTop: number; faceBottom: number }>;
  captionsAt: number;
  captionsHalf: number;
}>;
/** Where the face sits in her top half while a `speakerTop` item is on, as parts of the height. */
export function speakerTopFace(face: CutawayFace, layout: { stripH: number; crop: readonly number[] }, H: number): { top: number; bottom: number };
/** The least a face box on the film spans, as a part of the width and of the height, for a layout round it. */
export const CUTAWAY_FACE_MIN: number;
/** `corner`: the speaker small in a lower corner. */
export const CUTAWAY_CORNER: Readonly<{
  widthShare: number; heightShare: number; side: "left" | "right"; faceWidths: number; faceTop: number; faceBottom: number; minScale: number;
}>;
/** A `corner` item's frame in pixels: her rectangle [x, y, width, height] and the crop of the film [width, height, x, y]. */
export function cornerLayout(face: CutawayFace, W: number, H: number): { box: [number, number, number, number]; crop: [number, number, number, number] };
/** Where the caption screens shown over a `speakerTop` or `corner` item sit, and whether they fit. */
export function cutawayCaptionPlace<S extends { band: readonly number[] }>(
  layout: "speakerTop" | "corner",
  opts: {
    face?: { top: number; bottom: number } | null;
    top?: number | null;
    over: readonly S[];
    shareAt: (screen: S, centre: number) => number;
    clear: number;
  },
): { moves: { screen: S; band: [number, number] }[]; keeps: { screen: S; band: readonly number[] }[]; how: "seam" | "above"; fits: boolean };
/** The frames a caption screen shows on as the burn draws it: its first, and the first after it. */
export function cutawayScreenFrames(startCs: number, endCs: number): { first: number; last: number };
/** The caption screens to burn, each split at the frame items' edges: the layout's place while an item is on, its own place else. */
export function cutawayCaptionPieces<C extends { s: number; e: number; band?: readonly number[] }>(
  screens: readonly (C & { first: number; last: number })[],
  windows: readonly { s: number; e: number; from: number; to: number; band: readonly number[] }[],
  speed?: number,
): C[];
