import { type AuditionReview } from "../lib/template-audition.js";
export type CustomerRunStage = "waiting" | "planning" | "picking" | "drawing" | "filming" | "editing" | "review" | "pilot" | "ready" | "failed" | "cancelled";
export type SpeechSummary = {
    status: "verbatim" | "accepted-with-speech-issue" | "speech-issue" | "unverified";
    issues: {
        sceneIndex?: number;
        policy: "exact-script";
        operation: "insert" | "delete";
        expected: {
            startWord: number;
            endWord: number;
            text: string;
        };
        heard: {
            startWord: number;
            endWord: number;
            text: string;
            startSec?: number;
            endSec?: number;
        };
        repeated?: boolean;
    }[];
};
export declare function speechSummaryLines(speech?: SpeechSummary): string[];
export interface CustomerRunScene {
    sceneIndex: number;
    line: string | null;
    imageUrl: string | null;
    frameStatus: "pending" | "drawing" | "ready" | "failed";
    productNote?: string;
    clip?: {
        status?: string;
        speech?: SpeechSummary;
        redoEstimateUsd?: number;
        redoEstimateMaxUsd?: number;
        voiceRetrying?: true;
        voiceRetry?: true;
        voiceHeldToo?: true;
    } | null;
}
export type CustomerHeldScene = {
    sceneIndex: number;
    sentence: string;
    take: boolean;
    unfilmed?: true;
    voice?: true;
    voiceToo?: true;
    voiceLocked?: true;
};
export type CustomerStopReason = {
    kind: "out-of-credits";
} | {
    kind: "openrouter-out-of-credits";
} | {
    kind: "plan-too-big";
} | {
    kind: "plan-rejected";
} | {
    kind: "keys-missing";
    keys: string[];
} | {
    kind: "stop-sentence";
    sentence: string;
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
    templateApproval?: {
        audition?: AuditionReview;
    };
    template?: true;
    awaitingSignOff?: boolean;
    waiting: {
        ahead: number;
        stepsDone: number;
    } | null;
    scenes: CustomerRunScene[] | null;
    video: {
        url: string;
        wordsOff: boolean;
        speech?: SpeechSummary;
        notes?: string[];
        endCard?: {
            state: string;
            line: string;
        };
    } | null;
    canRetry: boolean;
    canCutAgain?: boolean;
    cutFailure?: {
        sentence: string;
    };
    stopReason: CustomerStopReason | null;
    detailsPath: string | null;
    cutHolds?: string[];
    cutHeldScenes?: CustomerHeldScene[];
    waitingScenes?: CustomerHeldScene[];
    spend?: {
        spentUsd: number;
        estimateUsd: number | null;
        final: boolean;
        line: string;
        storyboardEstimate?: {
            usd: number;
            sentence: string;
        };
    };
    spendAsk?: {
        sentence: string;
    };
    spendWentOn?: {
        sentence: string;
    };
    spendStopped?: {
        sentence?: string;
    };
    planHold?: {
        atBoard?: boolean;
        beforePictures: boolean;
        notes?: string[];
        acceptFindings?: boolean;
        findings?: CustomerPlanFinding[];
    };
    place?: {
        name: string;
        look: string;
        imageUrl: string | null;
        check?: StopPictureCheck;
    };
    songCalls?: unknown;
    songNotice?: string[];
    face?: {
        label: string;
        imageUrl: string | null;
        check?: StopPictureCheck;
    };
    cutout?: {
        name: string;
        imageUrl: string | null;
        check?: StopPictureCheck;
    };
    productNoPhoto?: {
        name: string;
        line: string;
    };
    extraShots?: {
        shots: Array<{
            n: number;
            label: string;
            word: string;
            layout: "full" | "split";
            usd: number | null;
        }>;
    };
    endCard?: StopEndCard;
}
export type StopEndCard = {
    state: "ready";
    imageUrl?: string | null;
    drawn?: boolean;
    layout: string;
    words: ReadonlyArray<{
        label: string;
        words: string;
    }>;
    check: {
        state: string;
        labelWords?: string;
    };
    note: string;
    simpleNote?: string;
} | {
    state: "none";
    reason: string;
    note: string;
} | {
    state: "dropped";
    note: string;
};
export declare function endCardLines(card: StopEndCard | undefined, id: string, page: string): string[];
export declare const SONG_CALL_NEW_VIDEO = "A new video makes the whole ad again, at its own price, shown before you start.";
export declare const SONG_CALL_NO_SCENE_PICTURES = "This video is filmed from the pictures of its people and places, one clip for every one to three sung lines, so no picture of a scene was drawn.";
export declare const SONG_CALL_NO_ONE_SCENE = "One scene's clip or picture can't be made again on its own. A new video makes the whole ad again, at its own price, shown before you start.";
export declare function songCallsProblem(songCalls: unknown): boolean;
export declare function songCallStopLines(songCalls: unknown, page?: string): string[];
export interface StopPictureCheck {
    state?: string;
    line: string | null;
}
export interface StopPictures {
    face?: {
        imageUrl: string | null;
        check?: StopPictureCheck;
    };
    place?: {
        imageUrl: string | null;
        check?: StopPictureCheck;
    };
    cutout?: {
        imageUrl: string | null;
        check?: StopPictureCheck;
    };
}
export interface StopPictureLine {
    noun: string;
    drawn: boolean;
    line: string;
    check?: string;
}
export declare function stopPictureText(pictures: readonly StopPictureLine[]): string[];
export declare function stopPictureLines(pictures: StopPictures, page: string): StopPictureLine[];
export declare function noPhotoLines(run: {
    productNoPhoto?: {
        line: string;
    };
}): string[];
export declare function listedWords(words: readonly string[]): string;
export declare function extraShotLines(run: Pick<CustomerRun, "extraShots">, id: string): string[];
export declare function spendAskLines(run: {
    spendAsk?: {
        sentence: string;
    };
    spendWentOn?: {
        sentence: string;
    };
    spendStopped?: {
        at?: number;
        sentence?: string;
    };
}, runId: string): string[];
export declare const SPEND_STOPPED_LINE = "You stopped this video at its estimate. The app films nothing more on its own.";
export declare function customerCutHeld(run: CustomerRun): boolean;
export declare function waitingSceneLines(run: CustomerRun, page: string): string[];
export declare function approveWaitingLines(run: CustomerRun, page: string): string[];
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
    rewritten?: string;
}
export interface CustomerStoryboard {
    view: "customer";
    runId: string;
    stage: CustomerRunStage;
    scenes: CustomerRunScene[] | null;
    noPictureBeforeApproval?: true;
    filmsCalls?: true;
    songNotice?: string[];
    beforePictures?: true;
    findings?: CustomerPlanFinding[];
    hardWords?: string[];
    openings?: StoryboardOpening[];
    openingsDigest?: string;
    pictures?: {
        face?: StoryboardPicture;
        place?: StoryboardPicture;
        cutout?: StoryboardPicture;
    };
    productNoPhoto?: {
        name: string;
        line: string;
    };
    endCard?: StopEndCard;
}
export interface StoryboardPicture {
    drawn: boolean;
    check?: string;
}
export interface StoryboardOpening {
    name: string;
    seen: string;
    words: string | null;
}
export declare function openingLines(openings: readonly StoryboardOpening[] | undefined, id: string, digest?: string, acceptFindings?: boolean): string[];
export interface CustomerPlanFinding {
    text: string;
    scenes: number[];
}
export interface CustomerItem {
    sceneIndex: number;
    kind: "clip" | "voice" | "music";
    status: "ready" | "working" | "failed";
    url: string | null;
    speech?: SpeechSummary;
    songCall?: {
        sceneIndex: number;
        fromSec: number;
        seconds: number;
    };
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
export declare function onOwnDashboard(serverUrl: string, dashboardUrl: string): string;
export declare function customerStageIsWorking(stage: CustomerRunStage): boolean;
export declare const VOICE_RETRY_COST = "it costs only cents";
export declare function finalApproveLines(template: boolean): string[];
export declare function finalApprovedLines(template: boolean): string[];
export declare function customerStageLines(run: CustomerRun, page: string): string[];
export declare function customerStatusLines(run: CustomerRun, dashboardUrl: string): string[];
export declare function customerStoryboardLines(board: CustomerStoryboard, page: string, songCalls?: unknown): string[];
export declare function customerVoicesLines(voices: CustomerVoices): string[];
