import styles from "./ScheduleAgendaViews.styles";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    ActionSheetIOS,
    Alert,
    Animated,
    Easing,
    type GestureResponderEvent,
    type LayoutChangeEvent,
    PanResponder,
    type PanResponderGestureState,
    Platform,
    Pressable,
    ScrollView,
    Text,
    View,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";

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
import { getFloatingActionBarClearance } from "../shared/floatingActionBarLayout";
import ScheduleAgendaCard from "./ScheduleAgendaCard";
import type { ScheduleSwipeActionResolver } from "../ScheduleSwipeActions";
import ScheduleIcon from "../shared/ScheduleIcon";

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
    getScheduleSwipeActions?: ScheduleSwipeActionResolver;
    onRequestScheduleActions?: (item: ScheduleItem) => void;
    routeSetupRequiredCount?: number;
    onOpenRouteSetup?: () => void;
    returnHighlight?: { id: string; opacity: Animated.Value };
};

type SelectedDayAgendaPanelProps = AgendaStateProps & {
    selectedDay: string;
    onRequestViewMode: (mode: MonthAgendaSteppedTarget) => void;
    savedItemId?: string;
    saveReturnVisible?: boolean;
    reduceEntryMotion?: boolean;
};

type MonthAgendaListProps = AgendaStateProps & {
    visibleMonth: string;
    onRequestViewMode: (mode: MonthAgendaSteppedTarget) => void;
    entryDate?: string;
    savedEntry?: { itemId: string; categoryId?: string };
    saveReturnVisible?: boolean;
    reduceEntryMotion?: boolean;
};

function useLoadedAgendaOpacity(loading: boolean, hasVisibleResults: boolean) {
    const reduceMotion = useReducedMotion();
    const wasLoading = useRef(loading);
    const opacity = useRef(new Animated.Value(1)).current;

    useLayoutEffect(() => {
        const reveal = wasLoading.current && !loading && hasVisibleResults && !reduceMotion;
        wasLoading.current = loading;
        opacity.setValue(reveal ? 0 : 1);
        if (!reveal) return;

        const animation = Animated.timing(opacity, {
            toValue: 1,
            duration: 160,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
            isInteraction: false,
        });
        animation.start();
        return () => animation.stop();
    }, [hasVisibleResults, loading, opacity, reduceMotion]);

    return opacity;
}

