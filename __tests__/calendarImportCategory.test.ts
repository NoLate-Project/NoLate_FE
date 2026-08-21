import {
    getCalendarImportSourceKey,
    getWritableCalendarImportCategories,
    groupCalendarImportCategories,
    hasCalendarImportCategoryOverride,
    resolveCalendarImportCategory,
    resolveCalendarImportCategoryAssignment,
} from "../src/modules/onboarding/calendarImportCategory";
import type { ScheduleCategory } from "../src/modules/schedule/types";

const category = (
    id: string,
    overrides: Partial<ScheduleCategory> = {},
): ScheduleCategory => ({
    id,
    title: `category-${id}`,
    color: "#2F80FF",
    ...overrides,
});

describe("calendar import categories", () => {
    test("keeps owned and writable shared categories only", () => {
        const result = getWritableCalendarImportCategories([
            category("owned"),
            category("editor", { shared: true, sharePermission: "EDITOR" }),
            category("owner", { shared: true, sharePermission: "OWNER" }),
            category("viewer", { shared: true, sharePermission: "VIEWER" }),
            category("commenter", { shared: true, sharePermission: "COMMENTER" }),
            category("inconsistent-viewer", { shared: false, sharePermission: "VIEWER" }),
            category("", { shared: false }),
        ]);

        expect(result.map((item) => item.id)).toEqual(["owned", "editor", "owner"]);
    });

    test("groups categories by personal and named shared calendars", () => {
        const result = groupCalendarImportCategories(
            [
                category("personal"),
                category("team-work", { shared: true, calendarId: 21 }),
                category("team-other", { shared: true, calendarId: 21 }),
                category("family", { shared: true, calendarId: 34 }),
            ],
            [
                {
                    id: 21,
                    title: "프로젝트 팀",
                    color: "#246BFE",
                    defaultContentMode: "SCHEDULE_ONLY",
                    status: "ACTIVE",
                    ownerMemberId: 1,
                    myRole: "EDITOR",
                    memberCount: 3,
                    routeReminderEnabled: true,
                },
            ],
        );

        expect(result.map((group) => [group.title, group.scopeLabel])).toEqual([
            ["내 캘린더", "개인 캘린더"],
            ["프로젝트 팀", "공유 캘린더"],
            ["공유 캘린더", "공유 캘린더"],
        ]);
        expect(result[1].categories.map((item) => item.id)).toEqual(["team-work", "team-other"]);
    });

    test("uses the first verified category when a stale selection is unavailable", () => {
        const categories = [category("first"), category("second")];

        expect(resolveCalendarImportCategory(categories, "second")?.id).toBe("second");
        expect(resolveCalendarImportCategory(categories, "removed")?.id).toBe("first");
        expect(resolveCalendarImportCategory([], "removed")).toBeUndefined();
    });

    test("keeps calendar assignments separate across providers", () => {
        expect(getCalendarImportSourceKey({
            provider: "APPLE_DEVICE",
            calendarId: "primary",
        })).not.toBe(getCalendarImportSourceKey({
            provider: "GOOGLE",
            calendarId: "primary",
        }));
    });

    test("uses a source override and falls back when the assigned category was removed", () => {
        const categories = [category("default"), category("work")];
        const sourceKey = getCalendarImportSourceKey({
            provider: "GOOGLE",
            calendarId: "team/calendar",
        });

        expect(resolveCalendarImportCategoryAssignment(
            categories,
            "default",
            { [sourceKey]: "work" },
            sourceKey,
        )?.id).toBe("work");
        expect(resolveCalendarImportCategoryAssignment(
            categories,
            "default",
            { [sourceKey]: "removed" },
            sourceKey,
        )?.id).toBe("default");
    });

    test("marks only a valid category that differs from the current default as an override", () => {
        const categories = [category("default"), category("work")];
        const sourceKey = "GOOGLE:team";

        expect(hasCalendarImportCategoryOverride(
            categories,
            "default",
            { [sourceKey]: "work" },
            sourceKey,
        )).toBe(true);
        expect(hasCalendarImportCategoryOverride(
            categories,
            "default",
            { [sourceKey]: "default" },
            sourceKey,
        )).toBe(false);
        expect(hasCalendarImportCategoryOverride(
            categories,
            "default",
            { [sourceKey]: "removed" },
            sourceKey,
        )).toBe(false);
    });
});
