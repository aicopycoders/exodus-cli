import type { FlagOccurrence } from "../lib/args.js";
import { type FlowResult, type TopLibraryDeps } from "../lib/top-library.js";
export declare const helpText: string;
export declare const LISTS: readonly ["top500", "new", "trending"];
export declare const SORTS: readonly ["top", "newest", "longest"];
export declare const MAX_LIMIT = 500;
export declare const VALUE_FLAGS: Set<string>;
export interface TopAdsListOptions {
    list?: (typeof LISTS)[number];
    sort?: (typeof SORTS)[number];
    brand?: string;
    filters: string[];
    limit?: number;
}
export interface TopAd {
    id?: string;
    metaAdId?: string | null;
    adLibraryUrl?: string | null;
    rank?: number | null;
    isNew?: boolean;
    brand?: string;
    page?: string;
    format?: string | null;
    oneLine?: string;
    why?: string | null;
    daysRunning?: number | null;
    startDate?: string | null;
    lengthSec?: number | null;
    videoUrl?: string | null;
    tags?: {
        field?: string;
        value?: string;
    }[];
    match?: "close" | "less" | null;
}
export interface TopAdDetail extends TopAd {
    title?: string | null;
    body?: string | null;
    cta?: string | null;
    landingPage?: string | null;
    caption?: string | null;
    description?: string | null;
    concept?: string | null;
    angle?: string | null;
    hook?: string | null;
    beats?: string | null;
    transcript?: string | null;
}
export declare const NOT_ON_SEARCH: readonly ["brand", "sort", "filter"];
export declare function parseSearchFlags(flags: Record<string, string | boolean>, occurrences: readonly FlagOccurrence[]): {
    ok: true;
    options: Pick<TopAdsListOptions, "list" | "limit">;
} | {
    ok: false;
    message: string;
};
export declare function parseListFlags(flags: Record<string, string | boolean>, occurrences: readonly FlagOccurrence[]): {
    ok: true;
    options: TopAdsListOptions;
} | {
    ok: false;
    message: string;
};
export declare function listQuery(options: TopAdsListOptions): string;
export declare function adsTable(ads: readonly TopAd[], withMatch?: boolean): string;
type ListAnswer = {
    state?: string;
    message?: string;
    weekLabel?: string;
    list?: string;
    sort?: string;
    brand?: string;
    total?: number;
    ads?: TopAd[];
};
export declare function formatList(data: ListAnswer): string[];
type SearchAnswer = {
    state?: string;
    message?: string;
    weekLabel?: string;
    kind?: string;
    query?: string;
    list?: string;
    total?: number;
    ads?: TopAd[];
};
export declare function formatSearch(data: SearchAnswer): string[];
export declare function formatShow(data: {
    weekLabel?: string;
    ad?: TopAdDetail;
}): string[];
export declare function formatFilters(data: {
    rows?: {
        label?: string;
        values?: string[];
    }[];
}): string[];
export declare const listFlow: (options: TopAdsListOptions, json: boolean, deps: TopLibraryDeps) => Promise<FlowResult>;
export declare function searchFlow(words: string, options: Pick<TopAdsListOptions, "list" | "limit">, json: boolean, deps: TopLibraryDeps): Promise<FlowResult>;
export declare const showFlow: (id: string, json: boolean, deps: TopLibraryDeps) => Promise<FlowResult>;
export declare const filtersFlow: (json: boolean, deps: TopLibraryDeps) => Promise<FlowResult>;
export declare function run(flags: Record<string, string | boolean>, occurrences?: FlagOccurrence[]): Promise<void>;
export {};
