import {
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
