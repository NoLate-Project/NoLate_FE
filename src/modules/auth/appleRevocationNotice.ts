import type {
    WithdrawalResult,
} from "../../api/member";

export type AppleRevocationNotice = {
    title: string;
    message: string;
};

/**
 * The local NoLate account is already gone when this notice is shown. Keep the handoff purely
 * informational and free of provider identifiers so it remains safe on the signed-out screen.
 */
export function getAppleRevocationNotice(
    loginType: string | undefined,
    withdrawal: WithdrawalResult,
): AppleRevocationNotice | undefined {
    if (
        loginType !== "APPLE" ||
        !withdrawal.manualAppleRevocationRequired
    ) {
        return undefined;
    }

    return {
        title: "Apple 연결 해제 안내",
        message:
            "NoLate 계정 삭제는 완료됐어요. Apple 계정 설정의 ‘Apple로 로그인’ 목록에서 NoLate 연결을 직접 해제해 주세요.",
    };
}
