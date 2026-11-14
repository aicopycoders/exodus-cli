/** COP-300: two sync checks on a finished cut, in numbers only (first-cut-sync.mjs). */

/** Check A's limit: the finished sound and picture end at most this far apart. */
export const SOUND_PICTURE_LIMIT_MS: number;
/** Check B's default limits. */
export const CAPTION_SYNC_LIMITS: Readonly<CaptionSyncLimits>;
/** A section is judged on at least this many paired captions. */
export const MIN_SECTION_CAPTIONS: number;

export interface CaptionSyncLimits {
  /** The most a section's median offset may be, either way, in ms. */
  sectionMs: number;
  /** The most the median offset may grow from the first judged section to the last, in ms. */
  growthMs: number;
}

/** A caption and the time it is first seen in the finished film. */
export interface SeenCaption {
  text: string;
  seenSec: number;
}

/** A word of the finished film and when it starts (and ends) there. */
export interface HeardWord {
  text: string;
  start: number;
  end?: number;
}

export interface SyncSection {
  id: number | string;
  startSec: number;
  endSec: number;
}

/**
 * Check B's verdict, each section judged on its median offset. `pass` covers the judged sections and is null when none
 * was judged; `unjudged` names the sections that hold captions but too few paired ones to judge.
 */
export interface CaptionSyncVerdict {
  pass: boolean | null;
  worstMs: number | null;
  worstSection: number | string | null;
  growthMs: number | null;
  judged: Array<number | string>;
  unjudged: Array<number | string>;
  limits: CaptionSyncLimits;
  captions: number;
  paired: number;
  sections: Array<{ id: number | string; captions: number; n: number; judged: boolean; meanMs: number | null; medianMs: number | null }>;
  rows: Array<{ text: string; seenSec: number; heardSec: number; offsetMs: number }>;
}

/** Check A's numbers: the film's frames against its decoded sound samples. */
export interface SoundPictureCheck {
  frames: number;
  fps: number;
  pictureSec: number;
  samples: number;
  sampleRate: number;
  soundSec: number;
  soundMinusPictureMs: number;
  limitMs: number;
  pass: boolean;
}

export function wordKey(text: string): string;
export function alignWords(a: readonly string[], b: readonly string[]): Array<[number, number]>;
export function captionSync(args: {
  captions: readonly SeenCaption[];
  heard: readonly HeardWord[];
  sections: readonly SyncSection[];
  limits?: CaptionSyncLimits;
  minCaptions?: number;
}): CaptionSyncVerdict;
export function soundPictureCheck(file: string, options?: { limitMs?: number }): SoundPictureCheck | null;
export function placementHeard(args: {
  film: string;
  speed?: number;
  takes: ReadonlyArray<{ file: string; heard: readonly HeardWord[]; words: readonly HeardWord[] }>;
}): Array<{ text: string; start: number; end: number; lagMs: number; match: number }>;
export function retimeWords<T extends { text: string; start: number; end: number }>(rows: readonly T[], heard: readonly HeardWord[], speed?: number): T[];
