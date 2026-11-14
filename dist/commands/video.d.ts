import { type TemplateAudition } from "../lib/template-audition.js";
import { type ApiResponse } from "../lib/client.js";
import type { FlagOccurrence } from "../lib/args.js";
import { type RunProvenance, type WorkflowRun } from "./workflow.js";
import { type SpeechSummary, type CustomerItem, type CustomerRun } from "./video-customer.js";
declare const VOICE_MODES: readonly ["native", "voice-first"];
type VoiceMode = (typeof VOICE_MODES)[number];
export type ScriptRunOptions = {
    conceits: {
        key: string;
        label: string;
        style?: {
            slug: string;
            label: string;
        };
    }[];
    styles: {
        slug: string;
        label: string;
    }[];
};
export declare function scriptRunPickProblem(options: ScriptRunOptions, conceit: string, style: string): string | null;
export declare const helpText: string;
export declare const RUN_PATH = "/api/v2/workflow";
export declare const ITEMS_PATH = "/api/v2/workflow/items";
export declare const FINAL_PATH = "/api/v2/video/final";
export declare const KEEP_SCENE_PATH = "/api/v2/video/keep-scene";
export declare const VOICES_PATH = "/api/v2/video/voices";
export declare const PICKS_PATH = "/api/v2/video/picks";
export declare const MAP_PATH = "/api/v2/video/map";
export declare const ASSET_UPLOAD_URL_PATH = "/api/v2/workflows/asset-upload-url";
export declare const ASSETS_PATH = "/api/v2/workflows/assets";
export interface ClipWord {
    w: string;
    s: number;
    e: number;
    lineId?: string;
}
export type ClipQcTakeNeighbours = {
    state: "not-applicable";
} | {
    state: "not-attached";
} | {
    state: "none-accepted";
} | {
    state: "attached";
    scenes: number[];
};
export interface ClipQcTake {
    kind: "take" | "soft-retry";
    failCodes: string[];
    warnCodes: string[];
    neighbours: ClipQcTakeNeighbours;
    judgeWording?: {
        code: string;
        wording: string;
    }[];
    heardText?: string;
}
export interface ClipQc {
    verdict: "pass" | "fail";
    attempts: number;
    neighbours?: number[];
    takes?: ClipQcTake[];
}
export interface ClipFinding {
    check: string;
    code: string;
    severity: "fail" | "warn";
    detail: string;
    judgeDetail?: string;
    judgeSeverity?: "fail" | "warn";
    speechIssue?: SpeechSummary["issues"][number];
}
export declare function qcWithoutJudgeWording(qc: ClipQc): ClipQc;
export declare const NO_TAKE_HISTORY_LINE = "no history recorded for this clip";
export declare function renderQcTakeHistory(takes: ClipQcTake[] | undefined): string[];
export interface ReplannedIdea {
    framePrompt?: string;
    videoPrompt?: string;
    imageUrl: string;
}
export type ArtifactSubset = {
    type: "storyboard";
    storyboard?: unknown;
    storyboardJson?: string;
} | {
    type: "frames";
    frames?: Array<{
        sceneIndex: number;
        imageUrl?: string;
    }>;
} | {
    type: "image";
    imageUrl?: string;
    storageId?: string;
    anchor?: "set-plate" | "product-sheet" | "filled-plate" | "product-plate" | "layout-plate";
    holds?: string[];
    lid?: "closed";
    camera?: string;
    view?: "side" | "back" | "three-quarter";
} | {
    type: "video";
    sceneIndex?: number;
    videoUrl?: string;
    durationSec?: number;
    words?: ClipWord[];
    qc?: ClipQc;
    final?: boolean;
    revoiced?: boolean;
    speechTrimmed?: boolean;
    tailTrimmed?: boolean;
    rawStorageId?: string;
    voiceMode?: "voice-first";
    voiceFirstBlockedBy?: string[];
    voicePitchHz?: number;
    voicePitchMethod?: string;
    replannedIdea?: ReplannedIdea;
    voiceLock?: unknown;
} | {
    type: "audio";
    sceneIndex?: number;
    audioUrl?: string;
    durationSec?: number;
    words?: ClipWord[];
    narration?: {
        takeHash: string;
        voiceId?: string;
        modelId?: string;
        speed?: number;
        alignment?: "elevenlabs-timestamps";
        cuts?: Array<{
            sceneIndex: number;
            startSec: number;
            durationSec: number;
            takeHash: string;
        }>;
    };
} | {
    type: "text" | "primer" | "session" | "document";
};
export interface PlanFailureRecord {
    kind: string;
    partsTotal?: number;
    acceptedParts?: number;
    acceptedScenes?: number;
    failedPart?: number;
    reasons?: string[];
    lines: string[];
}
export interface VideoRunNode {
    nodeId: string;
    kind: string;
    status: "idle" | "running" | "done" | "failed" | "skipped" | "out-of-scope";
    error?: string;
    warning?: string;
    planFailure?: PlanFailureRecord;
    memberStop?: MemberStopMark;
    hasRejectedDraft?: boolean;
    outputs?: ArtifactSubset[];
    missingScenes?: MissingScene[];
    autoRedoScenes?: number[];
    autoRedoReasons?: AutoRedoReason[];
}
export interface MemberStopMark {
    sentence: string;
    retry: boolean;
}
export interface AutoRedoReason {
    sceneIndex: number;
    reason: string;
}
export interface MissingScene {
    sceneIndex: number;
    pictureRefused: boolean;
}
export type BuilderPauseReason = "taste" | "repair" | "slots" | "call" | "checkpoint";
export interface PullCastLockMember {
    characterId: string;
    name: string;
    look?: string;
    identityRefs?: Array<{
        storageId?: string;
        imageUrl?: string;
        view?: string;
    }>;
}
export interface PullCastLock {
    mintedAt: number;
    styleSlug?: string;
    cast: PullCastLockMember[];
}
export interface VideoRun {
    _id: string;
    launchDoor?: "template";
    status: string;
    isTerminal: boolean;
    error?: string;
    costUsd?: number;
    costScope?: "soFar" | "final";
    pauseReason?: BuilderPauseReason | "pilot";
    pausedNodeId?: string;
    pilot?: {
        sceneIndexes?: number[];
        approvedAt?: number;
    };
    requestQuotePending?: boolean;
    templateAudition?: TemplateAudition;
    sourceEditMap?: true;
    blockingMap?: true;
    nodes: VideoRunNode[];
    pauseAhead?: WorkflowRun["pauseAhead"];
    castLock?: PullCastLock | null;
    provenance?: RunProvenance;
    musicBed?: boolean;
    videoChoice?: RunVideoChoice;
    songAsVoice?: true;
    heldSong?: true;
    roomTone?: boolean;
    shots?: RunShots;
    storyboardAutoApproval?: {
        outcome: "approved" | "held";
        at: number;
        reason?: string;
    };
    workflowId?: string;
    cutHeldScenes?: number[];
    cutFailure?: {
        sentence: string;
    };
    cutCheck?: string[];
    moduleOwned?: boolean;
    director?: RunDirector;
}
export interface RunDirector {
    on: boolean;
    runSetting: boolean | null;
    workspaceOn: boolean;
    status: "reviewing" | "waiting" | "done" | "stopped" | null;
    redosUsed: number;
    redoCap: number;
    spendUsd: number;
    spendCapUsd: number;
    log: {
        at: number;
        phase: "storyboard" | "final-watch";
        text: string;
    }[];
}
export declare function asVideoRun(data: unknown): VideoRun;
export interface NodeItem {
    nodeId: string;
    sceneIndex: number;
    itemKind: string;
    status: string;
    error?: string;
    attempt?: number;
    flagged?: boolean;
    findings?: ClipFinding[];
    speech?: SpeechSummary;
    staleClaim?: boolean;
    lastRedo?: {
        take: number;
        outcome: string;
        label: string;
        reason?: string;
        voiceFirstBlockedBy?: string[];
        displacedHistory?: {
            title: string;
            lines: string[];
        };
    };
    artifact?: ArtifactSubset;
}
export interface ShowRow {
    id: string;
    name: string;
    status?: string;
    medium?: string;
    styleSlug?: string;
    ready?: boolean;
    setupProgress?: {
        set?: boolean;
        cast?: boolean;
        voices?: boolean;
    };
}
export interface FlowResult {
    code: number;
    lines: string[];
    usage?: true;
}
export interface VideoDeps {
    get: (path: string) => Promise<ApiResponse<unknown>>;
    post: (path: string, body: unknown) => Promise<ApiResponse<unknown>>;
    mkdirp: (dir: string) => void;
    writeFile: (filePath: string, text: string) => void;
    downloadToFile: (url: string, filePath: string) => Promise<void>;
    readFile: (filePath: string) => string;
    readFileBytes: (filePath: string) => Uint8Array;
    statFile: (filePath: string) => {
        size: number;
    } | null;
    uploadBytes: (uploadUrl: string, contentType: string, bytes: Uint8Array) => Promise<{
        ok: boolean;
        status: number;
        storageId?: string;
        body?: string;
    }>;
    probeDurationSec: (filePath: string) => number | null;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
    dashboardUrl: string;
}
export declare const defaultDeps: VideoDeps;
export declare const VIDEO_NOT_FOUND_MESSAGE: string;
export declare function videoApiError(res: ApiResponse<unknown>): string;
export type RunStop = {
    at: "running";
    stage: string;
    autoRedoScenes?: number[];
    autoRedoReasons?: AutoRedoReason[];
} | {
    at: "storyboard-gate";
    nodeId?: string;
    framesNodeId?: string;
    showAd?: true;
    heldReason?: string;
    blockingMap?: true;
} | {
    at: "final-watch";
    missingScenes?: MissingScene[];
    framesNodeId?: string;
    heldScenes?: number[];
    heldTakes?: HeldTake[];
    cutFailure?: string;
} | {
    at: "pilot";
    nodeId?: string;
    sceneIndexes: number[];
    silentScenes?: number[];
    checks?: PilotCheck[];
} | {
    at: "request-quote";
} | {
    at: "audition";
    audition: NonNullable<VideoRun["templateAudition"]>;
} | {
    at: "picks";
    nodeId: string;
} | {
    at: "paused";
    nodeId?: string;
    reason?: string;
} | {
    at: "failed";
    error?: string;
    repair?: true;
    nodeId?: string;
    step?: string;
    workerStopped?: true;
    memberStop?: MemberStopMark;
} | {
    at: "finished";
    status: string;
};
export type ResolvedStop = Exclude<RunStop, {
    at: "final-watch";
}> | (Extract<RunStop, {
    at: "final-watch";
}> & {
    cutAttached: boolean | null;
});
export interface PilotCheck {
    sceneIndex: number;
    clip: "made" | "failed" | "making";
    error?: string;
    words?: string;
    failed: string[];
    skipped: string[];
}
export declare function pilotCheck(sceneIndex: number, row: NodeItem | undefined, hasLine?: boolean): PilotCheck;
export declare function classifyRun(run: VideoRun): RunStop;
export declare function hasAttachedCut(items: NodeItem[]): boolean;
export declare function scenesBeingRedone(run: VideoRun, items: NodeItem[]): number[];
export interface HeldTake {
    sceneIndex: number;
    sentence: string;
}
export declare function heldTakesOf(scenes: readonly number[] | undefined, items: readonly NodeItem[] | null | undefined): HeldTake[];
export declare function resolveStop(stop: RunStop, cutAttached: boolean | null, items?: NodeItem[] | null): ResolvedStop;
export declare function resolveStopAtPark(stop: RunStop, runId: string, deps: Pick<VideoDeps, "get">): Promise<ResolvedStop>;
export declare function stageWord(stage: string): string;
export declare function stepName(kind: string | undefined): string;
export declare function isShowAd(run: Pick<VideoRun, "moduleOwned">): boolean;
export declare function reviewUrl(dashboardUrl: string, run: Pick<VideoRun, "_id" | "workflowId">): string;
export declare function stopLines(stop: ResolvedStop, runId: string, runUrl: string, videoPage: string): string[];
export declare function failedStoryboardNode(run: VideoRun): VideoRunNode | undefined;
export declare function errorEchoesReasons(error: string | undefined, record: PlanFailureRecord | undefined): boolean;
export declare function planFailureLines(node: VideoRunNode | undefined, runId: string): string[];
export interface PullDownload {
    file: string;
    url: string;
}
export interface PullTextFile {
    file: string;
    body: string;
}
export interface ManifestScene {
    sceneIndex: number;
    durationSec: number | null;
    clip: string | null;
    words: string | null;
    wordsFrom: "clip" | "voice" | null;
    wordsDescribe: "original-performance" | "this-file" | null;
    voice: string | null;
    keyframe: string | null;
    qc: ClipQc | null;
    revoiced: boolean | null;
    speechTrimmed: boolean | null;
    rawStorageId: string | null;
    voiceMode: "voice-first" | null;
    voiceFirstBlockedBy: string[] | null;
    voicePitchHz: number | null;
    voicePitchMethod: string | null;
    voiceLock?: unknown;
    clipStatus: string;
    error: string | null;
    flagged: boolean;
    findings: ClipFinding[];
    templateAudioSourceReservation?: ClipFinding;
    speech?: SpeechSummary;
    keyframeFindings: ClipFinding[] | null;
}
export interface PullFailure {
    file: string;
    url: string;
    error: string;
}
export interface ManifestCastRef {
    characterId: string | null;
    name: string | null;
    file: string | null;
    status: string;
    error: string | null;
    voiceId: string | null;
    voiceLabel: string | null;
    voiceDescription: string | null;
    views?: ManifestCastView[];
}
export interface ManifestCastView {
    view: string;
    file: string | null;
}
export type MusicBedState = "on" | "off" | "unknown";
export interface RunVideoChoice {
    videoModel: string;
    videoModelLabel: string;
    voiceMode: string;
    voiceModeLabel: string;
}
export declare const MUSIC_HEARD_CODE = "music-heard";
export interface ManifestFilledPlate {
    file: string | null;
    holds: string[];
    lid?: "closed";
}
export interface VideoManifest {
    runId: string;
    pulledAt: string;
    dashboardUrl: string;
    storyboard: string | null;
    reference: string | null;
    productSheet: string | null;
    setPlate: string | null;
    filledPlates: ManifestFilledPlate[];
    music: string | null;
    musicBed: MusicBedState;
    musicHeardScenes: number[];
    pendingRedo: number[];
    dropped: number[];
    cast: ManifestCastRef[];
    narration: {
        file: string;
        timing: string;
    } | null;
    scenes: ManifestScene[];
    failed: PullFailure[];
    provenance?: RunProvenance;
    videoChoice?: {
        videoModel: string;
        voiceMode: string;
    };
    clipAudio?: "keep" | "discard";
    roomTone?: boolean;
    wholeVoice?: true;
    templateMotion?: {
        enabled: true;
    };
    shots?: RunShots;
    lineage?: {
        file: string | null;
        reason?: string;
    };
}
export interface RunShots {
    frame?: string;
    pacing?: string;
}
export declare const CAST_LEDGER_BASE: number;
export declare const CAST_VIEW_LEDGER_BASE: number;
export declare function musicBedState(run: VideoRun): MusicBedState;
export interface PullPlan {
    downloads: PullDownload[];
    texts: PullTextFile[];
    manifest: VideoManifest;
}
export declare function extensionFromUrl(url: string): string | undefined;
export declare function scenePrefix(sceneIndex: number): string;
export declare function planPull(run: VideoRun, items: NodeItem[], opts: {
    pulledAt: string;
    dashboardUrl: string;
}): PullPlan;
export declare function markPullFailure(manifest: VideoManifest, failure: PullFailure): void;
export declare function missingSetupLabels(progress: ShowRow["setupProgress"]): string[];
export declare function showsFlow(json: boolean, deps: VideoDeps): Promise<FlowResult>;
export interface StartOptions {
    showId: string;
    scriptFile: string;
    voicePath?: string;
    music?: boolean;
    wait: boolean;
    json: boolean;
    onProgressLine?: (line: string) => void;
}
export interface ScriptStartOptions {
    scriptFile: string;
    conceit: string;
    style: string;
    direction?: string;
    voicePath?: string;
    videoModel?: string;
    voiceMode?: VoiceMode;
    music?: boolean;
    reviewStoryboard?: true;
    director?: true;
    broll?: true;
    shots?: RunShots;
    stopAtScript?: true;
    rewriteToFit?: true;
    sourceRecordFile?: string;
    adaptationPlanFile?: string;
    resumeScriptFile?: string;
    renewScriptApproval?: true;
    requestedSeconds?: number;
    picturesPerScene?: 1 | 3;
    productId?: string;
    elementsInput?: string;
    voicesInput?: string;
    inputMode?: "automatic" | "manual" | "hybrid";
    structure?: string;
    reference?: string;
    subject?: "product" | "service" | "non-product";
    adaptationIntent?: string;
    describe?: true;
    keepOriginal?: true;
    writerBrief?: {
        product?: string;
        audience?: string;
        offer?: string;
        mechanism?: string;
    };
    templateBriefInput?: string;
    songControlsInput?: string;
    mechanismPlanInput?: string;
    quotePreparation?: true;
    authorizePreparationFile?: string;
    wait: boolean;
    json: boolean;
    onProgressLine?: (line: string) => void;
}
export type VideoStartPlan = {
    kind: "usage";
    line: string;
} | {
    kind: "show";
    opts: StartOptions;
} | {
    kind: "script";
    opts: ScriptStartOptions;
};
export declare function startFlow(opts: StartOptions, deps: VideoDeps): Promise<FlowResult>;
export declare function startedThenWait(runId: string, head: string[], opts: {
    json: boolean;
    url: string;
    onProgressLine?: (line: string) => void;
}, deps: VideoDeps): Promise<FlowResult>;
export type MusicChoice = {
    ok: true;
    music: boolean | undefined;
} | {
    ok: false;
    line: string;
};
export declare function planMusicChoice(occurrences: FlagOccurrence[]): MusicChoice;
export declare function planVideoStart(flags: Record<string, string | boolean>, occurrences: FlagOccurrence[]): VideoStartPlan;
export declare function startScriptFlow(opts: ScriptStartOptions, deps: VideoDeps): Promise<FlowResult>;
export declare function waitFlow(runId: string, opts: {
    json: boolean;
    url?: string;
    intervalMs?: number;
    maxPolls?: number;
    onProgressLine?: (line: string) => void;
}, deps: VideoDeps): Promise<FlowResult>;
export declare function statusFlow(runId: string, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export declare const ONE_TAKE_FILMED_AGAIN_CODE = "one-take-filmed-again";
export declare const COST_LEAVES_OUT = "Not in it: what was made before the run, such as a swipe's script and people.";
export declare function runCostLine(run: Pick<VideoRun, "costUsd" | "costScope" | "isTerminal">, items: readonly NodeItem[]): string | null;
export declare const ONE_TAKE_HEARD_AS_CODE = "one-take-words-heard-as";
export declare const ONE_TAKE_LABEL_CODES: readonly ["one-take-label-flipped", "one-take-label-unsure", "one-take-label-held", "one-take-label-flipped-all"];
export declare const ONE_TAKE_SAID_WRONG_CODES: readonly ["one-take-said-wrong", "one-take-second-listen-failed"];
export declare function directorLines(director: RunDirector): string[];
export type DirectorSwitch = boolean | null;
export declare function parseDirectorSwitch(word: string | undefined): {
    on: DirectorSwitch;
} | null;
export declare function directorFlow(runId: string, on: DirectorSwitch, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export declare function rejectedDraftFlow(runId: string, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export declare function storyboardFlow(runId: string, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export declare function quoteFlow(runId: string, json: boolean, deps: VideoDeps, privateExport?: boolean): Promise<FlowResult>;
export declare function approveFlow(runId: string, opts: {
    json: boolean;
    approveStaleCut: boolean;
    acceptFindings?: boolean;
    requestQuoteHash?: string;
    auditionDigest?: string;
}, deps: VideoDeps): Promise<FlowResult>;
export interface PicksPicture {
    n: number;
    model: string;
    imageUrl?: string;
}
export interface PicksStyleCard {
    title: string;
    moves: string;
    slots: {
        look: string;
        camera: string;
        staging: string;
        actors: string;
    };
}
export interface PicksView {
    runId: string;
    parked: boolean;
    options: {
        people: Array<{
            who: string;
            description: string;
            lines: number;
            faces: PicksPicture[];
            voices: Array<{
                n: number;
                voiceId: string;
                name: string;
                sampleUrl?: string;
            }>;
            faceRedos: number;
        }>;
        places: Array<{
            place: string;
            word?: string;
            from: "script" | "terrain";
            rooms: PicksPicture[];
            roomRedos: number;
        }>;
        styles?: string[];
        drawnAt: number;
    } | null;
    choice: {
        faces: Array<{
            who: string;
            n: number;
        }>;
        voices: Array<{
            who: string;
            voiceId: string;
            label?: string;
            n?: number;
        }>;
        rooms: Array<{
            place: string;
            n: number;
        }>;
        style?: string;
        note?: string;
    } | null;
    open: string[];
    pickedAt: number | null;
    redoing: string | null;
    styleCards?: Record<string, PicksStyleCard>;
    mapNote?: string;
}
export interface PickReceipt {
    done: boolean;
    open: string[];
}
export declare function picksLines(view: PicksView, runId: string, runUrl: string): string[];
export declare function picksFlow(runId: string, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export interface PickRequest {
    faces: Array<{
        who: string;
        n: number;
    }>;
    voices: Array<{
        who: string;
        voice: string;
    }>;
    rooms: Array<{
        place: string;
        n: number;
    }>;
    moves: Array<{
        who: string;
        x: number;
        y: number;
    }>;
    style?: string;
    note?: string;
}
export declare function parsePickFlags(occurrences: FlagOccurrence[]): {
    ok: true;
    request: PickRequest;
} | {
    ok: false;
    line: string;
};
export declare function pickFlow(runId: string, request: PickRequest, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export declare function redoPicksFlow(runId: string, slot: string, note: string | undefined, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export interface MapPlaceView {
    place: string;
    timeOfDay: string;
    bounds: {
        x0: number;
        y0: number;
        x1: number;
        y1: number;
    };
    people: Array<{
        who: string;
        name: string;
        x: number;
        y: number;
        side: string;
        faces: string | null;
    }>;
    things: Array<{
        what: string;
        x: number;
        y: number;
        far?: true;
    }>;
    setups: Array<{
        setup: string;
        scenes: number[];
        people: string[];
    }>;
    redraw: Array<{
        sceneIndex: number;
        setup?: string;
        shares: number[];
    }>;
    pictures: number;
    usd: {
        low: number;
        high: number;
    } | null;
}
export interface MapView {
    runId: string;
    movable: boolean;
    places: MapPlaceView[];
}
export declare function mapLines(view: MapView, runId: string, runUrl: string): string[];
export interface MoveRequest {
    moves: Array<{
        who: string;
        x: number;
        y: number;
    }>;
    place?: string;
    note?: string;
}
export interface MoveReceipt {
    place: string;
    moved: Array<{
        name: string;
        from: {
            x: number;
            y: number;
        };
        to: {
            x: number;
            y: number;
        };
    }>;
    unchanged?: true;
    redrawing: Array<{
        sceneIndex: number;
        setup?: string;
        shares: number[];
    }>;
    notStarted: Array<{
        sceneIndex: number;
        why: string;
    }>;
    usd: {
        low: number;
        high: number;
    } | null;
}
export declare function parseMoveFlags(occurrences: FlagOccurrence[]): {
    ok: true;
    request: MoveRequest;
} | {
    ok: false;
    line: string;
};
export declare function moveFlow(runId: string, request: MoveRequest, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export declare function mapFlow(runId: string, place: string | undefined, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export declare function flagFlow(runId: string, note: string, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export declare function retryFrameFlow(runId: string, nodeId: string | undefined, sceneIndex: number, note: string | undefined, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export declare const BROLL_EDIT_STALE_MS: number;
export type BrollEditAsk = {
    op: "add";
    lineId: string;
    note?: string;
} | {
    op: "move";
    sceneIndex: number;
    lineId: string;
    note?: string;
} | {
    op: "remove";
    sceneIndex: number;
};
export type BrollCommand = {
    kind: "list";
    runId: string;
} | {
    kind: "edit";
    runId: string;
    edit: BrollEditAsk;
} | {
    kind: "usage";
    line: string;
};
export declare function planBrollCommand(rest: readonly string[], flags: Record<string, string | boolean>): BrollCommand;
export declare function brollFlow(runId: string, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export declare function brollEditFlow(runId: string, edit: BrollEditAsk, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export type ClipRedoPlan = {
    ok: true;
    nodeId: string;
    sceneIndex: number;
    attempt: number;
    warnings: string[];
} | {
    ok: false;
    reason: string;
};
export interface ClipRedoTarget {
    sceneIndex: number;
    nodeId?: string;
}
export declare function planClipRedo(run: VideoRun, items: NodeItem[], target: ClipRedoTarget): ClipRedoPlan;
export interface ClipRedoOptions {
    note?: string;
    voiceFirst?: boolean;
}
export declare function retryClipFlow(runId: string, target: ClipRedoTarget, { note, voiceFirst }: ClipRedoOptions, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export declare const VOICE_PATHS_NEVER_HEARD: Set<string>;
export declare function planClipRevoice(run: VideoRun, items: NodeItem[], target: ClipRedoTarget): ClipRedoPlan;
export type RevoiceTarget = ClipRedoTarget | {
    all: true;
};
export declare function keepFlow(runId: string, sceneIndex: number, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export declare function revoiceFlow(runId: string, target: RevoiceTarget, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export interface CastVoiceRow {
    characterId: string;
    name: string;
    voice: {
        voiceId: string;
        label?: string;
    } | null;
    voiceFrom?: "own-pin" | "planner-pick" | "run-default";
    availability?: {
        state: "available";
        providerName: string;
    } | {
        state: "missing";
    } | {
        state: "not-checked";
        why: string;
    };
    description?: string;
    fit?: {
        note: string;
        clash: boolean;
    };
    catalogPicks?: Array<{
        voiceId: string;
        name: string;
        fit?: {
            note: string;
            clash: boolean;
        };
    }>;
    spokenScenes: number;
    spokenSeconds: number;
}
export interface CastVoiceSheet {
    runId: string;
    canChange: boolean;
    whyNot?: string;
    cast: CastVoiceRow[];
    narrator: {
        voiceId: string;
        label?: string;
    } | null;
    treatment: {
        kind?: string;
        path?: string | null;
        usesElevenLabs?: boolean;
        summary: string;
        provider: string;
        model: string;
        speedChange: boolean;
        costNote: string;
        usage: {
            clips: number;
            seconds: number;
        };
    };
    notices: string[];
    changed?: string[];
}
export type VoiceMap = Record<string, string | {
    voiceId: string;
    label?: string;
} | null>;
export declare function parseVoiceFlags(occurrences: FlagOccurrence[], readFile: (path: string) => string): VoiceMap | null;
export interface CatalogVoiceEntry {
    voiceId: string;
    name: string;
    gender: string;
    age: string;
    accent: string;
    qualities: string[];
    characterVoice: boolean;
}
export declare function voiceCatalogFlow(runId: string | undefined, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export declare function voicesFlow(runId: string, voices: VoiceMap | null, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export declare const VOICE_CLASH_HINT: string;
export declare function voiceSheetLines(sheet: CastVoiceSheet): string[];
export interface CustomerManifest {
    runId: string;
    pulledAt: string;
    dashboardUrl: string;
    scenes: Array<{
        index: number;
        clip: string | null;
        voice: string | null;
    }>;
    music: string | null;
    video: string | null;
}
export declare function planCustomerPull(run: CustomerRun, items: CustomerItem[], meta: {
    pulledAt: string;
    dashboardUrl: string;
}): {
    downloads: PullDownload[];
    manifest: CustomerManifest;
};
export declare function pullFlow(runId: string, dir: string, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export declare function parseMvhdDurationSec(bytes: Uint8Array): number | null;
export declare const NO_DURATION_MESSAGE: string;
export declare function describeFetchFailure(err: unknown): string;
export interface CutScene {
    scene: number;
    startSec: number;
    seconds: number;
}
export interface CutWord {
    text: string;
    start: number;
    end: number;
    scene: number;
}
export declare function cutSidecars(filePath: string, deps: VideoDeps): {
    cutScenes?: CutScene[];
    cutWords?: CutWord[];
    finalSourceMap?: unknown;
};
export declare function uploadFlow(runId: string, filePath: string, durationFlag: string | undefined, json: boolean, deps: VideoDeps, options?: {
    bindFinalBytes?: boolean;
}): Promise<FlowResult>;
export interface ReviewOptions {
    verdict: "accept" | "reject";
    file: string;
    resolutions: Array<{
        findingKey: string;
        resolution: "accepted-as-is" | "waived" | "fixed";
        note: string;
    }>;
    disagreements: Array<{
        findingKey: string;
        note: string;
    }>;
    humanListens?: Array<{
        scope?: "selected-take" | "final-file";
        sceneIndex?: number;
        term: string;
        speaker: string;
        heard: string;
        accepted: boolean;
    }>;
    gradeVersion?: string;
    mediaVersion?: string;
}
export declare function parseReviewFlags(flags: Record<string, string | boolean>, occurrences: FlagOccurrence[]): {
    ok: true;
    opts: ReviewOptions;
} | {
    ok: false;
    line: string;
};
export declare function reviewFlow(runId: string, opts: ReviewOptions & {
    json: boolean;
}, deps: VideoDeps): Promise<FlowResult>;
export declare function songListenFlow(runId: string, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export declare function songApproveFlow(runId: string, masterSha256: string, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export interface SongImportOptions {
    file: string;
    lyric: string;
    rights: string;
    trim?: {
        from: number;
        to: number;
    };
}
export declare function songImportFlow(runId: string, opts: SongImportOptions, json: boolean, deps: VideoDeps): Promise<FlowResult>;
export declare function parsePositional(args?: string[]): string[];
export declare function run(flags: Record<string, string | boolean>, occurrences: FlagOccurrence[]): Promise<void>;
export {};
