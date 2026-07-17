import {
    getWritableCalendarImportCategories,
    resolveCalendarImportCategory,
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
            category("", { shared: false }),
        ]);

        expect(result.map((item) => item.id)).toEqual(["owned", "editor", "owner"]);
    });

    test("uses the first verified category when a stale selection is unavailable", () => {
        const categories = [category("first"), category("second")];

        expect(resolveCalendarImportCategory(categories, "second")?.id).toBe("second");
        expect(resolveCalendarImportCategory(categories, "removed")?.id).toBe("first");
        expect(resolveCalendarImportCategory([], "removed")).toBeUndefined();
    });
});
