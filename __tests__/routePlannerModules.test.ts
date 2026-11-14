import type { RouteAlternativeOption } from "../src/modules/map/routingService";
import { routeSegmentModeToProgressKind } from "../src/modules/schedule/routePlanner/routePlannerRouteInfo";
import { getTransitStopCameraCenter } from "../src/modules/schedule/routePlanner/routeMapCamera";
import { estimateMetersPerPixel } from "../src/modules/schedule/routePlanner/routeMapCoordinate";
import {
    getBottomSheetSnapFromGesture,
    getBottomSheetSnapTarget,
    getRoutePlannerBottomSheetLayout,
} from "../src/modules/schedule/routePlanner/bottomSheetLayout";
import {
    getSingleParam,
    parseDepartureAtParam,
    parseFocusZoomParam,
    parseIntegerParam,
    parseRouteParamPlace,
    parseSheetStateParam,
    parseTravelModeParam,
    placeHasCoords,
} from "../src/modules/schedule/routePlanner/params";
import {
    buildTransitRouteTimeMeta,
    compactTransitStopLabel,
    formatAlternativeInfo,
    formatDistance,
    formatDuration,
    getMapRouteChoiceLabels,
    getRoutePlannerQualityNotice,
    getTransitModeLabels,
    shouldShowTransitDurationOnly,
    sortRouteAlternativesForPlanner,
} from "../src/modules/schedule/routePlanner/presentation";

/** 테스트마다 필요한 값만 덮어쓸 수 있는 최소 경로 후보를 만듭니다. */
function routeOption(
    id: string,
    minutes: number,
    overrides: Partial<RouteAlternativeOption> = {}
): RouteAlternativeOption {
    return {
        id,
        mode: "CAR",
        minutes,
        source: "api",
        ...overrides,
    };
}

it("preserves the transfer kind for the route overview accessibility label", () => {
    expect(routeSegmentModeToProgressKind("TRANSFER")).toBe("TRANSFER");
});

describe("route planner query params", () => {
    it("반복 query는 첫 값을 사용하고 숫자·이동 수단을 엄격하게 해석한다", () => {
        expect(getSingleParam(["first", "second"])).toBe("first");
        expect(parseIntegerParam("2")).toBe(2);
        expect(parseIntegerParam("2.5")).toBeUndefined();
        expect(parseTravelModeParam(" transit ")).toBe("TRANSIT");
        expect(parseTravelModeParam("FLY")).toBeUndefined();
    });

    it("유효한 날짜와 TMAP 범위로 제한한 QA zoom만 반환한다", () => {
        expect(parseDepartureAtParam("2026-08-11T10:30:00+09:00")?.getHours()).toBe(10);
        expect(parseDepartureAtParam("not-a-date")).toBeUndefined();
        expect(parseFocusZoomParam("2")).toBe(6);
        expect(parseFocusZoomParam("25")).toBe(18);
        expect(parseSheetStateParam("middle")).toBe("middle");
    });

    it("좌표가 모두 있을 때만 query를 Place로 조립한다", () => {
        const place = parseRouteParamPlace({
            originLat: "37.5665",
            originLng: "126.9780",
            originAddress: "서울시청",
        }, "origin");

        expect(place).toEqual({
            name: "서울시청",
            address: "서울시청",
            lat: 37.5665,
            lng: 126.978,
        });
        expect(place && placeHasCoords(place)).toBe(true);
        expect(parseRouteParamPlace({ destinationLat: "37.5" }, "destination")).toBeUndefined();
    });
});

