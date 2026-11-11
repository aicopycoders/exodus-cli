export declare function scriptApprovalExpiresAt(token: string | undefined): number | undefined;
export declare function scriptApprovalNeedsReview(message: string | undefined): boolean;
export declare const SCRIPT_APPROVAL_REVIEW = "This script approval is no longer valid. Your edits, original source and signed receipt are kept. Check my edits to approve this text again. If the receipt cannot be verified, a fresh write is required.";
