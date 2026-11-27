import type { TransitLegDetail } from "../src/modules/map/routingService";
import { getLegLineColor } from "../src/modules/map/savedRouteMapOverlays";
import { buildRouteInfoFromAlternative, getRouteInfoFromRoute, getRouteStepColor } from "../src/modules/schedule/routeInfo";
import { normalizeRouteAlternativeToSegments } from "../src/modules/schedule/routePlanner/routeTransitGeometryBuilder";
import { getTransitLegVisualColor } from "../src/modules/schedule/routePlanner/routeTransitLegCoordinates";
import { buildRouteDropdownSummaryItems, buildRouteProgressSegments, getTransitLegColor } from "../src/routeSupport/schedule/routeSelectRouteModel";
import { buildSavedTransitProgressFromSteps, buildTransitRouteProgressSegments, getTransitRouteSummaryAccessibilityLabel, groupTransitRouteSummary } from "../src/modules/schedule/transitRouteProgress";

jest.mock("../src/routeSupport/schedule/RouteSelectAnimatedControls", () => ({}));

describe("buildTransitRouteProgressSegments", () => {
    it("groups consecutive walking only in the summary and maps the focused leg to its group", () => {
        const legs = buildTransitRouteProgressSegments([
            { kind: "SUBWAY", label: "4호선", durationMinutes: 16 },
            { kind: "WALK", label: "도보", durationSeconds: 20 },
            { kind: "WALK", label: "도보", durationSeconds: 20 },
            { kind: "ETC", label: "대기", journeyPhase: "BUFFER", durationSeconds: 120 },
            { kind: "WALK", label: "도보" },
            { kind: "WALK", label: "도보", durationMinutes: 3 },
            { kind: "BUS", label: "361", durationMinutes: 5 },
            { kind: "WALK", label: "도보", durationMinutes: 2 },
            { kind: "WALK", label: "도보", durationMinutes: 4 },
        ]);

        expect(groupTransitRouteSummary(legs, 2)).toMatchObject({
            focusedIndex: 1,
            segments: [
                { label: "16분" }, { label: "1분", durationSeconds: 40 }, { kind: "WAIT" },
                { label: "시간 미확인" }, { label: "3분" }, { label: "5분" }, { label: "6분" },
            ],
        });
        expect(groupTransitRouteSummary(legs, 8).focusedIndex).toBe(6);
        expect(legs).toHaveLength(9);
        expect(getTransitRouteSummaryAccessibilityLabel(legs)).toContain("361 5분, 도보 6분");
    });
    it("retains terminal wait durations and keeps them distinct from transfer walks", () => {
        const legs: TransitLegDetail[] = [
            { kind: "SUBWAY", label: "공항철도", durationMinutes: 6 },
            { kind: "WALK", label: "환승 도보", durationMinutes: 6 },
            { kind: "ETC", label: "탑승 준비·대기", journeyPhase: "BUFFER", durationSeconds: 1200 },
            { kind: "INTERCITY_BUS", label: "우등", durationMinutes: 85 },
        ];
        const segments = buildTransitRouteProgressSegments(legs);

        expect(segments.map(segment => segment.kind)).toEqual(["SUBWAY", "WALK", "WAIT", "INTERCITY_BUS"]);
        expect(buildRouteDropdownSummaryItems({
            id: "buffer-route", mode: "TRANSIT", source: "api", minutes: 117, transitLegs: legs,
        }).map(item => item.kind)).toEqual(["SUBWAY", "WALK", "INTERCITY_BUS"]);
        expect(getTransitRouteSummaryAccessibilityLabel(segments))
            .toBe("이동 경로, 공항철도 6분, 환승 도보 6분, 우등 1시간 25분");
    });

    it("uses the same subway identity and color on the map, summary, and timeline", () => {
        const legs: TransitLegDetail[] = [
            { kind: "SUBWAY", label: "4호선", lineName: "수도권 4 호선", lineColor: "#000000" },
            { kind: "SUBWAY", label: "2호선", lineName: "수도권 2호선" },
            { kind: "SUBWAY", label: "인천 2호선", lineName: "인천 2호선" },
            { kind: "SUBWAY", label: "부산 2호선", lineName: "부산 2호선", lineColor: "81BF48" },
            { kind: "SUBWAY", label: "공항철도", lineName: "공항철도" },
        ];
        const segments = buildTransitRouteProgressSegments(legs);
        expect(segments.map(segment => segment.lineLabel)).toEqual(["4호선", "2호선", "인천2호선", "부산2호선", "공항철도"]);
        expect(segments.map(segment => segment.color)).toEqual(["#00A4E3", "#00B140", "#ED8B00", "#81BF48", "#1E88E5"]);
        expect(legs.map(getLegLineColor)).toEqual(segments.map(segment => segment.color));
        expect(legs.map(leg => getRouteStepColor({ ...leg, type: "SUBWAY" })))
            .toEqual(segments.map(segment => segment.color));
    });
    it("reads subway names and colors consistently when a provider or saved step includes boarding instructions", () => {
        const legs: TransitLegDetail[] = [
            { kind: "SUBWAY", lineName: "서울역에서 승차", label: "서울역 승차 · 4호선", lineColor: "#000000", durationMinutes: 16 },
            { kind: "SUBWAY", lineName: "사당역에서 승차", label: "사당역 승차 · 2호선", lineColor: "#000000", durationMinutes: 9 },
        ];
        const option = { id: "saved-subway", mode: "TRANSIT", source: "api", minutes: 25, transitLegs: legs } as const;
        const expected = [{ lineName: "4호선", lineColor: "#00A4E3" }, { lineName: "2호선", lineColor: "#00B140" }];
        expect(buildTransitRouteProgressSegments(legs)).toMatchObject(expected.map(({ lineName, lineColor }) => ({
            lineLabel: lineName, color: lineColor,
        })));
        expect(legs.map(getLegLineColor)).toEqual(expected.map(step => step.lineColor));
        expect(legs.map(getTransitLegVisualColor)).toEqual(expected.map(step => step.lineColor));
        expect(normalizeRouteAlternativeToSegments(option)?.segments).toMatchObject(expected.map(({ lineName, lineColor }) => ({
            lineName, routeColor: lineColor,
        })));

        const routeInfo = buildRouteInfoFromAlternative(option);
        const rideSteps = routeInfo.steps.filter(step => step.type === "SUBWAY");
        expect(rideSteps).toMatchObject(expected);
        const olderRoute = {
            ...routeInfo,
            steps: rideSteps.map((step, index) => ({
                ...step, lineName: legs[index].lineName, badgeText: legs[index].label, lineColor: legs[index].lineColor,
            })),
        };
        expect(getRouteInfoFromRoute(olderRoute)?.steps).toMatchObject(expected.map(step => ({ ...step, badgeText: step.lineName })));
        expect(olderRoute.steps[0]).toMatchObject({ lineName: "서울역에서 승차", lineColor: "#000000" });
    });
    it("summarizes saved transit timelines without provider legs", () => {
        const segments = buildSavedTransitProgressFromSteps([
            { id: "origin", type: "ORIGIN", title: "서울역" },
            { id: "first", type: "WALK", title: "도보", durationMinutes: 5 },
            { id: "rail", type: "SUBWAY", title: "서울역 승차", lineName: "4호선", durationMinutes: 20 },
            { id: "transfer", type: "TRANSFER", title: "환승", durationSeconds: 180 },
            { id: "bus", type: "BUS", title: "버스 승차", badgeText: "361", durationMinutes: 3 },
            { id: "last", type: "WALK", title: "도보", durationMinutes: 2 },
            { id: "destination", type: "DESTINATION", title: "강남역" },
        ]);
        expect(getTransitRouteSummaryAccessibilityLabel(segments))
            .toBe("이동 경로, 도보 5분, 4호선 20분, 환승 도보 3분, 361 3분, 도보 2분");
    });
    it("shows the same supplied duration in candidate and saved summaries without guessing from distance", () => {
        const transitLegs: TransitLegDetail[] = [
            { kind: "WALK", label: "도보", durationSeconds: 180 },
            { kind: "SUBWAY", label: "지하철 · 4호선", lineName: "수도권 4호선", durationSeconds: 960 },
            { kind: "WALK", label: "환승 도보", durationSeconds: 180 },
            { kind: "BUS", label: "버스 · 마을 31", distanceMeters: 2300 },
            { kind: "WALK", label: "도착 도보", durationMinutes: 2 },
        ];
        const option = { id: "partial-timing", mode: "TRANSIT" as const, source: "api" as const, minutes: 35, transitLegs };
        const summary = buildRouteProgressSegments(option);
        expect(summary).toEqual(buildTransitRouteProgressSegments(transitLegs));
        expect(summary.map(segment => [segment.lineLabel, segment.label])).toEqual([
            [undefined, "3분"], ["4호선", "16분"], [undefined, "3분"], ["31", "시간 미확인"], [undefined, "2분"],
        ]);
        expect(buildRouteDropdownSummaryItems(option).map(item => item.title)).toEqual([
            "도보 3분", "4호선 16분", "환승 도보 3분", "31", "도보 2분",
        ]);
    });
    it("keeps bus type colors across candidate, map, and saved route views while shortening the label", () => {
        const busPath = {
            startCoord: { lat: 37.49, lng: 127.01 },
            endCoord: { lat: 37.50, lng: 127.03 },
            pathCoords: [{ lat: 37.49, lng: 127.01 }, { lat: 37.50, lng: 127.03 }],
            pathGeometrySource: "TRANSIT_PASS_SHAPE_LINESTRING" as const,
            pathCoordsIsExact: true,
        };
        const legs: TransitLegDetail[] = [
            { kind: "SUBWAY", label: "4호선", lineName: "수도권 4호선", durationMinutes: 16 },
            { ...busPath, kind: "BUS", label: "버스 · 마을 31", lineName: "마을 31", durationMinutes: 8 },
            { ...busPath, kind: "BUS", label: "버스 · 지선 123", durationMinutes: 6 },
            { ...busPath, kind: "BUS", label: "버스 · 광역 123", lineName: "광역 123", lineColor: "8B284A", durationMinutes: 12 },
        ];
        const option = { id: "mixed-color", mode: "TRANSIT" as const, source: "api" as const, minutes: 42, transitLegs: legs };
        const expected = ["#00A4E3", "#26A69A", "#22C55E", "#8B284A"];
        const progress = buildTransitRouteProgressSegments(legs);
        expect(progress.map(segment => segment.lineLabel)).toEqual(["4호선", "31", "123", "123"]);
        expect(progress.map(segment => segment.color)).toEqual(expected);
        expect(legs.map(getLegLineColor)).toEqual(expected);
        expect(legs.map(getTransitLegVisualColor)).toEqual(expected);
        expect(legs.map(getTransitLegColor)).toEqual(expected);
        expect(normalizeRouteAlternativeToSegments(option)?.segments.map(segment => segment.routeColor)).toEqual(expected);
        const steps = buildRouteInfoFromAlternative(option).steps.filter(step => step.type === "BUS" || step.type === "SUBWAY");
        expect(steps.map(getRouteStepColor)).toEqual(expected);
    });
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

describe("getTransitRouteSummaryAccessibilityLabel", () => {
    it("describes transfer walks and falls back for unnamed rides", () => {
        const [subway, walk, bus] = buildTransitRouteProgressSegments([
            { kind: "SUBWAY", label: "4호선", lineName: "4호선", durationMinutes: 16 },
            { kind: "WALK", label: "도보", durationMinutes: 3 },
            { kind: "BUS", label: "버스", durationMinutes: 8 },
        ]);
        expect(getTransitRouteSummaryAccessibilityLabel([subway, walk, { ...bus, lineLabel: undefined }]))
            .toBe("이동 경로, 4호선 16분, 환승 도보 3분, 버스 8분");
    });
});
