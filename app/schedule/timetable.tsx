import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Animated,
    Easing,
    FlatList,
    Keyboard,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import CalendarGlassSurface from "../../src/modules/schedule/components/calendar/CalendarGlassSurface";
import CalendarSearchModal from "../../src/modules/schedule/components/calendar/CalendarSearchModal";
import LiquidCalendarMenuPrototype, {
    isLiquidCalendarMenuPrototypeAvailable,
} from "../../src/modules/schedule/components/calendar/LiquidCalendarMenuPrototype";
import LiquidGlassIconButton, {
    isLiquidGlassIconButtonAvailable,
} from "../../src/modules/schedule/components/calendar/LiquidGlassIconButton";
import LiquidGlassSegmentedPill, {
    isLiquidGlassSegmentedPillAvailable,
} from "../../src/modules/schedule/components/calendar/LiquidGlassSegmentedPill";
import GlobalFloatingActionBar, { type FloatingBarAction } from "../../src/modules/schedule/components/shared/GlobalFloatingActionBar";
import ScheduleNewModal from "../../src/modules/schedule/components/form/ScheduleAddModal";
import QuickScheduleModal from "../../src/modules/schedule/components/form/QuickScheduleModal";
import { createSchedule, parseScheduleText } from "../../src/api/schedule";
import { useScheduleStore } from "../../src/modules/schedule/store";
import type { ScheduleItem, ScheduleParseResult } from "../../src/modules/schedule/types";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { formatHHmm, isOverlappingDay, startOfDay, toYmd } from "../../lib/util/data";
import {
    resolveQuickScheduleParseInput,
    type QuickScheduleMediaInput,
} from "../../src/modules/schedule/quickInputExtraction";

const HOUR_HEIGHT = 48;
const TIMELINE_GUTTER = 48;
const MIN_EVENT_HEIGHT = 34;
const DAY_MINUTES = 24 * 60;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const DAY_PAGE_OFFSETS = [-1, 0, 1];
const CENTER_DAY_INDEX = 1;
const TIMETABLE_PILL_HEIGHT = 44;
const TIMETABLE_PILL_SLOT = 50;
const TIMETABLE_BACK_PILL_WIDTH = 104;
const TIMETABLE_LIQUID_MENU_HEIGHT = 260;
const TIMETABLE_ADD_DROPDOWN_WIDTH = 238;
const TIMETABLE_ADD_DROPDOWN_HEIGHT = 164;
const TIMETABLE_TOOLBAR_TOP_OFFSET = 8;

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

type TimelineScope = "day" | "multi";

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

function formatScheduleDateTitle(startAt: string) {
    const date = new Date(startAt);
    return `${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAYS[date.getDay()]}요일`;
}

