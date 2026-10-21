export declare const RUN_STATUSES: readonly ["queued", "running", "awaiting-approval", "succeeded", "succeeded-with-warnings", "failed", "cancelled"];
export type RunStatus = (typeof RUN_STATUSES)[number];
export declare const RUN_STATUS_LABELS: Record<RunStatus, string>;
export type RunStatusTone = "pending" | "active" | "attention" | "success" | "warning" | "danger" | "muted";
export declare const RUN_STATUS_TONES: Record<RunStatus, RunStatusTone>;
export declare const LEGACY_RUN_STATUS_ALIASES: Record<string, RunStatus>;
export declare function normalizeRunStatus(raw: string | null | undefined, fallback?: RunStatus): RunStatus;
export declare function runStatusLabel(raw: string | null | undefined): string;
export declare function runStatusTone(raw: string | null | undefined): RunStatusTone;
export declare const TERMINAL_RUN_STATUSES: readonly ["succeeded", "succeeded-with-warnings", "failed", "cancelled"];
export declare const ACTIVE_RUN_STATUSES: readonly ["queued", "running"];
export declare function isTerminalRunStatus(raw: string | null | undefined): boolean;
export declare function isActiveRunStatus(raw: string | null | undefined): boolean;
export declare const WORKFLOW_RUN_STATUS_VALUES: readonly ["queued", "running", "awaiting-approval", "succeeded", "succeeded-with-warnings", "failed", "cancelled"];
export declare const LEGACY_WORKFLOW_RUN_STATUS_VALUES: readonly ["awaiting-review", "completed", "partial", "canceled"];
export declare function storedWorkflowStatusForms(status: RunStatus): string[];
export declare function workflowRunPresentation(rawStatus: string | null | undefined, pauseReason?: string | null, workerStopped?: boolean): {
    status: RunStatus;
    label: string;
    tone: RunStatusTone;
    detail?: string;
};
export declare const WORKER_STOPPED_PARK_ERROR = "timeout-zombie-sweep: worker stopped heartbeating; finished steps are kept";
export declare function isWorkerStoppedPark(run: {
    status?: string | null;
    pauseReason?: string | null;
    error?: string | null;
}): boolean;
