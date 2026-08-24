import AsyncStorage from "@react-native-async-storage/async-storage";

import { dedupeCalendarSchedules } from "./calendarScheduleDedupe";
import { getMonthRange } from "./calendarRange";
import type { ScheduleItem } from "./types";

// 서버 revision/공유 푸시가 변경을 즉시 무효화하므로 홈서버 환경에서는
// 60분 동안 월 캐시를 재사용해 월 이동 중 불필요한 요청을 막는다.
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHED_MONTHS = 18;
const MAX_RANGE_MONTHS = 120;
const MAX_REVISION_REFRESH_RETRIES = 1;
const PERSISTED_CACHE_VERSION = 1;
const PERSISTED_CACHE_KEY_PREFIX = "nolate_calendar_schedule_cache_v1:";
const MAX_PERSISTED_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PERSISTED_ITEMS_PER_MONTH = 500;

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

type PersistedCalendarScheduleCache = {
    version: typeof PERSISTED_CACHE_VERSION;
    memberId: number;
    savedAt: number;
    serverRevision: number | null;
    months: Array<{
        key: string;
        fetchedAt: number;
        items: ScheduleItem[];
    }>;
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
let activeMemberId: number | null = null;
let activeMemberHydrated = false;
let activationPromise: Promise<boolean> | null = null;
let serverRevision: number | null = null;
let persistenceGeneration = 0;
let persistenceQueue: Promise<void> = Promise.resolve();
const persistedCacheReadAhead = new Map<number, string | null>();
let persistenceReadAheadPromise: Promise<void> | null = null;

function persistedCacheKey(memberId: number): string {
    return `${PERSISTED_CACHE_KEY_PREFIX}${memberId}`;
}

function memberIdFromPersistedCacheKey(key: string): number | null {
    if (!key.startsWith(PERSISTED_CACHE_KEY_PREFIX)) return null;
    const memberId = Number(key.slice(PERSISTED_CACHE_KEY_PREFIX.length));
    return isValidMemberId(memberId) ? memberId : null;
}

function isValidMemberId(memberId: number): boolean {
    return Number.isSafeInteger(memberId) && memberId > 0;
}

function isScheduleItem(value: unknown): value is ScheduleItem {
    if (!value || typeof value !== "object") return false;
    const item = value as Partial<ScheduleItem>;
    return Boolean(
        typeof item.id === "string" &&
        item.id.length > 0 &&
        typeof item.title === "string" &&
        typeof item.startAt === "string" &&
        Number.isFinite(new Date(item.startAt).getTime()) &&
        typeof item.endAt === "string" &&
        Number.isFinite(new Date(item.endAt).getTime()) &&
        item.category &&
        typeof item.category.id === "string" &&
        typeof item.category.title === "string" &&
        typeof item.category.color === "string"
    );
}

/**
 * 화면 복원에 필요한 일정 요약만 저장한다. 경로 좌표, 메모, 참여자 이메일처럼
 * 달력 첫 화면에 필요하지 않은 정보는 디스크 캐시에 남기지 않는다.
 */
function toPersistedScheduleItem(item: ScheduleItem): ScheduleItem {
    return {
        id: item.id,
        ownerMemberId: item.ownerMemberId,
        calendarId: item.calendarId,
        scheduleType: item.scheduleType,
        calendarContentModeOverride: item.calendarContentModeOverride,
        title: item.title,
        startAt: item.startAt,
        endAt: item.endAt,
        hasEndTime: item.hasEndTime,
        allDay: item.allDay,
        travelMinutes: item.travelMinutes,
        departAt: item.departAt,
        departedAt: item.departedAt,
        myDepartedAt: item.myDepartedAt,
        travelMode: item.travelMode,
        locationName: item.locationName,
        category: { ...item.category },
        routeSetupRequired: item.routeSetupRequired,
        notificationEnabled: item.notificationEnabled,
        notificationLeadMinutes: item.notificationLeadMinutes,
        notificationIntervalMinutes: item.notificationIntervalMinutes,
        alertMode: item.alertMode,
        sharePermission: item.sharePermission,
        shareContentMode: item.shareContentMode,
        travelCollaborationEnabled: item.travelCollaborationEnabled,
        updatedAt: item.updatedAt,
    };
}

function parsePersistedCache(
    raw: string | null,
    memberId: number,
    now = Date.now(),
): PersistedCalendarScheduleCache | null {
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw) as Partial<PersistedCalendarScheduleCache>;
        if (
            parsed.version !== PERSISTED_CACHE_VERSION ||
            parsed.memberId !== memberId ||
            typeof parsed.savedAt !== "number" ||
            !Number.isFinite(parsed.savedAt) ||
            parsed.savedAt > now + 60_000 ||
            now - parsed.savedAt > MAX_PERSISTED_CACHE_AGE_MS ||
            !Array.isArray(parsed.months) ||
            parsed.months.length > MAX_CACHED_MONTHS ||
            !(
                parsed.serverRevision === null ||
                (typeof parsed.serverRevision === "number" &&
                    Number.isSafeInteger(parsed.serverRevision) &&
                    parsed.serverRevision >= 0)
            )
        ) {
            return null;
        }

        const months = parsed.months.filter((month): month is PersistedCalendarScheduleCache["months"][number] =>
            Boolean(
                month &&
                /^\d{4}-\d{2}$/.test(month.key) &&
                typeof month.fetchedAt === "number" &&
                Number.isFinite(month.fetchedAt) &&
                month.fetchedAt <= now + 60_000 &&
                Array.isArray(month.items) &&
                month.items.length <= MAX_PERSISTED_ITEMS_PER_MONTH &&
                month.items.every(isScheduleItem)
            )
        );
        if (months.length !== parsed.months.length) return null;

        return {
            version: PERSISTED_CACHE_VERSION,
            memberId,
            savedAt: parsed.savedAt,
            serverRevision: parsed.serverRevision ?? null,
            months,
        };
    } catch {
        return null;
    }
}

