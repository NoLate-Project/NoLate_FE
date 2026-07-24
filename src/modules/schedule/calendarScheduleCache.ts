import { dedupeCalendarSchedules } from "./calendarScheduleDedupe";
import { getMonthRange } from "./calendarRange";
import type { ScheduleItem } from "./types";
import {
    getAuthSessionEpoch,
    isAuthSessionEpochCurrent,
} from "../auth/authSessionEpoch";

// 서버 revision/공유 푸시가 변경을 즉시 무효화하므로 짧은 주기 재조회 대신
// Redis 월 캐시 TTL과 맞춰 월 이동 중 불필요한 네트워크 요청을 막는다.
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHED_MONTHS = 18;
const MAX_RANGE_MONTHS = 120;

type CalendarScheduleCacheEntry = {
    items: ScheduleItem[];
    fetchedAt: number;
    lastAccessedAt: number;
};

type CalendarMonthDescriptor = {
    key: string;
    startAt: string;
    endAt: string;
};

export type CalendarScheduleFetcher = (
    startAt: string,
    endAt: string,
) => Promise<ScheduleItem[]>;

export type CalendarScheduleCacheSnapshot = {
    items: ScheduleItem[];
    cachedMonthKeys: string[];
    requestedMonthKeys: string[];
};

const monthCache = new Map<string, CalendarScheduleCacheEntry>();
const inFlightRanges = new Map<string, Promise<void>>();
const invalidationListeners = new Set<() => void>();
let cacheRevision = 0;

export function captureCalendarScheduleCacheAuthEpoch(): number {
    return getAuthSessionEpoch();
}

export function mutateCalendarScheduleCacheIfAuthSessionCurrent(
    expectedAuthEpoch: number,
    mutation: () => void,
): boolean {
    if (!isAuthSessionEpochCurrent(expectedAuthEpoch)) return false;
    // Cache mutations are synchronous, so the epoch check and write form one JS
    // critical section. An auth invalidation that follows will clear this write;
    // an invalidation that already happened prevents it entirely.
    mutation();
    return isAuthSessionEpochCurrent(expectedAuthEpoch);
}

