import type { Place, TravelMode } from "./types";

export type RoutePlannerPayload = {
    origin?: Place;
    destination?: Place;
    travelMode: TravelMode;
    travelMinutes?: number;
    locationName?: string;
};

type RoutePlannerSession = {
    initial?: RoutePlannerPayload;
    result?: RoutePlannerPayload;
};

const sessions = new Map<string, RoutePlannerSession>();

function getOrCreateSession(sessionId: string): RoutePlannerSession {
    const current = sessions.get(sessionId);
    if (current) return current;
    const created: RoutePlannerSession = {};
    sessions.set(sessionId, created);
    return created;
}

export function setRoutePlannerInitial(sessionId: string, initial: RoutePlannerPayload): void {
    const session = getOrCreateSession(sessionId);
    session.initial = initial;
}

export function getRoutePlannerInitial(sessionId: string): RoutePlannerPayload | undefined {
    return sessions.get(sessionId)?.initial;
}

export function setRoutePlannerResult(sessionId: string, result: RoutePlannerPayload): void {
    const session = getOrCreateSession(sessionId);
    session.result = result;
}

export function consumeRoutePlannerResult(sessionId: string): RoutePlannerPayload | undefined {
    const session = sessions.get(sessionId);
    if (!session?.result) return undefined;
    const value = session.result;
    delete session.result;
    return value;
}
