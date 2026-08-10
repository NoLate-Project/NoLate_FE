jest.mock("../src/api/notification", () => ({
    LIVE_ACTIVITY_SCHEMA_VERSION: 1,
    LIVE_ACTIVITY_TYPE: "NoLateDepartureAttributes",
    registerLiveActivityStartToken: jest.fn(),
    registerLiveActivityUpdateToken: jest.fn(),
    retireLiveActivity: jest.fn(),
    retireLiveActivityStartToken: jest.fn(),
}));

jest.mock("../src/modules/auth/authStorage", () => ({
    getAuthMember: jest.fn().mockResolvedValue(null),
}));

jest.mock("../src/modules/notification/pushDeviceIdentity", () => ({
    getOrCreatePushDeviceId: jest.fn().mockResolvedValue("production-device"),
}));

jest.mock("../src/modules/notification/liveActivity", () => ({
    endAllLiveActivities: jest.fn(),
    endLiveActivity: jest.fn(),
    getActiveLiveActivities: jest.fn(),
    getLiveActivityCapabilities: jest.fn(),
    subscribeLiveActivityEvents: jest.fn(() => jest.fn()),
}));

import {
    createLiveActivitySyncCoordinator,
    type LiveActivitySyncDependencies,
} from "../src/modules/notification/liveActivitySync";
import type {
    LiveActivityCapabilities,
    LiveActivityPushTokenEvent,
    LiveActivityStateChangeEvent,
} from "../src/modules/notification/liveActivity";

const START_TOKEN_A = "aa".repeat(32);
const START_TOKEN_B = "bb".repeat(32);
const UPDATE_TOKEN = "cc".repeat(32);

type NativeHandlers = {
    onPushToken: (event: LiveActivityPushTokenEvent) => void;
    onStateChange: (event: LiveActivityStateChangeEvent) => void;
};

function defaultDependencies(overrides: Partial<LiveActivitySyncDependencies> = {}) {
    let handlers: NativeHandlers | undefined;
    const unsubscribe = jest.fn();
    const dependencies: LiveActivitySyncDependencies = {
        getDeviceId: jest.fn().mockResolvedValue("ios-device-7"),
        getCapabilities: jest.fn().mockResolvedValue({
            supported: true,
            enabled: true,
            canDisplay: true,
            canUpdate: true,
            canStartLocally: false,
            canStartRemotely: true,
            pushToStartSupported: true,
        }),
        getActiveActivities: jest.fn().mockResolvedValue([]),
        subscribeEvents: jest.fn((candidate: NativeHandlers) => {
            handlers = candidate;
            return unsubscribe;
        }),
        registerStartToken: jest.fn().mockResolvedValue(undefined),
        retireStartToken: jest.fn().mockResolvedValue(undefined),
        registerUpdateToken: jest.fn().mockResolvedValue(undefined),
        retireActivity: jest.fn().mockResolvedValue(undefined),
        end: jest.fn().mockResolvedValue({
            supported: true,
            applied: true,
            operation: "ended",
            activityId: "activity-41",
        }),
        endAll: jest.fn().mockResolvedValue({
            supported: true,
            applied: true,
            operation: "endedAll",
            endedCount: 1,
        }),
        ...overrides,
    };
    return {
        dependencies,
        getHandlers: () => {
            if (!handlers) throw new Error("Native event handlers were not subscribed.");
            return handlers;
        },
        unsubscribe,
    };
}

