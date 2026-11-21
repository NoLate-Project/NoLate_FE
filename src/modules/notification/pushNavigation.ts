const SCHEDULE_DETAIL_TYPES = new Set([
    "SCHEDULE_TRAFFIC",
    "SCHEDULE_DEPARTURE_REMINDER",
    "SCHEDULE_DETAIL",
    "SCHEDULE_SHARE_RECEIVED",
    "SCHEDULE_PARTICIPANT_DEPARTED",
    "SCHEDULE_DEPARTURE_NUDGE",
    "ROUTE_SETUP_REMINDER",
]);

const SHARE_INBOX_TYPES = new Set([
    "CATEGORY_SHARE_RECEIVED",
    "CALENDAR_SHARE_RECEIVED",
]);

// 토큰 확인처럼 사용자에게 보이지만 특정 화면으로 이동할 필요가 없는 검증 payload다.
const PASSIVE_TYPES = new Set([
    "PUSH_SCENARIO_TOKEN_CHECK",
]);

export const SCHEDULE_DEPARTURE_ACTION_CATEGORY = "schedule_depart_now";

export type PushNavigationTarget =
    | {
        kind: "scheduleDetail";
        scheduleId: string;
        guidanceSession?: string;
    }
    | {
        kind: "shareInbox";
    };

/** Immediate native guidance notices link to the same session as its Live Activity. */
export function localGuidanceNoticeTarget(request: {
    identifier: string;
    trigger?: unknown;
    content: { data?: Record<string, unknown> | null };
}): { scheduleId: string; guidanceSession: string } | undefined {
    if (request.trigger != null || !/^nolate\.guidance\.notice\.[a-f0-9]{64}$/.test(request.identifier)) return;
    const data = request.content.data;
    const scheduleId = data?.scheduleId;
    const guidanceSession = data?.guidanceSession;
    if (typeof scheduleId === "string" && /^[1-9]\d{0,15}$/.test(scheduleId)
        && typeof guidanceSession === "string"
        && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(guidanceSession)) {
        return { scheduleId, guidanceSession };
    }
}

export type ScheduleDetailRoute = {
    pathname: "/schedule/[id]";
    params: {
        id: string;
        openRouteDetail: "1";
    };
};

export type PushNavigationReadiness = {
    isLoading: boolean;
    isAuthenticated: boolean;
    isCurationCompleted: boolean;
};

export function isPushNavigationReady({
    isLoading,
    isAuthenticated,
    isCurationCompleted,
}: PushNavigationReadiness): boolean {
    return !isLoading && isAuthenticated && isCurationCompleted;
}

/**
 * Notification SDKs clear their native "last response" after it is read. Keep
 * the most recent parsed target in JS until the protected navigator is ready,
 * so a cold-start notification is not lost behind login or onboarding.
 */
export function createPendingPushNavigationQueue() {
    let pendingTarget: PushNavigationTarget | undefined;

    return {
        defer(target: PushNavigationTarget) {
            pendingTarget = target;
        },
        consumeIfReady(readiness: PushNavigationReadiness): PushNavigationTarget | undefined {
            if (!isPushNavigationReady(readiness)) return undefined;

            const target = pendingTarget;
            pendingTarget = undefined;
            return target;
        },
        peek(): PushNavigationTarget | undefined {
            return pendingTarget;
        },
    };
}

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

    if (type && SHARE_INBOX_TYPES.has(type)) {
        const resourceId = type === "CALENDAR_SHARE_RECEIVED" ? data?.calendarId : data?.categoryId;
        if (typeof resourceId !== "string" || !/^[1-9]\d*$/.test(resourceId.trim())) {
            return undefined;
        }
        return { kind: "shareInbox" };
    }

    if (type && !SCHEDULE_DETAIL_TYPES.has(type)) {
        return undefined;
    }

    // type이 없는 구형 payload도 scheduleId가 유효하면 상세 이동을 허용해 기존 알림과 호환한다.
    const scheduleId = getScheduleIdFromNotificationData(data);
    if (!scheduleId) return undefined;

    return {
        kind: "scheduleDetail",
        scheduleId,
    };
}

export function getNotificationActionCategoryFromData(
    data?: Record<string, unknown>,
): string | undefined {
    const type = typeof data?.type === "string" ? data.type.trim() : undefined;
    const scheduleId = getScheduleIdFromNotificationData(data);

    return type === "SCHEDULE_DEPARTURE_REMINDER" && scheduleId
        ? SCHEDULE_DEPARTURE_ACTION_CATEGORY
        : undefined;
}

export function createScheduleDetailRoute(scheduleId: string): ScheduleDetailRoute {
    return {
        pathname: "/schedule/[id]",
        params: {
            id: scheduleId,
            openRouteDetail: "1",
        },
    };
}

export function getScheduleDetailRouteFromNotificationData(
    data?: Record<string, unknown>,
): ScheduleDetailRoute | undefined {
    const target = getPushNavigationTargetFromNotificationData(data);
    if (!target || target.kind !== "scheduleDetail") return undefined;

    return createScheduleDetailRoute(target.scheduleId);
}
