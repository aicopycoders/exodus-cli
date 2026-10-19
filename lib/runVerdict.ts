// exodus/lib/runVerdict.ts
//
// #1249 / #1261 — THE verdict word for a workflow run. Every CLI surface that
// renders one (the run detail, the recent-runs table, a verb's "that run isn't
// parked" refusal) calls this ONE function, so the CLI can never disagree with
// itself one screen apart the way #1261 caught it doing.
//
// Pure module: no Node imports, no HTTP, no I/O.

import {
  RUN_STATUS_LABELS,
  isWorkerStoppedPark,
  workflowRunPresentation,
} from "./runStatus.js";

/**
 * How many of a run's PROMISED delivery slots actually arrived (#1002's exit
 * contract, counted). This is the whole of what the verdict needs to know about
 * deliveries, and it is deliberately the smallest such fact:
 *   - the run DETAIL derives it from the full `deliveries` array getRun sends;
 *   - the run LIST reads it straight off `deliverySummary`, which the list
 *     query computes server-side (a list must never ship every run's artifacts).
 * Both reduce to this one shape before the verdict is decided, which is what
 * makes the two surfaces provably agree.
 */
export interface RunDeliverySummary {
  /** Slots the workflow promised. 0 = the workflow has no Output node. */
  total: number;
  /** Slots that actually arrived. */
  delivered: number;
}

/** One delivery slot, as narrowly as the verdict reads it. */
export interface RunVerdictDelivery {
  status: string;
}

/** Everything the verdict reads off a run — nothing else is consulted. */
export interface RunVerdictInput {
  status?: string | null;
  pauseReason?: string | null;
  /** Tells a worker-stopped repair park from a failed step's (#3825). */
  error?: string | null;
  /** The run's node rollup. Only `failed` is consulted; the rest is shape. */
  counts?: {
    done?: number;
    failed?: number;
    skipped?: number;
    total?: number;
    outOfScope?: number;
  } | null;
  /** The run detail's full exit contract. Absent on the list and on old backends. */
  deliveries?: readonly RunVerdictDelivery[];
  /**
   * The list's pre-counted twin of `deliveries` (#1261). Ignored when
   * `deliveries` is present — the full array is the richer source and both
   * reduce to the same numbers.
   */
  deliverySummary?: RunDeliverySummary | null;
}

/**
 * Count a full deliveries array down to the summary the verdict reads.
 * `undefined` in → `undefined` out: a backend that omits `deliveries` has said
 * "I can't tell you", which is NOT the same fact as "nothing was delivered".
 */
export function summarizeDeliveries(
  deliveries?: readonly RunVerdictDelivery[] | null,
): RunDeliverySummary | undefined {
  if (deliveries === undefined || deliveries === null) return undefined;
  return {
    total: deliveries.length,
    delivered: deliveries.filter((d) => d.status === "delivered").length,
  };
}

/**
 * #1249: the verdict WORD for a run — the ruled #994 display word, plus the
 * shared presentation seam's park detail ("Awaiting approval — needs repair"),
 * the same "<ruled word> — <detail>" idiom the dashboard's run header speaks.
 * Two lies this corrects:
 *   - a repair/slots park read as a bare "Awaiting approval" (nothing was
 *     awaiting approval — the inbox already said `repair`), and a "call" park
 *     read as an approval at all (it is a parent busy on its child, #861);
 *   - a finished run whose work FAILED and whose exit contract went entirely
 *     unfulfilled read "Succeeded with warnings" — a member believed they got
 *     an ad when nothing was delivered. That run is Failed. The demotion needs
 *     the deliveries to be KNOWN and non-empty: an older backend that reports
 *     neither `deliveries` nor `deliverySummary` (or a workflow with no Output
 *     nodes) keeps the wire's own word.
 */
export function runVerdict(run: RunVerdictInput): string {
  const presented = workflowRunPresentation(
    run.status,
    run.pauseReason,
    isWorkerStoppedPark(run),
  );
  const delivery =
    summarizeDeliveries(run.deliveries) ?? run.deliverySummary ?? undefined;
  if (
    (presented.status === "succeeded" || presented.status === "succeeded-with-warnings") &&
    (run.counts?.failed ?? 0) > 0 &&
    delivery !== undefined &&
    delivery.total > 0 &&
    delivery.delivered === 0
  ) {
    return `${RUN_STATUS_LABELS.failed} — nothing delivered`;
  }
  return presented.detail ? `${presented.label} — ${presented.detail}` : presented.label;
}
