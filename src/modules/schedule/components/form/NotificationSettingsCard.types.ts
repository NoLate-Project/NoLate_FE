import type { SubscriptionPolicy } from "../../../../api/subscription";
import type { RouteInfo } from "../../routeInfo";
import type { ScheduleAlertMode } from "../../types";

/** 알림 설정 카드가 부모 일정 폼과 주고받는 값과 변경 이벤트입니다. */
export type NotificationSettingsCardProps = {
    variant?: "card" | "flat";
    routeReady: boolean;
    enabled: boolean;
    alertMode: ScheduleAlertMode;
    scheduleId?: string;
    leadMinutes: number;
    intervalMinutes: number;
    routeInfo?: RouteInfo;
    startAt?: Date;
    policy: SubscriptionPolicy;
    onEnabledChange: (enabled: boolean) => void;
    onAlertModeChange: (mode: ScheduleAlertMode) => void;
    onLeadMinutesChange: (minutes: number) => void;
    onIntervalMinutesChange: (minutes: number) => void;
};
