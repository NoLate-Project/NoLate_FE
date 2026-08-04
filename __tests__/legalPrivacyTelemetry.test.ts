import { PRIVACY_POLICY_FALLBACK } from "../src/api/legal";

jest.mock("../src/api/api", () => ({ apiGet: jest.fn() }));

describe("privacy policy telemetry disclosure", () => {
    it("keeps the offline fallback aligned with push and ETA measurement fields", () => {
        const body = PRIVACY_POLICY_FALLBACK.sections.flatMap((section) => section.body);

        expect(PRIVACY_POLICY_FALLBACK.version).toBe("2026.08.04");
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
            line.includes("화면 전환 성능 정보") &&
            line.includes("일정 식별값") &&
            line.includes("저장하지 않습니다")
        ))).toBe(true);
        expect(body.some((line) => (
            line.includes("화면 전환 성능 정보") &&
            line.includes("90일")
        ))).toBe(true);
    });
});
