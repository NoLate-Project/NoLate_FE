import React from "react";
import { Animated } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import { RouteSearchError, type RouteAlternativeOption } from "../src/modules/map/routingService";
import { consumeRoutePlannerResult, getRouteCandidateListSnapshot, setRouteCandidateListSnapshot, setRoutePlannerInitial } from "../src/modules/schedule/routePlannerSession";
import { buildRouteMetricChips, formatRouteTimeFare, sharesTransitDurationEstimate } from "../src/routeSupport/schedule/routeSelectRouteModel";
import { useRouteSelectRouteController } from "../src/routeSupport/schedule/useRouteSelectRouteController";
import { showRouteDetailInterstitialIfEligible } from "../src/modules/advertising/routeDetailInterstitial";

const mockGetRoutes = jest.fn();
const mockRouter = { canGoBack: () => true, back: jest.fn(), push: jest.fn(), replace: jest.fn() };

jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("../src/modules/map/routingService", () => ({
    RouteSearchError: class extends Error {
        code: string;

        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
    getRouteAlternativeOptions: (...args: unknown[]) => mockGetRoutes(...args),
    invalidateRouteSearch: jest.fn(),
}));
jest.mock("../src/modules/advertising/routeDetailInterstitial", () => ({
    primeRouteDetailAdvertising: jest.fn().mockResolvedValue(undefined),
    showRouteDetailInterstitialIfEligible: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../src/routeSupport/schedule/RouteSelectAnimatedControls", () => ({
    TRANSIT_FILTER_ITEMS: ["ALL", "SUBWAY", "BUS", "MIXED"].map(key => ({ key })),
    ROUTE_SEGMENT_FALLBACK_COLORS: { walk: "#aaa", etc: "#bbb" },
}));

const arrival = "2026-10-04T02:45:00+09:00";
const now = new Date("2026-10-04T00:40:00+09:00");
const previousDeparture = new Date("2026-10-04T02:31:00+09:00");
const originalOrigin = { name: "기존 출발지", lat: 37.49, lng: 126.93 };
const nowon = { name: "노원역", lat: 37.656, lng: 127.063 };
const destination = { name: "신림역", lat: 37.484, lng: 126.929 };

function route(minutes = 65): RouteAlternativeOption {
    return {
        id: `route-${minutes}`,
        mode: "TRANSIT",
        minutes,
        source: "api",
        provider: "tmap",
        transitServiceState: "operating",
        transitLegs: [{ kind: "SUBWAY", label: "4호선", lineName: "4호선", durationMinutes: minutes }],
    };
}

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    mockGetRoutes.mockReset();
});

afterEach(() => jest.useRealTimers());

