// #2988: the types of the exports the Trigger worker calls. The script is
// plain JS so the CLI can run it with `node` and no build.

export class FirstCutError extends Error {
  constructor(code: 1 | 2, message: string);
  readonly code: 1 | 2;
}

/** The finished cut's true peak is over -1 dBTP, or could not be measured, after the loudness pass. */
export class LoudnessRefusal extends FirstCutError {
  constructor(message: string, measured: { i: number; tp: number } | null);
  readonly measured: { i: number; tp: number } | null;
}

/** The pace record first-cut writes beside the cut when a finishing setting is on. */
export interface CutPace {
  seconds: { ours: number; source: number | null; ratio: number | null };
  speed: number;
  cutsPerMin: { ours: number; source: number | null };
  meanShotSec: { ours: number | null; source: number | null };
  longestShotSec: { ours: number; source: number | null };
  over4s: { ours: number; source: number | null };
  wordsPerMin: { ours: number | null; source: number | null };
  deadAir: { over03s: number; longestSec: number };
  /** The settings the cut was made with, from the manifest's `finishing`. */
  finishing: {
    cutPace: boolean;
    captions: boolean;
    cards: boolean;
    finishLoudness: boolean;
    targetSeconds?: number;
    /** Each setting below is present only when it is on. */
    captionsByLine?: true;
    cleanVoice?: true;
    limitPeaks?: true;
    brollMinSec?: number;
    speedUpSlowBroll?: true;
    cutChecks?: true;
  };
  /** `limited`: limitPeaks' limiter ran after the loudness pass. */
  loudness?: { lufs: number; truePeak: number; passes: 1 | 2; limited?: true };
  /** Present only with cutChecks. */
  checks?: CutChecks;
  notes?: string[];
}

/** What cutChecks measured on the finished cut, and what fails its bars. */
export interface CutChecks {
  /** Caption screens holding words of two script lines, in the cut's time before any speed-up; null when no captions were burned. */
  lineMixes: Array<{ s: number; text: string }> | null;
  /** The voice's loudness over everything under it; null with a song laid whole or a silent voice. */
  voiceOverBedDb: number | null;
  voiceLufs: number | null;
  bedLufs: number | null;
  repeats: Array<{ phrase: string; firstAt: number; againAt: number }>;
  shortShots: Array<{ n: number; role: string; at: number; sec: number }>;
  /** null when ffmpeg could not read the cut's motion. */
  slowShots: Array<{ n: number; role: string; at: number; sec: number; motion: number; median: number }> | null;
  lufs: number | null;
  truePeak: number | null;
  verdict: { pass: boolean; fails: string[] };
}

/** What the cut did with the manifest's `sound`: where each sound and bed played and how loud, and what it left out. */
export interface CutSound {
  voiceLufs: number | null;
  effects: Array<{ file: string; cueLineId: string; atSec: number; gainDb: number }>;
  beds: Array<{ file: string; fromScene: number; startSec: number; seconds: number; gainDb: number }>;
  music?: { gainDb: number; duck: { threshold: number; ratio: number; attack: number; release: number } };
  /** The music-only master's file name, beside the cut. */
  master?: string;
  notes: string[];
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
  /** Present only when the manifest turned a finishing setting on. */
  pace?: CutPace;
  /** Present only when the manifest names sounds, beds, a ducked music bed or a music-only master. */
  sound?: CutSound;
  /** The music-only master's path, when one was made. */
  musicOnlyMaster?: string;
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
