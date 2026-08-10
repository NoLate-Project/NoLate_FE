const { readFileSync } = require("fs") as {
    readFileSync: (path: string, encoding: string) => string;
};

export {};

const detailSource = readFileSync("app/schedule/[id].tsx", "utf8");

describe("schedule detail effective transit route integration", () => {
    it("loads departure status independently without replacing the saved schedule request", () => {
        expect(detailSource).toContain("getScheduleDepartureStatus(id)");
        expect(detailSource).toContain("getSchedule(id)");
        expect(detailSource).toContain("ETA 상태는 보조 정보다. 실패해도 저장된 일정과 경로는 정상 표시한다.");
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
    });
});
