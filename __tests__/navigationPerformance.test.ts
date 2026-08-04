import {
    beginNavigationMeasurement,
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

    it("emits route render and transition duration without rendering UI", () => {
        const sink = jest.fn();
        setNavigationPerformanceSink(sink);
        beginNavigationMeasurement("PUSH", "/schedule", "/profile", 100, 1_000);
        markNavigationTransitionStarted("/schedule", 110, 1_000);
        markNavigationRouteReady("/profile", 145);
        expect(finishNavigationAfterFrames(1, 160)).toBe(false);
        expect(markNavigationTransitionEnded(330)).toBe(true);

        expect(sink).toHaveBeenCalledWith(expect.objectContaining({
            fromRoute: "/schedule",
            toRoute: "/profile",
            routeReadyMs: 45,
            totalMs: 230,
            completedBy: "transition",
        }));
    });

    it("removes identifiers and tokens from persisted route names", () => {
        expect(canonicalizeNavigationRoute("/schedule/739?from=push")).toBe("/schedule/[id]");
        expect(canonicalizeNavigationRoute("/share/private-token#invite")).toBe("/share/[token]");
        expect(canonicalizeNavigationRoute("/schedule/route-select")).toBe("/schedule/route-select");
        expect(canonicalizeNavigationRoute("/future/8c9c1a24-56f0-4af5-89ac-123456789012"))
            .toBe("/future/[id]");
    });
});
