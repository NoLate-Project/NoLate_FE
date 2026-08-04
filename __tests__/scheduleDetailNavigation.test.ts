import { goBackFromScheduleDetail } from "../src/modules/schedule/scheduleDetailNavigation";

describe("schedule detail back navigation", () => {
    test("returns to the actual entry screen when navigation history exists", () => {
        const router = {
            canGoBack: jest.fn(() => true),
            back: jest.fn(),
            replace: jest.fn(),
        };

        goBackFromScheduleDetail(router);

        expect(router.back).toHaveBeenCalledTimes(1);
        expect(router.replace).not.toHaveBeenCalled();
    });

    test("falls back to the schedule list for a standalone deep link", () => {
        const router = {
            canGoBack: jest.fn(() => false),
            back: jest.fn(),
            replace: jest.fn(),
        };

        goBackFromScheduleDetail(router);

        expect(router.back).not.toHaveBeenCalled();
        expect(router.replace).toHaveBeenCalledWith("/schedule");
    });
});
