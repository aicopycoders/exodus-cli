import type { FlagOccurrence } from "../lib/args.js";
import type { ApiResponse } from "../lib/client.js";
import { type FlowResult, type VideoDeps } from "./video.js";
export declare const SWIPE_BREAKDOWNS_PATH = "/api/v2/video/breakdowns";
export declare const SWIPE_UPLOAD_URL_PATH = "/api/v2/video/breakdowns/upload-url";
export declare const SWIPE_TEMPLATE_PATH = "/api/v2/video/swipe-template";
export declare const SWIPE_PRODUCTS_PATH = "/api/v2/video/swipe-products";
export declare const SWIPES_PATH = "/api/v2/video/swipes";
export declare const SWIPE_RUNS_PATH = "/api/v2/video/swipe-runs";
export declare const SWIPE_SHEET_PATH = "/api/v2/video/swipe-sheet";
export declare const SWIPE_LIBRARY_PATH = "/api/v2/swipe-library";
export interface SwipeBreakdown {
    _id: string;
    sourceKind: "url" | "file" | "ad";
    sourceUrl: string | null;
    fileName: string | null;
    status: "queued" | "running" | "done" | "failed";
    error: string | null;
    steps: Array<{
        id: string;
        label: string;
        status: "waiting" | "running" | "done" | "failed";
    }>;
    spentUsd: number | null;
    costIsEstimate: boolean;
    reused: boolean;
}
export interface SwipeFull {
    source: {
        advertiser?: string;
        durationSec: number;
        aspectRatio: string;
    };
    footage: {
        shots: Array<{
            id: string;
            start: number;
            end: number;
            kind: "aroll" | "cutaway";
            shotSize: string;
            camera: string;
            description: string;
        }>;
    };
    buildSheet: {
        cast: Array<{
            characterId: string;
            name: string;
            embodiment: "on-screen" | "voice-only" | "behind-camera";
            look: string;
            voice: string;
        }>;
        script: Array<{
            lineId: string;
            speakerId: string | null;
            start: number;
            end: number;
            text: string;
        }>;
    };
    warnings: string[];
}
export interface SwipeTemplateView {
    kind: {
        key: string;
        label: string;
        why: string;
    };
    look: {
        slug: string;
        label: string;
        why: string;
    };
    lines: number;
    seconds: number;
}
export interface SwipeDraft {
    script: string;
    conceit: string;
    style: string;
    direction: string;
    note: {
        kept: string;
        changed: string;
    };
    lengthGap?: {
        ours: number;
        theirs: number;
    };
}
export interface SwipeView {
    _id: string;
    breakdownId: string;
    productId: string;
    request: {
        mode: ServerMode;
        closeness?: number;
        look?: string;
        memberScript?: string;
    };
    kind?: string;
    outcome: {
        kind: "written";
        draft: SwipeDraft;
    } | {
        kind: "refused";
        why: string;
    };
    checksFound?: string[];
    workflowRunId: string | null;
    costUsd: number | null;
    runHoldsStart?: boolean;
}
export interface SwipeListRow {
    _id: string;
    breakdownId: string;
    createdAt?: number;
    request: {
        mode: ServerMode;
        closeness?: number;
    };
    workflowRunId: string | null;
    source: {
        sourceKind: string;
        sourceUrl?: string;
        fileName?: string;
        sourceAdId?: string;
    } | null;
    outcome?: {
        kind: "written" | "refused";
    };
    costUsd?: number | null;
    product?: {
        id: string;
        name: string;
    } | null;
}
export type SheetFrom = "you" | "their-ad" | "kind";
export interface SavedSheetRow {
    id: string;
    label: string;
    value: string | number | boolean | null;
    from: SheetFrom | null;
    why: string | null;
    options: Array<{
        id: string;
        label: string;
    }> | null;
    optionsCostUsd: number | null;
    usedBy: string | null;
    readOnly: boolean;
}
export interface SavedSheet {
    swipeId: string;
    kind: {
        key: string;
        label: string;
    } | null;
    run: {
        id: string;
    } | null;
    sections: Array<{
        id: string;
        label: string;
        rows: SavedSheetRow[];
    }>;
    startRefusal?: string;
}
type ServerMode = "whole" | "hook" | "their-format" | "new-look";
export declare const SWIPE_MODES: ReadonlyArray<{
    flag: string;
    mode: ServerMode;
    label: string;
    helper: string;
}>;
export declare const SWIPE_CLOSENESS: ReadonlyArray<{
    step: number;
    flag: string;
    name: string;
    line: string;
}>;
export declare const DEFAULT_CLOSENESS = 2;
export declare const NO_PRICE = "The CLI prints no price for this step.";
export type PaidStep = "breakdown" | "template" | "write" | "start" | "start-one-shot";
export declare const PAID: Record<PaidStep, {
    buys: string;
    paidBy: string;
}>;
export declare function needsYesResult(step: PaidStep, json: boolean, choice?: string[]): FlowResult;
export type SwipeSource = {
    kind: "file";
    file: string;
} | {
    kind: "url";
    url: string;
} | {
    kind: "ad";
    swipeAdId: string;
};
export interface WriteAsk {
    productId: string;
    mode: ServerMode;
    closeness: number;
    look?: string;
    scriptFile?: string;
    scriptText?: string;
    kind?: string;
}
export interface StartAsk {
    style?: string;
    title?: string;
    music: boolean;
    oneShot: boolean;
}
export interface SwipeOpts {
    json: boolean;
    yes: boolean;
    wait: boolean;
}
export type SwipePlan = {
    kind: "usage";
    line: string;
} | {
    kind: "breakdown";
    source: SwipeSource;
    opts: SwipeOpts;
} | {
    kind: "status";
    breakdownId: string;
    full: boolean;
    opts: SwipeOpts;
} | {
    kind: "template";
    breakdownId: string;
    opts: SwipeOpts;
} | {
    kind: "products";
    opts: SwipeOpts;
} | {
    kind: "write";
    breakdownId: string;
    ask: WriteAsk;
    opts: SwipeOpts;
} | {
    kind: "show";
    swipeId: string;
    opts: SwipeOpts;
} | {
    kind: "list";
    opts: SwipeOpts;
} | {
    kind: "find";
    ask: FindAsk;
    opts: SwipeOpts;
} | {
    kind: "start";
    swipeId: string;
    ask: StartAsk;
    again: boolean;
    opts: SwipeOpts;
} | {
    kind: "sheet";
    swipeId: string;
    opts: SwipeOpts;
} | {
    kind: "sheet-set";
    swipeId: string;
    picks: Record<string, string | null>;
    opts: SwipeOpts;
} | {
    kind: "run";
    sheetFile: string;
    retryRefused: boolean;
    status: boolean;
    persona: string | null;
    opts: SwipeOpts;
};
export declare function parseSwipeMode(value: string): ServerMode | null;
export declare function parseCloseness(value: string): number | null;
export declare function planSwipeCommand(rest: string[], occurrences: FlagOccurrence[]): SwipePlan;
export declare const SHEET_ROW_ID: RegExp;
export interface ChoiceWords {
    who: string;
    flag: (name: string) => string;
    set: (name: string, value: string) => string;
}
type Given = string | undefined | null;
export declare function writeChoicesOf(given: {
    mode: Given;
    closeness: Given;
    look: Given;
    script: Given;
}, words: ChoiceWords): {
    ask: Omit<WriteAsk, "productId">;
} | {
    problem: string;
};
export declare function startChoicesOf(given: {
    style: Given;
    title: Given;
    music: boolean;
    oneShot: boolean;
}, words: ChoiceWords): {
    ask: StartAsk;
} | {
    problem: string;
};
export interface SwipeRunOptions extends SwipeOpts {
    onProgressLine?: (line: string) => void;
    onJob?: (job: string) => void;
    beforePaidAsk?: () => void;
}
export declare function swipeBreakdownFlow(source: SwipeSource, opts: SwipeRunOptions, deps: VideoDeps): Promise<FlowResult>;
export declare function swipeStatusFlow(breakdownId: string, opts: SwipeRunOptions, deps: VideoDeps, full?: boolean): Promise<FlowResult>;
export declare function fullLines(data: Record<string, unknown>): string[];
export declare function swipeTemplateFlow(breakdownId: string, opts: SwipeRunOptions, deps: VideoDeps): Promise<FlowResult>;
export declare function swipeProductsFlow(opts: SwipeOpts, deps: VideoDeps): Promise<FlowResult>;
export declare const FIND_READ = 200;
export declare const FIND_PAID_FLAGS: readonly ["yes", "wait", "file", "url", "ad", "again"];
export declare const FIND_OTHER_FLAGS: readonly ["one-shot", "music", "mode", "closeness", "product", "look", "script", "style", "title", "sheet", "full", "status", "persona", "retry-refused", "kind"];
export declare const FIND_KIND_LINE = "The kind of an ad is known only after it is read.";
export declare const FIND_EMPTY_LIBRARY = "The swipe library has no ads yet for this brand.";
export interface FindAsk {
    brand: string | null;
    limit: number;
}
export interface SwipeLibraryRow {
    _id: string;
    brandName?: string;
    format?: string;
    transcript?: string;
    bodyText?: string;
    headline?: string;
    ctaText?: string;
    imageUrl?: string;
    videoUrl?: string;
}
export interface SwipeCandidate {
    n: number;
    id: string;
    advertiser: string | null;
    firstLine: string | null;
    firstLineFrom: "transcript" | "post text" | null;
    words: number | null;
    text: string | null;
}
export interface SwipeCandidates {
    read: number;
    wholeLibrary: boolean;
    videos: number;
    competitors: number;
    candidates: SwipeCandidate[];
    allVideos: number;
    advertisers: string[];
}
export declare function swipeCandidatesOf(rows: unknown[], ask: FindAsk): SwipeCandidates;
export declare function swipeFindFlow(ask: FindAsk, opts: SwipeOpts, deps: VideoDeps): Promise<FlowResult>;
export declare function swipeWriteFlow(breakdownId: string, ask: WriteAsk, opts: SwipeRunOptions, deps: VideoDeps): Promise<FlowResult>;
export declare function swipeShowFlow(swipeId: string, opts: SwipeOpts, deps: VideoDeps): Promise<FlowResult>;
export declare function swipeListFlow(opts: SwipeOpts, deps: VideoDeps): Promise<FlowResult>;
export declare function sheetLines(sheet: SavedSheet, dashboardUrl: string): string[];
export declare function swipeSheetReadFlow(swipeId: string, opts: SwipeOpts, deps: VideoDeps): Promise<FlowResult>;
export declare function swipeSheetSetFlow(swipeId: string, picks: Record<string, string | null>, opts: SwipeOpts, deps: VideoDeps): Promise<FlowResult>;
export declare const SWIPE_ALREADY_STARTED_CODE = "SWIPE_ALREADY_STARTED";
export declare function alreadyStartedOf(res: ApiResponse<unknown>): {
    runId: string;
    url: string;
} | null;
export declare function swipeStartFlow(swipeId: string, ask: StartAsk, opts: SwipeRunOptions, deps: VideoDeps, again?: boolean): Promise<FlowResult>;
export declare const SHEET_FIELDS: readonly ["sources", "product", "personas", "mechanism", "guidance", "mode", "closeness", "look", "script", "kind", "characters", "finish", "oneShot", "style", "title", "music"];
export declare const SHEET_VIDEO_WARNING = 6;
export interface SheetSource {
    key: string;
    given: {
        url: string;
    } | {
        ad: string;
    } | {
        file: string;
    };
    source: SwipeSource;
}
interface SheetWrite {
    ask: Omit<WriteAsk, "productId">;
    scriptSha256: string | null;
}
export interface SheetPersona {
    name: string;
    script: string | null;
    write: SheetWrite | null;
}
export interface SheetCharacter {
    index: number;
    pick: {
        elements: unknown[];
        voices: unknown[];
    } | null;
}
export interface SwipeSheet {
    sources: SheetSource[];
    productId: string | null;
    personas: SheetPersona[];
    write: SheetWrite | null;
    unusedChoices: string[];
    characters: SheetCharacter[];
    start: StartAsk;
    notUsed: string[];
    moved: string[];
    kind: string | null;
}
export interface SheetVideo {
    n: number;
    source: SheetSource;
    persona: SheetPersona | null;
    character: SheetCharacter;
}
export interface WrittenWith {
    productId: string;
    mode: ServerMode;
    closeness: number | null;
    look: string | null;
    scriptSha256: string | null;
    kind?: string;
}
export type SheetStep = "breakdown" | "template" | "write" | "start";
export interface SourcePending {
    step: "breakdown" | "template";
    at: string;
    job?: string;
}
export interface WritePending {
    at: string;
    job?: string;
    asked?: WrittenWith;
}
export interface StartPending {
    at: string;
    swipeId: string;
    serverAt?: number;
}
export interface SheetRunState {
    runId: string | null;
    watch: string | null;
    pending: StartPending | null;
    lastError: string | null;
    updatedAt: string | null;
}
export interface SheetWriteState {
    swipeId: string | null;
    writtenWith: WrittenWith | null;
    refused: string | null;
    pending: WritePending | null;
    lastError: string | null;
    updatedAt: string | null;
    runs: Record<string, SheetRunState>;
}
export interface SheetSourceState {
    kind: SwipeSource["kind"];
    breakdownId: string | null;
    templateDone: boolean;
    pending: SourcePending | null;
    lastError: string | null;
    updatedAt: string | null;
    writes: Record<string, SheetWriteState>;
}
export interface SheetState {
    version: 3;
    sheet: string;
    sources: Record<string, SheetSourceState>;
}
export declare const sheetStatePath: (sheetFile: string) => string;
export declare function readSwipeSheet(sheetFile: string, deps: VideoDeps): {
    sheet: SwipeSheet;
} | {
    problem: string;
};
export declare function sheetVideos(sheet: SwipeSheet, only: string | null): {
    videos: SheetVideo[];
    personas: Array<SheetPersona | null>;
} | {
    problem: string;
};
export interface SheetFiles {
    createNew(file: string, text: string): boolean;
    remove(file: string): void;
    writeAtomic(file: string, text: string): void;
    pid: number;
    host: string;
    isAlive(pid: number): boolean;
    realPath(file: string): string;
    listDir(dir: string): string[];
    onStop(cleanup: () => void): () => void;
}
export type SheetDeps = VideoDeps & {
    sheetFiles?: SheetFiles;
};
export declare const nodeSheetFiles: SheetFiles;
export declare const sheetLockPath: (sheetFile: string) => string;
export declare const sheetTakeoverPath: (sheetFile: string) => string;
export type SheetVideoState = "not started" | "breakdown" | "template" | "written" | "refused" | "running" | "storyboard" | "waiting" | "done" | "failed" | "unread";
export interface SheetFlowOptions extends SwipeRunOptions {
    retryRefused: boolean;
    status: boolean;
    persona: string | null;
}
export declare function swipeSheetFlow(given: string, opts: SheetFlowOptions, deps: VideoDeps): Promise<FlowResult>;
export declare function runSwipePlan(plan: Exclude<SwipePlan, {
    kind: "usage";
}>, deps: VideoDeps, onProgressLine?: (line: string) => void): Promise<FlowResult>;
export {};
