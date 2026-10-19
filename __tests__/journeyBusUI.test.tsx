import React from "react";
// Arrival polling has its own boundary tests; this suite isolates the existing native bus panel.
jest.mock("../src/modules/journey/JourneyBusArrivalTrial", () => ({ JourneyBusArrivalTrial: () => null }));
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Platform } from "react-native";

import JourneyBusRoute from "../app/internal/journey-bus";
import { JourneyAutomaticTrialPanel } from "../src/modules/journey/JourneySelectedRouteTrial";
import { journeyBusFixtures } from "../src/modules/journey/journeyBusFixtures";
import { normalizeAutomaticJourneySnapshot, type AutomaticJourneySnapshot } from "../src/modules/journey/automaticJourney";
import type { JourneyRouteAssessmentResult } from "../src/modules/journey/journeyRouteAssessment";
import type { useAutomaticJourneyTrial } from "../src/modules/journey/useAutomaticJourneyTrial";

const mockUseTrial = jest.fn();
const mockPrepare = jest.fn();
const mockStop = jest.fn();
const mockRestore = jest.fn();
const mockAssess = jest.fn();
const mockConsent = jest.fn();
const mockReplace = jest.fn();
jest.mock("../src/modules/journey/useAutomaticJourneyTrial", () => ({
    useAutomaticJourneyTrial: (...args: unknown[]) => mockUseTrial(...args),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("expo-router", () => ({ Redirect: "Redirect", useRouter: () => ({ canGoBack: () => false, replace: mockReplace }) }));
jest.mock("../src/api/env", () => ({ getEnv: jest.fn(() => { throw new Error("NO_CREDENTIAL_ACCESS"); }) }));

const ready: AutomaticJourneySnapshot = {
    enabled: true, reason: null, status: "ARMED", sessionId: null, routeRevision: 1,
    alongRouteMeters: null, crossTrackMeters: null, departureCount: 0, quality: "UNKNOWN", qualityReason: "NO_OBSERVATION",
    locationState: "COLLECTING", authorization: "WHEN_IN_USE", pendingDeparture: false, departureAcknowledged: false,
    syncScope: "SANDBOX", remainingSeconds: 600, lastErrorCode: null, checkpointAvailable: true,
    busPhase: "WALKING_TO_STOP", busQuality: "GOOD", busReason: "NO_VEHICLE_MATCH",
    distanceToBoardMeters: 132, busAlongRouteMeters: 0, busLastAccuracyMeters: 20, boardingEvidenceCount: 0, boardingConfirmed: false,
};
const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
const originalDev = runtime.__DEV__;
const originalOS = Platform.OS;

describe("P2-1 first-bus observation UI", () => {
    let renderer: ReactTestRenderer | undefined;
    let trial: ReturnType<typeof useAutomaticJourneyTrial>;
    beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
    beforeEach(() => {
        jest.clearAllMocks();
        runtime.__DEV__ = true;
        Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
        for (const operation of [mockPrepare, mockStop, mockRestore, mockAssess]) operation.mockResolvedValue(undefined);
        trial = {
            snapshot: { ...ready }, sync: { status: "IDLE", paused: false, errorCode: null }, assessment: null,
            consented: false, pending: false, errorCode: null, running: false, eligible: false,
            canAssess: true, canPrepare: false, canRestore: false, setConsented: mockConsent,
            assess: mockAssess, prepare: mockPrepare, restore: mockRestore, stop: mockStop,
            retrySync: jest.fn(async () => undefined), setSyncPaused: jest.fn(), refresh: jest.fn(async () => undefined),
        };
        mockUseTrial.mockImplementation(() => trial);
    });
    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        runtime.__DEV__ = originalDev;
        Object.defineProperty(Platform, "OS", { configurable: true, value: originalOS });
    });
    const render = async (element: React.ReactElement = <JourneyBusRoute />) => {
        await act(async () => { renderer = TestRenderer.create(element); });
        return renderer!;
    };
    const press = async (screen: ReactTestRenderer, id: string) => {
        await act(async () => screen.root.findByProps({ testID: id }).props.onPress());
    };

    it("starts from the unchanged synthetic first-bus fixture in SANDBOX without automatic actions", async () => {
        const screen = await render();
        expect(mockUseTrial).toHaveBeenLastCalledWith(journeyBusFixtures[0].input, "SANDBOX", false);
        expect(screen.root.findByProps({ testID: "automatic-journey-stage" }).props.children.join("")).toContain("P2-2");
        expect(JSON.stringify(screen.toJSON())).toContain("첫 버스 구간만");
        expect(JSON.stringify(screen.toJSON())).toContain("로컬 HTTP 시험 서버");
        expect(mockPrepare).not.toHaveBeenCalled();
        expect(mockAssess).not.toHaveBeenCalled();
        expect(mockRestore).not.toHaveBeenCalled();
        expect(mockStop).not.toHaveBeenCalled();
    });

    it.each([
        ["WALKING_TO_STOP", "승차 정류장으로 이동 관측"],
        ["APPROACHING_STOP", "승차 정류장 접근 관측"],
        ["WAITING", "정류장 주변 대기 관측"],
        ["BOARDING_CANDIDATE", "탑승 후보 관측 · 미확정"],
    ] as const)("shows native %s only as a GPS observation, never as confirmed boarding", async (busPhase, label) => {
        trial.snapshot = { ...ready, status: "ACTIVE", busPhase, boardingEvidenceCount: 4 };
        const screen = await render();
        expect(screen.root.findByProps({ testID: "journey-bus-phase" }).props.children).toBe(label);
        expect(screen.root.findByProps({ testID: "journey-bus-boarding-confirmed" }).props.children).toBe("탑승 미확정 · 차량/노선 매칭 필요");
        expect(screen.root.findByProps({ testID: "journey-bus-boarding-evidence" }).props.children.join("")).toContain("4개");
        expect(mockPrepare).not.toHaveBeenCalled();
    });

    it("renders bus-specific distance independently from the departure walking progress", async () => {
        trial.snapshot = { ...ready, alongRouteMeters: 100, quality: "UNCERTAIN", qualityReason: "OFF_ROUTE", distanceToBoardMeters: 32.4, busAlongRouteMeters: 0.5 };
        const screen = await render();
        expect(screen.root.findByProps({ testID: "journey-bus-board-distance" }).props.children.join("")).toBe("승차 정류장까지 32.4 m");
        expect(screen.root.findByProps({ testID: "journey-bus-route-distance" }).props.children.join("")).toBe("버스 경로상 진행 0.5 m");
        expect(screen.root.findByProps({ testID: "automatic-journey-distance" }).props.children.join("")).toContain("첫 도보 진행 100.0 m");
        expect(screen.root.findByProps({ testID: "automatic-journey-quality" }).props.children.join("")).toContain("첫 도보 품질: UNCERTAIN");
        expect(screen.root.findByProps({ testID: "journey-bus-quality" }).props.children.join("")).toContain("GOOD");
        expect(screen.root.findByProps({ testID: "journey-bus-phase" }).props.children).toBe("승차 정류장으로 이동 관측");
    });

    it("shows the native horizontal accuracy only as a current observation metric", async () => {
        const screen = await render();
        expect(screen.root.findByProps({ testID: "journey-bus-location-accuracy" }).props.children.join("")).toBe("최근 수평 위치 오차 20.0 m");
        expect(screen.root.findByProps({ testID: "journey-bus-boarding-confirmed" }).props.children).toContain("미확정");
    });

    it.each([undefined, null, -1, NaN, Infinity, 100001, "20"])("does not display malformed or missing native accuracy %p", busLastAccuracyMeters => {
        trial.snapshot = normalizeAutomaticJourneySnapshot({ ...ready, busLastAccuracyMeters });
        return render().then(screen => {
            expect(screen.root.findByProps({ testID: "journey-bus-location-accuracy" }).props.children.join("")).toBe("최근 수평 위치 오차 관측 없음");
        });
    });

    it.each(["IDLE", "STOPPED", "EXPIRED"] as const)("hides retained accuracy after the session is %s", async status => {
        trial.snapshot = { ...ready, status };
        const screen = await render();
        expect(screen.root.findByProps({ testID: "journey-bus-location-accuracy" }).props.children.join("")).toBe("최근 수평 위치 오차 관측 없음");
    });

    it("does not present a retained candidate or old distances as current when location is uncertain", async () => {
        trial.snapshot = { ...ready, busPhase: "BOARDING_CANDIDATE", busQuality: "UNCERTAIN", busReason: "STALE_OBSERVATION",
            distanceToBoardMeters: 8, busAlongRouteMeters: 156 };
        const screen = await render();
        expect(screen.root.findByProps({ testID: "journey-bus-phase" }).props.children).toBe("현재 판정 불확실 · 단계 확정 안 함");
        expect(screen.root.findByProps({ testID: "journey-bus-phase-code" }).props.children.join("")).toContain("BOARDING_CANDIDATE");
        expect(screen.root.findByProps({ testID: "journey-bus-board-distance" }).props.children.join("")).toContain("관측 없음");
        expect(screen.root.findByProps({ testID: "journey-bus-route-distance" }).props.children.join("")).toContain("관측 없음");
        expect(screen.root.findByProps({ testID: "journey-bus-location-accuracy" }).props.children.join("")).toBe("최근 수평 위치 오차 관측 없음");
        expect(screen.root.findByProps({ testID: "journey-bus-uncertainty" })).toBeTruthy();
        expect(screen.root.findByProps({ testID: "journey-bus-boarding-confirmed" }).props.children).toContain("미확정");
    });

    it("shows unavailable bus geometry without falsely cancelling or confirming departure", async () => {
        trial.snapshot = { ...ready, status: "ACTIVE", departureCount: 1, busPhase: "UNAVAILABLE", busQuality: "UNAVAILABLE",
            busReason: "BUS_GEOMETRY_UNUSABLE", distanceToBoardMeters: null, busAlongRouteMeters: null };
        const screen = await render();
        expect(screen.root.findByProps({ testID: "automatic-journey-status" }).props.children).toBe("ACTIVE");
        expect(screen.root.findByProps({ testID: "journey-bus-phase" }).props.children).toBe("버스 관측 사용 불가");
        expect(screen.root.findByProps({ testID: "journey-bus-quality" }).props.children.join("")).toContain("BUS_GEOMETRY_UNUSABLE");
        expect(screen.root.findByProps({ testID: "journey-bus-boarding-confirmed" }).props.children).toContain("미확정");
        expect(mockStop).not.toHaveBeenCalled();
    });

    it("never upgrades a corrupted confirmed flag to a boarding-complete label", async () => {
        trial.snapshot = { ...ready, busPhase: "BOARDING_CANDIDATE", boardingConfirmed: true } as unknown as AutomaticJourneySnapshot;
        const screen = await render();
        expect(screen.root.findByProps({ testID: "journey-bus-boarding-confirmed" }).props.children).toBe("탑승 미확정 · 차량/노선 매칭 필요");
    });

    it("tolerates an older snapshot with missing bus fields without manufacturing an observation", async () => {
        trial.snapshot = { ...ready, busPhase: undefined, busQuality: undefined, busReason: undefined,
            boardingEvidenceCount: undefined, distanceToBoardMeters: undefined, busAlongRouteMeters: undefined };
        const screen = await render();
        expect(screen.root.findByProps({ testID: "journey-bus-phase" }).props.children).toBe("버스 관측 사용 불가");
        expect(screen.root.findByProps({ testID: "journey-bus-boarding-evidence" }).props.children.join("")).toContain("0개");
    });

    it("allows separate first-walk preparation when only the bus geometry is rejected", async () => {
        const input = journeyBusFixtures[1].input;
        trial.assessment = { available: true, summary: {
            schemaVersion: 1, routeRevision: 1, context: "SYNTHETIC_FIXTURE", provider: "tmap", evaluationMode: "READ_ONLY",
            fullAutomaticGuidance: false, fieldValidated: false, eligibleDepartureLegIndex: null,
            reasonCodes: ["SYNTHETIC_FIXTURE_ONLY"], legs: input.legs.map((leg, index) => ({
                index, kind: leg.kind, geometryUsable: index !== 1, geometryLengthMeters: index === 1 ? null : 132,
                stopSequenceUsable: false, directionExplicit: index === 1, rideNavigationEligible: false,
                shapePointCount: leg.coordinates.length, stopCount: leg.stops.length,
                reasonCodes: index === 1 ? ["GEOMETRY_COORDINATE_INVALID"] : [],
            })),
        } } as JourneyRouteAssessmentResult;
        trial.canPrepare = true;
        trial.eligible = true;
        trial.consented = true;
        const screen = await render(<JourneyAutomaticTrialPanel input={input} scope="SANDBOX" stage="P2-1" />);
        expect(screen.root.findByProps({ testID: "journey-bus-geometry" }).props.children).toContain("버스 형상 보완 필요");
        expect(screen.root.findByProps({ testID: "journey-bus-geometry-reasons" }).props.children).toBe("GEOMETRY_COORDINATE_INVALID");
        expect(screen.root.findByProps({ testID: "automatic-journey-prepare" }).props.disabled).toBe(false);
        await press(screen, "automatic-journey-prepare");
        expect(mockPrepare).toHaveBeenCalledTimes(1);
    });

    it("fixture switching passes a different immutable input without starting, stopping, or advancing", async () => {
        const screen = await render();
        await press(screen, "journey-bus-fixture-bus-backtracking-shape");
        expect(mockUseTrial).toHaveBeenLastCalledWith(journeyBusFixtures[2].input, "SANDBOX", false);
        expect(screen.root.findByProps({ testID: "journey-bus-fixture-description" }).props.children).toBe(journeyBusFixtures[2].description);
        expect(mockPrepare).not.toHaveBeenCalled();
        expect(mockStop).not.toHaveBeenCalled();
        expect(mockRestore).not.toHaveBeenCalled();
    });

    it("has explicit preparation/recovery/stop controls but no manual departure or boarding controls", async () => {
        trial.canPrepare = true;
        trial.canRestore = true;
        const screen = await render();
        expect(screen.root.findAllByProps({ testID: "journey-start" })).toHaveLength(0);
        expect(screen.root.findAllByProps({ testID: "journey-advance" })).toHaveLength(0);
        expect(screen.root.findAllByProps({ testID: "journey-bus-board" })).toHaveLength(0);
        await press(screen, "automatic-journey-prepare");
        await press(screen, "automatic-journey-restore");
        await press(screen, "automatic-journey-stop");
        expect(mockPrepare).toHaveBeenCalledTimes(1);
        expect(mockRestore).toHaveBeenCalledTimes(1);
        expect(mockStop).toHaveBeenCalledTimes(1);
    });

    it("closing the screen does not stop the native observation", async () => {
        const screen = await render();
        await press(screen, "journey-bus-close");
        expect(mockReplace).toHaveBeenCalledWith("/schedule");
        expect(mockStop).not.toHaveBeenCalled();
    });

    it("keeps the default P1-3 panel caption and hides bus observation UI", async () => {
        const screen = await render(<JourneyAutomaticTrialPanel input={journeyBusFixtures[0].input} scope="SANDBOX" />);
        expect(screen.root.findByProps({ testID: "automatic-journey-stage" }).props.children.join("")).toContain("P1-3");
        expect(screen.root.findAllByProps({ testID: "journey-bus-observation" })).toHaveLength(0);
        expect(JSON.stringify(screen.toJSON())).toContain("탑승/하차·음성 미지원");
    });

    it.each(["release", "android"])("does not mount the development bus screen in %s", async variant => {
        if (variant === "release") runtime.__DEV__ = false;
        else Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
        const screen = await render();
        expect(screen.root.findByType("Redirect" as React.ElementType).props.href).toBe("/schedule");
        expect(mockUseTrial).not.toHaveBeenCalled();
    });
});
