import { getSavedRouteAlternative } from "../src/modules/map/savedRouteMapPresentation";
import { createQaScheduleItem } from "../src/modules/schedule/qaSamples";
import { buildSavedRouteDetailInfo } from "../src/modules/schedule/savedRouteDetailPresentation";
import { buildTransitRouteProgressSegments } from "../src/modules/schedule/transitRouteProgress";

describe("saved route detail presentation", () => {
    const schedule = createQaScheduleItem(new Date("2026-07-15T09:00:00+09:00"));
    const routeAlternative = getSavedRouteAlternative(schedule.route);

    it("uses the current route bar proportions and transit colors", () => {
        const segments = buildTransitRouteProgressSegments(routeAlternative?.transitLegs);

        expect(segments.map((segment) => segment.label)).toEqual(["3분", "16분", "8분", "4분"]);
        expect(segments.map((segment) => segment.lineLabel)).toEqual([undefined, "4호선", "2호선", undefined]);
        expect(segments.map((segment) => segment.color)).toEqual([
            "#4F5760",
            "#00A4E3",
            "#00B140",
            "#4F5760",
        ]);
        expect(segments.map((segment) => segment.flex)).toEqual([3, 16, 8, 4]);
    });

    it("preserves stored detail labels while restoring missing stop lists", () => {
        const routeInfo = buildSavedRouteDetailInfo({
            route: schedule.route,
            routeAlternative,
            origin: schedule.origin,
            destination: schedule.destination,
            departureAt: schedule.departAt ? new Date(schedule.departAt) : undefined,
        });
        const line4Step = routeInfo?.steps.find((step) => step.id === "subway-4");
        const line2Step = routeInfo?.steps.find((step) => step.id === "subway-2");

        expect(routeInfo?.departureTime).toBe(schedule.departAt);
        expect(line4Step?.passStops).toHaveLength(5);
        expect(line2Step?.passStops).toHaveLength(4);
        expect(line4Step).toMatchObject({
            badgeText: "4호선",
            lineColor: "#00A4E3",
            stationCount: 8,
        });
    });

    it("recalculates the displayed arrival from the schedule departure", () => {
        const routeInfo = buildSavedRouteDetailInfo({
            route: schedule.route,
            routeAlternative,
            origin: schedule.origin,
            destination: schedule.destination,
            departureAt: new Date("2026-07-15T13:58:00+09:00"),
        });

        expect(routeInfo?.arrivalTime).toBe("2026-07-15T05:30:00.000Z");
    });
});
