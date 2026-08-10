const mockOptionalNativeModule = jest.fn();

jest.mock("expo-modules-core", () => ({
    requireOptionalNativeModule: (...args: unknown[]) => mockOptionalNativeModule(...args),
}));

import { Platform } from "react-native";

import {
    endAllLiveActivities,
    endLiveActivity,
    getActiveLiveActivities,
    getLiveActivityCapabilities,
    resetLiveActivityNativeModuleForTests,
    startOrUpdateLiveActivity,
    subscribeLiveActivityEvents,
    type LiveActivityStartOrUpdateInput,
} from "../src/modules/notification/liveActivity";

const validInput: LiveActivityStartOrUpdateInput = {
    scheduleId: "41",
    recipientMemberId: 7,
    generation: 3,
    scheduleTitle: "강남역 미팅",
    destinationName: "강남역",
    scheduleStartAt: "2026-08-06T10:00:00+09:00",
    revision: 1,
    travelMinutes: 36,
    firstWaitMinutes: 6,
    predictedArrivalAt: "2026-08-06T10:00:00+09:00",
    recommendedDepartureAt: "2026-08-06T09:24:00+09:00",
    updatedAt: "2026-08-06T09:00:00+09:00",
    staleAt: "2026-08-06T09:15:00+09:00",
    status: "preparing",
    actionEventKey: `key:${"a".repeat(64)}`,
    actionExpiresAt: "2026-08-06T09:35:00+09:00",
    routeSegments: [
        { kind: "WALK", label: "도보", colorHex: "#9CA3AF" },
        { kind: "BUS", label: "402", colorHex: "#2979FF" },
        { kind: "SUBWAY", label: "2호선", colorHex: "#00B140" },
    ],
};

describe("Live Activity native facade", () => {
    const originalPlatform = Platform.OS;

    beforeEach(() => {
        jest.clearAllMocks();
        resetLiveActivityNativeModuleForTests();
        Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
    });

    afterAll(() => {
        Object.defineProperty(Platform, "OS", {
            configurable: true,
            value: originalPlatform,
        });
    });

    test("is a safe no-op on Android and never resolves the iOS module", async () => {
        Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
        resetLiveActivityNativeModuleForTests();

        await expect(getLiveActivityCapabilities()).resolves.toMatchObject({
            supported: false,
            enabled: false,
            reason: "NATIVE_MODULE_UNAVAILABLE",
        });
        await expect(startOrUpdateLiveActivity(validInput)).resolves.toMatchObject({
            supported: false,
            applied: false,
            operation: "ignored",
        });
        await expect(endLiveActivity({
            scheduleId: "41",
            recipientMemberId: 7,
        })).resolves.toMatchObject({ supported: false, applied: false });
        await expect(endAllLiveActivities()).resolves.toMatchObject({
            supported: false,
            applied: false,
        });
        expect(mockOptionalNativeModule).not.toHaveBeenCalled();
    });

    test("forwards the complete immutable and content state to the native module", async () => {
        const startOrUpdate = jest.fn().mockResolvedValue({
            supported: true,
            applied: true,
            operation: "started",
            activityId: "activity-41",
        });
        mockOptionalNativeModule.mockReturnValue({ startOrUpdate });

        await expect(startOrUpdateLiveActivity(validInput)).resolves.toMatchObject({
            applied: true,
            operation: "started",
            activityId: "activity-41",
        });
        expect(mockOptionalNativeModule).toHaveBeenCalledWith("NoLateLiveActivity");
        expect(startOrUpdate).toHaveBeenCalledWith(expect.objectContaining({
            scheduleStartAt: "2026-08-06T10:00:00+09:00",
            travelMinutes: 36,
            firstWaitMinutes: 6,
            actionExpiresAt: "2026-08-06T09:35:00+09:00",
        }));
    });

    test("accepts lowercase ActivityKit token snapshots and rejects malformed tokens", async () => {
        mockOptionalNativeModule.mockReturnValue({
            getCapabilities: jest.fn().mockResolvedValue({
                supported: true,
                enabled: true,
                canDisplay: true,
                canUpdate: true,
                canStartLocally: false,
                canStartRemotely: true,
                pushToStartSupported: true,
                pushToStartToken: "ab".repeat(32),
            }),
            getActiveActivities: jest.fn().mockResolvedValue([
                {
                    activityId: "activity-41",
                    scheduleId: "41",
                    recipientMemberId: 7,
                    generation: 2,
                    revision: 3,
                    status: "leaveNow",
                    updateToken: "cd".repeat(32),
                },
                {
                    activityId: "activity-invalid",
                    scheduleId: "42",
                    recipientMemberId: 7,
                    generation: 2,
                    revision: 3,
                    status: "leaveNow",
                    updateToken: "UPPERCASE",
                },
            ]),
        });

        await expect(getLiveActivityCapabilities()).resolves.toMatchObject({
            canDisplay: true,
            canUpdate: true,
            canStartLocally: false,
            canStartRemotely: true,
            pushToStartToken: "ab".repeat(32),
        });
        await expect(getActiveLiveActivities()).resolves.toEqual([
            expect.objectContaining({
                activityId: "activity-41",
                updateToken: "cd".repeat(32),
            }),
            expect.not.objectContaining({ updateToken: expect.anything() }),
        ]);
    });

    test("filters invalid native events before they reach account sync", () => {
        const listeners = new Map<string, (event: unknown) => void>();
        const remove = jest.fn();
        mockOptionalNativeModule.mockReturnValue({
            addListener: jest.fn((name: string, listener: (event: unknown) => void) => {
                listeners.set(name, listener);
                return { remove };
            }),
        });
        const onPushToken = jest.fn();
        const onStateChange = jest.fn();
        const unsubscribe = subscribeLiveActivityEvents({ onPushToken, onStateChange });

        listeners.get("onLiveActivityPushToken")?.({
            kind: "update",
            token: "not-hex",
            activityId: "activity-41",
            scheduleId: "41",
            recipientMemberId: 7,
            generation: 3,
        });
        listeners.get("onLiveActivityPushToken")?.({
            kind: "pushToStart",
            token: "aa",
        });
        listeners.get("onLiveActivityPushToken")?.({
            kind: "pushToStart",
            token: "AB".repeat(32),
        });
        listeners.get("onLiveActivityPushToken")?.({
            kind: "pushToStart",
            token: "ab".repeat(251),
        });
        listeners.get("onLiveActivityPushToken")?.({
            kind: "update",
            token: "ef".repeat(32),
            activityId: "activity-41",
            scheduleId: "41",
            recipientMemberId: 7,
            generation: 3,
        });
        listeners.get("onLiveActivityStateChange")?.({
            activityId: "activity-41",
            scheduleId: "41",
            recipientMemberId: 7,
            state: "ended",
        });

        expect(onPushToken).toHaveBeenCalledTimes(1);
        expect(onStateChange).toHaveBeenCalledTimes(1);
        unsubscribe();
        expect(remove).toHaveBeenCalledTimes(2);
    });
});
