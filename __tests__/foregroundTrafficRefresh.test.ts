import { clearCalendarScheduleCache } from "../src/modules/schedule/calendarScheduleCache";
import { invalidateScheduleDepartureStatus } from "../src/modules/schedule/departureStatusCache";
import { refreshForegroundPushCaches } from "../src/modules/notification/foregroundTrafficRefresh";
import * as env from "../src/api/env";

jest.mock("../src/modules/schedule/calendarScheduleCache", () => ({
    clearCalendarScheduleCache: jest.fn(),
}));

jest.mock("../src/modules/schedule/departureStatusCache", () => ({
    invalidateScheduleDepartureStatus: jest.fn(),
}));

describe("foreground traffic push refresh", () => {
    beforeEach(() => {
        jest.spyOn(env, "getEnv").mockReturnValue("true");
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    test.each([
        "SCHEDULE_SHARE_RECEIVED",
        "CATEGORY_SHARE_RECEIVED",
        "CALENDAR_SHARE_RECEIVED",
        "SCHEDULE_PARTICIPANT_DEPARTED",
        "SCHEDULE_DEPARTURE_NUDGE",
        "SCHEDULE_CACHE_INVALIDATED",
    ])("공유 off에서 %s는 cache/status invalidation을 만들지 않는다", (type) => {
        jest.spyOn(env, "getEnv").mockReturnValue(undefined);

        refreshForegroundPushCaches({ type, scheduleId: "42" });

        expect(clearCalendarScheduleCache).not.toHaveBeenCalled();
        expect(invalidateScheduleDepartureStatus).not.toHaveBeenCalled();
    });

    test("공유 off에서는 owner proof가 있는 traffic만 cache/status를 갱신한다", () => {
        jest.spyOn(env, "getEnv").mockReturnValue(undefined);

        refreshForegroundPushCaches({
            type: "SCHEDULE_TRAFFIC",
            scheduleId: "42",
            ownerMemberId: "7",
            recipientMemberId: "7",
        });

        expect(clearCalendarScheduleCache).toHaveBeenCalledTimes(1);
        expect(invalidateScheduleDepartureStatus).toHaveBeenCalledWith("42");
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

    test.each([
        "SCHEDULE_TRAFFIC",
        "SCHEDULE_DEPARTURE_REMINDER",
        "SCHEDULE_PARTICIPANT_DEPARTED",
        "SCHEDULE_DEPARTURE_NUDGE",
    ])("%s는 일정 store와 departure status를 함께 갱신한다", (type) => {
        refreshForegroundPushCaches({ type, scheduleId: "42" });

        expect(clearCalendarScheduleCache).toHaveBeenCalledTimes(1);
        expect(invalidateScheduleDepartureStatus).toHaveBeenCalledWith("42");
    });
});
