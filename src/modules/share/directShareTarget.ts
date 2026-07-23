import type { CreateDirectSharePayload } from "../../api/scheduleSharing";

/**
 * 사용자가 프로필에서 보는 `회원 #ID` 표기와 이메일을 한 입력창에서 받는다.
 * 부분 일치 검색은 다른 회원의 이메일을 추측할 수 있게 하므로 이 단계에서는 정확한
 * 숫자 ID 또는 완전한 이메일만 API payload로 변환한다.
 */
export function createDirectShareTarget(
    value: string,
): Pick<CreateDirectSharePayload, "targetEmail" | "targetAppId"> {
    const normalized = value.trim();
    if (!normalized) {
        throw new Error("공유할 회원 #ID 또는 이메일을 입력해 주세요.");
    }

    if (normalized.includes("@")) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
            throw new Error("이메일 형식을 확인해 주세요.");
        }
        return { targetEmail: normalized.toLowerCase() };
    }

    const appIdMatch = normalized.match(/^(?:회원\s*)?#?(\d+)$/);
    const targetAppId = appIdMatch ? Number(appIdMatch[1]) : Number.NaN;
    if (!Number.isSafeInteger(targetAppId) || targetAppId <= 0) {
        throw new Error("앱 ID는 프로필에 표시된 회원 번호를 입력해 주세요.");
    }

    return { targetAppId };
}
