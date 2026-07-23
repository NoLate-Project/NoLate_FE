import {
    buildRoutePlannerPlace,
    buildScheduleRoutePlannerInitial,
    consumeScheduleRouteUpdatePayload,
    consumeRoutePlannerResult,
    getRoutePlannerInitial,
    observeRoutePlannerReturn,
    setRoutePlannerInitial,
    setRoutePlannerResult,
} from "../src/modules/schedule/routePlannerSession";

describe("route planner session", () => {
    test("경로 화면으로 전환되기 전에는 빈 결과를 소비하지 않고 실제 복귀 때만 소비한다", () => {
        const beforeNavigation = observeRoutePlannerReturn("/schedule/77", false);
        expect(beforeNavigation).toEqual({
            hasVisitedRouteFlow: false,
            shouldConsumeResult: false,
        });

        const onRouteScreen = observeRoutePlannerReturn(
            "/schedule/route-select",
            beforeNavigation.hasVisitedRouteFlow
        );
        expect(onRouteScreen).toEqual({
            hasVisitedRouteFlow: true,
            shouldConsumeResult: false,
        });

        expect(observeRoutePlannerReturn(
            "/schedule/77",
            onRouteScreen.hasVisitedRouteFlow
        )).toEqual({
            hasVisitedRouteFlow: false,
            shouldConsumeResult: true,
        });
    });

    test("빠른 일정의 초기 목적지와 도착 기준 시각을 왕복 동안 보존한다", () => {
        const sessionId = "quick-session-initial";
        setRoutePlannerInitial(sessionId, {
            destination: { name: "서울역" },
            travelMode: "TRANSIT",
            targetArrivalAt: "2026-07-17T11:00:00.000Z",
        });

        expect(getRoutePlannerInitial(sessionId)).toEqual({
            destination: { name: "서울역" },
            travelMode: "TRANSIT",
            targetArrivalAt: "2026-07-17T11:00:00.000Z",
        });
    });

    test("완료 결과는 소비자가 한 번만 가져간다", () => {
        const sessionId = "quick-session-result";
        setRoutePlannerResult(sessionId, {
            origin: { name: "집", lat: 37.5, lng: 127 },
            destination: { name: "서울역", lat: 37.55, lng: 126.97 },
            travelMode: "TRANSIT",
            travelMinutes: 30,
            departureAt: "2026-07-17T10:30:00.000Z",
        });

        expect(consumeRoutePlannerResult(sessionId)).toMatchObject({
            travelMinutes: 30,
            departureAt: "2026-07-17T10:30:00.000Z",
        });
        expect(consumeRoutePlannerResult(sessionId)).toBeUndefined();
    });

    test("사용자가 경로 설정을 취소하면 적용할 결과가 없다", () => {
        expect(consumeRoutePlannerResult("quick-session-cancelled")).toBeUndefined();
    });

    test("일반 일정의 기존 출발지와 시작 시각을 경로 검색 초기값으로 보존한다", () => {
        const origin = buildRoutePlannerPlace({
            name: "  집  ",
            address: "서울 영등포구",
            lat: 37.5,
            lng: 126.9,
        }, "출발지");
        const destination = buildRoutePlannerPlace({ name: "강남역" }, "도착지");

        const initial = buildScheduleRoutePlannerInitial({
            origin,
            destination,
            travelMode: "TRANSIT",
            travelMinutes: 42,
            targetArrivalAt: new Date("2026-07-17T10:00:00.000Z"),
        });

        expect(initial).toMatchObject({
            origin: {
                name: "집",
                address: "서울 영등포구",
                lat: 37.5,
                lng: 126.9,
            },
            destination: { name: "강남역" },
            travelMode: "TRANSIT",
            travelMinutes: 42,
            targetArrivalAt: "2026-07-17T10:00:00.000Z",
        });
    });

    test("일정 상세에서 선택한 경로 결과를 실제 일정 갱신 payload로 한 번 변환한다", () => {
        const sessionId = "schedule-detail-save-result";
        const item = {
            id: "77",
            ownerMemberId: 12,
            title: "기존 일정",
            startAt: "2026-07-17T10:00:00.000Z",
            endAt: "2026-07-17T11:00:00.000Z",
            hasEndTime: true,
            category: { id: "work", title: "업무", color: "#2979FF" },
            notes: "보존할 메모",
            notificationEnabled: true,
            updatedAt: "2026-07-16T00:00:00.000Z",
        };
        const selectedRoute = { routeInfo: { totalDurationMinutes: 35 } };
        setRoutePlannerResult(sessionId, {
            origin: { name: "집", lat: 37.5, lng: 126.9 },
            destination: { name: "강남역", lat: 37.49, lng: 127.02 },
            travelMode: "TRANSIT",
            travelMinutes: 35,
            departureAt: "2026-07-17T09:25:00.000Z",
            route: selectedRoute,
        });

        const payload = consumeScheduleRouteUpdatePayload(sessionId, item);

        expect(payload).toMatchObject({
            title: "기존 일정",
            notes: "보존할 메모",
            notificationEnabled: true,
            origin: { name: "집", lat: 37.5, lng: 126.9 },
            destination: { name: "강남역", lat: 37.49, lng: 127.02 },
            locationName: "집 → 강남역",
            travelMode: "TRANSIT",
            travelMinutes: 35,
            departAt: "2026-07-17T09:25:00.000Z",
            route: selectedRoute,
        });
        expect(payload).not.toHaveProperty("id");
        expect(payload).not.toHaveProperty("updatedAt");
        expect(consumeScheduleRouteUpdatePayload(sessionId, item)).toBeUndefined();
    });
});
