import type { FlagOccurrence } from "../lib/args.js";
import { type FlowResult, type VideoDeps } from "./video.js";
import { type SavedSheet, type SwipeOpts, type SwipeRunOptions } from "./video-swipe.js";
export declare const SWIPE_SHEET_CAST_PATH = "/api/v2/video/swipe-sheet/cast";
export declare const SHEET_CAST_LINE = "exodus video swipe sheet cast <swipeId> [--yes --max-usd <n>] [--wait] [--json]";
export interface SheetCastPlan {
    kind: "sheet-cast";
    swipeId: string;
    maxUsd: number | null;
    opts: SwipeOpts;
}
export declare function planSheetCast(given: string[], occurrences: FlagOccurrence[], opts: SwipeOpts): SheetCastPlan | {
    kind: "usage";
    line: string;
};
export declare function castLines(sheet: SavedSheet): string[];
export declare function swipeSheetCastFlow(plan: SheetCastPlan, opts: SwipeRunOptions, deps: VideoDeps): Promise<FlowResult>;
