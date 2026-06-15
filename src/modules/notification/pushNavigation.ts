/**
 * Android FCM과 iOS APNs가 전달하는 payload에서 유효한 일정 ID만 추출한다.
 * 네이티브 모듈과 분리해 두 플랫폼의 화면 이동 규칙을 동일하게 테스트할 수 있다.
 */
export function getScheduleIdFromNotificationData(
    data?: Record<string, unknown>,
): string | undefined {
    const scheduleId = data?.scheduleId;
    if (typeof scheduleId !== "string") return undefined;

    const normalized = scheduleId.trim();
    return normalized || undefined;
}
