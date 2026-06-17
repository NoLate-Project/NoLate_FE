const SCHEDULE_DETAIL_TYPES = new Set([
    "SCHEDULE_TRAFFIC",
    "SCHEDULE_DEPARTURE_REMINDER",
    "SCHEDULE_DETAIL",
]);

const PASSIVE_TYPES = new Set([
    "PUSH_SCENARIO_TOKEN_CHECK",
]);

export type PushNavigationTarget = {
    kind: "scheduleDetail";
    scheduleId: string;
};

export type ScheduleDetailRoute = {
    pathname: "/schedule/[id]";
    params: {
        id: string;
    };
};

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
    if (!/^[1-9]\d*$/.test(normalized)) return undefined;

    return normalized;
}

export function getPushNavigationTargetFromNotificationData(
    data?: Record<string, unknown>,
): PushNavigationTarget | undefined {
    const rawType = data?.type;
    const type = typeof rawType === "string" ? rawType.trim() : undefined;

    if (type && PASSIVE_TYPES.has(type)) {
        return undefined;
    }

    if (type && !SCHEDULE_DETAIL_TYPES.has(type)) {
        return undefined;
    }

    const scheduleId = getScheduleIdFromNotificationData(data);
    if (!scheduleId) return undefined;

    return {
        kind: "scheduleDetail",
        scheduleId,
    };
}

export function createScheduleDetailRoute(scheduleId: string): ScheduleDetailRoute {
    return {
        pathname: "/schedule/[id]",
        params: {
            id: scheduleId,
        },
    };
}

export function getScheduleDetailRouteFromNotificationData(
    data?: Record<string, unknown>,
): ScheduleDetailRoute | undefined {
    const target = getPushNavigationTargetFromNotificationData(data);
    if (!target) return undefined;

    return createScheduleDetailRoute(target.scheduleId);
}