describe("route candidate timing", () => {
    test("includes access, transfer and exit walking time from the legs instead of distance", () => {
        const transit = route(41);
        const legs: NonNullable<RouteAlternativeOption["transitLegs"]> = [
            { kind: "WALK", label: "출발 도보", durationMinutes: 5 },
            ...transit.transitLegs!,
            { kind: "WALK", label: "환승 도보", durationMinutes: 1, durationSeconds: 26 },
            { kind: "WALK", label: "도착 도보", durationMinutes: 1, durationSeconds: 24 },
        ];
        expect(buildRouteMetricChips({ ...transit, transitLegs: legs, walkMeters: 610 }))
            .toContainEqual({ key: "walk", label: "도보 6분" });
        expect(buildRouteMetricChips({
            ...transit,
            transitLegs: [...legs, { kind: "WALK", label: "시각 없는 도보" }],
            walkMeters: 610,
        }).some(chip => chip.key === "walk")).toBe(false);
    });

    test("14분 검색 기준이 남아 있어도 65분 후보는 저장과 동일한 일정 도착 기준을 쓴다", () => {
        expect(formatRouteTimeFare(route(), previousDeparture, { targetArrivalAt: arrival }))
            .toBe("오전 2:45 예상 도착");
        expect(formatRouteTimeFare(route(90), previousDeparture, { targetArrivalAt: arrival }))
            .toBe("오전 2:45 예상 도착");
    });

    test("지금 출발해도 늦는 후보는 목표 도착시각으로 위장하지 않는다", () => {
        jest.setSystemTime(new Date("2026-10-04T02:00:00+09:00"));
        expect(formatRouteTimeFare(route(), previousDeparture, { targetArrivalAt: arrival }))
            .toBe("오전 3:05 예상 도착");
    });

    test("검증된 공급자 시간표는 일정 목표에 맞춰 덮어쓰지 않는다", () => {
        expect(formatRouteTimeFare(route(), previousDeparture, {
            targetArrivalAt: arrival,
            routeInfo: {
                totalDurationMinutes: 65,
                totalDurationSeconds: 3863,
                departureTime: "2026-10-04T05:35:00+09:00",
                arrivalTime: "2026-10-04T06:40:00+09:00",
                timeBasis: "provider_schedule",
            },
        })).toBe("오전 6:40 예상 도착");
    });

    test.each([
        ["unknown", "예상 소요 시간"],
        ["not_operating", "운행 종료"],
    ] as const)("%s 경로는 실제 도착시각을 암시하지 않는다", (state, label) => {
        expect(formatRouteTimeFare({ ...route(), transitServiceState: state, fareWon: 2000 }, previousDeparture, {
            targetArrivalAt: arrival,
        })).toBe(`${label} · 2,000원`);
    });

    test("도착 목표가 없는 일반 검색은 검색 출발시각 기준을 유지한다", () => {
        expect(formatRouteTimeFare(route(), previousDeparture)).toBe("오전 3:36 예상 도착");
    });

    test("소요 시간 추정이 공통이면 카드에 요금만 남기고 운행 종료는 별도로 표시한다", () => {
        const first = { ...route(), transitServiceState: "unknown", fareWon: 2000 } as const;
        const second = { ...route(90), transitServiceState: "unknown" } as const;
        const ended = { ...second, transitServiceState: "not_operating" } as const;
        const savedEstimate = { ...second, source: "fallback", transitServiceState: undefined } as const;
        expect(sharesTransitDurationEstimate([first, second])).toBe(true);
        expect(sharesTransitDurationEstimate([first, savedEstimate])).toBe(true);
        expect(sharesTransitDurationEstimate([first, ended])).toBe(false);
        expect(sharesTransitDurationEstimate([first, route()])).toBe(false);
        expect(sharesTransitDurationEstimate([first])).toBe(false);
        expect(formatRouteTimeFare(first, previousDeparture, {}, false)).toBe("2,000원");
        expect(formatRouteTimeFare(second, previousDeparture, {}, false)).toBeUndefined();
        expect(formatRouteTimeFare(ended, previousDeparture, {}, false)).toBe("운행 종료");
        expect(formatRouteTimeFare(savedEstimate, previousDeparture)).toBe("예상 소요 시간");
    });

    test("일반 검색 카드도 반올림된 65분 대신 원본 3863초로 도착 시각을 표시한다", () => {
        expect(formatRouteTimeFare({ ...route(), totalDurationSeconds: 3863 }, previousDeparture))
            .toBe("오전 3:35 예상 도착");
    });

    test("초 정밀 경로도 다음 운행 출발시각을 더 이른 목표로 당기지 않는다", () => {
        expect(formatRouteTimeFare({
            ...route(),
            totalDurationSeconds: 3863,
            transitDepartureTimeSource: "next_service_search",
            transitDepartureAt: "2026-10-04T05:35:00+09:00",
        }, previousDeparture, { targetArrivalAt: arrival })).toBe("오전 6:39 예상 도착");
    });

    test("다음 운행 검색 결과를 더 이른 일정 도착 목표로 당기지 않는다", () => {
        expect(formatRouteTimeFare({
            ...route(),
            transitDepartureTimeSource: "next_service_search",
            transitDepartureAt: "2026-10-04T05:35:00+09:00",
        }, previousDeparture, { targetArrivalAt: arrival })).toBe("오전 6:40 예상 도착");
    });
});

