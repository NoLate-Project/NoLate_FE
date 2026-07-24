import React, { useEffect } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import {
    advanceAuthSessionEpoch,
    getAuthSessionEpoch,
} from "../src/modules/auth/authSessionEpoch";
import {
    clearCalendarScheduleCache,
    readCalendarScheduleCache,
    refreshCalendarScheduleCache,
} from "../src/modules/schedule/calendarScheduleCache";
import { createScheduleInitialState } from "../src/modules/schedule/initialState";
import { emitScheduleDepartureMutation } from "../src/modules/schedule/scheduleDepartureMutationEvents";
import { ScheduleProvider, useScheduleStore } from "../src/modules/schedule/store";
import type { ScheduleItem } from "../src/modules/schedule/types";

const RANGE_START = "2026-07-01T00:00:00.000Z";
const RANGE_END = "2026-07-31T23:59:59.999Z";
const schedule: ScheduleItem = {
    id: "42",
    title: "A private",
    startAt: "2026-07-24T01:00:00.000Z",
    endAt: "2026-07-24T02:00:00.000Z",
    category: { id: "1", title: "기본", color: "#1D4ED8" },
};

describe("ScheduleProvider auth generation boundary", () => {
    let renderer: ReactTestRenderer | undefined;
    let latestDispatch: React.Dispatch<any>;
    let latestIds: string[] = [];
    let latestCacheIds: string[] = [];
    let mountCount = 0;

    function Probe() {
        const { state, dispatch } = useScheduleStore();
        latestDispatch = dispatch;
        latestIds = Object.keys(state.itemsById);
        latestCacheIds = readCalendarScheduleCache(RANGE_START, RANGE_END)
            .items.map((item) => item.id);
        useEffect(() => {
            mountCount += 1;
        }, []);
        return null;
    }

    beforeAll(() => {
        (
            globalThis as typeof globalThis & {
                IS_REACT_ACT_ENVIRONMENT: boolean;
            }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(async () => {
        mountCount = 0;
        latestIds = [];
        latestCacheIds = [];
        clearCalendarScheduleCache();
        await refreshCalendarScheduleCache(
            RANGE_START,
            RANGE_END,
            jest.fn().mockResolvedValue([schedule]),
        );
        await act(async () => {
            renderer = TestRenderer.create(
                <ScheduleProvider initialState={createScheduleInitialState()}>
                    <Probe />
                </ScheduleProvider>,
            );
        });
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
    });

    test("account switch clears cache before remount and rejects an old dispatch closure", async () => {
        const oldDispatch = latestDispatch!;
        expect(latestCacheIds).toEqual(["42"]);
        expect(mountCount).toBe(1);

        await act(async () => {
            advanceAuthSessionEpoch();
        });

        expect(mountCount).toBe(2);
        expect(latestCacheIds).toEqual([]);
        await act(async () => {
            oldDispatch({ type: "UPDATE_ITEM", item: schedule });
        });
        expect(latestIds).toEqual([]);

        await act(async () => {
            latestDispatch({ type: "UPDATE_ITEM", item: { ...schedule, title: "B" } });
        });
        expect(latestIds).toEqual(["42"]);
    });

    test("old mutation event cannot reach the new provider or repopulate its cache", async () => {
        const oldEpoch = getAuthSessionEpoch();
        await act(async () => {
            advanceAuthSessionEpoch();
        });

        expect(emitScheduleDepartureMutation({
            authEpoch: oldEpoch,
            kind: "departed",
            scheduleId: "42",
            item: schedule,
        })).toBe(false);
        expect(latestIds).toEqual([]);
        expect(readCalendarScheduleCache(RANGE_START, RANGE_END).items).toEqual([]);
    });

    test("same-session dispatch and mutation event remain active without remount", async () => {
        const epoch = getAuthSessionEpoch();
        const beforeMountCount = mountCount;
        await act(async () => {
            latestDispatch({ type: "UPDATE_ITEM", item: schedule });
        });
        expect(latestIds).toEqual(["42"]);

        await act(async () => {
            emitScheduleDepartureMutation({
                authEpoch: epoch,
                kind: "departed",
                scheduleId: "42",
                item: { ...schedule, title: "departed" },
            });
        });
        expect(mountCount).toBe(beforeMountCount);
        expect(latestIds).toEqual(["42"]);
    });
});
