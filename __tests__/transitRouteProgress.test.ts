import type { TransitLegDetail } from "../src/modules/map/routingService";
import { buildTransitRouteProgressSegments } from "../src/modules/schedule/transitRouteProgress";

describe("buildTransitRouteProgressSegments", () => {
    it("표시 label이 없는 저장 구간도 안전하게 그리고 노선명이 없으면 교통수단만 표시한다", () => {
        const partial = [
            { kind: "BUS", lineName: "7016", lineColor: "#36A84B" },
            { kind: "BUS" },
            { kind: "SUBWAY", label: null },
        ] as unknown as TransitLegDetail[];
        expect(buildTransitRouteProgressSegments(partial).map(segment => segment.lineLabel))
            .toEqual(["7016", "버스", "지하철"]);
        expect(buildTransitRouteProgressSegments(partial).map(segment => segment.label))
            .toEqual(["시간 미확인", "시간 미확인", "시간 미확인"]);
    });
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
