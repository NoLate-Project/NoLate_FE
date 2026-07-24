import React from "react";
import { Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import {
    getDepartureReadySchedules,
    getSchedule,
    getScheduleDepartureStatus,
    type ScheduleDepartureStatus,
} from "../src/api/schedule";
import { ApiResponseError } from "../src/api/response";
import { getAuthMember } from "../src/modules/auth/authStorage";
import { selectNextDeparture } from "../src/modules/schedule/nextDeparture";
import type { ScheduleItem } from "../src/modules/schedule/types";
import {
    getDepartureHomeRange,
    useNextDepartureHome,
} from "../src/modules/schedule/useNextDepartureHome";

jest.mock("../src/api/schedule", () => ({
    getDepartureReadySchedules: jest.fn(),
    getSchedule: jest.fn(),
    getScheduleDepartureStatus: jest.fn(),
}));

jest.mock("../src/modules/auth/authStorage", () => ({
    getAuthMember: jest.fn(),
}));

const mockedGetDepartureReadySchedules = jest.mocked(getDepartureReadySchedules);
const mockedGetSchedule = jest.mocked(getSchedule);
const mockedGetScheduleDepartureStatus = jest.mocked(getScheduleDepartureStatus);
const mockedGetAuthMember = jest.mocked(getAuthMember);
const SYSTEM_NOW = new Date("2099-07-24T09:00:00+09:00");

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

function Harness({ fallbackItems = [] }: { fallbackItems?: ScheduleItem[] }) {
    const home = useNextDepartureHome({ fallbackItems, focused: true });
    const selected = selectNextDeparture(
        home.items,
        home.statusesByScheduleId,
        new Date(),
        home.currentMemberId
    );
    const issue = home.connectionIssue
        ?? (selected
            ? home.statusIssuesByScheduleId[selected.item.id] ?? null
            : null);
    return (
        <Text testID="snapshot">
            {[
                home.source,
                selected?.item.id ?? "none",
                Object.keys(home.statusesByScheduleId).length,
                issue ?? "connected",
            ].join(":")}
        </Text>
    );
}

async function flushAsyncWork() {
    for (let index = 0; index < 24; index += 1) {
        await Promise.resolve();
    }
}

function mockDetails(items: ScheduleItem[]) {
    const byId = new Map(items.map((schedule) => [schedule.id, schedule]));
    mockedGetSchedule.mockImplementation(async (scheduleId) => byId.get(scheduleId)!);
}

describe("useNextDepartureHome", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(SYSTEM_NOW);
        mockedGetDepartureReadySchedules.mockReset();
        mockedGetSchedule.mockReset();
        mockedGetScheduleDepartureStatus.mockReset();
        mockedGetAuthMember.mockReset();
        mockedGetAuthMember.mockResolvedValue({ id: 2 });
    });

    afterEach(() => {
        act(() => renderer?.unmount());
        renderer = undefined;
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    test("checks every in-range candidate with bounded concurrency and lets the seventh live result win", async () => {
        const candidates = [
            item("saved-first", 5),
            item("second", 10),
            item("third", 15),
            item("fourth", 20),
            item("fifth", 25),
            item("sixth", 30),
            item("live-seventh", 35),
        ];
        mockedGetDepartureReadySchedules.mockResolvedValue(candidates);
        mockDetails(candidates);

        let activeRequests = 0;
        let maxActiveRequests = 0;
        const track = async <T,>(value: T): Promise<T> => {
            activeRequests += 1;
            maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
            await Promise.resolve();
            activeRequests -= 1;
            return value;
        };
        mockedGetSchedule.mockImplementation(async (scheduleId) => (
            track(candidates.find(({ id }) => id === scheduleId)!)
        ));
        mockedGetScheduleDepartureStatus.mockImplementation(async (scheduleId) => (
            track(status(
                scheduleId,
                scheduleId === "live-seventh"
                    ? "2099-07-24T09:05:00+09:00"
                    : "2099-07-24T10:45:00+09:00"
            ))
        ));

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });

        expect(mockedGetScheduleDepartureStatus).toHaveBeenCalledTimes(7);
        expect(mockedGetSchedule).toHaveBeenCalledTimes(7);
        expect(maxActiveRequests).toBeGreaterThan(1);
        expect(maxActiveRequests).toBeLessThanOrEqual(4);
        expect(renderer!.root.findByProps({ testID: "snapshot" }).props.children)
            .toBe("departures:live-seventh:7:connected");
    });

    test("passes an explicit grace window so an already-started active schedule remains eligible", async () => {
        const active = item("active-past", 0, {
            startAt: "2099-07-24T08:00:00+09:00",
            endAt: "2099-07-24T10:00:00+09:00",
            departAt: "2099-07-24T08:45:00+09:00",
        });
        mockedGetDepartureReadySchedules.mockResolvedValue([active]);
        mockDetails([active]);
        mockedGetScheduleDepartureStatus.mockResolvedValue(status(
            active.id,
            "2099-07-24T08:45:00+09:00"
        ));

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });

        const range = getDepartureHomeRange(SYSTEM_NOW);
        expect(mockedGetDepartureReadySchedules).toHaveBeenCalledWith(
            range.fromAt,
            range.toAt
        );
        expect(new Date(range.fromAt).getTime()).toBeLessThan(
            new Date(active.startAt).getTime()
        );
        expect(renderer!.root.findByProps({ testID: "snapshot" }).props.children)
            .toBe("departures:active-past:1:connected");
    });

    test("detail verification removes a shared schedule completed by the current user", async () => {
        const sharedListItem = item("shared", 10, {
            ownerMemberId: 1,
            departedAt: "2099-07-24T08:50:00+09:00",
        });
        mockedGetDepartureReadySchedules.mockResolvedValue([sharedListItem]);
        mockedGetSchedule.mockResolvedValue({
            ...sharedListItem,
            myDepartedAt: "2099-07-24T08:55:00+09:00",
        });
        mockedGetScheduleDepartureStatus.mockResolvedValue(status(
            sharedListItem.id,
            "2099-07-24T10:10:00+09:00"
        ));

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });

        expect(mockedGetSchedule).toHaveBeenCalledWith("shared");
        expect(renderer!.root.findByProps({ testID: "snapshot" }).props.children)
            .toBe("departures:none:1:connected");
    });

    test("404/501 status rollout fallback keeps saved data without claiming a connection error", async () => {
        const candidate = item("saved-only", 5);
        mockedGetDepartureReadySchedules.mockResolvedValue([candidate]);
        mockDetails([candidate]);
        mockedGetScheduleDepartureStatus.mockRejectedValue(
            new ApiResponseError("not deployed", { status: 404 })
        );

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });

        expect(renderer!.root.findByProps({ testID: "snapshot" }).props.children)
            .toBe("departures:saved-only:0:connected");
    });

    test.each([
        [new Error("Network Error"), "offline"],
        [new ApiResponseError("service unavailable", { status: 503 }), "error"],
    ] as const)(
        "status failure %p degrades the selected candidate to %s",
        async (failure, expectedIssue) => {
            const candidate = item("degraded", 5);
            mockedGetDepartureReadySchedules.mockResolvedValue([candidate]);
            mockDetails([candidate]);
            mockedGetScheduleDepartureStatus.mockRejectedValue(failure);

            await act(async () => {
                renderer = TestRenderer.create(<Harness />);
                await flushAsyncWork();
            });

            expect(renderer!.root.findByProps({ testID: "snapshot" }).props.children)
                .toBe(`departures:degraded:0:${expectedIssue}`);
        }
    );

    test("nextCheckAt refreshes an open screen without a focus transition", async () => {
        const candidate = item("refreshing", 5);
        mockedGetDepartureReadySchedules.mockResolvedValue([candidate]);
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
        expect(mockedGetDepartureReadySchedules).toHaveBeenCalledTimes(1);

        await act(async () => {
            jest.advanceTimersByTime(2 * 60_000 + 1);
            await flushAsyncWork();
        });

        expect(mockedGetDepartureReadySchedules).toHaveBeenCalledTimes(2);
        expect(mockedGetScheduleDepartureStatus).toHaveBeenCalledTimes(2);
    });

    test("same-screen calendar store changes trigger a hero refresh", async () => {
        const candidate = item("existing", 5);
        mockedGetDepartureReadySchedules.mockResolvedValue([candidate]);
        mockDetails([candidate]);
        mockedGetScheduleDepartureStatus.mockResolvedValue(status(
            candidate.id,
            "2099-07-24T10:05:00+09:00"
        ));

        await act(async () => {
            renderer = TestRenderer.create(
                <Harness fallbackItems={[candidate]} />
            );
            await flushAsyncWork();
        });
        expect(mockedGetDepartureReadySchedules).toHaveBeenCalledTimes(1);

        await act(async () => {
            renderer!.update(
                <Harness fallbackItems={[candidate, item("created", 15)]} />
            );
            await flushAsyncWork();
        });

        expect(mockedGetDepartureReadySchedules).toHaveBeenCalledTimes(2);
    });

    test("departure list network failure falls back to calendar data and reports offline", async () => {
        mockedGetDepartureReadySchedules.mockRejectedValue(new Error("Network Error"));

        await act(async () => {
            renderer = TestRenderer.create(
                <Harness fallbackItems={[item("calendar-fallback", 12)]} />
            );
            await flushAsyncWork();
        });

        expect(mockedGetScheduleDepartureStatus).not.toHaveBeenCalled();
        expect(renderer!.root.findByProps({ testID: "snapshot" }).props.children)
            .toBe("calendar-fallback:calendar-fallback:0:offline");
    });
});
