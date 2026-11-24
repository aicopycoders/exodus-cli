import { type FlowResult, type TopLibraryDeps } from "../lib/top-library.js";
export declare const helpText: string;
export interface AdTemplate {
    id?: string;
    number?: number;
    name?: string;
    owner?: string;
    format?: string | null;
    opening?: string | null;
}
export interface AdTemplateDetail extends AdTemplate {
    locks?: {
        field?: string;
        value?: string;
    }[];
    beats?: string[] | null;
    note?: string | null;
    references?: {
        brand?: string;
        page?: string;
        oneLine?: string;
        metaAdId?: string | null;
        adLibraryUrl?: string | null;
        script?: string | null;
        fills?: {
            blank?: string;
            fills?: string;
        }[];
    }[];
}
export declare function templatesTable(templates: readonly AdTemplate[]): string;
export declare function formatList(data: {
    templates?: AdTemplate[];
}): string[];
export declare function formatSearch(data: {
    query?: string;
    templates?: AdTemplate[];
}): string[];
export declare function formatShow(data: {
    template?: AdTemplateDetail;
}): string[];
export declare const listFlow: (json: boolean, deps: TopLibraryDeps) => Promise<FlowResult>;
export declare const showFlow: (which: string, json: boolean, deps: TopLibraryDeps) => Promise<FlowResult>;
export declare const searchFlow: (words: string, json: boolean, deps: TopLibraryDeps) => Promise<FlowResult>;
export declare function run(flags: Record<string, string | boolean>): Promise<void>;