describe("route planner presentation", () => {
    it("uses the differing bus line to distinguish two 43-minute mixed routes", () => {
        const mixed = (bus: string) => routeOption(bus, 43, {
            mode: "TRANSIT",
            transitLegs: [
                { kind: "SUBWAY", label: "4호선" },
                { kind: "WALK", label: "환승 도보" },
                { kind: "BUS", label: bus },
            ],
        });
        expect(getMapRouteChoiceLabels([
            mixed("간선 740"),
            { ...mixed("401"), minutes: 46 },
            mixed("간선 140"),
        ])).toEqual(["추천 · 740 · 43분", "버스+지하철 · 46분", "140 · 43분"]);
    });
    it("adjusts stop framing for the map SDK scale at the previous zoom", () => {
        const stop = { lat: 37.55, lng: 126.97 };
        const center = getTransitStopCameraCenter(stop, 17, 840, 122, 330, {
            latitude: stop.lat, zoom: 16, metersPerPixel: estimateMetersPerPixel(stop.lat, 16) * 0.6,
        });
        const markerY = 420 + (center.lat - stop.lat) * 111_320 / (estimateMetersPerPixel(stop.lat, 17) * 0.6);
        expect(markerY).toBeCloseTo(226, 4);
    });
    it.each([330, 540, 690])("places a selected stop above a sheet starting at %ipx at either focus zoom", (sheetTop) => {
        const stop = { lat: 37.55, lng: 126.97 };
        for (const zoom of [17, 18]) {
            const center = getTransitStopCameraCenter(stop, zoom, 840, 122, sheetTop);
            const markerY = 420 + (center.lat - stop.lat) * 111_320 / estimateMetersPerPixel(stop.lat, zoom);
            expect(markerY).toBeCloseTo((122 + sheetTop) / 2, 4);
            expect(center.lng).toBe(stop.lng);
        }
    });

    it("uses duration and fare for a saved transit itinerary without a verified departure", () => {
        const saved = routeOption("saved-mixed", 41, {
            mode: "TRANSIT",
            source: "fallback",
            fareWon: 1500,
            transitLegs: [{ kind: "SUBWAY", label: "4호선", durationMinutes: 20 }],
        });
        const estimated = new Date("2026-11-15T13:19:00+09:00");
        expect(shouldShowTransitDurationOnly(saved)).toBe(true);
        expect(buildTransitRouteTimeMeta(saved, estimated)).toEqual({
            departureText: "예상 소요 시간",
            fareText: "1,500원",
            combinedText: "예상 소요 시간 · 1,500원",
        });
        expect(getRoutePlannerQualityNotice(saved, "일반 경로 안내", true)).toBeUndefined();
        expect(getRoutePlannerQualityNotice(
            { ...saved, routePlausibility: "geometry_suspected" }, undefined, true,
        )).toBe("지도에 표시된 경로가 실제 도로와 다를 수 있어요.");
        expect(getRoutePlannerQualityNotice(
            { ...saved, fallbackKind: "straight" }, "직선 추정 안내", true,
        )).toBe("직선 추정 안내");
        expect(getRoutePlannerQualityNotice(
            { ...saved, transitServiceState: "not_operating" }, "운행 종료 안내", true,
        )).toBe("운행 종료 안내");
        expect(shouldShowTransitDurationOnly({ ...saved, providerTimeBasis: "timetable" })).toBe(false);
        expect(shouldShowTransitDurationOnly({ ...saved, transitServiceState: "operating" })).toBe(false);
    });

    it("거리와 소요 시간을 화면용 단위로 변환한다", () => {
        expect(formatDistance(840)).toBe("840m");
        expect(formatDistance(1_240)).toBe("1.2km");
        expect(formatDuration(125)).toBe("2시간 5분");
        expect(formatDuration(Number.NaN)).toBe("-");
    });

    it("후보 정보와 정류장명을 짧고 안정적인 문구로 만든다", () => {
        const option = routeOption("route", 42, {
            mode: "TRANSIT",
            transferCount: 1,
            walkMeters: 620,
            fareWon: 1_500,
            distanceMeters: 12_300,
        });

        expect(formatAlternativeInfo(option)).toBe("환승 1회 · 도보 620m · 요금 1,500원 · 12.3km");
        expect(compactTransitStopLabel(" 강남역(중앙차로)... ", 6)).toBe("강남역중앙차…");
    });

    it("leg 종류는 API 순서와 무관하게 고정 순서로 정리한다", () => {
        expect(getTransitModeLabels([
            { kind: "WALK", label: "도보" },
            { kind: "BUS", label: "버스" },
            { kind: "SUBWAY", label: "지하철" },
            { kind: "BUS", label: "버스 환승" },
        ])).toEqual(["지하철", "버스", "도보"]);
    });

    it("일반 이동 수단 후보는 빠른 순으로 네 건만 남긴다", () => {
        const sorted = sortRouteAlternativesForPlanner([
            routeOption("five", 50),
            routeOption("one", 10),
            routeOption("four", 40),
            routeOption("two", 20),
            routeOption("three", 30),
        ], "CAR");

        expect(sorted.map((option) => option.id)).toEqual(["one", "two", "three", "four"]);
    });

    it("자정을 넘는 예상 도착 시각에 다음날 문맥을 표시한다", () => {
        const departureAt = new Date("2026-08-11T23:50:00+09:00");
        const meta = buildTransitRouteTimeMeta(
            routeOption("night", 25, { mode: "TRANSIT", fareWon: 1_500 }),
            departureAt
        );

        expect(meta.departureText).toBe("오후 11:50");
        expect(meta.arrivalText).toBe("다음날 오전 12:15");
        expect(meta.combinedText).toContain("1,500원");
    });

    it("운행 시각을 알 수 없는 지도 상세는 예상 소요 시간과 요금을 표시한다", () => {
        const option = routeOption("unknown-night", 65, {
            mode: "TRANSIT",
            provider: "odsay",
            transitServiceState: "unknown",
            providerTimeBasis: "route_estimate",
            providerDepartureAt: "2026-10-04T01:40:00+09:00",
            providerArrivalAt: "2026-10-04T02:45:00+09:00",
            fareWon: 2_000,
        });
        const meta = buildTransitRouteTimeMeta(option, new Date("2026-10-04T02:31:00+09:00"));

        expect(meta).toEqual({
            departureText: "예상 소요 시간",
            fareText: "2,000원",
            combinedText: "예상 소요 시간 · 2,000원",
        });
        expect(meta.arrivalText).toBeUndefined();
        expect(meta.timeRangeText).toBeUndefined();
    });

    it("운행 종료와 다른 이동수단은 운행 미확인 안내와 구분한다", () => {
        const departureAt = new Date("2026-10-04T02:31:00+09:00");
        expect(buildTransitRouteTimeMeta(routeOption("ended", 65, {
            mode: "TRANSIT", transitServiceState: "not_operating",
        }), departureAt).departureText).toBe("운행 종료");
        expect(shouldShowTransitDurationOnly(routeOption("car", 65))).toBe(false);
    });

    it("명시적으로 검증된 시간표는 공통 검색 시각 대신 후보의 실제 시각을 표시한다", () => {
        const meta = buildTransitRouteTimeMeta(routeOption("timetable", 65, {
            mode: "TRANSIT",
            transitServiceState: "operating",
            providerTimeBasis: "timetable",
            providerDepartureAt: "2026-10-04T05:35:00+09:00",
            providerArrivalAt: "2026-10-04T06:40:00+09:00",
        }), new Date("2026-10-04T02:31:00+09:00"));

        expect(meta.departureText).toBe("오전 5:35");
        expect(meta.arrivalText).toBe("오전 6:40");
    });
});

