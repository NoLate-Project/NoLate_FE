import type { ScheduleCategoryItem } from "../../api/scheduleCategories";
import type { ScheduleCalendarRole } from "../../api/scheduleCalendars";

export function isOwnedPersonalScheduleCategory(
    category?: ScheduleCategoryItem | null,
): boolean {
    return Boolean(
        category?.id.trim()
        && (category.calendarId ?? null) === null
        && category.shared !== true,
    );
}

/** 카테고리 공유 관리와 캘린더 이동은 개인 소유자 또는 소속 캘린더 OWNER만 수행합니다. */
export function canManageScheduleCategoryAudience(
    category?: ScheduleCategoryItem | null,
    calendarRole?: ScheduleCalendarRole | null,
): boolean {
    if (!category?.id.trim()) return false;
    if (category.calendarId != null) {
        return calendarRole === "OWNER" && category.canManageAudience !== false;
    }
    return isOwnedPersonalScheduleCategory(category) && category.canManageAudience !== false;
}

export function getCategoryMoveSummary({
    categoryTitle,
    calendarTitle,
    scheduleCount,
}: {
    categoryTitle: string;
    calendarTitle: string;
    scheduleCount: number;
}): string {
    const count = Number.isSafeInteger(scheduleCount) && scheduleCount >= 0
        ? scheduleCount
        : 0;
    return `“${categoryTitle}” 카테고리와 일정 ${count}개를 “${calendarTitle}”으로 이동합니다.`;
}

export const CATEGORY_MOVE_VISIBILITY_NOTICE =
    "카테고리에 포함된 모든 일정이 함께 이동합니다. 기존 카테고리 직접 공유 대상과 보기·편집 권한은 그대로 유지됩니다.";

export const CATEGORY_MOVE_CALENDAR_AUDIENCE_NOTICE =
    "출발·도착 캘린더 양쪽에 참여한 멤버가 있을 수 있어 전체 멤버 수는 실제 접근 증감 인원과 다를 수 있어요.";

export const CATEGORY_MOVE_SAME_NAME_NOTICE =
    "같은 이름의 카테고리가 있어도 공유 권한과 초대 링크를 지키기 위해 별도 카테고리로 유지됩니다.";

export const CATEGORY_MOVE_TRAVEL_VISIBILITY_NOTICE =
    "이 캘린더의 공유 설정에 따라 멤버별 이동 경로 정보도 함께 공유됩니다.";

export function getCategoryMoveAccessImpactLines({
    retainedDirectShareCount,
    retainedDirectScheduleShareCount,
    sourceCalendarMemberCount,
    destinationCalendarMemberCount,
    gainedAccessMemberCount,
    lostAccessMemberCount,
}: {
    retainedDirectShareCount?: number;
    retainedDirectScheduleShareCount?: number;
    sourceCalendarMemberCount?: number;
    destinationCalendarMemberCount?: number;
    gainedAccessMemberCount?: number;
    lostAccessMemberCount?: number;
}): string[] {
    const hasExactDelta = gainedAccessMemberCount !== undefined
        && lostAccessMemberCount !== undefined;
    return [
        ...(retainedDirectShareCount !== undefined
            ? [`기존 직접 공유 ${retainedDirectShareCount}명의 보기·편집 권한은 유지됩니다.`]
            : []),
        ...(retainedDirectScheduleShareCount !== undefined
            && retainedDirectScheduleShareCount > 0
            ? [`포함된 일정의 직접 공유 권한 ${retainedDirectScheduleShareCount}건도 그대로 유지됩니다.`]
            : []),
        ...(hasExactDelta
            ? [
                `이동 후 접근이 끝나는 사람은 ${lostAccessMemberCount}명입니다.`,
                `이동으로 새로 접근할 수 있는 사람은 ${gainedAccessMemberCount}명입니다.`,
            ]
            : [
                ...(sourceCalendarMemberCount !== undefined
                    ? [`출발 캘린더 전체 멤버: ${sourceCalendarMemberCount}명`]
                    : []),
                ...(destinationCalendarMemberCount !== undefined
                    ? [`도착 캘린더 전체 멤버: ${destinationCalendarMemberCount}명`]
                    : []),
            ]),
    ];
}
