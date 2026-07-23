import { isCurrentScheduleShareRequest } from "../src/modules/schedule/shareRequestGuard";

describe("schedule share request guard", () => {
    test("현재 열려 있는 같은 리소스의 최신 응답만 반영한다", () => {
        expect(isCurrentScheduleShareRequest("schedule:2", "schedule:2", 4, 4)).toBe(true);
    });

    test.each([
        [null, "schedule:2", 4, 4],
        ["schedule:3", "schedule:2", 4, 4],
        ["schedule:2", "schedule:2", 5, 4],
    ] as const)("닫힘·리소스 변경·구형 응답을 무시한다", (activeKey, requestKey, current, request) => {
        expect(isCurrentScheduleShareRequest(activeKey, requestKey, current, request)).toBe(false);
    });
});