function useAgendaEntryHighlight(entryId: string | undefined, ready: boolean, reduceMotion: boolean) {
    const opacity = useRef(new Animated.Value(0)).current;
    const shownEntry = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (!entryId || !ready || shownEntry.current === entryId) return;
        shownEntry.current = entryId;
        if (reduceMotion) return;
        opacity.setValue(0.08);
        const fade = Animated.timing(opacity, {
            toValue: 0,
            duration: 240,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
            isInteraction: false,
        });
        fade.start();
        return () => {
            fade.stop();
            opacity.setValue(0);
        };
    }, [entryId, opacity, ready, reduceMotion]);
    return opacity;
}

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
            <View
                accessible
                accessibilityRole="progressbar"
                accessibilityLiveRegion="polite"
                accessibilityLabel="일정을 불러오는 중이에요"
                style={[styles.emptyState, styles.loadingState]}
            >
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    일정을 불러오는 중이에요
                </Text>
            </View>
        );
    }

    if (!error) {
        return (
            <View style={styles.emptyState}>
                <ScheduleIcon name="calendar" role="toolbar" color={colors.textSecondary} />
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
            <ScheduleIcon name="refresh" role="toolbar" color={colors.textSecondary} />
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
    const actionColor = mode === "dark" ? "#FF9F0A" : "#B85F00";

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
                <ScheduleIcon name="departure" color={actionColor} />
            </View>
            <Text
                numberOfLines={1}
                style={[styles.routeSetupNoticeTitle, { color: colors.textPrimary }]}
            >
                {`경로 미설정 ${count}개`}
            </Text>
            <Text style={[styles.routeSetupNoticeAction, { color: actionColor }]}>설정</Text>
            <ScheduleIcon name="forward" color={actionColor} />
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
    getScheduleSwipeActions,
    onRequestScheduleActions,
    routeSetupRequiredCount = 0,
    onOpenRouteSetup,
    onRequestViewMode,
    returnHighlight,
    savedItemId,
    saveReturnVisible = true,
    reduceEntryMotion = true,
}: SelectedDayAgendaPanelProps) {
    const { colors, mode } = useTheme();
    const selectedItems = useMemo(
        () => getSelectedDayAgendaItems(items, selectedDay),
        [items, selectedDay]
    );
    const selectedLabels = getCompactSectionLabels(selectedDay);
    const loadedOpacity = useLoadedAgendaOpacity(loading, !error && selectedItems.length > 0);
    const savedRowReady = saveReturnVisible && !loading && !error && selectedItems.some(item => item.id === savedItemId);
    const savedRowHighlight = useAgendaEntryHighlight(savedItemId, savedRowReady, reduceEntryMotion);

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
            <View testID="selected-day-agenda-heading" style={styles.selectedDayHeading}>
                <View style={styles.sectionHeading}>
                    <Text accessibilityRole="header" maxFontSizeMultiplier={1.6} style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                        {selectedLabels.dateLabel}
                    </Text>
                    <Text maxFontSizeMultiplier={1.6} style={[styles.sectionWeekday, { color: colors.textSecondary }]}>
                        {selectedLabels.weekdayLabel}
                    </Text>
                </View>
                {!loading && !error ? (
                    <Text maxFontSizeMultiplier={1.6} style={[styles.sectionCount, { color: colors.textSecondary }]}>
                        {selectedItems.length}개의 일정
                    </Text>
                ) : null}
            </View>

            <ScrollView
                style={[
                    styles.scroll,
                    { marginBottom: getFloatingActionBarClearance(bottomInset) },
                ]}
                contentContainerStyle={[
                    styles.selectedDayContent,
                    styles.floatingBarContentEnd,
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
                    <Animated.View
                        testID="selected-day-agenda-group"
                        style={[
                            styles.selectedDayGroup,
                            {
                                backgroundColor: mode === "dark"
                                    ? colors.surface
                                    : colors.surface2,
                                borderColor: colors.border,
                                opacity: loadedOpacity,
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
                                    returnHighlightOpacity={returnHighlight?.id === item.id
                                        ? returnHighlight.opacity
                                        : savedItemId === item.id && !reduceEntryMotion ? savedRowHighlight : undefined}
                                    onPress={() => onOpenSchedule(item.id)}
                                    swipeActions={getScheduleSwipeActions?.(item)}
                                    onLongPress={onRequestScheduleActions
                                        ? () => onRequestScheduleActions(item)
                                        : undefined}
                                />
                            </React.Fragment>
                        ))}
                    </Animated.View>
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
    getScheduleSwipeActions,
    onRequestScheduleActions,
    routeSetupRequiredCount = 0,
    onOpenRouteSetup,
    onRequestViewMode,
    entryDate,
    savedEntry,
    saveReturnVisible = true,
    reduceEntryMotion = true,
    returnHighlight,
}: MonthAgendaListProps) {
    const { colors, mode } = useTheme();
    const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
    const [handledSavedItem, setHandledSavedItem] = useState<string>();
    const [filterClearedFor, setFilterClearedFor] = useState<string>();
    if (savedEntry && savedEntry.itemId !== handledSavedItem) {
        setHandledSavedItem(savedEntry.itemId);
        if (selectedCategoryId && selectedCategoryId !== savedEntry.categoryId) {
            setSelectedCategoryId(null);
            setFilterClearedFor(savedEntry.itemId);
        }
    }
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
    const { sections, entrySectionDate } = useMemo(() => {
        const monthSections = buildMonthAgendaSections(filteredItems, visibleMonth);
        if (!entryDate || loading || error || (activeCategoryId && !savedEntry) || monthSections.length === 0) {
            return { sections: monthSections, entrySectionDate: undefined };
        }
        if (monthSections.some(section => section.dateKey === entryDate)) {
            return { sections: monthSections, entrySectionDate: entryDate };
        }
        const activeItems = new Set(getSelectedDayAgendaItems(filteredItems, entryDate).map(item => item.id));
        const continuingSection = [...monthSections].reverse().find(section =>
            section.items.some(item => activeItems.has(item.id))
        );
        if (continuingSection) {
            return { sections: monthSections, entrySectionDate: continuingSection.dateKey };
        }
        const emptyEntry = { dateKey: entryDate, header: '', itemCount: 0, items: [] };
        return {
            sections: [...monthSections, emptyEntry].sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
            entrySectionDate: entryDate,
        };
    }, [activeCategoryId, entryDate, error, filteredItems, loading, savedEntry, visibleMonth]);
    const scrollRef = useRef<ScrollView>(null);
    const entryLayout = useRef({ viewportHeight: 0, contentHeight: 0, offset: null as number | null });
    const entryFrame = useRef<number | null>(null);
    const entryStarted = useRef(false);
    const [entryPositioned, setEntryPositioned] = useState(false);
    const [entryEndSpace, setEntryEndSpace] = useState(0);
    useLayoutEffect(() => {
        entryLayout.current = { viewportHeight: 0, contentHeight: 0, offset: null };
        entryStarted.current = false;
        setEntryPositioned(false);
        setEntryEndSpace(0);
        return () => {
            if (entryFrame.current !== null) cancelAnimationFrame(entryFrame.current);
            entryFrame.current = null;
        };
    }, [handledSavedItem]);
    const positionEntry = useCallback(() => {
        if (entryStarted.current) return;
        const { viewportHeight, contentHeight, offset } = entryLayout.current;
        if (!viewportHeight || !contentHeight || offset === null) return;
        const missingSpace = viewportHeight + offset - contentHeight;
        if (missingSpace > 1) {
            setEntryEndSpace(Math.ceil(missingSpace));
            return;
        }
        entryStarted.current = true;
        entryFrame.current = requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({ y: offset, animated: false });
            entryFrame.current = requestAnimationFrame(() => {
                entryFrame.current = null;
                setEntryPositioned(true);
            });
        });
    }, []);
    const measureEntry = useCallback((event: LayoutChangeEvent) => {
        entryLayout.current.offset = Math.max(0, event.nativeEvent.layout.y - 8);
        positionEntry();
    }, [positionEntry]);
    const measureEntryViewport = useCallback((event: LayoutChangeEvent) => {
        entryLayout.current.viewportHeight = event.nativeEvent.layout.height;
        positionEntry();
    }, [positionEntry]);
    const measureEntryContent = useCallback((_width: number, height: number) => {
        entryLayout.current.contentHeight = height;
        positionEntry();
    }, [positionEntry]);
    const entryHighlight = useAgendaEntryHighlight(
        savedEntry?.itemId ?? entrySectionDate,
        entryPositioned && saveReturnVisible && (!savedEntry || filteredItems.some(item => item.id === savedEntry.itemId)),
        reduceEntryMotion
    );
    const positioningEntry = Boolean(entrySectionDate && !entryPositioned);
    const loadedOpacity = useLoadedAgendaOpacity(
        loading,
        !error && sections.length > 0 && !entrySectionDate
    );
    const visibleMonthNumber = Number(visibleMonth.slice(5, 7));
    const allCategoriesTitle = "모든 카테고리";
    const selectedCategoryTitle = categoryOptions.find(
        (option) => option.id === activeCategoryId
    )?.title ?? allCategoriesTitle;
    const listIdentity = `${visibleMonth.slice(0, 7)}:${activeCategoryId ?? "all"}:${handledSavedItem ?? ""}`;

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
        setFilterClearedFor(undefined);
        setSelectedCategoryId(
            buttonIndex === 0
                ? null
                : categoryOptions[buttonIndex - 1]?.id ?? null
        );
    }, [categoryOptions]);

    const openCategoryFilter = useCallback(() => {
        const options = [
            allCategoriesTitle,
            ...categoryOptions.map((option) => option.title),
            "취소",
        ];
        const cancelButtonIndex = options.length - 1;

        if (Platform.OS === "ios") {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    title: "카테고리 선택",
                    options,
                    cancelButtonIndex,
                },
                selectCategoryOption
            );
            return;
        }

        Alert.alert(
            "카테고리 선택",
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
                    hitSlop={6}
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
                        maxFontSizeMultiplier={1.5}
                        numberOfLines={1}
                        style={[
                            styles.agendaFilterText,
                            { color: colors.textPrimary },
                        ]}
                    >
                        {selectedCategoryTitle}
                    </Text>
                    <ScheduleIcon name="down" color={colors.textSecondary} />
                </Pressable>
            </View>

            {savedEntry && filterClearedFor === savedEntry.itemId && (
                <Text accessibilityLiveRegion="polite" style={[styles.agendaFilterNotice, { color: colors.textSecondary }]}>
                    저장한 일정이 보이도록 필터를 해제했어요.
                </Text>
            )}

            <Animated.ScrollView
                key={listIdentity}
                ref={scrollRef}
                onLayout={positioningEntry ? measureEntryViewport : undefined}
                onContentSizeChange={positioningEntry ? measureEntryContent : undefined}
                pointerEvents={positioningEntry ? 'none' : 'auto'}
                accessibilityElementsHidden={positioningEntry}
                importantForAccessibility={positioningEntry ? 'no-hide-descendants' : 'auto'}
                style={[
                    styles.scroll,
                    { marginBottom: getFloatingActionBarClearance(bottomInset) },
                    positioningEntry ? styles.unpositionedAgenda : { opacity: loadedOpacity },
                ]}
                contentContainerStyle={[
                    styles.monthListContent,
                    styles.floatingBarContentEnd,
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
                        const isEntry = section.dateKey === entrySectionDate;

                        return (
                            <View key={section.dateKey} style={styles.section} onLayout={isEntry && positioningEntry ? measureEntry : undefined}>
                                <View
                                    testID={isEntry ? 'month-agenda-entry-date' : undefined}
                                    style={[
                                        styles.sectionHeader,
                                        { borderBottomColor: colors.border },
                                    ]}
                                >
                                    {isEntry && !savedEntry && !reduceEntryMotion ? (
                                        <Animated.View
                                            pointerEvents="none"
                                            style={[styles.entryHighlight, { backgroundColor: colors.selectedDayBg, opacity: entryHighlight }]}
                                        />
                                    ) : null}
                                    <View style={styles.sectionHeading}>
                                        <Text
                                            accessibilityRole="header"
                                            maxFontSizeMultiplier={1.6}
                                            style={[
                                                styles.sectionTitle,
                                                { color: colors.textPrimary },
                                            ]}
                                        >
                                            {labels.dateLabel}
                                        </Text>
                                        <Text
                                            maxFontSizeMultiplier={1.6}
                                            style={[
                                                styles.sectionWeekday,
                                                { color: colors.textSecondary },
                                            ]}
                                        >
                                            {labels.weekdayLabel}
                                        </Text>
                                    </View>
                                    <Text
                                        maxFontSizeMultiplier={1.6}
                                        style={[
                                            styles.sectionCount,
                                            { color: colors.textSecondary },
                                        ]}
                                    >
                                        {section.itemCount}개의 일정
                                    </Text>
                                </View>

                                {section.itemCount === 0 ? (
                                    <AgendaInlineState loading={false} error={null} emptyText="등록된 일정이 없어요" onPressRetry={onPressRetry} />
                                ) : (
                                <View
                                    testID="month-agenda-group"
                                    style={[
                                        styles.selectedDayGroup,
                                        { backgroundColor: mode === "dark" ? colors.surface : colors.surface2, borderColor: colors.border },
                                    ]}
                                >
                                    {section.items.map((item, index) => (
                                      <React.Fragment key={item.id}>
                                        {index > 0 ? (
                                            <View
                                                testID="month-agenda-divider"
                                                style={[styles.selectedDayGroupDivider, { backgroundColor: colors.border }]}
                                            />
                                        ) : null}
                                        <ScheduleAgendaCard
                                            item={item}
                                            compact
                                            groupRow
                                            showMultiDaySummary
                                            returnHighlightOpacity={returnHighlight?.id === item.id
                                                ? returnHighlight.opacity
                                                : savedEntry?.itemId === item.id && !reduceEntryMotion ? entryHighlight : undefined}
                                            onPress={() => onOpenSchedule(item.id)}
                                            swipeActions={getScheduleSwipeActions?.(item)}
                                            onLongPress={onRequestScheduleActions
                                                ? () => onRequestScheduleActions(item)
                                                : undefined}
                                        />
                                      </React.Fragment>
                                    ))}
                                </View>
                                )}
                            </View>
                        );
                    })
                )}
                {entrySectionDate && entryEndSpace > 0 ? (
                    <View pointerEvents="none" style={{ height: entryEndSpace }} />
                ) : null}
            </Animated.ScrollView>
        </View>
    );
}
