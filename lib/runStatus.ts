// exodus/lib/runStatus.ts
//
// #994 — the CLI's copy of THE one status vocabulary (#981 call 6): Queued /
// Running / Awaiting approval / Succeeded / Succeeded with warnings / Failed /
// Cancelled.
//
// HAND-SYNCED MIRROR of convex/lib/runStatus.ts — the CLI compiles standalone
// (tsconfig rootDir ".") and cannot import repo-root modules. The lockstep
// test convex/lib/__tests__/runStatusLockstep.test.ts fails CI on any drift —
// change BOTH files together. The CLI keeps the legacy aliases forever: a
// published CLI must work against old AND new backend vocabularies.
//
// Pure module: no Node imports.

export const RUN_STATUSES = [
  "queued",
  "running",
  "awaiting-approval",
  "succeeded",
  "succeeded-with-warnings",
  "failed",
  "cancelled",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

/** The ruled display words — the ONLY status words a user may ever see. */
export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Running",
  "awaiting-approval": "Awaiting approval",
  succeeded: "Succeeded",
  "succeeded-with-warnings": "Succeeded with warnings",
  failed: "Failed",
  cancelled: "Cancelled",
};

/**
 * Semantic tone per status. Surfaces map tones to their own palette idiom;
 * the tone assignments themselves are shared so the same status never reads
 * calm on one surface and alarming on another.
 */
export type RunStatusTone =
  | "pending"
  | "active"
  | "attention"
  | "success"
  | "warning"
  | "danger"
  | "muted";

export const RUN_STATUS_TONES: Record<RunStatus, RunStatusTone> = {
  queued: "pending",
  running: "active",
  "awaiting-approval": "attention",
  succeeded: "success",
  "succeeded-with-warnings": "warning",
  failed: "danger",
  cancelled: "muted",
};

/**
 * Every raw status any run family stores (or synthesizes) today, mapped onto
 * the canonical vocabulary. Families other than workflowRuns keep their stored
 * values — this is their presentation seam. Mid-pipeline phase words (pixar,
 * scout, swipe, intel, image-ads) all read as "running": the run is busy.
 */
export const LEGACY_RUN_STATUS_ALIASES: Record<string, RunStatus> = {
  // queued
  pending: "queued",
  // running
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
  // awaiting approval
  "awaiting-review": "awaiting-approval",
  awaiting_hook_selection: "awaiting-approval",
  paused: "awaiting-approval",
  "script-review": "awaiting-approval",
  "storyboard-review": "awaiting-approval",
  "cast-sheet-review": "awaiting-approval",
  // succeeded
  completed: "succeeded",
  complete: "succeeded",
  done: "succeeded",
  // succeeded with warnings
  partial: "succeeded-with-warnings",
  "partial-success": "succeeded-with-warnings",
  "partial-error": "succeeded-with-warnings",
  // failed
  error: "failed",
  stalled: "failed",
  "verification-failed": "failed",
  // cancelled
  canceled: "cancelled",
  superseded: "cancelled",
};

/**
 * Normalize any raw status onto the canonical vocabulary. Unknown words fall
 * back to "running" by default — an unrecognized status is almost always a
 * mid-pipeline phase name, and "Running" is the least-wrong thing to show.
 */
export function normalizeRunStatus(
  raw: string | null | undefined,
  fallback: RunStatus = "running",
): RunStatus {
  if (!raw) return fallback;
  if ((RUN_STATUSES as readonly string[]).includes(raw)) return raw as RunStatus;
  return LEGACY_RUN_STATUS_ALIASES[raw] ?? fallback;
}

/** The ruled display word for any raw status. */
export function runStatusLabel(raw: string | null | undefined): string {
  return RUN_STATUS_LABELS[normalizeRunStatus(raw)];
}

/** The shared tone for any raw status. */
export function runStatusTone(raw: string | null | undefined): RunStatusTone {
  return RUN_STATUS_TONES[normalizeRunStatus(raw)];
}

