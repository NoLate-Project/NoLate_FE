import type { SignupConsentPolicy } from "../../api/legal";
import type { SignupConsentsPayload } from "../../api/member";

export type SignupConsentSelection = {
    terms: boolean;
    privacyCollection: boolean;
};

export const EMPTY_SIGNUP_CONSENT_SELECTION: SignupConsentSelection = {
    terms: false,
    privacyCollection: false,
};

export function hasAllRequiredSignupConsents(selection: SignupConsentSelection): boolean {
    return selection.terms && selection.privacyCollection;
}

export function buildSignupConsentsPayload(
    policy: SignupConsentPolicy,
    selection: SignupConsentSelection
): SignupConsentsPayload {
    return {
        termsVersion: policy.terms.version,
        privacyCollectionVersion: policy.privacyCollection.version,
        termsAgreed: selection.terms,
        privacyCollectionAgreed: selection.privacyCollection,
    };
}
