import {
    clearCalendarScheduleCache,
    hasCalendarScheduleMonthCache,
    readCalendarScheduleCache,
    reconcileCalendarScheduleCacheWithFullList,
    refreshCalendarScheduleCache,
    removeCalendarScheduleCacheItem,
    subscribeCalendarScheduleCacheInvalidated,
    upsertCalendarScheduleCacheItem,
} from "../src/modules/schedule/calendarScheduleCache";
import { getMonthRange } from "../src/modules/schedule/calendarRange";
import type { ScheduleItem } from "../src/modules/schedule/types";

function schedule(id: string, startAt: Date, endAt = startAt): ScheduleItem {
    return {
        id,
        title: `일정 ${id}`,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        category: { id: "1", title: "기본", color: "#2F80FF" },
    };
}

function localDate(year: number, monthIndex: number, day: number): Date {
    return new Date(year, monthIndex, day, 9, 0, 0, 0);
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe("calendar schedule month cache", () => {
    beforeEach(() => {
        clearCalendarScheduleCache();
    });

    test("첫 3개월 조회는 한 요청으로 받고 월별 캐시로 나눈다", async () => {
        const june = getMonthRange("2026-06-01");
        const august = getMonthRange("2026-08-01");
        const items = [
            schedule("july", localDate(2026, 6, 10)),
            schedule("august", localDate(2026, 7, 10)),
        ];
        const fetcher = jest.fn().mockResolvedValue(items);

        const result = await refreshCalendarScheduleCache(
            june.startAt,
            august.endAt,
            fetcher,
        );

        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith(june.startAt, august.endAt);
        expect(result.requestedMonthKeys).toEqual(["2026-06", "2026-07", "2026-08"]);
        expect(result.cachedMonthKeys).toEqual(["2026-06", "2026-07", "2026-08"]);
        expect(result.items.map((item) => item.id)).toEqual(["july", "august"]);
        expect(hasCalendarScheduleMonthCache("2026-08-15")).toBe(true);
    });

    test("다음 달 이동은 캐시된 두 달을 재조회하지 않고 새 한 달만 가져온다", async () => {
        const june = getMonthRange("2026-06-01");
        const august = getMonthRange("2026-08-01");
        const september = getMonthRange("2026-09-01");
        const fetcher = jest.fn()
            .mockResolvedValueOnce([
                schedule("july", localDate(2026, 6, 10)),
                schedule("august", localDate(2026, 7, 10)),
            ])
            .mockResolvedValueOnce([
                schedule("september", localDate(2026, 8, 10)),
            ]);

        await refreshCalendarScheduleCache(june.startAt, august.endAt, fetcher);
        const cachedBeforeRefresh = readCalendarScheduleCache(
            getMonthRange("2026-07-01").startAt,
            september.endAt,
        );

        expect(cachedBeforeRefresh.cachedMonthKeys).toEqual(["2026-07", "2026-08"]);
        expect(cachedBeforeRefresh.items.map((item) => item.id)).toEqual(["july", "august"]);

        const refreshed = await refreshCalendarScheduleCache(
            getMonthRange("2026-07-01").startAt,
            september.endAt,
            fetcher,
        );

        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetcher).toHaveBeenLastCalledWith(september.startAt, september.endAt);
        expect(refreshed.items.map((item) => item.id)).toEqual([
            "july",
            "august",
            "september",
        ]);
    });

    test("일정 수정과 삭제를 캐시된 모든 월에 즉시 반영한다", async () => {
        const january = getMonthRange("2026-01-01");
        const march = getMonthRange("2026-03-01");
        const original = schedule("moving", localDate(2026, 0, 10));

        await refreshCalendarScheduleCache(
            january.startAt,
            march.endAt,
            jest.fn().mockResolvedValue([original]),
        );

        const moved = {
            ...original,
            startAt: localDate(2026, 2, 12).toISOString(),
            endAt: localDate(2026, 2, 12).toISOString(),
            title: "이동한 일정",
        };
        upsertCalendarScheduleCacheItem(moved);

        expect(readCalendarScheduleCache(january.startAt, january.endAt).items).toEqual([]);
        expect(readCalendarScheduleCache(march.startAt, march.endAt).items).toEqual([moved]);

        removeCalendarScheduleCacheItem(moved.id);
        expect(readCalendarScheduleCache(january.startAt, march.endAt).items).toEqual([]);
    });

    test("authoritative full list purges absent cache items and fences a late range response", async () => {
        const january = getMonthRange("2026-01-01");
        const february = getMonthRange("2026-02-01");
        const kept = schedule("kept", localDate(2026, 0, 10));
        const stale = schedule("stale-private", localDate(2026, 0, 12));
        await refreshCalendarScheduleCache(
            january.startAt,
            january.endAt,
            jest.fn().mockResolvedValue([kept, stale]),
        );

        const lateRange = deferred<ScheduleItem[]>();
        const pendingRefresh = refreshCalendarScheduleCache(
            february.startAt,
            february.endAt,
            jest.fn().mockReturnValue(lateRange.promise),
        );
        const removed = reconcileCalendarScheduleCacheWithFullList(
            new Set([kept.id])
        );

        expect(removed).toEqual([stale.id]);
        expect(
            readCalendarScheduleCache(january.startAt, january.endAt)
                .items.map((item) => item.id)
        ).toEqual([kept.id]);

        lateRange.resolve([
            schedule(stale.id, localDate(2026, 1, 12)),
        ]);
        await pendingRefresh;
        expect(
            readCalendarScheduleCache(february.startAt, february.endAt).items
        ).toEqual([]);
    });

    test("a cold late range cannot blank or repopulate a hydrated authoritative agenda", async () => {
        const january = getMonthRange("2026-01-01");
        const visible = schedule("authoritative-visible", localDate(2026, 0, 10));
        const omittedPrivate = schedule("late-private", localDate(2026, 0, 12));
        const lateRange = deferred<ScheduleItem[]>();
        const fetcher = jest.fn().mockReturnValue(lateRange.promise);
        const pendingRefresh = refreshCalendarScheduleCache(
            january.startAt,
            january.endAt,
            fetcher,
        );

        reconcileCalendarScheduleCacheWithFullList(
            new Set([visible.id]),
            {
                items: [visible],
                startAt: january.startAt,
                endAt: january.endAt,
            }
        );

        expect(
            readCalendarScheduleCache(january.startAt, january.endAt)
                .items.map((item) => item.id)
        ).toEqual([visible.id]);

        lateRange.resolve([visible, omittedPrivate]);
        const completed = await pendingRefresh;

        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(completed.cachedMonthKeys).toEqual(["2026-01"]);
        expect(completed.items.map((item) => item.id)).toEqual([visible.id]);
        expect(
            readCalendarScheduleCache(january.startAt, january.endAt)
                .items.map((item) => item.id)
        ).toEqual([visible.id]);
    });

    test("item access purge fences a range response that started before denial", async () => {
        const march = getMonthRange("2026-03-01");
        const privateItem = schedule(
            "late-private",
            localDate(2026, 2, 12)
        );
        const lateRange = deferred<ScheduleItem[]>();
        const pendingRefresh = refreshCalendarScheduleCache(
            march.startAt,
            march.endAt,
            jest.fn().mockReturnValue(lateRange.promise),
        );

        removeCalendarScheduleCacheItem(privateItem.id);
        lateRange.resolve([privateItem]);
        await pendingRefresh;

        expect(
            readCalendarScheduleCache(march.startAt, march.endAt).items
        ).toEqual([]);
    });

    test("원격 공유 변경으로 캐시를 비우면 화면 구독자에게 다시 조회하도록 알린다", () => {
        const listener = jest.fn();
        const unsubscribe = subscribeCalendarScheduleCacheInvalidated(listener);

        clearCalendarScheduleCache();
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        clearCalendarScheduleCache();
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