describe("route planner bottom sheet layout", () => {
    it("상세 화면에서 safe area와 action bar를 포함한 snap 위치를 계산한다", () => {
        const layout = getRoutePlannerBottomSheetLayout({
            bottomPanelHeight: 500,
            transitActionBarHeight: 90,
            hasBottomSheetMeasured: true,
            bottomSheetAnimatedOffset: 250,
            bottomSheetSnap: "middle",
            isBottomSheetHidden: false,
            isRouteDetailMode: true,
            windowHeight: 844,
            safeAreaTop: 47,
            safeAreaBottom: 34,
        });

        expect(layout.bottomPanelMaxHeight).toBeLessThanOrEqual(520);
        expect(layout.bottomSheetExpandedOffset).toBeLessThanOrEqual(layout.bottomSheetMiddleOffset);
        expect(layout.bottomSheetMiddleOffset).toBeLessThanOrEqual(layout.bottomSheetCollapsedOffset);
        expect(layout.canScrollBottomSheetContent).toBe(true);
        expect(layout.transitMapBottomOcclusionHeight).toBeGreaterThanOrEqual(layout.visibleBottomSheetHeight);
    });

    it("snap 상태와 제스처 방향을 translate 위치로 변환한다", () => {
        const offsets = {
            bottomSheetHiddenOffset: 540,
            bottomSheetExpandedOffset: 20,
            bottomSheetMiddleOffset: 220,
            bottomSheetCollapsedOffset: 420,
        };

        expect(getBottomSheetSnapTarget("middle", offsets, true)).toBe(220);
        expect(getBottomSheetSnapTarget("middle", offsets, false)).toBe(420);
        expect(getBottomSheetSnapFromGesture({
            current: 300,
            velocityY: -0.8,
            isRouteDetailMode: true,
            bottomSheetCollapsedOffset: 420,
            bottomSheetExpandedOffset: 20,
            bottomSheetMiddleOffset: 220,
            bottomSheetDragMaxOffset: 420,
        })).toBe("middle");
        expect(getBottomSheetSnapFromGesture({
            current: 300,
            velocityY: 0.8,
            isRouteDetailMode: true,
            bottomSheetCollapsedOffset: 420,
            bottomSheetExpandedOffset: 20,
            bottomSheetMiddleOffset: 220,
            bottomSheetDragMaxOffset: 420,
        })).toBe("collapsed");
    });

    it("큰 글씨의 버튼이 높아져도 중간 시트에 경로를 읽을 공간을 확보한다", () => {
        const input = {
            bottomPanelHeight: 480,
            transitActionBarHeight: 176,
            hasBottomSheetMeasured: true,
            bottomSheetAnimatedOffset: 0,
            bottomSheetSnap: "middle" as const,
            isBottomSheetHidden: false,
            isRouteDetailMode: true,
            windowHeight: 844,
            safeAreaTop: 47,
            safeAreaBottom: 34,
            largeRouteText: true,
        };
        const layout = getRoutePlannerBottomSheetLayout(input);
        const settled = getRoutePlannerBottomSheetLayout({
            ...input, bottomSheetAnimatedOffset: layout.bottomSheetMiddleOffset,
        });
        expect(settled.bottomPanelScrollViewportHeight).toBe(260);
        expect(settled.bottomSheetMiddleOffset).toBeLessThan(getRoutePlannerBottomSheetLayout({
            ...input, largeRouteText: false,
        }).bottomSheetMiddleOffset);
    });
});
