import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Pressable, Text, StatusBar, Alert, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import CalendarWrapper from "../../src/modules/schedule/components/calendar/CalendarWrapper";
import CalendarSearchModal from "../../src/modules/schedule/components/calendar/CalendarSearchModal";
import CalendarSettingsModal from "../../src/modules/schedule/components/calendar/CalendarSettingsModal";
import CalendarViewModeMenu from "../../src/modules/schedule/components/calendar/CalendarViewModeMenu";
import CalendarYearOverviewModal from "../../src/modules/schedule/components/calendar/CalendarYearOverviewModal";
import {
    CALENDAR_VIEW_OPTIONS,
    type CalendarViewMode,
} from "../../src/modules/schedule/components/calendar/viewMode";
import ScheduleList from "../../src/modules/schedule/components/list/ScheduleList";
import ScheduleNewModal from "../../src/modules/schedule/components/form/ScheduleAddModal";

import { useScheduleStore } from "../../src/modules/schedule/store";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { isOverlappingDay } from "../../lib/util/data";
import type { ScheduleItem, ScheduleParseResult } from "../../src/modules/schedule/types";
import { createSchedule, getSchedules, parseScheduleText } from "../../src/api/schedule";

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "요청 처리에 실패했습니다.";

export default function ScheduleIndex() {
    const insets = useSafeAreaInsets();
    const { mode, colors } = useTheme();
    const { state, dispatch } = useScheduleStore();
    const [modalVisible, setModalVisible] = useState(false);
    const [formInitialValues, setFormInitialValues] = useState<ScheduleParseResult | null>(null);
    const [calendarViewMode, setCalendarViewMode] = useState<CalendarViewMode>("list");
    const [viewMenuVisible, setViewMenuVisible] = useState(false);
    const [yearOverviewVisible, setYearOverviewVisible] = useState(false);
    const [settingsVisible, setSettingsVisible] = useState(false);
    const [searchVisible, setSearchVisible] = useState(false);
    const [firstDay, setFirstDay] = useState<0 | 1>(0);

    const selectedDay = state.selectedDay;
    const [visibleMonth, setVisibleMonth] = useState(selectedDay);
    const [overviewYear, setOverviewYear] = useState(
        new Date(`${selectedDay}T00:00:00`).getFullYear()
    );
    const visibleYear = new Date(`${visibleMonth}T00:00:00`).getFullYear();
    const calendarViewIcon = CALENDAR_VIEW_OPTIONS.find(
        (option) => option.value === calendarViewMode
    )?.icon ?? "list-outline";

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
        <View style={{ flex: 1, backgroundColor: colors.background }}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />

            <View
                style={[
                    { paddingTop: insets.top },
                    calendarViewMode !== "list" && styles.fullCalendarArea,
                ]}
            >
                <View style={styles.toolbar}>
                    <Pressable
                        onPress={openYearOverview}
                        accessibilityLabel={`${visibleYear}년 전체 월 보기`}
                        style={({ pressed }) => [
                            styles.yearButton,
                            {
                                borderColor: colors.border,
                                backgroundColor: pressed ? colors.surface : colors.surface2,
                            },
                        ]}
                    >
                        <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
                        <Text style={[styles.yearText, { color: colors.textPrimary }]}>
                            {visibleYear}년
                        </Text>
                    </Pressable>

                    <View
                        style={[
                            styles.toolbarActions,
                            { backgroundColor: colors.surface2, borderColor: colors.border },
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
                            <Ionicons name={calendarViewIcon} size={22} color={colors.textPrimary} />
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
                            onPress={() => setSettingsVisible(true)}
                            accessibilityLabel="캘린더 설정"
                            style={({ pressed }) => [
                                styles.iconButton,
                                { opacity: pressed ? 0.5 : 1 },
                            ]}
                        >
                            <Ionicons name="settings-outline" size={20} color={colors.textPrimary} />
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
                    </View>
                </View>

                <CalendarWrapper
                    selectedDay={selectedDay}
                    items={itemsArray}
                    onSelectDay={(day) => dispatch({ type: "SET_SELECTED_DAY", day })}
                    viewMode={calendarViewMode}
                    firstDay={firstDay}
                    onVisibleMonthChange={handleVisibleMonthChange}
                />
            </View>

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
                onChange={setCalendarViewMode}
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
        borderRadius: 21,
        borderWidth: 1,
        overflow: "hidden",
    },
    yearButton: {
        minHeight: 40,
        borderRadius: 20,
        borderWidth: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingLeft: 9,
        paddingRight: 14,
        gap: 2,
    },
    yearText: {
        fontWeight: "800",
        fontSize: 15,
    },
    iconButton: {
        width: 39,
        height: 40,
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
    fullCalendarArea: {
        flex: 1,
    },
});
