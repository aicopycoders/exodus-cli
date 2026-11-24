import type { ApiResponse } from "./client.js";
import { type Channel } from "./channel.js";
import type { FlowResult } from "./meta-ads.js";
export type { FlowResult } from "./meta-ads.js";
export { safeText, safeTextOr, table, truncate } from "./meta-ads.js";
export interface TopLibraryDeps {
    get: (path: string) => Promise<ApiResponse<unknown>>;
    channel: Channel;
    apiUrl: () => string;
}
export declare const defaultTopLibraryDeps: TopLibraryDeps;
export declare const NOT_ON_LINE = "Top ads, Top brands and Ad templates aren't turned on for your account yet.";
export declare function failureOf(res: ApiResponse<unknown>, verb: string, json: boolean, deps: TopLibraryDeps): FlowResult | undefined;
export declare function positionals(valueFlags: ReadonlySet<string>, args?: string[]): string[];
export declare function parseLimit(raw: string | boolean | undefined, max: number): {
    ok: true;
    limit?: number;
} | {
    ok: false;
    message: string;
};
export declare function parseChoice<C extends string>(flag: string, raw: string | boolean | undefined, choices: readonly C[]): {
    ok: true;
    value?: C;
} | {
    ok: false;
    message: string;
};
export declare function printResult(result: FlowResult): void;
export declare function usageError(message: string, usage: string): never;
export declare function clock(sec: unknown): string | null;
export declare const plural: (n: number, one: string, many?: string) => string;
