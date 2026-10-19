import { Platform } from "react-native";
import {
    armJourneyEngine, getJourneyEngineSnapshot, normalizeJourneyEngineSnapshot, restoreJourneyEngine,
    stopJourneyEngine, subscribeJourneyEngine, type JourneyEngineInputMode,
} from "../src/modules/journey/journeyEngine";

const mockRemove = jest.fn();
const mockNative = {
    getJourneyEngineSnapshot: jest.fn(), armJourneyEngine: jest.fn(),
    stopJourneyEngine: jest.fn(), restoreJourneyEngine: jest.fn(), addListener: jest.fn(),
};
const mockRequire = jest.fn(() => mockNative);
jest.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => mockRequire() }), { virtual: true });
const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
const originalOS = Platform.OS;
const originalDev = runtime.__DEV__;
const ready = { enabled: true, status: "IDLE", inputMode: "NONE" };

describe("P1 development engine bridge", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        runtime.__DEV__ = true;
        Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
        mockRequire.mockReturnValue(mockNative);
        mockNative.getJourneyEngineSnapshot.mockResolvedValue(ready);
        mockNative.armJourneyEngine.mockResolvedValue({ ...ready, status: "ARMED" });
        mockNative.stopJourneyEngine.mockResolvedValue({ ...ready, status: "STOPPED" });
        mockNative.restoreJourneyEngine.mockResolvedValue({ ...ready, restored: true });
        mockNative.addListener.mockReturnValue({ remove: mockRemove });
    });
    afterEach(() => {
        runtime.__DEV__ = originalDev;
        Object.defineProperty(Platform, "OS", { configurable: true, value: originalOS });
    });

    it("never requests a native module for methods or subscriptions in release", async () => {
        runtime.__DEV__ = false;
        await getJourneyEngineSnapshot();
        await armJourneyEngine("SIMULATOR_LOCATION");
        await restoreJourneyEngine();
        await stopJourneyEngine();
        subscribeJourneyEngine(jest.fn())();
        expect(mockRequire).not.toHaveBeenCalled();
    });

    it("does not load the iOS module on Android", async () => {
        Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
        expect((await getJourneyEngineSnapshot()).reason).toBe("DEVELOPMENT_IOS_ONLY");
        subscribeJourneyEngine(jest.fn())();
        expect(mockRequire).not.toHaveBeenCalled();
    });

    it("only reads readiness without arming or restoring the runtime", async () => {
        expect(await getJourneyEngineSnapshot()).toMatchObject({ enabled: true, status: "IDLE" });
        expect(mockNative.armJourneyEngine).not.toHaveBeenCalled();
        expect(mockNative.restoreJourneyEngine).not.toHaveBeenCalled();
        expect(mockNative.stopJourneyEngine).not.toHaveBeenCalled();
    });

    it("forwards only the two explicit input modes and lifecycle operations", async () => {
        await armJourneyEngine("SIMULATOR_LOCATION");
        await armJourneyEngine("TIMED_REPLAY");
        await restoreJourneyEngine();
        await stopJourneyEngine();
        expect(mockNative.armJourneyEngine.mock.calls).toEqual([["SIMULATOR_LOCATION"], ["TIMED_REPLAY"]]);
        expect(mockNative.restoreJourneyEngine).toHaveBeenCalledTimes(1);
        expect(mockNative.stopJourneyEngine).toHaveBeenCalledTimes(1);
    });

    it("rejects an invalid runtime mode before loading native code", async () => {
        expect((await armJourneyEngine("LIVE_DEVICE" as JourneyEngineInputMode)).reason).toBe("INVALID_INPUT_MODE");
        expect(mockRequire).not.toHaveBeenCalled();
    });

    it("reports an absent module or missing method as requiring a native rebuild", async () => {
        mockRequire.mockReturnValue(null as unknown as typeof mockNative);
        expect((await getJourneyEngineSnapshot()).reason).toBe("NATIVE_REBUILD_REQUIRED");
        mockRequire.mockReturnValue({ ...mockNative, armJourneyEngine: undefined } as unknown as typeof mockNative);
        expect((await armJourneyEngine("TIMED_REPLAY")).reason).toBe("NATIVE_REBUILD_REQUIRED");
    });

    it("does not expose a rejected native exception", async () => {
        mockNative.getJourneyEngineSnapshot.mockRejectedValue(new Error("secret-token latitude=37"));
        const snapshot = await getJourneyEngineSnapshot();
        expect(snapshot.reason).toBe("ENGINE_UNAVAILABLE");
        expect(JSON.stringify(snapshot)).not.toMatch(/secret-token|latitude/);
    });

    it("whitelists fields and rejects malformed codes and numeric metrics", () => {
        const snapshot = normalizeJourneyEngineSnapshot({
            ...ready, coordinates: [37.5, 127], token: "secret-token", deviceId: "private-device",
            sequence: -1, evidenceCount: Infinity, departureCount: 2.8, remainingSeconds: Number.MAX_VALUE,
            alongRouteMeters: NaN, crossTrackMeters: -1, qualityReason: "latitude=37.5", lastErrorCode: "secret token",
        });
        expect(snapshot).toMatchObject({
            sequence: 0, evidenceCount: 0, departureCount: 2, remainingSeconds: 0,
            alongRouteMeters: null, crossTrackMeters: null, qualityReason: "UNKNOWN", lastErrorCode: null,
        });
        expect(JSON.stringify(snapshot)).not.toMatch(/coordinates|token|deviceId|latitude|private-device/);
        expect(normalizeJourneyEngineSnapshot({ enabled: true, status: "BOARDED" }).enabled).toBe(false);
        expect(normalizeJourneyEngineSnapshot(null).status).toBe("IDLE");
    });

    it("normalizes event snapshots and only detaches its listener on cleanup", () => {
        const callback = jest.fn();
        const unsubscribe = subscribeJourneyEngine(callback);
        expect(mockNative.addListener).toHaveBeenCalledWith("onJourneyEngineStateChange", expect.any(Function));
        const emit = mockNative.addListener.mock.calls[0][1] as (value: unknown) => void;
        emit({ ...ready, status: "ACTIVE", departureCount: 1, token: "secret" });
        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ status: "ACTIVE", departureCount: 1 }));
        expect(JSON.stringify(callback.mock.calls)).not.toContain("secret");
        unsubscribe();
        unsubscribe();
        emit({ ...ready, status: "STOPPED" });
        expect(callback).toHaveBeenCalledTimes(1);
        expect(mockRemove).toHaveBeenCalledTimes(1);
        expect(mockNative.stopJourneyEngine).not.toHaveBeenCalled();
    });

    it("handles unsupported event subscriptions without exposing native errors", () => {
        mockRequire.mockReturnValue({ ...mockNative, addListener: undefined } as unknown as typeof mockNative);
        expect(() => subscribeJourneyEngine(jest.fn())()).not.toThrow();
        mockRequire.mockReturnValue(mockNative);
        mockNative.addListener.mockImplementationOnce(() => { throw new Error("secret native error"); });
        expect(() => subscribeJourneyEngine(jest.fn())()).not.toThrow();
        expect(mockNative.stopJourneyEngine).not.toHaveBeenCalled();
    });
});
