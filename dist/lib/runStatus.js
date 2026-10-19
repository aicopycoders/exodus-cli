export const RUN_STATUSES = [
    "queued",
    "running",
    "awaiting-approval",
    "succeeded",
    "succeeded-with-warnings",
    "failed",
    "cancelled",
];
export const RUN_STATUS_LABELS = {
    queued: "Queued",
    running: "Running",
    "awaiting-approval": "Awaiting approval",
    succeeded: "Succeeded",
    "succeeded-with-warnings": "Succeeded with warnings",
    failed: "Failed",
    cancelled: "Cancelled",
};
export const RUN_STATUS_TONES = {
    queued: "pending",
    running: "active",
    "awaiting-approval": "attention",
    succeeded: "success",
    "succeeded-with-warnings": "warning",
    failed: "danger",
    cancelled: "muted",
};
export const LEGACY_RUN_STATUS_ALIASES = {
    pending: "queued",
    processing: "running",
    "in-progress": "running",
    walking: "running",
    mining: "running",
    scoring: "running",
    selecting: "running",
    writing: "running",
    assembling: "running",
    discovery: "running",
    analyzing: "running",
    combining: "running",
    phase1_complete: "running",
    phase2_complete: "running",
    "phase1-running": "running",
    "phase1-completed": "running",
    "phase2-running": "running",
    "script-prep-running": "running",
    "parser-running": "running",
    "storyboard-running": "running",
    "cast-sheet-running": "running",
    "storyboard-images-running": "running",
    "voice-and-clips-running": "running",
    stitching: "running",
    extracting: "running",
    ranking: "running",
    conceptualizing: "running",
    rendering: "running",
    "awaiting-review": "awaiting-approval",
    awaiting_hook_selection: "awaiting-approval",
    paused: "awaiting-approval",
    "script-review": "awaiting-approval",
    "storyboard-review": "awaiting-approval",
    "cast-sheet-review": "awaiting-approval",
    completed: "succeeded",
    complete: "succeeded",
    done: "succeeded",
    partial: "succeeded-with-warnings",
    "partial-success": "succeeded-with-warnings",
    "partial-error": "succeeded-with-warnings",
    error: "failed",
    stalled: "failed",
    "verification-failed": "failed",
    canceled: "cancelled",
    superseded: "cancelled",
};
export function normalizeRunStatus(raw, fallback = "running") {
    if (!raw)
        return fallback;
    if (RUN_STATUSES.includes(raw))
        return raw;
    return LEGACY_RUN_STATUS_ALIASES[raw] ?? fallback;
}
export function runStatusLabel(raw) {
    return RUN_STATUS_LABELS[normalizeRunStatus(raw)];
}
export function runStatusTone(raw) {
    return RUN_STATUS_TONES[normalizeRunStatus(raw)];
}
export const TERMINAL_RUN_STATUSES = [
    "succeeded",
    "succeeded-with-warnings",
    "failed",
    "cancelled",
];
export const ACTIVE_RUN_STATUSES = ["queued", "running"];
export function isTerminalRunStatus(raw) {
    return TERMINAL_RUN_STATUSES.includes(normalizeRunStatus(raw));
}
export function isActiveRunStatus(raw) {
    return ACTIVE_RUN_STATUSES.includes(normalizeRunStatus(raw));
}
export const WORKFLOW_RUN_STATUS_VALUES = RUN_STATUSES;
export const LEGACY_WORKFLOW_RUN_STATUS_VALUES = [
    "awaiting-review",
    "completed",
    "partial",
    "canceled",
];
const LEGACY_WORKFLOW_TWIN = {
    "awaiting-approval": "awaiting-review",
    succeeded: "completed",
    "succeeded-with-warnings": "partial",
    cancelled: "canceled",
};
export function storedWorkflowStatusForms(status) {
    const twin = LEGACY_WORKFLOW_TWIN[status];
    return twin ? [status, twin] : [status];
}
export function workflowRunPresentation(rawStatus, pauseReason, workerStopped) {
    let status = normalizeRunStatus(rawStatus);
    let detail;
    if (status === "awaiting-approval") {
        if (pauseReason === "call") {
            status = "running";
            detail = "sub-workflow";
        }
        else if (pauseReason === "slots") {
            detail = "needs inputs";
        }
        else if (pauseReason === "repair") {
            detail = workerStopped ? "worker stopped" : "needs repair";
        }
    }
    return {
        status,
        label: RUN_STATUS_LABELS[status],
        tone: RUN_STATUS_TONES[status],
        detail,
    };
}
export const WORKER_STOPPED_PARK_ERROR = "timeout-zombie-sweep: worker stopped heartbeating; finished steps are kept";
export function isWorkerStoppedPark(run) {
    return (normalizeRunStatus(run.status) === "awaiting-approval" &&
        run.pauseReason === "repair" &&
        run.error === WORKER_STOPPED_PARK_ERROR);
}
