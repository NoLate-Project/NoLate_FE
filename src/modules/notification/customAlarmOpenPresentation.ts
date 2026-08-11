import type { NoLateCustomAlarmNavigationTarget } from "./customAlarmNavigation";

export type NoLateCustomAlarmOpenOutcome = "opened" | "deferred" | "rejected";

const CUSTOM_ALARM_PRESENTATION_DEADLINE_MS = 2_500;
const CUSTOM_ALARM_NOTIFICATION_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** 인앱 알람 열기 결과를 OS 표시 제한 시간까지만 기다리고, 초과 시 호출자가 정한 대체 결과를 반환합니다. */
export async function settleCustomAlarmOpenOutcomeWithinPresentationDeadline(
    work: Promise<NoLateCustomAlarmOpenOutcome>,
    onDeadline: () => NoLateCustomAlarmOpenOutcome,
): Promise<NoLateCustomAlarmOpenOutcome> {
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<NoLateCustomAlarmOpenOutcome>((resolve) => {
        deadlineTimer = setTimeout(() => resolve(onDeadline()), CUSTOM_ALARM_PRESENTATION_DEADLINE_MS);
    });
    try {
        return await Promise.race([work, deadline]);
    } finally {
        if (deadlineTimer) clearTimeout(deadlineTimer);
    }
}

/** 동일한 알람 발생이 포그라운드 수신과 사용자 탭으로 중복 처리되지 않도록 안정적인 키를 만듭니다. */
export function customAlarmOccurrenceDedupeKey(target: NoLateCustomAlarmNavigationTarget): string {
    if (target.isPreview) return `preview:${target.previewId ?? target.alarmId}`;
    return [
        "alarm",
        target.nativeAlarmId ?? target.alarmId,
        String(target.alarmGeneration ?? ""),
        target.occurrenceId ?? "",
    ].join(":");
}

/** 알림 식별자가 허용 문자·길이와 미리보기/실제 알람별 네임스페이스를 모두 만족하는지 확인합니다. */
export function isCanonicalCustomAlarmNotificationIdentifier(identifier: string, isPreview: boolean): boolean {
    if (!CUSTOM_ALARM_NOTIFICATION_IDENTIFIER_PATTERN.test(identifier)) return false;
    return isPreview
        ? identifier.startsWith("nolate.custom-alarm.preview.")
        : identifier.startsWith("nolate.departure.");
}

/** 일반 포그라운드 알림을 배너·목록·소리로 표시하는 Expo 처리 결과를 반환합니다. */
export function defaultNotificationPresentationBehavior() {
    return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
}

/** 인앱 알람이 표시를 소유한 경우 OS 배너와 소리를 모두 억제하는 Expo 처리 결과를 반환합니다. */
export function suppressedNotificationPresentationBehavior() {
    return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };
}
