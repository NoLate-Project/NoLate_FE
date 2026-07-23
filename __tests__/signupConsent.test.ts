import type { SignupConsentPolicy } from "../src/api/legal";
import {
    buildSignupConsentsPayload,
    hasAllRequiredSignupConsents,
} from "../src/modules/auth/signupConsent";

describe("signup consent", () => {
    const policy: SignupConsentPolicy = {
        terms: {
            type: "TERMS_OF_SERVICE",
            title: "서비스 이용약관",
            version: "terms-v1",
            effectiveDate: "2026-07-16",
            summary: "terms",
            sections: [],
        },
        privacyCollection: {
            type: "PRIVACY_COLLECTION_CONSENT",
            title: "개인정보 수집·이용 동의",
            version: "privacy-v2",
            effectiveDate: "2026-07-16",
            summary: "privacy",
            sections: [],
        },
    };

    test("requires both terms and privacy collection selection", () => {
        expect(hasAllRequiredSignupConsents({ terms: false, privacyCollection: false })).toBe(false);
        expect(hasAllRequiredSignupConsents({ terms: true, privacyCollection: false })).toBe(false);
        expect(hasAllRequiredSignupConsents({ terms: false, privacyCollection: true })).toBe(false);
        expect(hasAllRequiredSignupConsents({ terms: true, privacyCollection: true })).toBe(true);
    });

    test("builds the server audit payload from the displayed document versions", () => {
        expect(buildSignupConsentsPayload(
            policy,
            { terms: true, privacyCollection: true }
        )).toEqual({
            termsVersion: "terms-v1",
            privacyCollectionVersion: "privacy-v2",
            termsAgreed: true,
            privacyCollectionAgreed: true,
        });
    });
});
