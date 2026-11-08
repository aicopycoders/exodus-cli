// #2988: the types of the exports the Trigger worker calls. The script is
// plain JS so the CLI can run it with `node` and no build.
import type { SourceIdentity, TextItem, TextPlan, VerifyObservation, RasterMeasurement, MeasureText } from "./first-cut-text.mjs";

// The worker's shapes (scout cut-sounds.ts, temporal-action-evidence.ts), kept loose here: the root typecheck
// runs without scout's packages, so the tool's types must not load the worker.
type SoundSource =
  | { kind: "generated"; provider: "elevenlabs" }
  | { kind: "library"; assetId: string; bytesVerified: true; [field: string]: unknown };
type TemporalRequirement = { [field: string]: unknown };
type TemporalActionReceipt = { [field: string]: unknown };
import type { PlanningBudget } from "../../../../../video/lib/picturePlan.js";

export interface TextRasterEvidence {
  id: string; kind: string; startSec: number; endSec: number;
  renderBox: [number, number, number, number]; box: [number, number, number, number]; fs: number;
  textSha256: string;
  measurement: Omit<RasterMeasurement, "lines">;
  /** ASS centiseconds are selected to rasterize exactly these video frames; heard seconds above are unchanged. */
  raster: { startFrame: number; frames: number; startCs: number; endCs: number };
}

export interface FinishHold { id: string; code: string; reason: string }
export interface FinalPlanningTiming {
  basis: "decoded-final-picture-clock";
  /** Actual final file bytes; null can never support a known exported timing proof. */
  finalSha256: string | null;
  planned: { targetSeconds: number; overrun: { name: string; seconds: number }; ceilingSeconds: number };
  decoded: { frames: number; fps: 24; seconds: number } | null;
  status: "within-budget" | "over-budget" | "unknown";
}
export interface FinishFulfillment {
  ok: boolean;
  lines: Array<{
    lineId: string; sourceSpan: { lineId: string; startChar: number; endChar: number; partId: string } | null;
    retained: string[]; exactCanonicalWords: boolean;
  }>;
  beats: Array<{
    id: string; windows: Array<{ start: number; end: number }>; seconds: number; reservedSeconds: number | null;
    retained: boolean; action: "observed" | "not-temporally-observed" | "not-asked";
  }>;
  /** Separate from output permission; absent on historical finish receipts.
   * Native endings may use a measured spine picture or muted overlay through EOF;
   * either requires the selected owner's uninterrupted observed release. */
  ending?: {
    status: "unselected" | "fulfilled" | "hold"; kind?: string;
    beatId?: string | null; sceneIndex?: number | null;
    startFrame?: number | null; endFrame?: number | null; phaseId?: string | null;
  };
  holds: FinishHold[];
  resolvedPlanningFindings: Array<{ scene: number; code: string; phaseId: string }>;
}
export interface TemporalFinishEvidence {
  requirements: TemporalRequirement[];
  owners: Array<{ id: string; sceneIndex: number }>;
  holds: FinishHold[];
  receipt: TemporalActionReceipt | null;
  retention: unknown;
}

export class TextFinishRefusal extends FirstCutError {
  constructor(holds: FinishHold[]);
  readonly holds: FinishHold[];
}

export type ReadoutPreparer = (args: {
  source: SourceIdentity;
  sourceBytes: Uint8Array;
  items: Array<Omit<TextItem, "provenance"> & { provenance?: "physical-readout" | "authentic-lettering"; value?: string; unit?: string }>;
  heardWords?: Array<{ word: string; start: number; end: number; cueLineId?: string }>;
}) => Promise<VerifyObservation>;

export class FirstCutError extends Error {
  constructor(code: 1 | 2, message: string);
  readonly code: 1 | 2;
}

/** The finished cut's true peak is over -1 dBTP, or could not be measured, after the loudness pass. */
export class LoudnessRefusal extends FirstCutError {
  constructor(message: string, measured: { i: number; tp: number } | null);
  readonly measured: { i: number; tp: number } | null;
}

/** The measured source-to-edit map found a required word, frame or tail it cannot hold; nothing is stretched, sped up or frozen to hide it. */
export class SourceMapRefusal extends FirstCutError {
  constructor(message: string, findings: SourceMapFinding[]);
  readonly findings: SourceMapFinding[];
}

export interface SourceMapFinding {
  /** "refuse" stops the cut and nothing is delivered; "declared" is a measured fact the cut carries out. */
  severity: "refuse" | "declared";
  code: string;
  scene: number | null;
  detail: string;
}

