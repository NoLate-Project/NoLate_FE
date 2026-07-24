import {
    createDepartureStatusRefreshController,
    handleDepartureStatusAppStateChange,
    shouldFetchDepartureStatus,
    shouldRefreshDepartureStatusOnAppStateChange,
} from "../src/modules/schedule/departureStatusRefresh";

describe("departure status scheduled refresh", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

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

        controller.schedule({ nextCheckAt: "2026-07-24T00:01:00Z", active: true, refresh, nowMs: now });
        controller.schedule({ nextCheckAt: "2026-07-24T00:02:00Z", active: true, refresh, nowMs: now });
        jest.advanceTimersByTime(120_000);

        expect(refresh).toHaveBeenCalledTimes(1);
    });

    test("dispose 뒤 timer와 late callback은 실행되지 않는다", () => {
        const refresh = jest.fn();
        const controller = createDepartureStatusRefreshController();
        const now = Date.parse("2026-07-24T00:00:00Z");

        controller.schedule({ nextCheckAt: "2026-07-24T00:01:00Z", active: true, refresh, nowMs: now });
        controller.dispose();
        jest.runOnlyPendingTimers();
        controller.schedule({ nextCheckAt: "2026-07-24T00:02:00Z", active: true, refresh, nowMs: now });
        jest.runOnlyPendingTimers();

        expect(refresh).not.toHaveBeenCalled();
    });

    test("cached past nextCheck와 offline 실패는 1m→2m→5m→15m으로 제한한다", () => {
        const refresh = jest.fn();
        const controller = createDepartureStatusRefreshController();
        const now = Date.parse("2026-07-24T00:00:00Z");
        const schedulePast = () => controller.schedule({
            nextCheckAt: "2026-07-23T23:59:00Z",
            active: true,
            refresh,
            nowMs: now,
        });

        schedulePast();
        jest.advanceTimersByTime(59_999);
        expect(refresh).toHaveBeenCalledTimes(0);
        jest.advanceTimersByTime(1);
        expect(refresh).toHaveBeenCalledTimes(1);

        controller.recordFailure();
        schedulePast();
        jest.advanceTimersByTime(60_000);
        expect(refresh).toHaveBeenCalledTimes(2);

        controller.recordFailure();
        schedulePast();
        jest.advanceTimersByTime(2 * 60_000);
        expect(refresh).toHaveBeenCalledTimes(3);

        controller.recordFailure();
        schedulePast();
        jest.advanceTimersByTime(5 * 60_000);
        expect(refresh).toHaveBeenCalledTimes(4);

        controller.recordFailure();
        schedulePast();
        jest.advanceTimersByTime(15 * 60_000);
        expect(refresh).toHaveBeenCalledTimes(5);
    });

    test("inactive/종료 상태는 timer를 중단한다", () => {
        const refresh = jest.fn();
        const controller = createDepartureStatusRefreshController();
        controller.schedule({
            nextCheckAt: "2026-07-23T23:59:00Z",
            active: false,
            refresh,
            nowMs: Date.parse("2026-07-24T00:00:00Z"),
        });
        jest.runOnlyPendingTimers();
        expect(refresh).not.toHaveBeenCalled();
    });
});
