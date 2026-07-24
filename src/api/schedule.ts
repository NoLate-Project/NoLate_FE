import { apiDelete, apiGet, apiPost, apiPut } from "./api";
import {
    ApiResponseError,
    assertApiSuccess,
    type ApiEnvelope,
    unwrapApiResponse,
} from "./response";
import type { ScheduleItem, ScheduleParseResult } from "../modules/schedule/types";
import { dedupeCalendarSchedules } from "../modules/schedule/calendarScheduleDedupe";
import {
    captureCalendarScheduleCacheAuthEpoch,
    clearCalendarScheduleCache,
    mutateCalendarScheduleCacheIfAuthSessionCurrent,
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

export type ScheduleDepartureStatusSource =
    | "LIVE_PROVIDER"
    | "SELECTED_ROUTE"
    | "SAVED_FALLBACK";

export type ScheduleDepartureStatusConfidence = "HIGH" | "MEDIUM" | "LOW";

export type ScheduleDepartureStatus = {
    scheduleId: string;
    travelMinutes: number | null;
    recommendedDepartureAt: string | null;
    evaluatedAt: string | null;
    liveFetchedAt: string | null;
    source: ScheduleDepartureStatusSource | null;
    stale: boolean | null;
    confidence: ScheduleDepartureStatusConfidence | null;
    failureReason: string | null;
    lastTrafficChangeMinutes: number | null;
    lastChangedAt: string | null;
    nextCheckAt: string | null;
    preparationMinutes: number | null;
    preparationStartAt: string | null;
    safetyBufferMinutes: number | null;
    timeZone: string | null;
};

export type ScheduleDepartureMutationResult = {
    item?: ScheduleItem;
    status?: ScheduleDepartureStatus;
    refreshing: boolean;
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
    referenceDate?: string;
    defaultDurationMinutes?: number;
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

type ScheduleDepartureStatusDto = {
    scheduleId?: number | string | null;
    travelMinutes?: number | null;
    recommendedDepartureAt?: string | null;
    evaluatedAt?: string | null;
    liveFetchedAt?: string | null;
    source?: string | null;
    stale?: boolean | null;
    confidence?: string | null;
    failureReason?: string | null;
    lastTrafficChangeMinutes?: number | null;
    lastChangedAt?: string | null;
    nextCheckAt?: string | null;
    preparationMinutes?: number | null;
    preparationStartAt?: string | null;
    safetyBufferMinutes?: number | null;
    timeZone?: string | null;
};

let observedCalendarCacheRevision: {
    authEpoch: number;
    revision: number;
} | null = null;

function normalizeSchedule(dto: ScheduleDto): ScheduleItem {
    if (dto.id === undefined || dto.id === null) {
        throw new Error("일정 id가 응답에 없습니다.");
    }

    return {
        ...dto,
        id: String(dto.id),
    };
}

function finiteNumberOrNull(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeScheduleDepartureStatus(
    dto: ScheduleDepartureStatusDto,
    requestedScheduleId: string,
): ScheduleDepartureStatus {
    const source = dto.source === "LIVE_PROVIDER" ||
        dto.source === "SELECTED_ROUTE" ||
        dto.source === "SAVED_FALLBACK"
        ? dto.source
        : null;
    const confidence = dto.confidence === "HIGH" ||
        dto.confidence === "MEDIUM" ||
        dto.confidence === "LOW"
        ? dto.confidence
        : null;

    const responseScheduleId = dto.scheduleId === undefined || dto.scheduleId === null
        ? requestedScheduleId
        : String(dto.scheduleId).trim();
    if (responseScheduleId !== requestedScheduleId) {
        throw new ApiResponseError(
            "출발 상태 응답의 일정 정보가 요청과 일치하지 않습니다.",
            { errorCode: "DEPARTURE_STATUS_SCHEDULE_MISMATCH" },
        );
    }

    return {
        scheduleId: requestedScheduleId,
        travelMinutes: finiteNumberOrNull(dto.travelMinutes),
        recommendedDepartureAt: stringOrNull(dto.recommendedDepartureAt),
        evaluatedAt: stringOrNull(dto.evaluatedAt),
        liveFetchedAt: stringOrNull(dto.liveFetchedAt),
        source,
        stale: typeof dto.stale === "boolean" ? dto.stale : null,
        confidence,
        failureReason: stringOrNull(dto.failureReason),
        lastTrafficChangeMinutes: finiteNumberOrNull(dto.lastTrafficChangeMinutes),
        lastChangedAt: stringOrNull(dto.lastChangedAt),
        nextCheckAt: stringOrNull(dto.nextCheckAt),
        preparationMinutes: finiteNumberOrNull(dto.preparationMinutes),
        preparationStartAt: stringOrNull(dto.preparationStartAt),
        safetyBufferMinutes: finiteNumberOrNull(dto.safetyBufferMinutes),
        timeZone: stringOrNull(dto.timeZone),
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
    const authEpoch = captureCalendarScheduleCacheAuthEpoch();
    const response = await apiGet<ApiEnvelope<CalendarCacheRevisionDto>>(
        "/api/schedules/calendar-cache/revision",
    );
    const revision = unwrapApiResponse(response).revision;
    let changed = false;
    const applied = mutateCalendarScheduleCacheIfAuthSessionCurrent(authEpoch, () => {
        changed = observedCalendarCacheRevision?.authEpoch === authEpoch &&
            observedCalendarCacheRevision.revision !== revision;
        observedCalendarCacheRevision = { authEpoch, revision };
        if (changed) clearCalendarScheduleCache();
    });
    return applied && changed;
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

export async function getSchedule(
    scheduleId: string,
    options: { signal?: AbortSignal; cache?: boolean } = {},
): Promise<ScheduleItem> {
    const authEpoch = captureCalendarScheduleCacheAuthEpoch();
    const url = `/api/schedules/${scheduleId}`;
    const response = options.signal
        ? await apiGet<ApiEnvelope<ScheduleDto>>(url, { signal: options.signal })
        : await apiGet<ApiEnvelope<ScheduleDto>>(url);
    const item = normalizeSchedule(unwrapApiResponse(response));
    if (options.cache !== false) {
        mutateCalendarScheduleCacheIfAuthSessionCurrent(
            authEpoch,
            () => upsertCalendarScheduleCacheItem(item),
        );
    }
    return item;
}

export async function getScheduleDepartureStatus(
    scheduleId: string,
    options: { signal?: AbortSignal } = {},
): Promise<ScheduleDepartureStatus> {
    const url = `/api/schedules/${scheduleId}/departure-status`;
    const response = options.signal
        ? await apiGet<ApiEnvelope<ScheduleDepartureStatusDto>>(url, { signal: options.signal })
        : await apiGet<ApiEnvelope<ScheduleDepartureStatusDto>>(url);
    return normalizeScheduleDepartureStatus(
        unwrapApiResponse(response),
        scheduleId,
    );
}

export async function createSchedule(payload: SchedulePayload): Promise<ScheduleItem> {
    const authEpoch = captureCalendarScheduleCacheAuthEpoch();
    const response = await apiPost<ApiEnvelope<ScheduleDto>, SchedulePayload>("/api/schedules", payload);
    const item = normalizeSchedule(unwrapApiResponse(response));
    const cachedItem = { ...item, route: item.route ?? payload.route };
    mutateCalendarScheduleCacheIfAuthSessionCurrent(
        authEpoch,
        () => upsertCalendarScheduleCacheItem(cachedItem),
    );
    return cachedItem;
}

export async function importCalendarSchedule(
    payload: SchedulePayload,
    source: CalendarImportSourcePayload
): Promise<CalendarImportResult> {
    const authEpoch = captureCalendarScheduleCacheAuthEpoch();
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
    mutateCalendarScheduleCacheIfAuthSessionCurrent(
        authEpoch,
        () => upsertCalendarScheduleCacheItem(cachedItem),
    );

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

export async function updateSchedule(scheduleId: string, payload: SchedulePayload): Promise<ScheduleItem> {
    const authEpoch = captureCalendarScheduleCacheAuthEpoch();
    const response = await apiPut<ApiEnvelope<ScheduleDto>, SchedulePayload>(`/api/schedules/${scheduleId}`, payload);
    const item = normalizeSchedule(unwrapApiResponse(response));
    const cachedItem = { ...item, route: item.route ?? payload.route };
    mutateCalendarScheduleCacheIfAuthSessionCurrent(
        authEpoch,
        () => upsertCalendarScheduleCacheItem(cachedItem),
    );
    return cachedItem;
}

export async function deleteSchedule(scheduleId: string): Promise<void> {
    const authEpoch = captureCalendarScheduleCacheAuthEpoch();
    const response = await apiDelete<ApiEnvelope<unknown>>(`/api/schedules/${scheduleId}`);
    assertApiSuccess(response);
    mutateCalendarScheduleCacheIfAuthSessionCurrent(
        authEpoch,
        () => removeCalendarScheduleCacheItem(scheduleId),
    );
}

function normalizeDepartureMutationResult(
    data: unknown,
    scheduleId: string,
): ScheduleDepartureMutationResult {
    if (!data || typeof data !== "object") return { refreshing: true };
    const record = data as {
        schedule?: ScheduleDto;
        departureStatus?: ScheduleDepartureStatusDto;
        status?: ScheduleDepartureStatusDto;
        id?: unknown;
    };
    const itemDto = record.schedule ?? (record.id !== undefined ? record as ScheduleDto : undefined);
    const statusDto = record.departureStatus ?? record.status;
    const item = itemDto ? normalizeSchedule(itemDto) : undefined;
    if (item && item.id !== scheduleId) {
        throw new ApiResponseError(
            "출발 처리 응답의 일정 정보가 요청과 일치하지 않습니다.",
            { errorCode: "DEPARTURE_MUTATION_SCHEDULE_MISMATCH" },
        );
    }
    if (
        statusDto &&
        (
            statusDto.scheduleId === undefined ||
            statusDto.scheduleId === null ||
            String(statusDto.scheduleId).trim() !== scheduleId
        )
    ) {
        throw new ApiResponseError(
            "출발 처리 응답의 상태 정보가 요청과 일치하지 않습니다.",
            { errorCode: "DEPARTURE_MUTATION_STATUS_MISMATCH" },
        );
    }
    return {
        item,
        status: statusDto
            ? normalizeScheduleDepartureStatus(statusDto, scheduleId)
            : undefined,
        refreshing: !statusDto,
    };
}

export async function markScheduleDeparted(
    scheduleId: string,
    options: { signal?: AbortSignal; idempotencyKey?: string } = {},
): Promise<ScheduleDepartureMutationResult> {
    const authEpoch = captureCalendarScheduleCacheAuthEpoch();
    // 푸시 액션에서 출발 처리만 수행한다. 화면 이동은 알림 응답 핸들러가 별도로 결정한다.
    const url = `/api/schedules/${scheduleId}/depart-now`;
    const requestConfig = options.signal || options.idempotencyKey
        ? {
            signal: options.signal,
            headers: options.idempotencyKey
                ? { "Idempotency-Key": options.idempotencyKey }
                : undefined,
        }
        : undefined;
    const response = requestConfig
        ? await apiPost<ApiEnvelope<unknown>>(url, undefined, requestConfig)
        : await apiPost<ApiEnvelope<unknown>>(url);
    const result = normalizeDepartureMutationResult(unwrapApiResponse(response), scheduleId);
    if (!result.item) throw new ApiResponseError("출발 완료 응답에 일정 정보가 없습니다.");
    mutateCalendarScheduleCacheIfAuthSessionCurrent(
        authEpoch,
        () => upsertCalendarScheduleCacheItem(result.item!),
    );
    return result;
}

export async function sendScheduleDepartureNudge(
    scheduleId: string,
    targetMemberId: number,
    options: { signal?: AbortSignal } = {},
): Promise<NotificationSendResult> {
    const url = `/api/schedules/${scheduleId}/departure-nudges/${targetMemberId}`;
    const response = options.signal
        ? await apiPost<ApiEnvelope<NotificationSendResult>>(
            url,
            undefined,
            { signal: options.signal },
        )
        : await apiPost<ApiEnvelope<NotificationSendResult>>(url);
    return unwrapApiResponse(response);
}

export async function snoozeScheduleDepartureReminder(
    scheduleId: string,
    options: { signal?: AbortSignal; idempotencyKey?: string } = {},
): Promise<ScheduleDepartureMutationResult> {
    const authEpoch = captureCalendarScheduleCacheAuthEpoch();
    const url = `/api/schedules/${scheduleId}/departure-reminder/snooze`;
    const requestConfig = options.signal || options.idempotencyKey
        ? {
            signal: options.signal,
            headers: options.idempotencyKey
                ? { "Idempotency-Key": options.idempotencyKey }
                : undefined,
        }
        : undefined;
    const response = requestConfig
        ? await apiPost<ApiEnvelope<unknown>>(url, undefined, requestConfig)
        : await apiPost<ApiEnvelope<unknown>>(url);
    assertApiSuccess(response);
    const result = normalizeDepartureMutationResult(response.data, scheduleId);
    if (result.item) {
        mutateCalendarScheduleCacheIfAuthSessionCurrent(
            authEpoch,
            () => upsertCalendarScheduleCacheItem(result.item!),
        );
    }
    return result;
}
