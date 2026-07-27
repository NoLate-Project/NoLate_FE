import {
    CALENDAR_CACHE_REVISION_POLL_INTERVAL_MS,
    startCalendarCacheRevisionPolling,
} from "../src/modules/schedule/calendarScheduleRevisionPolling";

describe("calendar cache revision polling", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test("focused screen checks the Redis revision every 45 seconds and stops on cleanup", () => {
        const poll = jest.fn();
        const stop = startCalendarCacheRevisionPolling(poll);

        jest.advanceTimersByTime(
            CALENDAR_CACHE_REVISION_POLL_INTERVAL_MS - 1,
        );
        expect(poll).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        expect(poll).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(
            CALENDAR_CACHE_REVISION_POLL_INTERVAL_MS,
        );
        expect(poll).toHaveBeenCalledTimes(2);

        stop();
        jest.advanceTimersByTime(
            CALENDAR_CACHE_REVISION_POLL_INTERVAL_MS * 2,
        );
        expect(poll).toHaveBeenCalledTimes(2);
    });
});
