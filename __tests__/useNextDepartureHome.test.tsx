import React from "react";
import { Pressable, Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import {
    getScheduleDepartureStatus,
    getScheduleForDepartureHome,
    getSchedules,
    type ScheduleDepartureStatus,
} from "../src/api/schedule";
import { ApiResponseError } from "../src/api/response";
import {
    getAuthMember,
    subscribeAuthInvalidation,
} from "../src/modules/auth/authStorage";
import {
    buildNextDepartureCandidate,
    buildNextDepartureHeroModel,
    selectNextDeparture,
} from "../src/modules/schedule/nextDeparture";
import type { ScheduleItem } from "../src/modules/schedule/types";
import {
    DEPARTURE_HOME_CANDIDATE_LIMIT,
    getDepartureHomeConnectionIssue,
    useNextDepartureHome,
} from "../src/modules/schedule/useNextDepartureHome";

jest.mock("../src/api/schedule", () => ({
    getSchedules: jest.fn(),
    getScheduleForDepartureHome: jest.fn(),
    getScheduleDepartureStatus: jest.fn(),
}));

jest.mock("../src/modules/auth/authStorage", () => ({
    getAuthMember: jest.fn(),
    subscribeAuthInvalidation: jest.fn(),
}));

const mockedGetSchedules = jest.mocked(getSchedules);
const mockedGetScheduleForDepartureHome = jest.mocked(
    getScheduleForDepartureHome
);
const mockedGetScheduleDepartureStatus = jest.mocked(
    getScheduleDepartureStatus
);
const mockedGetAuthMember = jest.mocked(getAuthMember);
const mockedSubscribeAuthInvalidation = jest.mocked(
    subscribeAuthInvalidation
);
const SYSTEM_NOW = new Date("2099-07-24T09:00:00+09:00");
const NO_REMOVED_SCHEDULES = new Set<string>();

function item(
    id: string,
    departureMinute: number,
    overrides: Partial<ScheduleItem> = {}
): ScheduleItem {
    return {
        id,
        ownerMemberId: 1,
        title: id,
        startAt: "2099-07-24T10:30:00+09:00",
        endAt: "2099-07-24T11:30:00+09:00",
        departAt: `2099-07-24T10:${String(departureMinute).padStart(2, "0")}:00+09:00`,
        travelMinutes: 30,
        destination: { name: "서울역" },
        category: { id: "test", title: "테스트", color: "#fff" },
        ...overrides,
    };
}

function status(
    scheduleId: string,
    recommendedDepartureAt: string,
    overrides: Partial<ScheduleDepartureStatus> = {}
): ScheduleDepartureStatus {
    return {
        scheduleId,
        travelMinutes: 30,
        recommendedDepartureAt,
        evaluatedAt: SYSTEM_NOW.toISOString(),
        liveFetchedAt: SYSTEM_NOW.toISOString(),
        source: "LIVE_PROVIDER",
        stale: false,
        confidence: "HIGH",
        failureReason: null,
        lastTrafficChangeMinutes: null,
        lastChangedAt: null,
        nextCheckAt: new Date(SYSTEM_NOW.getTime() + 4 * 60_000).toISOString(),
        preparationMinutes: null,
        preparationStartAt: null,
        safetyBufferMinutes: null,
        timeZone: "Asia/Seoul",
        ...overrides,
    };
}

function networkFailure(message = "connection unavailable") {
    return new ApiResponseError(message, {
        errorCode: "ERR_NETWORK",
        cause: { code: "ERR_NETWORK" },
    });
}

function Harness({
    fallbackItems = [],
    focused = true,
    removedScheduleIds = NO_REMOVED_SCHEDULES,
    onScheduleAccessRevoked,
    onSessionAccessRejected,
}: {
    fallbackItems?: ScheduleItem[];
    focused?: boolean;
    removedScheduleIds?: ReadonlySet<string>;
    onScheduleAccessRevoked?: (scheduleId: string) => void;
    onSessionAccessRejected?: () => void;
}) {
    const home = useNextDepartureHome({
        fallbackItems,
        focused,
        authoritativeRemovedScheduleIds: removedScheduleIds,
        onScheduleAccessRevoked,
        onSessionAccessRejected,
    });
    const ranked = selectNextDeparture(
        home.candidateItems,
        home.statusOrderingSafe ? home.statusesByScheduleId : {},
        new Date(),
        home.currentMemberId
    );
    const selected = ranked
        ? buildNextDepartureCandidate(
            ranked.item,
            home.statusesByScheduleId[ranked.item.id]
        )
        : null;
    const issue = home.connectionIssue
        ?? (selected
            ? home.statusIssuesByScheduleId[selected.item.id] ?? null
            : null);
    const model = selected
        ? buildNextDepartureHeroModel(selected, new Date(), issue)
        : null;
    const routeSetupCount = home.items.filter(
        (schedule) => schedule.routeSetupRequired === true
    ).length;
    const routeSetupTarget = home.items.find(
        (schedule) => schedule.routeSetupRequired === true
    )?.id ?? "route-none";
    const selectedDetailIssue = selected
        ? home.detailIssuesByScheduleId[selected.item.id] ?? "detail-ok"
        : "detail-none";
    const selectedRoute = selected?.item.route === null
        ? "route-null"
        : selected?.item.route ? "route-set" : "route-none";

    return (
        <>
            <Text testID="snapshot">
                {[
                    home.source,
                    selected?.item.id ?? "none",
                    Object.keys(home.statusesByScheduleId).length,
                    issue ?? "connected",
                    home.currentMemberId ?? "anonymous",
                    routeSetupCount,
                    model?.etaLabel ?? "no-eta-label",
                    selectedDetailIssue,
                    selectedRoute,
                    home.statusOrderingSafe ? "order-live" : "order-saved",
                    routeSetupTarget,
                    home.loading ? "loading" : "settled",
                ].join(":")}
            </Text>
            <Text testID="all-items">
                {home.items.map((schedule) => schedule.id).sort().join(",")}
            </Text>
            <Pressable testID="refresh" onPress={home.refresh} />
        </>
    );
}

async function flushAsyncWork() {
    for (let index = 0; index < 32; index += 1) {
        await Promise.resolve();
    }
}

function mockDetails(items: ScheduleItem[]) {
    const byId = new Map(items.map((schedule) => [schedule.id, schedule]));
    mockedGetScheduleForDepartureHome.mockImplementation(
        async (scheduleId) => byId.get(scheduleId)!
    );
}

function snapshot(renderer: ReactTestRenderer): string {
    return renderer.root.findByProps({ testID: "snapshot" }).props.children;
}

function abortableRequest<T>(
    signal: AbortSignal | undefined,
    abortedSignals: AbortSignal[]
): Promise<T> {
    return new Promise<T>((_resolve, reject) => {
        if (!signal) return;
        const rejectAbort = () => {
            abortedSignals.push(signal);
            reject(new Error("aborted"));
        };
        if (signal.aborted) {
            rejectAbort();
            return;
        }
        signal.addEventListener("abort", rejectAbort, { once: true });
    });
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

describe("useNextDepartureHome", () => {
    let renderer: ReactTestRenderer | undefined;
    let authInvalidationListener: (() => void | Promise<void>) | undefined;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(SYSTEM_NOW);
        mockedGetSchedules.mockReset();
        mockedGetScheduleForDepartureHome.mockReset();
        mockedGetScheduleDepartureStatus.mockReset();
        mockedGetAuthMember.mockReset();
        mockedSubscribeAuthInvalidation.mockReset();
        mockedGetAuthMember.mockResolvedValue({ id: 2 });
        mockedSubscribeAuthInvalidation.mockImplementation((listener) => {
            authInvalidationListener = listener;
            return () => {
                authInvalidationListener = undefined;
            };
        });
    });

    afterEach(() => {
        act(() => renderer?.unmount());
        renderer = undefined;
        authInvalidationListener = undefined;
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    test("uses the complete visible schedule contract and checks every eligible candidate with concurrency four", async () => {
        const candidates = [
            item("saved-first", 5),
            item("second", 10),
            item("third", 15),
            item("fourth", 20),
            item("fifth", 25),
            item("sixth", 30),
            item("far-seventh", 35, {
                startAt: "2099-08-24T10:30:00+09:00",
                endAt: "2099-08-24T11:30:00+09:00",
                departAt: "2099-08-24T10:35:00+09:00",
            }),
        ];
        const activeMultiDay = item("active-multi-day", 0, {
            startAt: "2099-07-20T08:00:00+09:00",
            endAt: "2099-07-25T10:00:00+09:00",
            departAt: "2099-07-24T09:20:00+09:00",
        });
        const locationOnly = item("location-only", 0, {
            departAt: undefined,
            travelMinutes: undefined,
            route: undefined,
            routeSetupRequired: false,
            notificationEnabled: false,
        });
        const allSchedules = [...candidates, activeMultiDay, locationOnly];
        mockedGetSchedules.mockResolvedValue(allSchedules);
        mockDetails(allSchedules);

        let activeRequests = 0;
        let maxActiveRequests = 0;
        const track = async <T,>(value: T): Promise<T> => {
            activeRequests += 1;
            maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
            await Promise.resolve();
            activeRequests -= 1;
            return value;
        };
        mockedGetScheduleForDepartureHome.mockImplementation(
            async (scheduleId) => track(
                allSchedules.find(({ id }) => id === scheduleId)!
            )
        );
        mockedGetScheduleDepartureStatus.mockImplementation(
            async (scheduleId) => track(status(
                scheduleId,
                scheduleId === "far-seventh"
                    ? "2099-07-24T09:05:00+09:00"
                    : scheduleId === "active-multi-day"
                        ? "2099-07-24T09:20:00+09:00"
                        : "2099-07-24T10:45:00+09:00"
            ))
        );

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });

        expect(mockedGetSchedules).toHaveBeenCalledTimes(1);
        expect(mockedGetSchedules.mock.calls[0]?.[0]?.signal)
            .toBeInstanceOf(AbortSignal);
        expect(mockedGetScheduleDepartureStatus).toHaveBeenCalledTimes(8);
        expect(mockedGetScheduleForDepartureHome).toHaveBeenCalledTimes(8);
        expect(mockedGetScheduleDepartureStatus).not.toHaveBeenCalledWith(
            "location-only",
            expect.anything()
        );
        expect(maxActiveRequests).toBeGreaterThan(1);
        expect(maxActiveRequests).toBeLessThanOrEqual(4);
        expect(snapshot(renderer!)).toContain("schedules:far-seventh:8");
    });

    test("commits the full list for route setup before bounded fan-out finishes", async () => {
        const routeSetup = item("route-before-detail", 5, {
            routeSetupRequired: true,
        });
        const detail = deferred<ScheduleItem>();
        mockedGetSchedules.mockResolvedValue([routeSetup]);
        mockedGetScheduleForDepartureHome.mockReturnValue(detail.promise);
        mockedGetScheduleDepartureStatus.mockReturnValue(
            new Promise<ScheduleDepartureStatus>(() => undefined)
        );

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });

        expect(renderer!.root.findByProps({ testID: "all-items" }).props.children)
            .toBe("route-before-detail");
        expect(snapshot(renderer!)).toContain(
            "schedules:route-before-detail:0:connected:2:1"
        );
        expect(snapshot(renderer!)).toContain("route-before-detail:loading");

        act(() => renderer?.unmount());
        renderer = undefined;
    });

    test("caps fan-out after sorting local candidates and keeps truncated ordering conservative", async () => {
        const candidates = Array.from(
            { length: DEPARTURE_HOME_CANDIDATE_LIMIT + 2 },
            (_, index) => item(
                `candidate-${index + 1}`,
                index + 1,
                index === DEPARTURE_HOME_CANDIDATE_LIMIT + 1
                    ? { routeSetupRequired: true }
                    : {}
            )
        ).reverse();
        mockedGetSchedules.mockResolvedValue(candidates);
        mockDetails(candidates);
        mockedGetScheduleDepartureStatus.mockImplementation(async (id) => status(
            id,
            id === "candidate-2"
                ? "2099-07-24T09:01:00+09:00"
                : id === `candidate-${DEPARTURE_HOME_CANDIDATE_LIMIT + 2}`
                    ? "2099-07-24T09:00:30+09:00"
                    : `2099-07-24T10:${id.split("-")[1]!.padStart(2, "0")}:00+09:00`
        ));

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });

        expect(mockedGetScheduleForDepartureHome)
            .toHaveBeenCalledTimes(DEPARTURE_HOME_CANDIDATE_LIMIT);
        expect(mockedGetScheduleDepartureStatus)
            .toHaveBeenCalledTimes(DEPARTURE_HOME_CANDIDATE_LIMIT);
        const detailIds = mockedGetScheduleForDepartureHome.mock.calls.map(
            ([scheduleId]) => scheduleId
        );
        expect(detailIds).toContain("candidate-1");
        expect(detailIds).not.toContain(
            `candidate-${DEPARTURE_HOME_CANDIDATE_LIMIT + 2}`
        );
        expect(snapshot(renderer!)).toContain("schedules:candidate-1");
        expect(snapshot(renderer!)).toContain("order-saved");
        expect(snapshot(renderer!)).toContain(
            `candidate-${DEPARTURE_HOME_CANDIDATE_LIMIT + 2}`
        );
    });

    test("a multi-day active event and a sole event beyond day fifteen remain candidates without window expansion", async () => {
        const active = item("active-past", 0, {
            startAt: "2099-07-01T08:00:00+09:00",
            endAt: "2099-07-25T10:00:00+09:00",
            departAt: "2099-07-24T08:45:00+09:00",
        });
        const far = item("far-future", 0, {
            startAt: "2099-08-20T10:00:00+09:00",
            endAt: "2099-08-20T11:00:00+09:00",
            departAt: "2099-08-20T09:30:00+09:00",
        });
        mockedGetSchedules.mockResolvedValueOnce([active]).mockResolvedValueOnce([far]);
        mockDetails([active, far]);
        mockedGetScheduleDepartureStatus.mockImplementation(async (id) => (
            status(id, id === "active-past" ? active.departAt! : far.departAt!)
        ));

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });
        expect(snapshot(renderer!)).toContain("schedules:active-past");

        await act(async () => {
            await renderer!.root.findByProps({ testID: "refresh" }).props.onPress();
            await flushAsyncWork();
        });

        expect(snapshot(renderer!)).toContain("schedules:far-future");
        expect(mockedGetSchedules).toHaveBeenCalledTimes(2);
        expect(mockedGetSchedules.mock.calls.every(
            ([options]) => Object.keys(options ?? {}).join(",") === "signal"
        )).toBe(true);
    });

    test("no eligible future candidate performs no detail/status fan-out", async () => {
        mockedGetSchedules.mockResolvedValue([
            item("ended", 0, {
                startAt: "2099-07-23T08:00:00+09:00",
                endAt: "2099-07-23T09:00:00+09:00",
            }),
            item("location-only", 0, {
                departAt: undefined,
                travelMinutes: undefined,
            }),
        ]);

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });

        expect(mockedGetSchedules).toHaveBeenCalledTimes(1);
        expect(mockedGetScheduleForDepartureHome).not.toHaveBeenCalled();
        expect(mockedGetScheduleDepartureStatus).not.toHaveBeenCalled();
        expect(snapshot(renderer!)).toContain("schedules:none");
    });

    test.each([
        [1, "none"],
        [2, "owner-fallback"],
    ])(
        "first offline load waits for member %s before owner departure fallback (%s)",
        async (memberId, selectedId) => {
            const ownerDeparted = item("owner-fallback", 5, {
                ownerMemberId: 1,
                departedAt: "2099-07-24T08:55:00+09:00",
            });
            mockedGetAuthMember.mockResolvedValue({ id: memberId });
            mockedGetSchedules.mockRejectedValue(networkFailure());

            await act(async () => {
                renderer = TestRenderer.create(
                    <Harness fallbackItems={[ownerDeparted]} />
                );
                await flushAsyncWork();
            });

            expect(snapshot(renderer!)).toContain(
                `calendar-fallback:${selectedId}:0:offline:${memberId}`
            );
        }
    );

    test("offline refresh merges current fallback completion and creation instead of keeping stale server items", async () => {
        const a = item("a", 5, { ownerMemberId: 2 });
        const completedA = {
            ...a,
            myDepartedAt: "2099-07-24T09:01:00+09:00",
            updatedAt: "2099-07-24T09:01:00+09:00",
        };
        const createdB = item("b", 10, { ownerMemberId: 2 });
        mockedGetSchedules
            .mockResolvedValueOnce([a])
            .mockRejectedValueOnce(networkFailure());
        mockDetails([a]);
        mockedGetScheduleDepartureStatus.mockResolvedValue(
            status("a", "2099-07-24T10:05:00+09:00")
        );

        await act(async () => {
            renderer = TestRenderer.create(<Harness fallbackItems={[a]} />);
            await flushAsyncWork();
        });
        expect(snapshot(renderer!)).toContain("schedules:a");

        await act(async () => {
            renderer!.update(
                <Harness fallbackItems={[completedA, createdB]} />
            );
            await flushAsyncWork();
        });

        expect(snapshot(renderer!)).toContain("calendar-fallback:b");
        expect(renderer!.root.findByProps({ testID: "all-items" }).props.children)
            .toBe("a,b");
    });

    test("an explicit deletion tombstone removes hero and route target before an offline refresh completes", async () => {
        const deleted = item("deleted-route", 5, {
            routeSetupRequired: true,
        });
        const pendingList = deferred<ScheduleItem[]>();
        mockedGetSchedules
            .mockResolvedValueOnce([deleted])
            .mockReturnValueOnce(pendingList.promise);
        mockDetails([deleted]);
        mockedGetScheduleDepartureStatus.mockResolvedValue(status(
            deleted.id,
            "2099-07-24T10:05:00+09:00"
        ));

        await act(async () => {
            renderer = TestRenderer.create(
                <Harness fallbackItems={[deleted]} />
            );
            await flushAsyncWork();
        });
        expect(snapshot(renderer!)).toContain("schedules:deleted-route");

        await act(async () => {
            renderer!.update(
                <Harness
                    fallbackItems={[]}
                    removedScheduleIds={new Set([deleted.id])}
                />
            );
            await flushAsyncWork();
        });

        expect(renderer!.root.findByProps({ testID: "all-items" }).props.children)
            .toBe("");
        expect(snapshot(renderer!)).toContain("none:0:connected:2:0");
        expect(snapshot(renderer!)).toContain("route-none");

        await act(async () => {
            pendingList.reject(networkFailure());
            await flushAsyncWork();
        });
        expect(renderer!.root.findByProps({ testID: "all-items" }).props.children)
            .toBe("");
    });

    test("a successful full-list omission overrides a stale range fallback without inferring other range absences", async () => {
        const deleted = item("full-list-absent", 5, {
            routeSetupRequired: true,
        });
        mockedGetSchedules
            .mockResolvedValueOnce([deleted])
            .mockResolvedValueOnce([])
            .mockRejectedValueOnce(networkFailure());
        mockDetails([deleted]);
        mockedGetScheduleDepartureStatus.mockResolvedValue(status(
            deleted.id,
            "2099-07-24T10:05:00+09:00"
        ));

        await act(async () => {
            renderer = TestRenderer.create(
                <Harness fallbackItems={[deleted]} />
            );
            await flushAsyncWork();
        });
        await act(async () => {
            await renderer!.root.findByProps({ testID: "refresh" }).props.onPress();
            await flushAsyncWork();
        });
        expect(renderer!.root.findByProps({ testID: "all-items" }).props.children)
            .toBe("");

        await act(async () => {
            await renderer!.root.findByProps({ testID: "refresh" }).props.onPress();
            await flushAsyncWork();
        });
        expect(renderer!.root.findByProps({ testID: "all-items" }).props.children)
            .toBe("");
        expect(snapshot(renderer!)).toContain("route-none");
    });

    test("a tombstone during fan-out aborts the old run and a late detail cannot resurrect it", async () => {
        const deleted = item("deleted-during-fanout", 5, {
            routeSetupRequired: true,
        });
        const lateDetail = deferred<ScheduleItem>();
        mockedGetSchedules
            .mockResolvedValueOnce([deleted])
            .mockRejectedValueOnce(networkFailure());
        mockedGetScheduleForDepartureHome.mockReturnValue(lateDetail.promise);
        mockedGetScheduleDepartureStatus.mockResolvedValue(status(
            deleted.id,
            "2099-07-24T10:05:00+09:00"
        ));

        await act(async () => {
            renderer = TestRenderer.create(
                <Harness fallbackItems={[deleted]} />
            );
            await flushAsyncWork();
        });
        expect(snapshot(renderer!)).toContain("deleted-during-fanout");
        expect(snapshot(renderer!)).toContain("loading");

        await act(async () => {
            renderer!.update(
                <Harness
                    fallbackItems={[]}
                    removedScheduleIds={new Set([deleted.id])}
                />
            );
            await flushAsyncWork();
        });
        expect(renderer!.root.findByProps({ testID: "all-items" }).props.children)
            .toBe("");

        await act(async () => {
            lateDetail.resolve(deleted);
            await flushAsyncWork();
        });
        expect(renderer!.root.findByProps({ testID: "all-items" }).props.children)
            .toBe("");
        expect(snapshot(renderer!)).toContain("route-none");
    });

    test("consecutive offline failures retain non-deleted full-list items outside the visible fallback", async () => {
        const deleted = item("deleted-near", 5, {
            routeSetupRequired: true,
        });
        const far = item("far-retained", 10, {
            startAt: "2099-09-24T10:30:00+09:00",
            endAt: "2099-09-24T11:30:00+09:00",
            departAt: "2099-09-24T10:10:00+09:00",
            routeSetupRequired: true,
        });
        mockedGetSchedules
            .mockResolvedValueOnce([deleted, far])
            .mockRejectedValue(networkFailure());
        mockDetails([deleted, far]);
        mockedGetScheduleDepartureStatus.mockImplementation(async (id) => status(
            id,
            id === deleted.id ? deleted.departAt! : far.departAt!
        ));

        await act(async () => {
            renderer = TestRenderer.create(
                <Harness fallbackItems={[deleted]} />
            );
            await flushAsyncWork();
        });

        await act(async () => {
            renderer!.update(
                <Harness
                    fallbackItems={[]}
                    removedScheduleIds={new Set([deleted.id])}
                />
            );
            await flushAsyncWork();
        });
        expect(renderer!.root.findByProps({ testID: "all-items" }).props.children)
            .toBe("far-retained");

        await act(async () => {
            await renderer!.root.findByProps({ testID: "refresh" }).props.onPress();
            await flushAsyncWork();
        });
        expect(renderer!.root.findByProps({ testID: "all-items" }).props.children)
            .toBe("far-retained");
        expect(snapshot(renderer!)).toContain("far-retained");
        expect(snapshot(renderer!)).toContain("far-retained:settled");
    });

    test("focus return overlays completed fallback immediately before a slow network revalidation", async () => {
        const a = item("completed-while-away", 5, { ownerMemberId: 2 });
        const completedA = {
            ...a,
            myDepartedAt: "2099-07-24T09:02:00+09:00",
            updatedAt: "2099-07-24T09:02:00+09:00",
        };
        const b = item("still-upcoming", 10, { ownerMemberId: 2 });
        const slowList = deferred<ScheduleItem[]>();
        mockedGetSchedules
            .mockResolvedValueOnce([a, b])
            .mockReturnValueOnce(slowList.promise);
        mockDetails([a, b]);
        mockedGetScheduleDepartureStatus.mockImplementation(async (id) => status(
            id,
            id === a.id
                ? "2099-07-24T10:05:00+09:00"
                : "2099-07-24T10:10:00+09:00"
        ));

        await act(async () => {
            renderer = TestRenderer.create(
                <Harness fallbackItems={[a, b]} focused />
            );
            await flushAsyncWork();
        });
        expect(snapshot(renderer!)).toContain("schedules:completed-while-away");

        await act(async () => {
            renderer!.update(
                <Harness fallbackItems={[completedA, b]} focused={false} />
            );
            await flushAsyncWork();
        });
        await act(async () => {
            renderer!.update(
                <Harness fallbackItems={[completedA, b]} focused />
            );
            await flushAsyncWork();
        });

        expect(snapshot(renderer!)).toContain("schedules:still-upcoming");
        expect(snapshot(renderer!)).toContain("loading");

        await act(async () => {
            slowList.reject(networkFailure());
            await flushAsyncWork();
        });
        expect(snapshot(renderer!)).toContain(
            "calendar-fallback:still-upcoming"
        );
    });

    test("focus return keeps the latest completion while a large bounded fan-out is pending", async () => {
        const a = item("completed-before-large-run", 1, { ownerMemberId: 2 });
        const completedA = {
            ...a,
            myDepartedAt: "2099-07-24T09:03:00+09:00",
            updatedAt: "2099-07-24T09:03:00+09:00",
        };
        const others = Array.from(
            { length: DEPARTURE_HOME_CANDIDATE_LIMIT + 1 },
            (_, index) => item(`large-${index + 1}`, index + 2, {
                ownerMemberId: 2,
            })
        );
        mockedGetSchedules
            .mockResolvedValueOnce([a, ...others])
            .mockResolvedValueOnce([a, ...others]);
        mockDetails([a, ...others]);
        mockedGetScheduleDepartureStatus.mockImplementation(async (id) => status(
            id,
            `2099-07-24T10:${id === a.id ? "01" : "30"}:00+09:00`
        ));

        await act(async () => {
            renderer = TestRenderer.create(
                <Harness fallbackItems={[a, ...others]} focused />
            );
            await flushAsyncWork();
        });
        await act(async () => {
            renderer!.update(
                <Harness
                    fallbackItems={[completedA, ...others]}
                    focused={false}
                />
            );
            await flushAsyncWork();
        });

        mockedGetScheduleForDepartureHome.mockImplementation(
            async () => new Promise<ScheduleItem>(() => undefined)
        );
        mockedGetScheduleDepartureStatus.mockImplementation(
            async () => new Promise<ScheduleDepartureStatus>(() => undefined)
        );
        await act(async () => {
            renderer!.update(
                <Harness
                    fallbackItems={[completedA, ...others]}
                    focused
                />
            );
            await flushAsyncWork();
        });

        expect(snapshot(renderer!)).toContain("schedules:large-1");
        expect(snapshot(renderer!)).not.toContain("completed-before-large-run");
        expect(snapshot(renderer!)).toContain("loading");

        act(() => renderer?.unmount());
        renderer = undefined;
    });

    test("unchanged stale snapshots back off at one, two, then capped five minutes", async () => {
        const candidate = item("stale", 5);
        mockedGetSchedules.mockResolvedValue([candidate]);
        mockDetails([candidate]);
        mockedGetScheduleDepartureStatus.mockImplementation(async () => status(
            candidate.id,
            "2099-07-24T10:05:00+09:00",
            {
                stale: true,
                evaluatedAt: new Date().toISOString(),
                liveFetchedAt: new Date().toISOString(),
                nextCheckAt: new Date(Date.now() - 1_000).toISOString(),
            }
        ));

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });
        expect(mockedGetSchedules).toHaveBeenCalledTimes(1);

        for (const [advance, expectedCalls] of [
            [59_999, 1],
            [1, 2],
            [119_999, 2],
            [1, 3],
            [299_999, 3],
            [1, 4],
            [300_000, 5],
        ] as const) {
            await act(async () => {
                jest.advanceTimersByTime(advance);
                await flushAsyncWork();
            });
            expect(mockedGetSchedules).toHaveBeenCalledTimes(expectedCalls);
        }
    });

    test("a healthy future nextCheckAt refreshes on time", async () => {
        const candidate = item("refreshing", 5);
        mockedGetSchedules.mockResolvedValue([candidate]);
        mockDetails([candidate]);
        mockedGetScheduleDepartureStatus.mockImplementation(async () => status(
            candidate.id,
            "2099-07-24T10:05:00+09:00",
            {
                evaluatedAt: new Date().toISOString(),
                liveFetchedAt: new Date().toISOString(),
                nextCheckAt: new Date(Date.now() + 2 * 60_000).toISOString(),
            }
        ));

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });

        await act(async () => {
            jest.advanceTimersByTime(119_999);
            await flushAsyncWork();
        });
        expect(mockedGetSchedules).toHaveBeenCalledTimes(1);

        await act(async () => {
            jest.advanceTimersByTime(1);
            await flushAsyncWork();
        });
        expect(mockedGetSchedules).toHaveBeenCalledTimes(2);
    });

    test("losing focus aborts active requests and prevents queued fan-out", async () => {
        const candidates = Array.from({ length: 5 }, (_, index) => (
            item(`candidate-${index}`, index + 1)
        ));
        const abortedSignals: AbortSignal[] = [];
        mockedGetSchedules.mockResolvedValue(candidates);
        mockedGetScheduleForDepartureHome.mockImplementation(
            async (_id, options) => abortableRequest(
                options?.signal,
                abortedSignals
            )
        );
        mockedGetScheduleDepartureStatus.mockImplementation(
            async (_id, options) => abortableRequest(
                options?.signal,
                abortedSignals
            )
        );

        await act(async () => {
            renderer = TestRenderer.create(<Harness focused />);
            await flushAsyncWork();
        });
        const startedBeforeBlur = mockedGetScheduleForDepartureHome.mock.calls.length
            + mockedGetScheduleDepartureStatus.mock.calls.length;
        expect(startedBeforeBlur).toBe(4);

        await act(async () => {
            renderer!.update(<Harness focused={false} />);
            await flushAsyncWork();
        });

        expect(abortedSignals).toHaveLength(4);
        expect(abortedSignals.every((signal) => signal.aborted)).toBe(true);
        expect(
            mockedGetScheduleForDepartureHome.mock.calls.length
            + mockedGetScheduleDepartureStatus.mock.calls.length
        ).toBe(4);
    });

    test("logout aborts account A fan-out before account B fallback and refresh can commit", async () => {
        const accountAItems = [
            item("a-1", 5),
            item("a-2", 10),
            item("a-3", 15),
        ];
        const accountBItem = item("b-1", 20, { ownerMemberId: 2 });
        const abortedSignals: AbortSignal[] = [];
        let memberId = 1;
        mockedGetAuthMember.mockImplementation(async () => ({ id: memberId }));
        mockedGetSchedules.mockImplementation(async () => (
            memberId === 1 ? accountAItems : [accountBItem]
        ));
        mockedGetScheduleForDepartureHome.mockImplementation(
            async (id, options) => id.startsWith("a-")
                ? abortableRequest(options?.signal, abortedSignals)
                : accountBItem
        );
        mockedGetScheduleDepartureStatus.mockImplementation(
            async (id, options) => id.startsWith("a-")
                ? abortableRequest(options?.signal, abortedSignals)
                : status(id, "2099-07-24T10:20:00+09:00")
        );

        await act(async () => {
            renderer = TestRenderer.create(
                <Harness fallbackItems={accountAItems} />
            );
            await flushAsyncWork();
        });
        expect(abortedSignals).toHaveLength(0);

        memberId = 2;
        await act(async () => {
            await authInvalidationListener?.();
            renderer!.update(<Harness fallbackItems={[accountBItem]} />);
            await flushAsyncWork();
        });

        expect(abortedSignals.length).toBeGreaterThan(0);
        expect(abortedSignals.every((signal) => signal.aborted)).toBe(true);
        expect(snapshot(renderer!)).toContain("schedules:b-1:1:connected:2");
        expect(renderer!.root.findByProps({ testID: "all-items" }).props.children)
            .toBe("b-1");
    });

    test("a post-refresh 401 redacts the current schedule session instead of purging one ID", async () => {
        const privateItem = item("private-session-item", 5, {
            routeSetupRequired: true,
        });
        const revokeOne = jest.fn();
        const rejectSession = jest.fn();
        mockedGetSchedules.mockResolvedValue([privateItem]);
        mockedGetScheduleForDepartureHome.mockRejectedValue(
            new ApiResponseError("unauthorized", { status: 401 })
        );
        mockedGetScheduleDepartureStatus.mockResolvedValue(status(
            privateItem.id,
            "2099-07-24T10:05:00+09:00"
        ));

        await act(async () => {
            renderer = TestRenderer.create(
                <Harness
                    fallbackItems={[privateItem]}
                    onScheduleAccessRevoked={revokeOne}
                    onSessionAccessRejected={rejectSession}
                />
            );
            await flushAsyncWork();
        });

        expect(rejectSession).toHaveBeenCalledTimes(1);
        expect(revokeOne).not.toHaveBeenCalled();
        expect(renderer!.root.findByProps({ testID: "all-items" }).props.children)
            .toBe("");
        expect(snapshot(renderer!)).toContain(
            "calendar-fallback:none:0:error:anonymous:0"
        );
    });

    test("a late access denial from auth epoch A cannot purge account B", async () => {
        const accountAItem = item("account-a-private", 5);
        const accountBItem = item("account-b-current", 10, {
            ownerMemberId: 2,
        });
        const lateDetail = deferred<ScheduleItem>();
        const revoked = jest.fn();
        let memberId = 1;
        mockedGetAuthMember.mockImplementation(async () => ({ id: memberId }));
        mockedGetSchedules.mockImplementation(async () => (
            memberId === 1 ? [accountAItem] : [accountBItem]
        ));
        mockedGetScheduleForDepartureHome.mockImplementation(async (id) => (
            id === accountAItem.id ? lateDetail.promise : accountBItem
        ));
        mockedGetScheduleDepartureStatus.mockImplementation(async (id) => status(
            id,
            id === accountAItem.id
                ? "2099-07-24T10:05:00+09:00"
                : "2099-07-24T10:10:00+09:00"
        ));

        await act(async () => {
            renderer = TestRenderer.create(
                <Harness
                    fallbackItems={[accountAItem]}
                    onScheduleAccessRevoked={revoked}
                />
            );
            await flushAsyncWork();
        });

        memberId = 2;
        await act(async () => {
            await authInvalidationListener?.();
            renderer!.update(
                <Harness
                    fallbackItems={[accountBItem]}
                    onScheduleAccessRevoked={revoked}
                />
            );
            await flushAsyncWork();
        });
        await act(async () => {
            lateDetail.reject(new ApiResponseError("forbidden", { status: 403 }));
            await flushAsyncWork();
        });

        expect(revoked).not.toHaveBeenCalledWith(accountAItem.id);
        expect(renderer!.root.findByProps({ testID: "all-items" }).props.children)
            .toBe("account-b-current");
        expect(snapshot(renderer!)).toContain("schedules:account-b-current");
    });

    test("a newer overlapping refresh aborts and cannot be overwritten by the older result", async () => {
        const initial = item("initial", 5);
        const stale = item("stale-overlap", 10);
        const latest = item("latest-overlap", 15);
        let listCall = 0;
        let staleDetailSignal: AbortSignal | undefined;
        mockedGetSchedules.mockImplementation(async () => {
            listCall += 1;
            if (listCall === 1) return [initial];
            if (listCall === 2) return [stale];
            return [latest];
        });
        mockedGetScheduleForDepartureHome.mockImplementation(
            async (id, options) => {
                if (id === stale.id) {
                    staleDetailSignal = options?.signal;
                    return abortableRequest(options?.signal, []);
                }
                return id === initial.id ? initial : latest;
            }
        );
        mockedGetScheduleDepartureStatus.mockImplementation(
            async (id, options) => id === stale.id
                ? abortableRequest(options?.signal, [])
                : status(id, id === initial.id
                    ? "2099-07-24T10:05:00+09:00"
                    : "2099-07-24T10:15:00+09:00")
        );

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });

        act(() => {
            renderer!.root.findByProps({ testID: "refresh" }).props.onPress();
        });
        await act(async () => {
            await flushAsyncWork();
        });
        await act(async () => {
            renderer!.root.findByProps({ testID: "refresh" }).props.onPress();
            await flushAsyncWork();
        });

        expect(staleDetailSignal?.aborted).toBe(true);
        expect(snapshot(renderer!)).toContain("schedules:latest-overlap");
        expect(renderer!.root.findByProps({ testID: "all-items" }).props.children)
            .toBe("latest-overlap");
    });

    test("transient detail failure stays separate from a successful live status", async () => {
        const candidate = item("live-with-detail-error", 5);
        mockedGetSchedules.mockResolvedValue([candidate]);
        mockedGetScheduleForDepartureHome.mockRejectedValue(
            new ApiResponseError("Network Error", {
                status: 503,
                errorCode: "ERR_NETWORK",
            })
        );
        mockedGetScheduleDepartureStatus.mockResolvedValue(status(
            candidate.id,
            "2099-07-24T10:05:00+09:00"
        ));

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });

        expect(snapshot(renderer!)).toContain(
            "schedules:live-with-detail-error:1:connected:2:0:실시간 ETA:error"
        );
    });

    test("status-only network failure preserves its prior source while marking ETA offline and delayed", async () => {
        const candidate = item("live-then-offline", 5);
        mockedGetSchedules.mockResolvedValue([candidate]);
        mockDetails([candidate]);
        mockedGetScheduleDepartureStatus
            .mockResolvedValueOnce(status(
                candidate.id,
                "2099-07-24T10:05:00+09:00"
            ))
            .mockRejectedValueOnce(networkFailure());

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });
        await act(async () => {
            await renderer!.root.findByProps({ testID: "refresh" }).props.onPress();
            await flushAsyncWork();
        });

        expect(snapshot(renderer!)).toContain(
            "schedules:live-then-offline:1:offline:2:0:실시간 ETA · 갱신 지연 · 오프라인"
        );
    });

    test("status 404 rollout fallback is neutral while 5xx is an ETA update error", async () => {
        const candidate = item("rollout", 5);
        mockedGetSchedules.mockResolvedValue([candidate]);
        mockDetails([candidate]);
        mockedGetScheduleDepartureStatus
            .mockRejectedValueOnce(new ApiResponseError("missing", { status: 404 }))
            .mockRejectedValueOnce(new ApiResponseError("down", { status: 503 }));

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });
        expect(snapshot(renderer!)).toContain(
            "schedules:rollout:0:connected:2:0:저장된 ETA"
        );

        await act(async () => {
            await renderer!.root.findByProps({ testID: "refresh" }).props.onPress();
            await flushAsyncWork();
        });
        expect(snapshot(renderer!)).toContain(
            "schedules:rollout:0:error:2:0:저장된 ETA · 업데이트 실패"
        );
    });

    test.each([
        new ApiResponseError("forbidden", { status: 403 }),
        new ApiResponseError("gone", { status: 404 }),
    ])("authoritative detail failure excludes an unverified candidate", async (failure) => {
        const revoked = jest.fn();
        const candidate = item("unverified", 5, {
            routeSetupRequired: true,
        });
        mockedGetSchedules.mockResolvedValue([candidate]);
        mockedGetScheduleForDepartureHome.mockRejectedValue(failure);
        mockedGetScheduleDepartureStatus.mockResolvedValue(status(
            candidate.id,
            "2099-07-24T10:05:00+09:00"
        ));

        await act(async () => {
            renderer = TestRenderer.create(
                <Harness
                    fallbackItems={[candidate]}
                    onScheduleAccessRevoked={revoked}
                />
            );
            await flushAsyncWork();
        });

        expect(snapshot(renderer!)).toContain("schedules:none:0:connected:2:0");
        expect(snapshot(renderer!)).toContain("order-live:route-none");
        expect(renderer!.root.findByProps({ testID: "all-items" }).props.children)
            .toBe("");
        expect(revoked).toHaveBeenCalledWith("unverified");
    });

    test("a mismatched detail response is excluded without turning live status into a saved-data error", async () => {
        const candidate = item("expected-id", 5);
        mockedGetSchedules.mockResolvedValue([candidate]);
        mockedGetScheduleForDepartureHome.mockResolvedValue({
            ...candidate,
            id: "another-account-item",
        });
        mockedGetScheduleDepartureStatus.mockResolvedValue(status(
            candidate.id,
            "2099-07-24T10:05:00+09:00"
        ));

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });

        expect(snapshot(renderer!)).toContain("schedules:none:0:connected");
    });

    test("authoritative detail nulls clear stale route and travel-plan values", async () => {
        const candidate = item("cleared", 5, {
            route: { id: "stale-route" },
            myTravelPlan: {
                scheduleId: 1,
                memberId: 2,
                status: "READY",
                route: { id: "stale-plan-route" },
            },
        });
        mockedGetSchedules.mockResolvedValue([candidate]);
        mockedGetScheduleForDepartureHome.mockResolvedValue({
            ...candidate,
            departAt: undefined,
            travelMinutes: undefined,
            route: null,
            myTravelPlan: null,
        });
        mockedGetScheduleDepartureStatus.mockRejectedValue(
            new ApiResponseError("not deployed", { status: 404 })
        );

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });

        expect(snapshot(renderer!)).toContain("schedules:none:0:connected");
        const cleared = renderer!.root.findByProps({ testID: "all-items" });
        expect(cleared.props.children).toBe("cleared");
    });

    test("route-setup/no-ETA candidates use the same all-schedules source after loading", async () => {
        const routeSetup = item("route-setup", 0, {
            departAt: undefined,
            travelMinutes: undefined,
            routeSetupRequired: true,
        });
        mockedGetSchedules.mockResolvedValue([routeSetup]);
        mockDetails([routeSetup]);
        mockedGetScheduleDepartureStatus.mockRejectedValue(
            new ApiResponseError("not deployed", { status: 501 })
        );

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });

        expect(snapshot(renderer!)).toContain(
            "schedules:route-setup:0:connected:2:1:ETA 없음"
        );
        expect(mockedGetSchedules).toHaveBeenCalledTimes(1);
    });
});

describe("getDepartureHomeConnectionIssue", () => {
    test("HTTP status wins over network-like text and codes", () => {
        expect(getDepartureHomeConnectionIssue(
            new ApiResponseError("Network Error", {
                status: 503,
                errorCode: "ERR_NETWORK",
                cause: { code: "ERR_NETWORK" },
            })
        )).toBe("error");
    });

    test("statusless structured network metadata is offline", () => {
        expect(getDepartureHomeConnectionIssue(
            new ApiResponseError("request failed", {
                errorCode: "ERR_NETWORK",
                cause: { code: "ERR_NETWORK" },
            })
        )).toBe("offline");
    });

    test("an arbitrary error message alone is not treated as offline", () => {
        expect(getDepartureHomeConnectionIssue(
            new Error("Network Error")
        )).toBe("error");
    });
});
