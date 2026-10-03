import type { ScheduleItem } from "./types";

/** 받은 일정은 서버가 계산한 최종 공유 권한이 편집 이상일 때 수정할 수 있다. */
export function canEditPresentedSchedule(
    item: ScheduleItem | undefined,
    isOwner: boolean,
): boolean {
    if (!item) return false;
    return isOwner
        || item.sharePermission === "EDITOR"
        || item.sharePermission === "OWNER";
}

/** 일정·카테고리·캘린더에서 계산된 편집 권한은 일정 삭제까지 포함합니다. */
export function canDeletePresentedSchedule(
    item: ScheduleItem | undefined,
    currentMemberId?: number | null,
): boolean {
    if (!item) return false;

    if (item.sharePermission != null) {
        return item.sharePermission === "EDITOR" || item.sharePermission === "OWNER";
    }

    if (typeof item.ownerMemberId === "number") {
        return currentMemberId === item.ownerMemberId;
    }

    // ownerMemberId와 유효 공유 권한이 모두 없는 구버전 개인 일정만 기존 삭제 동작을 유지한다.
    return item.sharePermission == null;
}

/** 서버가 응답에 계산한 현재 리소스 OWNER만 공유 범위를 관리합니다. */
export function canManagePresentedSchedule(
    item: ScheduleItem | undefined,
    currentMemberId?: number | null,
): boolean {
    if (!item) return false;

    if (item.sharePermission != null) {
        return item.sharePermission === "OWNER"
            && typeof item.ownerMemberId === "number"
            && currentMemberId === item.ownerMemberId;
    }

    if (typeof item.ownerMemberId === "number") {
        return currentMemberId === item.ownerMemberId;
    }

    // OWNER enum은 구버전 직접 공유에도 남아 있을 수 있으므로 소유자 id와 함께만 사용한다.
    // 소유자 정보와 공유 권한이 모두 없는 구버전 개인 일정만 기존 동작을 유지한다.
    return item.sharePermission == null;
}

/** 일정의 공유 범위를 바꾸는 캘린더 변경은 리소스 관리자에게만 허용합니다. */
export function canChangePresentedScheduleCalendar(
    item: ScheduleItem | undefined,
    currentMemberId?: number | null,
): boolean {
    return canManagePresentedSchedule(item, currentMemberId);
}
