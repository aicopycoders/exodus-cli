// #2988: the types of the exports the Trigger worker calls. The script is
// plain JS so the CLI can run it with `node` and no build.
import type { SourceIdentity, TextItem, TextPlan, PlanTextInput, VerifyObservation, RasterMeasurement, MeasureText } from "./first-cut-text.mjs";
import type { CaptionSyncVerdict, SeenCaption, SoundPictureCheck, SyncSection } from "./first-cut-sync.mjs";

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
  planned: { targetSeconds: number; overrun: { name: string; seconds: number }; ceilingSeconds: number | null; scriptClock?: PlanningBudget["scriptClock"] };
  decoded: { frames: number; fps: 24; seconds: number } | null;
  status: "within-budget" | "over-budget" | "script-derived" | "unknown";
}
export interface FinishFulfillment {
  ok: boolean;
  lines: Array<{
    lineId: string; sourceSpan: { lineId: string; startChar: number; endChar: number; partId: string } | null;
    /** Honest token comparison of the retained heard words; false never by itself holds an ASR route. */
    retained: string[]; exactCanonicalWords: boolean;
    /** Template native/song ASR routes only: the line is proven by its measured
     * source/master audio window surviving the actual edit; null when a retained
     * scene has no heard word measuring the line (unknown, advisory). Aligned TTS omits these. */
    audioRoute?: "native-asr" | "song-asr"; audioWindowRetained?: boolean | null;
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
  /** Advisory ASR wording disagreements on retained native/song audio. */
  notes: string[];
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

/** Why a finished cut is refused for its loudness (LoudnessRefusal's message), or null when its true peak is at or under -1 dBTP. */
export function truePeakRefusal(measured: { i: number; tp: number } | null): string | null;

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

/** A heard word on the cut's clock before its speed-up. */
export interface CutWordRow { text: string; start: number; end: number; scene: number }

/** #4585: the heard words the end card would cover; empty with no card or when every word ends before it. */
export function voiceUnderEndCard(rows: CutWordRow[], endCard: { in: number } | null): CutWordRow[];

/** #4585: the staff message of a cut refused because the end card would cover some of its voice. */
export function voiceUnderEndCardMessage(words: CutWordRow[]): string;

/** #4585: the end card's place and length, after the last heard word; `holdSec` is how long the picture runs on under it. */
export function endCardLayersOf(
  brand: unknown, storyboard: unknown, pictureSec: number, speed?: number, voiceEndSec?: number | null,
): { file: string; in: number; out: number; seconds: number; holdSec?: number } | null;

/** #4585: the seconds between the last heard word's end and the end card. */
export const END_CARD_AFTER_VOICE_SEC: number;
/** COP-353: the worker's silence probe numbers (media-probe.ts SILENCE_NOISE, SILENCE_MIN_DURATION_SEC), at which the cut reads the voice's silences. */
export const GUARD_SILENCE: { noise: string; minSec: number };

/** #4585: the end card on the cut, holding the last scene's picture under it; throws VoiceUnderEndCardRefusal when it would cover a word. */
export function placeEndCard(
  timeline: unknown, brand: unknown, storyboard: unknown, pictureSec: number, speed: number, notes: string[],
): ReturnType<typeof endCardLayersOf>;

/** #4585: the end card would cover some of the cut's voice, so the cut is not delivered. */
export class VoiceUnderEndCardRefusal extends FirstCutError {
  constructor(words: CutWordRow[]);
  readonly words: CutWordRow[];
}

export interface SourceMapFinding {
  /** "refuse" stops the cut and nothing is delivered; "declared" is a measured fact the cut carries out. */
  severity: "refuse" | "declared";
  code: string;
  scene: number | null;
  detail: string;
  /** Ordered actionable choices for the current selected inputs; never an unchanged deterministic retry. */
  nextActions?: Array<"choose-longer-target">;
}

export interface NarrationFinishClock {
  durationSec: number;
  words: Array<{ w: string; s: number; e: number; lineId: string }>;
  cuts: Array<{ sceneIndex: number; startSec: number; durationSec: number }>;
}
/** Existing pulled master, actual scene-cut starts and canonical tagged words.
 * Refuses missing/invalid clocks before the worker can order finishing sound. */
export function narrationFinishClock(input: { dir: string; manifest: unknown; storyboard: unknown }): NarrationFinishClock;

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
    /** Original source decodedSec stays intact; only measured trailing silence is omitted from the retained sample span. */
    trimmedSilenceSamples?: number;
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
    /** Present only with cutChecks. */
    blipCheck?: true;
    freezeCheck?: true;
    floorCheck?: true;
    flashCheck?: true;
    levelStepCheck?: true;
    voFitCheck?: true;
    dashGapCheck?: true;
    /** The numbers the pace was checked at: PACE_BARS, or the format's own. */
    paceCheck?: { minWps: number; maxWps: number; minGapSec: number; maxGapSec: number; beatMaxSec: number; hookMaxGapSec: number };
    nameCheck?: true;
    /** With pacePass, the speed the cut played at in place of 1.12. */
    paceSpeed?: number;
    /** COP-300: the finished cut was checked against its own sound (cutSync). */
    captionCheck?: true;
    /** COP-353: with cleanVoice, the cut's own named chain in its place (VOICE_SOUNDS). */
    voiceSound?: "phone" | "memo" | "raw";
    /** COP-354: the room sound under the whole film, a bed the cut makes itself (ROOM_BEDS), or none. */
    roomSound?: "none" | "room" | "kitchen" | "car" | "outside";
    /** COP-355: one of Luke's pause levels, by name, in place of jumpCut (PAUSE_TRIMS). */
    pauseTrim?: "light" | "medium" | "hard";
    /** COP-355: a cut is added where this many seconds pass with none, by name (ADDED_CUTS). */
    addedCuts?: "7" | "5" | "3.5";
    /** COP-355: with addedCuts, the script lines no added cut falls inside. */
    wholeLines?: string[];
  };
  /**
   * COP-354: the room sound the cut laid: none, or a bed with its levels (the voice's integrated loudness after its
   * chain, the bed's RMS before its gain, the gain, how far under the voice). The voice's silences the worker's last
   * guard reads under a bed are `voiceSilences` (a bed fills every silence of the film).
   */
  room?: {
    sound: "none" | "room" | "kitchen" | "car" | "outside";
    voiceLufs?: number;
    bedRmsDb?: number;
    gainDb?: number;
    underDb?: number;
  };
  /**
   * COP-353: present when a picked voice chain was used (COP-354: or a room bed laid): the voice's silences as today's
   * cut would deliver it, on the film's clock, which the worker's last guard reads in place of the film's (the chain lifts
   * the film's quiet floor; a bed fills it).
   */
  voiceSilences?: { start: number; end: number; duration: number }[];
  /**
   * `limited`: limitPeaks' limiter ran after the loudness pass. #4573: `limitedAgain` times it ran again lower, from
   * the same mix, because the finished file was over -1 dBTP; `limit` is the ceiling the kept cut was made at.
   */
  loudness?: { lufs: number; truePeak: number; passes: 1 | 2; limited?: true; limitedAgain?: number; limit?: number };
  /** Present only with cutChecks. */
  checks?: CutChecks;
  /**
   * #4805, written by the worker (scout cut-additions.ts): the sheet's additions the film was made again without,
   * because its last check found a fault at one of them.
   */
  remadeWithout?: Array<"addedCuts" | "pauseTrim" | "roomSound">;
  /**
   * #4805, written by the worker: a fault at one of the sheet's additions that making the film again without them did
   * not fix; the film waits for its member, and `sentence` says why.
   */
  finishHold?: { sentence: string; additions: Array<"addedCuts" | "pauseTrim" | "roomSound"> };
  /** #4805, written by the worker: the sentence the member reads of either (convex customerRunView.ts cutCheckNotes). */
  additionsNote?: string;
  /** COP-300: present when a sped-up cut burned its captions: the caption file is on the finished cut's clock. */
  captionClock?: "final";
  /**
   * COP-300, captionCheck: the checks' verdicts (CutSync without its lists, and Check B without its rows). The worker
   * replaces it with Check B judged on its listen of the finished film (`listens`, `model`), and the first cut's Check B
   * as `before` when a fail made the cut again.
   */
  sync?: {
    checkA: SoundPictureCheck | null; checkB: Omit<CaptionSyncVerdict, "rows"> | null; listener: string | null;
    model?: string; listens?: number; before?: Omit<CaptionSyncVerdict, "rows">;
    /** The cut made again that was not kept: its own free check, and the listen's when one judged it. */
    remadeNotKept?: { free: Omit<CaptionSyncVerdict, "rows"> | null; listen: Omit<CaptionSyncVerdict, "rows"> | null };
    /** The sentences a member reads about the check (video/lib/captionSync.ts), as in `notes`. */
    notes?: string[];
  };
  notes?: string[];
}

