// B32–B34 consumer contract. No source mutation, policy table or width estimate.
export const LOWER_PANEL_TOP: number;
export const READOUT_INSET_BOX: [number, number, number, number];
/** Normalized [left, top, right, bottom] (XYXY), not storyboard XYWH. */
export type Box = [number, number, number, number];
export interface TextHold { code: string; id: string; reason: string; required: true; inherited?: true }
export interface HeardWord { text: string; start: number; end: number; lineId?: string }
export interface Avoidance { box: Box; in?: number; out?: number }
export interface SourceIdentity { id: string; sha256: string }
export interface MeasurementRequest {
  kind: string; lines: string[]; fs: number; W: number; H: number;
  style?: string; xShare: number; yShare?: number; box: Box; maxWidthPx: number;
}
export interface RasterMeasurement {
  /** Actual executable identity and actual subtitles-filter availability. */
  renderer: { ffmpeg: string; libass: true | "present" };
  /** Actual fontconfig resolution used by the measured burn, never a guess. */
  font: { requested: string; resolved: string };
  lines: string[];
  /** Absolute frame pixels: union of actual ink, shadow, outline and opaque box. */
  inkRect: { x: number; y: number; w: number; h: number };
  coverage: { missingGlyphs: string[] };
}
/** Synchronous trusted consumer capability: render the exact request using the
 * same ffmpeg executable, fontconfig resolution, ASS style/spacing/decorations
 * and geometry as the final burn. Use two contrasting backgrounds so black ink
 * and opaque boxes cannot disappear. Return null if not actually measured.
 * Cache identity MUST include every request field, including style/position.
 * This certifies geometry, NOT a human's reading speed or semantic approval. */
export type MeasureText = (request: MeasurementRequest) => RasterMeasurement | null;
export interface CaptionStyle { style?: string; wordsPerLine?: { median?: number }; place?: [number, number]; box?: Box }
export interface CaptionScreen {
  /** Literal source words only. Renderer owns escaped ASS serialization. */
  text: string; plain: string; lines: string[]; fs: number;
  s: number; e: number; xShare: number; yShare: number; box: Box;
  measurement: RasterMeasurement;
}
export interface ProofInsert {
  kind: string; sourceQuote: string; assertion: "source-assertion";
  requirementQuote?: string;
  actionPhaseId?: string;
  presentation: "full-frame" | "lower-panel";
}
export interface TextItem {
  id: string; kind?: string; text: string; required?: boolean; in?: number; out?: number;
  box?: Box; placement?: string; provenance?: "post" | "physical-readout" | "authentic-lettering";
  /** Honored only with the template capability; never an observed physical readout. */
  proof?: ProofInsert;
  /** Authored question boundary is not clamped to this explanatory heard line. */
  within?: { start: number; end: number };
  /** Supplied authored readability requirement; never computed from string length.
   * If this cannot be met in the authored interval, hold rather than retime. */
  minReadableSec?: number;
  opening?: boolean; cueLineId?: string;
  /** Untrusted legacy metadata is not observation proof or fallback authority. */
  evidence?: unknown; fallback?: unknown;
}
export interface TextCard {
  n?: number; id: string; kind: string; label: string; lines: string[]; fs: number;
  /** Measured actual ink rectangle. */
  box: Box;
  /** Authored geometry used for the raster and final burn. Do not recenter on ink. */
  renderBox: Box;
  in: number; out: number; moved: false; measurement: RasterMeasurement;
  proof?: ProofInsert;
}
export interface Observation {
  source: SourceIdentity; text: string; box: Box;
  frame: { time: number; sha256: string };
  /** Required at clock zero when this is an opening readout. */
  opening?: { time: number; sha256: string; text: string; box: Box } | null;
  value?: string; unit?: string; cueLineId?: string;
}
/** Trusted media observer capability, not user/item receipt deserialization.
 * Must obtain frame/opening pixels from this exact hashed source file and
 * report actual visible text/box. Planner separately validates source hashes,
 * authored frame window, opening clock, heard cue, adjacent exact value+unit.
 * No observer means hold; this helper never substitutes a deterministic insert. */
export type VerifyObservation = (request: { item: TextItem; source?: SourceIdentity }) => Observation | null;
export interface Readout {
  id: string; provenance: string; status: "observed" | "hold"; claimsObserved: boolean;
  observation: Observation | null;
}
export interface OutputPermission {
  /** Exact selected format binding, any of ALL20; no name-based policy. */
  formatId: string;
  /** Selected Skeleton binding, stamped by the frozen format resolver. */
  skeletonId?: string;
  ending: { kind: string; mode: "native" | "asset"; assetRequired?: true } | null;
  endCard: boolean; offer: boolean;
}
export interface Selection {
  /** Supply only parseFormatPayload(run.formatPayload).outputPermission from
   * the frozen selected run; item/user-authored objects are not authority. */
  outputPermission?: OutputPermission;
  ending?: { kind: string; mode: "native" | "asset"; asset?: string };
  endCard?: Omit<TextItem, "id">;
  offer?: Omit<TextItem, "id"> & { photo?: { real?: boolean; id?: string } };
}
export interface Permissions {
  treatment: string; captions: boolean; requiredText: true; endCard: boolean;
  ending: { kind: string | null; status: "unselected" | "native" | "supplied" | "hold" };
  offer: { text: string; photo: string } | null; holds: TextHold[];
}
export interface CaptionOptions {
  cap?: CaptionStyle | null; names?: string[]; lyricLines?: string[];
  /** Internal selected narrated-finish grouping; ordinary callers default off. */
  keepNumericLists?: boolean;
  /** Actual cut boundaries in the same heard clock. */
  cuts?: number[]; avoid?: Avoidance[]; W: number; H: number; totalSec?: number | null; measureText?: MeasureText;
}
export interface CardOptions {
  avoid?: Avoidance[]; captionRects?: Avoidance[]; W: number; H: number;
  totalSec?: number | null; endCardAllowed?: boolean; measureText?: MeasureText;
  source?: SourceIdentity; words?: HeardWord[]; verifyObservation?: VerifyObservation;
  template?: boolean;
}
export interface PlanTextInput extends CardOptions {
  treatment: string; words?: HeardWord[];
  captions?: { on?: boolean; cap?: CaptionStyle; lyricLines?: string[]; names?: string[]; keepNumericLists?: boolean };
  items?: TextItem[]; selection?: Selection; libass: boolean; cuts?: number[];
  inheritedHolds?: Array<{ code: string; id: string; reason: string }>;
}
export interface TextPlan {
  /** Required text not delivered if false. Caller must carry holds, not publish a pass. */
  ok: boolean; holds: TextHold[]; notes: string[];
  skipped: Array<{ id: string; code: string; reason: string }>;
  permissions: Permissions; readouts: Readout[];
  directives: { captions: CaptionScreen[]; cards: TextCard[]; hook: TextCard | null; endCard: TextCard | null };
}
export function planText(input: PlanTextInput): TextPlan;
export function planCaptionScreens(words: HeardWord[], options: CaptionOptions): { screens: CaptionScreen[]; holds: TextHold[]; notes: string[] };
export function planCards(items: TextItem[], options: CardOptions): { cards: TextCard[]; hook: TextCard | null; endCard: TextCard | null; readouts: Readout[]; holds: TextHold[]; skipped: TextPlan["skipped"]; notes: string[]; reservations: Avoidance[] };
export function outputPermissions(input: { treatment: string; captions?: boolean; selection?: Selection }): Permissions;
export const captionFontPx: (cap: CaptionStyle | null, H: number) => number;
