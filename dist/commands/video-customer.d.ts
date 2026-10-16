export type CustomerRunStage = "waiting" | "planning" | "drawing" | "filming" | "editing" | "review" | "ready" | "failed" | "cancelled";
export interface CustomerRunScene {
    sceneIndex: number;
    line: string | null;
    imageUrl: string | null;
    frameStatus: "pending" | "drawing" | "ready" | "failed";
    productNote?: string;
}
export type CustomerStopReason = {
    kind: "out-of-credits";
} | {
    kind: "openrouter-out-of-credits";
} | {
    kind: "plan-too-big";
} | {
    kind: "keys-missing";
    keys: string[];
};
export interface CustomerRun {
    view: "customer";
    isTerminal: boolean;
    runId: string;
    title: string;
    card: {
        conceit: string;
        style: string;
    } | null;
    mode: "one-shot" | "guided";
    stage: CustomerRunStage;
    awaitingSignOff?: boolean;
    waiting: {
        ahead: number;
        stepsDone: number;
    } | null;
    scenes: CustomerRunScene[] | null;
    video: {
        url: string;
        wordsOff: boolean;
    } | null;
    canRetry: boolean;
    stopReason: CustomerStopReason | null;
    detailsPath: string | null;
}
export interface ScriptTidied {
    setAside: string[];
    added: {
        names: string[];
        descriptions: {
            name: string;
            description: string;
        }[];
    };
}
export interface CustomerStart {
    view: "customer";
    runId: string;
    dashboardUrl: string;
    tidied?: ScriptTidied;
    written?: string;
}
export interface CustomerStoryboard {
    view: "customer";
    runId: string;
    stage: CustomerRunStage;
    scenes: CustomerRunScene[] | null;
}
export interface CustomerItem {
    sceneIndex: number;
    kind: "clip" | "voice" | "music";
    status: "ready" | "working" | "failed";
    url: string | null;
}
export interface CustomerItems {
    view: "customer";
    items: CustomerItem[];
}
export interface CustomerVoices {
    view: "customer";
    runId: string;
    canChange: boolean;
    whyNot: string | null;
    cast: Array<{
        characterId: string;
        name: string;
        voice: {
            voiceId: string;
            name: string | null;
        } | null;
    }>;
    options: Array<{
        voiceId: string;
        name: string;
        description?: string;
    }>;
}
export interface CustomerOk {
    view: "customer";
    ok: true;
}
export interface CustomerFinal {
    view: "customer";
    finalWatchUrl: string;
    delivered: boolean;
}
export declare function customerAnswer<T extends {
    view: "customer";
}>(data: unknown): T | null;
export declare function customerRunPage(dashboardUrl: string, runId: string): string;
export declare function customerStageIsWorking(stage: CustomerRunStage): boolean;
export declare function customerStageLines(run: CustomerRun, page: string): string[];
export declare function customerStatusLines(run: CustomerRun, dashboardUrl: string): string[];
export declare function customerStoryboardLines(board: CustomerStoryboard): string[];
export declare function customerVoicesLines(voices: CustomerVoices): string[];
