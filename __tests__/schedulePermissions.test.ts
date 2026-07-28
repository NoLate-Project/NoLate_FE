import {
    canDeletePresentedSchedule,
    canEditPresentedSchedule,
} from "../src/modules/schedule/schedulePermissions";
import type { ScheduleItem, ScheduleSharePermission } from "../src/modules/schedule/types";

const schedule = (sharePermission?: ScheduleSharePermission): ScheduleItem => ({
    id: "1",
    ownerMemberId: 10,
    title: "공유 일정",
    startAt: "2026-08-10T04:30:00.000Z",
    endAt: "2026-08-10T04:30:00.000Z",
    category: { id: "1", title: "업무", color: "#f44336" },
    sharePermission,
});

describe("schedule permissions", () => {
    test("오너와 공유 편집자만 일정을 수정할 수 있다", () => {
        expect(canEditPresentedSchedule(schedule(), true)).toBe(true);
        expect(canEditPresentedSchedule(schedule("EDITOR"), false)).toBe(true);
        expect(canEditPresentedSchedule(schedule("OWNER"), false)).toBe(true);
        expect(canEditPresentedSchedule(schedule("VIEWER"), false)).toBe(false);
        expect(canEditPresentedSchedule(schedule("COMMENTER"), false)).toBe(false);
    });

    test("삭제는 받은 편집 공유 일정에 노출하지 않는다", () => {
        expect(canDeletePresentedSchedule(schedule())).toBe(true);
        expect(canDeletePresentedSchedule(schedule("OWNER"))).toBe(true);
        expect(canDeletePresentedSchedule(schedule("EDITOR"))).toBe(false);
        expect(canDeletePresentedSchedule(schedule("VIEWER"))).toBe(false);
    });
});
