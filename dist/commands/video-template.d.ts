import { type ApiResponse } from "../lib/client.js";
type Result = {
    code: number;
    lines: string[];
};
type Transport = {
    get(path: string): Promise<ApiResponse<unknown>>;
    post(path: string, body: unknown): Promise<ApiResponse<unknown>>;
    readFile(path: string): string;
    uuid(): string;
    sleep(ms: number): Promise<void>;
    dashboardUrl: string;
    notice?(line: string): void;
};
export declare function templateCommandFlow(args: string[], deps?: Transport): Promise<Result>;
export declare function runTemplateCommand(args: string[]): Promise<void>;
export {};
