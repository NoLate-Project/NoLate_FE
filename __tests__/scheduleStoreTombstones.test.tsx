import React from "react";
import { Pressable, Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import {
    clearCalendarScheduleCache,
    readCalendarScheduleCache,
    resetCalendarScheduleCacheSecurityFence,
    refreshCalendarScheduleCache,
    setCalendarScheduleCacheSecurityFence,
    upsertCalendarScheduleCacheItem,
} from "../src/modules/schedule/calendarScheduleCache";
import { getMonthRange } from "../src/modules/schedule/calendarRange";
import { createScheduleInitialState } from "../src/modules/schedule/initialState";
import {
    ScheduleProvider,
    useScheduleStore,
} from "../src/modules/schedule/store";
import type { ScheduleItem } from "../src/modules/schedule/types";
import {
    activateAuthSessionIfCurrent,
    beginAuthLoginSession,
    getAuthSessionEpoch,
} from "../src/modules/auth/authSessionEpoch";
import { emitScheduleDepartureMutation } from "../src/modules/schedule/scheduleDepartureMutationEvents";
import * as env from "../src/api/env";
import {
    establishScheduleSharingSessionOwner,
} from "../src/modules/share/scheduleSharingSessionOwner";

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
const receivedItem: ScheduleItem = {
    ...privateItem,
    id: "received-a",
    title: "받은 공유 일정",
    ownerMemberId: 99,
    sharePermission: "VIEWER",
    category: {
        id: "received",
        title: "받은 카테고리",
        color: "#16A34A",
        shared: true,
        sharePermission: "VIEWER",
    },
};
const rolloutReceivedItem: ScheduleItem = {
    ...privateItem,
    id: "rollout-received-a",
    title: "플래그 없는 받은 일정",
    ownerMemberId: 99,
};

function Harness() {
    const {
        state,
        dispatch,
        removedItemIds,
        redactedItemIds,
    } = useScheduleStore();
    const agendaItems = Object.values(state.itemsById);
    return (
        <>
            <Text testID="state">
                {`${Object.keys(state.itemsById).join(",")}:${[
                    ...removedItemIds,
                ].join(",")}:${[...redactedItemIds].join(",")}`}
            </Text>
            <Text testID="agenda-input">
                {agendaItems.map((item) => item.id).join(",")}
            </Text>
            <Text testID="route-target">
                {agendaItems.find((item) => item.routeSetupRequired)?.id ?? "none"}
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
            <Pressable
                testID="redact"
                onPress={() => dispatch({
                    type: "REDACT_ITEM",
                    id: privateItem.id,
                })}
            />
            <Pressable
                testID="restore"
                onPress={() => dispatch({
                    type: "RESTORE_ITEM",
                    item: privateItem,
                })}
            />
            <Pressable
                testID="mutation-event"
                onPress={() => emitScheduleDepartureMutation({
                    authEpoch: getAuthSessionEpoch(),
                    kind: "snoozed",
                    scheduleId: privateItem.id,
                    item: { ...privateItem, title: "늦은 authoritative event" },
                    refreshing: false,
                })}
            />
            <Pressable
                testID="received-update"
                onPress={() => dispatch({
                    type: "UPDATE_ITEM",
                    item: rolloutReceivedItem,
                })}
            />
            <Pressable
                testID="received-mutation-event"
                onPress={() => emitScheduleDepartureMutation({
                    authEpoch: getAuthSessionEpoch(),
                    kind: "snoozed",
                    scheduleId: receivedItem.id,
                    item: receivedItem,
                    refreshing: false,
                })}
            />
        </>
    );
}

describe("ScheduleProvider deletion tombstones", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeEach(() => {
        jest.spyOn(env, "getEnv").mockReturnValue("true");
        const authEpoch = beginAuthLoginSession();
        activateAuthSessionIfCurrent(authEpoch);
        resetCalendarScheduleCacheSecurityFence();
        setCalendarScheduleCacheSecurityFence(new Set(), new Set());
        clearCalendarScheduleCache();
    });

    afterEach(() => {
        act(() => renderer?.unmount());
        renderer = undefined;
        jest.restoreAllMocks();
    });

    test("공유 off provider는 warm 받은 일정과 늦은 dispatch/mutation 재유입을 모두 거부한다", async () => {
        jest.spyOn(env, "getEnv").mockReturnValue("false");
        establishScheduleSharingSessionOwner(getAuthSessionEpoch(), 7);
        const initialState = createScheduleInitialState(SYSTEM_NOW);
        initialState.itemsById = {
            [privateItem.id]: privateItem,
            [receivedItem.id]: receivedItem,
            [rolloutReceivedItem.id]: rolloutReceivedItem,
        };
        await act(async () => {
            renderer = TestRenderer.create(
                <ScheduleProvider initialState={initialState}>
                    <Harness />
                </ScheduleProvider>,
            );
        });

        expect(renderer!.root.findByProps({
            testID: "agenda-input",
        }).props.children).toBe(privateItem.id);

        await act(async () => {
            renderer!.root.findByProps({ testID: "received-update" })
                .props.onPress();
            renderer!.root.findByProps({ testID: "received-mutation-event" })
                .props.onPress();
        });

        expect(renderer!.root.findByProps({
            testID: "agenda-input",
        }).props.children).toBe(privateItem.id);
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
            .toBe(":private-a:");

        await act(async () => {
            renderer!.root.findByProps({ testID: "late-set" }).props.onPress();
            renderer!.root.findByProps({ testID: "late-update" }).props.onPress();
        });
        expect(renderer!.root.findByProps({ testID: "state" }).props.children)
            .toBe(":private-a:");
    });

    test("access redaction blocks late range writes but a fenced restore can regrant it", async () => {
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
            renderer!.root.findByProps({ testID: "redact" }).props.onPress();
            renderer!.root.findByProps({ testID: "late-set" }).props.onPress();
            renderer!.root.findByProps({ testID: "late-update" }).props.onPress();
        });
        expect(renderer!.root.findByProps({ testID: "state" }).props.children)
            .toBe("::private-a");
        expect(
            renderer!.root.findByProps({ testID: "agenda-input" }).props.children
        ).toBe("");
        expect(
            renderer!.root.findByProps({ testID: "route-target" }).props.children
        ).toBe("none");

        await act(async () => {
            renderer!.root.findByProps({ testID: "restore" }).props.onPress();
        });
        expect(renderer!.root.findByProps({ testID: "state" }).props.children)
            .toBe("private-a::");
        expect(
            renderer!.root.findByProps({ testID: "agenda-input" }).props.children
        ).toBe("private-a");
        expect(
            renderer!.root.findByProps({ testID: "route-target" }).props.children
        ).toBe("private-a");
    });

    test("access and deletion fences remain exposed when the schedule screen child remounts", async () => {
        const initialState = createScheduleInitialState(SYSTEM_NOW);
        initialState.itemsById = { [privateItem.id]: privateItem };
        await act(async () => {
            renderer = TestRenderer.create(
                <ScheduleProvider initialState={initialState}>
                    <Harness key="first-mount" />
                </ScheduleProvider>
            );
        });

        await act(async () => {
            renderer!.root.findByProps({ testID: "redact" }).props.onPress();
            renderer!.update(
                <ScheduleProvider initialState={initialState}>
                    <Harness key="second-mount" />
                </ScheduleProvider>
            );
        });

        expect(renderer!.root.findByProps({ testID: "state" }).props.children)
            .toBe("::private-a");
        expect(
            renderer!.root.findByProps({ testID: "agenda-input" }).props.children
        ).toBe("");
        expect(
            renderer!.root.findByProps({ testID: "route-target" }).props.children
        ).toBe("none");
    });

    test("a regrant cannot override an explicit user deletion tombstone", async () => {
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
            renderer!.root.findByProps({ testID: "restore" }).props.onPress();
        });
        expect(renderer!.root.findByProps({ testID: "state" }).props.children)
            .toBe(":private-a:");
    });

    test("provider security sets guard cache upserts across redaction, regrant, and deletion", async () => {
        const july = getMonthRange("2099-07-01");
        await refreshCalendarScheduleCache(
            july.startAt,
            july.endAt,
            jest.fn().mockResolvedValue([privateItem])
        );
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
            renderer!.root.findByProps({ testID: "redact" }).props.onPress();
        });
        upsertCalendarScheduleCacheItem(privateItem);
        expect(
            readCalendarScheduleCache(july.startAt, july.endAt).items
        ).toEqual([]);

        await act(async () => {
            renderer!.root.findByProps({ testID: "restore" }).props.onPress();
        });
        upsertCalendarScheduleCacheItem(privateItem);
        expect(
            readCalendarScheduleCache(july.startAt, july.endAt)
                .items.map((item) => item.id)
        ).toEqual([privateItem.id]);

        await act(async () => {
            renderer!.root.findByProps({ testID: "delete" }).props.onPress();
        });
        upsertCalendarScheduleCacheItem(privateItem);
        expect(
            readCalendarScheduleCache(july.startAt, july.endAt).items
        ).toEqual([]);
    });

    test("a mutation event cannot restore a redacted item in either store or cache", async () => {
        const july = getMonthRange("2099-07-01");
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
            renderer!.root.findByProps({ testID: "redact" }).props.onPress();
            renderer!.root.findByProps({ testID: "mutation-event" })
                .props.onPress();
        });

        expect(renderer!.root.findByProps({ testID: "state" }).props.children)
            .toBe("::private-a");
        expect(
            readCalendarScheduleCache(july.startAt, july.endAt).items
        ).toEqual([]);
    });
});

const SYSTEM_NOW = new Date("2099-07-24T09:00:00+09:00");
