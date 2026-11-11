import type { FlagOccurrence } from "../lib/args.js";
import { type FlowResult, type VideoDeps } from "./video.js";
export declare const SWIPE_BREAKDOWNS_PATH = "/api/v2/video/breakdowns";
export declare const SWIPE_UPLOAD_URL_PATH = "/api/v2/video/breakdowns/upload-url";
export declare const SWIPE_TEMPLATE_PATH = "/api/v2/video/swipe-template";
export declare const SWIPE_PRODUCTS_PATH = "/api/v2/video/swipe-products";
export declare const SWIPES_PATH = "/api/v2/video/swipes";
export declare const SWIPE_RUNS_PATH = "/api/v2/video/swipe-runs";
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
    };
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
}
export interface SwipeListRow {
    _id: string;
    breakdownId: string;
    request: {
        mode: ServerMode;
        closeness?: number;
    };
    workflowRunId: string | null;
    source: {
        sourceKind: string;
        sourceUrl?: string;
        fileName?: string;
    } | null;
    outcome?: {
        kind: "written" | "refused";
    };
    costUsd?: number | null;
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
    kind: "start";
    swipeId: string;
    ask: StartAsk;
    opts: SwipeOpts;
};
export declare function parseSwipeMode(value: string): ServerMode | null;
export declare function parseCloseness(value: string): number | null;
export declare function planSwipeCommand(rest: string[], occurrences: FlagOccurrence[]): SwipePlan;
export interface SwipeRunOptions extends SwipeOpts {
    onProgressLine?: (line: string) => void;
}
export declare function swipeBreakdownFlow(source: SwipeSource, opts: SwipeRunOptions, deps: VideoDeps): Promise<FlowResult>;
export declare function swipeStatusFlow(breakdownId: string, opts: SwipeRunOptions, deps: VideoDeps, full?: boolean): Promise<FlowResult>;
export declare function fullLines(data: Record<string, unknown>): string[];
export declare function swipeTemplateFlow(breakdownId: string, opts: SwipeRunOptions, deps: VideoDeps): Promise<FlowResult>;
export declare function swipeProductsFlow(opts: SwipeOpts, deps: VideoDeps): Promise<FlowResult>;
export declare function swipeWriteFlow(breakdownId: string, ask: WriteAsk, opts: SwipeRunOptions, deps: VideoDeps): Promise<FlowResult>;
export declare function swipeShowFlow(swipeId: string, opts: SwipeOpts, deps: VideoDeps): Promise<FlowResult>;
export declare function swipeListFlow(opts: SwipeOpts, deps: VideoDeps): Promise<FlowResult>;
export declare function swipeStartFlow(swipeId: string, ask: StartAsk, opts: SwipeRunOptions, deps: VideoDeps): Promise<FlowResult>;
export declare function runSwipePlan(plan: Exclude<SwipePlan, {
    kind: "usage";
}>, deps: VideoDeps, onProgressLine?: (line: string) => void): Promise<FlowResult>;
export {};
