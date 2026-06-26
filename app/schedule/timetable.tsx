import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    FlatList,
    Keyboard,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import CalendarGlassSurface from "../../src/modules/schedule/components/calendar/CalendarGlassSurface";
import CalendarSearchModal from "../../src/modules/schedule/components/calendar/CalendarSearchModal";
import GlobalFloatingActionBar, { type FloatingBarAction } from "../../src/modules/schedule/components/shared/GlobalFloatingActionBar";
import ScheduleNewModal from "../../src/modules/schedule/components/form/ScheduleAddModal";
import { createSchedule } from "../../src/api/schedule";
import { useScheduleStore } from "../../src/modules/schedule/store";
import type { ScheduleItem } from "../../src/modules/schedule/types";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { formatHHmm, isOverlappingDay, startOfDay, toYmd } from "../../lib/util/data";

const HOUR_HEIGHT = 48;
const TIMELINE_GUTTER = 48;
const MIN_EVENT_HEIGHT = 34;
const DAY_MINUTES = 24 * 60;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const WEEK_PAGE_OFFSETS = [-2, -1, 0, 1, 2];
const CENTER_WEEK_INDEX = 2;
const DAY_PAGE_OFFSETS = [-1, 0, 1];
const CENTER_DAY_INDEX = 1;

type PositionedEvent = {
    item: ScheduleItem;
    startMinute: number;
    endMinute: number;
    lane: number;
    laneCount: number;
};

type CalendarDay = {
    dateString: string;
    day: number;
    weekday: string;
    month: number;
};