function monthKey(year: number, monthIndex: number): string {
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function getMonthDescriptors(startAt: string, endAt: string): CalendarMonthDescriptor[] {
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (
        Number.isNaN(start.getTime()) ||
        Number.isNaN(end.getTime()) ||
        end.getTime() < start.getTime()
    ) {
        throw new Error("일정 캐시 조회 범위가 올바르지 않습니다.");
    }

    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const finalMonth = new Date(end.getFullYear(), end.getMonth(), 1);
    const descriptors: CalendarMonthDescriptor[] = [];

    while (cursor.getTime() <= finalMonth.getTime()) {
        if (descriptors.length >= MAX_RANGE_MONTHS) {
            throw new Error("일정 캐시 조회 범위가 너무 큽니다.");
        }

        const key = monthKey(cursor.getFullYear(), cursor.getMonth());
        const range = getMonthRange(`${key}-01`);
        descriptors.push({ key, ...range });
        cursor.setMonth(cursor.getMonth() + 1);
    }

    return descriptors;
}

function overlapsRange(item: ScheduleItem, startAt: string, endAt: string): boolean {
    const itemStart = new Date(item.startAt).getTime();
    const itemEnd = new Date(item.endAt ?? item.startAt).getTime();
    const rangeStart = new Date(startAt).getTime();
    const rangeEnd = new Date(endAt).getTime();

    return (
        Number.isFinite(itemStart) &&
        Number.isFinite(itemEnd) &&
        itemStart <= rangeEnd &&
        itemEnd >= rangeStart
    );
}

function mergeEntries(descriptors: CalendarMonthDescriptor[], now: number): ScheduleItem[] {
    const newestById = new Map<string, { item: ScheduleItem; fetchedAt: number }>();

    descriptors.forEach(({ key }) => {
        const entry = monthCache.get(key);
        if (!entry) return;
        entry.lastAccessedAt = now;

        entry.items.forEach((item) => {
            const current = newestById.get(item.id);
            if (!current || current.fetchedAt <= entry.fetchedAt) {
                newestById.set(item.id, { item, fetchedAt: entry.fetchedAt });
            }
        });
    });

    return dedupeCalendarSchedules(
        Array.from(newestById.values(), ({ item }) => item),
    );
}

function groupRefreshRanges(
    descriptors: CalendarMonthDescriptor[],
    now: number,
): CalendarMonthDescriptor[][] {
    const groups: CalendarMonthDescriptor[][] = [];
    let current: CalendarMonthDescriptor[] = [];

    descriptors.forEach((descriptor) => {
        const entry = monthCache.get(descriptor.key);
        const fresh = entry && now - entry.fetchedAt < CACHE_TTL_MS;
        if (fresh) {
            if (current.length > 0) groups.push(current);
            current = [];
            return;
        }
        current.push(descriptor);
    });

    if (current.length > 0) groups.push(current);
    return groups;
}

function writeRange(
    descriptors: CalendarMonthDescriptor[],
    items: ScheduleItem[],
    fetchedAt: number,
): void {
    descriptors.forEach((descriptor) => {
        monthCache.set(descriptor.key, {
            items: dedupeCalendarSchedules(
                items.filter((item) => overlapsRange(item, descriptor.startAt, descriptor.endAt)),
            ),
            fetchedAt,
            lastAccessedAt: fetchedAt,
        });
    });
    pruneCache();
}

function pruneCache(): void {
    if (monthCache.size <= MAX_CACHED_MONTHS) return;

    const oldestKeys = Array.from(monthCache.entries())
        .sort(([, left], [, right]) => left.lastAccessedAt - right.lastAccessedAt)
        .slice(0, monthCache.size - MAX_CACHED_MONTHS)
        .map(([key]) => key);
    oldestKeys.forEach((key) => monthCache.delete(key));
}

export function readCalendarScheduleCache(
    startAt: string,
    endAt: string,
    now = Date.now(),
): CalendarScheduleCacheSnapshot {
    const descriptors = getMonthDescriptors(startAt, endAt);
    return {
        items: mergeEntries(descriptors, now),
        cachedMonthKeys: descriptors
            .filter(({ key }) => monthCache.has(key))
            .map(({ key }) => key),
        requestedMonthKeys: descriptors.map(({ key }) => key),
    };
}

export function hasCalendarScheduleMonthCache(ymd: string): boolean {
    const match = /^(\d{4})-(\d{2})/.exec(ymd);
    return Boolean(match && monthCache.has(`${match[1]}-${match[2]}`));
}

export async function refreshCalendarScheduleCache(
    startAt: string,
    endAt: string,
    fetcher: CalendarScheduleFetcher,
    now = Date.now(),
): Promise<CalendarScheduleCacheSnapshot> {
    const authEpochAtStart = captureCalendarScheduleCacheAuthEpoch();
    const descriptors = getMonthDescriptors(startAt, endAt);
    const refreshGroups = groupRefreshRanges(descriptors, now);
    const revisionAtStart = cacheRevision;

    await Promise.all(refreshGroups.map(async (group) => {
        const first = group[0];
        const last = group[group.length - 1];
        if (!first || !last) return;

        const inFlightKey = [
            authEpochAtStart,
            revisionAtStart,
            first.startAt,
            last.endAt,
        ].join("|");
        let inFlight = inFlightRanges.get(inFlightKey);
        if (!inFlight) {
            inFlight = fetcher(first.startAt, last.endAt)
                .then((items) => {
                    if (cacheRevision !== revisionAtStart) return;
                    mutateCalendarScheduleCacheIfAuthSessionCurrent(
                        authEpochAtStart,
                        () => writeRange(group, items, Date.now()),
                    );
                })
                .finally(() => {
                    inFlightRanges.delete(inFlightKey);
                });
            inFlightRanges.set(inFlightKey, inFlight);
        }
        await inFlight;
    }));

    return readCalendarScheduleCache(startAt, endAt);
}

export function upsertCalendarScheduleCacheItem(item: ScheduleItem): void {
    cacheRevision += 1;
    monthCache.forEach((entry, key) => {
        const range = getMonthRange(`${key}-01`);
        const nextItems = entry.items.filter((cachedItem) => cachedItem.id !== item.id);
        if (overlapsRange(item, range.startAt, range.endAt)) {
            nextItems.push(item);
        }
        entry.items = dedupeCalendarSchedules(nextItems);
        entry.lastAccessedAt = Date.now();
    });
}

export function removeCalendarScheduleCacheItem(scheduleId: string): void {
    cacheRevision += 1;
    monthCache.forEach((entry) => {
        entry.items = entry.items.filter((item) => item.id !== scheduleId);
        entry.lastAccessedAt = Date.now();
    });
}

export function clearCalendarScheduleCache(): void {
    cacheRevision += 1;
    monthCache.clear();
    inFlightRanges.clear();
    invalidationListeners.forEach((listener) => listener());
}

export function subscribeCalendarScheduleCacheInvalidated(listener: () => void): () => void {
    invalidationListeners.add(listener);
    return () => invalidationListeners.delete(listener);
}
