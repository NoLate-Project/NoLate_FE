import { clearCalendarScheduleCache } from "../src/modules/schedule/calendarScheduleCache";
import { invalidateScheduleDepartureStatus } from "../src/modules/schedule/departureStatusCache";
import { refreshForegroundPushCaches } from "../src/modules/notification/foregroundTrafficRefresh";

jest.mock("../src/modules/schedule/calendarScheduleCache", () => ({
    clearCalendarScheduleCache: jest.fn(),
}));

jest.mock("../src/modules/schedule/departureStatusCache", () => ({
    invalidateScheduleDepartureStatus: jest.fn(),
}));

describe("foreground traffic push refresh", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test("SCHEDULE_TRAFFIC은 일정 cache와 해당 departure status query를 함께 갱신한다", () => {
        refreshForegroundPushCaches({
            type: "SCHEDULE_TRAFFIC",
            scheduleId: "42",
        });

        expect(clearCalendarScheduleCache).toHaveBeenCalledTimes(1);
        expect(invalidateScheduleDepartureStatus).toHaveBeenCalledWith("42");
    });

    test("잘못된 scheduleId는 전체 일정 cache만 갱신하고 status 대상은 만들지 않는다", () => {
        refreshForegroundPushCaches({
            type: "SCHEDULE_TRAFFIC",
            scheduleId: "0",
        });

        expect(clearCalendarScheduleCache).toHaveBeenCalledTimes(1);
        expect(invalidateScheduleDepartureStatus).not.toHaveBeenCalled();
    });
});
