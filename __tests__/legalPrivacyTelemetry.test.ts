import { PRIVACY_POLICY_FALLBACK } from "../src/api/legal";

jest.mock("../src/api/api", () => ({ apiGet: jest.fn() }));

describe("privacy policy telemetry disclosure", () => {
    it("keeps the offline fallback aligned with push and ETA measurement fields", () => {
        const body = PRIVACY_POLICY_FALLBACK.sections.flatMap((section) => section.body);

        expect(PRIVACY_POLICY_FALLBACK.version).toBe("2026.08.24");
        expect(body.some((line) => line.includes("푸시 수신·표시·알람 예약"))).toBe(true);
        expect(body.some((line) => (
            line.includes("ETA 정확도 개선 참여 시") &&
            line.includes("위치를 추가 수집하지 않습니다")
        ))).toBe(true);
        expect(body.some((line) => (
            line.includes("빠른 일정 품질 정보") &&
            line.includes("원문") &&
            line.includes("저장하지 않습니다")
        ))).toBe(true);
        expect(body.some((line) => line.includes("생성 후 90일"))).toBe(true);
        expect(body.some((line) => (
            line.includes("앱 성능 정보") &&
            line.includes("일정 식별값") &&
            line.includes("저장하지 않습니다")
        ))).toBe(true);
        expect(body.some((line) => (
            line.includes("앱 성능 정보") &&
            line.includes("90일")
        ))).toBe(true);
        expect(PRIVACY_POLICY_FALLBACK.sections.some((section) => (
            section.title === "6-1. 광고 제공, 동의 관리 및 추적"
        ))).toBe(true);
        [
            "Google Mobile Ads",
            "Google User Messaging Platform(UMP)",
            "기기 식별자",
            "대략적 위치",
            "광고 데이터",
            "제품 상호작용",
            "ATT 권한",
            "개인정보 보호 및 보안 > 추적",
        ].forEach((disclosure) => {
            expect(body.some((line) => line.includes(disclosure))).toBe(true);
        });
        expect(body.some((line) => (
            line.includes("Google Mobile Ads·AdMob·UMP") &&
            line.includes("광고 제공·타기팅·측정에 사용하지 않습니다")
        ))).toBe(true);
        expect(body.some((line) => line.includes("광고 노출 빈도 정보는 기기에만 저장합니다"))).toBe(true);
    });
});
