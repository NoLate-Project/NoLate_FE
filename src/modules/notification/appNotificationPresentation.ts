import type { AppNotification } from "../../api/notification";
import {
    getPushNavigationTargetFromNotificationData,
    type PushNavigationTarget,
} from "./pushNavigation";

export type AppNotificationTone = "blue" | "green" | "orange" | "neutral";

export type AppNotificationVisual = {
    icon:
        | "alarm-outline"
        | "calendar-outline"
        | "navigate-outline"
        | "notifications-outline"
        | "paper-plane-outline"
        | "people-outline"
        | "time-outline";
    tone: AppNotificationTone;
};

export function getAppNotificationNavigationTarget(
    notification: AppNotification,
): PushNavigationTarget | undefined {
    // 저장된 원본 payload를 우선하되, 과거 데이터에 문자열 ID가 누락된 경우 정규화된
    // DB 열을 보강한다. 알림함과 실시간 push가 같은 화면 이동 판정기를 공유하게 된다.
    const data: Record<string, unknown> = {
        ...notification.data,
        type: notification.data.type || notification.type,
    };
    if (!data.scheduleId && notification.scheduleId) {
        data.scheduleId = String(notification.scheduleId);
    }
    if (!data.categoryId && notification.categoryId) {
        data.categoryId = String(notification.categoryId);
    }

    return getPushNavigationTargetFromNotificationData(data);
}

export function getAppNotificationVisual(type: string): AppNotificationVisual {
    switch (type) {
        case "SCHEDULE_SHARE_RECEIVED":
            return { icon: "calendar-outline", tone: "blue" };
        case "CATEGORY_SHARE_RECEIVED":
        case "CALENDAR_SHARE_RECEIVED":
            return { icon: "people-outline", tone: "blue" };
        case "SCHEDULE_PARTICIPANT_DEPARTED":
            return { icon: "navigate-outline", tone: "green" };
        case "SCHEDULE_DEPARTURE_NUDGE":
            return { icon: "paper-plane-outline", tone: "orange" };
        case "SCHEDULE_TRAFFIC":
            return { icon: "time-outline", tone: "orange" };
        case "SCHEDULE_DEPARTURE_REMINDER":
        case "ROUTE_SETUP_REMINDER":
        case "SCHEDULE_DETAIL":
            return { icon: "alarm-outline", tone: "blue" };
        default:
            return { icon: "notifications-outline", tone: "neutral" };
    }
}

export function formatAppNotificationTime(
    value: string,
    nowMs: number = Date.now(),
): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const deltaMs = nowMs - date.getTime();
    if (deltaMs >= 0 && deltaMs < 60_000) return "방금 전";
    if (deltaMs >= 0 && deltaMs < 60 * 60_000) {
        return `${Math.floor(deltaMs / 60_000)}분 전`;
    }

    const now = new Date(nowMs);
    if (isSameLocalDay(date, now)) {
        return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    }

    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (isSameLocalDay(date, yesterday)) return "어제";

    if (date.getFullYear() === now.getFullYear()) {
        return `${date.getMonth() + 1}.${date.getDate()}`;
    }
    return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
}

function isSameLocalDay(left: Date, right: Date): boolean {
    return left.getFullYear() === right.getFullYear()
        && left.getMonth() === right.getMonth()
        && left.getDate() === right.getDate();
}

function pad2(value: number): string {
    return String(value).padStart(2, "0");
}