function createPersistedSnapshot(
    memberId: number,
): PersistedCalendarScheduleCache {
    return {
        version: PERSISTED_CACHE_VERSION,
        memberId,
        savedAt: Date.now(),
        serverRevision,
        months: Array.from(monthCache.entries(), ([key, entry]) => ({
            key,
            fetchedAt: entry.fetchedAt,
            items: entry.items
                .slice(0, MAX_PERSISTED_ITEMS_PER_MONTH)
                .map(toPersistedScheduleItem),
        })),
    };
}

function persistActiveCache(): void {
    const memberId = activeMemberId;
    if (!memberId || !activeMemberHydrated) return;
    const generation = persistenceGeneration;
    const snapshot = createPersistedSnapshot(memberId);
    const serializedSnapshot = JSON.stringify(snapshot);
    persistedCacheReadAhead.set(memberId, serializedSnapshot);

    persistenceQueue = persistenceQueue
        .catch(() => undefined)
        .then(async () => {
            if (
                generation !== persistenceGeneration ||
                activeMemberId !== memberId
            ) {
                return;
            }
            await AsyncStorage.setItem(
                persistedCacheKey(memberId),
                serializedSnapshot,
            );
        })
        .catch(() => undefined);
}

/**
 * Starts AsyncStorage bridge initialization while authentication is still
 * reading Keychain. The account id is only used after auth resolves, so no
 * other member's schedule is published during read-ahead.
 */
export function prewarmCalendarScheduleCachePersistence(): Promise<void> {
    if (persistenceReadAheadPromise) return persistenceReadAheadPromise;

    const request = AsyncStorage.getAllKeys()
        .then(keys => keys
            .filter(key => memberIdFromPersistedCacheKey(key) !== null)
            .slice(0, 8))
        .then(async keys => {
            if (keys.length === 0) return;
            const entries = await AsyncStorage.multiGet(keys);
            entries.forEach(([key, raw]) => {
                const memberId = memberIdFromPersistedCacheKey(key);
                if (memberId !== null) persistedCacheReadAhead.set(memberId, raw);
            });
        })
        .catch(() => undefined);

    persistenceReadAheadPromise = request;
    return request;
}

