import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
    ActionSheetIOS,
    Alert,
    Animated,
    PanResponder,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { useTheme } from "../../../theme/ThemeContext";
import {
    buildMonthAgendaSections,
    formatAgendaSectionHeader,
    getSelectedDayAgendaItems,
    getVisibleMonthAgendaItems,
} from "../../agendaLayout";
import {
    MONTH_AGENDA_GESTURE,
    getMonthAgendaSteppedTarget,
    shouldClaimMonthAgendaGesture,
    type MonthAgendaPanelKind,
    type MonthAgendaSteppedTarget,
} from "../../calendarMotion";
import type { ScheduleItem } from "../../types";
import ScheduleAgendaCard from "./ScheduleAgendaCard";

const WEEKDAY_SHORT = ["일", "월", "화", "수", "목", "금", "토"];

function getCompactSectionLabels(dateKey: string) {
    const date = new Date(`${dateKey}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
        return { dateLabel: dateKey, weekdayLabel: "" };
    }

    const weekday = WEEKDAY_SHORT[date.getDay()];
    return {
        dateLabel: `${date.getMonth() + 1}월 ${date.getDate()}일 (${weekday})`,
        weekdayLabel: `${weekday}요일`,
    };
}

type AgendaCategoryOption = {
    id: string;
    title: string;
};

function getAgendaCategoryOptions(items: ScheduleItem[]): AgendaCategoryOption[] {
    const unique = new Map<string, AgendaCategoryOption>();
    items.forEach((item) => {
        if (!item.category?.id || unique.has(item.category.id)) return;
        unique.set(item.category.id, {
            id: item.category.id,
            title: item.category.title,
        });
    });
    return [...unique.values()];
}

type AgendaStateProps = {
    items: ScheduleItem[];
    loading: boolean;
    error: string | null;
    bottomInset: number;
    onPressRetry: () => void;
    onOpenSchedule: (id: string) => void;
};

type SelectedDayAgendaPanelProps = AgendaStateProps & {
    selectedDay: string;
    onRequestViewMode: (mode: MonthAgendaSteppedTarget) => void;
};

type MonthAgendaListProps = AgendaStateProps & {
    visibleMonth: string;
    onRequestViewMode: (mode: MonthAgendaSteppedTarget) => void;
};

function AgendaInlineState({
    loading,
    error,
    emptyText,
    onPressRetry,
}: {
    loading: boolean;
    error: string | null;
    emptyText: string;
    onPressRetry: () => void;
}) {
    const { colors } = useTheme();

    if (!loading && !error) {
        return (
            <View style={styles.emptyState}>
                <Ionicons name="calendar-outline" size={22} color={colors.textSecondary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    {emptyText}
                </Text>
            </View>
        );
    }

    return (
        <Pressable
            accessibilityRole={error ? "button" : undefined}
            disabled={!error}
            onPress={error ? onPressRetry : undefined}
            style={({ pressed }) => [
                styles.emptyState,
                { opacity: pressed ? 0.58 : 1 },
            ]}
        >
            <Ionicons
                name={error ? "refresh-outline" : "calendar-outline"}
                size={22}
                color={colors.textSecondary}
            />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {loading ? "일정을 불러오는 중이에요" : error}
            </Text>
        </Pressable>
    );
}

function MonthAgendaPanelHandle({
    panelKind,
    onRequestViewMode,
}: {
    panelKind: MonthAgendaPanelKind;
    onRequestViewMode: (mode: MonthAgendaSteppedTarget) => void;
}) {
    const { mode } = useTheme();
    const handleDragY = useRef(new Animated.Value(0)).current;
    const handlePanResponder = useMemo(() => {
        const settleHandle = () => {
            Animated.spring(handleDragY, {
                toValue: 0,
                damping: 18,
                stiffness: 240,
                mass: 0.72,
                useNativeDriver: true,
            }).start();
        };

        return PanResponder.create({
            onStartShouldSetPanResponder: () => false,
            onMoveShouldSetPanResponder: (_, gestureState) => (
                shouldClaimMonthAgendaGesture(gestureState.dx, gestureState.dy)
            ),
            onPanResponderGrant: () => {
                handleDragY.stopAnimation();
            },
            onPanResponderMove: (_, gestureState) => {
                const translatedY = Math.max(
                    -MONTH_AGENDA_GESTURE.handleTravel,
                    Math.min(
                        MONTH_AGENDA_GESTURE.handleTravel,
                        gestureState.dy * 0.24
                    )
                );
                handleDragY.setValue(translatedY);
            },
            onPanResponderRelease: (_, gestureState) => {
                const target = getMonthAgendaSteppedTarget(
                    panelKind,
                    gestureState.dy,
                    gestureState.vy
                );
                settleHandle();
                if (target) onRequestViewMode(target);
            },
            onPanResponderTerminate: settleHandle,
            onPanResponderTerminationRequest: () => false,
        });
    }, [handleDragY, onRequestViewMode, panelKind]);

    const isDetail = panelKind === "detail";
    const accessibilityActions = isDetail
        ? [
            { name: "increment" as const, label: "목록형으로 변경" },
            { name: "decrement" as const, label: "스택형으로 변경" },
        ]
        : [
            { name: "decrement" as const, label: "상세형으로 변경" },
        ];

    const handleAccessibilityAction = (actionName: string) => {
        if (panelKind === "detail") {
            if (actionName === "increment") {
                onRequestViewMode("list");
            } else if (actionName === "decrement") {
                onRequestViewMode("stack");
            }
            return;
        }

        if (actionName === "decrement") {
            onRequestViewMode("detail");
        }
    };

    return (
        <Animated.View
            {...handlePanResponder.panHandlers}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="일정 보기 방식"
            accessibilityHint={isDetail
                ? "위로 밀면 목록형, 아래로 당기면 스택형으로 전환됩니다"
                : "아래로 당기면 상세형으로 전환됩니다"}
            accessibilityValue={{ text: isDetail ? "상세형" : "목록형" }}
            accessibilityActions={accessibilityActions}
            onAccessibilityAction={({ nativeEvent }) => (
                handleAccessibilityAction(nativeEvent.actionName)
            )}
            hitSlop={{ top: 8, right: 12, bottom: 8, left: 12 }}
            style={[
                styles.panelHandleHitArea,
                { transform: [{ translateY: handleDragY }] },
            ]}
        >
            <View
                style={[
                    styles.panelHandle,
                    mode === "dark"
                        ? styles.panelHandleDark
                        : styles.panelHandleLight,
                ]}
            />
        </Animated.View>
    );
}

/** 월간 상세형 하단에 표시되는 선택일 일정 패널. */
export function SelectedDayAgendaPanel({
    selectedDay,
    items,
    loading,
    error,
    bottomInset,
    onPressRetry,
    onOpenSchedule,
    onRequestViewMode,
}: SelectedDayAgendaPanelProps) {
    const { colors } = useTheme();
    const selectedItems = useMemo(
        () => getSelectedDayAgendaItems(items, selectedDay),
        [items, selectedDay]
    );

    return (
        <View
            style={[
                styles.agendaPanelSurface,
                {
                    backgroundColor: colors.calendarBackground,
                    borderTopColor: colors.border,
                },
            ]}
        >
            <MonthAgendaPanelHandle
                panelKind="detail"
                onRequestViewMode={onRequestViewMode}
            />

            <View style={[styles.selectedDayHeader, { borderBottomColor: colors.border }]}>
                <Text
                    numberOfLines={1}
                    style={[styles.selectedDayTitle, { color: colors.textPrimary }]}
                >
                    {formatAgendaSectionHeader(selectedDay)}
                </Text>
                <Text style={[styles.selectedDayCount, { color: colors.textSecondary }]}>
                    {selectedItems.length}개의 일정
                </Text>
            </View>

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={[
                    styles.selectedDayContent,
                    { paddingBottom: Math.max(bottomInset + 138, 154) },
                ]}
                showsVerticalScrollIndicator={false}
            >
                {loading || error || selectedItems.length === 0 ? (
                    <AgendaInlineState
                        loading={loading}
                        error={error}
                        emptyText="선택한 날짜에 등록된 일정이 없어요"
                        onPressRetry={onPressRetry}
                    />
                ) : (
                    selectedItems.map((item) => (
                        <ScheduleAgendaCard
                            key={item.id}
                            item={item}
                            onPress={() => onOpenSchedule(item.id)}
                        />
                    ))
                )}
            </ScrollView>
        </View>
    );
}

/** 시안과 같은 날짜 섹션 카드로 구성된 월 전체 일정 목록. */
export function MonthAgendaList({
    visibleMonth,
    items,
    loading,
    error,
    bottomInset,
    onPressRetry,
    onOpenSchedule,
    onRequestViewMode,
}: MonthAgendaListProps) {
    const { colors, mode } = useTheme();
    const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
    const monthItems = useMemo(
        () => getVisibleMonthAgendaItems(items, visibleMonth),
        [items, visibleMonth]
    );
    const categoryOptions = useMemo(
        () => getAgendaCategoryOptions(monthItems),
        [monthItems]
    );
    const activeCategoryId = selectedCategoryId
        && categoryOptions.some((option) => option.id === selectedCategoryId)
        ? selectedCategoryId
        : null;
    const filteredItems = useMemo(
        () => activeCategoryId
            ? monthItems.filter((item) => item.category?.id === activeCategoryId)
            : monthItems,
        [activeCategoryId, monthItems]
    );
    const sections = useMemo(
        () => buildMonthAgendaSections(filteredItems, visibleMonth),
        [filteredItems, visibleMonth]
    );
    const visibleMonthNumber = Number(visibleMonth.slice(5, 7));
    const selectedCategoryTitle = activeCategoryId
        ? categoryOptions.find((option) => option.id === activeCategoryId)?.title
            ?? "전체 일정"
        : "전체 일정";
    const listIdentity = `${visibleMonth.slice(0, 7)}:${activeCategoryId ?? "all"}`;

    useEffect(() => {
        if (
            selectedCategoryId
            && !categoryOptions.some((option) => option.id === selectedCategoryId)
        ) {
            setSelectedCategoryId(null);
        }
    }, [categoryOptions, selectedCategoryId]);

    const selectCategoryOption = useCallback((buttonIndex: number) => {
        if (buttonIndex === categoryOptions.length + 1) return;
        setSelectedCategoryId(
            buttonIndex === 0
                ? null
                : categoryOptions[buttonIndex - 1]?.id ?? null
        );
    }, [categoryOptions]);

    const openCategoryFilter = useCallback(() => {
        const options = [
            "전체 일정",
            ...categoryOptions.map((option) => option.title),
            "취소",
        ];
        const cancelButtonIndex = options.length - 1;

        if (Platform.OS === "ios") {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    title: "표시할 일정",
                    options,
                    cancelButtonIndex,
                },
                selectCategoryOption
            );
            return;
        }

        Alert.alert(
            "표시할 일정",
            undefined,
            options.map((text, index) => ({
                text,
                style: index === cancelButtonIndex ? "cancel" : "default",
                onPress: () => selectCategoryOption(index),
            }))
        );
    }, [categoryOptions, selectCategoryOption]);

    return (
        <View
            style={[
                styles.agendaPanelSurface,
                {
                    backgroundColor: colors.calendarBackground,
                    borderTopColor: colors.border,
                },
            ]}
        >
            <MonthAgendaPanelHandle
                panelKind="list"
                onRequestViewMode={onRequestViewMode}
            />

            <View
                style={[
                    styles.agendaFilterBar,
                    { borderBottomColor: colors.border },
                ]}
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`일정 필터, ${selectedCategoryTitle}`}
                    accessibilityHint="표시할 일정 카테고리를 선택합니다"
                    onPress={openCategoryFilter}
                    style={({ pressed }) => [
                        styles.agendaFilterPill,
                        mode === "dark"
                            ? styles.agendaFilterPillDark
                            : styles.agendaFilterPillLight,
                        {
                            borderColor: colors.border,
                            opacity: pressed ? 0.62 : 1,
                        },
                    ]}
                >
                    <Text
                        numberOfLines={1}
                        style={[
                            styles.agendaFilterText,
                            { color: colors.textPrimary },
                        ]}
                    >
                        {selectedCategoryTitle}
                    </Text>
                    <Ionicons
                        name="chevron-down"
                        size={11}
                        color={colors.textSecondary}
                    />
                </Pressable>
            </View>

            <ScrollView
                key={listIdentity}
                style={styles.scroll}
                contentContainerStyle={[
                    styles.monthListContent,
                    { paddingBottom: Math.max(bottomInset + 146, 162) },
                ]}
                showsVerticalScrollIndicator={false}
            >
                {loading || error || sections.length === 0 ? (
                    <AgendaInlineState
                        loading={loading}
                        error={error}
                        emptyText={activeCategoryId
                            ? "선택한 카테고리에 등록된 일정이 없어요"
                            : `${visibleMonthNumber}월에 등록된 일정이 없어요`}
                        onPressRetry={onPressRetry}
                    />
                ) : (
                    sections.map((section) => {
                        const labels = getCompactSectionLabels(section.dateKey);

                        return (
                            <View key={section.dateKey} style={styles.section}>
                                <View
                                    style={[
                                        styles.sectionHeader,
                                        { borderBottomColor: colors.border },
                                    ]}
                                >
                                    <View style={styles.sectionHeading}>
                                        <Text
                                            style={[
                                                styles.sectionTitle,
                                                { color: colors.textPrimary },
                                            ]}
                                        >
                                            {labels.dateLabel}
                                        </Text>
                                        <Text
                                            style={[
                                                styles.sectionWeekday,
                                                { color: colors.textSecondary },
                                            ]}
                                        >
                                            {labels.weekdayLabel}
                                        </Text>
                                    </View>
                                    <Text
                                        style={[
                                            styles.sectionCount,
                                            { color: colors.textSecondary },
                                        ]}
                                    >
                                        {section.itemCount}개의 일정
                                    </Text>
                                </View>

                                <View style={styles.sectionCards}>
                                    {section.items.map((item) => (
                                        <ScheduleAgendaCard
                                            key={item.id}
                                            item={item}
                                            compact
                                            onPress={() => onOpenSchedule(item.id)}
                                        />
                                    ))}
                                </View>
                            </View>
                        );
                    })
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    agendaPanelSurface: {
        flex: 1,
        minHeight: 0,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        overflow: "hidden",
    },
    panelHandleHitArea: {
        width: 64,
        height: 28,
        alignSelf: "center",
        alignItems: "center",
        justifyContent: "center",
    },
    panelHandle: {
        width: 32,
        height: 4,
        borderRadius: 2,
    },
    panelHandleDark: {
        backgroundColor: "rgba(235,235,245,0.28)",
    },
    panelHandleLight: {
        backgroundColor: "rgba(60,60,67,0.24)",
    },
    selectedDayHeader: {
        minHeight: 42,
        paddingHorizontal: 16,
        paddingBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    selectedDayTitle: {
        flex: 1,
        minWidth: 0,
        fontSize: 15,
        lineHeight: 20,
        fontWeight: "800",
        letterSpacing: 0,
    },
    selectedDayCount: {
        flexShrink: 0,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "700",
        letterSpacing: 0,
    },
    scroll: {
        flex: 1,
        minHeight: 0,
    },
    selectedDayContent: {
        paddingHorizontal: 14,
        paddingTop: 7,
        gap: 6,
    },
    agendaFilterBar: {
        height: 44,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    agendaFilterPill: {
        minWidth: 90,
        maxWidth: 190,
        height: 30,
        paddingHorizontal: 11,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 15,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
    },
    agendaFilterPillDark: {
        backgroundColor: "rgba(255,255,255,0.055)",
    },
    agendaFilterPillLight: {
        backgroundColor: "rgba(0,0,0,0.035)",
    },
    agendaFilterText: {
        flexShrink: 1,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "700",
        letterSpacing: 0,
    },
    monthListContent: {
        paddingHorizontal: 14,
        paddingTop: 7,
        gap: 13,
    },
    section: {
        gap: 4,
    },
    sectionHeader: {
        minHeight: 29,
        paddingHorizontal: 1,
        paddingBottom: 5,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 9,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    sectionHeading: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "baseline",
        gap: 8,
    },
    sectionTitle: {
        flexShrink: 0,
        fontSize: 12.5,
        lineHeight: 17,
        fontWeight: "800",
        letterSpacing: 0,
    },
    sectionWeekday: {
        flex: 1,
        minWidth: 0,
        fontSize: 10.5,
        lineHeight: 15,
        fontWeight: "600",
        letterSpacing: 0,
    },
    sectionCount: {
        flexShrink: 0,
        fontSize: 10.5,
        lineHeight: 15,
        fontWeight: "700",
        letterSpacing: 0,
    },
    sectionCards: {
        gap: 3,
    },
    emptyState: {
        minHeight: 84,
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingHorizontal: 20,
    },
    emptyText: {
        textAlign: "center",
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "700",
        letterSpacing: 0,
    },
});
