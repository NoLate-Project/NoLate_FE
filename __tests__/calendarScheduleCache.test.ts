import {
    clearCalendarScheduleCache,
    captureCalendarScheduleCacheAuthEpoch,
    hasCalendarScheduleMonthCache,
    readCalendarScheduleCache,
    reconcileCalendarScheduleCacheWithFullList,
    releaseCalendarScheduleCacheSecurityBlock,
    resetCalendarScheduleCacheSecurityFence,
    refreshCalendarScheduleCache,
    removeCalendarScheduleCacheItem,
    setCalendarScheduleCacheSecurityFence,
    subscribeCalendarScheduleCacheInvalidated,
    upsertCalendarScheduleCacheItem,
    mutateCalendarScheduleCacheIfAuthSessionCurrent,
} from "../src/modules/schedule/calendarScheduleCache";
import { getMonthRange } from "../src/modules/schedule/calendarRange";
import type { ScheduleItem } from "../src/modules/schedule/types";
import {
    activateAuthSessionIfCurrent,
    beginAuthLoginSession,
    beginAuthLogoutSession,
    getAuthSessionEpoch,
} from "../src/modules/auth/authSessionEpoch";
import * as env from "../src/api/env";
import {
    establishScheduleSharingSessionOwner,
} from "../src/modules/share/scheduleSharingSessionOwner";

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
        jest.spyOn(env, "getEnv").mockReturnValue("true");
        const epoch = beginAuthLoginSession();
        activateAuthSessionIfCurrent(epoch);
        resetCalendarScheduleCacheSecurityFence();
        setCalendarScheduleCacheSecurityFence(new Set(), new Set());
        clearCalendarScheduleCache();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("공유 off 전환은 warm cache의 받은 일정을 제거하고 owner 일정만 유지한다", async () => {
        const july = getMonthRange("2026-07-01");
        const owner = {
            ...schedule("owner", localDate(2026, 6, 12)),
            ownerMemberId: 7,
            departureParticipants: [
                { memberId: 7, role: "OWNER" as const, departed: false },
                { memberId: 9, role: "SHARED" as const, departed: false },
            ],
            travelCollaborationEnabled: true,
        };
        const received = {
            ...schedule("received", localDate(2026, 6, 13)),
            ownerMemberId: 9,
            sharePermission: "VIEWER" as const,
            category: {
                id: "shared",
                title: "받은 카테고리",
                color: "#16A34A",
                shared: true,
                sharePermission: "VIEWER" as const,
            },
        };

        await refreshCalendarScheduleCache(
            july.startAt,
            july.endAt,
            jest.fn().mockResolvedValue([owner, received]),
        );
        jest.spyOn(env, "getEnv").mockReturnValue(undefined);
        establishScheduleSharingSessionOwner(getAuthSessionEpoch(), 7);

        expect(readCalendarScheduleCache(
            july.startAt,
            july.endAt,
        ).items).toEqual([
            expect.objectContaining({
                id: "owner",
                departureParticipants: undefined,
                travelCollaborationEnabled: true,
            }),
        ]);
    });

    test("공유 off에서 늦은 받은 일정 응답은 cache에 부활하지 않고 owner 응답은 유지된다", async () => {
        jest.spyOn(env, "getEnv").mockReturnValue(undefined);
        establishScheduleSharingSessionOwner(getAuthSessionEpoch(), 7);
        const august = getMonthRange("2026-08-01");
        const owner = {
            ...schedule("owner", localDate(2026, 7, 12)),
            ownerMemberId: 7,
        };
        const received = {
            ...schedule("received", localDate(2026, 7, 13)),
            ownerMemberId: 9,
            sharePermission: "EDITOR" as const,
        };

        await refreshCalendarScheduleCache(
            august.startAt,
            august.endAt,
            jest.fn().mockResolvedValue([owner, received]),
        );

        expect(readCalendarScheduleCache(
            august.startAt,
            august.endAt,
        ).items.map((item) => item.id)).toEqual(["owner"]);
    });

    test("off owner context rejects an ownerMemberId-only received row without rollout share flags", async () => {
        jest.spyOn(env, "getEnv").mockReturnValue(undefined);
        establishScheduleSharingSessionOwner(getAuthSessionEpoch(), 7);
        const september = getMonthRange("2026-09-01");

        await refreshCalendarScheduleCache(
            september.startAt,
            september.endAt,
            jest.fn().mockResolvedValue([
                {
                    ...schedule("owner", localDate(2026, 8, 12)),
                    ownerMemberId: 7,
                },
                {
                    ...schedule("received-rollout", localDate(2026, 8, 13)),
                    ownerMemberId: 9,
                },
            ]),
        );

        expect(readCalendarScheduleCache(
            september.startAt,
            september.endAt,
        ).items.map((item) => item.id)).toEqual(["owner"]);
    });

    test("logout intent epoch에서는 새 calendar cache mutation을 허용하지 않는다", () => {
        const activeEpoch = captureCalendarScheduleCacheAuthEpoch();
        beginAuthLogoutSession();
        const mutation = jest.fn();

        expect(mutateCalendarScheduleCacheIfAuthSessionCurrent(
            activeEpoch,
            mutation,
        )).toBe(false);
        expect(mutation).not.toHaveBeenCalled();
        expect(mutateCalendarScheduleCacheIfAuthSessionCurrent(
            captureCalendarScheduleCacheAuthEpoch(),
            mutation,
        )).toBe(false);
        expect(mutation).not.toHaveBeenCalled();
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

    test("an account A range response cannot overwrite account B with the same schedule id", async () => {
        const july = getMonthRange("2026-07-01");
        const accountAItem = {
            ...schedule("same-id", localDate(2026, 6, 12)),
            title: "A private",
        };
        const accountBItem = {
            ...accountAItem,
            title: "B current",
        };
        const lateAccountA = deferred<ScheduleItem[]>();
        const pendingAccountA = refreshCalendarScheduleCache(
            july.startAt,
            july.endAt,
            jest.fn().mockReturnValue(lateAccountA.promise),
        );

        const accountBEpoch = beginAuthLoginSession();
        activateAuthSessionIfCurrent(accountBEpoch);
        resetCalendarScheduleCacheSecurityFence();
        clearCalendarScheduleCache();
        await refreshCalendarScheduleCache(
            july.startAt,
            july.endAt,
            jest.fn().mockResolvedValue([accountBItem]),
        );

        lateAccountA.resolve([accountAItem]);
        await pendingAccountA;
        expect(
            readCalendarScheduleCache(july.startAt, july.endAt).items
        ).toEqual([accountBItem]);
    });

    test("remove blocks a stale range that starts after the purge without an external fence", async () => {
        const april = getMonthRange("2026-04-01");
        const removed = schedule("removed-before-range", localDate(2026, 3, 12));

        removeCalendarScheduleCacheItem(removed.id);
        await refreshCalendarScheduleCache(
            april.startAt,
            april.endAt,
            jest.fn().mockResolvedValue([removed]),
        );

        expect(
            readCalendarScheduleCache(april.startAt, april.endAt).items
        ).toEqual([]);
    });

    test("remove blocks a stale upsert that happens after the purge without an external fence", async () => {
        const may = getMonthRange("2026-05-01");
        const removed = schedule("removed-before-upsert", localDate(2026, 4, 12));
        await refreshCalendarScheduleCache(
            may.startAt,
            may.endAt,
            jest.fn().mockResolvedValue([removed]),
        );

        removeCalendarScheduleCacheItem(removed.id);
        upsertCalendarScheduleCacheItem({
            ...removed,
            title: "stale upsert",
        });

        expect(
            readCalendarScheduleCache(may.startAt, may.endAt).items
        ).toEqual([]);
    });

    test("range writes started after purge obey the live provider security fence", async () => {
        const january = getMonthRange("2026-01-01");
        const february = getMonthRange("2026-02-01");
        const accessId = "access-redacted";
        const deletedId = "explicit-deleted";
        const redactedIds = new Set([accessId]);
        const removedIds = new Set([deletedId]);

        removeCalendarScheduleCacheItem(accessId);
        removeCalendarScheduleCacheItem(deletedId);
        await refreshCalendarScheduleCache(
            january.startAt,
            january.endAt,
            jest.fn().mockResolvedValue([
                schedule("visible", localDate(2026, 0, 10)),
                schedule(accessId, localDate(2026, 0, 11)),
                schedule(deletedId, localDate(2026, 0, 12)),
            ]),
        );

        expect(
            readCalendarScheduleCache(january.startAt, january.endAt)
                .items.map((item) => item.id)
        ).toEqual(["visible"]);

        // A verified access regrant updates the same provider set read at
        // write time. Explicit deletion remains fenced.
        redactedIds.delete(accessId);
        setCalendarScheduleCacheSecurityFence(removedIds, redactedIds);
        releaseCalendarScheduleCacheSecurityBlock(accessId);
        await refreshCalendarScheduleCache(
            february.startAt,
            february.endAt,
            jest.fn().mockResolvedValue([
                schedule(accessId, localDate(2026, 1, 11)),
                schedule(deletedId, localDate(2026, 1, 12)),
            ]),
        );

        expect(
            readCalendarScheduleCache(february.startAt, february.endAt)
                .items.map((item) => item.id)
        ).toEqual([accessId]);
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
