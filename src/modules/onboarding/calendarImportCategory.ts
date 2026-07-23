import type { ScheduleCategory } from "../schedule/types";
import { canWriteScheduleCategory } from "../schedule/categoryPermissions";

/**
 * The schedule API accepts only a category owned by the member or shared with
 * write permission. Calendar import is a bulk operation, so exposing a
 * read-only category would otherwise make every selected schedule fail.
 */
export function getWritableCalendarImportCategories(
    categories: readonly ScheduleCategory[],
): ScheduleCategory[] {
    return categories.filter(canWriteScheduleCategory);
}

export function resolveCalendarImportCategory(
    categories: readonly ScheduleCategory[],
    selectedCategoryId: string,
): ScheduleCategory | undefined {
    return categories.find((category) => category.id === selectedCategoryId) ?? categories[0];
}