describe("route search departure context", () => {
    let renderer: ReactTestRenderer;
    let current: ReturnType<typeof useRouteSelectRouteController>;
    const candidateCommits: Array<{ filter: string; selectedId?: string; visibleIds: string[] }> = [];
    const initial = {
        origin: originalOrigin,
        destination,
        travelMode: "TRANSIT" as const,
        travelMinutes: 14,
        targetArrivalAt: arrival,
    };
    const returnedRoute = route(14);

    function Harness({ origin = originalOrigin, targetArrivalAt = arrival, returnFromMap = false, deferRouteSearch = false, requestedDepartureAt, showResults = false }: {
        origin?: typeof originalOrigin;
        targetArrivalAt?: string;
        returnFromMap?: boolean;
        deferRouteSearch?: boolean;
        requestedDepartureAt?: string;
        showResults?: boolean;
    }) {
        current = useRouteSelectRouteController({
            initial: { ...initial, targetArrivalAt, requestedDepartureAt, route: returnFromMap ? returnedRoute : undefined },
            returnFromMap,
            deferRouteSearch,
            initialTravelMode: "TRANSIT",
            sessionId: "timing-regression",
            origin,
            destination,
            hasRouteCoords: true,
            shouldShowRouteResults: showResults,
            bottomInset: 0,
            originText: origin.name,
            originLat: origin.lat,
            originLng: origin.lng,
            destinationText: destination.name,
            destinationLat: destination.lat,
            destinationLng: destination.lng,
        });
        React.useLayoutEffect(() => {
            if (showResults) candidateCommits.push({
                filter: current.transitRouteFilter,
                selectedId: current.selectedRouteId,
                visibleIds: current.visibleRouteAlternatives.map(option => option.id),
            });
        });
        return null;
    }

    beforeEach(() => {
        candidateCommits.length = 0;
        setRoutePlannerInitial("timing-regression", initial);
        mockGetRoutes.mockImplementation((origin: typeof originalOrigin) =>
            Promise.resolve([route(origin.lat === originalOrigin.lat ? 14 : 65)]));
    });

    afterEach(() => {
        act(() => renderer?.unmount());
    });

    test("장소 편집 중에는 경로를 다시 조회하지 않고 장소를 선택하면 새 좌표로 조회한다", async () => {
        await act(async () => { renderer = TestRenderer.create(<Harness deferRouteSearch />); });
        expect(mockGetRoutes).not.toHaveBeenCalled();

        await act(async () => { renderer.update(<Harness origin={nowon} showResults />); });
        expect(mockGetRoutes).toHaveBeenCalled();
        expect(mockGetRoutes.mock.calls.every(([origin]) => origin.lat === nowon.lat)).toBe(true);
        expect(current.selectedRouteId).toBe(route(65).id);
    });

    test("지도에서 돌아오면 목록 상태를 유지하고 수단을 바꾼 뒤에는 다시 조회한다", async () => {
        setRouteCandidateListSnapshot("timing-regression", {
            alternatives: [route(14), route(65)],
            selectedRouteId: route(14).id,
            selectedDetailsCollapsed: true,
            transitFilter: "SUBWAY",
            scrollY: 420,
            departureAt: previousDeparture,
        });
        await act(async () => { renderer = TestRenderer.create(<Harness returnFromMap />); });
        expect(mockGetRoutes).not.toHaveBeenCalled();
        expect(current!.transitRouteFilter).toBe("SUBWAY");
        expect(current!.selectedRouteId).toBe(route(14).id);
        expect(current!.restoredScrollY).toBe(420);
        expect(current!.collapsedCandidateId).toBe(route(14).id);
        expect(current!.restoredExpandedCandidateId).toBeUndefined();

        await act(async () => { current!.setTravelMode("WALK"); });
        mockGetRoutes.mockResolvedValue([route(65)]);
        await act(async () => { current!.setTravelMode("TRANSIT"); });
        expect(current!.visibleRouteAlternatives.map((option) => option.id)).toEqual([route(65).id]);
        expect(current!.restoredScrollY).toBeUndefined();
        expect(current!.collapsedCandidateId).toBeUndefined();
    });

    test("지도에서 다른 후보를 선택하면 해당 카드로 돌아온다", async () => {
        setRouteCandidateListSnapshot("timing-regression", {
            alternatives: [route(14), route(65)],
            visibleRouteIds: [route(14).id, route(65).id],
            selectedRouteId: route(65).id,
            selectedDetailsCollapsed: true,
            transitFilter: "SUBWAY",
            scrollY: 420,
            departureAt: previousDeparture,
        });
        await act(async () => { renderer = TestRenderer.create(<Harness returnFromMap />); });
        expect(mockGetRoutes).not.toHaveBeenCalled();
        expect(current!.transitRouteFilter).toBe("SUBWAY");
        expect(current!.restoredCandidateId).toBe(route(14).id);
        expect(current!.restoredExpandedCandidateId).toBe(route(14).id);
        expect(current!.restoredScrollY).toBeUndefined();
        expect(current!.collapsedCandidateId).toBeUndefined();
    });

    test("지도에서 복귀할 때는 페이드 없이 복원하고 이후 필터마다 한 번만 전환한다", async () => {
        const subway = route(14);
        const bus: RouteAlternativeOption = {
            ...route(24),
            transitLegs: [{ kind: "BUS", label: "361", durationMinutes: 24 }],
        };
        setRouteCandidateListSnapshot("timing-regression", {
            alternatives: [subway, bus], selectedRouteId: subway.id, transitFilter: "ALL",
            scrollY: 0, departureAt: previousDeparture,
        });
        const timing = jest.spyOn(Animated, "timing");
        try {
            await act(async () => { renderer = TestRenderer.create(<Harness returnFromMap showResults />); });
            expect(timing).not.toHaveBeenCalled();

            await act(async () => { current.selectTransitFilter("BUS"); });
            expect(current.visibleRouteAlternatives.map(option => option.id)).toEqual([bus.id]);
            expect(current.selectedRouteId).toBe(bus.id);
            expect(timing).toHaveBeenCalledTimes(1);

            await act(async () => { current.selectTransitFilter("BUS"); });
            expect(timing).toHaveBeenCalledTimes(1);

            const busCommits = candidateCommits.filter(commit => commit.filter === "BUS");
            expect(busCommits.length).toBeGreaterThan(0);
            for (const commit of busCommits) {
                expect(commit).toEqual({ filter: "BUS", selectedId: bus.id, visibleIds: [bus.id] });
            }
            await act(async () => { await current.openMapForOption(undefined, 0); });
            expect(getRouteCandidateListSnapshot("timing-regression")).toMatchObject({
                selectedRouteId: bus.id, transitFilter: "BUS", visibleRouteIds: [bus.id],
            });
            expect(mockRouter.replace).toHaveBeenLastCalledWith(expect.objectContaining({
                pathname: "/schedule/route-planner", params: expect.objectContaining({ routeId: bus.id }),
            }));
        } finally {
            timing.mockRestore();
        }
    });

    test("지도에서 지정한 출발 시각으로 조회하고 일정 도착 기준으로 덮어쓰지 않는다", async () => {
        const departure = new Date("2026-10-04T02:05:00+09:00");
        await act(async () => {
            renderer = TestRenderer.create(<Harness requestedDepartureAt={departure.toISOString()} />);
        });
        expect(mockGetRoutes).toHaveBeenCalledTimes(1);
        expect(mockGetRoutes.mock.calls[0][3]).toEqual({ departureAt: departure });
        expect(current!.hasExplicitDeparture).toBe(true);
        expect(current!.routeTargetArrivalAt).toBeUndefined();
    });

    test("지도 전환을 기다리는 중 필터가 바뀌면 이전 후보로 이동하지 않는다", async () => {
        const subway = route(14);
        const bus: RouteAlternativeOption = {
            ...route(24),
            transitLegs: [{ kind: "BUS", label: "361", durationMinutes: 24 }],
        };
        setRouteCandidateListSnapshot("timing-regression", {
            alternatives: [subway, bus], selectedRouteId: subway.id, transitFilter: "ALL",
            scrollY: 0, departureAt: previousDeparture,
        });
        let resolveAd!: (outcome: "skipped") => void;
        jest.mocked(showRouteDetailInterstitialIfEligible).mockReturnValueOnce(
            new Promise(resolve => { resolveAd = resolve; }),
        );
        mockRouter.replace.mockClear();
        await act(async () => { renderer = TestRenderer.create(<Harness returnFromMap showResults />); });

        let pendingNavigation!: Promise<void>;
        act(() => { pendingNavigation = current.openMapForOption(subway, 24); });
        expect(current.routeMapPending).toBe(true);
        act(() => { current.selectTransitFilter("BUS"); });
        expect(current.routeMapPending).toBe(false);
        await act(async () => { await current.openMapForOption(bus, 60); });
        await act(async () => {
            resolveAd("skipped");
            await pendingNavigation;
        });

        expect(current.routeMapPending).toBe(false);
        expect(mockRouter.replace).toHaveBeenCalledTimes(1);
        expect(mockRouter.replace).toHaveBeenCalledWith(expect.objectContaining({
            pathname: "/schedule/route-planner", params: expect.objectContaining({ routeId: bus.id }),
        }));
        expect(getRouteCandidateListSnapshot("timing-regression")).toMatchObject({
            selectedRouteId: bus.id, transitFilter: "BUS", visibleRouteIds: [bus.id], scrollY: 60,
        });
    });

    test.each([false, true])("도보만 있는 후보는 실제 승차 구간 유무를 구분한다 (%s)", async (hasRide) => {
        const walkOnly: RouteAlternativeOption = {
            ...route(9),
            transitLegs: [{ kind: "WALK", label: "도보", durationMinutes: 9 }],
        };
        mockGetRoutes.mockResolvedValue(hasRide ? [walkOnly, route()] : [walkOnly]);
        await act(async () => { renderer = TestRenderer.create(<Harness />); });
        expect(current!.showTransitRecovery).toBe(!hasRide);
        expect(current!.visibleRouteAlternatives.map((option) => option.id)).toEqual(hasRide ? [route().id] : []);
    });

    test.each(["NO_PROVIDER_ROUTE", "PROVIDER_UNAVAILABLE"] as const)(
        "대중교통 결과 없음과 제공사 오류를 구분한다 (%s)",
        async (code) => {
            mockGetRoutes.mockRejectedValue(new RouteSearchError(code, "조회 실패"));
            await act(async () => { renderer = TestRenderer.create(<Harness />); });
            expect(current!.showTransitRecovery).toBe(code === "NO_PROVIDER_ROUTE");
        },
    );

    test("출발지를 바꾸면 14분 기준을 버리고 새 65분 경로를 다시 보정한다", async () => {
        await act(async () => { renderer = TestRenderer.create(<Harness />); });
        expect(current!.routeDepartureAt.toISOString()).toBe(previousDeparture.toISOString());

        await act(async () => { renderer.update(<Harness origin={nowon} />); });
        const nowonCalls = mockGetRoutes.mock.calls.filter(([origin]) => origin.lat === nowon.lat);
        expect(nowonCalls.map(([, , , options]) => options.departureAt.toISOString())).toEqual([
            new Date("2026-10-04T01:45:00+09:00").toISOString(),
            new Date("2026-10-04T01:40:00+09:00").toISOString(),
        ]);
        expect(current!.routeDepartureAt.toISOString())
            .toBe(new Date("2026-10-04T01:40:00+09:00").toISOString());

        act(() => current!.saveRouteOption(route(), 0));
        const result = consumeRoutePlannerResult("timing-regression");
        expect(result?.departureAt).toBe(new Date("2026-10-04T01:40:00+09:00").toISOString());
    });

    test("수단 변경 후 돌아오면 새 응답으로 출발 기준을 다시 보정한다", async () => {
        await act(async () => { renderer = TestRenderer.create(<Harness />); });
        await act(async () => { current!.setTravelMode("WALK"); });
        mockGetRoutes.mockResolvedValue([route()]);
        await act(async () => { current!.setTravelMode("TRANSIT"); });
        expect(current!.routeDepartureAt.toISOString())
            .toBe(new Date("2026-10-04T01:40:00+09:00").toISOString());
    });

    test("일정 도착시각이 바뀌면 이전 목표의 검색시각을 재사용하지 않는다", async () => {
        await act(async () => { renderer = TestRenderer.create(<Harness origin={nowon} />); });
        await act(async () => { renderer.update(<Harness origin={nowon} targetArrivalAt="2026-10-04T04:00:00+09:00" />); });
        expect(current!.routeDepartureAt.toISOString())
            .toBe(new Date("2026-10-04T02:55:00+09:00").toISOString());
    });

    test("다음 운행 검색으로 선택한 05:35 출발을 저장할 때도 보존한다", async () => {
        await act(async () => { renderer = TestRenderer.create(<Harness origin={nowon} />); });
        act(() => current!.saveRouteOption({
            ...route(),
            transitDepartureTimeSource: "next_service_search",
            transitDepartureAt: "2026-10-04T05:35:00+09:00",
        }, 0));
        const result = consumeRoutePlannerResult("timing-regression");
        expect(result?.departureAt).toBe(new Date("2026-10-04T05:35:00+09:00").toISOString());
    });

    test("원본 초를 가진 후보 선택 시 폼 전달 시각과 경로 정보가 같은 초를 보존한다", async () => {
        const preciseRoute = {
            ...route(),
            totalDurationSeconds: 3863,
            transitLegs: route().transitLegs?.map(leg => ({ ...leg, durationSeconds: 3863 })),
        };
        mockGetRoutes.mockResolvedValue([preciseRoute]);
        await act(async () => { renderer = TestRenderer.create(<Harness origin={nowon} />); });
        act(() => current!.saveRouteOption(preciseRoute, 0));
        const result = consumeRoutePlannerResult("timing-regression");
        expect(result?.departureAt).toBe(new Date("2026-10-04T01:40:37+09:00").toISOString());
        expect(result?.route).toMatchObject({
            totalDurationSeconds: 3863,
            routeInfo: {
                totalDurationSeconds: 3863,
                departureTime: result?.departureAt,
                arrivalTime: new Date(arrival).toISOString(),
                timeBasis: "estimated",
            },
        });
    });
});
