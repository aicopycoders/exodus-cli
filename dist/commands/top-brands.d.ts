import { type FlowResult, type TopLibraryDeps } from "../lib/top-library.js";
export declare const helpText: string;
export declare const MAX_LIMIT = 500;
export interface TopBrand {
    rank?: number;
    name?: string;
    liveAds?: string;
    chartAds?: number;
    pages?: {
        name?: string;
        kind?: string;
        liveAds?: string | null;
    }[];
}
type BrandsAnswer = {
    state?: string;
    message?: string;
    total?: number;
    brands?: TopBrand[];
};
export declare function formatBrands(data: BrandsAnswer): string[];
export declare function listFlow(limit: number | undefined, json: boolean, deps: TopLibraryDeps): Promise<FlowResult>;
export declare function run(flags: Record<string, string | boolean>): Promise<void>;
export {};
