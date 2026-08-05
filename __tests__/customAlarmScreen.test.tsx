import React from "react";
import { AppState, Image, Vibration } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import NoLateCustomAlarmScreen from "../src/modules/notification/NoLateCustomAlarmScreen";
import {
    issueNoLateCustomAlarmCapability,
    resetNoLateCustomAlarmCapabilitiesForTests,
} from "../src/modules/notification/customAlarmCapability";
import { parseNoLateCustomAlarmPresentation } from "../src/modules/notification/customAlarmPresentation";

const mockSetMuted = jest.fn();
const mockStopAudio = jest.fn();
const mockStartAudio = jest.fn();
const mockUseKeepAwake = jest.fn();
const mockGetAlarmSoundPreference = jest.fn();
let mockFocusCleanup: (() => void) | undefined;
const originalAppStateCurrentStateDescriptor = Object.getOwnPropertyDescriptor(AppState, "currentState");

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("expo-crypto", () => ({
    randomUUID: jest.fn(() => "11111111-1111-4111-8111-111111111111"),
}));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("expo-keep-awake", () => ({
    useKeepAwake: (...args: unknown[]) => mockUseKeepAwake(...args),
}));
jest.mock("expo-router", () => {
    const ReactModule = jest.requireActual<typeof import("react")>("react");
    return {
        useFocusEffect: (effect: () => void | (() => void)) => {
            ReactModule.useEffect(() => {
                const cleanup = effect() ?? undefined;
                mockFocusCleanup = cleanup;
                return () => {
                    cleanup?.();
                    if (mockFocusCleanup === cleanup) mockFocusCleanup = undefined;
                };
            }, [effect]);
        },
    };
});
jest.mock("../src/modules/notification/customAlarmAudio", () => ({
    startNoLateCustomAlarmAudio: (...args: unknown[]) => mockStartAudio(...args),
}));
jest.mock("../src/modules/notification/customAlarmSounds", () => ({
    getNoLateAlarmSoundPreference: (...args: unknown[]) => mockGetAlarmSoundPreference(...args),
}));

