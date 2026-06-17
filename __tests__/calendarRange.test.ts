import { getMonthRange } from "../src/modules/schedule/calendarRange";

describe("calendar month range", () => {
    test("선택한 달의 시작과 끝을 서버 calendar API 파라미터로 변환한다", () => {
        const result = getMonthRange("2026-06-15");

        expect(result.startAt).toBe(new Date(2026, 5, 1, 0, 0, 0, 0).toISOString());
        expect(result.endAt).toBe(new Date(2026, 6, 1, 0, 0, 0, -1).toISOString());
    });
});
