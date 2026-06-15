import { getScheduleIdFromNotificationData } from "../src/modules/notification/pushNavigation";

describe("schedule push navigation payload", () => {
    test("Android와 iOS가 공유하는 문자열 scheduleId를 반환한다", () => {
        expect(getScheduleIdFromNotificationData({ scheduleId: "42" })).toBe("42");
    });

    test("앞뒤 공백을 제거해 동일 일정으로 이동한다", () => {
        expect(getScheduleIdFromNotificationData({ scheduleId: "  42  " })).toBe("42");
    });

    test.each([
        undefined,
        {},
        { scheduleId: "" },
        { scheduleId: "   " },
        { scheduleId: 42 },
        { scheduleId: null },
    ])("잘못된 payload에서는 화면 이동을 하지 않는다: %p", (data) => {
        expect(getScheduleIdFromNotificationData(data as Record<string, unknown> | undefined)).toBeUndefined();
    });
});