function firstParam(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

function normalizeRequestedAction(value: string | undefined): "open" | "route" | "confirmDeparture" {
    return value === "route" || value === "confirmDeparture" ? value : "open";
}

describe("NoLateCustomAlarmScreen", () => {
    let renderer: ReactTestRenderer | undefined;
    let appStateHandlers: Array<(state: "active" | "background" | "inactive") => void> = [];
    const onClose = jest.fn();
    const onOpenRoute = jest.fn();
    const onCompleteDeparture = jest.fn();

    beforeAll(() => {
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        resetNoLateCustomAlarmCapabilitiesForTests();
        mockFocusCleanup = undefined;
        appStateHandlers = [];
        mockSetMuted.mockReset().mockResolvedValue(undefined);
        mockStopAudio.mockReset().mockResolvedValue(undefined);
        mockStartAudio.mockReset().mockResolvedValue({
            setMuted: mockSetMuted,
            stop: mockStopAudio,
        });
        mockUseKeepAwake.mockReset();
        mockGetAlarmSoundPreference.mockReset().mockResolvedValue("CHIME");
        Object.defineProperty(AppState, "currentState", {
            configurable: true,
            value: "active",
            writable: true,
        });
        jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
            appStateHandlers.push(handler as (state: "active" | "background" | "inactive") => void);
            return { remove: jest.fn() };
        });
        jest.spyOn(Vibration, "vibrate")
            .mockImplementation(() => undefined)
            .mockClear();
        jest.spyOn(Vibration, "cancel")
            .mockImplementation(() => undefined)
            .mockClear();
        onClose.mockReset();
        onOpenRoute.mockReset();
        onCompleteDeparture.mockReset().mockResolvedValue({ status: "completed" });
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.restoreAllMocks();
        resetNoLateCustomAlarmCapabilitiesForTests();
        if (originalAppStateCurrentStateDescriptor) {
            Object.defineProperty(AppState, "currentState", originalAppStateCurrentStateDescriptor);
        }
    });

    async function renderScreen(overrides: Parameters<typeof parseNoLateCustomAlarmPresentation>[0] = {}) {
        const rawAlarmId = firstParam(overrides.alarmId) ?? "schedule:42:member:7";
        const rawScheduleId = firstParam(overrides.scheduleId) ?? "42";
        const requestedAction = normalizeRequestedAction(firstParam(overrides.requestedAction));
        const isPreview =
            firstParam(overrides.isPreview) === "1" ||
            firstParam(overrides.isPreview)?.toLowerCase() === "true" ||
            /^(?:preview|test)(?=$|[:._-])/i.test(rawAlarmId);
        const previewId = isPreview ? "22222222-2222-4222-8222-222222222222" : undefined;
        const authorized = issueNoLateCustomAlarmCapability({
            kind: "customAlarm",
            alarmId: rawAlarmId,
            isPreview,
            requestedAction,
            ...(previewId ? { previewId } : {}),
            scheduleId: rawScheduleId,
            notificationIdentifier: "notification:42",
            ...(!isPreview
                ? {
                      nativeAlarmId: "native:42",
                      recipientMemberId: 7,
                      alarmGeneration: 1,
                      actionEventKey: `key:${"a".repeat(64)}`,
                      occurrenceId: "M0",
                  }
                : {}),
        });
        const presentation = parseNoLateCustomAlarmPresentation({
            type: "NOLATE_CUSTOM_ALARM",
            alarmId: authorized.alarmId,
            capabilityId: authorized.capabilityId,
            notificationIdentifier: authorized.notificationIdentifier,
            previewId: authorized.previewId,
            scheduleId: authorized.scheduleId,
            nativeAlarmId: authorized.nativeAlarmId,
            recipientMemberId: authorized.recipientMemberId?.toString(),
            alarmGeneration: authorized.alarmGeneration?.toString(),
            actionEventKey: authorized.actionEventKey,
            occurrenceId: authorized.occurrenceId,
            isPreview: authorized.isPreview ? "1" : "0",
            requestedAction: authorized.requestedAction,
            title: "지금 출발하세요",
            body: "강남역까지 약 36분 걸려요.",
            routeSummary: "서울역 → 강남역 · 36분",
            ...overrides,
        });
        await act(async () => {
            renderer = TestRenderer.create(
                <NoLateCustomAlarmScreen
                    presentation={presentation}
                    onClose={onClose}
                    onOpenRoute={onOpenRoute}
                    onCompleteDeparture={onCompleteDeparture}
                />,
            );
            await Promise.resolve();
            await Promise.resolve();
        });
        return presentation;
    }

    test("starts the owned app sound, vibration, and keep-awake for a trusted alarm", async () => {
        await renderScreen();

        expect(mockStartAudio).toHaveBeenCalledTimes(1);
        expect(mockStartAudio).toHaveBeenCalledWith("CHIME");
        expect(Vibration.vibrate).toHaveBeenCalledWith([0, 700, 450, 700, 450], true);
        expect(mockUseKeepAwake).toHaveBeenCalledWith("NoLateCustomAlarm");
        expect(renderer!.root.findByProps({ testID: "nolate-custom-alarm-screen" })).toBeTruthy();
        expect(renderer!.root.findByProps({ testID: "nolate-custom-alarm-atmosphere" })).toBeTruthy();
        expect(renderer!.root.findAll(node => node.type === Image)).toHaveLength(1);
        expect(renderer!.root.findAllByProps({ children: "NoLate" })).toHaveLength(0);
        expect(renderer!.root.findByProps({ children: "지금 출발하세요" })).toBeTruthy();
        expect(renderer!.root.findAllByProps({ children: "강남역까지 약 36분 걸려요." })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ children: "서울역 → 강남역 · 36분" })).toHaveLength(0);
        expect(
            renderer!.root.findAll(
                node =>
                    typeof node.props.accessibilityLabel === "string" &&
                    node.props.accessibilityLabel.startsWith("현재 시각 "),
            ),
        ).not.toHaveLength(0);
    });

    test("starts on a notification cold start while AppState is briefly unavailable", async () => {
        Object.defineProperty(AppState, "currentState", {
            configurable: true,
            value: null,
            writable: true,
        });

        await renderScreen();

        expect(mockStartAudio).toHaveBeenCalledTimes(1);
        expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
        expect(mockUseKeepAwake).toHaveBeenCalledWith("NoLateCustomAlarm");
    });

    test("shows the schedule title without a routine information line", async () => {
        await renderScreen({ title: "QA0713A 강남역 이동" });

        expect(
            renderer!.root.findByProps({ testID: "nolate-custom-alarm-schedule-title" }).props.children,
        ).toBe("QA0713A 강남역 이동");
        expect(renderer!.root.findAllByProps({ testID: "nolate-custom-alarm-error" })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ children: "아래에서 지금 출발을 눌러 주세요." })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ children: "아래에서 경로 보기를 눌러 주세요." })).toHaveLength(0);
    });

    test("mutes, unmutes, and stops the active sound", async () => {
        await renderScreen();

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "알람 소리 끄기" }).props.onPress();
            await Promise.resolve();
        });
        expect(mockSetMuted).toHaveBeenLastCalledWith(true);
        expect(Vibration.cancel).not.toHaveBeenCalled();

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "알람 소리 켜기" }).props.onPress();
            await Promise.resolve();
        });
        expect(mockSetMuted).toHaveBeenLastCalledWith(false);

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "알람 끄기" }).props.onPress();
            await Promise.resolve();
        });
        expect(mockStopAudio).toHaveBeenCalledTimes(1);
        expect(Vibration.cancel).toHaveBeenCalledTimes(1);
        expect(renderer!.root.findAllByProps({ children: "알람을 껐어요." })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ testID: "nolate-custom-alarm-error" })).toHaveLength(0);
    });

    test("opens route detail after stopping the alarm sound", async () => {
        await renderScreen();

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "경로 보기" }).props.onPress();
            await Promise.resolve();
        });

        expect(mockStopAudio).toHaveBeenCalledTimes(1);
        expect(Vibration.cancel).toHaveBeenCalledTimes(1);
        expect(onOpenRoute).toHaveBeenCalledWith("42");
    });

    test("records a real departure once and reports success", async () => {
        await renderScreen();
        const departButton = renderer!.root.findByProps({
            accessibilityLabel: "지금 출발 완료",
        });

        await act(async () => {
            departButton.props.onPress();
            departButton.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(onCompleteDeparture).toHaveBeenCalledTimes(1);
        expect(onCompleteDeparture).toHaveBeenCalledWith("42");
        expect(Vibration.cancel).toHaveBeenCalledTimes(1);
        expect(renderer!.root.findByProps({ accessibilityLabel: "지금 출발 완료 기록됨" })).toBeTruthy();
        expect(renderer!.root.findAllByProps({ children: "출발 완료로 기록했어요." })).toHaveLength(0);
    });

    test("reports failure instead of success when departure completion is rejected", async () => {
        onCompleteDeparture.mockResolvedValue({
            status: "rejected",
            reason: "capability-unavailable",
        });
        await renderScreen();

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "지금 출발 완료" }).props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(
            renderer!.root.findAllByProps({
                children: "출발 완료로 기록했어요.",
            }),
        ).toHaveLength(0);
        expect(
            renderer!.root.findByProps({
                children: "출발 완료를 기록하지 못했어요. 잠시 후 다시 시도해 주세요.",
            }),
        ).toBeTruthy();
        expect(renderer!.root.findByProps({ accessibilityLabel: "지금 출발 완료" }).props.accessibilityState).toEqual({
            disabled: false,
        });
    });

    test("keeps preview/test IDs non-mutating even when a real schedule id is present", async () => {
        const presentation = await renderScreen({
            alarmId: "test:preview-1",
            isPreview: "1",
        });

        expect(presentation.canOpenRoute).toBe(true);
        expect(presentation.canCompleteDeparture).toBe(false);
        expect(
            renderer!.root.findAllByProps({
                accessibilityLabel: "지금 출발 완료",
            }),
        ).toHaveLength(0);
        expect(renderer!.root.findByProps({ accessibilityLabel: "알람 끄기" })).toBeTruthy();
        expect(onCompleteDeparture).not.toHaveBeenCalled();
    });

    test("never starts audio, vibration, or keep-awake for untrusted alarm params", async () => {
        await renderScreen({
            type: "WRONG",
            alarmId: "bad id",
            scheduleId: "not-a-schedule",
            title: undefined,
            body: undefined,
            routeSummary: undefined,
        });

        expect(mockStartAudio).not.toHaveBeenCalled();
        expect(Vibration.vibrate).not.toHaveBeenCalled();
        expect(Vibration.cancel).not.toHaveBeenCalled();
        expect(mockUseKeepAwake).not.toHaveBeenCalled();
        expect(renderer!.root.findByProps({ accessibilityRole: "alert" })).toBeTruthy();
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "경로 보기" })).toHaveLength(0);

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "알람 화면 닫기" }).props.onPress();
            await Promise.resolve();
        });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(Vibration.cancel).not.toHaveBeenCalled();
        expect(onCompleteDeparture).not.toHaveBeenCalled();
    });

    test.each(["inactive", "background"] as const)(
        "stops sound and vibration when the app becomes %s",
        async nextState => {
            await renderScreen();

            await act(async () => {
                appStateHandlers.forEach(handler => handler(nextState));
                await Promise.resolve();
            });

            expect(mockStopAudio).toHaveBeenCalledTimes(1);
            expect(Vibration.cancel).toHaveBeenCalledTimes(1);
            expect(renderer!.root.findByProps({ accessibilityLabel: "알람 꺼짐" })).toBeTruthy();
        },
    );

    test("stops sound and vibration when navigation loses focus", async () => {
        await renderScreen();

        await act(async () => {
            mockFocusCleanup?.();
            await Promise.resolve();
        });

        expect(mockStopAudio).toHaveBeenCalledTimes(1);
        expect(Vibration.cancel).toHaveBeenCalledTimes(1);
        expect(renderer!.root.findByProps({ accessibilityLabel: "알람 꺼짐" })).toBeTruthy();
    });

    test("an old screen cleanup cannot cancel a newer screen's vibration", async () => {
        await renderScreen({ alarmId: "schedule:first" });
        const firstRenderer = renderer!;
        await renderScreen({ alarmId: "schedule:second" });
        const secondRenderer = renderer!;

        expect(Vibration.vibrate).toHaveBeenCalledTimes(2);
        expect(Vibration.cancel).toHaveBeenCalledTimes(1);

        await act(async () => firstRenderer.unmount());
        expect(Vibration.cancel).toHaveBeenCalledTimes(1);

        await act(async () => secondRenderer.unmount());
        renderer = undefined;
        expect(Vibration.cancel).toHaveBeenCalledTimes(2);
    });

    test("stops sound and vibration when the alarm screen unmounts", async () => {
        await renderScreen();

        await act(async () => renderer?.unmount());
        renderer = undefined;

        expect(mockStopAudio).toHaveBeenCalledTimes(1);
        expect(Vibration.cancel).toHaveBeenCalledTimes(1);
    });
});
