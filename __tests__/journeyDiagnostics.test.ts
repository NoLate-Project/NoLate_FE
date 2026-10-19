import { Platform } from "react-native";
import {
    getJourneyDiagnostics, normalizeJourneyDiagnostics, speakJourneyProbe,
    startJourneyLocationProbe, stopJourneyLocationProbe,
} from "../src/modules/journey/journeyDiagnostics";

const mockNative = {
    getJourneyDiagnostics: jest.fn(), startJourneyLocationProbe: jest.fn(),
    stopJourneyLocationProbe: jest.fn(), speakJourneyProbe: jest.fn(),
};
const mockRequire = jest.fn(() => mockNative);
jest.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => mockRequire() }), { virtual: true });
const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
const originalOS = Platform.OS;
const originalDev = runtime.__DEV__;

describe("P0 native diagnostics bridge", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        runtime.__DEV__ = true;
        Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
        mockRequire.mockReturnValue(mockNative);
        Object.values(mockNative).forEach(method => method.mockResolvedValue({ enabled: true }));
    });
    afterEach(() => {
        runtime.__DEV__ = originalDev;
        Object.defineProperty(Platform, "OS", { configurable: true, value: originalOS });
    });

    it("never loads or calls the native module in release", async () => {
        runtime.__DEV__ = false;
        expect((await startJourneyLocationProbe()).enabled).toBe(false);
        await speakJourneyProbe("LOCK_SCREEN");
        await stopJourneyLocationProbe();
        expect(mockRequire).not.toHaveBeenCalled();
    });
    it("does not request an iOS module on Android", async () => {
        Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
        expect((await getJourneyDiagnostics()).reason).toBe("DEVELOPMENT_IOS_ONLY");
        expect(mockRequire).not.toHaveBeenCalled();
    });
    it("does not start probes while reading readiness", async () => {
        expect((await getJourneyDiagnostics()).enabled).toBe(true);
        expect(mockNative.startJourneyLocationProbe).not.toHaveBeenCalled();
        expect(mockNative.speakJourneyProbe).not.toHaveBeenCalled();
    });
    it("forwards only explicit start stop and speech choices", async () => {
        await startJourneyLocationProbe();
        await speakJourneyProbe("RESPECT_SILENT");
        await speakJourneyProbe("LOCK_SCREEN");
        await stopJourneyLocationProbe();
        expect(mockNative.startJourneyLocationProbe).toHaveBeenCalledTimes(1);
        expect(mockNative.speakJourneyProbe.mock.calls).toEqual([["RESPECT_SILENT"], ["LOCK_SCREEN"]]);
        expect(mockNative.stopJourneyLocationProbe).toHaveBeenCalledTimes(1);
    });
    it("handles older native builds and sanitizes errors", async () => {
        mockRequire.mockReturnValue(null as unknown as typeof mockNative);
        expect((await getJourneyDiagnostics()).reason).toBe("NATIVE_REBUILD_REQUIRED");
        mockRequire.mockReturnValue(mockNative);
        mockNative.getJourneyDiagnostics.mockRejectedValue(new Error("sensitive native detail"));
        expect((await getJourneyDiagnostics()).reason).toBe("PROBE_UNAVAILABLE");
    });
    it("does not expose coordinates tokens or infer device silent state", () => {
        const result = normalizeJourneyDiagnostics({
            enabled: true, token: "secret", location: { latitude: 37.5, longitude: 127, totalSamples: 4 },
            speech: { outputMuted: true, hardwareSilentState: "SILENT" },
            liveActivity: { token: "secret", activitiesEnabled: true },
        });
        expect(result.location.totalSamples).toBe(4);
        expect(result.speech.hardwareSilentState).toBe("UNAVAILABLE");
        expect(JSON.stringify(result)).not.toMatch(/secret|latitude|longitude/);
    });
    it("fails closed and normalizes invalid numeric fields", () => {
        expect(normalizeJourneyDiagnostics(null).enabled).toBe(false);
        expect(normalizeJourneyDiagnostics({ enabled: "true", location: { totalSamples: -3, lastAccuracyMeters: NaN } }).location)
            .toMatchObject({ totalSamples: 0, lastAccuracyMeters: null });
    });
});
