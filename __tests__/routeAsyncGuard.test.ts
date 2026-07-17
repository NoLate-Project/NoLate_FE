import {
    canPersistResolvedRoute,
    createLatestRequestGuard,
} from "../src/modules/map/routeAsyncGuard";

describe("route async guard", () => {
    it("accepts only the latest request", () => {
        const guard = createLatestRequestGuard();
        const first = guard.begin();
        const second = guard.begin();

        expect(guard.isCurrent(first)).toBe(false);
        expect(guard.isCurrent(second)).toBe(true);
    });

    it("invalidates a pending request after a manual place edit", () => {
        const guard = createLatestRequestGuard();
        const request = guard.begin();

        guard.invalidate();

        expect(guard.isCurrent(request)).toBe(false);
    });

    it("does not allow an old or unresolved route to be saved", () => {
        expect(canPersistResolvedRoute({
            hasRouteReady: true,
            routeLoading: true,
            hasSelectedRoute: true,
        })).toBe(false);
        expect(canPersistResolvedRoute({
            hasRouteReady: true,
            routeLoading: false,
            hasSelectedRoute: true,
            routeError: "경로 계산 실패",
        })).toBe(false);
        expect(canPersistResolvedRoute({
            hasRouteReady: true,
            routeLoading: false,
            hasSelectedRoute: true,
        })).toBe(true);
    });
});
