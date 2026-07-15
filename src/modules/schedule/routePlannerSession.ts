import type { Place, TravelMode } from "./types";

export type RoutePlannerPayload = {
    origin?: Place;
    destination?: Place;
    travelMode: TravelMode;
    travelMinutes?: number;
    locationName?: string;
    // 기존 일정에 저장된 route 형식도 함께 통과시키고, 소비 화면의 경계에서 용도별로 검증한다.
    route?: unknown;
};

type RoutePlannerSession = {
    initial?: RoutePlannerPayload;
    result?: RoutePlannerPayload;
    updatedAt: number;
};

const ROUTE_PLANNER_SESSION_TTL_MS = 1000 * 60 * 60;
const sessions = new Map<string, RoutePlannerSession>();

// 경로 목록과 지도 상세 화면 사이의 짧은 왕복을 위한 인메모리 브리지.
// 앱 재시작 뒤에도 작성 중인 경로를 복구해야 하면 영속 draft 저장소로 교체한다.
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
