import { type ApiResponse } from "../lib/client.js";
import type { FlagOccurrence } from "../lib/args.js";
import { type PollOptions, type PollResult } from "../lib/poll.js";
import { LEGACY_WORKFLOW_RUN_STATUS_VALUES, type RunStatus } from "../lib/runStatus.js";
import { type RunDeliverySummary } from "../lib/runVerdict.js";
import { type Channel } from "../lib/channel.js";
import { type VoiceMap } from "./video.js";
export declare const helpText: string;
export type WorkflowNodeKind = "brief" | "brief-form" | "asset" | "bot" | "primer" | "image" | "image-rig" | "rig" | "storyboard" | "reference" | "scene-frames" | "video" | "voiceover" | "output" | "call" | "show-set" | "show-cast" | "show-voices" | "product-truth" | "transform" | "formatter" | "splitter" | "collector" | "checkpoint" | "prompt";
export type WorkflowSlotState = "locked" | "auto" | "ask" | "inferred";
export interface WorkflowSlot {
    id: string;
    label: string;
    state: WorkflowSlotState;
    nodeId: string;
    configKey: string;
    value?: string;
    hint?: string;
}
export interface WorkflowNode {
    id: string;
    kind: WorkflowNodeKind;
    position: {
        x: number;
        y: number;
    };
    config: Record<string, unknown>;
}
export interface WorkflowEdge {
    id: string;
    source: string;
    sourceHandle: string;
    target: string;
    targetHandle: string;
}
export type WorkflowTriggerEvent = "winner-promoted";
export interface ImageRigLineOverride {
    count?: number;
    aspects?: string[];
    adType?: string;
    style?: string;
    memeFormat?: string;
    steering?: string;
    copyPin?: string;
}
export interface ImageRigPlanOverride {
    lines?: unknown[];
    steering?: string;
    defaultAspects?: string[];
    defaultStyle?: string;
    model?: string;
    confirmLargeRun?: boolean;
}
export interface ImageRigNodeOverride {
    plan?: ImageRigPlanOverride;
    lines?: Record<string, ImageRigLineOverride>;
    confirmLargeRun?: boolean;
    model?: string;
}
export type ImageRigOverrides = Record<string, ImageRigNodeOverride>;
export interface VoiceRequest {
    who: string;
    choice: {
        kind: "pin";
        voiceId: string;
        label?: string;
    } | {
        kind: "clear";
    };
}
export type TriggerVoiceMap = Record<string, string | {
    voiceId: string;
    label?: string;
} | null>;
export type WorkflowTrigger = {
    type: "event";
    event: WorkflowTriggerEvent;
    enabled: boolean;
    imageRigOverrides?: ImageRigOverrides;
    voices?: VoiceRequest[];
} | {
    type: "cron";
    cron: string;
    enabled: boolean;
    imageRigOverrides?: ImageRigOverrides;
    voices?: VoiceRequest[];
};
type WithoutVoices<T> = T extends unknown ? Omit<T, "voices"> : never;
export type WorkflowContractTrigger = WithoutVoices<WorkflowTrigger> & {
    voices?: TriggerVoiceMap;
};
export interface WorkflowContractJson {
    contract: "exodus-workflow";
    version: number;
    workflowId?: string;
    updatedAt?: string;
    name: string;
    description?: string;
    slots?: WorkflowSlot[];
    triggers?: WorkflowContractTrigger[];
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
}
export interface UnresolvedWorkflowRef {
    nodeId: string;
    ref: "persona" | "primer";
    value: string;
    message: string;
}
export interface WorkflowImportResult {
    name: string;
    created: boolean;
    workflowId?: string;
    nodeCount: number;
    edgeCount: number;
    triggers?: WorkflowTrigger[];
    unresolved: UnresolvedWorkflowRef[];
    warnings: string[];
}
export type GraphIssueCode = "bad-shape" | "unknown-kind" | "duplicate-node-id" | "dangling-edge" | "unknown-port" | "type-mismatch" | "duplicate-input" | "duplicate-input-key" | "cycle" | "missing-required-input" | "bad-config" | "bad-slot" | "bad-trigger" | "nested-split" | "fan-overlap" | "lane-ineligible" | "fan-image-budget" | "collector-unpaired" | "splitter-field-conflict" | "competitor-source";
export interface GraphIssue {
    code: GraphIssueCode;
    message: string;
    nodeId?: string;
    edgeId?: string;
    portId?: string;
    remedy?: string;
}
export type WorkflowImportErrorCode = "invalid-graph" | "conflict" | "forbidden" | "not-found";
export interface WorkflowImportError {
    code: WorkflowImportErrorCode;
    message: string;
    issues?: GraphIssue[];
    currentUpdatedAt?: string;
}
export type WorkflowPortType = "text" | "primer" | "image" | "rig" | "storyboard" | "frames" | "video" | "audio" | "document" | "show" | "session";
export type WorkflowPrimerKind = "body" | "hook" | "headline" | "summary";
export type WorkflowDurationSpec = {
    kind: "fixed";
    values: number[];
} | {
    kind: "range";
    min: number;
    max: number;
};
export interface CatalogVideoModel {
    id: string;
    label: string;
    durations: WorkflowDurationSpec;
    audioTogglable: boolean;
    aspectRatios: string[];
    resolutions: string[];
}
export type WorkflowParamKind = "select" | "text" | "textarea" | "toggle" | "number" | "multiselect";
export interface CatalogInput {
    id: string;
    label: string;
    accepts: WorkflowPortType[];
    required: boolean;
    multi?: boolean;
    primerKinds?: WorkflowPrimerKind[];
}
export interface CatalogParam {
    key: string;
    label: string;
    kind: WorkflowParamKind;
    options?: string[];
    min?: number;
    max?: number;
    required?: boolean;
    help?: string;
    default?: string;
}
export interface CatalogBot {
    slug: string;
    name: string;
    blurb: string;
    category: string;
    categoryLabel: string;
    inputs: CatalogInput[];
    params: CatalogParam[];
    outputType: string;
}
export interface WorkflowCatalog {
    catalog: "exodus-workflow-catalog";
    version: 1;
    bots: CatalogBot[];
    vocabulary: {
        nodeKinds: string[];
        briefSources: string[];
        primerKinds: string[];
        primerAwarenessLanes: string[];
        imageModels: string[];
        aspectRatios: string[];
        imageQuantityModes: string[];
        videoModels: CatalogVideoModel[];
        categories: Array<{
            id: string;
            label: string;
        }>;
    };
    customBot: {
        slug: "custom";
        configKey: "customSlug";
        inputs: CatalogInput[];
        summaryOnlySlugs: string[];
        notes: string;
    };
    promptBot: {
        slug: "prompt";
        configKey: "promptText";
        inputs: CatalogInput[];
        notes: string;
    };
}
export type WorkflowBriefSource = "text" | "swipe-ad" | "swipe-bundle" | "organic-url" | "ad-url";
export type WorkflowMediaType = "image" | "video" | "audio" | "document";
export type WorkflowEntryFieldType = "text" | "select" | "number" | "toggle" | "multi-select";
export interface WorkflowInputDescriptor {
    fieldName: string;
    nodeId: string;
    label?: string;
    source: WorkflowBriefSource | "asset";
    required: boolean;
    description?: string;
    type?: WorkflowEntryFieldType;
    options?: string[];
    allowOther?: boolean;
    optionsSource?: string;
    bundleSize?: number;
    assetType?: WorkflowMediaType;
}
export interface WorkflowPrerequisiteDescriptor {
    primerKind: WorkflowPrimerKind;
    nodeIds: string[];
}
export interface WorkflowOutputDescriptor {
    type: "text" | "image" | "video" | "audio" | "document" | "frames" | "storyboard";
    label: string;
    nodeId: string;
    botSlug?: string;
    port?: string;
}
export interface WorkflowDeliveryDescriptor {
    key: string;
    label: string;
    type: WorkflowOutputSlotType;
    description?: string;
    order: number;
}
export interface WorkflowDescribeResponse {
    workflowId: string;
    name: string;
    description?: string;
    updatedAt: string;
    inputs: WorkflowInputDescriptor[];
    prerequisites: Array<WorkflowPrerequisiteDescriptor & {
        stored: boolean;
    }>;
    outputs: WorkflowOutputDescriptor[];
    deliveries?: WorkflowDeliveryDescriptor[];
    warnings?: string[];
}
export interface WorkflowTemplateListItem {
    key: string;
    label: string;
    description: string;
    module?: string;
}
export interface WorkflowTemplatesResponse {
    templates: WorkflowTemplateListItem[];
}
export interface WorkflowListItem {
    _id: string;
    name: string;
    description?: string;
    nodeCount: number;
    edgeCount: number;
    createdAt: string;
    updatedAt: string;
    isCrossBrand?: boolean;
    homeBrandName?: string | null;
}
export interface WorkflowListResponse {
    workflows: WorkflowListItem[];
}
export interface WorkflowVersion {
    version: number;
    name: string;
    savedAt: string;
    savedByName?: string;
}
export interface WorkflowVersionsResponse {
    versions: WorkflowVersion[];
}
export type WorkflowRunStatus = RunStatus | (typeof LEGACY_WORKFLOW_RUN_STATUS_VALUES)[number];
export type WorkflowNodeRunStatus = "idle" | "running" | "done" | "failed" | "skipped";
export interface ArtifactItemIdentity {
    index: number;
    total: number;
}
export type WorkflowArtifact = {
    type: "text";
    text: string;
    label?: string;
    port?: string;
    humanEdited?: boolean;
    item?: ArtifactItemIdentity;
} | {
    type: "primer";
    text: string;
    primerKind: string;
    item?: ArtifactItemIdentity;
} | {
    type: "image";
    storageId: string;
    imageUrl?: string;
    item?: ArtifactItemIdentity;
} | {
    type: "session";
    sessionId: string;
    label?: string;
    port?: string;
    item?: ArtifactItemIdentity;
};
export interface WorkflowRunOutput {
    nodeId: string;
    botSlug?: string;
    type: "text" | "image" | "video" | "audio" | "document" | "frames" | "storyboard";
    label: string;
    text?: string;
    imageUrl?: string;
    imageId?: string;
    videoUrl?: string;
    audioUrl?: string;
    durationSec?: number;
    sceneIndex?: number;
    final?: boolean;
    words?: Array<{
        w: string;
        s: number;
        e: number;
    }>;
    frames?: Array<{
        sceneIndex: number;
        imageUrl?: string;
    }>;
    storyboardJson?: string;
    documentUrl?: string;
    filename?: string;
    mimeType?: string;
    humanEdited?: boolean;
    originalText?: string;
    originalImageUrl?: string;
    originalVideoUrl?: string;
}
export type WorkflowOutputSlotType = "text" | "structured" | "asset" | "collection";
export interface WorkflowRunDelivery {
    key: string;
    label: string;
    type: WorkflowOutputSlotType;
    description?: string;
    order: number;
    nodeId: string;
    status: "delivered" | "unfulfilled";
    error?: string;
    artifacts: WorkflowRunOutput[];
}
export interface WorkflowRunNode {
    nodeId: string;
    kind: string;
    botSlug?: string;
    status: WorkflowNodeRunStatus;
    error?: string;
    startedAt?: number;
    completedAt?: number;
    outputs: WorkflowArtifact[];
}
export interface WorkflowCounts {
    done: number;
    failed: number;
    skipped: number;
    total: number;
}
export interface WorkflowRunSession {
    sessionId: string;
    nodeId: string;
    title: string;
    botSlug: string;
}
export type WorkflowPauseReason = "taste" | "repair" | "slots" | "call" | "checkpoint";
export interface WorkflowPendingSlot {
    id: string;
    label?: string;
    state?: string;
    nodeId?: string;
    configKey?: string;
    value?: string;
    hint?: string;
}
export interface RunFormatProvenance {
    via: "show" | "rig-node";
    nodeId?: string;
    rigId: string;
    rigName: string;
    rulesFrom?: {
        rigId: string;
        rigName: string;
    };
    specVersion: string | null;
}
export type VoicePath = "sts-revoice" | "lipsync-retarget" | "native-prompt" | "omni-audio-ids" | "gemini-direct" | "voice-first";
export type RunVoiceProvenance = {
    source: "show";
    path: VoicePath;
} | {
    source: "launch";
    path: VoicePath;
    descriptions: {
        speaker: string;
        description: string;
    }[];
} | {
    source: "unreadable";
};
export interface RunProvenance {
    format: RunFormatProvenance | null;
    voice: RunVoiceProvenance | null;
}
export declare function formatRulesLine(provenance: unknown): string | undefined;
export interface WorkflowRun {
    _id: string;
    workflowId: string;
    workflowName: string;
    runTitle?: string;
    title?: string;
    moduleKey?: string;
    status: WorkflowRunStatus;
    error?: string;
    counts?: WorkflowCounts;
    inputs: Record<string, string>;
    triggerRunId?: string;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
    isTerminal: boolean;
    nodes: WorkflowRunNode[];
    outputs?: WorkflowRunOutput[];
    deliveries?: WorkflowRunDelivery[];
    deliverySummary?: RunDeliverySummary;
    sessions?: WorkflowRunSession[];
    pauseReason?: WorkflowPauseReason;
    pausedNodeId?: string;
    pendingSlots?: WorkflowPendingSlot[];
    autoApprovals?: {
        nodeId: string;
        approvedAt: number;
    }[];
    provenance?: RunProvenance;
    pauseAhead?: {
        nodeId: string;
        after: "frames" | "storyboard";
        selfApproves?: true;
    };
}
export declare function pauseAheadLine(ahead: NonNullable<WorkflowRun["pauseAhead"]>): string;
export type WorkflowRunProjection = Omit<WorkflowRun, "nodes"> & {
    nodes?: never;
};
export interface WorkflowRunDeps {
    get: (path: string) => Promise<ApiResponse<unknown>>;
    getText: (path: string) => Promise<ApiResponse<string>>;
    post: (path: string, body: unknown) => Promise<ApiResponse<unknown>>;
    readFile: (path: string) => string;
    writeFile: (path: string, text: string) => void;
    poll: (opts: PollOptions) => Promise<PollResult>;
    mkdirp?: (dir: string) => void;
    downloadToFile?: (url: string, path: string) => Promise<void>;
    postDashboard?: (path: string, body: unknown, opts?: {
        timeoutMs?: number;
    }) => Promise<ApiResponse<unknown>>;
    dashboardUrl?: string;
    statFile?: (filePath: string) => {
        size: number;
    } | null;
    readFileBytes?: (filePath: string) => Uint8Array;
    uploadBytes?: (uploadUrl: string, contentType: string, bytes: Uint8Array) => Promise<{
        ok: boolean;
        status: number;
        storageId?: string;
        body?: string;
    }>;
}
export interface FlowResult {
    code: number;
    lines: string[];
}
interface RunFlowOptions {
    inputs: Record<string, string>;
    fill?: string;
    autoApprove?: boolean;
    imageRigOverrides?: Record<string, unknown>;
    voices?: VoiceMap;
    voiceTreatment?: VoiceTreatmentBody;
    wait: boolean;
    json: boolean;
    out?: string;
    onProgressLine?: (line: string) => void;
    onWarningLine?: (line: string) => void;
}
export declare function formatPauseNotice(pauseReason: WorkflowPauseReason | undefined, runId: string, dashboardUrl: string, { workerStopped }?: {
    workerStopped?: boolean;
}): string[];
export declare function parseRawInputFlags(occurrences: FlagOccurrence[]): Record<string, string>;
export declare function parseInputFlags(occurrences: FlagOccurrence[], readFile?: (path: string) => string): Record<string, string>;
export declare const ASSET_UPLOAD_POLICY: Record<WorkflowMediaType, {
    mimeByExtension: Record<string, string>;
    maxBytes: number;
    accepts: string;
}>;
export declare const NO_DELIVERIES_WARNING: string;
export declare function noDeliveriesWarning(described: unknown): string | undefined;
export declare function serverWarningsToPrint(serverWarnings: unknown, alreadyPrinted: string[]): string[];
export declare function rejectTerminalFlag(occurrences: FlagOccurrence[]): void;
export declare function parseAutoApproveFlag(args: string[]): boolean;
export declare function parseRigOverridesFlag(occurrences: FlagOccurrence[], readFile?: (path: string) => string): Record<string, unknown> | undefined;
export declare function parseVoicesFlag(occurrences: FlagOccurrence[], readFile?: (path: string) => string): VoiceMap | undefined;
export interface VoiceTreatmentBody {
    path: string;
    describe?: Record<string, string>;
}
export declare function parseVoiceTreatmentFlag(occurrences: FlagOccurrence[], readFile?: (path: string) => string): VoiceTreatmentBody | undefined;
export declare function parseFillFlag(occurrences: FlagOccurrence[]): string | undefined;
export declare function formatWorkflowList(workflows: WorkflowListItem[]): string;
export declare function formatRecentRuns(runs: WorkflowRunProjection[]): string;
export declare function formatWorkflowVersions(versions: WorkflowVersion[]): string;
export declare function formatImportSummary(result: WorkflowImportResult, mode?: {
    dryRun?: boolean;
    update?: boolean;
    validate?: boolean;
}): string;
export declare function formatWorkflowRun(run: WorkflowRun): string;
export interface DeliverySaveResult {
    lines: string[];
    paths: string[];
}
export declare function workflowFilenameSlug(name: string): string;
export declare function saveDeliveries(run: WorkflowRun, dir: string, deps: WorkflowRunDeps): Promise<DeliverySaveResult>;
export declare function deliveryTypeWord(type: string): string;
export declare function deliveryContractLines(deliveries: WorkflowDeliveryDescriptor[] | undefined): string[];
export declare function formatDescribe(res: WorkflowDescribeResponse): string;
export declare function formatBotsList(catalog: WorkflowCatalog, category?: string): string;
export declare function formatBotDetail(bot: CatalogBot): string;
export declare function formatTemplatesList(templates: WorkflowTemplateListItem[]): string;
export declare function formatSchema(payload: Record<string, unknown>): string;
export declare function resolveWorkflowId(ref: string, deps: WorkflowRunDeps): Promise<string>;
export declare function listFlow(json: boolean, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function describeFlow(workflowRef: string, opts: {
    json: boolean;
}, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function botsFlow(opts: {
    category?: string;
    slug?: string;
    json: boolean;
}, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function voiceTreatmentLine(provenance: unknown): string | undefined;
export declare function runFlow(workflowRef: string, opts: RunFlowOptions, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function statusFlow(opts: {
    id?: string;
    json: boolean;
    out?: string;
}, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function exportFlow(workflowRef: string, opts: {
    out?: string;
    json?: boolean;
    version?: number;
}, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function parseVersionFlag(flags: Record<string, string | boolean>): number | undefined;
export declare function versionsFlow(workflowRef: string, opts: {
    json: boolean;
}, deps: WorkflowRunDeps, channel?: Channel): Promise<FlowResult>;
type AnyTrigger = WorkflowTrigger | WorkflowContractTrigger;
export declare function triggerExpect(t: AnyTrigger): {
    type: string;
    event?: string;
    cron?: string;
};
export declare function formatTriggers(triggers: AnyTrigger[]): string;
export declare function triggersListFlow(workflowRef: string, opts: {
    json: boolean;
}, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function triggersSetEnabledFlow(workflowRef: string, n: number, enabled: boolean, opts: {
    json: boolean;
}, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function triggersFireFlow(workflowRef: string, opts: {
    n?: number;
    text?: string;
    imageRigOverrides?: Record<string, unknown>;
    voices?: VoiceMap;
    wait: boolean;
    json: boolean;
    onProgressLine?: (line: string) => void;
}, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function importFlow(file: string, opts: {
    dryRun: boolean;
    json: boolean;
    update?: string;
}, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function validateFlow(file: string, opts: {
    json: boolean;
    update?: string;
}, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function templatesListFlow(json: boolean, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function templatesExportFlow(key: string, opts: {
    out?: string;
    json?: boolean;
}, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function schemaFlow(opts: {
    json: boolean;
    kind?: string;
    face?: string;
}, deps: WorkflowRunDeps): Promise<FlowResult>;
export interface WorkflowInboxRow {
    _id: string;
    workflowId: string;
    workflowName: string;
    pausedNodeId?: string;
    pausedNodeKind?: string;
    pauseReason?: "taste" | "repair" | "slots" | "checkpoint";
    counts?: WorkflowCounts;
    createdAt: number | string;
    queuedAt?: number | string;
    hasShow?: boolean;
    invocationMode?: "live" | "background";
    triggeredBy?: {
        type: "event" | "cron";
        event?: string;
    };
    pendingSlotsCount?: number;
}
export interface WorkflowInboxResponse {
    runs: WorkflowInboxRow[];
}
export declare function formatAge(value: number | string | undefined, now?: number): string;
export declare function parkBadge(pauseReason: string | undefined): string;
export declare function invocationBadge(row: WorkflowInboxRow): string;
export declare function formatInbox(rows: WorkflowInboxRow[], now?: number): string;
export declare function inboxFlow(json: boolean, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function checkpointShowFlow(runId: string, opts: {
    json: boolean;
}, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function parseRejectItems(raw: string | undefined): {
    ok: true;
    items: number[];
} | {
    ok: false;
    message: string;
};
export declare function checkpointApproveFlow(runId: string, opts: {
    wait: boolean;
    json: boolean;
    onProgressLine?: (line: string) => void;
    reject?: string;
}, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function checkpointEditFlow(runId: string, n: number, sources: {
    text?: string;
    file?: string;
    stdin?: string;
}, opts: {
    json: boolean;
}, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function checkpointRetryFlow(runId: string, opts: {
    wait: boolean;
    json: boolean;
    note?: string;
    onProgressLine?: (line: string) => void;
}, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function cancelRunFlow(runId: string, opts: {
    reason?: string;
    json: boolean;
    verb?: string;
}, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function checkpointCancelFlow(runId: string, opts: {
    reason?: string;
    json: boolean;
}, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function repairFlow(runId: string, action: "retry" | "skip" | "kill", opts: {
    wait: boolean;
    json: boolean;
    onProgressLine?: (line: string) => void;
}, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function parseSlotFlags(occurrences: FlagOccurrence[]): Record<string, string>;
export declare function answerFlow(runId: string, values: Record<string, string>, opts: {
    json: boolean;
}, deps: WorkflowRunDeps): Promise<FlowResult>;
export declare function run(flags: Record<string, string | boolean>, occurrences: FlagOccurrence[]): Promise<void>;
export {};
