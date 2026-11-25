import type { FlagOccurrence } from "./args.js";
import { type ApiResponse } from "./client.js";
export declare const TEXT_PATH = "/api/v2/swipe/text";
export declare const IMAGE_PATH = "/api/v2/swipe/image";
export declare const ADS_PATH = "/api/v2/swipe/ads";
export declare const UPLOAD_URL_PATH = "/api/v2/swipe/ads/upload-url";
export declare const RUNS_PATH = "/api/v2/swipe/runs";
export declare const LEVELS: readonly ["L1", "L2", "L3", "L4", "L5"];
export declare const PIECES: readonly ["transcript", "body", "headline", "hook"];
export declare const AWARENESS: readonly ["unaware", "problem-aware", "solution-aware", "product-aware", "most-aware"];
export type SwipeKind = "text" | "image" | "whole";
type Piece = (typeof PIECES)[number];
export interface FlowResult {
    code: number;
    lines: string[];
    usage?: true;
}
export interface SwipeAdDeps {
    post: (path: string, body: unknown) => Promise<ApiResponse<unknown>>;
    get: (path: string) => Promise<ApiResponse<unknown>>;
    upload: (url: string, bytes: Uint8Array, contentType: string) => Promise<string>;
    readText: (file: string) => string;
    readBytes: (file: string) => Uint8Array;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
    newId: () => string;
    dashboardUrl: string;
    say?: (line: string) => void;
}
export declare function defaultSwipeAdDeps(): SwipeAdDeps;
export type AdSource = {
    kind: "id";
    swipeAdId: string;
} | {
    kind: "top";
    topAd: string;
} | {
    kind: "paste";
    fields: Record<string, string>;
    image?: string;
};
export interface TextAsk {
    field?: Piece | "all";
    fields?: Piece[];
    persona?: string;
    mechanism?: string;
    awareness?: string;
    direction?: string;
    includeBrandContext?: false;
}
export interface ImageAsk {
    persona?: string;
    direction?: string;
    aspectRatio?: string;
    referenceImageIds?: string[];
    model?: string;
    includeBrandContext?: false;
}
export interface SwipePlan {
    kind: SwipeKind;
    source: AdSource;
    levels: {
        level: string;
        count: number;
    }[];
    text?: TextAsk;
    image?: ImageAsk;
    wait: boolean;
    json: boolean;
    timeoutMs: number;
}
export declare const VALUE_FLAGS: Set<string>;
export declare function parseLevels(raw: string): {
    level: string;
    count: number;
}[] | string;
export declare function planSource(ids: string[], flags: Record<string, string | boolean>, deps: Pick<SwipeAdDeps, "readText">): AdSource | {
    error: string;
};
export declare function planSwipe(kind: SwipeKind, ids: string[], flags: Record<string, string | boolean>, deps: Pick<SwipeAdDeps, "readText">): SwipePlan | FlowResult;
export declare function resolveAd(source: AdSource, deps: SwipeAdDeps): Promise<{
    swipeAdId: string;
    note?: string;
} | {
    error: string;
}>;
export interface SwipeRunView {
    runId: string;
    kind: "text" | "image";
    status: string;
    isTerminal: boolean;
    total: number | null;
    done: number;
    error: string | null;
    partial: string | null;
    wholeAdId: string | null;
    swipes: {
        level: string;
        n: number;
        piece: string;
        copy: string;
    }[];
    images: {
        url: string;
        label: string | null;
    }[];
}
export declare function printRun(view: SwipeRunView, dashboardUrl: string): string[];
export declare function swipeFlow(plan: SwipePlan, deps: SwipeAdDeps): Promise<FlowResult>;
export declare function addFlow(source: AdSource, json: boolean, deps: SwipeAdDeps): Promise<FlowResult>;
export declare function resultFlow(runId: string, json: boolean, deps: SwipeAdDeps): Promise<FlowResult>;
export declare const swipeAdHelp: string;
export declare function runSwipeAd(sub: "text" | "image" | "whole" | "add" | "result", ids: string[], flags: Record<string, string | boolean>, _occurrences?: FlagOccurrence[], deps?: SwipeAdDeps): Promise<FlowResult>;
export {};
