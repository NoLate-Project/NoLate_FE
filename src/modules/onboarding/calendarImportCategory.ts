import type { ScheduleCategory } from "../schedule/types";
import { canWriteScheduleCategory } from "../schedule/categoryPermissions";

export type CalendarImportSourceIdentity = {
    provider: string;
    calendarId: string;
};

export type CalendarImportCategoryAssignments = Readonly<Record<string, string>>;

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

/**
 * Device and Google calendars may expose the same calendar id. Category
 * assignments therefore use the provider and calendar id together instead of
 * grouping by calendar id alone.
 */
export function getCalendarImportSourceKey(source: CalendarImportSourceIdentity): string {
    return `${source.provider}:${encodeURIComponent(source.calendarId.trim())}`;
}

/**
 * A source-specific category overrides the screen's default category. Stale
 * assignments safely fall back when a category was removed while curation was
 * open.
 */
export function resolveCalendarImportCategoryAssignment(
    categories: readonly ScheduleCategory[],
    defaultCategoryId: string,
    assignments: CalendarImportCategoryAssignments,
    sourceKey: string,
): ScheduleCategory | undefined {
    const assignedId = assignments[sourceKey]?.trim();
    if (assignedId) {
        const assigned = categories.find((category) => category.id === assignedId);
        if (assigned) return assigned;
    }

    return resolveCalendarImportCategory(categories, defaultCategoryId);
}

/**
 * The UI only marks a calendar as individually configured when its assignment
 * is valid and actually differs from the current default category.
 */
export function hasCalendarImportCategoryOverride(
    categories: readonly ScheduleCategory[],
    defaultCategoryId: string,
    assignments: CalendarImportCategoryAssignments,
    sourceKey: string,
): boolean {
    const assignedId = assignments[sourceKey]?.trim();
    if (!assignedId || assignedId === defaultCategoryId) return false;
    return categories.some((category) => category.id === assignedId);
}
