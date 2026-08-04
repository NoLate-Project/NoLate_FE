import {
    beginNavigationMeasurement,
    finishNavigationAfterFrames,
    getNavigationPerformanceSnapshot,
    markNavigationRouteReady,
    markNavigationTransitionEnded,
    markNavigationTransitionStarted,
    resetNavigationPerformanceForTests,
    shouldMeasureNavigationAction,
} from "../src/modules/performance/navigationPerformance";

describe("navigationPerformance", () => {
    beforeEach(() => {
        resetNavigationPerformanceForTests();
    });

    it("records route render and transition completion separately", () => {
        beginNavigationMeasurement("PUSH", "/schedule", "/profile", 100, 1_000);
        markNavigationTransitionStarted("/schedule", 110, 1_000);
        const id = markNavigationRouteReady("/profile", 145);

        expect(id).toBe(1);
        expect(finishNavigationAfterFrames(1, 160)).toBe(false);
        expect(markNavigationTransitionEnded(330)).toBe(true);
        expect(getNavigationPerformanceSnapshot().entries).toEqual([
            expect.objectContaining({
                action: "PUSH",
                fromRoute: "/schedule",
                toRoute: "/profile",
                routeReadyMs: 45,
                totalMs: 230,
                completedBy: "transition",
            }),
        ]);
    });

    it("finishes after two frames when the navigator has no transition event", () => {
        const id = beginNavigationMeasurement("REPLACE", "/", "/auth/login", 20, 2_000);
        markNavigationRouteReady("/auth/login", 50);

        expect(finishNavigationAfterFrames(id, 82)).toBe(true);
        expect(getNavigationPerformanceSnapshot().entries[0]).toEqual(
            expect.objectContaining({
                routeReadyMs: 30,
                totalMs: 62,
                completedBy: "frame",
            }),
        );
    });

    it("starts a measurement for gesture navigation", () => {
        markNavigationRouteReady("/profile", 10);
        const id = markNavigationTransitionStarted("/profile", 40, 3_000);
        markNavigationRouteReady("/schedule", 80);
        markNavigationTransitionEnded(240);

        expect(id).toBe(1);
        expect(getNavigationPerformanceSnapshot().entries[0]).toEqual(
            expect.objectContaining({
                action: "GESTURE",
                fromRoute: "/profile",
                toRoute: "/schedule",
                routeReadyMs: 40,
                totalMs: 200,
            }),
        );
    });

    it("does not measure parameter and preload-only actions", () => {
        expect(shouldMeasureNavigationAction("SET_PARAMS")).toBe(false);
        expect(shouldMeasureNavigationAction("PRELOAD")).toBe(false);
        expect(shouldMeasureNavigationAction("PUSH")).toBe(true);
    });
});
