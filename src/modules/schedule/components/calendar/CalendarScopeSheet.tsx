import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ScheduleCalendar, ScheduleCalendarRole } from "../../../../api/scheduleCalendars";
import type { CalendarScope } from "../../calendarScope";
import { useTheme } from "../../../theme/ThemeContext";
import CalendarGlassSurface from "./CalendarGlassSurface";

type Props = {
    visible: boolean;
    calendars: ScheduleCalendar[];
    value: CalendarScope;
    onChange: (scope: CalendarScope) => void;
    onShareCalendar: (calendar: ScheduleCalendar) => void;
    onManage: () => void;
    onOpenSettings: () => void;
    onClose: () => void;
    onDismiss?: () => void;
};

type CalendarOption = {
    key: CalendarScope;
    title: string;
    subtitle: string;
    color?: string;
    icon?: React.ComponentProps<typeof Ionicons>["name"];
    calendar?: ScheduleCalendar;
};

function roleLabel(role: ScheduleCalendarRole) {
    if (role === "OWNER") return "소유자";
    if (role === "EDITOR") return "편집 가능";
    return "보기 전용";
}

function buildOptions(calendars: ScheduleCalendar[]): CalendarOption[] {
    return [
        {
            key: "all",
            title: "전체 일정",
            subtitle: "모든 캘린더의 일정을 함께 봅니다",
            icon: "layers-outline",
        },
        {
            key: "personal",
            title: "개인 일정",
            subtitle: "나만 볼 수 있는 일정입니다",
            icon: "person-outline",
        },
        ...calendars.map((calendar) => ({
            key: calendar.id,
            title: calendar.title,
            subtitle: `${calendar.memberCount}명 · ${roleLabel(calendar.myRole)}`,
            color: calendar.color,
            calendar,
        })),
    ];
}