/** COP-300, captionCheck: the finished cut checked against its own sound, written beside it as <name>.sync.json. */
export interface CutSync {
  /** Check A: null when ffmpeg could not read the film's frames or sound. */
  checkA: SoundPictureCheck | null;
  /** Check B by the free listener; null when no caption was burned. */
  checkB: CaptionSyncVerdict | null;
  listener: "placement" | null;
  captionClock: "final";
  /** Each burned caption and the time it is first seen in the finished film. */
  captions: SeenCaption[];
  /** The cut's takes on the finished film's clock. */
  sections: SyncSection[];
  /** The free listener's words of the finished film. */
  heard: Array<{ text: string; start: number; end: number; lagMs: number; match: number }>;
}

/** COP-357, fps30: the frame rate a film with the phone look is delivered at, by repeated frames. */
export const DELIVERY_FPS: number;

/** The finished cut's frames on its own 24 fps clock: the joined picture's, or round(frames / speed) after a speed step. */
export function filmFrames(pictureSec: number, speed?: number | null): number;

/** #4817: the frames a film delivered at `deliverFps` has, so its picture runs as long as its sound (filmFrames after a speed step, else pictureSec), rounded up. */
export function deliveredFrames(pictureSec: number, speed: number | null, deliverFps: number): number;

/** The bars checkVerdict holds a finished cut to. */
export const CHECK_BARS: {
  voiceOverBedDb: number;
  minBrollSec: number;
  truePeak: number;
  lufs: number;
  blipSec: number;
  freezeSec: number;
  freezeYavg: number;
};

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
  /** blipCheck: shots under a second whose source shot ran a second or longer (srcSec null: no source shot to compare). Present only with it on. */
  blips?: Array<{ n: number; role: string; at: number; sec: number; srcSec: number | null }>;
  /** freezeCheck: stretches of a second or more where the picture does not move. Present only with it on. */
  freezes?: Array<{ at: number; sec: number }>;
  /** floorCheck: cards outside 2.5 to 3 s, shots after a card under 1 s before their first word, dialogue takes under 8 s with no reaction after, takes over 25% short of plan. */
  floors?: {
    cards: Array<{ n: number; label: string; at: number; sec: number }>;
    leads: Array<{ card: number; n: number; at: number; leadSec: number }>;
    dialogue: Array<{ n: number; at: number; sec: number }>;
    shortTakes: Array<{ n: number; sec: number; planSec: number }>;
  };
  /** flashCheck: shots under 0.2 s (`shot`) and one-frame flashes the motion read shows (`frame`, n null). */
  flashes?: Array<{ n: number | null; at: number; sec: number; from: "shot" | "frame" }>;
  /** levelStepCheck: cuts where the sound between words steps over 3 dB; null when the cut's sound could not be read. */
  levelSteps?: Array<{ n: number; at: number; stepDb: number; beforeDb: number; afterDb: number }> | null;
  /** voFitCheck: a voice-over take starting under 0.3 s after the word before it (`early`), or its last word past its take (`late`). */
  voFits?: Array<{ n: number; at: number; early?: number; late?: number }>;
  /** dashGapCheck: gaps over 0.15 s after a line ending on a dash; `rolled` a gap over 0.3 s inside one take. */
  dashGaps?: Array<{ line: string; next: string; at: number; gapSec: number; sameTake: boolean; rolled?: true }>;
  /** paceCheck: lines outside the words-a-second band, and gaps between lines outside theirs. */
  paceBreaks?: {
    lines: Array<{ line: string; at: number; wps: number }>;
    gaps: Array<{ line: string; next: string; at: number; gapSec: number; hook?: true; beat?: true }>;
  };
  /** nameCheck: how many script names were looked for in their takes, and the ones the scribe did not hear. */
  names?: { checked: number; missing: Array<{ n: number; line: string; name: string }> };
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
  /** Render immutable pre-text pixels for mapped cuts or trusted Template authored text, then complete with completeFirstCutText. */
  prepareText?: boolean;
  /** COP-300: the finished film's heard words, on its own clock: the captions are timed by them (a cut made again after its caption check failed). */
  heardWords?: ReadonlyArray<{ text: string; start: number; end?: number }> | null;
}

