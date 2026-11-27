import { type FlowResult, type VideoDeps } from "./video.js";
export declare const CHECKS_PATH = "/api/v2/video/checks";
export declare const NO_CHECK_ANSWERS = "No check answers are saved for this video.";
export declare const MORE_CHECK_ANSWERS = "This video has more check answers than one read shows; these are the first.";
export interface CheckAnswerFault {
    fault?: string;
    follows?: string;
    onFail?: {
        do: string;
    };
    findingCode?: string | null;
    say?: string;
}
export interface CheckSummary {
    ran: number;
    passed: number;
    fixed: number;
    noted: number;
    look: number;
    kept: number;
    items: Array<{
        kind: string;
        scene?: number;
        title: string;
        text: string;
    }>;
    delivered?: boolean;
    others?: Array<{
        scene: number;
        text: string | null;
    }>;
    more?: true;
}
export type CheckAnswer = {
    station: string;
    item: string;
    attempt: number;
    check: string;
    version: number;
    savedAt: number;
    by?: string;
    fixEnded?: boolean;
} & ({
    status: "pass";
} | {
    status: "fail";
    faults: CheckAnswerFault[];
} | {
    status: "unknown";
    why: string;
    does: string;
    findingCode?: string;
    say?: string;
} | {
    status: "unmeasured";
    why: string;
} | {
    status: "not-applicable";
} | {
    status: "not-finished";
});
export declare function checkAnswerLines(runId: string, answers: readonly CheckAnswer[], more?: boolean): string[];
export declare function summaryCountLine(summary: CheckSummary): string;
export declare function summaryLines(runId: string, summary: CheckSummary | null): string[];
export declare function checksFlow(runId: string, json: boolean, deps: Pick<VideoDeps, "get">): Promise<FlowResult>;
