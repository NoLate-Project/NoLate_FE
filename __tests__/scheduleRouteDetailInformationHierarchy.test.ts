const { readFileSync } = require("fs") as {
    readFileSync: (path: string, encoding: string) => string;
};

export {};

const detailSource = readFileSync("app/schedule/[id].tsx", "utf8");
const routeSummaryStart = detailSource.indexOf("styles.sheetRouteSummary");
const routeSummaryEnd = detailSource.indexOf("<RouteStepTimeline", routeSummaryStart);
const routeSummarySource = detailSource.slice(routeSummaryStart, routeSummaryEnd);

describe("schedule route detail information hierarchy", () => {
    test("detailed routes keep one summary source above the route bar", () => {
        expect(routeSummaryStart).toBeGreaterThanOrEqual(0);
        expect(routeSummaryEnd).toBeGreaterThan(routeSummaryStart);
        expect(routeSummarySource).toContain("{hasDetailedRoute ? (");
        expect(routeSummarySource).toContain("{!hasDetailedRoute ? (");
        expect(routeSummarySource).toContain("<TransitRouteProgressBar");
    });

    test("own-route base time is delegated to the timeline while participant plans retain it", () => {
        expect(routeSummarySource).toContain("{inspectedTravelPlan ? (");
        expect(routeSummarySource).toContain("{hhmmText(fromISO(routeDetailInfo.departureTime))} 출발 기준");
        expect(detailSource).toContain("<RouteStepTimeline");
    });
});
