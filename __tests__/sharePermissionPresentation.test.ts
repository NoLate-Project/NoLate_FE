import {
    getCategorySharePermissionLabel,
    getScheduleShareBadgeLabel,
} from "../src/modules/share/sharePermissionPresentation";

describe("share permission presentation", () => {
    test.each([
        ["VIEWER", "보기 공유", "보기 권한"],
        ["COMMENTER", "댓글 공유", "댓글 가능"],
        ["EDITOR", "편집 공유", "편집 가능"],
        ["OWNER", "소유 공유", "소유 권한"],
    ] as const)("reflects %s instead of collapsing permissions", (permission, schedule, category) => {
        expect(getScheduleShareBadgeLabel(permission)).toBe(schedule);
        expect(getCategorySharePermissionLabel(permission)).toBe(category);
    });

    test("keeps a safe legacy fallback when permission metadata is absent", () => {
        expect(getScheduleShareBadgeLabel()).toBe("공유됨");
        expect(getCategorySharePermissionLabel()).toBe("공유 권한");
    });
});
