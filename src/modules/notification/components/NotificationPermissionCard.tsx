import React from "react";
import {
    ActivityIndicator,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { Ionicons as ExpoIonicons } from "@expo/vector-icons";

import { useTheme } from "../../theme/ThemeContext";
import { getMinimumTouchTarget } from "../../../ui/minimumTouchTarget";
import type { NotificationPermissionState } from "../notificationPermission";

function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
    return <ExpoIonicons {...props} accessible={false} importantForAccessibility="no" />;
}

const MIN_TOUCH_TARGET = getMinimumTouchTarget(Platform.OS);

export type NotificationPermissionCardProps = {
    state: NotificationPermissionState;
    pending?: boolean;
    onRequest: () => void;
    onOpenSettings: () => void;
};

function permissionCopy(state: NotificationPermissionState): {
    title: string;
    detail: string;
    action?: "request" | "settings";
    actionLabel?: string;
} {
    switch (state) {
        case "granted":
            return {
                title: "출발 알림을 받을 수 있어요",
                detail: "교통 변화와 추천 출발 시각을 기기 알림으로 알려드려요.",
            };
        case "undetermined":
            return {
                title: "출발 알림 권한이 필요해요",
                detail: "원할 때 한 번만 허용해 주세요. 지금 허용하지 않아도 일정을 볼 수 있어요.",
                action: "request",
                actionLabel: "알림 허용",
            };
        case "denied":
            return {
                title: "출발 알림이 꺼져 있어요",
                detail: "알림 없이도 앱에서 최신 출발 상태를 확인할 수 있어요. 원하면 다시 허용할 수 있습니다.",
                action: "request",
                actionLabel: "다시 허용",
            };
        case "blocked":
            return {
                title: "시스템에서 출발 알림이 차단됐어요",
                detail: "NoLate가 권한 창을 다시 띄울 수 없어요. 알림이 필요할 때만 시스템 설정에서 켜 주세요.",
                action: "settings",
                actionLabel: "시스템 설정 열기",
            };
        default:
            return {
                title: "알림 상태를 확인할 수 없어요",
                detail: "이 기기나 빌드에서는 알림 권한 상태를 제공하지 않습니다.",
            };
    }
}

export default function NotificationPermissionCard({
    state,
    pending = false,
    onRequest,
    onOpenSettings,
}: NotificationPermissionCardProps) {
    const { colors, mode } = useTheme();
    const copy = permissionCopy(state);
    const accent = mode === "dark" ? "#78B4FF" : "#2979FF";
    const attention = state === "denied" || state === "blocked" || state === "undetermined";

    return (
        <View
            accessible={copy.action === undefined}
            accessibilityLabel={`${copy.title}. ${copy.detail}`}
            style={[
                styles.card,
                {
                    borderColor: colors.border,
                    backgroundColor: colors.inputBackground,
                },
            ]}
        >
            <View
                style={[
                    styles.icon,
                    { backgroundColor: attention ? `${accent}1C` : "rgba(34,197,94,0.14)" },
                ]}
            >
                <Ionicons
                    name={state === "granted" ? "notifications-outline" : "notifications-off-outline"}
                    size={18}
                    color={state === "granted" ? "#22A559" : accent}
                />
            </View>
            <View style={styles.copy}>
                <Text style={[styles.title, { color: colors.textPrimary }]}>{copy.title}</Text>
                <Text style={[styles.detail, { color: colors.textSecondary }]}>{copy.detail}</Text>
            </View>
            {copy.action ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={copy.actionLabel}
                    accessibilityState={{ busy: pending, disabled: pending }}
                    disabled={pending}
                    onPress={copy.action === "settings" ? onOpenSettings : onRequest}
                    style={({ pressed }) => [
                        styles.action,
                        {
                            minHeight: MIN_TOUCH_TARGET,
                            borderColor: accent,
                            opacity: pressed || pending ? 0.55 : 1,
                        },
                    ]}
                >
                    {pending ? (
                        <ActivityIndicator size="small" color={accent} />
                    ) : (
                        <Text style={[styles.actionText, { color: accent }]}>{copy.actionLabel}</Text>
                    )}
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        width: "100%",
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        padding: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    icon: {
        width: 36,
        height: 36,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    copy: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "900",
    },
    detail: {
        marginTop: 2,
        fontSize: 10,
        lineHeight: 15,
        fontWeight: "600",
    },
    action: {
        minWidth: 88,
        maxWidth: 92,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    actionText: {
        textAlign: "center",
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "900",
    },
});
