import type * as ExpoCalendar from "expo-calendar";
import { Platform } from "react-native";

import type { CalendarImportSourcePayload, SchedulePayload } from "../../api/schedule";
import type { ScheduleCategory, TravelMode } from "../schedule/types";
import { withCalendarImportTimeout } from "./calendarImportReliability";

export type DeviceCalendarProvider = "APPLE_DEVICE" | "ANDROID_DEVICE" | "GOOGLE";

export type DeviceCalendarCandidate = {
    id: string;
    provider: DeviceCalendarProvider;
    eventId: string;
    calendarId: string;
    calendarTitle: string;
    calendarColor?: string;
    title: string;
    startAt: string;
    endAt: string;
    allDay: boolean;
    locationName?: string;
    notes?: string;
    requiresTimeReview: boolean;
};

export type CalendarImportSettings = {
    category: ScheduleCategory;
    travelMode: TravelMode;
    travelMinutes: number;
    prepareDepartureAlert: boolean;
};

export type DeviceCalendarSource = {
    id: string;
    title: string;
    color?: string;
};

export type DeviceCalendarImportSummary = {
    calendarCount: number;
    calendarSources: DeviceCalendarSource[];
    candidates: DeviceCalendarCandidate[];
};

const DEFAULT_PAST_DAYS = 7;
const DEFAULT_FUTURE_DAYS = 90;
const UNTITLED_EVENT = "제목 없는 일정";
const PERMISSION_STATUS_TIMEOUT_MS = 10_000;
const PERMISSION_REQUEST_TIMEOUT_MS = 120_000;
const CALENDAR_LIST_TIMEOUT_MS = 10_000;
const EVENT_QUERY_TIMEOUT_MS = 20_000;
type ExpoCalendarModule = typeof ExpoCalendar;
type ExpoCalendarEvent = ExpoCalendar.Event;
type ExpoCalendarCalendar = ExpoCalendar.Calendar;

const Calendar = loadCalendarModule();

function loadCalendarModule(): ExpoCalendarModule | null {
    try {
        return require("expo-calendar") as ExpoCalendarModule;
    } catch {
        return null;
    }
}

function requireCalendarModule(): ExpoCalendarModule {
    if (!Calendar) {
        throw new Error("현재 캘린더 가져오기를 사용할 수 없어요. 잠시 후 다시 시도해 주세요.");
    }
    return Calendar;
}

export function getDeviceCalendarProvider(): DeviceCalendarProvider {
    return Platform.OS === "ios" ? "APPLE_DEVICE" : "ANDROID_DEVICE";
}

export function getCalendarProviderLabel(provider = getDeviceCalendarProvider()): string {
    if (provider === "GOOGLE") return "Google Calendar";
    return provider === "APPLE_DEVICE" ? "Apple 캘린더" : "Android 캘린더";
}

export async function requestDeviceCalendarPermission(): Promise<boolean> {
    const calendar = requireCalendarModule();
    const current = await withCalendarImportTimeout(
        calendar.getCalendarPermissionsAsync(),
        {
            timeoutMs: PERMISSION_STATUS_TIMEOUT_MS,
            operationName: "캘린더 권한 확인",
        }
    );
    if (current.granted) return true;

    const next = await withCalendarImportTimeout(
        calendar.requestCalendarPermissionsAsync(),
        {
            timeoutMs: PERMISSION_REQUEST_TIMEOUT_MS,
            operationName: "캘린더 권한 요청",
        }
    );
    return next.granted;
}

export async function hasDeviceCalendarPermission(): Promise<boolean> {
    try {
        const calendar = requireCalendarModule();
        const permission = await withCalendarImportTimeout(
            calendar.getCalendarPermissionsAsync(),
            {
                timeoutMs: PERMISSION_STATUS_TIMEOUT_MS,
                operationName: "캘린더 권한 확인",
            }
        );
        return permission.granted;
    } catch {
        return false;
    }
}

export async function loadDeviceCalendarCandidates(options?: {
    pastDays?: number;
    futureDays?: number;
}): Promise<DeviceCalendarCandidate[]> {
    return (await loadDeviceCalendarImportSummary(options)).candidates;
}

