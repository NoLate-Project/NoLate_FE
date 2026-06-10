import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Animated,
    Easing,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import CalendarWrapper from "../../src/modules/schedule/components/calendar/CalendarWrapper";
import CalendarSearchModal from "../../src/modules/schedule/components/calendar/CalendarSearchModal";
import CalendarSettingsModal from "../../src/modules/schedule/components/calendar/CalendarSettingsModal";
import CalendarViewModeMenu from "../../src/modules/schedule/components/calendar/CalendarViewModeMenu";
import CalendarYearOverviewModal from "../../src/modules/schedule/components/calendar/CalendarYearOverviewModal";
import CalendarGlassSurface from "../../src/modules/schedule/components/calendar/CalendarGlassSurface";
import {
    CALENDAR_VIEW_OPTIONS,
    type CalendarViewMode,
} from "../../src/modules/schedule/components/calendar/viewMode";
import ScheduleList from "../../src/modules/schedule/components/list/ScheduleList";
import ScheduleNewModal from "../../src/modules/schedule/components/form/ScheduleAddModal";

import { useScheduleStore } from "../../src/modules/schedule/store";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { isOverlappingDay, toYmd } from "../../lib/util/data";
import type { ScheduleItem, ScheduleParseResult } from "../../src/modules/schedule/types";
import { createSchedule, getSchedules, parseScheduleText } from "../../src/api/schedule";

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "요청 처리에 실패했습니다.";

