import { apiDelete, apiGet, apiPost, apiPut } from "./api";
import { assertApiSuccess, type ApiEnvelope, unwrapApiResponse } from "./response";
import type {
    QuickScheduleReliabilityFeedback,
    ScheduleItem,
    ScheduleParseResult,
} from "../modules/schedule/types";
import { dedupeCalendarSchedules } from "../modules/schedule/calendarScheduleDedupe";
import {
    clearCalendarScheduleCache,
    removeCalendarScheduleCacheItem,
    upsertCalendarScheduleCacheItem,
} from "../modules/schedule/calendarScheduleCache";

export type SchedulePayload = Omit<ScheduleItem, "id" | "updatedAt">;

export type CalendarImportSourcePayload = {
    provider: "APPLE_DEVICE" | "ANDROID_DEVICE" | "GOOGLE";
    calendarId: string;
    eventId: string;
    occurrenceStartAt: string;
};

export type CalendarImportResult = {
    item: ScheduleItem;
    created: boolean;
};

export type NotificationSendResult = {
    requestedCount: number;
    sentCount: number;
    failedCount: number;
    removedTokenCount: number;
};

export type ScheduleEtaArrivalObservation = {
    scheduleId: number;
    pushJobId?: number | null;
    departedAt: string;
    predictionEvaluatedAt: string;
    recommendedDepartureAt: string;
    targetArrivalAt: string;
    predictedArrivalAt: string;
    actualArrivalAt: string;
    observationSource: ScheduleArrivalObservationSource;
    observationVerification: "UNVERIFIED_CLIENT" | "VERIFIED_GEOFENCE";
    precisionSeconds: number;
    adjustmentSeconds?: number | null;
    clientAppVersion?: string | null;
    clientBuildVersion?: string | null;
    backendCohortVersion: string;
    eligibilityPolicyVersion: string;
    recordedAt: string;
    etaSource: string;
    etaStale: boolean;
    travelMinutes: number;
    travelMode: string;
    predictionBasis: string;
    providerId: string;
    algorithmVersion: string;
    providerFetchedAt?: string | null;
    predictedOnTime: boolean;
    actualOnTime: boolean;
    onTimeOutcome: string;
    departureOffsetSeconds: number;
    actualTravelSeconds: number;
    reportDelaySeconds: number;
    accuracyEligible: boolean;
    accuracyEligibilityReason: string;
    signedErrorSeconds: number;
    absoluteErrorSeconds: number;
};

export type ScheduleArrivalObservationSource = "USER_NOW" | "USER_ADJUSTED" | "GEOFENCE";

export type ScheduleArrivalObservationCapture = {
    arrivedAt: string;
    observationSource: ScheduleArrivalObservationSource;
    precisionSeconds: number;
    adjustmentSeconds?: number;
    clientAppVersion?: string;
    clientBuildVersion?: string;
};

export type ScheduleEtaObservationEngagementEvent = "EXPOSED" | "PROMPT_OPENED";

export type ScheduleEtaObservationEngagementCapture = {
    event: ScheduleEtaObservationEngagementEvent;
    clientAppVersion?: string;
    clientBuildVersion?: string;
    uxVariant?: string;
};

export type ScheduleEtaObservationEngagement = {
    scheduleId: number;
    exposedAt?: string | null;
    exposedClientAppVersion?: string | null;
    exposedClientBuildVersion?: string | null;
    exposedUxVariant?: string | null;
    promptedAt?: string | null;
    promptedClientAppVersion?: string | null;
    promptedClientBuildVersion?: string | null;
    promptedUxVariant?: string | null;
    respondedAt?: string | null;
};

export type ParseScheduleInputType =
    | "TEXT"
    | "CONVERSATION"
    | "IMAGE_OCR"
    | "VOICE_TRANSCRIPT"
    | "SHARE_TEXT";

export type ParseScheduleTextPayload = {
    text: string;
    inputType?: ParseScheduleInputType;
    recognitionConfidence?: number;
    recognitionAlternatives?: Array<{
        text: string;
        confidence?: number;
    }>;
    referenceDate?: string;
    defaultDurationMinutes?: number;
    clientPlatform?: "IOS" | "ANDROID" | "UNKNOWN";
};

