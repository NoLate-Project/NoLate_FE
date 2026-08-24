import { PRIVACY_POLICY_FALLBACK } from "../src/api/legal";

jest.mock("../src/api/api", () => ({ apiGet: jest.fn() }));

describe("privacy policy fallback disclosure", () => {
    it("keeps the offline fallback aligned with telemetry and Google user data handling", () => {
        const body = PRIVACY_POLICY_FALLBACK.sections.flatMap((section) => section.body);

        expect(PRIVACY_POLICY_FALLBACK.version).toBe("2026.08.24");
        expect(PRIVACY_POLICY_FALLBACK.effectiveDate).toBe("2026-08-24");
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
        expect(body.some((line) => (
            line.includes("calendar.calendarlist.readonly") &&
            line.includes("calendar.events.readonly") &&
            line.includes("최근 7일") &&
            line.includes("향후 90일")
        ))).toBe(true);
        expect(body.some((line) => (
            line.includes("캘린더 연동 정보") &&
            line.includes("캘린더 식별자") &&
            line.includes("원본 일정 식별자") &&
            line.includes("반복 일정 발생 시각") &&
            line.includes("서버로 전송") &&
            line.includes("SHA-256 기반 일방향 키") &&
            line.includes("원문 식별자는 저장하지 않")
        ))).toBe(true);
        expect(body.some((line) => (
            line.includes("명시적으로 선택한 일정") &&
            line.includes("NoLate 일정 생성 요청으로 서버에 전송") &&
            line.includes("원본 캘린더·일정 식별자") &&
            line.includes("반복 일정 발생 시각") &&
            line.includes("SHA-256 기반 일방향 키") &&
            line.includes("원문 식별자는 저장하지 않")
        ))).toBe(true);
        expect(body).toContain(
            "NoLate's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements."
        );
        expect(body.some((line) => (
            line.includes("Google Workspace 사용자 데이터") &&
            line.includes("리타게팅 광고") &&
            line.includes("판매·대여") &&
            line.includes("AI 또는 머신러닝 모델 학습")
        ))).toBe(true);
        expect(body.some((line) => (
            line.includes("Google 접근 토큰") &&
            line.includes("암호화된 운영체제 보안 저장소") &&
            line.includes("iOS Keychain") &&
            line.includes("Android Keystore") &&
            line.includes("NoLate 서버") &&
            line.includes("저장하지 않습니다")
        ))).toBe(true);
        expect(body.some((line) => (
            line.includes("인증된 API") &&
            line.includes("회원·일정·공유 권한 검사") &&
            line.includes("공유 구성원만 접근")
        ))).toBe(true);
        expect(body.some((line) => (
            line.includes("로그아웃 또는 회원 탈퇴") &&
            line.includes("401 응답") &&
            line.includes("Google 계정 설정")
        ))).toBe(true);
        expect(body.some((line) => (
            line.includes("Google 계정 로그인") &&
            line.includes("프로필 또는 이메일 정보를 요청하거나 사용하지 않")
        ))).toBe(true);
        expect(body.some((line) => line.includes("/account-deletion"))).toBe(true);
        expect(body.some((line) => line.includes("Google 로그인 및 Google Calendar"))).toBe(false);
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
