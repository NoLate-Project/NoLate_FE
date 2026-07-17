import * as SecureStore from "../storage/secureStorage";

import {
    getCalendarProviderLabel,
    getDeviceCalendarProvider,
    hasDeviceCalendarPermission,
    loadDeviceCalendarImportSummary,
    type DeviceCalendarProvider,
} from "./deviceCalendarImport";
import {
    getStoredGoogleCalendarAccessToken,
    loadGoogleCalendarImportSummary,
} from "./googleCalendarImport";

const CALENDAR_CONNECTION_KEY = "nolate_calendar_connection_snapshot";
let calendarConnectionGeneration = 0;

export type CalendarConnectionSnapshot = {
    provider: DeviceCalendarProvider;
    providerLabel: string;
    providerLabels: string[];
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

export async function clearCalendarConnectionSnapshot(): Promise<void> {
    // Profile refresh and onboarding scans can still be resolving provider APIs
    // while logout clears account-owned storage. Invalidate those refreshes so
    // they cannot write the previous member's calendar metadata back afterwards.
    calendarConnectionGeneration += 1;
    await SecureStore.deleteItemAsync(CALENDAR_CONNECTION_KEY);
}

export async function recordCalendarScan(snapshot: {
    provider: DeviceCalendarProvider;
    providerLabel: string;
    providerLabels?: string[];
    calendarCount: number;
    calendarNames: string[];
    eventCandidateCount: number;
}, expectedGeneration?: number): Promise<void> {
    if (expectedGeneration !== undefined && expectedGeneration !== calendarConnectionGeneration) return;
    const current = await getCalendarConnectionSnapshot();
    if (expectedGeneration !== undefined && expectedGeneration !== calendarConnectionGeneration) return;

    // 캘린더 permission과 스캔 성공은 "연동됨"의 최소 단위다.
    // import를 건너뛰어도 프로필에서 사용자가 연결 상태를 확인할 수 있어야 한다.
    await saveCalendarConnectionSnapshot({
        provider: snapshot.provider,
        providerLabel: snapshot.providerLabel,
        providerLabels: normalizeCalendarNames(snapshot.providerLabels ?? [snapshot.providerLabel]),
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
    const refreshGeneration = calendarConnectionGeneration;
    const current = await getCalendarConnectionSnapshot();
    if (refreshGeneration !== calendarConnectionGeneration) return null;
    const scans: Array<{
        provider: DeviceCalendarProvider;
        providerLabel: string;
        calendarCount: number;
        calendarNames: string[];
        eventCandidateCount: number;
    }> = [];
    let googleRefreshFailed = false;

    if (await hasDeviceCalendarPermission()) {
        if (refreshGeneration !== calendarConnectionGeneration) return null;
        const summary = await loadDeviceCalendarImportSummary();
        if (refreshGeneration !== calendarConnectionGeneration) return null;
        scans.push({
            provider: getDeviceCalendarProvider(),
            providerLabel: getCalendarProviderLabel(),
            calendarCount: summary.calendarCount,
            calendarNames: summary.calendarSources.map((calendar) => calendar.title),
            eventCandidateCount: summary.candidates.length,
        });
    }

    const googleAccessToken = await getStoredGoogleCalendarAccessToken();
    if (refreshGeneration !== calendarConnectionGeneration) return null;
    if (googleAccessToken) {
        try {
            const summary = await loadGoogleCalendarImportSummary(googleAccessToken);
            if (refreshGeneration !== calendarConnectionGeneration) return null;
            scans.push({
                provider: "GOOGLE",
                providerLabel: getCalendarProviderLabel("GOOGLE"),
                calendarCount: summary.calendarCount,
                calendarNames: summary.calendarSources.map((calendar) => calendar.title),
                eventCandidateCount: summary.candidates.length,
            });
        } catch {
            // 네트워크 단절과 토큰 철회를 여기서 확정할 수 없으므로 기존 스냅샷을
            // 연동됨으로 오인해 표시하지 않고, 호출 화면이 재시도를 안내하게 한다.
            googleRefreshFailed = true;
        }
    }

    if (scans.length === 0) {
        if (refreshGeneration !== calendarConnectionGeneration) return null;
        if (googleAccessToken && googleRefreshFailed) {
            throw new Error("Google Calendar 연결 상태를 확인하지 못했어요.");
        }

        if (current) await clearCalendarConnectionSnapshot();
        return null;
    }

    await recordCalendarScan({
        provider: scans[0].provider,
        providerLabel: scans.map((scan) => scan.providerLabel).join(" + "),
        providerLabels: scans.map((scan) => scan.providerLabel),
        calendarCount: scans.reduce((total, scan) => total + scan.calendarCount, 0),
        calendarNames: scans.flatMap((scan) => scan.calendarNames),
        eventCandidateCount: scans.reduce((total, scan) => total + scan.eventCandidateCount, 0),
    }, refreshGeneration);

    if (refreshGeneration !== calendarConnectionGeneration) return null;

    return getCalendarConnectionSnapshot();
}

function normalizeCalendarConnectionSnapshot(value: unknown): CalendarConnectionSnapshot | null {
    if (!value || typeof value !== "object") return null;

    const record = value as Partial<CalendarConnectionSnapshot>;
    const provider = record.provider;
    if (provider !== "APPLE_DEVICE" && provider !== "ANDROID_DEVICE" && provider !== "GOOGLE") return null;

    const lastScannedAt = normalizeIsoDate(record.lastScannedAt);
    if (!lastScannedAt) return null;

    return {
        provider,
        providerLabel: normalizeText(record.providerLabel) || providerLabelFallback(provider),
        providerLabels: normalizeCalendarNames(record.providerLabels).length > 0
            ? normalizeCalendarNames(record.providerLabels)
            : [normalizeText(record.providerLabel) || providerLabelFallback(provider)],
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
    if (provider === "GOOGLE") return "Google Calendar";
    return provider === "APPLE_DEVICE" ? "Apple 캘린더" : "Android 캘린더";
}
