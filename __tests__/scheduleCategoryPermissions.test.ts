import {
    canWriteScheduleCategory,
    countOwnedScheduleCategories,
    getWritableScheduleCategories,
    resolveWritableScheduleCategoryId,
} from "../src/modules/schedule/categoryPermissions";
import type { ScheduleCategory } from "../src/modules/schedule/types";

const own: ScheduleCategory = { id: "own", title: "내 일정", color: "#2979FF" };
const viewer: ScheduleCategory = {
    id: "viewer",
    title: "보기 공유",
    color: "#34C759",
    shared: true,
    sharePermission: "VIEWER",
};
const commenter: ScheduleCategory = {
    id: "commenter",
    title: "댓글 공유",
    color: "#FF9500",
    shared: true,
    sharePermission: "COMMENTER",
};
const editor: ScheduleCategory = {
    id: "editor",
    title: "편집 공유",
    color: "#AF52DE",
    shared: true,
    sharePermission: "EDITOR",
};

describe("schedule category write permission", () => {
    test("내 카테고리와 편집 권한 공유 카테고리만 쓰기를 허용한다", () => {
        expect(canWriteScheduleCategory(own)).toBe(true);
        expect(canWriteScheduleCategory(editor)).toBe(true);
        expect(canWriteScheduleCategory(viewer)).toBe(false);
        expect(canWriteScheduleCategory(commenter)).toBe(false);
        expect(canWriteScheduleCategory({ ...own, id: "" })).toBe(false);
    });

    test("일정 생성 선택지에서 읽기 전용 공유 카테고리를 제외한다", () => {
        expect(getWritableScheduleCategories([viewer, own, commenter, editor]).map(({ id }) => id))
            .toEqual(["own", "editor"]);
    });

    test("읽기 전용 선호값 대신 실제 쓰기 가능한 카테고리를 선택한다", () => {
        expect(resolveWritableScheduleCategoryId(viewer, [viewer, own])).toBe("own");
        expect(resolveWritableScheduleCategoryId(viewer, [viewer])).toBe("");
    });
});

describe("owned schedule category count", () => {
    test("받은 공유 카테고리는 최소 보유 카테고리 수에서 제외한다", () => {
        expect(countOwnedScheduleCategories([
            { id: "own", title: "내 일정", color: "#111111" },
            { id: "shared", title: "받은 일정", color: "#222222", shared: true, sharePermission: "EDITOR" },
        ])).toBe(1);
    });
});