export async function loadDeviceCalendarImportSummary(options?: {
    pastDays?: number;
    futureDays?: number;
}): Promise<DeviceCalendarImportSummary> {
    const calendar = requireCalendarModule();
    const provider = getDeviceCalendarProvider();
    const calendars = await withCalendarImportTimeout(
        calendar.getCalendarsAsync(calendar.EntityTypes.EVENT),
        {
            timeoutMs: CALENDAR_LIST_TIMEOUT_MS,
            operationName: "캘린더 목록 확인",
        }
    );
    const readableCalendars = calendars.filter((item) => isReadableEventCalendar(item, calendar));
    const calendarSources = readableCalendars.map(toCalendarSource);

    if (readableCalendars.length === 0) {
        return { calendarCount: 0, calendarSources: [], candidates: [] };
    }

    const now = new Date();
    const start = addDays(now, -(options?.pastDays ?? DEFAULT_PAST_DAYS));
    const end = addDays(now, options?.futureDays ?? DEFAULT_FUTURE_DAYS);
    const calendarById = new Map(readableCalendars.map((sourceCalendar) => [sourceCalendar.id, sourceCalendar]));
    const events = await withCalendarImportTimeout(
        calendar.getEventsAsync(
            readableCalendars.map((sourceCalendar) => sourceCalendar.id),
            start,
            end
        ),
        {
            timeoutMs: EVENT_QUERY_TIMEOUT_MS,
            operationName: "다가오는 일정 확인",
        }
    );

    return {
        calendarCount: readableCalendars.length,
        calendarSources,
        candidates: events
            .map((event) => toCandidate(event, calendarById, provider))
            .filter((candidate): candidate is DeviceCalendarCandidate => Boolean(candidate))
            .sort(compareCandidates),
    };
}

export async function loadDeviceCalendarSources(): Promise<DeviceCalendarSource[]> {
    const calendar = requireCalendarModule();
    const calendars = await withCalendarImportTimeout(
        calendar.getCalendarsAsync(calendar.EntityTypes.EVENT),
        {
            timeoutMs: CALENDAR_LIST_TIMEOUT_MS,
            operationName: "캘린더 목록 확인",
        }
    );
    return calendars
        .filter((item) => isReadableEventCalendar(item, calendar))
        .map(toCalendarSource);
}

export function getDefaultSelectedCandidateIds(candidates: DeviceCalendarCandidate[]): Set<string> {
    return new Set(candidates.map((candidate) => candidate.id));
}

export function buildSchedulePayloadFromCandidate(
    candidate: DeviceCalendarCandidate,
    settings: CalendarImportSettings
): SchedulePayload {
    const startDate = new Date(candidate.startAt);
    const endDate = new Date(candidate.endAt);
    const shouldPrepareDeparture =
        !candidate.allDay &&
        settings.prepareDepartureAlert &&
        settings.travelMinutes > 0 &&
        startDate.getTime() > Date.now();
    const departAt = shouldPrepareDeparture
        ? new Date(startDate.getTime() - settings.travelMinutes * 60 * 1000).toISOString()
        : undefined;

    // 외부 캘린더는 수정하지 않고 NoLate 일정만 생성한다.
    // location 문자열은 좌표가 없으므로 destination 후보와 locationName에 동시에 넣어
    // 이후 사용자가 장소 검색/경로 선택 화면에서 보강할 수 있게 한다.
    // 실시간 출발 알림은 출발지와 도착지 좌표가 모두 필요하다. 외부 일정에는 보통
    // 좌표와 출발지가 없으므로 이 기본 payload에서는 예상 출발값만 저장하고 알림은 끈다.
    // 상위 가져오기 흐름이 실제 경로까지 만든 경우에만 좌표·경로·정책값을 더해 알림을 켠다.
    return {
        title: candidate.title,
        startAt: startDate.toISOString(),
        endAt: endDate.toISOString(),
        hasEndTime: !candidate.allDay,
        allDay: candidate.allDay,
        travelMinutes: shouldPrepareDeparture ? settings.travelMinutes : undefined,
        departAt,
        travelMode: shouldPrepareDeparture ? settings.travelMode : undefined,
        locationName: candidate.locationName,
        destination: candidate.locationName
            ? {
                name: candidate.locationName,
                address: candidate.locationName,
            }
            : undefined,
        category: settings.category,
        notes: buildImportedNotes(candidate),
        notificationEnabled: false,
    };
}