/** Semantic preservation and visible final-clock windows, not generated-quality proof.
 * Only trusted template runs carry this; ordinary cuts retain their old shape. */
export interface CutMotion {
  shots: Array<{
    sceneIndex: number; startSec: number; seconds: number; file: string | null; speed: number;
    /** Actual selected board/plan obligations, never prompt-keyword inference. */
    protection?: Record<string, unknown>;
  }>;
  holds: Array<{
    sceneIndex: number; startSec: number; seconds: number; basis: string;
    /** The actual underlying spine has no audible voice or whole-song track. */
    silent: boolean;
  }>;
}

/** Assembly provenance, not a new final-audio ASR or visual-quality observation.
 * Template runs write <name>.finish.json, including a non-final receipt when a
 * missing-scene pull is refused. Door 1 keeps its existing return shape. */
export interface CutFinishEvidence {
  version: "cut-finish-evidence.v1";
  provenance: {
    kind: "partial" | "pre-text" | "final";
    isFinal: boolean;
    complete: boolean;
    expectedSceneIndexes: number[];
    retainedSceneIndexes: number[];
    missingSceneIndexes: number[];
    skippedSceneIndexes: number[];
    /** Available pulled scenes intentionally omitted by the editor; these do not make a cut partial. */
    editorOmittedSceneIndexes: number[];
  };
  artifact: { file: string; sha256: string; bytes: number } | null;
  loudness: { status: "measured" | "unknown"; integratedLufs: number | null; truePeakDbtp: number | null; rangeLu: number | null };
  words: {
    basis: "source-word-sidecars-through-audible-edit-clock";
    finalAudioTranscribed: false;
    expected: number; source: number; native: number; final: number;
    coverage: "complete" | "incomplete" | "unknown";
    missing: string[];
  };
}

