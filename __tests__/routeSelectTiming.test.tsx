import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import type { RouteAlternativeOption } from "../src/modules/map/routingService";
import { consumeRoutePlannerResult, setRoutePlannerInitial } from "../src/modules/schedule/routePlannerSession";
import { formatRouteTimeFare } from "../src/routeSupport/schedule/routeSelectRouteModel";
import { useRouteSelectRouteController } from "../src/routeSupport/schedule/useRouteSelectRouteController";

const mockGetRoutes = jest.fn();
const mockRouter = { canGoBack: () => true, back: jest.fn(), push: jest.fn(), replace: jest.fn() };

jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("../src/modules/map/routingService", () => ({
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
        ["unknown", "운행 시간 확인 필요"],
        ["not_operating", "운행 종료"],
    ] as const)("%s 경로는 실제 도착시각을 암시하지 않는다", (state, label) => {
        expect(formatRouteTimeFare({ ...route(), transitServiceState: state, fareWon: 2000 }, previousDeparture, {
            targetArrivalAt: arrival,
        })).toBe(`${label} · 2,000원`);
    });

    test("도착 목표가 없는 일반 검색은 검색 출발시각 기준을 유지한다", () => {
        expect(formatRouteTimeFare(route(), previousDeparture)).toBe("오전 3:36 예상 도착");
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
    const initial = {
        origin: originalOrigin,
        destination,
        travelMode: "TRANSIT" as const,
        travelMinutes: 14,
        targetArrivalAt: arrival,
    };

    function Harness({ origin = originalOrigin, targetArrivalAt = arrival }: {
        origin?: typeof originalOrigin;
        targetArrivalAt?: string;
    }) {
        current = useRouteSelectRouteController({
            initial: { ...initial, targetArrivalAt },
            initialTravelMode: "TRANSIT",
            sessionId: "timing-regression",
            origin,
            destination,
            hasRouteCoords: true,
            shouldShowRouteResults: false,
            bottomInset: 0,
            originText: origin.name,
            originLat: origin.lat,
            originLng: origin.lng,
            destinationText: destination.name,
            destinationLat: destination.lat,
            destinationLng: destination.lng,
        });
        return null;
    }

    beforeEach(() => {
        setRoutePlannerInitial("timing-regression", initial);
        mockGetRoutes.mockImplementation((origin: typeof originalOrigin) =>
            Promise.resolve([route(origin.lat === originalOrigin.lat ? 14 : 65)]));
    });

    afterEach(() => {
        act(() => renderer?.unmount());
    });

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