type ScheduleDto = Omit<ScheduleItem, "id"> & {
    id?: number | string | null;
};

type CalendarImportResultDto = {
    schedule: ScheduleDto;
    created: boolean;
};

type CalendarCacheRevisionDto = {
    revision: number;
};

let observedCalendarCacheRevision: number | null = null;

function normalizeSchedule(dto: ScheduleDto): ScheduleItem {
    if (dto.id === undefined || dto.id === null) {
        throw new Error("일정 id가 응답에 없습니다.");
    }

    return {
        ...dto,
        id: String(dto.id),
    };
}

export async function getSchedules(): Promise<ScheduleItem[]> {
    const response = await apiGet<ApiEnvelope<ScheduleDto[]>>("/api/schedules");
    return dedupeCalendarSchedules(unwrapApiResponse(response).map(normalizeSchedule));
}

export async function getCalendarSchedules(startAt: string, endAt: string): Promise<ScheduleItem[]> {
    const response = await apiGet<ApiEnvelope<ScheduleDto[]>>("/api/schedules/calendar", {
        params: { startAt, endAt },
    });
    return dedupeCalendarSchedules(unwrapApiResponse(response).map(normalizeSchedule));
}

export async function synchronizeCalendarScheduleCacheRevision(): Promise<boolean> {
    const response = await apiGet<ApiEnvelope<CalendarCacheRevisionDto>>(
        "/api/schedules/calendar-cache/revision",
    );
    const revision = unwrapApiResponse(response).revision;
    const changed = observedCalendarCacheRevision !== null &&
        observedCalendarCacheRevision !== revision;
    observedCalendarCacheRevision = revision;
    if (changed) {
        clearCalendarScheduleCache();
    }
    return changed;
}

export async function getDailySchedules(date: string): Promise<ScheduleItem[]> {
    const response = await apiGet<ApiEnvelope<ScheduleDto[]>>("/api/schedules/daily", {
        params: { date },
    });
    return unwrapApiResponse(response).map(normalizeSchedule);
}

export async function getUpcomingSchedules(fromAt?: string, limit?: number): Promise<ScheduleItem[]> {
    const response = await apiGet<ApiEnvelope<ScheduleDto[]>>("/api/schedules/upcoming", {
        params: { fromAt, limit },
    });
    return unwrapApiResponse(response).map(normalizeSchedule);
}

export async function searchSchedules(params: {
    keyword?: string;
    categoryId?: string;
    startAt?: string;
    endAt?: string;
}): Promise<ScheduleItem[]> {
    const response = await apiGet<ApiEnvelope<ScheduleDto[]>>("/api/schedules/search", { params });
    return unwrapApiResponse(response).map(normalizeSchedule);
}

export async function getDepartureReadySchedules(fromAt?: string, toAt?: string): Promise<ScheduleItem[]> {
    const response = await apiGet<ApiEnvelope<ScheduleDto[]>>("/api/schedules/departures", {
        params: { fromAt, toAt },
    });
    return unwrapApiResponse(response).map(normalizeSchedule);
}

export async function getSchedule(scheduleId: string): Promise<ScheduleItem> {
    const response = await apiGet<ApiEnvelope<ScheduleDto>>(`/api/schedules/${scheduleId}`);
    const item = normalizeSchedule(unwrapApiResponse(response));
    upsertCalendarScheduleCacheItem(item);
    return item;
}

export async function createSchedule(payload: SchedulePayload): Promise<ScheduleItem> {
    const response = await apiPost<ApiEnvelope<ScheduleDto>, SchedulePayload>("/api/schedules", payload);
    const item = normalizeSchedule(unwrapApiResponse(response));
    const cachedItem = { ...item, route: item.route ?? payload.route };
    upsertCalendarScheduleCacheItem(cachedItem);
    return cachedItem;
}

export async function importCalendarSchedule(
    payload: SchedulePayload,
    source: CalendarImportSourcePayload
): Promise<CalendarImportResult> {
    const response = await apiPost<
        ApiEnvelope<CalendarImportResultDto>,
        { schedule: SchedulePayload; source: CalendarImportSourcePayload }
    >("/api/schedules/import", { schedule: payload, source });
    const result = unwrapApiResponse(response);
    const item = normalizeSchedule(result.schedule);
    const cachedItem = {
        ...item,
        // 기존 일정을 반환받은 경우에는 이번 시도에서 계산한 경로를 저장된 값처럼 섞지 않는다.
        route: item.route ?? (result.created ? payload.route : undefined),
    };
    upsertCalendarScheduleCacheItem(cachedItem);

    return {
        item: cachedItem,
        created: result.created,
    };
}

