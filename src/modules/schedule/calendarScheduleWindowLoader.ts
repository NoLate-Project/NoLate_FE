import {
    hasCalendarScheduleMonthCache,
    readCalendarScheduleCache,
    refreshCalendarScheduleCache,
    type CalendarScheduleCacheSnapshot,
    type CalendarScheduleFetcher,
} from "./calendarScheduleCache";

export type CalendarScheduleWindowCacheRead = {
    cached: CalendarScheduleCacheSnapshot;
    hasVisibleMonthCache: boolean;
};

export type CalendarScheduleWindowLoadResult =
    CalendarScheduleWindowCacheRead & {
        refreshed: CalendarScheduleCacheSnapshot;
    };

type CalendarScheduleWindowLoadOptions = {
    startAt: string;
    endAt: string;
    visibleMonth: string;
    fetcher: CalendarScheduleFetcher;
    onCacheRead?: (state: CalendarScheduleWindowCacheRead) => void;
    now?: number;
};

/**
 * Reads the visible window synchronously for immediate paint, then always lets
 * the month cache evaluate the complete window. The cache calls `fetcher` only
 * for missing or expired month groups, so a full fresh hit stays network-free.
 */
export async function loadCalendarScheduleWindow({
    startAt,
    endAt,
    visibleMonth,
    fetcher,
    onCacheRead,
    now = Date.now(),
}: CalendarScheduleWindowLoadOptions): Promise<CalendarScheduleWindowLoadResult> {
    const cached = readCalendarScheduleCache(startAt, endAt, now);
    const hasVisibleMonthCache = hasCalendarScheduleMonthCache(visibleMonth);
    const cacheRead = {
        cached,
        hasVisibleMonthCache,
    };
    onCacheRead?.(cacheRead);

    const refreshed = await refreshCalendarScheduleCache(
        startAt,
        endAt,
        fetcher,
        now,
    );
    return {
        ...cacheRead,
        refreshed,
    };
}
