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
