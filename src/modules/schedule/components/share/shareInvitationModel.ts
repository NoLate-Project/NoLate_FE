import * as Linking from "expo-linking";
import { LinearTransition, ReduceMotion } from "react-native-reanimated";

import type { ScheduleShareContentMode } from "../../../../api/scheduleCalendars";
import type { ScheduleShareInvitation } from "../../../../api/scheduleSharing";
import type { ScheduleSharePermission } from "../../types";

export type ShareInvitationSheetProps = {
    visible: boolean;
    resourceType: "schedule" | "category" | "calendar";
    resourceId?: string | null;
    title: string;
    subtitle?: string;
    initialContentMode?: ScheduleShareContentMode;
    onCalendarContentModeChange?: (mode: ScheduleShareContentMode) => Promise<void>;
    onClose: () => void;
};
export type ShareMode = "direct" | "link";
export const PERMISSION_OPTIONS: Array<{ value: Exclude<ScheduleSharePermission, "OWNER">; label: string; description: string }> = [
    { value: "VIEWER", label: "보기", description: "일정과 카테고리 내용을 확인" },
    { value: "EDITOR", label: "편집", description: "공유 대상 수정까지 허용" },
];
export const TTL_OPTIONS = [{ value: 24, label: "24시간" }, { value: 72, label: "3일" }, { value: 168, label: "7일" }];
export const ACCEPT_COUNT_OPTIONS = [{ value: 1, label: "1명" }, { value: 5, label: "5명" }, { value: 10, label: "10명" }];
export const MODE_TRANSITION_DURATION_MS = 240;
export const MODE_CONTENT_TRAVEL = 14;
export const SHEET_LAYOUT_TRANSITION = LinearTransition.springify().damping(20).stiffness(180).mass(0.75)
    .overshootClamping(1).reduceMotion(ReduceMotion.System);
const PRODUCTION_SHARE_LINK_ORIGIN = "https://nolate.jinuk.dev";

/** 공유 API 오류를 권한·네트워크·일반 오류별 사용자 안내 문구로 변환합니다. */
export function getErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : "요청 처리에 실패했습니다.";
    if (/403|forbidden|status code/i.test(message)) return "공유 권한을 확인할 수 없어요.";
    if (/network|timeout/i.test(message)) return "네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
    return message;
}

/** 초대 만료 시각을 목록에서 읽기 쉬운 월·일·시·분 형식으로 변환합니다. */
export function formatExpiresAt(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${month}.${day} ${hour}:${minute}`;
}

/** 서버 초대 상태 코드를 활성·수락·만료·해제 레이블로 변환합니다. */
export function statusLabel(status: ScheduleShareInvitation["status"]) {
    switch (status) {
        case "PENDING": return "활성";
        case "ACCEPTED": return "수락됨";
        case "EXPIRED": return "만료";
        case "REVOKED": return "해제";
        default: return status;
    }
}

/** 공유 권한 코드를 선택 칩과 초대 목록에서 사용하는 한글 레이블로 변환합니다. */
export function permissionLabel(permission: ScheduleSharePermission) {
    return PERMISSION_OPTIONS.find((option) => option.value === permission)?.label ?? permission;
}

/** 개발 빌드에서는 Expo 딥링크를, 운영 빌드에서는 고정 웹 도메인을 사용해 초대 URL을 만듭니다. */
export function createShareInviteUrl(token: string) {
    if (__DEV__) return Linking.createURL(`/share/${encodeURIComponent(token)}`);
    return `${PRODUCTION_SHARE_LINK_ORIGIN}/share/${encodeURIComponent(token)}`;
}
