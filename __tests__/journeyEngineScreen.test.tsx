import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { AppState, type AppStateStatus } from "react-native";
import JourneyEngineRoute from "../app/internal/journey-engine";
import { normalizeJourneyEngineSnapshot, type JourneyEngineSnapshot } from "../src/modules/journey/journeyEngine";

const mockGet = jest.fn();
const mockArm = jest.fn();
const mockStop = jest.fn();
const mockRestore = jest.fn();
const mockSubscribe = jest.fn();
const mockUnsubscribe = jest.fn();
const mockReplace = jest.fn();
const mockApiStart = jest.fn();
const mockApiUpdate = jest.fn();
jest.mock("../src/modules/journey/journeyEngine", () => ({
    ...jest.requireActual("../src/modules/journey/journeyEngine"),
    getJourneyEngineSnapshot: () => mockGet(), armJourneyEngine: (mode: string) => mockArm(mode),
    stopJourneyEngine: () => mockStop(), restoreJourneyEngine: () => mockRestore(),
    subscribeJourneyEngine: (listener: (snapshot: JourneyEngineSnapshot) => void) => mockSubscribe(listener),
}));
jest.mock("../src/api/journey", () => ({ startJourneySession: (...args: unknown[]) => mockApiStart(...args), updateJourneyProgress: (...args: unknown[]) => mockApiUpdate(...args) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("expo-router", () => ({ Redirect: "Redirect", useRouter: () => ({ canGoBack: () => false, replace: mockReplace }) }));
const ready = normalizeJourneyEngineSnapshot({ enabled: true, status: "IDLE", checkpointAvailable: true });
const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
const originalDev = runtime.__DEV__;

describe("P1 engine test screen", () => {
    let renderer: ReactTestRenderer | undefined;
    let emit: (snapshot: JourneyEngineSnapshot) => void;
    let appStateListener: (state: AppStateStatus) => void;
    const removeAppState = jest.fn();
    beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
    beforeEach(() => {
        jest.clearAllMocks();
        runtime.__DEV__ = true;
        mockGet.mockResolvedValue(ready);
        mockArm.mockResolvedValue({ ...ready, status: "ARMED" });
        mockStop.mockResolvedValue({ ...ready, status: "STOPPED" });
        mockRestore.mockResolvedValue({ ...ready, restored: true });
        mockSubscribe.mockImplementation(listener => { emit = listener; return mockUnsubscribe; });
        jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
            appStateListener = listener;
            return { remove: removeAppState };
        });
    });
    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        runtime.__DEV__ = originalDev;
        jest.restoreAllMocks();
    });
    const render = async () => {
        await act(async () => { renderer = TestRenderer.create(<JourneyEngineRoute />); });
        return renderer!;
    };
    const press = async (screen: ReactTestRenderer, id: string) => {
        await act(async () => screen.root.findByProps({ testID: id }).props.onPress());
    };

    it("mounts IDLE and only reads and subscribes without starting any session", async () => {
        const screen = await render();
        expect(screen.root.findByProps({ testID: "journey-engine-status" }).props.children).toBe("IDLE");
        expect(mockGet).toHaveBeenCalledTimes(1);
        expect(mockSubscribe).toHaveBeenCalledTimes(1);
        expect(mockArm).not.toHaveBeenCalled();
        expect(mockRestore).not.toHaveBeenCalled();
        expect(mockApiStart).not.toHaveBeenCalled();
        expect(screen.root.findAllByProps({ testID: "journey-advance" })).toHaveLength(0);
        expect(JSON.stringify(screen.toJSON())).toContain("실제 일정 출발 처리·알람 취소·서버 변경은 없습니다");
    });

    it("requires consent and prepares SIMULATOR_LOCATION without marking departure", async () => {
        const screen = await render();
        expect(screen.root.findByProps({ testID: "journey-engine-arm-location" }).props.disabled).toBe(true);
        await press(screen, "journey-engine-arm-location");
        expect(mockArm).not.toHaveBeenCalled();
        await press(screen, "journey-engine-consent");
        await press(screen, "journey-engine-arm-location");
        expect(mockArm).toHaveBeenCalledWith("SIMULATOR_LOCATION");
        expect(screen.root.findByProps({ testID: "journey-engine-status" }).props.children).toBe("ARMED");
        expect(screen.root.findByProps({ testID: "journey-engine-departure-count" }).props.children.join("")).toBe("자동 출발 감지 0회");
        expect(mockApiStart).not.toHaveBeenCalled();
    });

    it("starts timed replay only through the explicit consented action", async () => {
        const screen = await render();
        await press(screen, "journey-engine-consent");
        await press(screen, "journey-engine-replay");
        expect(mockArm).toHaveBeenCalledWith("TIMED_REPLAY");
        expect(screen.root.findByProps({ testID: "journey-engine-replay" }).props.disabled).toBe(true);
    });

    it("displays native ACTIVE progress events without mutating the server", async () => {
        const screen = await render();
        await act(async () => emit({
            ...ready, status: "ACTIVE", inputMode: "TIMED_REPLAY", departureCount: 1,
            quality: "RELIABLE", qualityReason: "SUSTAINED_MOVEMENT", alongRouteMeters: 92.5,
            crossTrackMeters: 1, evidenceCount: 4, sequence: 5, remainingSeconds: 580,
        }));
        expect(screen.root.findByProps({ testID: "journey-engine-status" }).props.children).toBe("ACTIVE");
        expect(screen.root.findByProps({ testID: "journey-engine-departure-count" }).props.children.join("")).toBe("자동 출발 감지 1회");
        expect(screen.root.findByProps({ testID: "journey-engine-distance" }).props.children.join("")).toContain("92.5 m");
        expect(mockApiStart).not.toHaveBeenCalled();
        expect(mockApiUpdate).not.toHaveBeenCalled();
    });

    it("closes and unmounts subscriptions without stopping the native runtime", async () => {
        const screen = await render();
        await act(async () => emit({ ...ready, status: "ARMED" }));
        await press(screen, "journey-engine-close");
        expect(mockReplace).toHaveBeenCalledWith("/schedule");
        await act(async () => screen.unmount());
        renderer = undefined;
        expect(mockStop).not.toHaveBeenCalled();
        expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
        expect(removeAppState).toHaveBeenCalledTimes(1);
    });

    it("does not stop a consented preparation that completes after the view unmounts", async () => {
        let resolveArm!: (snapshot: JourneyEngineSnapshot) => void;
        mockArm.mockReturnValue(new Promise<JourneyEngineSnapshot>(resolve => { resolveArm = resolve; }));
        const screen = await render();
        await press(screen, "journey-engine-consent");
        await press(screen, "journey-engine-replay");
        await act(async () => screen.unmount());
        renderer = undefined;
        await act(async () => resolveArm({ ...ready, status: "ARMED" }));
        expect(mockStop).not.toHaveBeenCalled();
    });

    it("restores only after consent and stops only from the explicit stop action", async () => {
        const screen = await render();
        expect(mockRestore).not.toHaveBeenCalled();
        await press(screen, "journey-engine-consent");
        await press(screen, "journey-engine-restore");
        expect(mockRestore).toHaveBeenCalledTimes(1);
        await press(screen, "journey-engine-stop");
        expect(mockStop).toHaveBeenCalledTimes(1);
        expect(screen.root.findByProps({ testID: "journey-engine-status" }).props.children).toBe("STOPPED");
    });

    it("refreshes on returning active without arming or restoring a session", async () => {
        await render();
        await act(async () => appStateListener("background"));
        expect(mockGet).toHaveBeenCalledTimes(1);
        await act(async () => appStateListener("active"));
        expect(mockGet).toHaveBeenCalledTimes(2);
        expect(mockArm).not.toHaveBeenCalled();
        expect(mockRestore).not.toHaveBeenCalled();
    });

    it("does not let a late snapshot read overwrite a newer native event", async () => {
        let resolveRead!: (snapshot: JourneyEngineSnapshot) => void;
        mockGet.mockReturnValueOnce(new Promise<JourneyEngineSnapshot>(resolve => { resolveRead = resolve; }));
        const screen = await render();
        await act(async () => emit({ ...ready, status: "ACTIVE", departureCount: 1 }));
        await act(async () => resolveRead(ready));
        expect(screen.root.findByProps({ testID: "journey-engine-status" }).props.children).toBe("ACTIVE");
    });

    it("disables actions when the native development runtime is unavailable", async () => {
        mockGet.mockResolvedValue(normalizeJourneyEngineSnapshot({ reason: "NATIVE_REBUILD_REQUIRED" }));
        const screen = await render();
        await press(screen, "journey-engine-consent");
        expect(screen.root.findByProps({ testID: "journey-engine-arm-location" }).props.disabled).toBe(true);
        expect(screen.root.findByProps({ testID: "journey-engine-stop" }).props.disabled).toBe(true);
    });

    it("does not mount the engine screen in release", async () => {
        runtime.__DEV__ = false;
        await render();
        expect(mockGet).not.toHaveBeenCalled();
        expect(mockSubscribe).not.toHaveBeenCalled();
    });
});
