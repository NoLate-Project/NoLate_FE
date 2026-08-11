import type { RouteAlternativeOption } from "../src/modules/map/routingService";
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
    getTransitModeLabels,
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
});
