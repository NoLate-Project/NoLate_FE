import * as SecureStore from "../storage/secureStorage";

import {
    getCalendarProviderLabel,
    getDeviceCalendarProvider,
    hasDeviceCalendarPermission,
    loadDeviceCalendarImportSummary,
    type DeviceCalendarProvider,
} from "./deviceCalendarImport";

const CALENDAR_CONNECTION_KEY = "nolate_calendar_connection_snapshot";

export type CalendarConnectionSnapshot = {
    provider: DeviceCalendarProvider;
    providerLabel: string;
    status: "CONNECTED";
    calendarCount: number;
    calendarNames: string[];
    eventCandidateCount: number;
    importedCount: number;
    lastScannedAt: string;
    lastImportedAt?: string;
};

export async function getCalendarConnectionSnapshot(): Promise<CalendarConnectionSnapshot | null> {
    const raw = await SecureStore.getItemAsync(CALENDAR_CONNECTION_KEY);
    if (!raw) return null;

    try {
        return normalizeCalendarConnectionSnapshot(JSON.parse(raw));
    } catch {
        await SecureStore.deleteItemAsync(CALENDAR_CONNECTION_KEY);
        return null;
    }
}

export async function saveCalendarConnectionSnapshot(snapshot: CalendarConnectionSnapshot): Promise<void> {
    await SecureStore.setItemAsync(CALENDAR_CONNECTION_KEY, JSON.stringify(snapshot));
}

export async function recordCalendarScan(snapshot: {
    provider: DeviceCalendarProvider;
    providerLabel: string;
    calendarCount: number;
    calendarNames: string[];
    eventCandidateCount: number;
}): Promise<void> {
    const current = await getCalendarConnectionSnapshot();

    // 캘린더 permission과 스캔 성공은 "연동됨"의 최소 단위다.
    // import를 건너뛰어도 프로필에서 사용자가 연결 상태를 확인할 수 있어야 한다.
    await saveCalendarConnectionSnapshot({
        provider: snapshot.provider,
        providerLabel: snapshot.providerLabel,
        status: "CONNECTED",
        calendarCount: snapshot.calendarCount,
        calendarNames: normalizeCalendarNames(snapshot.calendarNames),
        eventCandidateCount: snapshot.eventCandidateCount,
        importedCount: current?.importedCount ?? 0,
        lastScannedAt: new Date().toISOString(),
        lastImportedAt: current?.lastImportedAt,
    });
}

export async function recordCalendarImportCompleted(importedCount: number): Promise<void> {
    const current = await getCalendarConnectionSnapshot();
    if (!current) return;

    await saveCalendarConnectionSnapshot({
        ...current,
        importedCount: current.importedCount + importedCount,
        lastImportedAt: new Date().toISOString(),
    });
}

export async function refreshCalendarConnectionSnapshotFromDevice(): Promise<CalendarConnectionSnapshot | null> {
    const current = await getCalendarConnectionSnapshot();

    if (!(await hasDeviceCalendarPermission())) {
        return current;
    }

    const summary = await loadDeviceCalendarImportSummary();
    await recordCalendarScan({
        provider: getDeviceCalendarProvider(),
        providerLabel: getCalendarProviderLabel(),
        calendarCount: summary.calendarCount,
        calendarNames: summary.calendarSources.map((calendar) => calendar.title),
        eventCandidateCount: summary.candidates.length,
    });

    return getCalendarConnectionSnapshot();
}

function normalizeCalendarConnectionSnapshot(value: unknown): CalendarConnectionSnapshot | null {
    if (!value || typeof value !== "object") return null;

    const record = value as Partial<CalendarConnectionSnapshot>;
    const provider = record.provider;
    if (provider !== "APPLE_DEVICE" && provider !== "ANDROID_DEVICE") return null;

    const lastScannedAt = normalizeIsoDate(record.lastScannedAt);
    if (!lastScannedAt) return null;

    return {
        provider,
        providerLabel: normalizeText(record.providerLabel) || providerLabelFallback(provider),
        status: "CONNECTED",
        calendarCount: normalizeNumber(record.calendarCount),
        calendarNames: normalizeCalendarNames(record.calendarNames),
        eventCandidateCount: normalizeNumber(record.eventCandidateCount),
        importedCount: normalizeNumber(record.importedCount),
        lastScannedAt,
        lastImportedAt: normalizeIsoDate(record.lastImportedAt) ?? undefined,
    };
}

function normalizeCalendarNames(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    return Array.from(
        new Set(
            value
                .map(normalizeText)
                .filter((name): name is string => Boolean(name))
        )
    ).slice(0, 6);
}

function normalizeText(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeIsoDate(value: unknown): string | null {
    if (typeof value !== "string") return null;

    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function providerLabelFallback(provider: DeviceCalendarProvider): string {
    return provider === "APPLE_DEVICE" ? "Apple 캘린더" : "Android 캘린더";
}
