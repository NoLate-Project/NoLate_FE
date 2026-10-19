import React from "react";
import { AppState, type AppStateStatus } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import type { JourneySession } from "../src/api/journey";
import {
    finishJourneySession,
    getJourneySession,
    startJourneySession,
    updateJourneyProgress,
} from "../src/api/journey";
import { useAuth } from "../src/modules/auth/AuthContext";
import { subscribeAuthInvalidation } from "../src/modules/auth/authStorage";
import { isJourneyGuidanceEnabled } from "../src/modules/journey/journeyFeature";
import { useJourneyGuidance } from "../src/modules/journey/useJourneyGuidance";

jest.mock("../src/api/journey", () => ({
    finishJourneySession: jest.fn(),
    getJourneySession: jest.fn(),
    startJourneySession: jest.fn(),
    updateJourneyProgress: jest.fn(),
    journeyProgressRequest: jest.fn((progress: Record<string, unknown>) => ({
        generation: progress.generation,
        routeRevision: progress.routeRevision,
        sequence: progress.sequence,
        phase: progress.phase,
        activeLegIndex: progress.activeLegIndex,
        currentStopIndex: progress.currentStopIndex,
        remainingStops: progress.remainingStops,
        legProgress: progress.legProgress,
        observedAt: progress.observedAt,
        source: "MANUAL",
    })),
}));
jest.mock("../src/modules/auth/AuthContext", () => ({ useAuth: jest.fn() }));
jest.mock("../src/modules/auth/authStorage", () => ({ subscribeAuthInvalidation: jest.fn() }));
jest.mock("../src/modules/journey/journeyFeature", () => ({ isJourneyGuidanceEnabled: jest.fn() }));
jest.mock("../src/modules/notification/departureAlarmMutationRecovery", () => ({
    recoverDepartureAlarmsAfterMutation: jest.fn(),
}));
jest.mock("../src/modules/notification/pushDeviceIdentity", () => ({
    getOrCreatePushDeviceId: jest.fn(async () => "ios-device-1"),
}));
jest.mock("../src/modules/schedule/scheduleMutationEvents", () => ({ emitScheduleMutation: jest.fn() }));
jest.mock("expo-crypto", () => ({ randomUUID: jest.fn(() => "11111111-1111-4111-8111-111111111111") }));

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function session(scheduleId: string, overrides: Partial<JourneySession> = {}): JourneySession {
    return {
        sessionId: SESSION_ID,
        scheduleId,
        generation: 1,
        routeRevision: 1,
        sequence: 1,
        phase: "WAITING",
        activeLegIndex: 0,
        currentStopIndex: null,
        remainingStops: null,
        legProgress: 0,
        overallProgress: 0,
        nextInstruction: "42번 버스를 기다리세요.",
        observedAt: "2026-10-03T01:00:00.000Z",
        source: "MANUAL",
        startedAt: "2026-10-03T01:00:00.000Z",
        expiresAt: "2026-10-03T03:00:00.000Z",
        routeSnapshot: { transitLegs: [{ kind: "BUS", label: "42번 버스" }] },
        routeLegs: [{
            kind: "BUS",
            label: "42번 버스",
            lineName: "42",
            startName: "시청 정류장",
            endName: "서울역 정류장",
        }],
        ...overrides,
    };
}

function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