/**
 * 화면용 후보 id가 아니라 공급자가 발급한 원본 id 조합을 API에 전달한다.
 * occurrenceStartAt은 같은 eventId를 공유하는 반복 일정의 각 발생 건을 구분한다.
 */
export function buildCalendarImportSource(
    candidate: DeviceCalendarCandidate
): CalendarImportSourcePayload {
    const calendarId = candidate.calendarId.trim();
    const eventId = candidate.eventId.trim();
    if (!calendarId || !eventId) {
        throw new Error("이 일정을 가져올 수 없어요. 캘린더에서 일정을 다시 확인해 주세요.");
    }

    return {
        provider: candidate.provider,
        calendarId,
        eventId,
        occurrenceStartAt: new Date(candidate.startAt).toISOString(),
    };
}

function toCandidate(
    event: ExpoCalendarEvent,
    calendarById: Map<string, ExpoCalendarCalendar>,
    provider: DeviceCalendarProvider
): DeviceCalendarCandidate | null {
    const startDate = normalizeDate(event.startDate);
    const endDate = normalizeDate(event.endDate);

    if (!startDate) return null;

    const safeEndDate = endDate && endDate.getTime() > startDate.getTime()
        ? endDate
        : new Date(startDate.getTime() + 60 * 60 * 1000);
    const calendar = calendarById.get(event.calendarId);
    const eventId = normalizeText(event.id);
    const calendarId = normalizeText(event.calendarId);
    if (!eventId || !calendarId) return null;
    const title = normalizeText(event.title) || UNTITLED_EVENT;
    const locationName = normalizeText(event.location);
    const notes = normalizeText(event.notes);
    const allDay = Boolean(event.allDay);

    // 종일 일정도 가져오기 후보에 포함한다. 시간 기반 경로 준비만 이후 단계에서 제외한다.
    const requiresTimeReview = allDay;

    return {
        id: [
            provider,
            calendarId,
            eventId,
            startDate.toISOString(),
        ].join(":"),
        provider,
        eventId,
        calendarId,
        calendarTitle: calendar?.title?.trim() || "캘린더",
        calendarColor: calendar?.color,
        title,
        startAt: startDate.toISOString(),
        endAt: safeEndDate.toISOString(),
        allDay,
        locationName,
        notes,
        requiresTimeReview,
    };
}

function isReadableEventCalendar(calendar: ExpoCalendarCalendar, calendarModule: ExpoCalendarModule): boolean {
    if (calendar.entityType && calendar.entityType !== calendarModule.EntityTypes.EVENT) {
        return false;
    }

    if (Platform.OS === "android") {
        if (calendar.isVisible === false || calendar.isSynced === false) {
            return false;
        }

        if (
            calendar.accessLevel === calendarModule.CalendarAccessLevel.NONE ||
            calendar.accessLevel === calendarModule.CalendarAccessLevel.FREEBUSY
        ) {
            return false;
        }
    }

    return true;
}

function toCalendarSource(calendar: ExpoCalendarCalendar): DeviceCalendarSource {
    return {
        id: calendar.id,
        title: normalizeText(calendar.title) || "캘린더",
        color: normalizeText(calendar.color),
    };
}

function compareCandidates(a: DeviceCalendarCandidate, b: DeviceCalendarCandidate): number {
    if (a.requiresTimeReview !== b.requiresTimeReview) {
        return a.requiresTimeReview ? 1 : -1;
    }

    return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
}

function buildImportedNotes(candidate: DeviceCalendarCandidate): string | undefined {
    return candidate.notes?.trim() || undefined;
}

function normalizeDate(value: string | Date | undefined | null): Date | null {
    if (!value) return null;

    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeText(value: string | null | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized || undefined;
}

function addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}
