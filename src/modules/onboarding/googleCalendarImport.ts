import * as SecureStore from "../storage/secureStorage";

import type {
    DeviceCalendarCandidate,
    DeviceCalendarImportSummary,
    DeviceCalendarSource,
} from "./deviceCalendarImport";

export const GOOGLE_CALENDAR_CLIENT_ID =
    process.env.EXPO_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID ??
    "342104303432-cvojggr8trcqjgf688gfuttprprknbt2.apps.googleusercontent.com";

export const GOOGLE_CALENDAR_SCOPES = [
    "https://www.googleapis.com/auth/calendar.readonly",
];

const GOOGLE_CALENDAR_TOKEN_KEY = "nolate_google_calendar_token";
const GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const DEFAULT_PAST_DAYS = 7;
const DEFAULT_FUTURE_DAYS = 90;
const UNTITLED_EVENT = "제목 없는 일정";

type GoogleTokenSnapshot = {
    accessToken: string;
    expiresAt?: string;
};

type GoogleCalendarListResponse = {
    items?: GoogleCalendarListItem[];
};

type GoogleCalendarListItem = {
    id?: string;
    summary?: string;
    backgroundColor?: string;
    primary?: boolean;
    selected?: boolean;
    accessRole?: string;
};

type GoogleEventsResponse = {
    items?: GoogleCalendarEvent[];
};

type GoogleCalendarEvent = {
    id?: string;
    status?: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: GoogleEventDate;
    end?: GoogleEventDate;
};

type GoogleEventDate = {
    date?: string;
    dateTime?: string;
    timeZone?: string;
};

export async function saveGoogleCalendarAccessToken(snapshot: {
    accessToken: string;
    expiresIn?: number | null;
}): Promise<void> {
    const expiresAt = snapshot.expiresIn
        ? new Date(Date.now() + snapshot.expiresIn * 1000).toISOString()
        : undefined;

    await SecureStore.setItemAsync(
        GOOGLE_CALENDAR_TOKEN_KEY,
        JSON.stringify({
            accessToken: snapshot.accessToken,
            expiresAt,
        } satisfies GoogleTokenSnapshot)
    );
}

export async function getStoredGoogleCalendarAccessToken(): Promise<string | null> {
    const raw = await SecureStore.getItemAsync(GOOGLE_CALENDAR_TOKEN_KEY);
    if (!raw) return null;

    try {
        const snapshot = JSON.parse(raw) as Partial<GoogleTokenSnapshot>;
        if (!snapshot.accessToken) return null;

        if (snapshot.expiresAt) {
            const expiresAt = new Date(snapshot.expiresAt).getTime();
            if (Number.isFinite(expiresAt) && expiresAt - Date.now() < 60_000) {
                await clearStoredGoogleCalendarAccessToken();
                return null;
            }
        }

        return snapshot.accessToken;
    } catch {
        await clearStoredGoogleCalendarAccessToken();
        return null;
    }
}

export async function clearStoredGoogleCalendarAccessToken(): Promise<void> {
    await SecureStore.deleteItemAsync(GOOGLE_CALENDAR_TOKEN_KEY);
}

export async function loadGoogleCalendarImportSummary(
    accessToken: string,
    options?: {
        pastDays?: number;
        futureDays?: number;
    }
): Promise<DeviceCalendarImportSummary> {
    const calendars = await loadGoogleCalendars(accessToken);
    const calendarSources = calendars.map(toCalendarSource);

    if (calendars.length === 0) {
        return { calendarCount: 0, calendarSources: [], candidates: [] };
    }

    const now = new Date();
    const timeMin = addDays(now, -(options?.pastDays ?? DEFAULT_PAST_DAYS)).toISOString();
    const timeMax = addDays(now, options?.futureDays ?? DEFAULT_FUTURE_DAYS).toISOString();
    const eventGroups = await Promise.all(
        calendars.map(async (calendar) => {
            const events = await loadGoogleEvents(accessToken, calendar.id, timeMin, timeMax);
            return events
                .map((event) => toCandidate(event, calendar))
                .filter((candidate): candidate is DeviceCalendarCandidate => Boolean(candidate));
        })
    );

    return {
        calendarCount: calendars.length,
        calendarSources,
        candidates: eventGroups.flat().sort(compareCandidates),
    };
}