/**
 * Only with manifest.sourceMap === true, which auto-cut sets when the run's
 * frozen payload turns sourceEditMap on.
 * frames at 1/24 s and edit samples at 48 kHz (2000 a frame) from 0, before
 * any loudness pass. A source picture slot n shows the last decoded frame whose
 * pts (from the first decoded frame) is at or before n/24 (fps=24:round=up);
 * a source sound's zero is its first decoded sample after negative-pts priming,
 * and its words count from it. Sample ranges are in edit samples of the
 * decoded sound as the filter counts it (priming included).
 */
export interface SourceEditMap {
  version: "source-edit-map.v2";
  fps: 24;
  sampleRate: 48000;
  samplesPerFrame: 2000;
  clock: string;
  frames: number;
  samples: number;
  pieces: Array<{
    /** Scene index, or `scene.n` for the n-th piece of a split take. */
    piece: string;
    sceneIndex: number;
    route: { picture: "clip" | "still"; audio: "clip" | "narration" | "silence" | "whole-voice"; file: string; voice: string | null };
    source: {
      picture: { timeBase: string; originSec: number; frames: number; endSec: number; slots: number } | null;
      audio: { timeBase: string; sampleRate: number; originSec: number; samples: number; primingSamples: number; decodedSec: number } | null;
      /** A clip's own sound zero minus its first picture frame, on whole edit samples. */
      audioMinusPictureSec: number | null;
    } | null;
    edit: { startFrame: number; frames: number; startSample: number; samples: number; residualFrames: number };
    /** Source slots (before sentence-gap cuts) and the decoded frame indexes they show. */
    picture: {
      inSlot: number; lastSlot: number | null; firstFrame: number | null; lastFrame: number | null;
      firstPtsSec: number | null; lastPtsSec: number | null; cutSlots: Array<[number, number]>;
      /** Slots that repeat the decoded frame before (the source's own long frames), and decoded frames no slot shows. */
      repeatedSlots: number; skippedFrames: number;
      /** Edit frames with no decoded frame left: always a "picture-hold" refusal. */
      heldFrames: number;
      /** Explicit selected terminal freeze, never an accidental EOF extension. */
      editorialHold?: {
        sourceSceneIndex: number; sourceSlot: number; sourceFrame: number;
        frames: number; boundary: "retained-end";
      };
    } | null;
    sound: {
      zeroSample: number; fromSample: number; toSample: number; available: number;
      cutSamples: Array<[number, number]>; leadSilenceSamples: number; tailSilenceSamples: number;
    } | null;
    /** One entry per script line the piece speaks; `part` is unique across scenes and pieces. */
    lineParts: Array<{
      part: string; lineId: string; measured: boolean; words?: number; firstWord?: number; lastWord?: number;
      sourceSpan?: { lineId: string; startChar: number; endChar: number; partId: string } | null;
      src?: { startSec: number; endSec: number };
      edit?: { startSec: number; endSec: number; startFrame: number; lastFrame: number };
      /** "phoneme" only when the scribe's words carried phoneme times; an ASR word end proves no last phoneme. */
      endEvidence?: "phoneme" | "asr-word-end";
    }>;
    /** Kept only on a picture event measured on the clip's decoded clock (the manifest scene's actionEvidence). */
    action: Record<"lead" | "tail", {
      wantedSec: number; status: "not-asked" | "unproven" | "kept" | "short";
      eventSec?: number | null; shownSec?: { fromSec: number; toSec: number };
    }>;
  }>;
  overlays: Array<{
    scene: number; source: string; method: string | null; onPiece: number | null; startFrame: number; frames: number;
    startSec: number; seconds: number; picture: { firstFrame: number; lastFrame: number } | null;
  }>;
  wholeVoice: {
    file: string; startFrame: number; startSample: number; declaredSec: number;
    /** Each sung scene's stretch, in frames into the song. */
    intervals: Array<{ scene: number; fromFrame: number; toFrame: number }>;
    sampleRate?: number; primingSamples?: number; decodedSec?: number; samples?: number; endSample?: number; pictureEndSample?: number;
  } | null;
  /** The bytes each measured clock was read from. */
  sources?: Array<{ file: string; bytes: number; sha256: string }>;
  /**
   * What the delivered cut lets be heard, from each piece's actual route and sample windows (edit and
   * source), never from which sounds or songs exist. owner/storageId/acceptedLineIds are only the pull's
   * manifest.sourceMeta for that exact file, else null: unknown, never inferred. sha256 from `sources`.
   */
  audibleSources: Array<{
    file: string; sha256?: string | null; route: "clip" | "narration" | "whole-voice";
    /** null for whole-voice, which is one input across `sceneIndexes`. */
    sceneIndex: number | null; sceneIndexes: number[]; piece: string;
    edit: { fromSample: number; toSample: number };
    source: { fromSample: number; toSample: number; cutSamples: Array<[number, number]> };
    tail?: { editFromSample: number; samples: number };
    lineParts: string[];
    /** sourceMeta[file].kind of the producing artifact; null when the pull does not say (never inferred from route). */
    kind: "native-clip" | "voiceover" | "song-master" | null;
    owner: string | null; acceptedLineIds: string[] | null; storageId: string | null;
  }>;
  /** Picture clips whose own sound the cut does not play: no listen to a source counts for these. */
  mutedPictures: Array<{ file: string; sha256?: string | null; sceneIndex: number | null; piece: string | null }>;
  findings: SourceMapFinding[];
  /** Set after the render, from the finished cut's decoded frames and samples. */
  render?: { frames: number | null; frameDelta: number | null; samples: number | null; sampleDelta: number | null; soundStartSamples: number | null };
  /** Selected frozen maximum checked only against the final decoded picture clock, never generated source sums. */
  planningTiming?: FinalPlanningTiming;
  mix?: {
    fallback: "brown-noise" | "none"; effects: CutSound["effects"]; beds: CutSound["beds"];
    music?: { file: string; sourceSha256: string; sourcePrimingSamples: number; sourceSamples: number; sourceOriginSec: number; loop: true };
  };
  text?: {
    source: SourceIdentity; report: string; permissions: TextPlan["permissions"]; fulfillment: FinishFulfillment;
    styleVersion: "literal-ass.v1"; assSha256: string | null; rasters: TextRasterEvidence[]; readouts: TextPlan["readouts"];
  };
  temporal?: TemporalFinishEvidence;
  /** Original source-clock uncertainty, resolved ONLY by the linked exact-pretext temporal receipt. */
  semanticPlanningFindings?: SourceMapFinding[];
  final?: { sha256: string };
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
  effects: Array<{
    file: string; cueLineId: string; atSec: number; gainDb: number; source?: SoundSource;
    /** Intended heard cue, independent from the actual file placement/event offset. */
    plannedOnsetSec?: number;
    sourceSha256?: string; placementOffsetSec?: number; editStartSample?: number; sourceStartSample?: number; servedStorageId?: string;
    sourcePrimingSamples?: number; sourceSamples?: number; sourceOriginSec?: number;
  }>;
  beds: Array<{
    file: string; fromScene: number; startSec: number; seconds: number; gainDb: number; source?: SoundSource;
    sourceSha256?: string; loop?: true; editStartSample?: number; samples?: number; servedStorageId?: string;
    sourcePrimingSamples?: number; sourceSamples?: number; sourceOriginSec?: number;
  }>;
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
  /** With the measured map only: render immutable pre-text pixels, then complete with completeFirstCutText. */
  prepareText?: boolean;
}