if (process.env.NODE_ENV !== "test") {
    prewarmCalendarScheduleCachePersistence().catch(() => undefined);
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
        throw new Error("일정을 불러올 날짜를 확인하지 못했어요. 다시 시도해 주세요.");
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
        Number.isFinite(rangeStart) &&
        Number.isFinite(rangeEnd) &&
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
    persistActiveCache();
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

/** Restores only the signed-in member's bounded month summaries before network work starts. */
export function activateCalendarScheduleCacheForAuthenticatedAccount(
    memberId: number,
): Promise<boolean> {
    if (!isValidMemberId(memberId)) return Promise.resolve(false);
    if (activeMemberId === memberId && activeMemberHydrated) {
        return Promise.resolve(true);
    }
    if (activeMemberId === memberId && activationPromise) {
        return activationPromise;
    }

    persistenceGeneration += 1;
    const generation = persistenceGeneration;
    cacheRevision += 1;
    activeMemberId = memberId;
    activeMemberHydrated = false;
    serverRevision = null;
    monthCache.clear();
    inFlightMonths.clear();

    const readPersistedCache = async () => {
        if (persistenceReadAheadPromise) {
            await persistenceReadAheadPromise;
        }
        if (persistedCacheReadAhead.has(memberId)) {
            return persistedCacheReadAhead.get(memberId) ?? null;
        }
        const raw = await AsyncStorage.getItem(persistedCacheKey(memberId));
        persistedCacheReadAhead.set(memberId, raw);
        return raw;
    };

    const request = readPersistedCache()
        .then(async raw => {
            if (
                generation !== persistenceGeneration ||
                activeMemberId !== memberId
            ) {
                return false;
            }

            const persisted = parsePersistedCache(raw, memberId);
            if (raw && !persisted) {
                await AsyncStorage.removeItem(persistedCacheKey(memberId));
            }
            if (
                generation !== persistenceGeneration ||
                activeMemberId !== memberId
            ) {
                return false;
            }

            const now = Date.now();
            persisted?.months.forEach(month => {
                monthCache.set(month.key, {
                    items: dedupeCalendarSchedules(month.items),
                    fetchedAt: month.fetchedAt,
                    lastAccessedAt: now,
                });
            });
            serverRevision = persisted?.serverRevision ?? null;
            activeMemberHydrated = true;
            pruneCache();
            return true;
        })
        .catch(() => {
            if (
                generation === persistenceGeneration &&
                activeMemberId === memberId
            ) {
                activeMemberHydrated = true;
            }
            return false;
        });

    activationPromise = request;
    request.finally(() => {
        if (activationPromise === request) activationPromise = null;
    });
    return request;
}

export function getActiveCalendarScheduleCacheMemberId(): number | null {
    return activeMemberId;
}

export function getCalendarScheduleCacheServerRevision(): number | null {
    return serverRevision;
}

export function setCalendarScheduleCacheServerRevision(revision: number): void {
    if (!Number.isSafeInteger(revision) || revision < 0) return;
    if (serverRevision === revision) return;
    serverRevision = revision;
    persistActiveCache();
}

/** Removes the durable cache without allowing an older queued write to recreate it. */
export async function clearPersistedCalendarScheduleCacheForAccount(
    memberId: number | null | undefined,
): Promise<void> {
    const targetMemberId = isValidMemberId(memberId ?? 0)
        ? (memberId as number)
        : activeMemberId;
    persistenceGeneration += 1;
    cacheRevision += 1;
    activeMemberId = null;
    activeMemberHydrated = false;
    activationPromise = null;
    serverRevision = null;
    monthCache.clear();
    inFlightMonths.clear();
    invalidationListeners.forEach(listener => listener());

    await persistenceQueue.catch(() => undefined);
    if (targetMemberId) {
        persistedCacheReadAhead.delete(targetMemberId);
        await AsyncStorage.removeItem(persistedCacheKey(targetMemberId));
    } else {
        persistedCacheReadAhead.clear();
    }
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
    throw new Error("일정이 변경되어 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
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
    persistActiveCache();
}

export function removeCalendarScheduleCacheItem(scheduleId: string): void {
    cacheRevision += 1;
    monthCache.forEach((entry) => {
        entry.items = entry.items.filter((item) => item.id !== scheduleId);
        entry.lastAccessedAt = Date.now();
    });
    persistActiveCache();
}

export function clearCalendarScheduleCache(): void {
    cacheRevision += 1;
    monthCache.clear();
    inFlightMonths.clear();
    persistActiveCache();
    invalidationListeners.forEach((listener) => listener());
}

export function subscribeCalendarScheduleCacheInvalidated(listener: () => void): () => void {
    invalidationListeners.add(listener);
    return () => invalidationListeners.delete(listener);
}

export const CALENDAR_SCHEDULE_CACHE_TEST_CONSTANTS =
    process.env.NODE_ENV === "test"
        ? {
            persistedCacheKey,
            persistedCacheVersion: PERSISTED_CACHE_VERSION,
            flushPersistence: () => persistenceQueue,
            resetMemory: async () => {
                persistenceGeneration += 1;
                await persistenceQueue.catch(() => undefined);
                cacheRevision += 1;
                activeMemberId = null;
                activeMemberHydrated = false;
                activationPromise = null;
                serverRevision = null;
                monthCache.clear();
                inFlightMonths.clear();
                persistedCacheReadAhead.clear();
                persistenceReadAheadPromise = null;
                persistenceQueue = Promise.resolve();
            },
        }
        : undefined;