async function loadGoogleCalendars(accessToken: string): Promise<RequiredGoogleCalendar[]> {
    const url = buildGoogleApiUrl("/users/me/calendarList", {
        minAccessRole: "reader",
        showDeleted: "false",
        showHidden: "false",
    });

    const payload = await googleFetch<GoogleCalendarListResponse>(url, accessToken);
    return (payload.items ?? [])
        .map(normalizeGoogleCalendar)
        .filter((calendar): calendar is RequiredGoogleCalendar => Boolean(calendar))
        .filter((calendar) => calendar.selected || calendar.primary);
}

async function loadGoogleEvents(
    accessToken: string,
    calendarId: string,
    timeMin: string,
    timeMax: string
): Promise<GoogleCalendarEvent[]> {
    const url = buildGoogleApiUrl(`/calendars/${encodeURIComponent(calendarId)}/events`, {
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "50",
    });

    const payload = await googleFetch<GoogleEventsResponse>(url, accessToken);
    return (payload.items ?? []).filter((event) => event.status !== "cancelled");
}

async function googleFetch<T>(url: string, accessToken: string): Promise<T> {
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
        },
    });

    if (!response.ok) {
        if (response.status === 401) {
            await clearStoredGoogleCalendarAccessToken();
        }

        throw new Error(`Google Calendar 요청 실패 (${response.status})`);
    }

    return response.json() as Promise<T>;
}

function buildGoogleApiUrl(path: string, params: Record<string, string>): string {
    const query = Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join("&");
    return `${GOOGLE_CALENDAR_API_BASE}${path}?${query}`;
}

type RequiredGoogleCalendar = {
    id: string;
    title: string;
    color?: string;
    primary: boolean;
    selected: boolean;
};

function normalizeGoogleCalendar(calendar: GoogleCalendarListItem): RequiredGoogleCalendar | null {
    const id = normalizeText(calendar.id);
    if (!id) return null;

    return {
        id,
        title: normalizeText(calendar.summary) || "Google Calendar",
        color: normalizeText(calendar.backgroundColor),
        primary: Boolean(calendar.primary),
        selected: calendar.selected !== false,
    };
}

function toCalendarSource(calendar: RequiredGoogleCalendar): DeviceCalendarSource {
    return {
        id: getProviderScopedCalendarId(calendar.id),
        title: `Google · ${calendar.title}`,
        color: calendar.color,
    };
}

function toCandidate(
    event: GoogleCalendarEvent,
    calendar: RequiredGoogleCalendar
): DeviceCalendarCandidate | null {
    const start = normalizeGoogleEventDate(event.start);
    if (!start) return null;

    const end = normalizeGoogleEventDate(event.end);
    const safeEndDate = end && end.date.getTime() > start.date.getTime()
        ? end.date
        : new Date(start.date.getTime() + 60 * 60 * 1000);
    const title = normalizeText(event.summary) || UNTITLED_EVENT;
    const locationName = normalizeText(event.location);
    const notes = normalizeText(event.description);
    const requiresTimeReview = start.allDay;

    return {
        id: [
            "GOOGLE",
            calendar.id,
            normalizeText(event.id) || "event",
            start.date.toISOString(),
        ].join(":"),
        provider: "GOOGLE",
        eventId: normalizeText(event.id) || "",
        calendarId: getProviderScopedCalendarId(calendar.id),
        calendarTitle: `Google · ${calendar.title}`,
        calendarColor: calendar.color,
        title,
        startAt: start.date.toISOString(),
        endAt: safeEndDate.toISOString(),
        allDay: start.allDay,
        locationName,
        notes,
        requiresTimeReview,
        recommended: isRecommendedCandidate(start.date, title, locationName, requiresTimeReview),
    };
}

function normalizeGoogleEventDate(value: GoogleEventDate | undefined): { date: Date; allDay: boolean } | null {
    if (!value) return null;

    if (value.dateTime) {
        const date = new Date(value.dateTime);
        return Number.isFinite(date.getTime()) ? { date, allDay: false } : null;
    }

    if (value.date) {
        const date = new Date(`${value.date}T00:00:00`);
        return Number.isFinite(date.getTime()) ? { date, allDay: true } : null;
    }

    return null;
}

function getProviderScopedCalendarId(calendarId: string): string {
    return `GOOGLE:${calendarId}`;
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
