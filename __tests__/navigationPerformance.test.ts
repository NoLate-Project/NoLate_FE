import {
    beginNavigationMeasurement,
    discardNavigationMeasurement,
    finishNavigationAfterFrames,
    markNavigationRouteReady,
    markNavigationTransitionEnded,
    markNavigationTransitionStarted,
    resetNavigationPerformanceForTests,
    setNavigationPerformanceSink,
} from "../src/modules/performance/navigationPerformance";
import { canonicalizeNavigationRoute } from "../src/modules/performance/navigationPerformanceQueue";

jest.mock("expo-constants", () => ({
    __esModule: true,
    default: {
        nativeApplicationVersion: "1.2.0",
        nativeBuildVersion: "42",
    },
}));

jest.mock("expo-crypto", () => ({
    randomUUID: jest.fn(() => "11111111-1111-4111-8111-111111111111"),
}));

jest.mock("../src/api/performance", () => ({
    postNavigationPerformanceEvents: jest.fn(),
}));

jest.mock("../src/modules/auth/authStorage", () => ({
    getAuthMember: jest.fn(),
}));

describe("navigationPerformance", () => {
    beforeEach(() => resetNavigationPerformanceForTests());

    it("emits the first stable destination frames without waiting for a late native event", () => {
        const sink = jest.fn();
        setNavigationPerformanceSink(sink);
        beginNavigationMeasurement("PUSH", "/schedule", "/profile", 100, 1_000);
        markNavigationTransitionStarted("/schedule", 110, 1_000);
        markNavigationRouteReady("/profile", 145);
        expect(finishNavigationAfterFrames(1, 160)).toBe(true);
        expect(markNavigationTransitionEnded(330)).toBe(false);

        expect(sink).toHaveBeenCalledWith(expect.objectContaining({
            fromRoute: "/schedule",
            toRoute: "/profile",
            routeReadyMs: 45,
            totalMs: 60,
            completedBy: "frame",
        }));
    });

    it("drops a gesture that finishes on the same route", () => {
        const sink = jest.fn();
        setNavigationPerformanceSink(sink);
        markNavigationTransitionStarted("/schedule", 100, 1_000);
        markNavigationRouteReady("/schedule", 120);

        expect(markNavigationTransitionEnded(260)).toBe(false);
        expect(sink).not.toHaveBeenCalled();
    });

    it("drops a stale transition instead of attributing it to the next navigation", () => {
        const sink = jest.fn();
        setNavigationPerformanceSink(sink);
        beginNavigationMeasurement("PUSH", "/schedule", "/profile", 100, 1_000);
        markNavigationTransitionStarted("/schedule", 110, 1_000);
        markNavigationRouteReady("/profile", 150);

        expect(beginNavigationMeasurement("POP", "/profile", "/schedule", 3_000, 3_900)).toBe(2);
        expect(sink).not.toHaveBeenCalled();
    });

    it("drops samples beyond the navigation timeout and supports explicit cleanup", () => {
        const sink = jest.fn();
        setNavigationPerformanceSink(sink);
        beginNavigationMeasurement("PUSH", "/schedule", "/profile", 100, 1_000);
        markNavigationRouteReady("/profile", 150);

        expect(finishNavigationAfterFrames(1, 10_101)).toBe(false);
        expect(sink).not.toHaveBeenCalled();

        const pendingId = beginNavigationMeasurement("PUSH", "/profile", "/notifications", 11_000, 12_000);
        expect(discardNavigationMeasurement(pendingId)).toBe(true);
        expect(discardNavigationMeasurement(pendingId)).toBe(false);
    });

    it("removes identifiers and tokens from persisted route names", () => {
        expect(canonicalizeNavigationRoute("/schedule/739?from=push")).toBe("/schedule/[id]");
        expect(canonicalizeNavigationRoute("/share/private-token#invite")).toBe("/share/[token]");
        expect(canonicalizeNavigationRoute("/schedule/route-select")).toBe("/schedule/route-select");
        expect(canonicalizeNavigationRoute("/future/8c9c1a24-56f0-4af5-89ac-123456789012"))
            .toBe("/future/[id]");
    });
});
