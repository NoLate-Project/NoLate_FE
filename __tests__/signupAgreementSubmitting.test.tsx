import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import SignupAgreementPanel from "../src/modules/auth/components/SignupAgreementPanel";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("../src/api/legal", () => {
    const policy = {
        terms: {
            type: "TERMS_OF_SERVICE",
            title: "서비스 이용약관",
            version: "test",
            effectiveDate: "2026-07-17",
            summary: "서비스 이용 조건",
            sections: [],
        },
        privacyCollection: {
            type: "PRIVACY_COLLECTION_CONSENT",
            title: "개인정보 수집·이용 동의",
            version: "test",
            effectiveDate: "2026-07-17",
            summary: "필수 개인정보 수집",
            sections: [],
        },
    };
    return {
        SIGNUP_CONSENT_POLICY_FALLBACK: policy,
        getSignupConsentPolicy: jest.fn(async () => policy),
    };
});

describe("SignupAgreementPanel submitting interactions", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
    });

    test("가입 요청 중에는 약관 선택·문서 이동을 모두 잠근다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <SignupAgreementPanel
                        submitting
                        onConfirm={jest.fn()}
                        onOpenTerms={jest.fn()}
                        onOpenPrivacyCollection={jest.fn()}
                        onOpenPrivacyPolicy={jest.fn()}
                    />
                </ThemeProvider>
            );
            await Promise.resolve();
        });

        const labels = [
            "필수 항목 모두 동의",
            "서비스 이용약관 필수 동의",
            "서비스 이용약관 자세히 보기",
            "개인정보 수집·이용 동의 필수 동의",
            "개인정보 수집·이용 동의 자세히 보기",
        ];

        for (const label of labels) {
            const matches = renderer!.root.findAll((node) => node.props.accessibilityLabel === label);
            expect(matches.some((node) => node.props.accessibilityState?.disabled === true)).toBe(true);
        }

        const policyLinks = renderer!.root.findAll((node) => (
            node.props.accessibilityRole === "link" &&
            node.props.accessibilityState?.disabled === true
        ));
        expect(policyLinks.length).toBeGreaterThanOrEqual(3);
    });
});
