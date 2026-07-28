import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
    ActionSheetIOS,
    Alert,
    Animated,
    type GestureResponderEvent,
    PanResponder,
    type PanResponderGestureState,
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
import { BrandedLoadingState } from "../../../../ui/BrandedLoader";

const WEEKDAY_SHORT = ["일", "월", "화", "수", "목", "금", "토"];

function getCompactSectionLabels(dateKey: string) {
    const date = new Date(`${dateKey}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
        return { dateLabel: dateKey, weekdayLabel: "" };
    }

    const weekday = WEEKDAY_SHORT[date.getDay()];
    return {
        dateLabel: `${date.getMonth() + 1}월 ${date.getDate()}일`,
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
    routeSetupRequiredCount?: number;
    onOpenRouteSetup?: () => void;
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

    if (loading) {
        return (
            <BrandedLoadingState
                size="section"
                variant="schedule"
                accessibilityLabel="일정을 불러오는 중이에요"
                caption="일정을 불러오는 중이에요"
            />
        );
    }

    if (!error) {
        return (
            <View style={styles.emptyState}>
                <Ionicons accessible={false} name="calendar-outline" size={22} color={colors.textSecondary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    {emptyText}
                </Text>
            </View>
        );
    }

    return (
        <Pressable
            accessibilityRole={error ? "button" : undefined}
            accessibilityLabel={error ? `${error}. 다시 조회` : undefined}
            disabled={!error}
            onPress={error ? onPressRetry : undefined}
            style={({ pressed }) => [
                styles.emptyState,
                { opacity: pressed ? 0.58 : 1 },
            ]}
        >
            <Ionicons
                accessible={false}
                name={error ? "refresh-outline" : "calendar-outline"}
                size={22}
                color={colors.textSecondary}
            />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {error}
            </Text>
        </Pressable>
    );
}

function RouteSetupInlineNotice({
    count,
    onPress,
}: {
    count: number;
    onPress?: () => void;
}) {
    const { colors, mode } = useTheme();

    if (count <= 0 || !onPress) return null;

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`경로 설정이 필요한 일정 ${count}개. 가장 가까운 일정의 경로 설정 열기`}
            accessibilityHint="일정 상세에서 경로를 설정합니다"
            onPress={onPress}
            style={({ pressed }) => [
                styles.routeSetupNotice,
                {
                    backgroundColor: mode === "dark"
                        ? "rgba(255,159,10,0.10)"
                        : "rgba(255,159,10,0.075)",
                    borderColor: mode === "dark"
                        ? "rgba(255,159,10,0.32)"
                        : "rgba(210,126,0,0.20)",
                    opacity: pressed ? 0.62 : 1,
                },
            ]}
        >
            <View style={styles.routeSetupNoticeIcon}>
                <Ionicons
                    accessible={false}
                    name="navigate-outline"
                    size={14}
                    color="#FF9F0A"
                />
            </View>
            <Text
                numberOfLines={1}
                style={[styles.routeSetupNoticeTitle, { color: colors.textPrimary }]}
            >
                {`경로 미설정 ${count}개`}
            </Text>
            <Text style={styles.routeSetupNoticeAction}>설정</Text>
            <Ionicons
                accessible={false}
                name="chevron-forward"
                size={13}
                color="#FF9F0A"
            />
        </Pressable>
    );
}

function MonthAgendaPanelGestureHandle({
    panelKind,
    onRequestViewMode,
}: {
    panelKind: MonthAgendaPanelKind;
    onRequestViewMode: (mode: MonthAgendaSteppedTarget) => void;
}) {
    const { mode } = useTheme();
    const handleDragY = useRef(new Animated.Value(0)).current;
    const gestureInvalidatedByMultitouchRef = useRef(false);
    const handlePanResponder = useMemo(() => {
        const hasMultipleTouches = (
            event: GestureResponderEvent,
            gestureState?: PanResponderGestureState
        ) => {
            const reportedTouchCount = event.nativeEvent?.touches?.length ?? 0;
            const activeTouchCount = reportedTouchCount > 0
                ? reportedTouchCount
                : (gestureState?.numberActiveTouches ?? 0);
            return activeTouchCount > 1;
        };
        const settleHandle = () => {
            Animated.spring(handleDragY, {
                toValue: 0,
                damping: 18,
                stiffness: 240,
                mass: 0.72,
                useNativeDriver: true,
            }).start();
        };
        const prepareGesture = (
            event: GestureResponderEvent,
            gestureState: PanResponderGestureState
        ) => {
            gestureInvalidatedByMultitouchRef.current = hasMultipleTouches(
                event,
                gestureState
            );
            return false;
        };
        const shouldClaimGesture = (
            event: GestureResponderEvent,
            gestureState: PanResponderGestureState
        ) => {
            if (hasMultipleTouches(event, gestureState)) {
                gestureInvalidatedByMultitouchRef.current = true;
                return false;
            }
            if (gestureInvalidatedByMultitouchRef.current) return false;
            return shouldClaimMonthAgendaGesture(
                gestureState.dx,
                gestureState.dy
            );
        };
        const cancelGesture = () => {
            gestureInvalidatedByMultitouchRef.current = false;
            settleHandle();
        };

        return PanResponder.create({
            onStartShouldSetPanResponder: prepareGesture,
            onStartShouldSetPanResponderCapture: prepareGesture,
            onMoveShouldSetPanResponder: shouldClaimGesture,
            onMoveShouldSetPanResponderCapture: shouldClaimGesture,
            onPanResponderGrant: (event, gestureState) => {
                if (
                    gestureInvalidatedByMultitouchRef.current
                    || hasMultipleTouches(event, gestureState)
                ) {
                    gestureInvalidatedByMultitouchRef.current = true;
                    settleHandle();
                    return;
                }
                handleDragY.stopAnimation();
            },
            onPanResponderMove: (event, gestureState) => {
                if (hasMultipleTouches(event, gestureState)) {
                    gestureInvalidatedByMultitouchRef.current = true;
                    settleHandle();
                    return;
                }
                if (gestureInvalidatedByMultitouchRef.current) return;
                const translatedY = Math.max(
                    -MONTH_AGENDA_GESTURE.handleTravel,
                    Math.min(
                        MONTH_AGENDA_GESTURE.handleTravel,
                        gestureState.dy * 0.24
                    )
                );
                handleDragY.setValue(translatedY);
            },
            onPanResponderRelease: (event, gestureState) => {
                if (
                    gestureInvalidatedByMultitouchRef.current
                    || hasMultipleTouches(event, gestureState)
                ) {
                    gestureInvalidatedByMultitouchRef.current = false;
                    settleHandle();
                    return;
                }
                const target = getMonthAgendaSteppedTarget(
                    panelKind,
                    gestureState.dy,
                    gestureState.vy
                );
                settleHandle();
                if (target) onRequestViewMode(target);
            },
            onPanResponderTerminate: cancelGesture,
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
        <View
            testID={`month-agenda-${panelKind}-gesture-handle`}
            {...handlePanResponder.panHandlers}
            style={styles.panelGestureHandle}
        >
            <Animated.View
                testID="month-agenda-panel-handle"
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
        </View>
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
    routeSetupRequiredCount = 0,
    onOpenRouteSetup,
    onRequestViewMode,
}: SelectedDayAgendaPanelProps) {
    const { colors, mode } = useTheme();
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
            <MonthAgendaPanelGestureHandle
                panelKind="detail"
                onRequestViewMode={onRequestViewMode}
            />

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={[
                    styles.selectedDayContent,
                    { paddingBottom: Math.max(bottomInset + 138, 154) },
                ]}
                showsVerticalScrollIndicator={false}
            >
                <RouteSetupInlineNotice
                    count={routeSetupRequiredCount}
                    onPress={onOpenRouteSetup}
                />
                {loading || error || selectedItems.length === 0 ? (
                    <AgendaInlineState
                        loading={loading}
                        error={error}
                        emptyText="선택한 날짜에 등록된 일정이 없어요"
                        onPressRetry={onPressRetry}
                    />
                ) : (
                    <View
                        testID="selected-day-agenda-group"
                        style={[
                            styles.selectedDayGroup,
                            {
                                backgroundColor: mode === "dark"
                                    ? colors.surface
                                    : colors.surface2,
                                borderColor: colors.border,
                            },
                        ]}
                    >
                        {selectedItems.map((item, index) => (
                            <React.Fragment key={item.id}>
                                {index > 0 ? (
                                    <View
                                        testID="selected-day-agenda-divider"
                                        style={[
                                            styles.selectedDayGroupDivider,
                                            { backgroundColor: colors.border },
                                        ]}
                                    />
                                ) : null}
                                <ScheduleAgendaCard
                                    item={item}
                                    groupRow
                                    showMultiDaySummary
                                    onPress={() => onOpenSchedule(item.id)}
                                />
                            </React.Fragment>
                        ))}
                    </View>
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
    routeSetupRequiredCount = 0,
    onOpenRouteSetup,
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
            <MonthAgendaPanelGestureHandle
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
                    accessibilityState={{ disabled: false }}
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
                        accessible={false}
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
                <RouteSetupInlineNotice
                    count={routeSetupRequiredCount}
                    onPress={onOpenRouteSetup}
                />
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
    panelGestureHandle: {
        flexShrink: 0,
    },
    panelHandleHitArea: {
        width: "100%",
        height: 28,
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
    scroll: {
        flex: 1,
        minHeight: 0,
    },
    selectedDayContent: {
        paddingHorizontal: 14,
        paddingTop: 6,
        gap: 10,
    },
    selectedDayGroup: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 5,
        overflow: "hidden",
    },
    selectedDayGroupDivider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 18,
        marginRight: 12,
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
    routeSetupNotice: {
        minHeight: 38,
        paddingHorizontal: 9,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
    routeSetupNoticeIcon: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,159,10,0.14)",
    },
    routeSetupNoticeTitle: {
        flex: 1,
        minWidth: 0,
        fontSize: 12.5,
        lineHeight: 17,
        fontWeight: "800",
        letterSpacing: 0,
    },
    routeSetupNoticeAction: {
        flexShrink: 0,
        fontSize: 11.5,
        lineHeight: 16,
        fontWeight: "800",
        letterSpacing: 0,
        color: "#FF9F0A",
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