function colorWithOpacity(color: string, opacity: number) {
    const normalized = color.replace("#", "");
    if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
        const r = Number.parseInt(normalized.slice(0, 2), 16);
        const g = Number.parseInt(normalized.slice(2, 4), 16);
        const b = Number.parseInt(normalized.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    return color;
}

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "요청 처리에 실패했습니다.";

function toDateString(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftDay(ymd: string, amount: number) {
    const date = new Date(`${ymd}T00:00:00`);
    date.setDate(date.getDate() + amount);
    return toDateString(date);
}

function startOfWeek(ymd: string) {
    const date = new Date(`${ymd}T00:00:00`);
    date.setDate(date.getDate() - date.getDay());
    return toDateString(date);
}

function createWeekDays(weekStart: string): CalendarDay[] {
    const start = new Date(`${weekStart}T00:00:00`);

    return Array.from({ length: 7 }, (_, index) => {
        const date = new Date(start);
        date.setDate(start.getDate() + index);

        return {
            dateString: toDateString(date),
            day: date.getDate(),
            weekday: WEEKDAYS[date.getDay()],
            month: date.getMonth() + 1,
        };
    });
}

function formatDateTitle(ymd: string) {
    const date = new Date(`${ymd}T00:00:00`);
    return `${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAYS[date.getDay()]}요일`;
}

function formatWeekRange(days: CalendarDay[]) {
    const first = days[0];
    const last = days[days.length - 1];

    if (first.month === last.month) {
        return `${first.month}월 ${first.day}일 - ${last.day}일`;
    }
    return `${first.month}월 ${first.day}일 - ${last.month}월 ${last.day}일`;
}

function minuteOfDay(date: Date) {
    return date.getHours() * 60 + date.getMinutes();
}

function buildPositionedEvents(items: ScheduleItem[], day: string): PositionedEvent[] {
    const dayStart = startOfDay(day).getTime();
    const nextDay = dayStart + 24 * 60 * 60 * 1000;
    const events = items
        .filter((item) => !item.allDay)
        .map((item) => {
            const rawStart = new Date(item.startAt).getTime();
            const rawEnd = new Date(item.endAt).getTime();
            const clippedStart = new Date(Math.max(rawStart, dayStart));
            const clippedEnd = new Date(Math.min(Math.max(rawEnd, rawStart + 30 * 60 * 1000), nextDay));
            const startMinute = rawStart < dayStart ? 0 : minuteOfDay(clippedStart);
            const endMinute = rawEnd >= nextDay ? DAY_MINUTES : minuteOfDay(clippedEnd);

            return {
                item,
                startMinute,
                endMinute: Math.max(startMinute + 30, endMinute),
                lane: 0,
                laneCount: 1,
            };
        })
        .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);

    let groupStart = 0;
    while (groupStart < events.length) {
        let groupEnd = groupStart + 1;
        let latestEnd = events[groupStart].endMinute;

        while (groupEnd < events.length && events[groupEnd].startMinute < latestEnd) {
            latestEnd = Math.max(latestEnd, events[groupEnd].endMinute);
            groupEnd += 1;
        }

        const laneEnds: number[] = [];
        for (let index = groupStart; index < groupEnd; index += 1) {
            const event = events[index];
            let lane = laneEnds.findIndex((endMinute) => endMinute <= event.startMinute);
            if (lane < 0) lane = laneEnds.length;
            laneEnds[lane] = event.endMinute;
            event.lane = lane;
        }

        const laneCount = Math.max(1, laneEnds.length);
        for (let index = groupStart; index < groupEnd; index += 1) {
            events[index].laneCount = laneCount;
        }
        groupStart = groupEnd;
    }

    return events;
}

export default function ScheduleTimetable() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams<{ date?: string | string[] }>();
    const { width: screenWidth } = useWindowDimensions();
    const { colors, mode } = useTheme();
    const { state, dispatch } = useScheduleStore();
    const timelineRef = useRef<ScrollView>(null);
    const weekListRef = useRef<FlatList<number>>(null);
    const dayListRef = useRef<FlatList<number>>(null);
    const dateParam = Array.isArray(params.date) ? params.date[0] : params.date;
    const [activeDay, setActiveDay] = useState(dateParam || state.selectedDay);
    const [now, setNow] = useState(() => new Date());
    const [searchVisible, setSearchVisible] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [keyboardVisible, setKeyboardVisible] = useState(false);
    const today = useMemo(() => toYmd(now), [now]);
    const activeWeekStart = useMemo(() => startOfWeek(activeDay), [activeDay]);
    const activeWeekDays = useMemo(() => createWeekDays(activeWeekStart), [activeWeekStart]);
    const allItems = useMemo(() => Object.values(state.itemsById), [state.itemsById]);

    const items = useMemo(
        () => allItems
            .filter((item) => isOverlappingDay(item.startAt, item.endAt, activeDay))
            .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
        [activeDay, allItems]
    );
    const positionedEvents = useMemo(() => buildPositionedEvents(items, activeDay), [activeDay, items]);
    const currentMinute = now.getHours() * 60 + now.getMinutes();
    const weekPageWidth = Math.max(1, screenWidth);
    const dayPageWidth = Math.max(1, screenWidth);

    useEffect(() => {
        dispatch({ type: "SET_SELECTED_DAY", day: activeDay });
    }, [activeDay, dispatch]);

    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 30_000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const showSubscription = Keyboard.addListener("keyboardDidShow", () => {
            setKeyboardVisible(true);
        });
        const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
            setKeyboardVisible(false);
        });

        return () => {
            showSubscription.remove();
            hideSubscription.remove();
        };
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            const liveNow = new Date();
            const liveMinute = liveNow.getHours() * 60 + liveNow.getMinutes();
            const targetMinute = positionedEvents[0]?.startMinute
                ?? (activeDay === toYmd(liveNow) ? liveMinute : 8 * 60);

            timelineRef.current?.scrollTo({
                y: Math.max(0, ((targetMinute - 90) / 60) * HOUR_HEIGHT),
                animated: false,
            });
        }, 80);
        return () => clearTimeout(timer);
    }, [activeDay, positionedEvents]);

    const openSchedule = useCallback((id: string) => {
        router.push({
            pathname: "/schedule/[id]",
            params: { id },
        });
    }, [router]);

    const addItem = useCallback(async (payload: Omit<ScheduleItem, "id">) => {
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
    }, [dispatch]);

    const moveWeek = useCallback((amount: number) => {
        setActiveDay((current) => shiftDay(current, amount * 7));
    }, []);

    const handleWeekMomentumEnd = useCallback((
        event: NativeSyntheticEvent<NativeScrollEvent>
    ) => {
        const index = Math.round(event.nativeEvent.contentOffset.x / weekPageWidth);
        const offset = WEEK_PAGE_OFFSETS[index] ?? 0;
        if (offset === 0) return;

        moveWeek(offset);
        requestAnimationFrame(() => {
            weekListRef.current?.scrollToIndex({
                index: CENTER_WEEK_INDEX,
                animated: false,
            });
        });
    }, [moveWeek, weekPageWidth]);

    const moveDayBy = useCallback((amount: number) => {
        setActiveDay((current) => shiftDay(current, amount));
    }, []);

    const handleDayMomentumEnd = useCallback((
        event: NativeSyntheticEvent<NativeScrollEvent>
    ) => {
        const index = Math.round(event.nativeEvent.contentOffset.x / dayPageWidth);
        const offset = DAY_PAGE_OFFSETS[index] ?? 0;
        if (offset === 0) return;

        moveDayBy(offset);
        requestAnimationFrame(() => {
            dayListRef.current?.scrollToIndex({
                index: CENTER_DAY_INDEX,
                animated: false,
            });
        });
    }, [dayPageWidth, moveDayBy]);

    const goToday = useCallback(() => {
        setActiveDay(today);
    }, [today]);

    const bottomLeftActions = useMemo<FloatingBarAction[]>(() => [{
        key: "today",
        icon: "calendar-outline",
        label: "오늘",
        accessibilityLabel: "오늘 날짜로 이동",
        onPress: goToday,
    }], [goToday]);

    const bottomRightActions = useMemo<FloatingBarAction[]>(() => [
        {
            key: "profile",
            icon: "person-circle-outline",
            label: "프로필",
            accessibilityLabel: "프로필 열기",
            onPress: () => router.push("/profile"),
        },
    ], [router]);

    const renderWeek = useCallback(({ item: offset }: { item: number }) => {
        const weekStart = shiftDay(activeWeekStart, offset * 7);
        const days = createWeekDays(weekStart);

        return (
            <View style={[styles.weekPage, { width: weekPageWidth }]}>
                {days.map((day) => {
                    const isSelected = day.dateString === activeDay;
                    const isCurrentDay = day.dateString === today;
                    const dayItems = allItems.filter((schedule) =>
                        isOverlappingDay(schedule.startAt, schedule.endAt, day.dateString)
                    );

                    return (
                        <Pressable
                            key={day.dateString}
                            onPress={() => setActiveDay(day.dateString)}
                            accessibilityLabel={`${day.month}월 ${day.day}일 ${day.weekday}요일`}
                            style={({ pressed }) => [
                                styles.weekDay,
                                {
                                    opacity: pressed ? 0.62 : 1,
                                },
                            ]}
                        >
                            <Text
                                style={[
                                    styles.weekdayLabel,
                                    { color: isSelected ? colors.textPrimary : colors.textSecondary },
                                ]}
                            >
                                {day.weekday}
                            </Text>
                            <View
                                style={[
                                    styles.weekDayCircle,
                                    isSelected && (
                                        mode === "dark"
                                            ? styles.weekDayCircleSelectedDark
                                            : styles.weekDayCircleSelectedLight
                                    ),
                                    isCurrentDay && !isSelected && (
                                        mode === "dark"
                                            ? styles.weekDayCircleTodayDark
                                            : styles.weekDayCircleTodayLight
                                    ),
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.weekDayText,
                                        {
                                            color: isSelected
                                                ? colors.selectedDayText
                                                : isCurrentDay
                                                    ? mode === "dark" ? "#ff453a" : "#ff3b30"
                                                    : colors.textPrimary,
                                        },
                                    ]}
                                >
                                    {day.day}
                                </Text>
                            </View>
                            <View style={styles.weekDots}>
                                {dayItems.slice(0, 3).map((schedule) => (
                                    <View
                                        key={schedule.id}
                                        style={[
                                            styles.weekDot,
                                            { backgroundColor: schedule.category?.color ?? "#8e8e93" },
                                        ]}
                                    />
                                ))}
                            </View>
                        </Pressable>
                    );
                })}
            </View>
        );
    }, [
        activeDay,
        activeWeekStart,
        allItems,
        colors.selectedDayText,
        colors.textPrimary,
        colors.textSecondary,
        mode,
        today,
        weekPageWidth,
    ]);

    const getItemsForDay = useCallback((day: string) => {
        return allItems
            .filter((item) => isOverlappingDay(item.startAt, item.endAt, day))
            .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    }, [allItems]);

    const renderTimelinePage = useCallback(({ item: offset }: { item: number }) => {
        const pageDay = shiftDay(activeDay, offset);
        const pageItems = getItemsForDay(pageDay);
        const pageAllDayItems = pageItems.filter((item) => item.allDay);
        const pagePositionedEvents = buildPositionedEvents(pageItems, pageDay);
        const pageIsToday = pageDay === today;

        return (
            <View style={[styles.dayPage, { width: dayPageWidth }]}>
                {pageAllDayItems.length > 0 && (
                    <View style={[styles.allDaySection, { borderBottomColor: colors.border }]}>
                        <Text style={[styles.allDayLabel, { color: colors.textSecondary }]}>
                            종일
                        </Text>
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.allDayItems}
                        >
                            {pageAllDayItems.map((item) => {
                                const color = item.category?.color ?? "#8e8e93";
                                return (
                                    <Pressable
                                        key={item.id}
                                        onPress={() => openSchedule(item.id)}
                                        style={({ pressed }) => [
                                            styles.allDayEvent,
                                            {
                                                backgroundColor: colorWithOpacity(color, mode === "dark" ? 0.24 : 0.14),
                                                borderColor: colorWithOpacity(color, 0.5),
                                                opacity: pressed ? 0.58 : 1,
                                            },
                                        ]}
                                    >
                                        <View style={[styles.allDayDot, { backgroundColor: color }]} />
                                        <Text numberOfLines={1} style={[styles.allDayTitle, { color }]}>
                                            {item.title}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </ScrollView>
                    </View>
                )}

                <ScrollView
                    ref={offset === 0 ? timelineRef : undefined}
                    style={styles.timelineScroll}
                    contentContainerStyle={styles.timelineContent}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={{ height: DAY_MINUTES / 60 * HOUR_HEIGHT }}>
                        {Array.from({ length: 25 }, (_, hour) => (
                            <View
                                key={hour}
                                style={[
                                    styles.hourRow,
                                    {
                                        top: hour * HOUR_HEIGHT,
                                        borderTopColor: colors.border,
                                    },
                                ]}
                            >
                                {hour < 24 && (
                                    <Text style={[styles.hourText, { color: colors.textSecondary }]}>
                                        {String(hour).padStart(2, "0")}:00
                                    </Text>
                                )}
                            </View>
                        ))}

                        <View style={styles.eventLayer}>
                            {pagePositionedEvents.map(({ item, startMinute, endMinute, lane, laneCount }) => {
                                const color = item.category?.color ?? "#8e8e93";
                                const top = startMinute / 60 * HOUR_HEIGHT;
                                const height = Math.max(
                                    MIN_EVENT_HEIGHT,
                                    (endMinute - startMinute) / 60 * HOUR_HEIGHT - 4
                                );
                                const laneWidth = 100 / laneCount;

                                return (
                                    <Pressable
                                        key={item.id}
                                        onPress={() => openSchedule(item.id)}
                                        style={({ pressed }) => [
                                            styles.timelineEvent,
                                            {
                                                top,
                                                height,
                                                left: `${lane * laneWidth}%`,
                                                width: `${laneWidth}%`,
                                                backgroundColor: mode === "dark"
                                                    ? colorWithOpacity(color, 0.24)
                                                    : colorWithOpacity(color, 0.13),
                                                borderColor: colorWithOpacity(color, mode === "dark" ? 0.55 : 0.32),
                                                opacity: pressed ? 0.58 : 1,
                                            },
                                        ]}
                                    >
                                        <View style={[styles.eventAccent, { backgroundColor: color }]} />
                                        <Text
                                            numberOfLines={1}
                                            style={[styles.eventTitle, { color: colors.textPrimary }]}
                                        >
                                            {item.title}
                                        </Text>
                                        <Text numberOfLines={1} style={[styles.eventTime, { color }]}>
                                            {item.hasEndTime === false
                                                ? formatHHmm(item.startAt)
                                                : `${formatHHmm(item.startAt)} - ${formatHHmm(item.endAt)}`}
                                        </Text>
                                        {!!item.category?.title && height >= 58 && (
                                            <Text
                                                numberOfLines={1}
                                                style={[styles.eventCategory, { color: colors.textSecondary }]}
                                            >
                                                {item.category.title}
                                            </Text>
                                        )}
                                    </Pressable>
                                );
                            })}
                        </View>

                        {pageIsToday && (
                            <View
                                pointerEvents="none"
                                style={[
                                    styles.nowLine,
                                    { top: currentMinute / 60 * HOUR_HEIGHT },
                                ]}
                            >
                                <View style={styles.nowDot} />
                                <View style={styles.nowRule} />
                            </View>
                        )}

                        {pagePositionedEvents.length === 0 && pageAllDayItems.length === 0 && (
                            <View style={styles.emptyState}>
                                <Ionicons
                                    name="calendar-clear-outline"
                                    size={28}
                                    color={colors.textSecondary}
                                />
                                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                                    이 날짜에는 일정이 없어요
                                </Text>
                            </View>
                        )}
                    </View>
                </ScrollView>
            </View>
        );
    }, [
        activeDay,
        colors.border,
        colors.textPrimary,
        colors.textSecondary,
        currentMinute,
        dayPageWidth,
        getItemsForDay,
        mode,
        openSchedule,
        today,
    ]);

    return (
        <View style={[styles.root, { backgroundColor: colors.background }]}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
            <View
                pointerEvents="none"
                style={[
                    styles.topMaterialLayer,
                    mode === "dark" ? styles.topMaterialLayerDark : styles.topMaterialLayerLight,
                ]}
            />
            <View
                pointerEvents="none"
                style={[
                    styles.bottomMaterialLayer,
                    mode === "dark" ? styles.bottomMaterialLayerDark : styles.bottomMaterialLayerLight,
                ]}
            />
            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                <View style={styles.topControls}>
                    <CalendarGlassSurface
                        interactive
                        clear
                        style={[styles.backGlass, { borderColor: colors.border }]}
                    >
                        <Pressable
                            onPress={() => router.back()}
                            accessibilityLabel="캘린더로 돌아가기"
                            style={({ pressed }) => [
                                styles.backButton,
                                {
                                    opacity: pressed ? 0.55 : 1,
                                    transform: [{ scale: pressed ? 0.96 : 1 }],
                                },
                            ]}
                        >
                            <Ionicons name="chevron-back" size={21} color={colors.textPrimary} />
                            <Text style={[styles.backText, { color: colors.textPrimary }]}>
                                {new Date(`${activeDay}T00:00:00`).getMonth() + 1}월
                            </Text>
                        </Pressable>
                    </CalendarGlassSurface>

                    <CalendarGlassSurface
                        interactive
                        clear
                        style={[styles.headerActions, { borderColor: colors.border }]}
                    >
                        <Pressable
                            onPress={() => router.back()}
                            accessibilityLabel="월 캘린더 보기"
                            style={({ pressed }) => [
                                styles.headerIconButton,
                                {
                                    opacity: pressed ? 0.62 : 1,
                                    transform: [{ scale: pressed ? 0.9 : 1 }],
                                },
                            ]}
                        >
                            <Ionicons name="calendar-outline" size={24} color={colors.textPrimary} />
                        </Pressable>
                        <Pressable
                            onPress={() => setSearchVisible(true)}
                            accessibilityLabel="일정 검색"
                            style={({ pressed }) => [
                                styles.headerIconButton,
                                {
                                    opacity: pressed ? 0.62 : 1,
                                    transform: [{ scale: pressed ? 0.9 : 1 }],
                                },
                            ]}
                        >
                            <Ionicons name="search" size={24} color={colors.textPrimary} />
                        </Pressable>
                        <Pressable
                            onPress={() => setModalVisible(true)}
                            accessibilityLabel="일정 추가"
                            style={({ pressed }) => [
                                styles.headerIconButton,
                                {
                                    opacity: pressed ? 0.62 : 1,
                                    transform: [{ scale: pressed ? 0.9 : 1 }],
                                },
                            ]}
                        >
                            <Ionicons name="add" size={26} color={colors.textPrimary} />
                        </Pressable>
                    </CalendarGlassSurface>
                </View>

                <View style={styles.titleBlock}>
                    <Text style={[styles.title, { color: colors.textPrimary }]}>
                        {formatDateTitle(activeDay)}
                    </Text>
                    <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                        {formatWeekRange(activeWeekDays)}
                    </Text>
                </View>
            </View>

            <View style={[styles.weekSection, { borderBottomColor: colors.border }]}>
                <FlatList
                    ref={weekListRef}
                    data={WEEK_PAGE_OFFSETS}
                    renderItem={renderWeek}
                    keyExtractor={(offset) => String(offset)}
                    horizontal
                    pagingEnabled
                    bounces={false}
                    initialScrollIndex={CENTER_WEEK_INDEX}
                    getItemLayout={(_, index) => ({
                        length: weekPageWidth,
                        offset: weekPageWidth * index,
                        index,
                    })}
                    onMomentumScrollEnd={handleWeekMomentumEnd}
                    showsHorizontalScrollIndicator={false}
                />
            </View>

            <FlatList
                ref={dayListRef}
                data={DAY_PAGE_OFFSETS}
                renderItem={renderTimelinePage}
                keyExtractor={(offset) => String(offset)}
                horizontal
                pagingEnabled
                bounces={false}
                initialScrollIndex={CENTER_DAY_INDEX}
                getItemLayout={(_, index) => ({
                    length: dayPageWidth,
                    offset: dayPageWidth * index,
                    index,
                })}
                onMomentumScrollEnd={handleDayMomentumEnd}
                showsHorizontalScrollIndicator={false}
                style={styles.dayPager}
            />

            <CalendarSearchModal
                visible={searchVisible}
                items={allItems}
                onClose={() => setSearchVisible(false)}
            />

            <ScheduleNewModal
                visible={modalVisible}
                onClose={() => setModalVisible(false)}
                onSubmit={addItem}
                categories={state.categories}
                defaultDay={activeDay}
                onManageCategories={() => {
                    setModalVisible(false);
                    router.push("/schedule/categories");
                }}
            />

            {!modalVisible && !searchVisible && !keyboardVisible && (
                <GlobalFloatingActionBar
                    leftActions={bottomLeftActions}
                    rightActions={bottomRightActions}
                    bottomInset={insets.bottom}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    topMaterialLayer: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 164,
        zIndex: 1,
        elevation: 1,
    },
    topMaterialLayerDark: {
        backgroundColor: "rgba(0,0,0,0.28)",
    },
    topMaterialLayerLight: {
        backgroundColor: "rgba(242,242,247,0.24)",
    },
    bottomMaterialLayer: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 132,
        zIndex: 1,
        elevation: 1,
    },
    bottomMaterialLayerDark: {
        backgroundColor: "rgba(0,0,0,0.14)",
    },
    bottomMaterialLayerLight: {
        backgroundColor: "rgba(242,242,247,0.10)",
    },
    header: {
        minHeight: 132,
        paddingHorizontal: 16,
        paddingBottom: 10,
        justifyContent: "flex-end",
        gap: 15,
    },
    topControls: {
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    backGlass: {
        minWidth: 92,
        height: 46,
        borderRadius: 23,
        borderWidth: 1,
        overflow: "hidden",
    },
    backButton: {
        flex: 1,
        paddingLeft: 9,
        paddingRight: 15,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
    },
    backText: {
        fontSize: 18,
        fontWeight: "800",
        letterSpacing: 0,
    },
    headerActions: {
        flexDirection: "row",
        alignItems: "center",
        borderRadius: 23,
        borderWidth: 1,
        overflow: "hidden",
        paddingHorizontal: 2,
    },
    headerIconButton: {
        width: 52,
        height: 42,
        alignItems: "center",
        justifyContent: "center",
    },
    titleBlock: {
        justifyContent: "center",
        paddingHorizontal: 4,
    },
    title: {
        fontSize: 30,
        fontWeight: "800",
        letterSpacing: 0,
    },
    subtitle: {
        marginTop: 3,
        fontSize: 13,
        fontWeight: "800",
        letterSpacing: 0,
    },
    weekSection: {
        height: 92,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    weekPage: {
        flexDirection: "row",
        paddingHorizontal: 12,
        paddingBottom: 10,
        alignItems: "stretch",
    },
    weekDay: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
    },
    weekdayLabel: {
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0,
    },
    weekDayCircle: {
        width: 38,
        height: 38,
        borderRadius: 19,
        borderWidth: 1,
        borderColor: "transparent",
        backgroundColor: "transparent",
        alignItems: "center",
        justifyContent: "center",
    },
    weekDayCircleSelectedDark: {
        backgroundColor: "#fff",
    },
    weekDayCircleSelectedLight: {
        backgroundColor: "#000",
    },
    weekDayCircleTodayDark: {
        borderColor: "#ff453a",
    },
    weekDayCircleTodayLight: {
        borderColor: "#ff3b30",
    },
    weekDayText: {
        fontSize: 17,
        fontWeight: "800",
        letterSpacing: 0,
    },
    weekDots: {
        height: 6,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
    },
    weekDot: {
        width: 5,
        height: 5,
        borderRadius: 3,
    },
    allDaySection: {
        minHeight: 52,
        borderBottomWidth: StyleSheet.hairlineWidth,
        paddingVertical: 9,
        paddingLeft: 18,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    allDayLabel: {
        width: 40,
        fontSize: 12,
        fontWeight: "800",
    },
    allDayItems: {
        paddingRight: 18,
        gap: 8,
    },
    allDayEvent: {
        maxWidth: 180,
        minHeight: 34,
        borderRadius: 17,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 11,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
    allDayDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
    },
    allDayTitle: {
        flexShrink: 1,
        fontSize: 13,
        fontWeight: "800",
        letterSpacing: 0,
    },
    timelineScroll: {
        flex: 1,
    },
    dayPager: {
        flex: 1,
    },
    dayPage: {
        flex: 1,
    },
    timelineContent: {
        paddingHorizontal: 18,
        paddingTop: 12,
        paddingBottom: 146,
    },
    hourRow: {
        position: "absolute",
        left: 0,
        right: 0,
        height: HOUR_HEIGHT,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    hourText: {
        position: "absolute",
        top: -8,
        width: TIMELINE_GUTTER - 8,
        fontSize: 11,
        fontWeight: "800",
        textAlign: "right",
        letterSpacing: 0,
    },
    eventLayer: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: TIMELINE_GUTTER,
        right: 0,
    },
    timelineEvent: {
        position: "absolute",
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 10,
        paddingVertical: 8,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.16,
        shadowRadius: 14,
    },
    eventAccent: {
        position: "absolute",
        left: 0,
        top: 8,
        bottom: 8,
        width: 4,
        borderTopRightRadius: 3,
        borderBottomRightRadius: 3,
    },
    eventTitle: {
        paddingLeft: 3,
        fontSize: 14,
        fontWeight: "800",
        letterSpacing: 0,
    },
    eventTime: {
        paddingLeft: 3,
        marginTop: 2,
        fontSize: 11,
        fontWeight: "800",
        letterSpacing: 0,
    },
    eventCategory: {
        paddingLeft: 3,
        marginTop: 3,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0,
    },
    nowLine: {
        position: "absolute",
        left: TIMELINE_GUTTER - 5,
        right: 0,
        height: 8,
        flexDirection: "row",
        alignItems: "center",
        zIndex: 20,
        elevation: 20,
    },
    nowDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: "#ff3b30",
    },
    nowRule: {
        flex: 1,
        height: 2.5,
        backgroundColor: "#ff3b30",
    },
    emptyState: {
        marginLeft: TIMELINE_GUTTER,
        paddingTop: HOUR_HEIGHT * 3.2,
        alignItems: "center",
        gap: 8,
    },
    emptyText: {
        fontSize: 14,
        fontWeight: "700",
        letterSpacing: 0,
    },
});
