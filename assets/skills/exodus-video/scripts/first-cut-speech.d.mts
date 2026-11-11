import type { ActionPhaseAnchor } from "../../../../../video/lib/storyboardContract.js";

export const TEMPLATE_INTERNAL_PAUSE_SEC: number;
export const TEMPLATE_PAUSE_KEEP_AFTER_SEC: number;
export const TEMPLATE_PAUSE_KEEP_BEFORE_SEC: number;
export const TEMPLATE_SPEECH_LEAD_SEC: number;
export const TEMPLATE_SPEECH_TAIL_SEC: number;
export const DIALOGUE_BREATH_LEAD_SEC: number;
export const DIALOGUE_BREATH_TAIL_SEC: number;
export const AUTHORED_ACTION_LEAD_SEC: number;
export const AUTHORED_REACTION_TAIL_SEC: number;

export interface SpeechEditWord {
  word?: string;
  w?: string;
  startSec?: number;
  endSec?: number;
  s?: number;
  e?: number;
  lineId?: string;
}

export interface SpeechEditLine {
  lineId?: string;
  text: string;
  asksPause?: boolean;
  cuesBeat?: boolean;
  stageDirection?: string | readonly string[];
  performanceDirection?: string | readonly string[];
  action?: string | readonly string[];
}

export interface SpeechEditWindow {
  startSec?: number;
  endSec?: number;
  s?: number;
  e?: number;
}

/** What a trusted template cut keeps of one talking clip, on the clip's own clock. */
export interface TemplateSpeechEdit {
  headSec: number;
  tailSec: number;
  cuts: Array<{ startSec: number; endSec: number }>;
}

/** Detection only. Callers apply their own lead/tail seconds. */
export interface AuthoredBeat {
  timedLeadSec: number;
  timedTailSec: number;
  preLineAction: boolean;
  postLineReaction: boolean;
}
export function parseAuthoredBeat(direction: string | readonly string[] | null | undefined): AuthoredBeat;

/** True only when both timestamps are finite and the token has no duration. */
export function isZeroDurationSpeech(word: SpeechEditWord): boolean;

/** Template join anchors. Incomplete times stay; proven zero-duration tokens do not. */
export function templateJoinAnchors(words: readonly SpeechEditWord[]): { firstSec?: number; lastSec?: number };
/** Structural projection of the canonical scene reservations; contains no dialogue. */
export interface SpeechEditOptions {
  /** Advisory source-clock findings; never an action observation or quality rejection. */
  notes?: string[];
  sceneIndex?: number;
  editingTreatment?: import("../../../../../video/lib/formatPayload.js").EditingTreatment;
  durationSec?: number;
  span?: { first: number; last: number };
  protectedWindows?: readonly SpeechEditWindow[];
  actionLeadSec?: number;
  actionTailSec?: number;
  lines?: readonly SpeechEditLine[];
  direction?: string | readonly string[];
  actionPhases?: readonly { id: string; required?: boolean; window?: { start: ActionPhaseAnchor; end: ActionPhaseAnchor } }[];
  directorBeats?: readonly { id: string; timing: { start: ActionPhaseAnchor; end: ActionPhaseAnchor; minActionSec: number } }[];
  fps?: number;
}

/** An authored reservation on the measured source clock, NOT an observed action receipt. */
export interface SpeechEditActionWindow {
  id: string;
  kind: "director-beat" | "action-phase";
  startSec: number;
  endSec: number;
}
/** Full-scene proof phases are excluded; director windows remain explicit edit reservations. */
export function templateActionWindows(words: readonly SpeechEditWord[], opts?: SpeechEditOptions): SpeechEditActionWindow[];



/**
 * Jump-cut internal pauses over 0.8 s and trim to the first word − 0.10 s
 * and the last word + 0.28 s. Measured director/phase windows protect acting;
 * stage directions supply fallback handles on edges not covered by resolved windows.
 * Null without measured words.
 */
export function templateSpeechEdit(
  words: readonly SpeechEditWord[],
  opts?: SpeechEditOptions,
): TemplateSpeechEdit | null;
