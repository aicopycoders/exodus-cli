// #2988: the types of the exports the Trigger worker calls. The script is
// plain JS so the CLI can run it with `node` and no build.

export class FirstCutError extends Error {
  constructor(code: 1 | 2, message: string);
  readonly code: 1 | 2;
}

export interface FirstCutOptions {
  /** A folder written by `exodus video pull`. */
  dir: string;
  /** Defaults to <dir>/cut.mp4. */
  out?: string;
  skip?: Set<number>;
  /** The music bed, when the pull has one. Defaults to on, as the CLI does. */
  music?: boolean;
  /** #3365: hold a scene's keyframe where it has no clip, instead of refusing. Defaults to off. */
  stillFill?: boolean;
}

export interface FirstCut {
  out: string;
  durationSec: number;
  /** The music file the cut used, or null. */
  music: string | null;
  timeline: { spine: Array<{ sceneIndex: number }>; left: string[] };
}

export function firstCut(options: FirstCutOptions): FirstCut;

/** #3365: the scenes the cut cannot be made without, by number. */
export function scenesWithNoClip(options: {
  manifest: { scenes?: Array<{ sceneIndex: number; clip: string | null }> } | null;
  storyboard: unknown;
  skip: Set<number>;
  exists?: (file: string | null) => boolean;
}): number[];

/** #3424: the sentence-gap cut, which scout's scribe.ts sentenceGapCuts mirrors. */
export function sentenceGapCuts(
  words: Array<{ w: string; s: number; e: number }>,
  lines: Array<{ text: string; asksPause: boolean; cuesBeat: boolean }>,
  levels?: { windowSec: number; db: number[] } | null,
): Array<{ s: number; e: number; after: string; gap: number; kept: number; sound: boolean }>;