export default function ScheduleIndex() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { mode, colors } = useTheme();
    const { state, dispatch } = useScheduleStore();
    const [modalVisible, setModalVisible] = useState(false);
    const [formInitialValues, setFormInitialValues] = useState<ScheduleParseResult | null>(null);
    const [calendarViewMode, setCalendarViewMode] = useState<CalendarViewMode>("stack");
    const [viewMenuVisible, setViewMenuVisible] = useState(false);
    const [yearOverviewVisible, setYearOverviewVisible] = useState(false);
    const [settingsVisible, setSettingsVisible] = useState(false);
    const [searchVisible, setSearchVisible] = useState(false);
    const [firstDay, setFirstDay] = useState<0 | 1>(0);
    const [calendarScrollRequest, setCalendarScrollRequest] = useState(0);
    const calendarTransition = useRef(new Animated.Value(1)).current;
    const viewTransitioningRef = useRef(false);

    const selectedDay = state.selectedDay;
    const [visibleMonth, setVisibleMonth] = useState(selectedDay);
    const [overviewYear, setOverviewYear] = useState(
        new Date(`${selectedDay}T00:00:00`).getFullYear()
    );
    const visibleYear = new Date(`${visibleMonth}T00:00:00`).getFullYear();
    const calendarViewIcon = CALENDAR_VIEW_OPTIONS.find(
        (option) => option.value === calendarViewMode
    )?.icon ?? "list-outline";
    const calendarContentTranslateY = calendarTransition.interpolate({
        inputRange: [0, 1],
        outputRange: [8, 0],
    });
    const calendarIconScale = calendarTransition.interpolate({
        inputRange: [0, 1],
        outputRange: [0.82, 1],
    });

    const loadSchedules = useCallback(async () => {
        dispatch({ type: "SET_LOADING", loading: true });
        dispatch({ type: "SET_ERROR", error: null });

        try {
            const items = await getSchedules();
            dispatch({ type: "SET_ITEMS", items });
        } catch (error) {
            const message = getErrorMessage(error);
            dispatch({ type: "SET_ERROR", error: message });
            Alert.alert("일정 조회 실패", message);
        } finally {
            dispatch({ type: "SET_LOADING", loading: false });
        }
    }, [dispatch]);

    useEffect(() => {
        loadSchedules();
    }, [loadSchedules]);

    const itemsArray = useMemo(
        () => Object.values(state.itemsById),
        [state.itemsById]
    );

    // 선택한 날짜에 걸친 일정을 시간순으로 정렬한다.
    const list = useMemo(() => {
        return itemsArray
            .filter((it) => isOverlappingDay(it.startAt, it.endAt, selectedDay))
            .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    }, [itemsArray, selectedDay]);

    // 새 일정 payload를 백엔드에 저장한 뒤 응답 값을 일정 저장소에 추가한다.
    const addItem = async (payload: Omit<ScheduleItem, "id">) => {
        dispatch({ type: "SET_LOADING", loading: true });

        try {
            const item = await createSchedule(payload);
            dispatch({ type: "ADD_ITEM", item });
        } catch (error) {
            const message = getErrorMessage(error);
            Alert.alert("일정 등록 실패", message);
            throw error;
        } finally {
            dispatch({ type: "SET_LOADING", loading: false });
        }
    };

    const openBlankSchedule = () => {
        setFormInitialValues(null);
        setModalVisible(true);
    };

    const handleQuickParse = async (text: string) => {
        try {
            const parsed = await parseScheduleText({
                text,
                referenceDate: selectedDay,
                defaultDurationMinutes: 60,
            });
            setFormInitialValues(parsed);
        } catch (error) {
            Alert.alert("일정 분석 실패", getErrorMessage(error));
            throw error;
        }
    };

    const handleVisibleMonthChange = useCallback((month: string) => {
        setVisibleMonth(month);
    }, []);

    const handleSelectDay = useCallback((day: string) => {
        dispatch({ type: "SET_SELECTED_DAY", day });
    }, [dispatch]);

    const handleOpenDay = useCallback((day: string) => {
        dispatch({ type: "SET_SELECTED_DAY", day });

        const hasSchedule = itemsArray.some((item) =>
            isOverlappingDay(item.startAt, item.endAt, day)
        );
        if (!hasSchedule) return;

        router.push({
            pathname: "/schedule/timetable",
            params: { date: day },
        });
    }, [dispatch, itemsArray, router]);

    const handleGoToday = useCallback(() => {
        const today = toYmd(new Date());
        dispatch({ type: "SET_SELECTED_DAY", day: today });
        setVisibleMonth(today);
        setCalendarScrollRequest((request) => request + 1);
    }, [dispatch]);

    const handleCalendarViewModeChange = useCallback((nextMode: CalendarViewMode) => {
        if (nextMode === calendarViewMode || viewTransitioningRef.current) return;

        viewTransitioningRef.current = true;
        Animated.timing(calendarTransition, {
            toValue: 0,
            duration: 110,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
        }).start(({ finished }) => {
            if (!finished) {
                viewTransitioningRef.current = false;
                return;
            }

            setCalendarViewMode(nextMode);
            requestAnimationFrame(() => {
                Animated.timing(calendarTransition, {
                    toValue: 1,
                    duration: 220,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }).start(() => {
                    viewTransitioningRef.current = false;
                });
            });
        });
    }, [calendarTransition, calendarViewMode]);

    const openYearOverview = () => {
        setOverviewYear(visibleYear);
        setYearOverviewVisible(true);
    };

    const selectOverviewMonth = (month: number) => {
        const nextDay = `${overviewYear}-${String(month).padStart(2, "0")}-01`;
        dispatch({ type: "SET_SELECTED_DAY", day: nextDay });
        setVisibleMonth(nextDay);
        setYearOverviewVisible(false);
    };

    return (
        <View style={[styles.root, { backgroundColor: colors.background }]}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />

            <View style={{ paddingTop: insets.top }}>
                <View style={styles.toolbar}>
                    <CalendarGlassSurface
                        interactive
                        style={[styles.yearGlass, { borderColor: colors.border }]}
                    >
                        <Pressable
                            onPress={openYearOverview}
                            accessibilityLabel={`${visibleYear}년 전체 월 보기`}
                            style={({ pressed }) => [
                                styles.yearButton,
                                { opacity: pressed ? 0.58 : 1 },
                            ]}
                        >
                            <Ionicons name="chevron-back" size={19} color={colors.textPrimary} />
                            <Text style={[styles.yearText, { color: colors.textPrimary }]}>
                                {visibleYear}년
                            </Text>
                        </Pressable>
                    </CalendarGlassSurface>

                    <CalendarGlassSurface
                        interactive
                        style={[
                            styles.toolbarActions,
                            { borderColor: colors.border },
                        ]}
                    >
                        <Pressable
                            onPress={() => setViewMenuVisible(true)}
                            accessibilityLabel="캘린더 보기 방식 선택"
                            style={({ pressed }) => [
                                styles.iconButton,
                                { opacity: pressed ? 0.5 : 1 },
                            ]}
                        >
                            <Animated.View
                                style={{
                                    opacity: calendarTransition,
                                    transform: [{ scale: calendarIconScale }],
                                }}
                            >
                                <Ionicons name={calendarViewIcon} size={22} color={colors.textPrimary} />
                            </Animated.View>
                        </Pressable>

                        <View style={[styles.toolbarDivider, { backgroundColor: colors.border }]} />

                        <Pressable
                            onPress={() => setSearchVisible(true)}
                            accessibilityLabel="일정 검색"
                            style={({ pressed }) => [
                                styles.iconButton,
                                { opacity: pressed ? 0.5 : 1 },
                            ]}
                        >
                            <Ionicons name="search" size={21} color={colors.textPrimary} />
                        </Pressable>

                        <View style={[styles.toolbarDivider, { backgroundColor: colors.border }]} />

                        <Pressable
                            onPress={openBlankSchedule}
                            accessibilityLabel="일정 추가"
                            style={({ pressed }) => [
                                styles.iconButton,
                                { opacity: pressed ? 0.5 : 1 },
                            ]}
                        >
                            <Ionicons name="add" size={23} color={colors.textPrimary} />
                        </Pressable>
                    </CalendarGlassSurface>
                </View>
            </View>

            <Animated.View
                style={[
                    styles.calendarContent,
                    {
                        opacity: calendarTransition,
                        transform: [{ translateY: calendarContentTranslateY }],
                    },
                ]}
            >
                <CalendarWrapper
                    selectedDay={selectedDay}
                    items={itemsArray}
                    onSelectDay={handleSelectDay}
                    onOpenDay={handleOpenDay}
                    viewMode={calendarViewMode}
                    firstDay={firstDay}
                    scrollRequest={calendarScrollRequest}
                    onVisibleMonthChange={handleVisibleMonthChange}
                />

                {calendarViewMode === "list" && (
                    <View style={[styles.agenda, { borderTopColor: colors.border }]}>
                        <ScheduleList
                            selectedDay={selectedDay}
                            items={list}
                            loading={state.loading}
                            error={state.error}
                            onPressRetry={loadSchedules}
                        />
                    </View>
                )}
            </Animated.View>

            <View
                pointerEvents="box-none"
                style={[
                    styles.bottomControls,
                    { bottom: Math.max(insets.bottom, 10) + 8 },
                ]}
            >
                <CalendarGlassSurface
                    interactive
                    style={[styles.todayGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        onPress={handleGoToday}
                        accessibilityLabel="오늘 날짜로 이동"
                        style={({ pressed }) => [
                            styles.todayButton,
                            { opacity: pressed ? 0.55 : 1 },
                        ]}
                    >
                        <Text style={[styles.todayText, { color: colors.textPrimary }]}>
                            오늘
                        </Text>
                    </Pressable>
                </CalendarGlassSurface>

                <CalendarGlassSurface
                    interactive
                    style={[styles.settingsGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        onPress={() => setSettingsVisible(true)}
                        accessibilityLabel="캘린더 설정"
                        style={({ pressed }) => [
                            styles.settingsButton,
                            { opacity: pressed ? 0.5 : 1 },
                        ]}
                    >
                        <Ionicons name="settings-outline" size={23} color={colors.textPrimary} />
                    </Pressable>
                </CalendarGlassSurface>
            </View>

            <ScheduleNewModal
                visible={modalVisible}
                onClose={() => setModalVisible(false)}
                onSubmit={addItem}
                categories={state.categories}
                defaultDay={selectedDay}
                initialValues={formInitialValues}
                onQuickParse={handleQuickParse}
            />

            <CalendarViewModeMenu
                visible={viewMenuVisible}
                value={calendarViewMode}
                onClose={() => setViewMenuVisible(false)}
                onChange={handleCalendarViewModeChange}
            />

            <CalendarYearOverviewModal
                visible={yearOverviewVisible}
                year={overviewYear}
                selectedDay={selectedDay}
                firstDay={firstDay}
                onChangeYear={setOverviewYear}
                onSelectMonth={selectOverviewMonth}
                onClose={() => setYearOverviewVisible(false)}
            />

            <CalendarSettingsModal
                visible={settingsVisible}
                firstDay={firstDay}
                onChangeFirstDay={setFirstDay}
                onClose={() => setSettingsVisible(false)}
            />

            <CalendarSearchModal
                visible={searchVisible}
                items={itemsArray}
                onClose={() => setSearchVisible(false)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    toolbar: {
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 7,
    },
    toolbarActions: {
        flexDirection: "row",
        alignItems: "center",
        borderRadius: 23,
        borderWidth: 1,
        overflow: "hidden",
    },
    yearGlass: {
        minHeight: 42,
        borderRadius: 22,
        borderWidth: 1,
        overflow: "hidden",
    },
    yearButton: {
        minHeight: 42,
        borderRadius: 22,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingLeft: 9,
        paddingRight: 14,
        gap: 2,
    },
    yearText: {
        fontWeight: "800",
        fontSize: 16,
    },
    iconButton: {
        width: 41,
        height: 42,
        alignItems: "center",
        justifyContent: "center",
    },
    toolbarDivider: {
        width: StyleSheet.hairlineWidth,
        height: 21,
    },
    agenda: {
        flex: 1,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 18,
        paddingTop: 18,
    },
    calendarContent: {
        flex: 1,
        paddingBottom: 74,
    },
    bottomControls: {
        position: "absolute",
        left: 18,
        right: 18,
        zIndex: 20,
        elevation: 20,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    todayGlass: {
        minWidth: 74,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        overflow: "hidden",
    },
    todayButton: {
        flex: 1,
        paddingHorizontal: 18,
        alignItems: "center",
        justifyContent: "center",
    },
    todayText: {
        fontSize: 15,
        fontWeight: "800",
    },
    settingsGlass: {
        width: 48,
        height: 48,
        borderRadius: 24,
        borderWidth: 1,
        overflow: "hidden",
    },
    settingsButton: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
});
