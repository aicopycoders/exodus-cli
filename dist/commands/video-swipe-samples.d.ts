import type { FlagOccurrence } from "../lib/args.js";
import { type FlowResult, type VideoDeps } from "./video.js";
import { type SavedSheet, type SwipeOpts, type SwipeRunOptions } from "./video-swipe.js";
export declare const SWIPE_SHEET_SAMPLES_PATH = "/api/v2/video/swipe-sheet/samples";
export declare const SHEET_SAMPLES_LINE = "exodus video swipe sheet samples <swipeId> [--sounds <code,code,...> | --count <n>] [--yes --max-usd <n>] [--wait] [--json]";
export declare const SHEET_SAMPLES_MOST = 4;
export interface SheetSamplesPlan {
    kind: "sheet-samples";
    swipeId: string;
    sounds: string[] | null;
    count: number | null;
    maxUsd: number | null;
    opts: SwipeOpts;
}
export declare function planSheetSamples(given: string[], occurrences: FlagOccurrence[], opts: SwipeOpts): SheetSamplesPlan | {
    kind: "usage";
    line: string;
};
export declare function takeLines(sheet: SavedSheet): string[];
export declare function swipeSheetSamplesFlow(plan: SheetSamplesPlan, opts: SwipeRunOptions, deps: VideoDeps): Promise<FlowResult>;
