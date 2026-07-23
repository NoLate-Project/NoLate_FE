import type { ScheduleCategory } from "./types";

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
