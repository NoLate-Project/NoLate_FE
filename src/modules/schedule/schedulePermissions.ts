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

/** 공유 편집자는 원본 일정을 수정할 수 있지만 삭제 권한은 소유자에게만 있다. */
export function canDeletePresentedSchedule(item: ScheduleItem | undefined): boolean {
    return Boolean(item)
        && (item?.sharePermission == null || item.sharePermission === "OWNER");
}
