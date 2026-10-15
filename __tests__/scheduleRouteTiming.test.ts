import {
    hasPersistableScheduleRoute,
    reconcileScheduleRouteTiming,
    resolveScheduleRouteDepartureContext,
    resolveSelectedRouteTiming,
} from "../src/modules/schedule/scheduleRouteTiming";

describe("schedule route timing", () => {
    const now = new Date("2026-07-17T01:20:00.000Z");

    test("일정 도착 시각에서 실제 이동 시간을 빼 출발 시각을 계산한다", () => {
        const result = resolveScheduleRouteDepartureContext(
            "2026-07-20T11:00:00.000Z",
            33,
            now
        );

        expect(result.scheduleBased).toBe(true);
        expect(result.departureAt.toISOString()).toBe("2026-07-20T10:27:00.000Z");
    });

    test("첫 경로 조회는 한 시간 전을 안전한 탐색 기준으로 사용한다", () => {
        const result = resolveScheduleRouteDepartureContext(
            "2026-07-20T11:00:00.000Z",
            undefined,
            now
        );

        expect(result.departureAt.toISOString()).toBe("2026-07-20T10:00:00.000Z");
    });

    test("자정을 넘는 일정도 전날 출발 시각으로 계산한다", () => {
        const result = resolveScheduleRouteDepartureContext(
            "2026-07-20T00:15:00.000Z",
            45,
            now
        );

        expect(result.departureAt.toISOString()).toBe("2026-07-19T23:30:00.000Z");
    });

    test.each([undefined, "invalid", "2026-07-17T00:00:00.000Z"])(
        "도착 시각 %p를 사용할 수 없으면 현재 시각으로 돌아간다",
        (targetArrivalAt) => {
            const result = resolveScheduleRouteDepartureContext(targetArrivalAt, 33, now);
            expect(result.scheduleBased).toBe(false);
            expect(result.departureAt.toISOString()).toBe("2026-07-17T01:20:00.000Z");
        }
    );
});

