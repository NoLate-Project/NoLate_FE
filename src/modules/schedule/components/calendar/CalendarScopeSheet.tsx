import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
    AccessibilityInfo,
    findNodeHandle,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
} from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ScheduleCalendar, ScheduleCalendarRole } from "../../../../api/scheduleCalendars";
import type { CalendarScope } from "../../calendarScope";
import { useTheme } from "../../../theme/ThemeContext";
import CalendarGlassSurface from "./CalendarGlassSurface";
import CalendarViewSettings from "./CalendarViewSettings";

type Props = {
    visible: boolean;
    calendars: ScheduleCalendar[];
    value: CalendarScope;
    onChange: (scope: CalendarScope) => void;
    onShareCalendar: (calendar: ScheduleCalendar) => void;
    shareContent?: React.ReactNode;
    onCloseShare?: () => void;
    onManageCalendars?: () => void;
    preserveSelectionPosition?: boolean;
    firstDay: 0 | 1;
    onChangeFirstDay: (firstDay: 0 | 1) => void;
    onClose: () => void;
    onDismiss?: () => void;
    reduceMotionEnabled?: boolean;
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
            subtitle: "개인 일정과 공유 캘린더",
            icon: "layers-outline",
        },
        {
            key: "personal",
            title: "개인 일정",
            subtitle: "개인 캘린더의 일정",
            icon: "person-outline",
        },
        ...calendars.map((calendar) => ({
            key: calendar.id,
            title: calendar.title,
            subtitle: `${roleLabel(calendar.myRole)} · ${calendar.memberCount}명`,
            color: calendar.color,
            calendar,
        })),
    ];
}

const scopePanelEntry = FadeIn.duration(220).reduceMotion(ReduceMotion.System);
const scopeBodyEntry = FadeIn.duration(160).reduceMotion(ReduceMotion.System);

