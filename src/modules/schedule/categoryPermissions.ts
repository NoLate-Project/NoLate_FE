import type { ScheduleCategory } from "./types";
import type { ScheduleCalendarRole } from "../../api/scheduleCalendars";

/** A shared category can receive new or edited schedules only with write permission. */
export function canWriteScheduleCategory(category?: ScheduleCategory | null): boolean {
    if (!category?.id.trim()) return false;
    if (category.sharePermission === "VIEWER" || category.sharePermission === "COMMENTER") {
        return false;
    }
    if (category.shared === true) {
        return category.sharePermission === "EDITOR" || category.sharePermission === "OWNER";
    }
    return true;
}

/**
 * 카테고리 이름·색상·삭제는 개인 소유자 또는 공유 캘린더의 편집자 이상만 관리합니다.
 * 직접 공유로 받은 카테고리의 EDITOR는 그 안의 일정만 편집할 수 있습니다.
 */
export function canManageScheduleCategoryMetadata(
    category?: ScheduleCategory | null,
    calendarRole?: ScheduleCalendarRole | null,
): boolean {
    if (!category?.id.trim()) return false;
    if (category.calendarId != null) {
        const hasWritableCalendarRole = calendarRole === "OWNER" || calendarRole === "EDITOR";
        return hasWritableCalendarRole && category.canManageMetadata !== false;
    }
    if (category.shared === true) return false;
    return category.canManageMetadata !== false;
}

export function getWritableScheduleCategories(
    categories: ScheduleCategory[],
): ScheduleCategory[] {
    return categories.filter(canWriteScheduleCategory);
}

export function resolveWritableScheduleCategoryId(
    preferred: ScheduleCategory | undefined,
    categories: ScheduleCategory[],
): string {
    if (preferred && canWriteScheduleCategory(preferred)) return preferred.id;
    return getWritableScheduleCategories(categories)[0]?.id ?? "";
}

/** 받은 공유 카테고리는 사용자의 '최소 1개 카테고리' 조건에 포함하지 않는다. */
export function countOwnedScheduleCategories(categories: ScheduleCategory[]): number {
    return categories.filter((category) => category.shared !== true).length;
}
