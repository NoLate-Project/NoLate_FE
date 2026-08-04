import type { TransitLegDetail } from "../src/modules/map/routingService";
import { buildTransitRouteProgressSegments } from "../src/modules/schedule/transitRouteProgress";

describe("buildTransitRouteProgressSegments", () => {
    it("경로바 아래에는 노선명만 간결하게 표시한다", () => {
        const legs: TransitLegDetail[] = [
            {
                kind: "SUBWAY",
                label: "지하철 신분당선 · 45분",
                lineName: "신분당선",
                durationMinutes: 45,
            },
            {
                kind: "BUS",
                label: "구성역 정류장에서 버스",
                lineName: "마을버스",
                durationMinutes: 20,
            },
            {
                kind: "BUS",
                label: "버스 31 · 8분",
                lineName: "판교역 정류장에서",
                durationMinutes: 8,
            },
            {
                kind: "BUS",
                label: "판교역 정류장에서 버스",
                durationMinutes: 8,
            },
            {
                kind: "BUS",
                label: "버스 · 31 · 22분",
                durationMinutes: 22,
            },
            {
                kind: "BUS",
                label: "버스 · 20분",
                durationMinutes: 20,
            },
        ];

        expect(buildTransitRouteProgressSegments(legs).map((segment) => segment.lineLabel)).toEqual([
            "신분당선",
            "마을버스",
            "31",
            "버스",
            "31",
            "버스",
        ]);
    });
});
