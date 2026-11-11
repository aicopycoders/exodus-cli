export function auditionPending(audition) {
    return !!audition && (audition.invalidated === true || audition.acceptedDigest !== audition.digest);
}
export const AUDITION_RESTART_REASON = "The remaining audition takes were refused for safety or their pictures. Cancel this run and start a new video with a revised brief or pictures; sending the same request again cannot fix this refusal.";
