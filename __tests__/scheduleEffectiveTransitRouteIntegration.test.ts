const { readFileSync } = require("fs") as {
    readFileSync: (path: string, encoding: string) => string;
};

export {};

const detailSource = readFileSync("app/schedule/[id].tsx", "utf8");

describe("schedule detail effective transit route integration", () => {
    it("loads departure status independently without replacing the saved schedule request", () => {
        expect(detailSource).toContain("getScheduleDepartureStatus(scheduleId)");
        expect(detailSource).toContain("getSchedule(id)");
        expect(detailSource).toContain("보조 ETA 재조회 실패는 저장 일정 조회를 막지 않는다.");
        expect(detailSource).toContain("resolveAcceptedDepartureStatus(status)");
    });

    it("refreshes on focus, foreground activation, and a bounded nextCheckAt timer", () => {
        expect(detailSource).toContain("const isFocused = useIsFocused();");
        expect(detailSource).toContain('AppState.addEventListener("change"');
        expect(detailSource).toContain('appStateStatus === "active"');
        expect(detailSource).toContain("departureStatusRefreshEligibleRef.current");
        expect(detailSource).toContain("getDepartureStatusRefreshDelay({");
        expect(detailSource).toContain("nextCheckAt: departureStatusNextCheckAt");
        expect(detailSource).toContain("const timeoutId = setTimeout(() => {");
        expect(detailSource).toContain("departureStatusRequestRef.current");
        expect(detailSource).toContain("departureStatusRequestGenerationRef.current === requestGeneration");
        expect(detailSource).toContain("Losing focus/foreground or entering route edit/save invalidates the old request context.");
        expect(detailSource).toContain("isDepartureStatusLocallyExpired({");
        expect(detailSource).toContain("evaluatedAt: departureStatusEvaluatedAtRef.current");
        expect(detailSource).toContain("A failed overdue request retries on the fallback cadence");
        expect(detailSource).toContain("setAcceptedDepartureStatus(undefined)");
    });

    it("keeps saved map geometry and renders an alternative only as text guidance", () => {
        expect(detailSource).toContain("const displayRoute = inspectedTravelPlan?.route ?? item?.route;");
        expect(detailSource).toContain("const savedDisplayTravelMinutes = inspectedTravelPlan?.travelMinutes ?? item?.travelMinutes;");
        expect(detailSource).toContain("isInspectingTravelPlan: Boolean(inspectedTravelPlan)");
        expect(detailSource).toContain("typeof savedDisplayTravelMinutes === \"number\"");
        expect(detailSource).toContain("typeof currentTravelMinutes === \"number\"");
        expect(detailSource).toContain("buildEffectiveTransitRoutePresentation(departureStatus)");
        expect(detailSource).toContain("실시간 추천 경로");
        expect(detailSource).toContain("effectiveTransitRoutePresentation.mapNote");
        expect(detailSource).not.toContain("displayRoute = departureStatus");
        expect(detailSource).not.toContain("route: departureStatus.effectiveTransitRoute");
        expect(detailSource).toContain("`일정 ${arrivalTimeLabel} · 현재 이동 ${currentRouteDurationLabel}`");
    });
});
