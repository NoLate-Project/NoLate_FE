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

/** 공유 캘린더 역할과 무관하게 일정 원작성자만 일정을 삭제할 수 있다. */
export function canDeletePresentedSchedule(
    item: ScheduleItem | undefined,
    currentMemberId?: number | null,
): boolean {
    if (!item) return false;

    if (typeof item.ownerMemberId === "number") {
        return currentMemberId === item.ownerMemberId;
    }

    // ownerMemberId가 없던 구버전 개인 일정만 기존 삭제 동작을 유지한다.
    return item.sharePermission == null;
}

/** 캘린더 역할과 무관하게 일정 원작성자만 저장 캘린더를 변경할 수 있다. */
export function canChangePresentedScheduleCalendar(
    item: ScheduleItem | undefined,
    currentMemberId?: number | null,
): boolean {
    if (!item) return false;

    if (typeof item.ownerMemberId === "number") {
        return currentMemberId === item.ownerMemberId;
    }

    // 작성자 정보가 없는 구버전 데이터는 개인 일정만 이동을 허용한다.
    return item.sharePermission == null;
}
