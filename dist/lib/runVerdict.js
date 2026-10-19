import { RUN_STATUS_LABELS, isWorkerStoppedPark, workflowRunPresentation, } from "./runStatus.js";
export function summarizeDeliveries(deliveries) {
    if (deliveries === undefined || deliveries === null)
        return undefined;
    return {
        total: deliveries.length,
        delivered: deliveries.filter((d) => d.status === "delivered").length,
    };
}
export function runVerdict(run) {
    const presented = workflowRunPresentation(run.status, run.pauseReason, isWorkerStoppedPark(run));
    const delivery = summarizeDeliveries(run.deliveries) ?? run.deliverySummary ?? undefined;
    if ((presented.status === "succeeded" || presented.status === "succeeded-with-warnings") &&
        (run.counts?.failed ?? 0) > 0 &&
        delivery !== undefined &&
        delivery.total > 0 &&
        delivery.delivered === 0) {
        return `${RUN_STATUS_LABELS.failed} — nothing delivered`;
    }
    return presented.detail ? `${presented.label} — ${presented.detail}` : presented.label;
}
