import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import JourneyDiagnosticsRoute from "../app/internal/journey-diagnostics";
import { normalizeJourneyDiagnostics } from "../src/modules/journey/journeyDiagnostics";

const mockGet = jest.fn();
const mockStart = jest.fn();
const mockStop = jest.fn();
const mockSpeak = jest.fn();
const mockReplace = jest.fn();
jest.mock("../src/modules/journey/journeyDiagnostics", () => ({
    ...jest.requireActual("../src/modules/journey/journeyDiagnostics"),
    getJourneyDiagnostics: () => mockGet(), startJourneyLocationProbe: () => mockStart(),
    stopJourneyLocationProbe: () => mockStop(), speakJourneyProbe: (mode: string) => mockSpeak(mode),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("expo-router", () => ({
    Redirect: "Redirect", useRouter: () => ({ canGoBack: () => false, replace: mockReplace }),
}));
const ready = normalizeJourneyDiagnostics({ enabled: true, location: { state: "IDLE" } });

describe("P0 diagnostics screen", () => {
    let renderer: ReactTestRenderer | undefined;
    beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
    beforeEach(() => {
        jest.useFakeTimers(); jest.clearAllMocks();
        mockGet.mockResolvedValue(ready); mockStart.mockResolvedValue(ready);
        mockStop.mockResolvedValue(ready); mockSpeak.mockResolvedValue(ready);
    });
    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined; jest.useRealTimers();
    });
    const render = async () => {
        await act(async () => { renderer = TestRenderer.create(<JourneyDiagnosticsRoute />); });
        return renderer!;
    };
    it("shows readiness without starting tracking or claiming APNs success", async () => {
        const screen = await render();
        expect(mockStart).not.toHaveBeenCalled();
        expect(mockSpeak).not.toHaveBeenCalled();
        expect(JSON.stringify(screen.toJSON())).toContain("실제 APNs 전달: 미검증");
        expect(screen.root.findAllByProps({ testID: "journey-advance" })).toHaveLength(0);
    });
    it("renders only observed native sample counts after explicit start", async () => {
        mockStart.mockResolvedValue(normalizeJourneyDiagnostics({ enabled: true, location: { state: "RUNNING", totalSamples: 8, foregroundSamples: 3, backgroundSamples: 5 } }));
        const screen = await render();
        await act(async () => screen.root.findByProps({ testID: "journey-probe-start" }).props.onPress());
        expect(mockStart).toHaveBeenCalledTimes(1);
        expect(screen.root.findByProps({ testID: "journey-location-counts" }).props.children.join("")).toBe("전체 8 · 전경 3 · 배경 5");
    });
    it("forwards speech mode and explains lock playback can ignore silent mode", async () => {
        const screen = await render();
        await act(async () => screen.root.findByProps({ testID: "journey-probe-lock" }).props.onPress());
        expect(mockSpeak).toHaveBeenCalledWith("LOCK_SCREEN");
        expect(JSON.stringify(screen.toJSON())).toContain("기기 무음 모드에서도 소리가 날 수 있습니다");
    });
    it("stops probes when leaving the diagnostics screen", async () => {
        const screen = await render();
        await act(async () => screen.root.findByProps({ accessibilityLabel: "진단 종료하고 닫기" }).props.onPress());
        expect(mockStop).toHaveBeenCalled();
        expect(mockReplace).toHaveBeenCalledWith("/schedule");
    });
    it("does not enable actions when the native development build is absent", async () => {
        mockGet.mockResolvedValue(normalizeJourneyDiagnostics({ reason: "NATIVE_REBUILD_REQUIRED" }));
        const screen = await render();
        expect(screen.root.findByProps({ testID: "journey-probe-start" }).props.disabled).toBe(true);
    });
});
