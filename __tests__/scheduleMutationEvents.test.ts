import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import { createScheduleInitialState } from "../src/modules/schedule/initialState";
import {
    emitScheduleMutation,
    subscribeScheduleMutation,
} from "../src/modules/schedule/scheduleMutationEvents";
import { ScheduleProvider, useScheduleStore } from "../src/modules/schedule/store";
import type { ScheduleItem } from "../src/modules/schedule/types";

jest.mock("../src/modules/auth/authStorage", () => ({
    subscribeAuthInvalidation: () => () => undefined,
}));

describe("schedule mutation events", () => {
    test("notifies current subscribers once and stops after unsubscribe", () => {
        const listener = jest.fn();
        const unsubscribe = subscribeScheduleMutation(listener);

        emitScheduleMutation();
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        emitScheduleMutation();
        expect(listener).toHaveBeenCalledTimes(1);
    });

    test("does not fail a successful mutation when a cache listener throws", () => {
        const unsubscribe = subscribeScheduleMutation(() => {
            throw new Error("cache listener failed");
        });

        expect(() => emitScheduleMutation()).not.toThrow();
        unsubscribe();
    });

    test("merges only monotonic departure state without replacing a concurrent schedule edit", async () => {
        const before: ScheduleItem = {
            id: "41",
            title: "동시에 수정한 회의 제목",
            startAt: "2026-08-04T02:00:00.000Z",
            endAt: "2026-08-04T03:00:00.000Z",
            category: { id: "1", title: "업무", color: "#2979FF" },
        };
        const initialState = createScheduleInitialState(new Date(2026, 7, 4));
        initialState.itemsById[before.id] = before;
        let observed: ScheduleItem | undefined;
        let renderer: ReactTestRenderer | undefined;

        function Probe() {
            observed = useScheduleStore().state.itemsById[before.id];
            return null;
        }

        await act(async () => {
            renderer = TestRenderer.create(React.createElement(
                ScheduleProvider,
                { initialState, children: React.createElement(Probe) },
            ));
        });
        expect(observed).toBe(before);

        await act(async () => {
            emitScheduleMutation({
                scheduleId: "41",
                departure: { departedAt: "2026-08-04T01:00:03.000Z" },
            });
        });
        expect(observed).toMatchObject({
            title: "동시에 수정한 회의 제목",
            startAt: before.startAt,
            departedAt: "2026-08-04T01:00:03.000Z",
        });
        expect(observed).not.toBe(before);

        const firstDepartureState = observed;
        await act(async () => {
            emitScheduleMutation({
                scheduleId: "41",
                departure: { departedAt: "2099-01-01T00:00:00.000Z" },
            });
        });
        expect(observed).toBe(firstDepartureState);

        await act(async () => renderer?.unmount());
    });
});