describe("selected route save timing", () => {
    const now = new Date("2026-07-17T01:20:00.000Z");
    const targetArrivalAt = "2026-07-20T11:00:00.000Z";

    test("원본 초가 있으면 올림된 분 대신 초로 역산해 저장한다", () => {
        const result = resolveSelectedRouteTiming({
            targetArrivalAt,
            routeInfo: { totalDurationMinutes: 65, totalDurationSeconds: 3863, timeBasis: "estimated" },
            now,
        });
        expect(result.departureAt.toISOString()).toBe("2026-07-20T09:55:37.000Z");
        expect(result.arrivalAt.toISOString()).toBe(targetArrivalAt);
        expect(result.arrivalAt.getTime() - result.departureAt.getTime()).toBe(3863_000);
        expect(result.source).toBe("schedule_arrival");
    });

    test.each([undefined, NaN, Infinity, -1, 0])("잘못되거나 없는 초 %p는 기존 분 단위 경로로 계산한다", (seconds) => {
        const result = resolveSelectedRouteTiming({
            targetArrivalAt,
            routeInfo: { totalDurationMinutes: 65, totalDurationSeconds: seconds },
            now,
        });
        expect(result.departureAt.toISOString()).toBe("2026-07-20T09:55:00.000Z");
        expect(result.arrivalAt.toISOString()).toBe(targetArrivalAt);
    });

    test.each([true, false])("목표가 없을 때도 출발 기준의 원본 초를 보존한다 (경로 기준 %p)", (withRouteTime) => {
        const result = resolveSelectedRouteTiming({
            routeInfo: {
                totalDurationMinutes: 2,
                totalDurationSeconds: 65,
                departureTime: withRouteTime ? "2026-07-20T23:59:30.000Z" : undefined,
            },
            fallbackDepartureAt: "2026-07-20T23:59:30.000Z",
            now,
        });
        expect(result.arrivalAt.toISOString()).toBe("2026-07-21T00:00:35.000Z");
    });

    test("출발을 현재로 제한해도 원본 초를 더하며 목표 도착으로 강제하지 않는다", () => {
        const result = resolveSelectedRouteTiming({
            targetArrivalAt: "2026-07-17T01:21:00.000Z",
            routeInfo: { totalDurationMinutes: 2, totalDurationSeconds: 95 },
            now,
        });
        expect(result.departureAt.toISOString()).toBe(now.toISOString());
        expect(result.arrivalAt.toISOString()).toBe("2026-07-17T01:21:35.000Z");
    });

    test("초 정밀 경로는 현재 분 안의 과거 출발도 실제 현재 시각으로 제한한다", () => {
        const result = resolveSelectedRouteTiming({
            targetArrivalAt: "2026-07-17T01:21:00.000Z",
            routeInfo: { totalDurationMinutes: 1, totalDurationSeconds: 30 },
            now: new Date("2026-07-17T01:20:50.000Z"),
        });
        expect(result.departureAt.toISOString()).toBe("2026-07-17T01:20:50.000Z");
        expect(result.arrivalAt.toISOString()).toBe("2026-07-17T01:21:20.000Z");
    });

    test.each([undefined, 0, NaN, 1e308, 1e14])("무효 원본 초 %p는 분 단위 정렬을 포함한 기존 정책을 보존한다", (seconds) => {
        const result = resolveSelectedRouteTiming({
            targetArrivalAt: "2026-07-20T11:00:45.123Z",
            routeInfo: { totalDurationMinutes: 65, totalDurationSeconds: seconds },
            now,
        });
        expect(result.departureAt.toISOString()).toBe("2026-07-20T09:55:00.000Z");
        expect(result.arrivalAt.toISOString()).toBe("2026-07-20T11:00:00.000Z");
    });

    test.each([
        ["대중교통 추정", 33, "2026-07-20T10:27:00.000Z"],
        ["자동차", 47, "2026-07-20T10:13:00.000Z"],
        ["도보", 18, "2026-07-20T10:42:00.000Z"],
        ["자전거", 26, "2026-07-20T10:34:00.000Z"],
    ])("%s 경로는 최종 선택 후보의 소요시간으로 출발 시각을 확정한다", (_mode, minutes, expected) => {
        const result = resolveSelectedRouteTiming({
            targetArrivalAt,
            routeInfo: {
                totalDurationMinutes: minutes,
                departureTime: "2026-07-20T10:00:00.000Z",
                arrivalTime: "2026-07-20T10:33:00.000Z",
                timeBasis: "estimated",
            },
            now,
        });

        expect(result.source).toBe("schedule_arrival");
        expect(result.departureAt.toISOString()).toBe(expected);
        expect(result.arrivalAt.toISOString()).toBe(targetArrivalAt);
    });

    test("첫 조회 추정치가 아니라 사용자가 고른 느린 후보를 기준으로 다시 계산한다", () => {
        const result = resolveSelectedRouteTiming({
            targetArrivalAt,
            routeInfo: {
                totalDurationMinutes: 90,
                departureTime: "2026-07-20T10:00:00.000Z",
                arrivalTime: "2026-07-20T11:30:00.000Z",
                timeBasis: "estimated",
            },
            fallbackDepartureAt: "2026-07-20T10:00:00.000Z",
            now,
        });

        expect(result.departureAt.toISOString()).toBe("2026-07-20T09:30:00.000Z");
        expect(result.arrivalAt.toISOString()).toBe(targetArrivalAt);
    });

    test("공급자 실제 시간표가 있으면 조회 요청 시각보다 실제 출·도착 시각을 우선한다", () => {
        const result = resolveSelectedRouteTiming({
            targetArrivalAt,
            routeInfo: {
                totalDurationMinutes: 31,
                departureTime: "2026-07-20T10:06:00.000Z",
                arrivalTime: "2026-07-20T10:37:00.000Z",
                timeBasis: "provider_schedule",
            },
            fallbackDepartureAt: "2026-07-20T10:00:00.000Z",
            now,
        });

        expect(result.source).toBe("provider_schedule");
        expect(result.departureAt.toISOString()).toBe("2026-07-20T10:06:00.000Z");
        expect(result.arrivalAt.toISOString()).toBe("2026-07-20T10:37:00.000Z");
    });

    test("일정 도착 기준이 없으면 선택 routeInfo의 출발 시각을 보존한다", () => {
        const result = resolveSelectedRouteTiming({
            routeInfo: {
                totalDurationMinutes: 24,
                departureTime: "2026-07-20T08:15:00.000Z",
                arrivalTime: "2026-07-20T08:39:00.000Z",
                timeBasis: "estimated",
            },
            fallbackDepartureAt: "2026-07-20T07:00:00.000Z",
            now,
        });

        expect(result.source).toBe("route_info");
        expect(result.departureAt.toISOString()).toBe("2026-07-20T08:15:00.000Z");
        expect(result.arrivalAt.toISOString()).toBe("2026-07-20T08:39:00.000Z");
    });

    test("최종 선택 경로는 6시간을 넘더라도 실제 소요시간을 자르지 않는다", () => {
        const result = resolveSelectedRouteTiming({
            targetArrivalAt,
            routeInfo: {
                totalDurationMinutes: 7 * 60,
                departureTime: "2026-07-20T05:00:00.000Z",
                arrivalTime: targetArrivalAt,
                timeBasis: "estimated",
            },
            now,
        });

        expect(result.departureAt.toISOString()).toBe("2026-07-20T04:00:00.000Z");
        expect(result.arrivalAt.toISOString()).toBe(targetArrivalAt);
    });
});

