import type { DepartureAlarmCapabilities } from "../../../notification/departureAlarm";

export type AlarmSettingKind = "notification" | "exact" | "fullScreen";

export type CustomAlarmIssue = {
    title: string;
    description: string;
    tone: "notice" | "warning";
    accessibilityLabel: string;
} & (
    | {
          action: "requestNotification";
          actionLabel: "알림 허용";
      }
    | {
          action: "openSetting";
          actionLabel: "설정 열기";
          settingKind: AlarmSettingKind;
      }
);

/** 아직 권한을 결정하지 않은 iOS 사용자에게 표시할 최초 권한 요청 안내를 만듭니다. */
function createNotificationRequestIssue(): CustomAlarmIssue {
    return {
        title: "알림 권한이 필요해요",
        description: "출발 알림을 받으려면 NoLate 알림을 허용해 주세요.",
        tone: "notice",
        action: "requestNotification",
        actionLabel: "알림 허용",
        accessibilityLabel: "알림 권한이 필요해요, 알림 허용",
    };
}

/** 기기 설정에서 직접 해결해야 하는 권한 문제를 공통 화면 모델로 변환합니다. */
function createSettingsIssue({
    title,
    description,
    settingKind,
}: {
    title: string;
    description: string;
    settingKind: AlarmSettingKind;
}): CustomAlarmIssue {
    return {
        title,
        description,
        tone: "warning",
        action: "openSetting",
        actionLabel: "설정 열기",
        settingKind,
        accessibilityLabel: `${title}, 설정 열기`,
    };
}

/**
 * 플랫폼별 알림 권한 상태를 사용자가 실행할 수 있는 해결 안내로 변환합니다.
 * 지원되지 않는 기기나 이미 허용된 상태에는 불필요한 경고가 나오지 않도록 `null`을 반환합니다.
 */
export function getNotificationPermissionIssue(
    capabilities: DepartureAlarmCapabilities | null,
): CustomAlarmIssue | null {
    if (!capabilities?.supported) return null;

    if (capabilities.platform === "android") {
        if (!capabilities.notificationAuthorized) {
            return createSettingsIssue({
                title: "알림이 꺼져 있어요",
                description: "일정은 저장되지만 출발 알림은 오지 않아요. 설정에서 NoLate 알림을 켜 주세요.",
                settingKind: "notification",
            });
        }
        return null;
    }

    if (capabilities.platform !== "ios") return null;
    if (capabilities.notificationAuthorization === "notDetermined") {
        return createNotificationRequestIssue();
    }
    if (
        !capabilities.notificationAuthorized ||
        capabilities.notificationAuthorization === "denied" ||
        capabilities.notificationAuthorization === "unknown" ||
        capabilities.reason === "NOTIFICATION_ALERTS_DISABLED"
    ) {
        return createSettingsIssue({
            title: "알림이 꺼져 있어요",
            description: "일정은 저장되지만 출발 알림은 오지 않아요. 설정에서 NoLate 알림을 켜 주세요.",
            settingKind: "notification",
        });
    }
    return null;
}

/**
 * 커스텀 알람에 추가로 필요한 정확한 알람·전체 화면·소리 권한 문제를 하나씩 우선순위로 반환합니다.
 */
export function getCustomAlarmIssue(capabilities: DepartureAlarmCapabilities | null): CustomAlarmIssue | null {
    if (!capabilities?.supported) return null;

    if (capabilities.platform === "android") {
        if (!capabilities.exactAlarmAuthorized) {
            return createSettingsIssue({
                title: "예약 시각 알림을 켜 주세요",
                description: "제시간에 울리도록 기기 설정을 확인해 주세요.",
                settingKind: "exact",
            });
        }
        if (!capabilities.fullScreenAuthorized) {
            return createSettingsIssue({
                title: "알람 화면 표시를 켜 주세요",
                description: "잠금 화면에 알람을 띄우려면 켜 주세요.",
                settingKind: "fullScreen",
            });
        }
        return null;
    }

    if (capabilities.platform !== "ios") return null;
    if (capabilities.soundAuthorization === "disabled" || capabilities.reason === "SOUND_DISABLED") {
        return createSettingsIssue({
            title: "알림 소리가 꺼져 있어요",
            description: "기기 설정에서 알림 소리를 켜 주세요.",
            settingKind: "notification",
        });
    }
    return null;
}
