export interface RunDeliverySummary {
    total: number;
    delivered: number;
}
export interface RunVerdictDelivery {
    status: string;
}
export interface RunVerdictInput {
    status?: string | null;
    pauseReason?: string | null;
    error?: string | null;
    counts?: {
        done?: number;
        failed?: number;
        skipped?: number;
        total?: number;
        outOfScope?: number;
    } | null;
    deliveries?: readonly RunVerdictDelivery[];
    deliverySummary?: RunDeliverySummary | null;
}
export declare function summarizeDeliveries(deliveries?: readonly RunVerdictDelivery[] | null): RunDeliverySummary | undefined;
export declare function runVerdict(run: RunVerdictInput): string;