export interface FirstCut {
  notes?: string[];
  out: string;
  durationSec: number;
  /** The music file the cut used, or null. */
  music: string | null;
  timeline: {
    spine: Array<{ sceneIndex: number; audio?: "clip" | "narration" | "silence"; startSec?: number }>;
    left: string[];
  };
  motion?: CutMotion;
  finishEvidence?: CutFinishEvidence;
  /** Budget-only decoded receipt; also supported when sourceEditMap is absent. */
  planningTiming?: FinalPlanningTiming;
  /** Present only when the manifest turned a finishing setting on. */
  pace?: CutPace;
  /** COP-300: present only with captionCheck. */
  sync?: CutSync;
  /**
   * COP-357, fix A: present only when a picture pass of the phone look was laid and the takes were read before it: their
   * frozen runs (freezedetect at -60 dB from 0.2 s), on the finished film's clock, less what a cutaway or the end card
   * covers. The worker joins them at the cut's framing changes, drops those under 2 s, and adds them to the film's own.
   */
  lookFreeze?: Array<{ start: number; end: number; duration: number }>;
  /** The cut's words on the finished film's clock, as written beside it. */
  rows?: Array<{ text: string; start: number; end: number; scene?: number }>;
  /** Present only when the manifest names sounds, beds, a ducked music bed or a music-only master. */
  sound?: CutSound;
  /** The music-only master's path, when one was made. */
  musicOnlyMaster?: string;
  /**
   * COP-355, addedCuts: where the cut changed a take's framing inside it, in seconds on the delivered film's clock;
   * present only with the cuts row on. The worker's last guard joins a freeze that one splits (auto-cut.ts withFramingJoins).
   */
  framingChangesSec?: number[];
  /**
   * COP-373 review, addedCuts: where the cut added a cut, apart from the pause cuts that change the framing with the row
   * on (framingChangesSec lists both), on the same clock; present only with the cuts row on. A flash at another framing
   * change is told apart by the film made again without the cuts added (scout cut-additions.ts faultedAdditions).
   */
  addedCutsSec?: number[];
  /**
   * #4805, pauseTrim: where a pause cut at one of Luke's levels joins a take to itself, in seconds on the delivered
   * film's clock; present only with a pause level picked.
   */
  pauseJoinsSec?: number[];
  /** Present only when the manifest asked for the measured map.
   * Authored picture time is reserved once per take; only its final split piece
   * may extend, so earlier pieces never replay the resumed piece's source audio.
   * A frozen finalWordTailSec stays in that final voiced take after its complete
   * final heard word, with visible living-tail observation, never silent fill. */
  sourceMap?: SourceEditMap;
  /** Internal prepared artifact; cannot be attached as a completed text finish. */
  textStage?: { dir: string; board: unknown; policy: unknown; speed?: number; frames?: number };
  text?: TextPlan;
}

/** The map's file beside the cut: <name>.source-map.json. */
export function sourceMapPath(outPath: string): string;

