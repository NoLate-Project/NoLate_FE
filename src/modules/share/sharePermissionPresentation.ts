import type { ScheduleSharePermission } from "../schedule/types";

export function getScheduleShareBadgeLabel(
    permission?: ScheduleSharePermission,
): string {
    switch (permission) {
        case "OWNER":
            return "소유 공유";
        case "EDITOR":
            return "편집 공유";
        case "COMMENTER":
            return "댓글 공유";
        case "VIEWER":
            return "보기 공유";
        default:
            return "공유됨";
    }
}

export function getCategorySharePermissionLabel(
    permission?: ScheduleSharePermission,
): string {
    switch (permission) {
        case "OWNER":
            return "소유 권한";
        case "EDITOR":
            return "편집 가능";
        case "COMMENTER":
            return "댓글 가능";
        case "VIEWER":
            return "보기 권한";
        default:
            return "공유 권한";
    }
}
