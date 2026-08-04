import { dedupeCalendarSchedules } from "./calendarScheduleDedupe";
import { getMonthRange } from "./calendarRange";
import type { ScheduleItem } from "./types";

// 서버 revision/공유 푸시가 변경을 즉시 무효화하므로 홈서버 환경에서는
// 60분 동안 월 캐시를 재사용해 월 이동 중 불필요한 요청을 막는다.
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHED_MONTHS = 18;
const MAX_RANGE_MONTHS = 120;
const MAX_REVISION_REFRESH_RETRIES = 1;

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
const inFlightMonths = new Map<string, Promise<void>>();
const invalidationListeners = new Set<() => void>();
let cacheRevision = 0;

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

async function refreshCalendarScheduleCacheAtCurrentRevision(
    startAt: string,
    endAt: string,
    fetcher: CalendarScheduleFetcher,
    now: number,
): Promise<boolean> {
    const descriptors = getMonthDescriptors(startAt, endAt);
    const refreshGroups = groupRefreshRanges(descriptors, now);
    const revisionAtStart = cacheRevision;
    const pending = new Set<Promise<void>>();

    refreshGroups.forEach((group) => {
        let missingGroup: CalendarMonthDescriptor[] = [];
        const flushMissingGroup = () => {
            const groupToFetch = missingGroup;
            missingGroup = [];
            const first = groupToFetch[0];
            const last = groupToFetch[groupToFetch.length - 1];
            if (!first || !last) return;

            let request: Promise<void>;
            request = fetcher(first.startAt, last.endAt)
                .then((items) => {
                    if (cacheRevision !== revisionAtStart) return;
                    writeRange(groupToFetch, items, Date.now());
                })
                .finally(() => {
                    groupToFetch.forEach(({ key }) => {
                        const inFlightKey = `${revisionAtStart}|${key}`;
                        if (inFlightMonths.get(inFlightKey) === request) {
                            inFlightMonths.delete(inFlightKey);
                        }
                    });
                });
            groupToFetch.forEach(({ key }) => {
                inFlightMonths.set(`${revisionAtStart}|${key}`, request);
            });
            pending.add(request);
        };

        group.forEach((descriptor) => {
            const existing = inFlightMonths.get(
                `${revisionAtStart}|${descriptor.key}`
            );
            if (existing) {
                flushMissingGroup();
                pending.add(existing);
                return;
            }
            missingGroup.push(descriptor);
        });
        flushMissingGroup();
    });

    await Promise.all(pending);

    return cacheRevision === revisionAtStart;
}

export async function refreshCalendarScheduleCache(
    startAt: string,
    endAt: string,
    fetcher: CalendarScheduleFetcher,
    now = Date.now(),
): Promise<CalendarScheduleCacheSnapshot> {
    for (
        let retryCount = 0;
        retryCount <= MAX_REVISION_REFRESH_RETRIES;
        retryCount += 1
    ) {
        const revisionStayedCurrent = await refreshCalendarScheduleCacheAtCurrentRevision(
            startAt,
            endAt,
            fetcher,
            now,
        );
        if (revisionStayedCurrent) {
            return readCalendarScheduleCache(startAt, endAt);
        }
    }

    // A mutation invalidates any response that started before it. Retrying once
    // handles the normal create/update overlap; a second mutation must not turn
    // an empty or partially cached range into a successful refresh result.
    throw new Error("일정 캐시가 연속으로 변경되어 조회를 완료하지 못했습니다.");
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
    inFlightMonths.clear();
    invalidationListeners.forEach((listener) => listener());
}

export function subscribeCalendarScheduleCacheInvalidated(listener: () => void): () => void {
    invalidationListeners.add(listener);
    return () => invalidationListeners.delete(listener);
}
