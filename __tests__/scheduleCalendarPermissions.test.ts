import {
    canWriteScheduleCalendar,
    getWritableScheduleCalendars,
} from "../src/modules/schedule/calendarPermissions";
import type { ScheduleCalendar } from "../src/api/scheduleCalendars";

function calendar(
    id: number,
    myRole: ScheduleCalendar["myRole"],
    status: ScheduleCalendar["status"] = "ACTIVE",
): ScheduleCalendar {
    return {
        id,
        title: `캘린더 ${id}`,
        color: "#2F80FF",
        defaultContentMode: "SCHEDULE_ONLY",
        status,
        ownerMemberId: 1,
        myRole,
        memberCount: 2,
        routeReminderEnabled: true,
    };
}

describe("schedule calendar write permission", () => {
    test("활성 캘린더의 소유자와 편집자만 일정 저장 위치로 선택할 수 있다", () => {
        expect(canWriteScheduleCalendar(calendar(1, "OWNER"))).toBe(true);
        expect(canWriteScheduleCalendar(calendar(2, "EDITOR"))).toBe(true);
        expect(canWriteScheduleCalendar(calendar(3, "VIEWER"))).toBe(false);
        expect(canWriteScheduleCalendar(calendar(4, "OWNER", "ARCHIVED"))).toBe(false);
    });

    test("서버 응답 순서를 유지하며 쓰기 가능한 캘린더만 반환한다", () => {
        const result = getWritableScheduleCalendars([
            calendar(1, "VIEWER"),
            calendar(2, "EDITOR"),
            calendar(3, "OWNER"),
            calendar(4, "EDITOR", "ARCHIVED"),
        ]);

        expect(result.map(({ id }) => id)).toEqual([2, 3]);
    });
});