export default function CalendarScopeSheet({
    visible,
    calendars,
    value,
    onChange,
    onShareCalendar,
    onManage,
    onOpenSettings,
    onClose,
    onDismiss,
}: Props) {
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();
    const options = buildOptions(calendars);

    const selectOption = (scope: CalendarScope) => {
        onChange(scope);
        onClose();
    };

    const openManage = () => {
        onClose();
        onManage();
    };

    const openShare = (calendar: ScheduleCalendar) => {
        onClose();
        onShareCalendar(calendar);
    };

    const openSettings = () => {
        onClose();
        onOpenSettings();
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
            onDismiss={onDismiss}
            accessibilityViewIsModal
        >
            <View style={styles.backdrop}>
                <Pressable
                    accessible={false}
                    style={StyleSheet.absoluteFill}
                    onPress={onClose}
                />
                <View style={styles.sheetHitArea}>
                    <CalendarGlassSurface
                        variant="card"
                        tone="solidCard"
                        style={[
                            styles.sheet,
                            {
                                backgroundColor: colors.background,
                                borderColor: colors.border,
                                paddingBottom: Math.max(insets.bottom, 12) + 10,
                            },
                        ]}
                    >
                        <View style={[styles.handle, { backgroundColor: colors.border }]} />
                        <View style={styles.heading}>
                            <View style={styles.headingCopy}>
                                <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>일정 표시 범위</Text>
                                <Text style={[styles.title, { color: colors.textPrimary }]}>캘린더 선택</Text>
                            </View>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="캘린더 선택 닫기"
                                onPress={onClose}
                                style={({ pressed }) => [styles.closeButton, { opacity: pressed ? 0.55 : 1 }]}
                            >
                                <Ionicons name="close" size={23} color={colors.textPrimary} />
                            </Pressable>
                        </View>

                        <ScrollView
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={styles.options}
                        >
                            {options.map((option) => {
                                const selected = value === option.key;
                                return (
                                    <View
                                        key={String(option.key)}
                                        style={[
                                            styles.option,
                                            {
                                                backgroundColor: selected ? colors.surface2 : "transparent",
                                                borderColor: selected ? colors.textPrimary : colors.border,
                                            },
                                        ]}
                                    >
                                        <Pressable
                                            accessibilityRole="radio"
                                            accessibilityLabel={`${option.title} 보기`}
                                            accessibilityState={{ selected }}
                                            onPress={() => selectOption(option.key)}
                                            style={({ pressed }) => [
                                                styles.optionSelection,
                                                { opacity: pressed ? 0.62 : 1 },
                                            ]}
                                        >
                                            <View
                                                style={[
                                                    styles.optionIcon,
                                                    { backgroundColor: colors.surface2 },
                                                ]}
                                            >
                                                {option.color ? (
                                                    <View style={[styles.colorDot, { backgroundColor: option.color }]} />
                                                ) : (
                                                    <Ionicons
                                                        name={option.icon ?? "calendar-outline"}
                                                        size={20}
                                                        color={colors.textSecondary}
                                                    />
                                                )}
                                            </View>
                                            <View style={styles.optionCopy}>
                                                <Text
                                                    numberOfLines={1}
                                                    style={[styles.optionTitle, { color: colors.textPrimary }]}
                                                >
                                                    {option.title}
                                                </Text>
                                                <Text
                                                    numberOfLines={1}
                                                    style={[styles.optionSubtitle, { color: colors.textSecondary }]}
                                                >
                                                    {option.subtitle}
                                                </Text>
                                            </View>
                                            <View style={styles.checkHost}>
                                                {selected ? (
                                                    <Ionicons name="checkmark-circle" size={24} color={colors.textPrimary} />
                                                ) : null}
                                            </View>
                                        </Pressable>
                                        {option.calendar?.myRole === "OWNER" ? (
                                            <Pressable
                                                accessibilityRole="button"
                                                accessibilityLabel={`${option.title} 공유하기`}
                                                onPress={() => openShare(option.calendar!)}
                                                style={({ pressed }) => [
                                                    styles.shareButton,
                                                    {
                                                        borderLeftColor: colors.border,
                                                        opacity: pressed ? 0.58 : 1,
                                                    },
                                                ]}
                                            >
                                                <Ionicons name="share-social-outline" size={17} color={colors.textPrimary} />
                                                <Text style={[styles.shareButtonText, { color: colors.textPrimary }]}>공유하기</Text>
                                            </Pressable>
                                        ) : null}
                                    </View>
                                );
                            })}
                        </ScrollView>

                        <View style={[styles.actions, { borderTopColor: colors.border }]}>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="캘린더 관리"
                                onPress={openManage}
                                style={({ pressed }) => [
                                    styles.action,
                                    { backgroundColor: colors.surface2, opacity: pressed ? 0.62 : 1 },
                                ]}
                            >
                                <Ionicons name="calendar-outline" size={19} color={colors.textPrimary} />
                                <Text style={[styles.actionText, { color: colors.textPrimary }]}>캘린더 관리</Text>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="캘린더 보기 설정"
                                onPress={openSettings}
                                style={({ pressed }) => [
                                    styles.action,
                                    { backgroundColor: colors.surface2, opacity: pressed ? 0.62 : 1 },
                                ]}
                            >
                                <Ionicons name="options-outline" size={19} color={colors.textPrimary} />
                                <Text style={[styles.actionText, { color: colors.textPrimary }]}>보기 설정</Text>
                            </Pressable>
                        </View>
                    </CalendarGlassSurface>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: "flex-end",
        backgroundColor: "rgba(0,0,0,0.48)",
    },
    sheetHitArea: {
        maxHeight: "86%",
        borderTopLeftRadius: 30,
        borderTopRightRadius: 30,
        overflow: "hidden",
    },
    sheet: {
        maxHeight: "100%",
        borderTopLeftRadius: 30,
        borderTopRightRadius: 30,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 18,
        paddingTop: 9,
    },
    handle: {
        width: 44,
        height: 5,
        alignSelf: "center",
        borderRadius: 3,
        marginBottom: 12,
    },
    heading: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 14,
    },
    headingCopy: {
        gap: 2,
    },
    eyebrow: {
        fontSize: 12,
        fontWeight: "700",
    },
    title: {
        fontSize: 24,
        fontWeight: "800",
        letterSpacing: -0.6,
    },
    closeButton: {
        width: 42,
        height: 42,
        alignItems: "center",
        justifyContent: "center",
    },
    options: {
        gap: 7,
        paddingBottom: 12,
    },
    option: {
        minHeight: 66,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 18,
        flexDirection: "row",
        alignItems: "center",
        overflow: "hidden",
    },
    optionSelection: {
        minHeight: 64,
        flex: 1,
        minWidth: 0,
        paddingHorizontal: 12,
        paddingVertical: 9,
        flexDirection: "row",
        alignItems: "center",
    },
    optionIcon: {
        width: 42,
        height: 42,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    colorDot: {
        width: 14,
        height: 14,
        borderRadius: 7,
    },
    optionCopy: {
        flex: 1,
        minWidth: 0,
        marginLeft: 12,
        gap: 3,
    },
    optionTitle: {
        fontSize: 16,
        fontWeight: "800",
    },
    optionSubtitle: {
        fontSize: 12,
        fontWeight: "600",
    },
    checkHost: {
        width: 28,
        alignItems: "flex-end",
    },
    shareButton: {
        width: 72,
        alignSelf: "stretch",
        borderLeftWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
    },
    shareButtonText: {
        fontSize: 11,
        fontWeight: "800",
    },
    actions: {
        flexDirection: "row",
        gap: 8,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 12,
    },
    action: {
        flex: 1,
        height: 48,
        borderRadius: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
    },
    actionText: {
        fontSize: 14,
        fontWeight: "800",
    },
});