export const TERMINAL_RUN_STATUSES = [
  "succeeded",
  "succeeded-with-warnings",
  "failed",
  "cancelled",
] as const satisfies readonly RunStatus[];

export const ACTIVE_RUN_STATUSES = ["queued", "running"] as const satisfies readonly RunStatus[];

/**
 * Terminal check across BOTH vocabularies (canonical + every legacy alias),
 * so callers behave identically against pre- and post-migration rows and old
 * and new backends. NOTE: normalizeRunStatus's unknown→"running" fallback
 * makes unknown statuses non-terminal, which is the safe polling default.
 */
export function isTerminalRunStatus(raw: string | null | undefined): boolean {
  return (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(normalizeRunStatus(raw));
}

export function isActiveRunStatus(raw: string | null | undefined): boolean {
  return (ACTIVE_RUN_STATUSES as readonly RunStatus[]).includes(normalizeRunStatus(raw));
}

// ---------------------------------------------------------------------------
// workflowRuns stored enum (#994 expand-first rename)
// ---------------------------------------------------------------------------

/** The new stored enum for workflowRuns.status — identical to the canon. */
export const WORKFLOW_RUN_STATUS_VALUES = RUN_STATUSES;

/**
 * Legacy stored forms still present in rows until the rename migration runs.
 * The schema validator accepts new ∪ legacy during the expand window; every
 * write uses the new form; every read normalizes.
 */
export const LEGACY_WORKFLOW_RUN_STATUS_VALUES = [
  "awaiting-review",
  "completed",
  "partial",
  "canceled",
] as const;

const LEGACY_WORKFLOW_TWIN: Partial<Record<RunStatus, string>> = {
  "awaiting-approval": "awaiting-review",
  succeeded: "completed",
  "succeeded-with-warnings": "partial",
  cancelled: "canceled",
};

/**
 * Every stored form a canonical workflow status may appear as during the
 * expand window — for by_status index queries and status-equality filters,
 * which must match pre-migration rows too.
 */
export function storedWorkflowStatusForms(status: RunStatus): string[] {
  const twin = LEGACY_WORKFLOW_TWIN[status];
  return twin ? [status, twin] : [status];
}

// ---------------------------------------------------------------------------
// Workflow run presentation (pauseReason nuances)
// ---------------------------------------------------------------------------

/**
 * How a workflow run presents, given its pauseReason. The status WORD is
 * always one of the seven ruled words; `detail` is optional context a surface
 * may append (e.g. "Running — sub-workflow"), never a replacement.
 *
 * #861: a parent parked on pauseReason "call" is waiting on a child run, not
 * on a human — it presents as busy (running), not as an approval.
 *
 * #3825: `workerStopped` (isWorkerStoppedPark, or a projection's flag) makes
 * that repair park read "worker stopped", not "needs repair": nothing failed.
 */
export function workflowRunPresentation(
  rawStatus: string | null | undefined,
  pauseReason?: string | null,
  workerStopped?: boolean,
): { status: RunStatus; label: string; tone: RunStatusTone; detail?: string } {
  let status = normalizeRunStatus(rawStatus);
  let detail: string | undefined;
  if (status === "awaiting-approval") {
    if (pauseReason === "call") {
      status = "running";
      detail = "sub-workflow";
    } else if (pauseReason === "slots") {
      detail = "needs inputs";
    } else if (pauseReason === "repair") {
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

/**
 * #3820: the zombie sweep's park for a run whose worker stopped heartbeating.
 * A repair park with no dead step: retry carries the whole run on from its
 * first unfinished step, and the server refuses skip.
 */
export const WORKER_STOPPED_PARK_ERROR =
  "timeout-zombie-sweep: worker stopped heartbeating; finished steps are kept";

export function isWorkerStoppedPark(run: {
  status?: string | null;
  pauseReason?: string | null;
  error?: string | null;
}): boolean {
  return (
    normalizeRunStatus(run.status) === "awaiting-approval" &&
    run.pauseReason === "repair" &&
    run.error === WORKER_STOPPED_PARK_ERROR
  );
}
