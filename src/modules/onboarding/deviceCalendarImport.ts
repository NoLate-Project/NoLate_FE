import type * as ExpoCalendar from "expo-calendar";
import { Platform } from "react-native";

import type { SchedulePayload } from "../../api/schedule";
import type { ScheduleCategory, TravelMode } from "../schedule/types";

export type DeviceCalendarProvider = "APPLE_DEVICE" | "ANDROID_DEVICE";

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
    recommended: boolean;
};

export type CalendarImportSettings = {
    category: ScheduleCategory;
    travelMode: TravelMode;
    travelMinutes: number;
    notificationEnabled: boolean;
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
        throw new Error("현재 앱 빌드에서 캘린더 가져오기를 사용할 수 없습니다.");
    }
    return Calendar;
}

export function getDeviceCalendarProvider(): DeviceCalendarProvider {
    return Platform.OS === "ios" ? "APPLE_DEVICE" : "ANDROID_DEVICE";
}

export function getCalendarProviderLabel(provider = getDeviceCalendarProvider()): string {
    return provider === "APPLE_DEVICE" ? "Apple 캘린더" : "Android 캘린더";
}

export async function requestDeviceCalendarPermission(): Promise<boolean> {
    const calendar = requireCalendarModule();
    const current = await calendar.getCalendarPermissionsAsync();
    if (current.granted) return true;

    const next = await calendar.requestCalendarPermissionsAsync();
    return next.granted;
}

export async function hasDeviceCalendarPermission(): Promise<boolean> {
    try {
        const calendar = requireCalendarModule();
        return (await calendar.getCalendarPermissionsAsync()).granted;
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
    const calendars = await calendar.getCalendarsAsync(calendar.EntityTypes.EVENT);
    const readableCalendars = calendars.filter((item) => isReadableEventCalendar(item, calendar));
    const calendarSources = readableCalendars.map(toCalendarSource);

    if (readableCalendars.length === 0) {
        return { calendarCount: 0, calendarSources: [], candidates: [] };
    }

    const now = new Date();
    const start = addDays(now, -(options?.pastDays ?? DEFAULT_PAST_DAYS));
    const end = addDays(now, options?.futureDays ?? DEFAULT_FUTURE_DAYS);
    const calendarById = new Map(readableCalendars.map((sourceCalendar) => [sourceCalendar.id, sourceCalendar]));
    const events = await calendar.getEventsAsync(
        readableCalendars.map((sourceCalendar) => sourceCalendar.id),
        start,
        end
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
    const calendars = await calendar.getCalendarsAsync(calendar.EntityTypes.EVENT);
    return calendars
        .filter((item) => isReadableEventCalendar(item, calendar))
        .map(toCalendarSource);
}

export function getDefaultSelectedCandidateIds(candidates: DeviceCalendarCandidate[]): Set<string> {
    const selectable = candidates.filter((candidate) => !candidate.requiresTimeReview);
    const recommended = selectable.filter((candidate) => candidate.recommended).slice(0, 5);
    const fallback = selectable.slice(0, 3);

    return new Set((recommended.length > 0 ? recommended : fallback).map((candidate) => candidate.id));
}

export function buildSchedulePayloadFromCandidate(
    candidate: DeviceCalendarCandidate,
    settings: CalendarImportSettings
): SchedulePayload {
    const startDate = new Date(candidate.startAt);
    const endDate = new Date(candidate.endAt);
    const shouldEnableNotification =
        !candidate.allDay &&
        settings.notificationEnabled &&
        settings.travelMinutes > 0 &&
        startDate.getTime() > Date.now();
    const departAt = shouldEnableNotification
        ? new Date(startDate.getTime() - settings.travelMinutes * 60 * 1000).toISOString()
        : undefined;

    // 외부 캘린더는 수정하지 않고 NoLate 일정만 생성한다.
    // location 문자열은 좌표가 없으므로 destination 후보와 locationName에 동시에 넣어
    // 이후 사용자가 장소 검색/경로 선택 화면에서 보강할 수 있게 한다.
    return {
        title: candidate.title,
        startAt: startDate.toISOString(),
        endAt: endDate.toISOString(),
        hasEndTime: !candidate.allDay,
        allDay: candidate.allDay,
        travelMinutes: shouldEnableNotification ? settings.travelMinutes : undefined,
        departAt,
        travelMode: shouldEnableNotification ? settings.travelMode : undefined,
        locationName: candidate.locationName,
        destination: candidate.locationName
            ? {
                name: candidate.locationName,
                address: candidate.locationName,
            }
            : undefined,
        category: settings.category,
        notes: buildImportedNotes(candidate),
        notificationEnabled: shouldEnableNotification,
        notificationLeadMinutes: shouldEnableNotification ? 15 : undefined,
        notificationIntervalMinutes: shouldEnableNotification ? 5 : undefined,
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
    const title = normalizeText(event.title) || UNTITLED_EVENT;
    const locationName = normalizeText(event.location);
    const notes = normalizeText(event.notes);
    const allDay = Boolean(event.allDay);

    // MVP에서는 종일 일정에 시간을 묻는 별도 분기까지 만들지 않는다.
    // 대신 후보에 보여주되 기본 선택에서 제외해 사용자의 흐름이 멈추지 않게 한다.
    const requiresTimeReview = allDay;

    return {
        id: [
            provider,
            event.calendarId,
            event.id,
            startDate.toISOString(),
        ].join(":"),
        provider,
        eventId: event.id,
        calendarId: event.calendarId,
        calendarTitle: calendar?.title?.trim() || "캘린더",
        calendarColor: calendar?.color,
        title,
        startAt: startDate.toISOString(),
        endAt: safeEndDate.toISOString(),
        allDay,
        locationName,
        notes,
        requiresTimeReview,
        recommended: isRecommendedCandidate(startDate, title, locationName, requiresTimeReview),
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

function isRecommendedCandidate(
    startDate: Date,
    title: string,
    locationName: string | undefined,
    requiresTimeReview: boolean
): boolean {
    return (
        !requiresTimeReview &&
        startDate.getTime() >= startOfToday().getTime() &&
        title !== UNTITLED_EVENT &&
        Boolean(locationName)
    );
}

function compareCandidates(a: DeviceCalendarCandidate, b: DeviceCalendarCandidate): number {
    if (a.recommended !== b.recommended) {
        return a.recommended ? -1 : 1;
    }

    if (a.requiresTimeReview !== b.requiresTimeReview) {
        return a.requiresTimeReview ? 1 : -1;
    }

    return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
}

function buildImportedNotes(candidate: DeviceCalendarCandidate): string | undefined {
    const sourceLine = `${getCalendarProviderLabel(candidate.provider)}에서 가져온 일정`;
    const calendarLine = `원본 캘린더: ${candidate.calendarTitle}`;
    const notes = [candidate.notes, sourceLine, calendarLine]
        .map((line) => line?.trim())
        .filter(Boolean);

    return notes.length > 0 ? notes.join("\n\n") : undefined;
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

function startOfToday(): Date {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
}