export interface FirstCut {
  out: string;
  durationSec: number;
  /** The music file the cut used, or null. */
  music: string | null;
  timeline: { spine: Array<{ sceneIndex: number }>; left: string[] };
  /** Budget-only decoded receipt; also supported when sourceEditMap is absent. */
  planningTiming?: FinalPlanningTiming;
  /** Present only when the manifest turned a finishing setting on. */
  pace?: CutPace;
  /** Present only when the manifest names sounds, beds, a ducked music bed or a music-only master. */
  sound?: CutSound;
  /** The music-only master's path, when one was made. */
  musicOnlyMaster?: string;
  /** Present only when the manifest asked for the measured map.
   * Authored picture time is reserved once per take; only its final split piece
   * may extend, so earlier pieces never replay the resumed piece's source audio.
   * A frozen finalWordTailSec stays in that final voiced take after its complete
   * final heard word, with visible living-tail observation, never silent fill. */
  sourceMap?: SourceEditMap;
  /** Internal prepared artifact; cannot be attached as a completed text finish. */
  textStage?: { dir: string; board: unknown; policy: unknown };
  text?: TextPlan;
}

/** The map's file beside the cut: <name>.source-map.json. */
export function sourceMapPath(outPath: string): string;

export function firstCut(options: FirstCutOptions): FirstCut;
/** Measures the actual final file without constructing a source map or changing media. */
export function measureCutPlanningTiming(file: string, planningBudget: PlanningBudget): {
  planningTiming: FinalPlanningTiming;
  findings: SourceMapFinding[];
};

export interface TextRenderer {
  libass: boolean;
  measureText?: MeasureText;
  assertFont?: () => boolean;
}

/** Observes the exact prepared pixels, measures/renders literal text, stream-copies sound and re-probes the final target. */
export function completeFirstCutText(cut: FirstCut, options?: {
  out?: string;
  prepareReadoutVerifier?: ReadoutPreparer;
  observeTemporalAction?: (args: never) => Promise<unknown>;
  checkTemporalRetention?: (args: never) => unknown;
  renderer?: TextRenderer;
}): Promise<FirstCut>;
/** Decodes final mixed sound, never a separated cue; no causal attribution. */
export function measureCutAudio(file: string): { windowSec: number; db: number[] } | null;

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
