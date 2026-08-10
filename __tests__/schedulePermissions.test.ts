import {
    canChangePresentedScheduleCalendar,
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

    test("삭제는 캘린더 역할과 무관하게 일정 원작성자에게만 허용한다", () => {
        expect(canDeletePresentedSchedule(schedule(), 10)).toBe(true);
        expect(canDeletePresentedSchedule(schedule("OWNER"), 10)).toBe(true);
        expect(canDeletePresentedSchedule(schedule("EDITOR"), 10)).toBe(true);
        expect(canDeletePresentedSchedule(schedule("OWNER"), 20)).toBe(false);
        expect(canDeletePresentedSchedule(schedule("EDITOR"), 20)).toBe(false);
        expect(canDeletePresentedSchedule(schedule("VIEWER"), 20)).toBe(false);
    });

    test("작성자 정보가 없는 구버전 개인 일정만 삭제 동작을 유지한다", () => {
        const legacyPersonal = { ...schedule(), ownerMemberId: undefined };
        const legacyShared = { ...schedule("OWNER"), ownerMemberId: undefined };

        expect(canDeletePresentedSchedule(legacyPersonal, 20)).toBe(true);
        expect(canDeletePresentedSchedule(legacyShared, 20)).toBe(false);
    });

    test("캘린더 이동은 역할과 무관하게 일정 원작성자에게만 허용한다", () => {
        expect(canChangePresentedScheduleCalendar(schedule("OWNER"), 10)).toBe(true);
        expect(canChangePresentedScheduleCalendar(schedule("EDITOR"), 10)).toBe(true);
        expect(canChangePresentedScheduleCalendar(schedule("OWNER"), 20)).toBe(false);
        expect(canChangePresentedScheduleCalendar(schedule("EDITOR"), 20)).toBe(false);
    });

    test("작성자 정보가 없는 구버전 공유 일정은 캘린더 이동을 막는다", () => {
        const legacyPersonal = { ...schedule(), ownerMemberId: undefined };
        const legacyShared = { ...schedule("EDITOR"), ownerMemberId: undefined };

        expect(canChangePresentedScheduleCalendar(legacyPersonal, 20)).toBe(true);
        expect(canChangePresentedScheduleCalendar(legacyShared, 20)).toBe(false);
    });
});
