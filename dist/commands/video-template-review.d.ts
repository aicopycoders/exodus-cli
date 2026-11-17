import { type ApiResponse } from "../lib/client.js";
type Transport = {
    get(path: string): Promise<ApiResponse<unknown>>;
    post(path: string, body: unknown): Promise<ApiResponse<unknown>>;
};
type Result = {
    code: number;
    lines: string[];
};
export declare function templateReviewFlow(args: string[], deps?: Transport): Promise<Result>;
export declare function runTemplateReviewCommand(args: string[]): Promise<void>;
export {};