export default function CalendarScopeSheet({
    visible,
    calendars,
    value,
    onChange,
    onShareCalendar,
    shareContent,
    onCloseShare,
    onManageCalendars,
    preserveSelectionPosition = false,
    firstDay,
    onChangeFirstDay,
    onClose,
    onDismiss,
    reduceMotionEnabled = false,
}: Props) {
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();
    const { fontScale } = useWindowDimensions();
    const largeText = fontScale > 1.35;
    const options = buildOptions(calendars);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const scopeScrollY = useRef(0);
    const scopeOffset = useRef({ x: 0, y: 0 });
    const settingsButton = useRef<View>(null);
    const manageButton = useRef<View>(null);
    const shareButtons = useRef(new Map<number, View>());
    const returnFocus = useRef<"settings" | "manage" | number | undefined>(undefined);
    const showingShare = Boolean(shareContent);
    const optionsVisible = visible && !settingsOpen && !showingShare;

    useEffect(() => {
        if (!visible && !preserveSelectionPosition) {
            setSettingsOpen(false);
            scopeScrollY.current = 0;
            scopeOffset.current = { x: 0, y: 0 };
            returnFocus.current = undefined;
        }
    }, [preserveSelectionPosition, visible]);

    useEffect(() => {
        if (!optionsVisible || returnFocus.current === undefined) return;
        const task = requestAnimationFrame(() => {
            const id = returnFocus.current;
            const target = id === "settings" ? settingsButton.current
                : id === "manage" ? manageButton.current
                : id === undefined ? null : shareButtons.current.get(id);
            const handle = findNodeHandle(target ?? null);
            if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle);
            returnFocus.current = undefined;
        });
        return () => cancelAnimationFrame(task);
    }, [optionsVisible]);

    const rememberPosition = (target: "settings" | "manage" | number) => {
        scopeOffset.current = { x: 0, y: Math.max(0, scopeScrollY.current) };
        returnFocus.current = target;
    };

    const selectOption = (scope: CalendarScope) => {
        onChange(scope);
        onClose();
    };

    const openShare = (calendar: ScheduleCalendar) => {
        rememberPosition(calendar.id);
        onShareCalendar(calendar);
    };

    const openSettings = () => {
        rememberPosition("settings");
        setSettingsOpen(true);
    };

    const goBack = () => {
        if (showingShare) onCloseShare?.();
        else if (settingsOpen) setSettingsOpen(false);
        else onClose();
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="none"
            onRequestClose={goBack}
            onDismiss={onDismiss}
            accessibilityViewIsModal
        >
            <View style={styles.backdrop}>
                <Pressable
                    accessible={false}
                    style={StyleSheet.absoluteFill}
                    onPress={showingShare ? onCloseShare : onClose}
                />
                <Animated.View entering={reduceMotionEnabled ? undefined : scopePanelEntry} style={styles.sheetHitArea}>
                    {showingShare ? shareContent : (
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
                            {settingsOpen ? (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="캘린더 선택으로 돌아가기"
                                    onPress={goBack}
                                    style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.55 : 1 }]}
                                >
                                    <Ionicons accessible={false} name="chevron-back-outline" size={24} color={colors.textPrimary} />
                                </Pressable>
                            ) : null}
                            <View style={styles.headingCopy}>
                                <Text accessibilityRole="header" maxFontSizeMultiplier={2} lineBreakStrategyIOS="hangul-word" style={[styles.title, { color: colors.textPrimary }]}>{settingsOpen ? "보기 설정" : "캘린더 선택"}</Text>
                            </View>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={settingsOpen ? "보기 설정과 캘린더 선택 닫기" : "캘린더 선택 닫기"}
                                onPress={onClose}
                                style={({ pressed }) => [styles.closeButton, { opacity: pressed ? 0.55 : 1 }]}
                            >
                                <Ionicons accessible={false} name="close-outline" size={23} color={colors.textPrimary} />
                            </Pressable>
                        </View>

                        {settingsOpen ? (
                            <CalendarViewSettings
                                firstDay={firstDay}
                                onChangeFirstDay={onChangeFirstDay}
                                largeText={largeText}
                                reduceMotionEnabled={reduceMotionEnabled}
                            />
                        ) : (
                            <Animated.View entering={reduceMotionEnabled ? undefined : scopeBodyEntry} style={styles.selectionBody}>
                                <ScrollView
                                    contentContainerStyle={styles.options}
                                    contentOffset={scopeOffset.current}
                                    onScroll={({ nativeEvent }) => { scopeScrollY.current = nativeEvent.contentOffset.y; }}
                                    scrollEventThrottle={16}
                                >
                                    {options.map((option, index) => {
                                        const selected = value === option.key;
                                        return (
                                            <React.Fragment key={String(option.key)}>
                                            {index === 2 ? (
                                                <Text accessibilityRole="header" style={[styles.groupTitle, { color: colors.textSecondary }]}>
                                                    공유 캘린더
                                                </Text>
                                            ) : null}
                                            <View
                                                style={[
                                                    styles.option,
                                                    largeText && styles.optionLarge,
                                                    {
                                                        backgroundColor: selected ? colors.surface2 : "transparent",
                                                        borderColor: selected ? colors.textPrimary : colors.border,
                                                    },
                                                ]}
                                            >
                                                <Pressable
                                                    accessibilityRole="radio"
                                                    accessibilityLabel={`${option.title} 보기`}
                                                    accessibilityHint={option.subtitle}
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
                                                            numberOfLines={largeText ? undefined : 1}
                                                            maxFontSizeMultiplier={2.5}
                                                            lineBreakStrategyIOS="hangul-word"
                                                            style={[styles.optionTitle, { color: colors.textPrimary }]}
                                                        >
                                                            {option.title}
                                                        </Text>
                                                        <Text
                                                            numberOfLines={largeText ? undefined : 1}
                                                            maxFontSizeMultiplier={2}
                                                            lineBreakStrategyIOS="hangul-word"
                                                            style={[styles.optionSubtitle, { color: colors.textSecondary }]}
                                                        >
                                                            {option.subtitle}
                                                        </Text>
                                                    </View>
                                                    <View style={styles.checkHost}>
                                                        {selected ? (
                                                            <Ionicons name="checkmark-circle-outline" size={24} color={colors.textPrimary} />
                                                        ) : null}
                                                    </View>
                                                </Pressable>
                                                {option.calendar?.myRole === "OWNER" ? (
                                                    <Pressable
                                                        ref={node => {
                                                            const id = option.calendar!.id;
                                                            if (node) shareButtons.current.set(id, node);
                                                            else shareButtons.current.delete(id);
                                                        }}
                                                        accessibilityRole="button"
                                                        accessibilityLabel={`${option.title} 공유하기`}
                                                        onPress={() => openShare(option.calendar!)}
                                                        style={({ pressed }) => [
                                                            styles.shareButton,
                                                            largeText && styles.shareButtonLarge,
                                                            {
                                                                borderLeftColor: colors.border,
                                                                borderTopColor: colors.border,
                                                                opacity: pressed ? 0.58 : 1,
                                                            },
                                                        ]}
                                                    >
                                                        <Ionicons name="share-social-outline" size={17} color={colors.textPrimary} />
                                                        <Text maxFontSizeMultiplier={2} style={[styles.shareButtonText, { color: colors.textPrimary }]}>공유하기</Text>
                                                    </Pressable>
                                                ) : null}
                                            </View>
                                            </React.Fragment>
                                        );
                                    })}
                                </ScrollView>

                                <View style={[styles.actions, { borderTopColor: colors.border }]}>
                                    {onManageCalendars ? (
                                        <Pressable
                                            ref={manageButton}
                                            accessibilityRole="button"
                                            accessibilityLabel="공유 캘린더 관리"
                                            onPress={() => { rememberPosition("manage"); onManageCalendars(); }}
                                            style={({ pressed }) => [styles.action, { backgroundColor: colors.surface2, opacity: pressed ? 0.62 : 1 }]}
                                        >
                                            <Ionicons accessible={false} name="calendar-outline" size={19} color={colors.textPrimary} />
                                            <Text maxFontSizeMultiplier={1.5} style={[styles.actionText, { color: colors.textPrimary }]}>캘린더 관리</Text>
                                        </Pressable>
                                    ) : null}
                                    <Pressable
                                        ref={settingsButton}
                                        accessibilityRole="button"
                                        accessibilityLabel="캘린더 보기 설정"
                                        onPress={openSettings}
                                        style={({ pressed }) => [
                                            styles.action,
                                            { backgroundColor: colors.surface2, opacity: pressed ? 0.62 : 1 },
                                        ]}
                                    >
                                        <Ionicons name="options-outline" size={19} color={colors.textPrimary} />
                                        <Text maxFontSizeMultiplier={1.5} style={[styles.actionText, { color: colors.textPrimary }]}>보기 설정</Text>
                                    </Pressable>
                                </View>
                            </Animated.View>
                        )}
                    </CalendarGlassSurface>
                    )}
                </Animated.View>
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
        flexShrink: 1,
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
        flex: 1,
        minWidth: 0,
    },
    title: {
        fontSize: 24,
        fontWeight: "800",
        letterSpacing: -0.6,
    },
    closeButton: {
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
    },
    backButton: {
        width: 44,
        height: 44,
        marginLeft: -8,
        alignItems: "center",
        justifyContent: "center",
    },
    selectionBody: { flexShrink: 1 },
    groupTitle: { marginTop: 8, marginBottom: 1, fontSize: 13, fontWeight: "700" },
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
    optionLarge: {
        flexDirection: "column",
        alignItems: "stretch",
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
    shareButtonLarge: {
        width: undefined,
        minHeight: 44,
        borderLeftWidth: 0,
        borderTopWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        gap: 8,
        padding: 8,
    },
    actions: {
        flexDirection: "row",
        gap: 8,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 12,
    },
    action: {
        flex: 1,
        minHeight: 48,
        paddingVertical: 6,
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