export async function parseScheduleText(payload: ParseScheduleTextPayload): Promise<ScheduleParseResult> {
    const response = await apiPost<ApiEnvelope<ScheduleParseResult>, ParseScheduleTextPayload>(
        "/api/schedules/parse",
        payload
    );
    return unwrapApiResponse(response);
}

export async function recordQuickScheduleReliabilityFeedback(
    feedback: QuickScheduleReliabilityFeedback,
): Promise<void> {
    const { analysisId, ...payload } = feedback;
    const response = await apiPost<ApiEnvelope<unknown>, typeof payload>(
        `/api/schedules/parse/${encodeURIComponent(analysisId)}/feedback`,
        payload,
    );
    assertApiSuccess(response);
}

export async function updateSchedule(scheduleId: string, payload: SchedulePayload): Promise<ScheduleItem> {
    const response = await apiPut<ApiEnvelope<ScheduleDto>, SchedulePayload>(`/api/schedules/${scheduleId}`, payload);
    const item = normalizeSchedule(unwrapApiResponse(response));
    const cachedItem = { ...item, route: item.route ?? payload.route };
    upsertCalendarScheduleCacheItem(cachedItem);
    return cachedItem;
}

export async function deleteSchedule(scheduleId: string): Promise<void> {
    const response = await apiDelete<ApiEnvelope<unknown>>(`/api/schedules/${scheduleId}`);
    assertApiSuccess(response);
    removeCalendarScheduleCacheItem(scheduleId);
}

export async function markScheduleDeparted(scheduleId: string): Promise<ScheduleItem> {
    // 푸시 액션에서 출발 처리만 수행한다. 화면 이동은 알림 응답 핸들러가 별도로 결정한다.
    const response = await apiPost<ApiEnvelope<ScheduleDto>>(`/api/schedules/${scheduleId}/depart-now`);
    const item = normalizeSchedule(unwrapApiResponse(response));
    upsertCalendarScheduleCacheItem(item);
    return item;
}

/** Records an explicit opt-in arrival with bounded source and temporal uncertainty. */
export async function recordScheduleArrivalObservation(
    scheduleId: string,
    capture: ScheduleArrivalObservationCapture,
): Promise<ScheduleEtaArrivalObservation> {
    const response = await apiPost<
        ApiEnvelope<ScheduleEtaArrivalObservation>,
        ScheduleArrivalObservationCapture
    >(
        `/api/schedules/${scheduleId}/eta-observations/arrival`,
        capture,
    );
    return unwrapApiResponse(response);
}

/** Idempotent, location-free denominator event; callers persist before sending. */
export async function recordScheduleEtaObservationEngagement(
    scheduleId: string,
    capture: ScheduleEtaObservationEngagementCapture,
): Promise<ScheduleEtaObservationEngagement> {
    const response = await apiPost<
        ApiEnvelope<ScheduleEtaObservationEngagement>,
        ScheduleEtaObservationEngagementCapture
    >(
        `/api/schedules/${scheduleId}/eta-observations/engagement`,
        capture,
    );
    return unwrapApiResponse(response);
}

export async function sendScheduleDepartureNudge(
    scheduleId: string,
    targetMemberId: number
): Promise<NotificationSendResult> {
    const response = await apiPost<ApiEnvelope<NotificationSendResult>>(
        `/api/schedules/${scheduleId}/departure-nudges/${targetMemberId}`
    );
    return unwrapApiResponse(response);
}

export async function snoozeScheduleDepartureReminder(scheduleId: string): Promise<void> {
    // 푸시 액션의 재알림 요청은 화면 상태를 바꾸지 않고 서버 job의 nextCheckAt만 갱신한다.
    const response = await apiPost<ApiEnvelope<unknown>>(`/api/schedules/${scheduleId}/departure-reminder/snooze`);
    assertApiSuccess(response);
}
