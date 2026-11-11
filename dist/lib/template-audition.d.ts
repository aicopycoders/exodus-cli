export interface TemplateAudition {
    nodeId: string;
    digest: string;
    sceneIndexes: number[];
    ready: boolean;
    invalidated?: boolean;
    retryBlocked?: boolean;
    acceptedDigest?: string;
}
export type AuditionReview = Pick<TemplateAudition, "digest" | "sceneIndexes" | "ready" | "invalidated" | "retryBlocked">;
export declare function auditionPending(audition: TemplateAudition | undefined | null): audition is TemplateAudition;
export declare const AUDITION_RESTART_REASON = "The remaining audition takes were refused for safety or their pictures. Cancel this run and start a new video with a revised brief or pictures; sending the same request again cannot fix this refusal.";
