import type { ScheduleCategoryItem } from "../../api/scheduleCategories";

export function isOwnedPersonalScheduleCategory(
    category?: ScheduleCategoryItem | null,
): boolean {
    return Boolean(
        category?.id.trim()
        && (category.calendarId ?? null) === null
        && category.shared !== true,
    );
}

export function getCategoryMoveSummary({
    categoryTitle,
    calendarTitle,
    scheduleCount,
    mergeTargetTitle,
}: {
    categoryTitle: string;
    calendarTitle: string;
    scheduleCount: number;
    mergeTargetTitle?: string;
}): string {
    const count = Number.isSafeInteger(scheduleCount) && scheduleCount >= 0
        ? scheduleCount
        : 0;
    if (mergeTargetTitle) {
        return `“${categoryTitle}” 카테고리의 일정 ${count}개를 “${calendarTitle}”의 “${mergeTargetTitle}” 카테고리에 합칩니다.`;
    }
    return `“${categoryTitle}” 카테고리와 일정 ${count}개를 “${calendarTitle}” 공유 캘린더로 이동합니다.`;
}

export const CATEGORY_MOVE_VISIBILITY_NOTICE =
    "카테고리에 포함된 모든 일정이 함께 이동하며, 이동 후에는 공유 캘린더 멤버가 해당 일정을 볼 수 있습니다.";

export const CATEGORY_MOVE_TRAVEL_VISIBILITY_NOTICE =
    "이 캘린더의 공유 설정에 따라 멤버별 이동 경로 정보도 함께 공유됩니다.";
