import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StatusBar, Text, View } from "react-native";

import ProfileRouteAccessibilityRoot from "../modules/profile/ProfileRouteAccessibilityRoot";
import { useTheme } from "../modules/theme/ThemeContext";
import { BrandedLoadingState } from "../ui/BrandedLoader";
import styles from "./profile.styles";

/** 계정 항목의 값과 선택적 복사·이동 액션을 접근 가능한 한 행으로 표시합니다. */
export function AccountInfoRow({
    label,
    value,
    colors,
    selectable = false,
    showDivider = true,
    onPress,
    actionLabel,
    actionIcon,
}: {
    label: string;
    value: string;
    colors: ReturnType<typeof useTheme>["colors"];
    selectable?: boolean;
    showDivider?: boolean;
    onPress?: () => void;
    actionLabel?: string;
    actionIcon?: React.ComponentProps<typeof Ionicons>["name"];
}) {
    const content = (
        <>
            <View style={styles.accountRowMain}>
                <Text style={[styles.accountLabel, { color: colors.textSecondary }]}>{label}</Text>
                <Text
                    selectable={selectable}
                    numberOfLines={2}
                    style={[styles.accountValue, { color: colors.textPrimary }]}
                >
                    {value}
                </Text>
            </View>
            {actionLabel ? (
                <View style={styles.accountRowAction}>
                    <Text style={[styles.accountActionLabel, { color: colors.textSecondary }]}>{actionLabel}</Text>
                    {actionIcon ? <Ionicons name={actionIcon} size={16} color={colors.textSecondary} /> : null}
                </View>
            ) : null}
        </>
    );
    const rowStyle = [
        styles.accountRow,
        showDivider ? styles.accountRowDivider : styles.accountRowLast,
        { borderBottomColor: colors.border },
    ];

    if (onPress) {
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${label}, ${value}${actionLabel ? `, ${actionLabel}` : ""}`}
                onPress={onPress}
                style={({ pressed }) => [rowStyle, { opacity: pressed ? 0.58 : 1 }]}
            >
                {content}
            </Pressable>
        );
    }

    return (
        <View
            style={[
                rowStyle,
            ]}
        >
            {content}
        </View>
    );
}

/** 연결된 캘린더의 수치와 레이블을 간결한 통계 항목으로 표시합니다. */
export function CalendarConnectionStat({ label, value }: { label: string; value: string }) {
    const { colors } = useTheme();

    return (
        <View style={styles.calendarStatItem}>
            <Text style={[styles.calendarStatValue, { color: colors.textPrimary }]}>{value}</Text>
            <Text style={[styles.calendarStatLabel, { color: colors.textSecondary }]}>{label}</Text>
        </View>
    );
}

/** 프로필 데이터가 준비될 때까지 화면 전체를 일관된 브랜드 로딩 상태로 표시합니다. */
export function ProfileLoadingView({ colors, dark }: { colors: ReturnType<typeof useTheme>["colors"]; dark: boolean }) {
    return (
        <ProfileRouteAccessibilityRoot style={[styles.root, { backgroundColor: colors.background }]}>
            <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
            <BrandedLoadingState fill size="full" variant="auth" accessibilityLabel="내 프로필을 불러오고 있어요"
                title="내 프로필을 불러오고 있어요" caption="계정과 캘린더 연결 상태를 확인하고 있어요" />
        </ProfileRouteAccessibilityRoot>
    );
}
