import type { ScheduleItem } from "./types";

export type ScheduleDetailActionPermissions = {
    canShare: boolean;
    canEdit: boolean;
};

/**
 * 공유 대상 관리는 원본 소유자만 수행한다. 일정 내용 수정은 서버 접근 정책과 동일하게
 * 소유자와 유효한 EDITOR에게 허용해, 편집자가 상세 화면에서 막히지 않도록 한다.
 */
export function getScheduleDetailActionPermissions(
    item: Pick<ScheduleItem, "ownerMemberId" | "sharePermission"> | undefined,
    currentMemberId: number | null,
): ScheduleDetailActionPermissions {
    if (!item) return { canShare: false, canEdit: false };

    // ownerMemberId가 없는 로컬/레거시 일정은 기존처럼 본인 소유로 취급한다.
    const isOwner = typeof item.ownerMemberId !== "number"
        || currentMemberId === item.ownerMemberId
        || item.sharePermission === "OWNER";

    return {
        canShare: isOwner,
        canEdit: isOwner || item.sharePermission === "EDITOR",
    };
}

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
