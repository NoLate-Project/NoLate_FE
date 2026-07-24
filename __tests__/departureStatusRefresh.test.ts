import {
    createDepartureStatusRefreshController,
    getDepartureStatusRefreshDelay,
    handleDepartureStatusAppStateChange,
    shouldFetchDepartureStatus,
    shouldRefreshDepartureStatusOnAppStateChange,
} from "../src/modules/schedule/departureStatusRefresh";

describe("departure status scheduled refresh", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test("nextCheckAt을 안전한 15초~15분 범위로 제한한다", () => {
        const now = Date.parse("2026-07-24T00:00:00Z");
        expect(getDepartureStatusRefreshDelay("2026-07-23T23:00:00Z", now)).toBe(15_000);
        expect(getDepartureStatusRefreshDelay("2026-07-24T00:05:00Z", now)).toBe(300_000);
        expect(getDepartureStatusRefreshDelay("2026-07-24T02:00:00Z", now)).toBe(900_000);
        expect(getDepartureStatusRefreshDelay("invalid", now)).toBeUndefined();
    });

    test("background/inactive에서 active로 복귀할 때만 새로고침한다", () => {
        expect(shouldRefreshDepartureStatusOnAppStateChange("background", "active")).toBe(true);
        expect(shouldRefreshDepartureStatusOnAppStateChange("inactive", "active")).toBe(true);
        expect(shouldRefreshDepartureStatusOnAppStateChange("active", "active")).toBe(false);
        expect(shouldRefreshDepartureStatusOnAppStateChange("active", "background")).toBe(false);

        const reloadMountedScheduleAndStatus = jest.fn();
        expect(handleDepartureStatusAppStateChange(
            "background",
            "active",
            reloadMountedScheduleAndStatus,
        )).toBe("active");
        expect(reloadMountedScheduleAndStatus).toHaveBeenCalledTimes(1);
        handleDepartureStatusAppStateChange(
            "active",
            "active",
            reloadMountedScheduleAndStatus,
        );
        expect(reloadMountedScheduleAndStatus).toHaveBeenCalledTimes(1);
    });

    test("이동 협업이 꺼진 일정은 status API를 호출하지 않는다", () => {
        expect(shouldFetchDepartureStatus({
            scheduleLoaded: true,
            authResolved: true,
            travelCollaborationEnabled: false,
        })).toBe(false);
        expect(shouldFetchDepartureStatus({
            scheduleLoaded: true,
            authResolved: true,
            travelCollaborationEnabled: null,
        })).toBe(true);
    });

    test("reschedule은 이전 timer를 취소해 한 번만 refresh한다", () => {
        const refresh = jest.fn();
        const controller = createDepartureStatusRefreshController();
        const now = Date.parse("2026-07-24T00:00:00Z");

        controller.schedule("2026-07-24T00:01:00Z", refresh, now);
        controller.schedule("2026-07-24T00:02:00Z", refresh, now);
        jest.advanceTimersByTime(120_000);

        expect(refresh).toHaveBeenCalledTimes(1);
    });

    test("dispose 뒤 timer와 late callback은 실행되지 않는다", () => {
        const refresh = jest.fn();
        const controller = createDepartureStatusRefreshController();
        const now = Date.parse("2026-07-24T00:00:00Z");

        controller.schedule("2026-07-24T00:01:00Z", refresh, now);
        controller.dispose();
        jest.runOnlyPendingTimers();
        controller.schedule("2026-07-24T00:02:00Z", refresh, now);
        jest.runOnlyPendingTimers();

        expect(refresh).not.toHaveBeenCalled();
    });
});