async function flushPromises(rounds = 24): Promise<void> {
    for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

describe("Live Activity account and token sync", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    test("uploads bootstrap snapshots once and keeps schedule/device fences explicit", async () => {
        const { dependencies } = defaultDependencies({
            getCapabilities: jest.fn().mockResolvedValue({
                supported: true,
                enabled: true,
                canDisplay: true,
                canUpdate: true,
                canStartLocally: false,
                canStartRemotely: true,
                pushToStartSupported: true,
                pushToStartToken: START_TOKEN_A,
            }),
            getActiveActivities: jest.fn().mockResolvedValue([{
                activityId: "activity-41",
                scheduleId: "41",
                recipientMemberId: 7,
                generation: 3,
                revision: 1,
                status: "preparing",
                updateToken: UPDATE_TOKEN,
            }]),
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);

        await coordinator.activate(7);
        await coordinator.resume(7);

        expect(dependencies.registerStartToken).toHaveBeenCalledTimes(1);
        expect(dependencies.registerStartToken).toHaveBeenCalledWith({
            deviceId: "ios-device-7",
            activityType: "NoLateDepartureAttributes",
            pushToStartToken: START_TOKEN_A,
            appearance: "light",
            schemaVersion: 1,
        });
        expect(dependencies.registerUpdateToken).toHaveBeenCalledTimes(1);
        expect(dependencies.registerUpdateToken).toHaveBeenCalledWith(
            "activity-41",
            {
                deviceId: "ios-device-7",
                scheduleId: 41,
                generation: 3,
                updateToken: UPDATE_TOKEN,
                schemaVersion: 1,
            },
        );
    });

    test("uses the effective appearance cached before account activation", async () => {
        const { dependencies } = defaultDependencies({
            getCapabilities: jest.fn().mockResolvedValue({
                supported: true,
                enabled: true,
                canDisplay: true,
                canUpdate: true,
                canStartLocally: false,
                canStartRemotely: true,
                pushToStartSupported: true,
                pushToStartToken: START_TOKEN_A,
            }),
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);

        await coordinator.setAppearance("dark");
        await coordinator.activate(7);

        expect(dependencies.registerStartToken).toHaveBeenCalledTimes(1);
        expect(dependencies.registerStartToken).toHaveBeenCalledWith(
            expect.objectContaining({
                pushToStartToken: START_TOKEN_A,
                appearance: "dark",
            }),
        );
    });

    test("keeps an appearance change that races the initial native snapshot", async () => {
        let resolveCapabilities: ((value: LiveActivityCapabilities) => void) | undefined;
        const capabilities = new Promise<LiveActivityCapabilities>((resolve) => {
            resolveCapabilities = resolve;
        });
        const getCapabilities = jest.fn(() => capabilities);
        const { dependencies } = defaultDependencies({ getCapabilities });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);

        const activation = coordinator.activate(7);
        await flushPromises();
        expect(getCapabilities).toHaveBeenCalledTimes(1);

        const appearanceChange = coordinator.setAppearance("dark");
        resolveCapabilities?.({
            supported: true,
            enabled: true,
            canDisplay: true,
            canUpdate: true,
            canStartLocally: false,
            canStartRemotely: true,
            pushToStartSupported: true,
            pushToStartToken: START_TOKEN_A,
        });
        await Promise.all([activation, appearanceChange]);

        expect(dependencies.registerStartToken).toHaveBeenCalledTimes(1);
        expect(dependencies.registerStartToken).toHaveBeenCalledWith(
            expect.objectContaining({ appearance: "dark" }),
        );
    });

    test("re-registers the same start token only when effective appearance changes", async () => {
        const { dependencies } = defaultDependencies({
            getCapabilities: jest.fn().mockResolvedValue({
                supported: true,
                enabled: true,
                canDisplay: true,
                canUpdate: true,
                canStartLocally: false,
                canStartRemotely: true,
                pushToStartSupported: true,
                pushToStartToken: START_TOKEN_A,
            }),
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);

        await coordinator.activate(7);
        await coordinator.setAppearance("light");
        await coordinator.setAppearance("dark");
        await coordinator.setAppearance("dark");

        expect(dependencies.registerStartToken).toHaveBeenCalledTimes(2);
        expect(
            jest.mocked(dependencies.registerStartToken).mock.calls.map(([payload]) => ({
                token: payload.pushToStartToken,
                appearance: payload.appearance,
            })),
        ).toEqual([
            { token: START_TOKEN_A, appearance: "light" },
            { token: START_TOKEN_A, appearance: "dark" },
        ]);
    });

    test("serializes an in-flight registration so the newest appearance is final", async () => {
        let resolveFirst: (() => void) | undefined;
        const firstRequest = new Promise<void>((resolve) => {
            resolveFirst = resolve;
        });
        const registerStartToken = jest.fn()
            .mockReturnValueOnce(firstRequest)
            .mockResolvedValueOnce(undefined);
        const { dependencies } = defaultDependencies({
            getCapabilities: jest.fn().mockResolvedValue({
                supported: true,
                enabled: true,
                canDisplay: true,
                canUpdate: true,
                canStartLocally: false,
                canStartRemotely: true,
                pushToStartSupported: true,
                pushToStartToken: START_TOKEN_A,
            }),
            registerStartToken,
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);

        const activation = coordinator.activate(7);
        await flushPromises();
        expect(registerStartToken).toHaveBeenCalledTimes(1);

        const appearanceChange = coordinator.setAppearance("dark");
        await flushPromises();
        expect(registerStartToken).toHaveBeenCalledTimes(1);

        resolveFirst?.();
        await Promise.all([activation, appearanceChange]);
        await flushPromises();

        expect(registerStartToken).toHaveBeenCalledTimes(2);
        expect(registerStartToken.mock.calls.map(([payload]) => payload.appearance))
            .toEqual(["light", "dark"]);
        expect(registerStartToken).toHaveBeenLastCalledWith(
            expect.objectContaining({
                pushToStartToken: START_TOKEN_A,
                appearance: "dark",
            }),
        );
    });

    test("starts every visible update registration before bootstrap without awaiting retry tails", async () => {
        const order: string[] = [];
        let finishUpdateRegistration: (() => void) | undefined;
        const updateRegistration = new Promise<void>((resolve) => {
            finishUpdateRegistration = resolve;
        });
        const { dependencies } = defaultDependencies({
            getCapabilities: jest.fn().mockResolvedValue({
                supported: true,
                enabled: true,
                canDisplay: true,
                canUpdate: true,
                canStartLocally: false,
                canStartRemotely: true,
                pushToStartSupported: true,
                pushToStartToken: START_TOKEN_A,
            }),
            getActiveActivities: jest.fn().mockResolvedValue([{
                activityId: "activity-41",
                scheduleId: "41",
                recipientMemberId: 7,
                generation: 3,
                revision: 1,
                status: "preparing",
                updateToken: UPDATE_TOKEN,
            }]),
            registerUpdateToken: jest.fn(() => {
                order.push("update");
                return updateRegistration;
            }),
            registerStartToken: jest.fn(async () => {
                order.push("start");
            }),
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);

        const activation = coordinator.activate(7);
        await flushPromises();

        expect(dependencies.registerUpdateToken).toHaveBeenCalledTimes(1);
        expect(dependencies.registerStartToken).toHaveBeenCalledTimes(1);
        expect(order).toEqual(["update", "start"]);
        await activation;

        finishUpdateRegistration?.();
        await flushPromises();

        expect(dependencies.registerStartToken).toHaveBeenCalledWith(
            expect.objectContaining({ pushToStartToken: START_TOKEN_A }),
        );
    });

    test("queues a reconciled update lane before rotated start without awaiting its completion", async () => {
        const order: string[] = [];
        let finishUpdateRegistration: (() => void) | undefined;
        const updateRegistration = new Promise<void>((resolve) => {
            finishUpdateRegistration = resolve;
        });
        const getActiveActivities = jest.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValue([{
                activityId: "activity-41",
                scheduleId: "41",
                recipientMemberId: 7,
                generation: 3,
                revision: 1,
                status: "preparing",
                updateToken: UPDATE_TOKEN,
            }]);
        const { dependencies, getHandlers } = defaultDependencies({
            getCapabilities: jest.fn()
                .mockResolvedValueOnce({
                    supported: true,
                    enabled: true,
                    canDisplay: true,
                    canUpdate: true,
                    canStartLocally: false,
                    canStartRemotely: true,
                    pushToStartSupported: true,
                })
                .mockResolvedValue({
                    supported: true,
                    enabled: true,
                    canDisplay: true,
                    canUpdate: true,
                    canStartLocally: false,
                    canStartRemotely: true,
                    pushToStartSupported: true,
                    pushToStartToken: START_TOKEN_B,
                }),
            getActiveActivities,
            registerUpdateToken: jest.fn(() => {
                order.push("update");
                return updateRegistration;
            }),
            registerStartToken: jest.fn(async () => {
                order.push("start");
            }),
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);
        await coordinator.activate(7);

        getHandlers().onPushToken({ kind: "pushToStart", token: START_TOKEN_B });
        await flushPromises();

        expect(dependencies.registerUpdateToken).toHaveBeenCalledWith(
            "activity-41",
            expect.objectContaining({ updateToken: UPDATE_TOKEN }),
        );
        expect(dependencies.registerStartToken).toHaveBeenCalledTimes(1);
        expect(order).toEqual(["update", "start"]);

        finishUpdateRegistration?.();
        await flushPromises(16);

        expect(dependencies.registerStartToken).toHaveBeenCalledWith(
            expect.objectContaining({ pushToStartToken: START_TOKEN_B }),
        );
    });

    test("a failed orphan update cannot block start registration before background pause", async () => {
        jest.useFakeTimers();
        const registerUpdateToken = jest.fn().mockRejectedValue(new Error("orphan route"));
        const { dependencies } = defaultDependencies({
            getCapabilities: jest.fn().mockResolvedValue({
                supported: true,
                enabled: true,
                canDisplay: true,
                canUpdate: true,
                canStartLocally: false,
                canStartRemotely: true,
                pushToStartSupported: true,
                pushToStartToken: START_TOKEN_A,
            }),
            getActiveActivities: jest.fn().mockResolvedValue([{
                activityId: "orphan-41",
                scheduleId: "41",
                recipientMemberId: 7,
                generation: 3,
                revision: 1,
                status: "preparing",
                updateToken: UPDATE_TOKEN,
            }]),
            registerUpdateToken,
            registrationRetryDelaysMs: [60_000],
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);

        await coordinator.activate(7);
        coordinator.pause();

        expect(registerUpdateToken).toHaveBeenCalledTimes(1);
        expect(dependencies.registerStartToken).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(60_000);
        expect(registerUpdateToken).toHaveBeenCalledTimes(1);
    });

    test("keeps display/update recovery separate from unavailable remote start", async () => {
        const { dependencies } = defaultDependencies({
            getCapabilities: jest.fn().mockResolvedValue({
                supported: true,
                enabled: true,
                canDisplay: true,
                canUpdate: true,
                canStartLocally: false,
                canStartRemotely: false,
                pushToStartSupported: false,
                // A malformed/legacy native snapshot must not bypass the OS-version fence.
                pushToStartToken: START_TOKEN_A,
            }),
            getActiveActivities: jest.fn().mockResolvedValue([{
                activityId: "activity-41",
                scheduleId: "41",
                recipientMemberId: 7,
                generation: 3,
                revision: 1,
                status: "preparing",
                updateToken: UPDATE_TOKEN,
            }]),
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);

        await coordinator.activate(7);

        expect(dependencies.registerStartToken).not.toHaveBeenCalled();
        expect(dependencies.registerUpdateToken).toHaveBeenCalledTimes(1);
    });

    test("serializes token rotation so the newest token is the final write", async () => {
        let resolveFirst: (() => void) | undefined;
        const firstRequest = new Promise<void>((resolve) => {
            resolveFirst = resolve;
        });
        const registerStartToken = jest.fn()
            .mockReturnValueOnce(firstRequest)
            .mockResolvedValueOnce(undefined);
        const { dependencies, getHandlers } = defaultDependencies({ registerStartToken });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);
        await coordinator.activate(7);

        getHandlers().onPushToken({ kind: "pushToStart", token: START_TOKEN_A });
        await flushPromises();
        getHandlers().onPushToken({ kind: "pushToStart", token: START_TOKEN_B });
        await flushPromises();
        expect(registerStartToken).toHaveBeenCalledTimes(1);

        resolveFirst?.();
        await flushPromises();

        expect(registerStartToken).toHaveBeenCalledTimes(2);
        expect(registerStartToken.mock.calls.map(([payload]) => payload.pushToStartToken))
            .toEqual([START_TOKEN_A, START_TOKEN_B]);
    });

    test("retries start-token registration with bounded backoff before reporting failure", async () => {
        jest.useFakeTimers();
        const registrationError = new Error("temporary network outage");
        const registerStartToken = jest.fn().mockRejectedValue(registrationError);
        const onError = jest.fn();
        const { dependencies, getHandlers } = defaultDependencies({
            registerStartToken,
            registrationRetryDelaysMs: [100, 200],
            onError,
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);
        await coordinator.activate(7);

        getHandlers().onPushToken({ kind: "pushToStart", token: START_TOKEN_A });
        await flushPromises();
        expect(registerStartToken).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(99);
        expect(registerStartToken).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(registerStartToken).toHaveBeenCalledTimes(2);
        expect(onError).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(200);
        await flushPromises();
        expect(registerStartToken).toHaveBeenCalledTimes(3);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(
            "[live-activity] start sync failed",
            registrationError,
        );
    });

    test("retries update-token registration with the same generation fence", async () => {
        jest.useFakeTimers();
        const registerUpdateToken = jest.fn()
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce(undefined);
        const { dependencies, getHandlers } = defaultDependencies({
            registerUpdateToken,
            registrationRetryDelaysMs: [100],
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);
        await coordinator.activate(7);

        getHandlers().onPushToken({
            kind: "update",
            token: UPDATE_TOKEN,
            activityId: "activity-41",
            scheduleId: "41",
            recipientMemberId: 7,
            generation: 3,
        });
        await flushPromises();
        expect(registerUpdateToken).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(100);
        await flushPromises();
        expect(registerUpdateToken).toHaveBeenCalledTimes(2);
        expect(registerUpdateToken).toHaveBeenLastCalledWith(
            "activity-41",
            expect.objectContaining({
                scheduleId: 41,
                generation: 3,
                updateToken: UPDATE_TOKEN,
            }),
        );
    });

    test("a newer token cancels the older token retry without waiting for its timer", async () => {
        jest.useFakeTimers();
        const registerStartToken = jest.fn()
            .mockRejectedValueOnce(new Error("first token failed"))
            .mockResolvedValueOnce(undefined);
        const onError = jest.fn();
        const { dependencies, getHandlers } = defaultDependencies({
            registerStartToken,
            registrationRetryDelaysMs: [10_000],
            onError,
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);
        await coordinator.activate(7);

        getHandlers().onPushToken({ kind: "pushToStart", token: START_TOKEN_A });
        await flushPromises();
        expect(registerStartToken).toHaveBeenCalledTimes(1);

        getHandlers().onPushToken({ kind: "pushToStart", token: START_TOKEN_B });
        await flushPromises();

        expect(registerStartToken).toHaveBeenCalledTimes(2);
        expect(registerStartToken.mock.calls.map(([payload]) => payload.pushToStartToken))
            .toEqual([START_TOKEN_A, START_TOKEN_B]);
        expect(onError).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(10_000);
        expect(registerStartToken).toHaveBeenCalledTimes(2);
    });

    test("a newer appearance cancels the older appearance retry for the same token", async () => {
        jest.useFakeTimers();
        const registerStartToken = jest.fn()
            .mockRejectedValueOnce(new Error("light registration failed"))
            .mockResolvedValueOnce(undefined);
        const onError = jest.fn();
        const { dependencies, getHandlers } = defaultDependencies({
            registerStartToken,
            registrationRetryDelaysMs: [10_000],
            onError,
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);
        await coordinator.activate(7);

        getHandlers().onPushToken({ kind: "pushToStart", token: START_TOKEN_A });
        await flushPromises();
        expect(registerStartToken).toHaveBeenCalledTimes(1);

        const appearanceChange = coordinator.setAppearance("dark");
        await flushPromises();
        await appearanceChange;

        expect(registerStartToken).toHaveBeenCalledTimes(2);
        expect(registerStartToken.mock.calls.map(([payload]) => payload.appearance))
            .toEqual(["light", "dark"]);
        expect(onError).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(10_000);
        expect(registerStartToken).toHaveBeenCalledTimes(2);
    });

    test("pause and account cleanup cancel pending registration retries", async () => {
        jest.useFakeTimers();
        const pausedRegistration = jest.fn().mockRejectedValue(new Error("offline"));
        const paused = defaultDependencies({
            registerStartToken: pausedRegistration,
            registrationRetryDelaysMs: [10_000],
        });
        const pausedCoordinator = createLiveActivitySyncCoordinator(paused.dependencies);
        await pausedCoordinator.activate(7);
        paused.getHandlers().onPushToken({ kind: "pushToStart", token: START_TOKEN_A });
        await flushPromises();
        pausedCoordinator.pause();

        const cleanupRegistration = jest.fn().mockRejectedValue(new Error("offline"));
        const cleanup = defaultDependencies({
            registerStartToken: cleanupRegistration,
            registrationRetryDelaysMs: [10_000],
        });
        const cleanupCoordinator = createLiveActivitySyncCoordinator(cleanup.dependencies);
        await cleanupCoordinator.activate(7);
        cleanup.getHandlers().onPushToken({ kind: "pushToStart", token: START_TOKEN_B });
        await flushPromises();
        await cleanupCoordinator.clearForAccount(7);

        await jest.advanceTimersByTimeAsync(10_000);
        expect(pausedRegistration).toHaveBeenCalledTimes(1);
        expect(cleanupRegistration).toHaveBeenCalledTimes(1);
        expect(cleanup.dependencies.retireStartToken).toHaveBeenCalledWith("ios-device-7");
    });

    test("rejects another account's events and fences callbacks after account cleanup", async () => {
        const { dependencies, getHandlers, unsubscribe } = defaultDependencies({
            getActiveActivities: jest.fn().mockResolvedValue([{
                activityId: "activity-41",
                scheduleId: "41",
                recipientMemberId: 7,
                generation: 1,
                revision: 1,
                status: "preparing",
            }]),
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);
        await coordinator.activate(7);
        const staleHandlers = getHandlers();

        staleHandlers.onPushToken({
            kind: "update",
            token: UPDATE_TOKEN,
            activityId: "activity-99",
            scheduleId: "99",
            recipientMemberId: 8,
            generation: 1,
        });
        await flushPromises();
        expect(dependencies.registerUpdateToken).not.toHaveBeenCalled();

        await coordinator.clearForAccount(7);
        staleHandlers.onPushToken({ kind: "pushToStart", token: START_TOKEN_A });
        await flushPromises();

        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(dependencies.endAll).toHaveBeenCalledTimes(1);
        expect(dependencies.retireStartToken).toHaveBeenCalledWith("ios-device-7");
        expect(dependencies.retireActivity).toHaveBeenCalledWith("activity-41", {
            deviceId: "ios-device-7",
            scheduleId: 41,
        });
        expect(dependencies.registerStartToken).not.toHaveBeenCalled();
    });

    test("single-flights cleanup and blocks lifecycle reactivation until retirement finishes", async () => {
        let finishRetirement: (() => void) | undefined;
        const retirement = new Promise<void>((resolve) => {
            finishRetirement = resolve;
        });
        const { dependencies } = defaultDependencies({
            retireStartToken: jest.fn().mockReturnValue(retirement),
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);
        await coordinator.activate(7);

        const firstCleanup = coordinator.clearForAccount(7);
        const duplicateCleanup = coordinator.clearForAccount(7);
        expect(duplicateCleanup).toBe(firstCleanup);
        await flushPromises();

        await expect(coordinator.activate(7)).rejects.toThrow("cleanup is in progress");
        expect(dependencies.retireStartToken).toHaveBeenCalledTimes(1);

        finishRetirement?.();
        await firstCleanup;
        expect(dependencies.endAll).toHaveBeenCalledTimes(1);
    });

    test("blocks a direct account switch when the previous native surface cannot end", async () => {
        const endAll = jest.fn().mockResolvedValue({
            supported: true,
            applied: false,
            operation: "ignored",
            reason: "NATIVE_STATE_ERROR",
        });
        const { dependencies } = defaultDependencies({ endAll });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);
        await coordinator.activate(7);

        await expect(coordinator.activate(8)).rejects.toThrow("NATIVE_STATE_ERROR");

        expect(endAll).toHaveBeenCalledTimes(1);
        expect(dependencies.getDeviceId).toHaveBeenCalledTimes(1);
    });

    test("ignores a late update-token callback from an older schedule generation", async () => {
        const { dependencies, getHandlers } = defaultDependencies({
            getActiveActivities: jest.fn().mockResolvedValue([{
                activityId: "activity-current",
                scheduleId: "41",
                recipientMemberId: 7,
                generation: 4,
                revision: 1,
                status: "preparing",
            }]),
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);
        await coordinator.activate(7);

        getHandlers().onPushToken({
            kind: "update",
            token: "dd".repeat(32),
            activityId: "activity-old",
            scheduleId: "41",
            recipientMemberId: 7,
            generation: 3,
        });
        getHandlers().onPushToken({
            kind: "update",
            token: UPDATE_TOKEN,
            activityId: "activity-current",
            scheduleId: "41",
            recipientMemberId: 7,
            generation: 4,
        });
        await flushPromises();

        expect(dependencies.registerUpdateToken).toHaveBeenCalledTimes(1);
        expect(dependencies.registerUpdateToken).toHaveBeenCalledWith(
            "activity-current",
            expect.objectContaining({ generation: 4, updateToken: UPDATE_TOKEN }),
        );
    });

    test("retires a terminal native activity exactly once", async () => {
        const { dependencies, getHandlers } = defaultDependencies({
            getActiveActivities: jest.fn().mockResolvedValue([{
                activityId: "activity-41",
                scheduleId: "41",
                recipientMemberId: 7,
                generation: 1,
                revision: 1,
                status: "leaveNow",
            }]),
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);
        await coordinator.activate(7);
        const event = {
            activityId: "activity-41",
            scheduleId: "41",
            recipientMemberId: 7,
            state: "ended" as const,
        };

        getHandlers().onStateChange(event);
        getHandlers().onStateChange(event);
        await flushPromises();

        expect(dependencies.retireActivity).toHaveBeenCalledTimes(1);
    });

    test("retries terminal retirement and reconciles an exhausted retirement on foreground", async () => {
        jest.useFakeTimers();
        const retireActivity = jest.fn()
            .mockRejectedValueOnce(new Error("offline-1"))
            .mockRejectedValueOnce(new Error("offline-1"))
            .mockRejectedValueOnce(new Error("offline-2"))
            .mockResolvedValueOnce(undefined);
        const { dependencies, getHandlers } = defaultDependencies({
            retirementRetryDelaysMs: [100],
            retireActivity,
            getActiveActivities: jest.fn().mockResolvedValue([{
                activityId: "activity-41",
                scheduleId: "41",
                recipientMemberId: 7,
                generation: 1,
                revision: 1,
                status: "leaveNow",
                updateToken: UPDATE_TOKEN,
            }]),
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);
        await coordinator.activate(7);
        getHandlers().onStateChange({
            activityId: "activity-41",
            scheduleId: "41",
            recipientMemberId: 7,
            state: "ended",
        });
        await flushPromises();
        expect(retireActivity).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(100);
        await flushPromises();
        expect(retireActivity).toHaveBeenCalledTimes(2);

        coordinator.pause();
        const foregroundReconciliation = coordinator.resume(7);
        await flushPromises();

        expect(retireActivity).toHaveBeenCalledTimes(3);
        expect(dependencies.registerUpdateToken).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(100);
        await foregroundReconciliation;
        expect(retireActivity).toHaveBeenCalledTimes(4);

        // A successful foreground retry clears the pending retirement journal,
        // so another reconciliation cannot re-retire the same Activity.
        await coordinator.resume(7);
        expect(retireActivity).toHaveBeenCalledTimes(4);
    });

    test("retries logout retirement before ending local surfaces", async () => {
        jest.useFakeTimers();
        const order: string[] = [];
        const retireStartToken = jest.fn()
            .mockImplementationOnce(async () => {
                order.push("remote-start-1");
                throw new Error("offline");
            })
            .mockImplementationOnce(async () => {
                order.push("remote-start-2");
            });
        const endAll = jest.fn().mockImplementation(async () => {
            order.push("native-end");
            return {
                supported: true,
                applied: true,
                operation: "endedAll" as const,
                endedCount: 1,
            };
        });
        const { dependencies } = defaultDependencies({
            retirementRetryDelaysMs: [100],
            retireStartToken,
            endAll,
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);
        await coordinator.activate(7);

        const cleanup = coordinator.clearForAccount(7);
        await flushPromises();
        expect(order).toEqual(["remote-start-1"]);
        await jest.advanceTimersByTimeAsync(100);
        await cleanup;

        expect(order).toEqual(["remote-start-1", "remote-start-2", "native-end"]);
    });

    test("still ends local surfaces but rejects logout when remote retirement is exhausted", async () => {
        const failure = new Error("retirement unavailable");
        const { dependencies } = defaultDependencies({
            retirementRetryDelaysMs: [],
            retireStartToken: jest.fn().mockRejectedValue(failure),
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);
        await coordinator.activate(7);

        await expect(coordinator.clearForAccount(7)).rejects.toBe(failure);

        expect(dependencies.endAll).toHaveBeenCalledTimes(1);
    });

    test("retains a failed logout activity retirement after local end for the next cleanup", async () => {
        const failure = new Error("activity retirement unavailable");
        const activity = {
            activityId: "activity-41",
            scheduleId: "41",
            recipientMemberId: 7,
            generation: 1,
            revision: 1,
            status: "leaveNow" as const,
        };
        const retireActivity = jest.fn()
            .mockRejectedValueOnce(failure)
            .mockResolvedValueOnce(undefined);
        const { dependencies } = defaultDependencies({
            retirementRetryDelaysMs: [],
            retireActivity,
            getActiveActivities: jest.fn()
                .mockResolvedValueOnce([activity])
                .mockResolvedValue([]),
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);
        await coordinator.activate(7);

        await expect(coordinator.clearForAccount(7)).rejects.toBe(failure);
        expect(retireActivity).toHaveBeenCalledTimes(1);
        expect(dependencies.endAll).toHaveBeenCalledTimes(1);
        await expect(coordinator.activate(8)).rejects.toThrow(
            "cleanup is required for account 7",
        );

        await expect(coordinator.clearForAccount(7)).resolves.toBeUndefined();
        expect(retireActivity).toHaveBeenCalledTimes(2);
        expect(retireActivity).toHaveBeenLastCalledWith("activity-41", {
            deviceId: "ios-device-7",
            scheduleId: 41,
        });
        expect(dependencies.endAll).toHaveBeenCalledTimes(2);
        await expect(coordinator.activate(8)).resolves.toBeUndefined();
    });

    test("blocks even a native-clean account switch until logout retirement ran", async () => {
        const { dependencies } = defaultDependencies();
        const coordinator = createLiveActivitySyncCoordinator(dependencies);
        await coordinator.activate(7);

        await expect(coordinator.activate(8)).rejects.toThrow("cleanup is required");
        await expect(coordinator.activate(8)).rejects.toThrow("cleanup is required");

        expect(dependencies.endAll).toHaveBeenCalledTimes(1);
        expect(dependencies.getDeviceId).toHaveBeenCalledTimes(1);

        await coordinator.clearForAccount(7);
        await expect(coordinator.activate(8)).resolves.toBeUndefined();
        expect(dependencies.endAll).toHaveBeenCalledTimes(2);
        expect(dependencies.getDeviceId).toHaveBeenCalledTimes(3);
    });

    test("ends and retires a completed schedule idempotently", async () => {
        const { dependencies } = defaultDependencies({
            getActiveActivities: jest.fn().mockResolvedValue([{
                activityId: "activity-41",
                scheduleId: "41",
                recipientMemberId: 7,
                generation: 1,
                revision: 1,
                status: "leaveNow",
            }]),
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);
        await coordinator.activate(7);

        await coordinator.endSchedule("41", 7);
        await coordinator.endSchedule("41", 7);

        expect(dependencies.end).toHaveBeenCalledTimes(1);
        expect(dependencies.end).toHaveBeenCalledWith(expect.objectContaining({
            scheduleId: "41",
            recipientMemberId: 7,
            status: "cancelled",
            dismissalPolicy: "immediate",
        }));
        expect(dependencies.retireActivity).toHaveBeenCalledTimes(1);
    });

    test("does not retire or dedupe a native end failure and allows a retry", async () => {
        const end = jest.fn()
            .mockResolvedValueOnce({
                supported: true,
                applied: false,
                operation: "ignored",
                reason: "INVALID_COMMAND:end status",
            })
            .mockResolvedValueOnce({
                supported: true,
                applied: true,
                operation: "ended",
                activityId: "activity-41",
            });
        const { dependencies } = defaultDependencies({
            end,
            getActiveActivities: jest.fn().mockResolvedValue([{
                activityId: "activity-41",
                scheduleId: "41",
                recipientMemberId: 7,
                generation: 1,
                revision: 1,
                status: "leaveNow",
            }]),
        });
        const coordinator = createLiveActivitySyncCoordinator(dependencies);
        await coordinator.activate(7);

        await expect(coordinator.endSchedule("41", 7)).rejects.toThrow("INVALID_COMMAND");
        expect(dependencies.retireActivity).not.toHaveBeenCalled();

        await expect(coordinator.endSchedule("41", 7)).resolves.toBeUndefined();
        expect(end).toHaveBeenCalledTimes(2);
        expect(dependencies.retireActivity).toHaveBeenCalledTimes(1);
    });
});
