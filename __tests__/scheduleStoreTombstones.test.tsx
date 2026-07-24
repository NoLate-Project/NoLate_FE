import React from "react";
import { Pressable, Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import { createScheduleInitialState } from "../src/modules/schedule/initialState";
import {
    ScheduleProvider,
    useScheduleStore,
} from "../src/modules/schedule/store";
import type { ScheduleItem } from "../src/modules/schedule/types";

jest.mock("../src/modules/auth/authStorage", () => ({
    subscribeAuthInvalidation: () => () => undefined,
}));

const privateItem: ScheduleItem = {
    id: "private-a",
    title: "비공개 일정",
    startAt: "2099-07-24T10:00:00+09:00",
    endAt: "2099-07-24T11:00:00+09:00",
    routeSetupRequired: true,
    category: { id: "private", title: "개인", color: "#fff" },
};

function Harness() {
    const { state, dispatch, removedItemIds } = useScheduleStore();
    return (
        <>
            <Text testID="state">
                {`${Object.keys(state.itemsById).join(",")}:${[
                    ...removedItemIds,
                ].join(",")}`}
            </Text>
            <Pressable
                testID="delete"
                onPress={() => dispatch({
                    type: "DELETE_ITEM",
                    id: privateItem.id,
                })}
            />
            <Pressable
                testID="late-set"
                onPress={() => dispatch({
                    type: "SET_ITEMS",
                    items: [privateItem],
                })}
            />
            <Pressable
                testID="late-update"
                onPress={() => dispatch({
                    type: "UPDATE_ITEM",
                    item: { ...privateItem, title: "늦은 응답" },
                })}
            />
        </>
    );
}

describe("ScheduleProvider deletion tombstones", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(() => {
        act(() => renderer?.unmount());
        renderer = undefined;
    });

    test("explicit removal blocks late range set/update responses from restoring private data", async () => {
        const initialState = createScheduleInitialState(SYSTEM_NOW);
        initialState.itemsById = { [privateItem.id]: privateItem };
        await act(async () => {
            renderer = TestRenderer.create(
                <ScheduleProvider initialState={initialState}>
                    <Harness />
                </ScheduleProvider>
            );
        });

        await act(async () => {
            renderer!.root.findByProps({ testID: "delete" }).props.onPress();
        });
        expect(renderer!.root.findByProps({ testID: "state" }).props.children)
            .toBe(":private-a");

        await act(async () => {
            renderer!.root.findByProps({ testID: "late-set" }).props.onPress();
            renderer!.root.findByProps({ testID: "late-update" }).props.onPress();
        });
        expect(renderer!.root.findByProps({ testID: "state" }).props.children)
            .toBe(":private-a");
    });
});

const SYSTEM_NOW = new Date("2099-07-24T09:00:00+09:00");
