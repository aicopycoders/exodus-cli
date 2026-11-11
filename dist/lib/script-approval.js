export function scriptApprovalExpiresAt(token) {
    if (!token)
        return undefined;
    try {
        const receipt = JSON.parse(atob(token.split(".")[0]));
        if (receipt?.v === 2)
            return 0;
        return receipt?.v === 3 && Number.isSafeInteger(receipt.expiresAt) ? receipt.expiresAt : undefined;
    }
    catch {
        return undefined;
    }
}
export function scriptApprovalNeedsReview(message) {
    return message !== undefined && /\[SCRIPT_APPROVAL_(EXPIRED|INVALID)\]/.test(message);
}
export const SCRIPT_APPROVAL_REVIEW = "This script approval is no longer valid. Your edits, original source and signed receipt are kept. Check my edits to approve this text again. If the receipt cannot be verified, a fresh write is required.";
