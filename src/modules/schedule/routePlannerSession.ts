import type { Place, ScheduleItem, TravelMode } from "./types";

export type RoutePlannerPayload = {
    origin?: Place;
    destination?: Place;
    travelMode: TravelMode;
    travelMinutes?: number;
    locationName?: string;
    /** 일정 시작 시각. 경로 화면에서는 이 시각에 도착하도록 출발 기준을 계산한다. */
    targetArrivalAt?: string;
    /** 공급자 경로를 조회하고 저장할 때 사용한 실제 출발 기준 시각. */
    departureAt?: string;
    // 기존 일정에 저장된 route 형식도 함께 통과시키고, 소비 화면의 경계에서 용도별로 검증한다.
    route?: unknown;
};

type RoutePlannerPlaceDraft = {
    name?: string | null;
    address?: string | null;
    lat?: number;
    lng?: number;
};

type ScheduleRoutePlannerInitialInput = {
    origin?: Place;
    destination?: Place;
    travelMode: TravelMode;
    travelMinutes?: number;
    locationName?: string;
    targetArrivalAt: Date | string;
    departureAt?: string;
    route?: unknown;
};

export type ScheduleRouteUpdatePayload = Omit<ScheduleItem, "id" | "updatedAt">;

export type RoutePlannerReturnObservation = {
    hasVisitedRouteFlow: boolean;
    shouldConsumeResult: boolean;
};

/** state 갱신이 navigation보다 먼저 끝나도 경로 화면을 실제로 다녀온 뒤에만 결과를 소비한다. */
export function observeRoutePlannerReturn(
    pathname: string,
    hasVisitedRouteFlow: boolean
): RoutePlannerReturnObservation {
    if (pathname === "/schedule/route-select" || pathname === "/schedule/route-planner") {
        return { hasVisitedRouteFlow: true, shouldConsumeResult: false };
    }
    if (!hasVisitedRouteFlow) {
        return { hasVisitedRouteFlow: false, shouldConsumeResult: false };
    }
    return { hasVisitedRouteFlow: false, shouldConsumeResult: true };
}

function cleanOptionalText(value?: string | null): string | undefined {
    const normalized = value?.trim();
    return normalized || undefined;
}

/** 폼에 남아 있는 장소 텍스트와 좌표를 경로 화면용 Place로 보존한다. */
export function buildRoutePlannerPlace(
    draft: RoutePlannerPlaceDraft,
    fallbackName: string
): Place | undefined {
    const name = cleanOptionalText(draft.name);
    const address = cleanOptionalText(draft.address);
    const hasCoords = Number.isFinite(draft.lat) && Number.isFinite(draft.lng);
    if (!name && !address && !hasCoords) return undefined;

    return {
        name: name ?? address ?? fallbackName,
        address,
        lat: hasCoords ? draft.lat : undefined,
        lng: hasCoords ? draft.lng : undefined,
    };
}

/** 일정 시작 시각을 도착 기준으로 명시한 경로 화면 초기값을 만든다. */
export function buildScheduleRoutePlannerInitial(
    input: ScheduleRoutePlannerInitialInput
): RoutePlannerPayload {
    const targetArrivalAt = input.targetArrivalAt instanceof Date
        ? input.targetArrivalAt.toISOString()
        : input.targetArrivalAt;

    return {
        origin: input.origin,
        destination: input.destination,
        travelMode: input.travelMode,
        travelMinutes: input.travelMinutes,
        locationName: cleanOptionalText(input.locationName),
        targetArrivalAt,
        departureAt: input.departureAt,
        route: input.route,
    };
}

/** 일정 상세에서 선택한 새 경로를 기존 일정의 나머지 필드를 보존해 저장한다. */
export function buildScheduleRouteUpdatePayload(
    item: ScheduleItem,
    result: RoutePlannerPayload
): ScheduleRouteUpdatePayload {
    const originName = cleanOptionalText(result.origin?.name) ?? cleanOptionalText(result.origin?.address);
    const destinationName = cleanOptionalText(result.destination?.name)
        ?? cleanOptionalText(result.destination?.address);
    const locationName = cleanOptionalText(result.locationName)
        ?? (originName && destinationName ? `${originName} → ${destinationName}` : destinationName ?? originName);

    return {
        title: item.title,
        startAt: item.startAt,
        endAt: item.endAt,
        hasEndTime: item.hasEndTime,
        allDay: item.allDay,
        category: item.category,
        notes: item.notes,
        notificationEnabled: item.notificationEnabled,
        notificationLeadMinutes: item.notificationLeadMinutes,
        notificationIntervalMinutes: item.notificationIntervalMinutes,
        origin: result.origin,
        destination: result.destination,
        travelMode: result.travelMode,
        travelMinutes: result.travelMinutes,
        locationName,
        departAt: result.departureAt,
        route: result.route,
    };
}

type RoutePlannerSession = {
    initial?: RoutePlannerPayload;
    result?: RoutePlannerPayload;
    updatedAt: number;
};

const ROUTE_PLANNER_SESSION_TTL_MS = 1000 * 60 * 60;
const sessions = new Map<string, RoutePlannerSession>();

// 경로 목록과 지도 상세 화면 사이의 한 번의 네비게이션 왕복만 위한 임시 인메모리 브리지다.
// 콜드 스타트 시 루트 네비게이션과 작성 폼/sessionId가 복원되지 않으므로 payload만 영속화하면
// 소비 화면이 없는 고아 초안이 된다. 향후 네비게이션 상태와 원본 폼 초안을 함께 복원할 때만
// AsyncStorage 기반 저장소로 교체해야 한다.
function pruneExpiredSessions(now = Date.now()): void {
    sessions.forEach((session, sessionId) => {
        if (now - session.updatedAt > ROUTE_PLANNER_SESSION_TTL_MS) {
            sessions.delete(sessionId);
        }
    });
}

function getOrCreateSession(sessionId: string): RoutePlannerSession {
    pruneExpiredSessions();
    const current = sessions.get(sessionId);
    if (current) {
        current.updatedAt = Date.now();
        return current;
    }
    const created: RoutePlannerSession = { updatedAt: Date.now() };
    sessions.set(sessionId, created);
    return created;
}

export function setRoutePlannerInitial(sessionId: string, initial: RoutePlannerPayload): void {
    const session = getOrCreateSession(sessionId);
    session.initial = initial;
}

export function getRoutePlannerInitial(sessionId: string): RoutePlannerPayload | undefined {
    pruneExpiredSessions();
    return sessions.get(sessionId)?.initial;
}

export function setRoutePlannerResult(sessionId: string, result: RoutePlannerPayload): void {
    const session = getOrCreateSession(sessionId);
    session.result = result;
}

export function consumeRoutePlannerResult(sessionId: string): RoutePlannerPayload | undefined {
    pruneExpiredSessions();
    const session = sessions.get(sessionId);
    if (!session?.result) return undefined;
    const value = session.result;
    delete session.result;
    session.updatedAt = Date.now();
    return value;
}

/** 일정 상세용 경로 결과를 한 번 소비하고 API 갱신 payload로 변환한다. */
export function consumeScheduleRouteUpdatePayload(
    sessionId: string,
    item: ScheduleItem
): ScheduleRouteUpdatePayload | undefined {
    const result = consumeRoutePlannerResult(sessionId);
    return result ? buildScheduleRouteUpdatePayload(item, result) : undefined;
}