describe("schedule edit route timing reconciliation", () => {
    const routeInfo = {
        id: "transit-1",
        originName: "출발지",
        destinationName: "도착지",
        totalDurationMinutes: 31,
        departureTime: "2026-07-20T10:06:00.000Z",
        arrivalTime: "2026-07-20T10:37:00.000Z",
        timeBasis: "provider_schedule" as const,
        steps: [{
            id: "drive-1",
            type: "DRIVE" as const,
            title: "차량 이동",
            coordinates: [
                { latitude: 37.56, longitude: 126.97 },
                { latitude: 37.5, longitude: 127.03 },
            ],
        }],
    };
    const route = {
        id: "transit-1",
        mode: "TRANSIT" as const,
        minutes: 31,
        source: "api" as const,
        providerDepartureAt: routeInfo.departureTime,
        providerArrivalAt: routeInfo.arrivalTime,
        pathCoords: [
            { lat: 37.56, lng: 126.97 },
            { lat: 37.5, lng: 127.03 },
        ],
        routeInfo,
    };

    test("이동수단 기본값만 있거나 경로만 비어 있으면 저장 가능한 경로가 아니다", () => {
        expect(hasPersistableScheduleRoute(undefined, undefined)).toBe(false);
        expect(hasPersistableScheduleRoute(undefined, 23)).toBe(false);
        expect(hasPersistableScheduleRoute({ id: "car-1" }, undefined)).toBe(false);
        expect(hasPersistableScheduleRoute({ routeInfo: { ...routeInfo, steps: [] } }, 31))
            .toBe(false);
        expect(hasPersistableScheduleRoute(route, 31)).toBe(true);
        expect(hasPersistableScheduleRoute({ routeInfo }, undefined)).toBe(true);
    });

    test("환승 경로의 공간 정보는 목표 시각 수정 후에도 저장 가능하다", () => {
        const origin = { name: "노원역", lat: 37.6551, lng: 127.061 };
        const transfer = { name: "사당", lat: 37.4765, lng: 126.9816 };
        const destination = { name: "신림역", lat: 37.4842, lng: 126.9297 };
        const selected = {
            id: "fixture-route", mode: "TRANSIT", minutes: 65, provider: "tmap", source: "tmap",
            pathCoords: [origin, transfer, destination],
            transitLegs: [
                { mode: "SUBWAY", lineName: "수도권 4호선", durationMinutes: 48,
                    startName: "노원역", endName: "사당", startCoord: origin, endCoord: transfer },
                { mode: "SUBWAY", lineName: "수도권 2호선", durationMinutes: 8,
                    startName: "사당", endName: "신림", startCoord: transfer, endCoord: destination },
            ],
        };
        expect(hasPersistableScheduleRoute(selected, 65, origin, destination)).toBe(true);
        const result = reconcileScheduleRouteTiming({
            route: selected, travelMinutes: 65,
            plannedArrivalAt: "2026-10-05T12:15:00Z", nextArrivalAt: "2026-10-05T12:20:00Z",
        });
        expect(hasPersistableScheduleRoute(result.route, 65, origin, destination)).toBe(true);
        expect(result.route).toEqual(expect.objectContaining({
            pathCoords: selected.pathCoords, transitLegs: selected.transitLegs,
        }));
    });

    test("일정 시작 시각이 그대로면 선택한 공급자 시간표를 보존한다", () => {
        const result = reconcileScheduleRouteTiming({
            departAt: routeInfo.departureTime,
            route,
            travelMinutes: 31,
            plannedArrivalAt: "2026-07-20T11:00:00.000Z",
            nextArrivalAt: "2026-07-20T11:00:00.000Z",
        });

        expect(result.departAt).toBe(routeInfo.departureTime);
        expect(result.route).toBe(route);
    });

    test("경로 선택 후 시작 시각을 바꾸면 출발 알림과 routeInfo를 함께 맞춘다", () => {
        const result = reconcileScheduleRouteTiming({
            departAt: routeInfo.departureTime,
            route,
            travelMinutes: 31,
            plannedArrivalAt: "2026-07-20T11:00:00.000Z",
            nextArrivalAt: "2026-07-20T12:30:00.000Z",
        });
        const nextRoute = result.route as typeof route;

        expect(result.departAt).toBe("2026-07-20T11:59:00.000Z");
        expect(nextRoute.pathCoords).toBe(route.pathCoords);
        expect(nextRoute.providerDepartureAt).toBeUndefined();
        expect(nextRoute.providerArrivalAt).toBeUndefined();
        expect(nextRoute.routeInfo).toMatchObject({
            departureTime: "2026-07-20T11:59:00.000Z",
            arrivalTime: "2026-07-20T12:30:00.000Z",
            timeBasis: "estimated",
        });
    });

    test("일정 변경 후에도 원본 초를 유지해 분 올림이 누적되지 않는다", () => {
        const result = reconcileScheduleRouteTiming({
            route: { ...route, routeInfo: { ...routeInfo, totalDurationSeconds: 1817 } },
            travelMinutes: 31,
            plannedArrivalAt: "2026-07-20T11:00:00.000Z",
            nextArrivalAt: "2026-07-20T12:30:00.000Z",
        });
        expect(result.departAt).toBe("2026-07-20T11:59:43.000Z");
        expect((result.route as typeof route).routeInfo).toMatchObject({
            totalDurationSeconds: 1817,
            arrivalTime: "2026-07-20T12:30:00.000Z",
            timeBasis: "estimated",
        });
    });

    test("손상된 초 값으로 일정 변경 저장이 중단되지 않는다", () => {
        const result = reconcileScheduleRouteTiming({
            route: { ...route, routeInfo: { ...routeInfo, totalDurationSeconds: 1e308 } },
            travelMinutes: 31,
            plannedArrivalAt: "2026-07-20T11:00:00.000Z",
            nextArrivalAt: "2026-07-20T12:30:00.000Z",
        });
        expect(result.departAt).toBe("2026-07-20T11:59:00.000Z");
    });
});
