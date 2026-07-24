import { getScheduleDetailActionPermissions } from "../src/modules/schedule/schedulePermissions";

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
