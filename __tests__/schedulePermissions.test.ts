import {
    canDeletePresentedSchedule,
    canEditPresentedSchedule,
    getScheduleDetailActionPermissions,
} from "../src/modules/schedule/schedulePermissions";
import type { ScheduleItem, ScheduleSharePermission } from "../src/modules/schedule/types";

describe("schedule detail action permissions", () => {
    test("오너는 공유 대상 관리와 일정 수정을 모두 할 수 있다", () => {
        expect(getScheduleDetailActionPermissions({
            ownerMemberId: 1,
        }, 1)).toEqual({
            canShare: true,
            canEdit: true,
        });
    });

    test("편집자는 일정만 수정하고 공유 대상은 관리하지 않는다", () => {
        expect(getScheduleDetailActionPermissions({
            ownerMemberId: 1,
            sharePermission: "EDITOR",
        }, 2)).toEqual({
            canShare: false,
            canEdit: true,
        });
    });

    test.each(["VIEWER", "COMMENTER"] as const)(
        "%s 권한은 공유 대상 관리와 일정 수정을 모두 숨긴다",
        sharePermission => {
            expect(getScheduleDetailActionPermissions({
                ownerMemberId: 1,
                sharePermission,
            }, 2)).toEqual({
                canShare: false,
                canEdit: false,
            });
        },
    );

    test("소유자 정보가 없는 로컬 일정은 기존처럼 소유 일정으로 취급한다", () => {
        expect(getScheduleDetailActionPermissions({}, null)).toEqual({
            canShare: true,
            canEdit: true,
        });
    });
});

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
