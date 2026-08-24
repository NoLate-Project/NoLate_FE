import type { ScheduleCategory } from "../schedule/types";
import { canWriteScheduleCategory } from "../schedule/categoryPermissions";
import type { ScheduleCalendar } from "../../api/scheduleCalendars";

export type CalendarImportSourceIdentity = {
    provider: string;
    calendarId: string;
};

export type CalendarImportCategoryAssignments = Readonly<Record<string, string>>;

export type CalendarImportCategoryGroup = {
    key: string;
    title: string;
    scopeLabel: "개인 캘린더" | "공유 캘린더" | "공유받은 카테고리";
    calendarId: number | null;
    categories: ScheduleCategory[];
};

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

/** 저장 대상을 개인 캘린더와 공유 캘린더별로 나눠 같은 이름의 카테고리도 구분해 보여 줍니다. */
export function groupCalendarImportCategories(
    categories: readonly ScheduleCategory[],
    calendars: readonly ScheduleCalendar[],
): CalendarImportCategoryGroup[] {
    const groups: CalendarImportCategoryGroup[] = [];
    const personal = categories.filter((category) => category.calendarId == null && category.shared !== true);
    if (personal.length > 0) {
        groups.push({
            key: "personal",
            title: "내 캘린더",
            scopeLabel: "개인 캘린더",
            calendarId: null,
            categories: personal,
        });
    }

    const sharedCalendarIds = Array.from(new Set(
        categories
            .map((category) => category.calendarId)
            .filter((calendarId): calendarId is number => typeof calendarId === "number"),
    ));
    for (const calendarId of sharedCalendarIds) {
        const calendar = calendars.find((candidate) => candidate.id === calendarId);
        groups.push({
            key: `calendar:${calendarId}`,
            title: calendar?.title?.trim() || "공유 캘린더",
            scopeLabel: "공유 캘린더",
            calendarId,
            categories: categories.filter((category) => category.calendarId === calendarId),
        });
    }

    const legacyShared = categories.filter(
        (category) => category.calendarId == null && category.shared === true,
    );
    if (legacyShared.length > 0) {
        groups.push({
            key: "shared-category",
            title: "공유받은 카테고리",
            scopeLabel: "공유받은 카테고리",
            calendarId: null,
            categories: legacyShared,
        });
    }

    return groups;
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
