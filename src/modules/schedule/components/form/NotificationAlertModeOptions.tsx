import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { SCHEDULE_ALERT_MODE_PRESENTATION } from "../../scheduleAlertMode";
import type { ScheduleAlertMode } from "../../types";
import styles from "./NotificationSettingsCard.styles";

type CommonOptionProps = {
    mode: ScheduleAlertMode;
    selected: boolean;
    accentBlue: string;
    selectedBackground: string;
    textSecondary: string;
    onPress: () => void;
};

/**
 * 좁은 알림 설정 카드에서 사용하는 한 줄짜리 알림 방식 선택 버튼입니다.
 * 선택 상태와 접근성 설명은 공용 presentation 데이터에서 함께 가져와 표시 문구가 어긋나지 않게 합니다.
 */
export function CompactAlarmModeOption({
    mode,
    selected,
    accentBlue,
    selectedBackground,
    textSecondary,
    onPress,
}: CommonOptionProps) {
    const presentation = SCHEDULE_ALERT_MODE_PRESENTATION[mode];

    return (
        <Pressable
            testID={`notification-alert-mode-${mode.toLowerCase()}`}
            accessibilityRole="radio"
            accessibilityLabel={presentation.accessibilityLabel}
            accessibilityHint={presentation.description}
            accessibilityState={{ checked: selected }}
            hitSlop={{ top: 4, bottom: 4 }}
            onPress={onPress}
            style={({ pressed }) => [
                styles.compactModeButton,
                selected && styles.compactModeButtonSelected,
                {
                    backgroundColor: selected ? selectedBackground : "transparent",
                    opacity: pressed ? 0.65 : 1,
                },
            ]}
        >
            <Text
                style={[
                    styles.compactModeText,
                    { color: selected ? accentBlue : textSecondary },
                ]}
            >
                {presentation.label}
            </Text>
        </Pressable>
    );
}

type AlarmModeOptionProps = CommonOptionProps & {
    borderColor: string;
    textPrimary: string;
};

/**
 * 전체 알림 설정 화면에서 아이콘과 설명을 함께 보여 주는 알림 방식 선택 행입니다.
 * radio 접근성 상태를 실제 선택 값과 연결하며 플랫폼별 색상은 부모 화면에서 주입받습니다.
 */
export function AlarmModeOption({
    mode,
    selected,
    accentBlue,
    selectedBackground,
    borderColor,
    textPrimary,
    textSecondary,
    onPress,
}: AlarmModeOptionProps) {
    const presentation = SCHEDULE_ALERT_MODE_PRESENTATION[mode];

    return (
        <Pressable
            testID={`notification-alert-mode-${mode.toLowerCase()}`}
            accessibilityRole="radio"
            accessibilityLabel={presentation.accessibilityLabel}
            accessibilityHint={presentation.description}
            accessibilityState={{ checked: selected }}
            onPress={onPress}
            style={({ pressed }) => [
                styles.modeButton,
                {
                    borderBottomWidth: mode === "STANDARD" ? StyleSheet.hairlineWidth : 0,
                    borderBottomColor: borderColor,
                    backgroundColor: selected ? selectedBackground : "transparent",
                    opacity: pressed ? 0.7 : 1,
                },
            ]}
        >
            <View style={[styles.modeIcon, { backgroundColor: selected ? accentBlue : selectedBackground }]}>
                <Ionicons
                    accessible={false}
                    name={mode === "ALARM" ? "alarm-outline" : "notifications-outline"}
                    size={20}
                    color={selected ? "#FFFFFF" : accentBlue}
                />
            </View>
            <View style={styles.modeCopy}>
                <View style={styles.modeTitleRow}>
                    <Text style={[styles.modeTitle, { color: textPrimary }]}>{presentation.label}</Text>
                </View>
                <Text style={[styles.modeDescription, { color: textSecondary }]}>{presentation.description}</Text>
            </View>
            <Ionicons
                accessible={false}
                name={selected ? "checkmark-circle" : "ellipse-outline"}
                size={21}
                color={selected ? accentBlue : textSecondary}
            />
        </Pressable>
    );
}