describe("useJourneyGuidance lifecycle boundaries", () => {
    let renderer: ReactTestRenderer | undefined;
    let latest: ReturnType<typeof useJourneyGuidance>;
    let authInvalidation: (() => void) | undefined;
    let appStateListener: ((state: AppStateStatus) => void) | undefined;
    let removeAppStateListener: jest.Mock;
    let unsubscribeAuth: jest.Mock;

    function Probe({ scheduleId }: { scheduleId: string }) {
        latest = useJourneyGuidance(scheduleId);
        return null;
    }

    async function flush(): Promise<void> {
        await Promise.resolve();
        await Promise.resolve();
    }

    async function mount(scheduleId = "41") {
        await act(async () => {
            renderer = TestRenderer.create(<Probe scheduleId={scheduleId} />);
            await flush();
        });
    }

    beforeAll(() => {
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(useAuth).mockReturnValue({
            isAuthenticated: true,
            isLoading: false,
        } as ReturnType<typeof useAuth>);
        jest.mocked(isJourneyGuidanceEnabled).mockReturnValue(true);
        jest.mocked(getJourneySession).mockResolvedValue(null);
        removeAppStateListener = jest.fn();
        unsubscribeAuth = jest.fn();
        authInvalidation = undefined;
        appStateListener = undefined;
        jest.mocked(subscribeAuthInvalidation).mockImplementation((listener) => {
            authInvalidation = listener;
            return unsubscribeAuth;
        });
        jest.spyOn(AppState, "addEventListener").mockImplementation(((_event, listener) => {
            appStateListener = listener;
            return { remove: removeAppStateListener };
        }) as typeof AppState.addEventListener);
    });

    afterEach(async () => {
        if (renderer) {
            await act(async () => { renderer?.unmount(); });
            renderer = undefined;
        }
        jest.restoreAllMocks();
    });

    it("feature flag가 꺼져 있으면 API와 lifecycle 구독을 시작하지 않는다", async () => {
        jest.mocked(isJourneyGuidanceEnabled).mockReturnValue(false);

        await mount();

        expect(latest.enabled).toBe(false);
        expect(latest).toMatchObject({ session: null, ready: false, pending: false, error: null });
        expect(getJourneySession).not.toHaveBeenCalled();
        expect(startJourneySession).not.toHaveBeenCalled();
        expect(updateJourneyProgress).not.toHaveBeenCalled();
        expect(finishJourneySession).not.toHaveBeenCalled();
        expect(subscribeAuthInvalidation).not.toHaveBeenCalled();
        expect(AppState.addEventListener).not.toHaveBeenCalled();
    });

    it("인증 무효화 시 즉시 화면과 controller를 비우고 늦은 refresh를 버린다", async () => {
        jest.mocked(getJourneySession).mockResolvedValueOnce(session("41"));
        await mount();
        expect(latest.session?.scheduleId).toBe("41");

        const lateRefresh = deferred<JourneySession | null>();
        jest.mocked(getJourneySession).mockImplementationOnce(() => lateRefresh.promise);
        await act(async () => { appStateListener?.("active"); });
        expect(getJourneySession).toHaveBeenCalledTimes(2);

        await act(async () => { authInvalidation?.(); });
        expect(latest).toMatchObject({ session: null, ready: false, pending: false, error: null });

        await act(async () => {
            await latest.start();
            lateRefresh.resolve(session("41", { sequence: 9, phase: "ALIGHTING" }));
            await flush();
        });

        expect(startJourneySession).not.toHaveBeenCalled();
        expect(latest.session).toBeNull();
        expect(unsubscribeAuth).not.toHaveBeenCalled();
    });

    it("foreground 복귀 시 서버 session을 다시 불러온다", async () => {
        jest.mocked(getJourneySession)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(session("41", { sequence: 3, phase: "ALIGHTING" }));
        await mount();
        expect(latest).toMatchObject({ session: null, ready: true });

        await act(async () => {
            appStateListener?.("background");
            await flush();
        });
        expect(getJourneySession).toHaveBeenCalledTimes(1);

        await act(async () => {
            appStateListener?.("active");
            await flush();
        });

        expect(getJourneySession).toHaveBeenCalledTimes(2);
        expect(latest.session).toMatchObject({ scheduleId: "41", sequence: 3, phase: "ALIGHTING" });
    });

    it("schedule 변경 전 요청의 늦은 응답이 새 일정 화면을 덮지 못한다", async () => {
        const oldRequest = deferred<JourneySession | null>();
        jest.mocked(getJourneySession).mockImplementation((scheduleId) => scheduleId === "41"
            ? oldRequest.promise
            : Promise.resolve(session("42", { sequence: 4, phase: "RIDING" })));

        await mount("41");
        await act(async () => {
            renderer?.update(<Probe scheduleId="42" />);
            await flush();
        });
        expect(latest.session).toMatchObject({ scheduleId: "42", sequence: 4, phase: "RIDING" });

        await act(async () => {
            oldRequest.resolve(session("41", { sequence: 99, phase: "ALIGHTING" }));
            await flush();
        });

        expect(getJourneySession).toHaveBeenCalledWith("41");
        expect(getJourneySession).toHaveBeenCalledWith("42");
        expect(latest.session).toMatchObject({ scheduleId: "42", sequence: 4, phase: "RIDING" });
        expect(unsubscribeAuth).toHaveBeenCalledTimes(1);
        expect(removeAppStateListener).toHaveBeenCalledTimes(1);
    });
});