function formatTimelineHour(hour: number) {
    if (hour === 0) return "자정";
    if (hour === 12) return "정오";
    if (hour < 12) return `오전 ${hour}시`;
    return `오후 ${hour - 12}시`;
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
    const isFocused = useIsFocused();
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams<{ date?: string | string[]; dateRun?: string | string[] }>();
    const { width: screenWidth } = useWindowDimensions();
    const { colors, mode } = useTheme();
    const { state, dispatch } = useScheduleStore();
    const timelineRef = useRef<ScrollView>(null);
    const dayListRef = useRef<FlatList<number>>(null);
    const quickHandoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dateParam = Array.isArray(params.date) ? params.date[0] : params.date;
    const dateRunParam = Array.isArray(params.dateRun) ? params.dateRun[0] : params.dateRun;
    const [activeDay, setActiveDay] = useState(dateParam || state.selectedDay);
    const [now, setNow] = useState(() => new Date());
    const [searchVisible, setSearchVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [liquidPrototypeOpen, setLiquidPrototypeOpen] = useState(false);
    const [liquidPrototypeAction, setLiquidPrototypeAction] = useState<"search" | "add" | null>(null);
    const [liquidPrototypeResetKey, setLiquidPrototypeResetKey] = useState(0);
    const [prototypeCloseRequest, setPrototypeCloseRequest] = useState(0);
    const [modalVisible, setModalVisible] = useState(false);
    const [quickModalVisible, setQuickModalVisible] = useState(false);
    const [quickHandoffHidden, setQuickHandoffHidden] = useState(false);
    const [quickModalSource, setQuickModalSource] = useState<{
        width: number;
        height: number;
        content: "toolbar" | "addMenu";
    }>({
        width: TIMETABLE_PILL_SLOT * 3,
        height: TIMETABLE_PILL_HEIGHT,
        content: "toolbar",
    });
    const [formInitialValues, setFormInitialValues] = useState<ScheduleParseResult | null>(null);
    const [keyboardVisible, setKeyboardVisible] = useState(false);
    const [timelineScope, setTimelineScope] = useState<TimelineScope>("multi");
    const entryProgress = useRef(new Animated.Value(0)).current;
    const today = useMemo(() => toYmd(now), [now]);
    const activeWeekStart = useMemo(() => startOfWeek(activeDay), [activeDay]);
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
    const viewToggleSymbol = timelineScope === "day" ? "calendar" : "rectangle.stack";
    const usesLiquidViewModeControl = isLiquidCalendarMenuPrototypeAvailable;
    const actionPillWidth = TIMETABLE_PILL_SLOT * 3;
    const searchHeaderTargetWidth = Math.max(actionPillWidth, screenWidth - 32);
    const liquidPrototypeLayerWidth = liquidPrototypeOpen
        ? searchHeaderTargetWidth
        : actionPillWidth;
    const trimmedSearchQuery = searchQuery.trim().toLowerCase();
    const searchResults = useMemo(() => {
        if (!trimmedSearchQuery) return [];

        return allItems
            .filter((item) => {
                const haystack = [
                    item.title,
                    item.category?.title,
                    item.locationName,
                    item.origin?.name,
                    item.origin?.address,
                    item.destination?.name,
                    item.destination?.address,
                    item.notes,
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();

                return haystack.includes(trimmedSearchQuery);
            })
            .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
            .slice(0, 6);
    }, [allItems, trimmedSearchQuery]);
    const entryOpacity = entryProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 1],
    });
    const entryScale = entryProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 1],
    });
    const entryTranslateY = entryProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 0],
    });

    useEffect(() => {
        dispatch({ type: "SET_SELECTED_DAY", day: activeDay });
    }, [activeDay, dispatch]);

    useEffect(() => {
        if (!dateParam || dateParam === activeDay) return;
        setActiveDay(dateParam);
    }, [activeDay, dateParam, dateRunParam]);

    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 30_000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        entryProgress.setValue(0);
        Animated.timing(entryProgress, {
            toValue: 1,
            duration: 190,
            easing: Easing.bezier(0.2, 0.9, 0.2, 1),
            useNativeDriver: true,
        }).start();
    }, [entryProgress]);

    const goBackToCalendar = useCallback(() => {
        if (router.canGoBack()) {
            router.back();
            return;
        }

        router.replace("/schedule");
    }, [router]);

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
                ?? (activeDay === toYmd(liveNow) ? liveMinute : 5 * 60);

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

    const requestCloseLiquidPrototype = useCallback(() => {
        setLiquidPrototypeOpen(false);
        setPrototypeCloseRequest((value) => value + 1);
    }, []);
    const clearQuickHandoffTimer = useCallback(() => {
        if (quickHandoffTimerRef.current) {
            clearTimeout(quickHandoffTimerRef.current);
            quickHandoffTimerRef.current = null;
        }
    }, []);
    const scheduleQuickHandoffHide = useCallback(() => {
        clearQuickHandoffTimer();
        quickHandoffTimerRef.current = setTimeout(() => {
            requestCloseLiquidPrototype();
            setQuickHandoffHidden(true);
            quickHandoffTimerRef.current = null;
        }, 460);
    }, [clearQuickHandoffTimer, requestCloseLiquidPrototype]);
    const handleQuickModalCloseStart = useCallback(() => {
        clearQuickHandoffTimer();
        setQuickHandoffHidden(true);
        requestCloseLiquidPrototype();
    }, [clearQuickHandoffTimer, requestCloseLiquidPrototype]);
    const handleQuickModalClosed = useCallback(() => {
        clearQuickHandoffTimer();
        setQuickModalVisible(false);
        setLiquidPrototypeResetKey((value) => value + 1);
        setQuickHandoffHidden(false);
    }, [clearQuickHandoffTimer]);

    useEffect(() => {
        return () => {
            clearQuickHandoffTimer();
        };
    }, [clearQuickHandoffTimer]);

    const handleLiquidMenuOpenChange = useCallback((open: boolean) => {
        setLiquidPrototypeOpen(open);
        if (!open) {
            setLiquidPrototypeAction(null);
        }
    }, []);

    const handleTimelineViewModeSelect = useCallback((mode: string) => {
        if (mode === "day" || mode === "multi") {
            setTimelineScope(mode);
        }
    }, []);

    const handleLiquidSearchOpen = useCallback(() => {
        setLiquidPrototypeAction("search");
    }, []);

    const handleLiquidSearchClose = useCallback(() => {
        setSearchQuery("");
        setLiquidPrototypeAction(null);
    }, []);

    const openScheduleFromSearch = useCallback((id: string) => {
        setSearchQuery("");
        requestCloseLiquidPrototype();
        openSchedule(id);
    }, [openSchedule, requestCloseLiquidPrototype]);

    const openQuickScheduleFromLiquidMenu = useCallback(() => {
        clearQuickHandoffTimer();
        setQuickHandoffHidden(false);
        setLiquidPrototypeAction("add");
        setQuickModalSource({
            width: TIMETABLE_ADD_DROPDOWN_WIDTH,
            height: TIMETABLE_ADD_DROPDOWN_HEIGHT,
            content: "addMenu",
        });
        setQuickModalVisible(true);
        scheduleQuickHandoffHide();
    }, [clearQuickHandoffTimer, scheduleQuickHandoffHide]);

    const openManualScheduleFromLiquidMenu = useCallback(() => {
        setLiquidPrototypeAction("add");
        requestCloseLiquidPrototype();
        setFormInitialValues(null);
        setModalVisible(true);
    }, [requestCloseLiquidPrototype]);

    const openCategoryManagerFromLiquidMenu = useCallback(() => {
        setLiquidPrototypeAction("add");
        requestCloseLiquidPrototype();
        router.push("/schedule/categories");
    }, [requestCloseLiquidPrototype, router]);

    const handleQuickAnalyze = useCallback(async (text: string, media?: QuickScheduleMediaInput) => {
        try {
            // 빠른일정의 미디어 입력은 앱 안에서 텍스트로 변환한다.
            // 백엔드는 원본 파일을 알 필요 없이 추출된 문장과 입력 출처만 받아 일정 파싱을 수행한다.
            const parseInput = await resolveQuickScheduleParseInput(text, media);

            return await parseScheduleText({
                text: parseInput.text,
                inputType: parseInput.inputType,
                referenceDate: activeDay,
                defaultDurationMinutes: 60,
            });
        } catch (error) {
            Alert.alert("일정 분석 실패", getErrorMessage(error));
            throw error;
        }
    }, [activeDay]);

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
        dispatch({ type: "SET_SELECTED_DAY", day: today });
        setActiveDay(today);
        router.dismissTo({
            pathname: "/schedule",
            params: {
                focus: "today",
                focusRun: String(Date.now()),
            },
        });
    }, [dispatch, router, today]);

    const bottomLeftActions = useMemo<FloatingBarAction[]>(() => [{
        key: "today",
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
                                        {formatTimelineHour(hour)}
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
            <Animated.View
                style={[
                    styles.screenContent,
                    {
                        opacity: entryOpacity,
                        transform: [
                            { translateY: entryTranslateY },
                            { scale: entryScale },
                        ],
                    },
                ]}
            >
            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                <View style={styles.topControls}>
                    {isLiquidGlassIconButtonAvailable ? (
                        <Pressable
                            onPress={goBackToCalendar}
                            accessibilityLabel="캘린더로 돌아가기"
                            accessibilityRole="button"
                            style={({ pressed }) => [
                                styles.backGlass,
                                {
                                    opacity: pressed ? 0.68 : 1,
                                    transform: [{ scale: pressed ? 0.96 : 1 }],
                                },
                            ]}
                        >
                            <LiquidGlassIconButton
                                pointerEvents="none"
                                leadingSymbolName="chevron.left"
                                label={`${new Date(`${activeDay}T00:00:00`).getMonth() + 1}월`}
                                buttonWidth={TIMETABLE_BACK_PILL_WIDTH}
                                buttonHeight={TIMETABLE_PILL_HEIGHT}
                                colorScheme={mode === "dark" ? "dark" : "light"}
                                accessibilityLabel="캘린더로 돌아가기"
                                style={StyleSheet.absoluteFill}
                            />
                        </Pressable>
                    ) : (
                        <CalendarGlassSurface
                            interactive
                            clear
                            style={[styles.backGlass, { borderColor: colors.border }]}
                        >
                            <Pressable
                                onPress={goBackToCalendar}
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
                    )}

                    {usesLiquidViewModeControl ? (
                        <View pointerEvents="none" style={styles.headerActionsNative} />
                    ) : isLiquidGlassSegmentedPillAvailable ? (
                        <LiquidGlassSegmentedPill
                            symbolNames={[viewToggleSymbol, "magnifyingglass", "plus"]}
                            selectedIndex={-1}
                            buttonHeight={TIMETABLE_PILL_HEIGHT}
                            slotWidth={TIMETABLE_PILL_SLOT}
                            colorScheme={mode === "dark" ? "dark" : "light"}
                            onSelect={(index) => {
                                if (index === 0) {
                                    setTimelineScope((current) => current === "day" ? "multi" : "day");
                                    return;
                                }
                                if (index === 1) {
                                    setSearchVisible(true);
                                    return;
                                }
                                setModalVisible(true);
                            }}
                            style={styles.headerActionsNative}
                        />
                    ) : (
                        <CalendarGlassSurface
                            interactive
                            clear
                            style={[styles.headerActions, { borderColor: colors.border }]}
                        >
                            <Pressable
                                onPress={() => setTimelineScope((current) => current === "day" ? "multi" : "day")}
                                accessibilityLabel={timelineScope === "day" ? "여러 날 보기로 전환" : "하루 보기로 전환"}
                                style={({ pressed }) => [
                                    styles.headerIconButton,
                                    {
                                        opacity: pressed ? 0.62 : 1,
                                        transform: [{ scale: pressed ? 0.9 : 1 }],
                                    },
                                ]}
                            >
                                <Ionicons
                                    name={timelineScope === "day" ? "calendar-clear-outline" : "albums-outline"}
                                    size={timelineScope === "day" ? 21 : 22}
                                    color={colors.textPrimary}
                                />
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
                                <Ionicons name="search" size={22} color={colors.textPrimary} />
                            </Pressable>
                            <Pressable
	                                onPress={() => {
	                                    setFormInitialValues(null);
	                                    setModalVisible(true);
	                                }}
                                accessibilityLabel="일정 추가"
                                style={({ pressed }) => [
                                    styles.headerIconButton,
                                    {
                                        opacity: pressed ? 0.62 : 1,
                                        transform: [{ scale: pressed ? 0.9 : 1 }],
                                    },
                                ]}
                            >
                                <Ionicons name="add" size={24} color={colors.textPrimary} />
                            </Pressable>
                        </CalendarGlassSurface>
                    )}
                </View>

            </View>

            {timelineScope === "multi" && (
                <View style={[styles.weekSection, { borderBottomColor: colors.border }]}>
                    {renderWeek({ item: 0 })}
                </View>
            )}

            <View style={[styles.dayTitleBar, { borderBottomColor: colors.border }]}>
                <Text style={[styles.dayTitleText, { color: colors.textPrimary }]}>
                    {formatDateTitle(activeDay)}
                </Text>
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
	            </Animated.View>

	            {usesLiquidViewModeControl && (
	                <View pointerEvents="box-none" style={styles.toolbarLayer}>
	                    {liquidPrototypeOpen && (
	                        <Pressable
	                            accessible={false}
	                            importantForAccessibility="no"
	                            style={styles.toolbarDropdownBackdrop}
	                            onPress={requestCloseLiquidPrototype}
	                        />
	                    )}

	                    <View
	                        pointerEvents="box-none"
	                        style={[
	                            styles.liquidViewModeControl,
	                            {
		                                top: insets.top + TIMETABLE_TOOLBAR_TOP_OFFSET,
		                                right: 16,
		                                width: liquidPrototypeLayerWidth,
		                                opacity: quickHandoffHidden ? 0 : 1,
		                            },
		                        ]}
		                    >
		                        <LiquidCalendarMenuPrototype
		                            key={`timeline-liquid-${liquidPrototypeResetKey}`}
		                            selectedMode={timelineScope}
	                            viewModeVariant="timeline"
	                            colorScheme={mode === "dark" ? "dark" : "light"}
	                            closeRequest={prototypeCloseRequest}
	                            searchExpandedWidth={searchHeaderTargetWidth}
	                            searchQuery={searchQuery}
	                            onSelect={handleTimelineViewModeSelect}
	                            onOpenChange={handleLiquidMenuOpenChange}
	                            onSearch={handleLiquidSearchOpen}
	                            onSearchTextChange={setSearchQuery}
	                            onSearchClose={handleLiquidSearchClose}
	                            onQuickAdd={openQuickScheduleFromLiquidMenu}
	                            onManualAdd={openManualScheduleFromLiquidMenu}
	                            onManageCategories={openCategoryManagerFromLiquidMenu}
	                            style={StyleSheet.absoluteFill}
	                        />
	                    </View>

	                    {liquidPrototypeAction === "search" && searchQuery.trim().length > 0 && (
	                        <View
	                            pointerEvents="box-none"
	                            style={[
	                                styles.searchResultsLayer,
	                                {
	                                    top: insets.top + TIMETABLE_TOOLBAR_TOP_OFFSET + TIMETABLE_PILL_HEIGHT + 8,
	                                    right: 16,
	                                    width: searchHeaderTargetWidth,
	                                },
	                            ]}
	                        >
	                            <CalendarGlassSurface
	                                interactive
	                                prominent
	                                style={[
	                                    styles.searchResultsGlass,
	                                    { borderColor: colors.border },
	                                ]}
	                            >
	                                {searchResults.length === 0 ? (
	                                    <View style={styles.searchEmpty}>
	                                        <Text style={[styles.searchEmptyText, { color: colors.textSecondary }]}>
	                                            검색 결과가 없어요
	                                        </Text>
	                                    </View>
	                                ) : (
	                                    <View style={styles.searchResultList}>
	                                        {searchResults.map((item) => (
	                                            <Pressable
	                                                key={item.id}
	                                                onPress={() => openScheduleFromSearch(item.id)}
	                                                style={({ pressed }) => [
	                                                    styles.searchResultRow,
	                                                    {
	                                                        borderBottomColor: colors.border,
	                                                        backgroundColor: pressed
	                                                            ? mode === "dark"
	                                                                ? "rgba(255,255,255,0.08)"
	                                                                : "rgba(0,0,0,0.05)"
	                                                            : "transparent",
	                                                    },
	                                                ]}
	                                            >
	                                                <View
	                                                    style={[
	                                                        styles.searchResultBar,
	                                                        { backgroundColor: item.category?.color ?? "#8e8e93" },
	                                                    ]}
	                                                />
	                                                <View style={styles.searchResultBody}>
	                                                    <Text
	                                                        numberOfLines={1}
	                                                        style={[styles.searchResultTitle, { color: colors.textPrimary }]}
	                                                    >
	                                                        {item.title}
	                                                    </Text>
	                                                    <Text
	                                                        numberOfLines={1}
	                                                        style={[styles.searchResultMeta, { color: colors.textSecondary }]}
	                                                    >
	                                                        {formatScheduleDateTitle(item.startAt)}
	                                                    </Text>
	                                                </View>
	                                                <Text style={[styles.searchResultTime, { color: colors.textSecondary }]}>
	                                                    {item.allDay ? "종일" : formatHHmm(item.startAt)}
	                                                </Text>
	                                            </Pressable>
	                                        ))}
	                                    </View>
	                                )}
	                            </CalendarGlassSurface>
	                        </View>
	                    )}
	                </View>
	            )}

	            <CalendarSearchModal
	                visible={!usesLiquidViewModeControl && searchVisible}
	                items={allItems}
	                onClose={() => setSearchVisible(false)}
	            />

	            <ScheduleNewModal
	                visible={modalVisible}
	                onClose={() => {
	                    setModalVisible(false);
	                    setFormInitialValues(null);
	                }}
	                onSubmit={addItem}
	                categories={state.categories}
	                defaultDay={activeDay}
	                initialValues={formInitialValues}
	                onManageCategories={() => {
	                    setModalVisible(false);
	                    setFormInitialValues(null);
	                    router.push("/schedule/categories");
	                }}
	            />

	            <QuickScheduleModal
	                visible={quickModalVisible}
	                onClose={handleQuickModalClosed}
	                onCloseStart={handleQuickModalCloseStart}
	                onAnalyze={handleQuickAnalyze}
	                onSave={addItem}
	                defaultDay={activeDay}
	                defaultCategory={state.categories[0]}
	                sourceTopOffset={TIMETABLE_TOOLBAR_TOP_OFFSET}
	                sourceWidth={quickModalSource.width}
	                sourceHeight={quickModalSource.height}
	                sourceContent={quickModalSource.content}
	            />

            {isFocused && !searchVisible && !keyboardVisible && !liquidPrototypeOpen && (
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
    screenContent: {
        flex: 1,
    },
    toolbarLayer: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        elevation: 40,
        overflow: "visible",
    },
    toolbarDropdownBackdrop: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 42,
        elevation: 42,
        backgroundColor: "transparent",
    },
    liquidViewModeControl: {
        position: "absolute",
        height: TIMETABLE_LIQUID_MENU_HEIGHT,
        zIndex: 56,
        elevation: 56,
        overflow: "visible",
    },
    searchResultsLayer: {
        position: "absolute",
        zIndex: 55,
        elevation: 55,
    },
    searchResultsGlass: {
        marginTop: 8,
        borderRadius: 22,
        borderWidth: 1,
        overflow: "hidden",
        maxHeight: 260,
    },
    searchEmpty: {
        minHeight: 56,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 18,
    },
    searchEmptyText: {
        fontSize: 14,
        fontWeight: "700",
        letterSpacing: 0,
    },
    searchResultList: {
        overflow: "hidden",
    },
    searchResultRow: {
        minHeight: 62,
        borderBottomWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    searchResultBar: {
        width: 4,
        height: 34,
        borderRadius: 2,
    },
    searchResultBody: {
        flex: 1,
        minWidth: 0,
        gap: 3,
    },
    searchResultTitle: {
        fontSize: 15,
        fontWeight: "800",
        letterSpacing: 0,
    },
    searchResultMeta: {
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0,
    },
    searchResultTime: {
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0,
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
        backgroundColor: "rgba(0,0,0,0.10)",
    },
    topMaterialLayerLight: {
        backgroundColor: "rgba(255,255,255,0.16)",
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
        backgroundColor: "rgba(0,0,0,0.08)",
    },
    bottomMaterialLayerLight: {
        backgroundColor: "rgba(255,255,255,0.10)",
    },
    header: {
        minHeight: 94,
        paddingHorizontal: 16,
        paddingBottom: 8,
        justifyContent: "flex-end",
        gap: 8,
    },
    topControls: {
        minHeight: TIMETABLE_PILL_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    backGlass: {
        width: TIMETABLE_BACK_PILL_WIDTH,
        height: TIMETABLE_PILL_HEIGHT,
        borderRadius: TIMETABLE_PILL_HEIGHT / 2,
        overflow: Platform.OS === "ios" ? "visible" : "hidden",
    },
    backButton: {
        flex: 1,
        paddingLeft: 7,
        paddingRight: 11,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
    },
    backText: {
        fontSize: 17,
        fontWeight: "800",
        letterSpacing: 0,
    },
    headerActions: {
        flexDirection: "row",
        alignItems: "center",
        height: TIMETABLE_PILL_HEIGHT,
        borderRadius: TIMETABLE_PILL_HEIGHT / 2,
        borderWidth: 1,
        overflow: "hidden",
        paddingHorizontal: 0,
    },
    headerActionsNative: {
        width: TIMETABLE_PILL_SLOT * 3,
        height: TIMETABLE_PILL_HEIGHT,
    },
    headerIconButton: {
        width: TIMETABLE_PILL_SLOT,
        height: TIMETABLE_PILL_HEIGHT,
        alignItems: "center",
        justifyContent: "center",
    },
    weekSection: {
        height: 82,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    weekPage: {
        flexDirection: "row",
        paddingHorizontal: 12,
        paddingBottom: 8,
        alignItems: "stretch",
    },
    weekDay: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
    },
    weekdayLabel: {
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0,
    },
    weekDayCircle: {
        width: 34,
        height: 34,
        borderRadius: 17,
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
        fontSize: 16,
        fontWeight: "800",
        letterSpacing: 0,
    },
    dayTitleBar: {
        height: 45,
        borderBottomWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
    },
    dayTitleText: {
        fontSize: 16,
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
        paddingHorizontal: 16,
        paddingTop: 0,
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
        top: -9,
        width: TIMELINE_GUTTER + 14,
        fontSize: 13,
        fontWeight: "600",
        textAlign: "right",
        letterSpacing: 0,
    },
    eventLayer: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: TIMELINE_GUTTER + 18,
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
        left: TIMELINE_GUTTER + 13,
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
