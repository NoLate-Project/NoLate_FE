import {
    clearCalendarScheduleCache,
    hasCalendarScheduleMonthCache,
    readCalendarScheduleCache,
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
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((promiseResolve) => {
        resolve = promiseResolve;
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

    test("홈서버 캐시는 60분 동안 재조회하지 않는다", async () => {
        const june = getMonthRange("2026-06-01");
        const fetchedAt = 1_000_000;
        const dateNow = jest.spyOn(Date, "now").mockReturnValue(fetchedAt);
        const fetcher = jest.fn().mockResolvedValue([
            schedule("june", localDate(2026, 5, 10)),
        ]);

        try {
            await refreshCalendarScheduleCache(
                june.startAt,
                june.endAt,
                fetcher,
            );
            await refreshCalendarScheduleCache(
                june.startAt,
                june.endAt,
                fetcher,
                fetchedAt + 59 * 60 * 1000,
            );

            expect(fetcher).toHaveBeenCalledTimes(1);

            await refreshCalendarScheduleCache(
                june.startAt,
                june.endAt,
                fetcher,
                fetchedAt + 60 * 60 * 1000,
            );
            expect(fetcher).toHaveBeenCalledTimes(2);
        } finally {
            dateNow.mockRestore();
        }
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

    test("겹치는 sliding prefetch는 이미 요청 중인 월을 중복 조회하지 않는다", async () => {
        const june = getMonthRange("2026-06-01");
        const july = getMonthRange("2026-07-01");
        let resolveJune: ((items: ScheduleItem[]) => void) | undefined;
        const juneRequest = new Promise<ScheduleItem[]>((resolve) => {
            resolveJune = resolve;
        });
        const fetcher = jest.fn()
            .mockReturnValueOnce(juneRequest)
            .mockResolvedValueOnce([
                schedule("july", localDate(2026, 6, 10)),
            ]);

        const firstPrefetch = refreshCalendarScheduleCache(
            june.startAt,
            june.endAt,
            fetcher,
        );
        const overlappingPrefetch = refreshCalendarScheduleCache(
            june.startAt,
            july.endAt,
            fetcher,
        );

        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetcher).toHaveBeenNthCalledWith(1, june.startAt, june.endAt);
        expect(fetcher).toHaveBeenNthCalledWith(2, july.startAt, july.endAt);

        resolveJune?.([
            schedule("june", localDate(2026, 5, 10)),
        ]);
        await Promise.all([firstPrefetch, overlappingPrefetch]);

        expect(readCalendarScheduleCache(
            june.startAt,
            july.endAt,
        ).items.map((item) => item.id)).toEqual(["june", "july"]);
    });

    test("진행 중 revision이 바뀌면 새 revision으로 한 번 재조회한다", async () => {
        const june = getMonthRange("2026-06-01");
        const existing = schedule("existing", localDate(2026, 5, 10));
        const created = schedule("created", localDate(2026, 5, 11));
        const firstRequest = deferred<ScheduleItem[]>();
        const fetcher = jest.fn()
            .mockReturnValueOnce(firstRequest.promise)
            .mockResolvedValueOnce([existing, created]);

        const refresh = refreshCalendarScheduleCache(
            june.startAt,
            june.endAt,
            fetcher,
        );
        expect(fetcher).toHaveBeenCalledTimes(1);

        upsertCalendarScheduleCacheItem(created);
        firstRequest.resolve([existing]);

        const result = await refresh;
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetcher).toHaveBeenNthCalledWith(2, june.startAt, june.endAt);
        expect(result.cachedMonthKeys).toEqual(["2026-06"]);
        expect(result.items.map((item) => item.id).sort()).toEqual([
            "created",
            "existing",
        ]);
    });

    test("재조회 중 revision이 다시 바뀌면 부분 snapshot 대신 명시적으로 종료한다", async () => {
        const june = getMonthRange("2026-06-01");
        const existing = schedule("existing", localDate(2026, 5, 10));
        const firstMutation = schedule("first-mutation", localDate(2026, 5, 11));
        const secondMutation = schedule("second-mutation", localDate(2026, 5, 12));
        const firstRequest = deferred<ScheduleItem[]>();
        const secondRequest = deferred<ScheduleItem[]>();
        const secondRequestStarted = deferred<void>();
        const fetcher = jest.fn()
            .mockImplementationOnce(() => firstRequest.promise)
            .mockImplementationOnce(() => {
                secondRequestStarted.resolve(undefined);
                return secondRequest.promise;
            });

        const refresh = refreshCalendarScheduleCache(
            june.startAt,
            june.endAt,
            fetcher,
        );
        const refreshError = refresh.then<Error | null, Error | null>(
            () => null,
            (error) => error instanceof Error ? error : new Error(String(error)),
        );

        upsertCalendarScheduleCacheItem(firstMutation);
        firstRequest.resolve([existing]);
        await secondRequestStarted.promise;
        upsertCalendarScheduleCacheItem(secondMutation);
        secondRequest.resolve([existing, firstMutation]);

        const error = await refreshError;
        expect(error?.message).toBe(
            "일정 캐시가 연속으로 변경되어 조회를 완료하지 못했습니다."
        );
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(readCalendarScheduleCache(
            june.startAt,
            june.endAt,
        )).toMatchObject({
            items: [],
            cachedMonthKeys: [],
        });
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
