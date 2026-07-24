import React from "react";
import { Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import {
    getDepartureReadySchedules,
    getScheduleDepartureStatus,
    type ScheduleDepartureStatus,
} from "../src/api/schedule";
import { selectNextDeparture } from "../src/modules/schedule/nextDeparture";
import type { ScheduleItem } from "../src/modules/schedule/types";
import { useNextDepartureHome } from "../src/modules/schedule/useNextDepartureHome";

jest.mock("../src/api/schedule", () => ({
    getDepartureReadySchedules: jest.fn(),
    getScheduleDepartureStatus: jest.fn(),
}));

const mockedGetDepartureReadySchedules = jest.mocked(getDepartureReadySchedules);
const mockedGetScheduleDepartureStatus = jest.mocked(getScheduleDepartureStatus);

function item(id: string, departureMinute: number): ScheduleItem {
    return {
        id,
        title: id,
        startAt: "2099-07-24T10:30:00+09:00",
        endAt: "2099-07-24T11:30:00+09:00",
        departAt: `2099-07-24T10:${String(departureMinute).padStart(2, "0")}:00+09:00`,
        travelMinutes: 30,
        destination: { name: "서울역" },
        category: { id: "test", title: "테스트", color: "#fff" },
    };
}

function status(
    scheduleId: string,
    recommendedDepartureAt: string
): ScheduleDepartureStatus {
    return {
        scheduleId,
        travelMinutes: 30,
        recommendedDepartureAt,
        evaluatedAt: "2099-07-24T09:00:00+09:00",
        liveFetchedAt: "2099-07-24T09:00:00+09:00",
        source: "LIVE_PROVIDER",
        stale: false,
        confidence: "HIGH",
        failureReason: null,
        lastTrafficChangeMinutes: null,
        lastChangedAt: null,
        nextCheckAt: null,
        preparationMinutes: null,
        preparationStartAt: null,
        safetyBufferMinutes: null,
        timeZone: "Asia/Seoul",
    };
}

function Harness({ fallbackItems = [] }: { fallbackItems?: ScheduleItem[] }) {
    const home = useNextDepartureHome({ fallbackItems, focused: true });
    const selected = selectNextDeparture(
        home.items,
        home.statusesByScheduleId,
        new Date("2099-07-24T09:00:00+09:00")
    );
    return (
        <Text testID="snapshot">
            {[
                home.source,
                selected?.item.id ?? "none",
                Object.keys(home.statusesByScheduleId).length,
                home.connectionIssue ?? "connected",
            ].join(":")}
        </Text>
    );
}

async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe("useNextDepartureHome", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(() => {
        act(() => renderer?.unmount());
        renderer = undefined;
        jest.clearAllMocks();
    });

    test("prefetches a bounded candidate range in parallel and reselects from live statuses", async () => {
        const candidates = [
            item("saved-first", 5),
            item("live-first", 10),
            item("third", 15),
            item("fourth", 20),
            item("fifth", 25),
            item("sixth", 30),
            item("outside-prefetch", 35),
        ];
        mockedGetDepartureReadySchedules.mockResolvedValue(candidates);
        mockedGetScheduleDepartureStatus.mockImplementation(async (scheduleId) => {
            if (scheduleId === "saved-first") {
                return status(scheduleId, "2099-07-24T10:40:00+09:00");
            }
            if (scheduleId === "live-first") {
                return status(scheduleId, "2099-07-24T09:50:00+09:00");
            }
            return status(
                scheduleId,
                `2099-07-24T10:${scheduleId === "third" ? "25" : "45"}:00+09:00`
            );
        });

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });

        expect(mockedGetScheduleDepartureStatus).toHaveBeenCalledTimes(6);
        expect(mockedGetScheduleDepartureStatus.mock.calls.map(([id]) => id)).not
            .toContain("outside-prefetch");
        expect(renderer!.root.findByProps({ testID: "snapshot" }).props.children)
            .toBe("departures:live-first:6:connected");
    });

    test("when departure-status is unavailable, saved fields remain and no live source is invented", async () => {
        mockedGetDepartureReadySchedules.mockResolvedValue([
            item("saved-only", 5),
            item("saved-later", 10),
        ]);
        mockedGetScheduleDepartureStatus.mockRejectedValue(
            new Error("Request failed with status code 404")
        );

        await act(async () => {
            renderer = TestRenderer.create(<Harness />);
            await flushAsyncWork();
        });

        expect(mockedGetScheduleDepartureStatus).toHaveBeenCalledTimes(2);
        expect(renderer!.root.findByProps({ testID: "snapshot" }).props.children)
            .toBe("departures:saved-only:0:connected");
    });

    test("departure list network failure falls back to existing calendar data and reports offline", async () => {
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