/** A complete Template final rendered without prepareText owes the same exact
 * approved-word proof as completeFirstCutText: any required-words-not-retained
 * line writes <out>.text.json { fulfillment: { lines, holds } }, removes the
 * unproven cut and throws TextFinishRefusal. Captions/cards off never weaken it.
 * A word's explicit lineId (or a mapped cut's measured line part) owns it and
 * is never corrected; one its scene does not claim holds that scene's lines.
 * An untagged word on an unmapped cut, including a native Omni transcript,
 * belongs to its scene's one uniquely owned line. A narration/song piece may
 * also use the existing lineParts map only when that map measures every claimed
 * line and covers every retained word in order. Anything unplaced or ambiguous
 * holds; untagged multi-line native pieces cannot use a narration line map. */
export function firstCut(options: FirstCutOptions): FirstCut;
export interface FinalSetupEvidence {
  setupSegments: Array<{
    sceneIndex: number | null; file: string | null;
    setId: string | null; anchorEditEpoch: string | null; baseShotId: string | null;
    finalStartSec: number; finalEndSec: number;
    sourceStartSec: number | null; sourceEndSec: number | null;
    identity: "authored"; clock: "mapped" | "timeline";
  }>;
  setupJoins: Array<{
    atSec: number; left: number; right: number;
    kind: "different-setup" | "continuous-same-source" | "discontinuous-same-setup" | "unknown";
  }>;
}
/** Authored identity plus actual timeline/source continuity, never watched-angle proof. */
export function finalSetupAdjacency(timeline: unknown, board: unknown, graphics?: readonly unknown[]): FinalSetupEvidence;
/** Actual decoded kept clips plus source-clock authored reservations; never action observations. */
export function directorCutEvidence(cut: unknown, board: unknown): FinalSetupEvidence & {
  segments?: Array<{ sceneIndex: number; sourceStartSec: number; sourceEndSec: number; finalStartSec: number; finalEndSec: number }>;
  beatWindows: Array<{ sceneIndex: number; beatId: string; startSec: number; endSec: number }>;
};
/** Resolve approved authored phases against visible source/word windows.
 * Flexible template phases bind actual planPicture slots, never unused capacity. */
export function resolveTemporalRequirements(cut: FirstCut, board: unknown): Pick<TemporalFinishEvidence, "requirements" | "owners" | "holds">;
/** Consume exact-source temporal evidence and retained media. Unknown inputs are
 * serialized board/policy/receipt shapes; this does not manufacture observations. */
export function finishFulfillment(cut: FirstCut, board: unknown, policy: unknown, temporal?: unknown): FinishFulfillment;
/** Convert serialized board/policy inputs into the actual selected text layout. */
export function textMaterial(cut: unknown, board: unknown, policy: unknown): Omit<PlanTextInput, "libass"> & {
  items: TextItem[]; pictureHolds: FinishHold[]; skippedPictures: FinishHold[];
};
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

/** Observes the exact prepared pixels, measures/renders literal text, stream-copies sound and re-probes the final target.
 * Trusted Template authored text also supports native/song cuts without adding
 * a source map or changing their audio finishing. Captions follow audible
 * joins/removals, not muted picture inserts; selected captionsByLine adds
 * approved line boundaries without changing word intervals. Ordinary routes
 * retain their grouping. Missing libass/font measurement still holds. */
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

/** The pace record's note for a paceSpeed the cut does not use (pacePass off, or out of range), or null. */
export function paceSpeedNote(finishing: { pacePass?: unknown; paceSpeed?: unknown } | null | undefined): string | null;

/** #3424: the sentence-gap cut, which scout's scribe.ts sentenceGapCuts mirrors. */
export function sentenceGapCuts(
  words: Array<{ w: string; s: number; e: number }>,
  lines: Array<{ text: string; asksPause: boolean; cuesBeat: boolean }>,
  levels?: { windowSec: number; db: number[] } | null,
  lineGap?: { max: number; keep: number } | null,
  jump?: JumpCut | null,
): Array<{ s: number; e: number; after: string; gap: number; kept: number; sound: boolean; atLine?: number }>;

/** jumpCut: a pause over maxGap between two heard words keeps keepAfter after the earlier word and keepBefore before the later. */
export interface JumpCut { maxGap: number; keepAfter: number; keepBefore: number }
export const JUMP_CUT: JumpCut;

/** COP-357, fix A: how the cut reads the takes before the phone look (freezedetect's noise and length) and its side files. */
export const LOOK_PROBE: { readonly noise: string; readonly minSec: number; readonly framingMinSec: number; readonly freeze: string; readonly motion: string };
/** jumpCut on one pause: the span it takes out, or null when it keeps the pause whole. */
export function jumpCutSpan(endSec: number, startSec: number, jump?: JumpCut): { s: number; e: number } | null;
