import { isOverlappingDay } from "../lib/util/data";

describe("schedule day overlap", () => {
    test("자정의 종료 시각 없는 일정도 시작 날짜에 표시한다", () => {
        expect(isOverlappingDay(
            "2026-07-17T00:00:00+09:00",
            "2026-07-17T00:00:00+09:00",
            "2026-07-17"
        )).toBe(true);
    });

    test("유효하지 않은 종료 시각은 시작 시각의 단일 이벤트로 처리한다", () => {
        expect(isOverlappingDay(
            "2026-07-17T19:00:00+09:00",
            "invalid",
            "2026-07-17"
        )).toBe(true);
        expect(isOverlappingDay(
            "invalid",
            "2026-07-17T20:00:00+09:00",
            "2026-07-17"
        )).toBe(false);
    });

    test("다음 날 자정에 시작하는 일정은 이전 날짜에 표시하지 않는다", () => {
        expect(isOverlappingDay(
            "2026-07-18T00:00:00+09:00",
            "2026-07-18T01:00:00+09:00",
            "2026-07-17"
        )).toBe(false);
    });
});
