import type { TransitLegDetail } from "../modules/map/routingService";
import { apiGet, apiPost, apiPut } from "./api";
import { assertApiSuccess, type ApiEnvelope, unwrapApiResponse } from "./response";
import type { JourneyProgress } from "../modules/journey/types";
import { JOURNEY_PHASES } from "../modules/journey/types";
import { normalizeJourneyRoute } from "../modules/journey/journeyRoute";

export type JourneySession = JourneyProgress & {
    scheduleId: string;
    startedAt: string;
    expiresAt: string;
    source: "MANUAL";
    routeSnapshot: unknown;
    routeLegs: TransitLegDetail[];
};

export type JourneyProgressRequest = Pick<JourneyProgress,
    "generation" | "routeRevision" | "sequence" | "phase" | "activeLegIndex" |
    "currentStopIndex" | "remainingStops" | "legProgress" | "observedAt"
> & { source: "MANUAL" };

export type JourneyTerminalRequest = Pick<JourneyProgress,
    "generation" | "routeRevision" | "sequence" | "observedAt"
>;

function path(scheduleId: string, sessionId?: string): string {
    if (!/^[1-9]\d*$/.test(scheduleId)) throw new Error("올바른 일정을 선택해 주세요.");
    const base = `/api/schedules/${scheduleId}/journey`;
    return sessionId ? `${base}/${encodeURIComponent(sessionId)}` : base;
}

/** Reject incomplete/foreign snapshots before they can drive UI or a progress mutation. */
function readSession(value: unknown, scheduleId: string): JourneySession {
    const item = value as JourneySession | null;
    const validInteger = (number: unknown) => typeof number === "number" && Number.isSafeInteger(number) && number >= 0;
    const validDate = (date: unknown) => typeof date === "string" && Number.isFinite(Date.parse(date));
    if (!item || typeof item !== "object"
        || typeof item.sessionId !== "string" || !item.sessionId.trim()
        || item.scheduleId !== scheduleId || item.source !== "MANUAL"
        || !validInteger(item.generation) || !validInteger(item.routeRevision) || !validInteger(item.sequence)
        || !JOURNEY_PHASES.includes(item.phase) || !validInteger(item.activeLegIndex)
        || !Number.isFinite(item.legProgress) || item.legProgress < 0 || item.legProgress > 1
        || typeof item.nextInstruction !== "string"
        || !validDate(item.observedAt) || !validDate(item.startedAt) || !validDate(item.expiresAt)
        || (item.currentStopIndex != null && !validInteger(item.currentStopIndex))
        || (item.remainingStops != null && !validInteger(item.remainingStops))) {
        throw new Error("길안내 응답을 확인하지 못했어요. 다시 시도해 주세요.");
    }
    const route = normalizeJourneyRoute(item.routeLegs);
    if (item.activeLegIndex >= route.legs.length) throw new Error("길안내 경로 구간이 올바르지 않아요.");
    return { ...item, currentStopIndex: item.currentStopIndex ?? null, remainingStops: item.remainingStops ?? null };
}

export async function getJourneySession(scheduleId: string): Promise<JourneySession | null> {
    const response = await apiGet<ApiEnvelope<JourneySession>>(path(scheduleId));
    assertApiSuccess(response);
    return response.data == null ? null : readSession(response.data, scheduleId);
}

export async function startJourneySession(scheduleId: string, requestId: string, deviceId?: string): Promise<JourneySession> {
    return readSession(unwrapApiResponse(await apiPost<ApiEnvelope<JourneySession>>(
        `${path(scheduleId)}/start`, { requestId, ...(deviceId ? { deviceId } : {}) },
    )), scheduleId);
}

export function journeyProgressRequest(progress: JourneyProgress): JourneyProgressRequest {
    // Deliberately omit route coordinates, free-form copy, ETA, and server-owned metadata.
    return {
        generation: progress.generation,
        routeRevision: progress.routeRevision,
        sequence: progress.sequence,
        phase: progress.phase,
        activeLegIndex: progress.activeLegIndex,
        currentStopIndex: progress.currentStopIndex ?? null,
        remainingStops: progress.remainingStops ?? null,
        legProgress: progress.legProgress,
        observedAt: progress.observedAt,
        source: "MANUAL",
    };
}

export async function updateJourneyProgress(scheduleId: string, sessionId: string, request: JourneyProgressRequest): Promise<JourneySession> {
    return readSession(unwrapApiResponse(await apiPut<ApiEnvelope<JourneySession>>(
        `${path(scheduleId, sessionId)}/progress`, request,
    )), scheduleId);
}

export async function finishJourneySession(scheduleId: string, sessionId: string, operation: "arrive" | "stop", request: JourneyTerminalRequest): Promise<JourneySession> {
    return readSession(unwrapApiResponse(await apiPost<ApiEnvelope<JourneySession>>(
        `${path(scheduleId, sessionId)}/${operation}`, request,
    )), scheduleId);
}
