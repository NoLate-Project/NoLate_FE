import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Animated,
    Easing,
    Keyboard,
    NativeSyntheticEvent,
    Platform,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TextInputFocusEventData,
    useWindowDimensions,
    View,
    type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SearchBar, type SearchBarCommands } from "react-native-screens";

import CalendarWrapper from "../../src/modules/schedule/components/calendar/CalendarWrapper";
import CalendarYearOverviewModal from "../../src/modules/schedule/components/calendar/CalendarYearOverviewModal";
import CalendarGlassSurface from "../../src/modules/schedule/components/calendar/CalendarGlassSurface";
import CalendarViewModeGlyph from "../../src/modules/schedule/components/calendar/CalendarViewModeGlyph";
import { CALENDAR_VIEW_OPTIONS, type CalendarViewMode } from "../../src/modules/schedule/components/calendar/viewMode";
import GlobalFloatingActionBar, { type FloatingBarAction } from "../../src/modules/schedule/components/shared/GlobalFloatingActionBar";
import ScheduleList from "../../src/modules/schedule/components/list/ScheduleList";
import ScheduleNewModal from "../../src/modules/schedule/components/form/ScheduleAddModal";
import QuickScheduleModal from "../../src/modules/schedule/components/form/QuickScheduleModal";

import { useScheduleStore } from "../../src/modules/schedule/store";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { isOverlappingDay, toYmd } from "../../lib/util/data";
import type { ScheduleItem, ScheduleParseResult } from "../../src/modules/schedule/types";
import { createSchedule, getCalendarSchedules, parseScheduleText } from "../../src/api/schedule";
import { getScheduleCategoriesFromApi } from "../../src/api/scheduleCategories";
import { getMonthRange } from "../../src/modules/schedule/calendarRange";
import { createQaScheduleItem } from "../../src/modules/schedule/qaSamples";

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "요청 처리에 실패했습니다.";

type ToolbarMenu = "view" | "search" | "add";

const CALENDAR_TOOLBAR_HEIGHT = 60;
const STICKY_MONTH_HEADER_HEIGHT = 62;
const STICKY_WEEKDAY_HEADER_HEIGHT = 42;
const STICKY_CALENDAR_HEADER_HEIGHT = STICKY_MONTH_HEADER_HEIGHT + STICKY_WEEKDAY_HEADER_HEIGHT;

const NativeSearchBar = SearchBar as React.ForwardRefExoticComponent<
    Omit<React.ComponentProps<typeof SearchBar>, "ref"> &
    React.RefAttributes<SearchBarCommands> & {
        style?: ViewStyle;
    }
>;

function formatScheduleDateTitle(startAt: string) {
    const date = new Date(startAt);
    if (Number.isNaN(date.getTime())) return "";

    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    return `${date.getMonth() + 1}월 ${date.getDate()}일 (${weekdays[date.getDay()]})`;
}

function formatScheduleTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const hour = date.getHours();
    const minute = String(date.getMinutes()).padStart(2, "0");
    const meridiem = hour < 12 ? "오전" : "오후";
    const hour12 = hour % 12 || 12;
    return `${meridiem} ${hour12}:${minute}`;
}

export default function ScheduleIndex() {
    const router = useRouter();
    const isFocused = useIsFocused();
    const { qaSurface } = useLocalSearchParams<{ qaSurface?: string }>();
    const insets = useSafeAreaInsets();
    const { width: screenWidth } = useWindowDimensions();
    const { mode, colors } = useTheme();
    const { state, dispatch } = useScheduleStore();
    const [modalVisible, setModalVisible] = useState(false);
    const [activeToolbarMenu, setActiveToolbarMenu] = useState<ToolbarMenu | null>(null);
    const [toolbarMenuClosing, setToolbarMenuClosing] = useState(false);
    const [quickModalVisible, setQuickModalVisible] = useState(false);
    const [formInitialValues, setFormInitialValues] = useState<ScheduleParseResult | null>(null);
    const [calendarViewMode, setCalendarViewMode] = useState<CalendarViewMode>("stack");
    const [yearOverviewVisible, setYearOverviewVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [keyboardVisible, setKeyboardVisible] = useState(false);
    const [firstDay] = useState<0 | 1>(0);
    const [calendarScrollRequest, setCalendarScrollRequest] = useState(0);
    const calendarTransition = useRef(new Animated.Value(1)).current;
    const toolbarDropdownProgress = useRef(new Animated.Value(0)).current;
    const searchInputRef = useRef<TextInput>(null);
    const nativeSearchBarRef = useRef<SearchBarCommands>(null);
    const viewTransitioningRef = useRef(false);

    const selectedDay = state.selectedDay;
    const [visibleMonth, setVisibleMonth] = useState(selectedDay);
    const [overviewYear, setOverviewYear] = useState(
        new Date(`${selectedDay}T00:00:00`).getFullYear()
    );
    const visibleYear = new Date(`${visibleMonth}T00:00:00`).getFullYear();
    const calendarContentTranslateY = calendarTransition.interpolate({
        inputRange: [0, 1],
        outputRange: [8, 0],
    });
    const calendarIconScale = calendarTransition.interpolate({
        inputRange: [0, 1],
        outputRange: [0.82, 1],
    });
    const dropdownMaxWidth = Math.max(0, screenWidth - 32);
    const dropdownWidth = activeToolbarMenu === "add"
        ? Math.min(dropdownMaxWidth, 196)
        : Math.min(dropdownMaxWidth, 224);
    const isSearchToolbarOpen = activeToolbarMenu === "search";
    const dropdownScaleX = toolbarDropdownProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.68, 1],
    });
    const dropdownScaleY = toolbarDropdownProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.2, 1],
    });
    const dropdownTranslateY = toolbarDropdownProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [-4, 0],
    });
    const viewDropdownScaleX = toolbarDropdownProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.92, 1],
    });
    const viewDropdownScaleY = toolbarDropdownProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.86, 1],
    });
    const viewDropdownTranslateY = toolbarDropdownProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [-8, 0],
    });
    const dropdownOpacity = toolbarDropdownProgress.interpolate({
        inputRange: [0, 0.32, 1],
        outputRange: [0, 0.86, 1],
    });
    const viewDropdownOpacity = toolbarDropdownProgress.interpolate({
        inputRange: [0, 0.18, 1],
        outputRange: [0, 0.92, 1],
    });
    const usesNativeSearchBar = Platform.OS === "ios";
    const searchHeaderScaleY = toolbarDropdownProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 1],
    });
    const searchHeaderTintStyle = useMemo(() => ({
        borderBottomColor: colors.border,
        backgroundColor: mode === "dark"
            ? "rgba(8,9,12,0.99)"
            : "rgba(242,242,247,1)",
    }), [colors.border, mode]);
    const stickyWeekdayItems = useMemo(() => (
        Array.from({ length: 7 }, (_, index) => {
            const weekdayIndex = (firstDay + index) % 7;
            return {
                label: ["일", "월", "화", "수", "목", "금", "토"][weekdayIndex],
                isWeekend: weekdayIndex === 0 || weekdayIndex === 6,
            };
        })
    ), [firstDay]);
    const stickyCalendarHeaderPosition = useMemo<ViewStyle>(() => ({
        top: insets.top + CALENDAR_TOOLBAR_HEIGHT,
    }), [insets.top]);
    const showsFloatingMonthTitle = calendarViewMode === "list" || calendarViewMode === "week";
    const isStickyCalendarMode =
        calendarViewMode === "compact" || calendarViewMode === "stack" || calendarViewMode === "detail";
    const showsStickyCalendarHeader =
        isStickyCalendarMode &&
        activeToolbarMenu === null &&
        !toolbarMenuClosing &&
        !isSearchToolbarOpen &&
        !keyboardVisible &&
        !modalVisible &&
        !quickModalVisible &&
        !yearOverviewVisible;
    const calendarHeaderOffset = useMemo(
        () => insets.top + CALENDAR_TOOLBAR_HEIGHT + (showsStickyCalendarHeader ? STICKY_CALENDAR_HEADER_HEIGHT : 0),
        [insets.top, showsStickyCalendarHeader]
    );
    const stickyMonthTitle = `${Number(visibleMonth.slice(5, 7))}월`;
    const currentMonthKey = useMemo(() => {
        const today = new Date();
        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    }, []);
    const stickyMonthColorStyle = visibleMonth.slice(0, 7) === currentMonthKey
        ? mode === "dark" ? styles.stickyMonthTitleCurrentDark : styles.stickyMonthTitleCurrentLight
        : styles.stickyMonthTitleDefault;
    const stickyWeekdayColor = mode === "dark"
        ? "#FFFFFF"
        : "#111113";
    const stickyWeekendColor = mode === "dark"
        ? "rgba(238,238,244,0.98)"
        : "rgba(68,68,76,0.96)";
    const stickyWeekdayBorderColor = mode === "dark"
        ? "rgba(255,255,255,0.08)"
        : "rgba(0,0,0,0.08)";
    const bottomBarHidden =
        !isFocused ||
        modalVisible ||
        quickModalVisible ||
        keyboardVisible ||
        activeToolbarMenu !== null ||
        toolbarMenuClosing;

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
        if (activeToolbarMenu !== "search" || toolbarMenuClosing) return;

        const timer = setTimeout(() => {
            if (Platform.OS === "ios") {
                nativeSearchBarRef.current?.focus();
                return;
            }

            searchInputRef.current?.focus();
        }, 220);

        return () => clearTimeout(timer);
    }, [activeToolbarMenu, toolbarMenuClosing]);

    const handleNativeSearchChange = useCallback((
        event: NativeSyntheticEvent<TextInputFocusEventData>
    ) => {
        setSearchQuery(event.nativeEvent.text ?? "");
    }, []);

    const loadSchedules = useCallback(async () => {
        dispatch({ type: "SET_LOADING", loading: true });
        dispatch({ type: "SET_ERROR", error: null });

        try {
            const { startAt, endAt } = getMonthRange(visibleMonth);
            const items = await getCalendarSchedules(startAt, endAt);
            dispatch({ type: "SET_ITEMS", items });
        } catch (error) {
            const message = getErrorMessage(error);
            dispatch({ type: "SET_ERROR", error: message });
            Alert.alert("일정 조회 실패", message);
        } finally {
            dispatch({ type: "SET_LOADING", loading: false });
        }
    }, [dispatch, visibleMonth]);

    useEffect(() => {
        loadSchedules();
    }, [loadSchedules]);

    useEffect(() => {
        let cancelled = false;

        getScheduleCategoriesFromApi()
            .then((categories) => {
                if (!cancelled && categories.length > 0) {
                    dispatch({ type: "SET_CATEGORIES", categories });
                }
            })
            .catch(() => {
                // 카테고리 조회 실패 시 초기 카테고리로 일정 생성 흐름은 유지한다.
            });

        return () => {
            cancelled = true;
        };
    }, [dispatch]);

    const itemsArray = useMemo(
        () => Object.values(state.itemsById),
        [state.itemsById]
    );
    const searchResults = useMemo(() => {
        const normalized = searchQuery.trim().toLocaleLowerCase();
        if (!normalized) return [];

        return itemsArray
            .filter((item) => (
                [
                    item.title,
                    item.category?.title,
                    item.locationName,
                    item.origin?.name,
                    item.destination?.name,
                    item.notes,
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLocaleLowerCase()
                    .includes(normalized)
            ))
            .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
            .slice(0, 5);
    }, [itemsArray, searchQuery]);

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

    const closeToolbarMenu = useCallback((afterClose?: () => void) => {
        Keyboard.dismiss();

        if (!activeToolbarMenu) {
            afterClose?.();
            return;
        }

        setToolbarMenuClosing(true);
        toolbarDropdownProgress.stopAnimation();
        Animated.timing(toolbarDropdownProgress, {
            toValue: 0,
            duration: 190,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
        }).start(({ finished }) => {
            if (!finished) return;

            setActiveToolbarMenu(null);
            setToolbarMenuClosing(false);
            afterClose?.();
        });
    }, [activeToolbarMenu, toolbarDropdownProgress]);

    const runToolbarAction = useCallback((action: () => void) => {
        Keyboard.dismiss();
        setToolbarMenuClosing(true);
        toolbarDropdownProgress.stopAnimation();
        Animated.timing(toolbarDropdownProgress, {
            toValue: 0,
            duration: 120,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start(() => {
            setActiveToolbarMenu(null);
            setToolbarMenuClosing(false);
            requestAnimationFrame(action);
        });
    }, [toolbarDropdownProgress]);

    const openToolbarMenu = useCallback((menu: ToolbarMenu) => {
        if (activeToolbarMenu === menu) {
            closeToolbarMenu();
            return;
        }

        Keyboard.dismiss();
        setToolbarMenuClosing(false);
        toolbarDropdownProgress.stopAnimation();
        toolbarDropdownProgress.setValue(0);
        setActiveToolbarMenu(menu);

        requestAnimationFrame(() => {
            Animated.spring(toolbarDropdownProgress, {
                toValue: 1,
                speed: 18,
                bounciness: 9,
                useNativeDriver: true,
            }).start();
        });
    }, [activeToolbarMenu, closeToolbarMenu, toolbarDropdownProgress]);

    const qaInitialValues = useMemo<ScheduleParseResult>(() => {
        const sample = createQaScheduleItem();
        return {
            title: sample.title,
            notes: sample.notes,
            startAt: sample.startAt,
            endAt: sample.endAt,
            origin: sample.origin,
            destination: sample.destination,
            originSource: "TEXT",
            originRequired: false,
            parseSource: "RULE",
            aiAttempted: false,
            needsReview: false,
            warnings: [],
            missingFields: [],
        };
    }, []);

    useEffect(() => {
        if (!qaSurface) return;

        if (qaSurface === "popover") {
            if (activeToolbarMenu !== "view") openToolbarMenu("view");
            return;
        }

        if (qaSurface === "search") {
            setSearchQuery("없는 일정");
            if (activeToolbarMenu !== "search") openToolbarMenu("search");
            return;
        }

        if (qaSurface === "event-create-empty") {
            setActiveToolbarMenu(null);
            setFormInitialValues(null);
            setModalVisible(true);
            return;
        }

        if (qaSurface === "event-create-filled" || qaSurface === "event-create-keyboard") {
            setActiveToolbarMenu(null);
            setFormInitialValues(qaInitialValues);
            setModalVisible(true);
        }
    }, [activeToolbarMenu, openToolbarMenu, qaInitialValues, qaSurface]);

    const openBlankSchedule = () => {
        runToolbarAction(() => {
            setFormInitialValues(null);
            setModalVisible(true);
        });
    };

    const openQuickSchedule = () => {
        runToolbarAction(() => {
            setQuickModalVisible(true);
        });
    };

    const openCategoryManager = () => {
        runToolbarAction(() => {
            router.push("/schedule/categories");
        });
    };

    const openScheduleFromSearch = (id: string) => {
        setSearchQuery("");
        runToolbarAction(() => {
            router.push({
                pathname: "/schedule/[id]",
                params: { id },
            });
        });
    };

    const handleQuickParse = async (text: string) => {
        try {
            const parsed = await parseScheduleText({
                text,
                referenceDate: selectedDay,
                defaultDurationMinutes: 60,
            });
            setFormInitialValues(parsed);
            setQuickModalVisible(false);
            setModalVisible(true);
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

        router.push({
            pathname: "/schedule/timetable",
            params: { date: day },
        });
    }, [dispatch, router]);

    const handleGoToday = useCallback(() => {
        const today = toYmd(new Date());
        if (selectedDay === today) {
            router.push({
                pathname: "/schedule/timetable",
                params: { date: today },
            });
            return;
        }

        dispatch({ type: "SET_SELECTED_DAY", day: today });
        setVisibleMonth(today);
        setCalendarScrollRequest((request) => request + 1);
    }, [dispatch, router, selectedDay]);

    const handleCalendarViewModeChange = useCallback((nextMode: CalendarViewMode) => {
        if (nextMode === calendarViewMode || viewTransitioningRef.current) return;

        closeToolbarMenu();
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
    }, [calendarTransition, calendarViewMode, closeToolbarMenu]);

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

    const openProfile = useCallback(() => {
        router.push("/profile");
    }, [router]);

    const bottomLeftActions = useMemo<FloatingBarAction[]>(() => [{
            key: "today",
            icon: "calendar-outline",
            label: "오늘",
            accessibilityLabel: "오늘 날짜로 이동",
            onPress: handleGoToday,
        }], [handleGoToday]);

    const bottomRightActions = useMemo<FloatingBarAction[]>(() => [{
        key: "profile",
        icon: "person-circle-outline",
        label: "프로필",
        accessibilityLabel: "프로필 열기",
        onPress: openProfile,
    }], [openProfile]);

    return (
        <View style={[styles.root, { backgroundColor: colors.background }]}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />

            <View
                pointerEvents="none"
                style={[
                    styles.topMaterialLayer,
                    {
                        height: Math.max(insets.top + 160, 188),
                    },
                ]}
            >
                <View
                    style={[
                        styles.topMaterialBand,
                        mode === "dark" ? styles.topMaterialBandDark : styles.topMaterialBandLight,
                    ]}
                />
                <View
                    style={[
                        styles.topFadeBandStrong,
                        mode === "dark" ? styles.topFadeBandDark : styles.topFadeBandLight,
                    ]}
                />
                <View
                    style={[
                        styles.topFadeBandSoft,
                        mode === "dark" ? styles.topFadeBandSoftDark : styles.topFadeBandSoftLight,
                    ]}
                />
            </View>

            <View
                pointerEvents="none"
                style={[
                    styles.bottomMaterialLayer,
                    mode === "dark" ? styles.bottomMaterialLayerDark : styles.bottomMaterialLayerLight,
                ]}
            />

            {(activeToolbarMenu !== null || toolbarMenuClosing) && (
                <Pressable style={styles.toolbarDropdownBackdrop} onPress={() => closeToolbarMenu()} />
            )}

            <View
                pointerEvents="box-none"
                style={styles.toolbarLayer}
            >
                {!isSearchToolbarOpen && (
                    <View style={{ paddingTop: insets.top }}>
                        <View style={styles.toolbar}>
                            <CalendarGlassSurface
                                interactive
                                clear
                                tone="softGlass"
                                style={[
                                    styles.yearGlass,
                                    { borderColor: colors.border },
                                ]}
                            >
                                <Pressable
                                    onPress={openYearOverview}
                                    accessibilityLabel={`${visibleYear}년 전체 월 보기`}
                                    style={({ pressed }) => [
                                        styles.yearButton,
                                        {
                                            opacity: pressed ? 0.7 : 1,
                                            transform: [{ scale: pressed ? 0.96 : 1 }],
                                        },
                                    ]}
                                >
                                    <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
                                    <Text style={[styles.yearText, { color: colors.textPrimary }]}>
                                        {visibleYear}년
                                    </Text>
                                </Pressable>
                            </CalendarGlassSurface>

                            {activeToolbarMenu === null && !toolbarMenuClosing ? (
                                <CalendarGlassSurface
                                    interactive
                                    clear
                                    tone="softGlass"
                                    style={[
                                        styles.toolbarActions,
                                        { borderColor: colors.border },
                                    ]}
                                >
                                    <Pressable
                                        onPress={() => openToolbarMenu("view")}
                                        accessibilityLabel="캘린더 보기 방식 선택"
                                        style={({ pressed }) => [
                                            styles.iconButton,
                                            {
                                                opacity: pressed ? 0.68 : 1,
                                                transform: [{ scale: pressed ? 0.88 : 1 }],
                                            },
                                        ]}
                                    >
                                        <Animated.View
                                            style={{
                                                opacity: calendarTransition,
                                                transform: [{ scale: calendarIconScale }],
                                            }}
                                        >
                                            <CalendarViewModeGlyph
                                                mode={calendarViewMode}
                                                color={colors.textPrimary}
                                                size={27}
                                            />
                                        </Animated.View>
                                    </Pressable>

                                    <Pressable
                                        onPress={() => openToolbarMenu("search")}
                                        accessibilityLabel="일정 검색"
                                        style={({ pressed }) => [
                                            styles.iconButton,
                                            {
                                                opacity: pressed ? 0.68 : 1,
                                                transform: [{ scale: pressed ? 0.88 : 1 }],
                                            },
                                        ]}
                                    >
                                        <Ionicons name="search" size={24} color={colors.textPrimary} />
                                    </Pressable>

                                    <Pressable
                                        onPress={() => openToolbarMenu("add")}
                                        accessibilityLabel="일정 추가"
                                        style={({ pressed }) => [
                                            styles.iconButton,
                                            {
                                                opacity: pressed ? 0.68 : 1,
                                                transform: [{ scale: pressed ? 0.88 : 1 }],
                                            },
                                        ]}
                                    >
                                        <Ionicons name="add" size={27} color={colors.textPrimary} />
                                    </Pressable>
                                </CalendarGlassSurface>
                            ) : (
                                <View style={styles.toolbarActionsPlaceholder} />
                            )}
                        </View>

                    {showsFloatingMonthTitle && (
                        <View pointerEvents="none" style={styles.floatingMonthTitleLayer}>
                            <Text style={[styles.floatingMonthTitle, { color: colors.textPrimary }]}>
                                {Number(visibleMonth.slice(5, 7))}월
                            </Text>
                        </View>
                    )}
                    </View>
                )}

                {showsStickyCalendarHeader && (
                    <View
                        pointerEvents="none"
                        style={[
                            styles.stickyCalendarHeader,
                            stickyCalendarHeaderPosition,
                        ]}
                    >
                        <View
                            style={[
                                styles.stickyHeaderBackdrop,
                                mode === "dark"
                                    ? styles.stickyHeaderBackdropDark
                                    : styles.stickyHeaderBackdropLight,
                            ]}
                        />
                        <View
                            style={[
                                styles.stickyHeaderBackdropTop,
                                mode === "dark"
                                    ? styles.stickyHeaderBackdropTopDark
                                    : styles.stickyHeaderBackdropTopLight,
                            ]}
                        />
                        <View
                            style={[
                                styles.stickyHeaderBackdropBottom,
                                mode === "dark"
                                    ? styles.stickyHeaderBackdropBottomDark
                                    : styles.stickyHeaderBackdropBottomLight,
                            ]}
                        />
                        <View style={styles.stickyMonthHeader}>
                            <Text style={[styles.stickyMonthTitle, stickyMonthColorStyle]}>
                                {stickyMonthTitle}
                            </Text>
                        </View>
                        <View style={[styles.stickyWeekdayHeader, { borderBottomColor: stickyWeekdayBorderColor }]}>
                            {stickyWeekdayItems.map((item, index) => (
                                <Text
                                    key={`${item.label}-${index}`}
                                    style={[
                                        styles.stickyWeekdayText,
                                        { color: item.isWeekend ? stickyWeekendColor : stickyWeekdayColor },
                                    ]}
                                >
                                    {item.label}
                                </Text>
                            ))}
                        </View>
                    </View>
                )}

                {isSearchToolbarOpen && (
                    <Animated.View
                        pointerEvents="box-none"
                        style={[
                            styles.searchHeaderOverlay,
                            {
                                top: insets.top + 7,
                                opacity: dropdownOpacity,
                                transform: [
                                    { translateY: dropdownTranslateY },
                                    { scaleX: dropdownScaleX },
                                    { scaleY: searchHeaderScaleY },
                                ],
                            },
                        ]}
                    >
                        <View
                            pointerEvents="none"
                            style={[
                                styles.searchHeaderBackdrop,
                                searchHeaderTintStyle,
                                {
                                    top: -(insets.top + 16),
                                    height: insets.top + 104,
                                },
                            ]}
                        />
                        <View style={[
                            styles.searchHeaderRow,
                            usesNativeSearchBar && styles.nativeSearchHeaderRow,
                        ]}>
                            {usesNativeSearchBar ? (
                                <View
                                    style={[
                                        styles.nativeSearchHost,
                                        {
                                            backgroundColor: mode === "dark"
                                                ? "rgba(28,29,34,0.98)"
                                                : "rgba(255,255,255,0.98)",
                                        },
                                    ]}
                                >
                                    <NativeSearchBar
                                        ref={nativeSearchBarRef}
                                        placeholder="검색"
                                        autoCapitalize="none"
                                        hideWhenScrolling={false}
                                        hideNavigationBar
                                        obscureBackground={false}
                                        placement="stacked"
                                        allowToolbarIntegration={false}
                                        tintColor={colors.textPrimary}
                                        textColor={colors.textPrimary}
                                        barTintColor="rgba(118,118,128,0.22)"
                                        onChangeText={handleNativeSearchChange}
                                        onSearchButtonPress={() => Keyboard.dismiss()}
                                        onCancelButtonPress={() => {
                                            setSearchQuery("");
                                            closeToolbarMenu();
                                        }}
                                        style={styles.nativeSearchBar}
                                    />
                                </View>
                            ) : (
                                <CalendarGlassSurface
                                    interactive
                                    clear
                                    style={[
                                        styles.searchFieldGlass,
                                        { borderColor: colors.border },
                                    ]}
                                >
                                    <View style={styles.searchFieldInner}>
                                        <Ionicons name="search" size={20} color={colors.textPrimary} />
                                        <TextInput
                                            ref={searchInputRef}
                                            value={searchQuery}
                                            onChangeText={setSearchQuery}
                                            placeholder="검색"
                                            placeholderTextColor={colors.textSecondary}
                                            returnKeyType="search"
                                            selectionColor={colors.textPrimary}
                                            style={[styles.searchHeaderInput, { color: colors.textPrimary }]}
                                        />
                                        {searchQuery.length > 0 ? (
                                            <Pressable
                                                onPress={() => setSearchQuery("")}
                                                accessibilityLabel="검색어 지우기"
                                                style={({ pressed }) => [
                                                    styles.searchHeaderIconButton,
                                                    { opacity: pressed ? 0.58 : 1 },
                                                ]}
                                            >
                                                <Ionicons name="close-circle" size={25} color={colors.textSecondary} />
                                            </Pressable>
                                        ) : (
                                            <Ionicons name="mic-outline" size={21} color={colors.textPrimary} />
                                        )}
                                    </View>
                                </CalendarGlassSurface>
                            )}

                            {!usesNativeSearchBar && (
                                <CalendarGlassSurface
                                    interactive
                                    clear
                                    style={[
                                        styles.searchCloseGlass,
                                        { borderColor: colors.border },
                                    ]}
                                >
                                    <Pressable
                                        onPress={() => closeToolbarMenu()}
                                        accessibilityLabel="검색 닫기"
                                        style={({ pressed }) => [
                                            styles.searchCloseButton,
                                            {
                                                opacity: pressed ? 0.68 : 1,
                                                transform: [{ scale: pressed ? 0.9 : 1 }],
                                            },
                                        ]}
                                    >
                                        <Ionicons name="close" size={25} color={colors.textPrimary} />
                                    </Pressable>
                                </CalendarGlassSurface>
                            )}
                        </View>

                        {searchQuery.trim().length > 0 && (
                            <CalendarGlassSurface
                                interactive
                                prominent
                                style={[
                                    styles.searchResultsGlass,
                                    { borderColor: colors.border },
                                ]}
                            >
                                {searchResults.length === 0 ? (
                                    <View style={styles.dropdownEmpty}>
                                        <Text style={[styles.dropdownEmptyText, { color: colors.textSecondary }]}>
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
                                                    {item.allDay ? "종일" : formatScheduleTime(item.startAt)}
                                                </Text>
                                            </Pressable>
                                        ))}
                                    </View>
                                )}
                            </CalendarGlassSurface>
                        )}
                    </Animated.View>
                )}

                {activeToolbarMenu === "view" && (
                    <Animated.View
                        pointerEvents="box-none"
                        style={[
                            styles.toolbarDropdown,
                            styles.toolbarDropdownPosition,
                            {
                                top: insets.top + 7,
                                width: dropdownWidth,
                                opacity: viewDropdownOpacity,
                                transform: [
                                    { translateY: viewDropdownTranslateY },
                                    { scaleX: viewDropdownScaleX },
                                    { scaleY: viewDropdownScaleY },
                                ],
                            },
                        ]}
                    >
                        <View
                            style={[
                                styles.viewDropdownShell,
                                mode === "dark" ? styles.viewDropdownShellDark : styles.viewDropdownShellLight,
                            ]}
                        >
                            <CalendarGlassSurface
                                interactive
                                prominent
                                tone="menuLiquid"
                                style={[
                                    styles.toolbarDropdownGlass,
                                    styles.viewToolbarDropdownGlass,
                                    {
                                        borderColor: colors.border,
                                        shadowColor: colors.textPrimary,
                                    },
                                ]}
                            >
                                <View style={[styles.dropdownContent, styles.viewDropdownContent]}>
                                    <View
                                        pointerEvents="none"
                                        style={[
                                            styles.viewDropdownReadableScrim,
                                            mode === "dark"
                                                ? styles.viewDropdownReadableScrimDark
                                                : styles.viewDropdownReadableScrimLight,
                                        ]}
                                    />
                                    {CALENDAR_VIEW_OPTIONS.map((option, index) => {
                                        const selected = option.value === calendarViewMode;

                                        return (
                                            <React.Fragment key={option.value}>
                                                {index === CALENDAR_VIEW_OPTIONS.length - 1 && (
                                                    <View
                                                        style={[
                                                            styles.dropdownRowDivider,
                                                            { backgroundColor: colors.border },
                                                            styles.viewDropdownDivider,
                                                        ]}
                                                    />
                                                )}
                                                <Pressable
                                                    onPress={() => handleCalendarViewModeChange(option.value)}
                                                    style={({ pressed }) => [
                                                        styles.viewModeRow,
                                                        {
                                                            backgroundColor: pressed
                                                                ? mode === "dark"
                                                                    ? "rgba(255,255,255,0.035)"
                                                                    : "rgba(0,0,0,0.028)"
                                                                : "transparent",
                                                        },
                                                    ]}
                                                >
                                                    {selected && (
                                                        <View
                                                            pointerEvents="none"
                                                            style={[
                                                                styles.viewModeSelectedPill,
                                                                mode === "dark"
                                                                    ? styles.viewModeSelectedPillDark
                                                                    : styles.viewModeSelectedPillLight,
                                                            ]}
                                                        />
                                                    )}
                                                    <View style={styles.dropdownCheckSlot}>
                                                        {selected && (
                                                            <Ionicons
                                                                name="checkmark"
                                                                size={22}
                                                                color={colors.textPrimary}
                                                            />
                                                        )}
                                                    </View>
                                                    <CalendarViewModeGlyph
                                                        mode={option.value}
                                                        color={colors.textPrimary}
                                                        size={24}
                                                    />
                                                    <Text style={[styles.dropdownTitle, { color: colors.textPrimary }]}>
                                                        {option.label}
                                                    </Text>
                                                </Pressable>
                                            </React.Fragment>
                                        );
                                    })}
                                </View>
                            </CalendarGlassSurface>
                        </View>
                    </Animated.View>
                )}

                {activeToolbarMenu === "add" && (
                    <Animated.View
                        pointerEvents="box-none"
                        style={[
                            styles.toolbarDropdown,
                            styles.toolbarDropdownPosition,
                            {
                                top: insets.top + 7,
                                width: dropdownWidth,
                                opacity: dropdownOpacity,
                                transform: [
                                    { translateY: dropdownTranslateY },
                                    { scaleX: dropdownScaleX },
                                    { scaleY: dropdownScaleY },
                                ],
                            },
                        ]}
                    >
                        <CalendarGlassSurface
                            interactive
                            prominent
                            tone="flat"
                            style={[
                                styles.toolbarDropdownGlass,
                                {
                                    borderColor: colors.border,
                                    shadowColor: colors.textPrimary,
                                },
                            ]}
                        >
                            <View style={[styles.dropdownContent, styles.actionDropdownContent]}>
                                <ToolbarDropdownAction
                                    icon="flash-outline"
                                    title="빠른 생성"
                                    onPress={openQuickSchedule}
                                    colors={colors}
                                />
                                <View style={[styles.dropdownRowDivider, { backgroundColor: colors.border }]} />
                                <ToolbarDropdownAction
                                    icon="create-outline"
                                    title="직접 입력"
                                    onPress={openBlankSchedule}
                                    colors={colors}
                                />
                                <View style={[styles.dropdownRowDivider, { backgroundColor: colors.border }]} />
                                <ToolbarDropdownAction
                                    icon="folder-open-outline"
                                    title="카테고리 관리"
                                    onPress={openCategoryManager}
                                    colors={colors}
                                />
                            </View>
                        </CalendarGlassSurface>
                    </Animated.View>
                )}
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
                    headerOffset={calendarHeaderOffset}
                    topSafeInset={insets.top}
                />

                {(calendarViewMode === "list" || calendarViewMode === "week") && (
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

            {!bottomBarHidden && (
                <GlobalFloatingActionBar
                    leftActions={bottomLeftActions}
                    rightActions={bottomRightActions}
                    bottomInset={insets.bottom}
                />
            )}

            <QuickScheduleModal
                visible={quickModalVisible}
                onClose={() => setQuickModalVisible(false)}
                onParse={handleQuickParse}
            />

            <ScheduleNewModal
                visible={modalVisible}
                onClose={() => setModalVisible(false)}
                onSubmit={addItem}
                categories={state.categories}
                defaultDay={selectedDay}
                initialValues={formInitialValues}
                onManageCategories={openCategoryManager}
                autoFocusTitle={qaSurface === "event-create-keyboard"}
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
        </View>
    );
}

function ToolbarDropdownAction({
    icon,
    title,
    onPress,
    colors,
}: {
    icon: React.ComponentProps<typeof Ionicons>["name"];
    title: string;
    onPress: () => void;
    colors: ReturnType<typeof useTheme>["colors"];
}) {
    return (
        <Pressable
            onPress={onPress}
            hitSlop={6}
            accessibilityRole="button"
            style={({ pressed }) => [
                styles.dropdownActionRow,
                {
                    backgroundColor: pressed
                        ? "rgba(255,255,255,0.07)"
                        : "transparent",
                },
            ]}
        >
            <View style={styles.dropdownActionIconSlot}>
                <Ionicons name={icon} size={26} color={colors.textPrimary} />
            </View>
            <Text style={[styles.dropdownTitle, { color: colors.textPrimary }]}>
                {title}
            </Text>
        </Pressable>
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
        zIndex: 30,
        elevation: 30,
    },
    topMaterialBand: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 98,
    },
    topMaterialBandDark: {
        backgroundColor: "rgba(0,0,0,0.30)",
    },
    topMaterialBandLight: {
        backgroundColor: "rgba(242,242,247,0.50)",
    },
    topFadeBandStrong: {
        position: "absolute",
        top: 78,
        left: 0,
        right: 0,
        height: 64,
    },
    topFadeBandDark: {
        backgroundColor: "rgba(0,0,0,0.11)",
    },
    topFadeBandLight: {
        backgroundColor: "rgba(242,242,247,0.20)",
    },
    topFadeBandSoft: {
        position: "absolute",
        top: 136,
        left: 0,
        right: 0,
        height: 60,
    },
    topFadeBandSoftDark: {
        backgroundColor: "rgba(0,0,0,0.035)",
    },
    topFadeBandSoftLight: {
        backgroundColor: "rgba(242,242,247,0.08)",
    },
    bottomMaterialLayer: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 132,
        zIndex: 4,
        elevation: 4,
    },
    bottomMaterialLayerDark: {
        backgroundColor: "rgba(0,0,0,0.045)",
    },
    bottomMaterialLayerLight: {
        backgroundColor: "rgba(242,242,247,0.07)",
    },
    toolbar: {
        minHeight: 60,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    floatingMonthTitleLayer: {
        paddingHorizontal: 24,
        marginTop: 5,
    },
    floatingMonthTitle: {
        fontSize: 46,
        lineHeight: 52,
        fontWeight: "900",
        letterSpacing: 0,
    },
    stickyCalendarHeader: {
        position: "absolute",
        left: 0,
        right: 0,
        height: STICKY_CALENDAR_HEADER_HEIGHT,
        zIndex: 41,
        elevation: 41,
        overflow: "hidden",
    },
    stickyHeaderBackdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    stickyHeaderBackdropDark: {
        backgroundColor: "rgba(7,8,11,0.70)",
    },
    stickyHeaderBackdropLight: {
        backgroundColor: "rgba(242,242,247,0.74)",
    },
    stickyHeaderBackdropTop: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 42,
    },
    stickyHeaderBackdropTopDark: {
        backgroundColor: "rgba(0,0,0,0.14)",
    },
    stickyHeaderBackdropTopLight: {
        backgroundColor: "rgba(255,255,255,0.20)",
    },
    stickyHeaderBackdropBottom: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 58,
    },
    stickyHeaderBackdropBottomDark: {
        backgroundColor: "rgba(0,0,0,0.08)",
    },
    stickyHeaderBackdropBottomLight: {
        backgroundColor: "rgba(255,255,255,0.12)",
    },
    stickyMonthHeader: {
        height: STICKY_MONTH_HEADER_HEIGHT,
        paddingHorizontal: 28,
        justifyContent: "center",
        zIndex: 2,
        elevation: 2,
    },
    stickyMonthTitle: {
        fontSize: 27,
        fontWeight: "900",
        letterSpacing: 0,
    },
    stickyMonthTitleDefault: {
        color: "#FFFFFF",
    },
    stickyMonthTitleCurrentDark: {
        color: "#ff453a",
    },
    stickyMonthTitleCurrentLight: {
        color: "#ff3b30",
    },
    stickyWeekdayHeader: {
        height: STICKY_WEEKDAY_HEADER_HEIGHT,
        paddingHorizontal: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        zIndex: 3,
        elevation: 3,
    },
    stickyWeekdayText: {
        width: "14.2857%",
        textAlign: "center",
        fontSize: 18.5,
        fontWeight: "900",
        letterSpacing: 0,
        opacity: 1,
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
    searchHeaderOverlay: {
        position: "absolute",
        left: 0,
        right: 0,
        transformOrigin: "top right",
        zIndex: 46,
        elevation: 46,
        paddingHorizontal: 18,
        paddingTop: 2,
        paddingBottom: 7,
    },
    searchHeaderBackdrop: {
        position: "absolute",
        left: 0,
        right: 0,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    searchHeaderRow: {
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 11,
    },
    nativeSearchHeaderRow: {
        gap: 0,
    },
    nativeSearchHost: {
        flex: 1,
        minWidth: 0,
        height: 44,
        borderRadius: 22,
        overflow: "hidden",
    },
    nativeSearchBar: {
        flex: 1,
        height: 44,
    },
    searchFieldGlass: {
        flex: 1,
        minWidth: 0,
        height: 44,
        borderRadius: 22,
        borderWidth: Platform.OS === "ios" ? StyleSheet.hairlineWidth : 1,
    },
    searchFieldInner: {
        flex: 1,
        minWidth: 0,
        height: "100%",
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        paddingLeft: 14,
        paddingRight: 14,
    },
    searchHeaderInput: {
        flex: 1,
        minWidth: 0,
        paddingVertical: 0,
        fontSize: 16,
        fontWeight: "600",
        letterSpacing: 0,
    },
    searchHeaderIconButton: {
        width: 28,
        height: 28,
        alignItems: "center",
        justifyContent: "center",
    },
    searchCloseGlass: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: Platform.OS === "ios" ? StyleSheet.hairlineWidth : 1,
    },
    searchCloseButton: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    searchResultsGlass: {
        marginTop: 10,
        borderRadius: 26,
        borderWidth: 1,
        overflow: "hidden",
    },
    toolbarActions: {
        flexDirection: "row",
        alignItems: "center",
        borderRadius: 26,
        borderWidth: Platform.OS === "ios" ? 0 : 1,
        paddingHorizontal: 2,
    },
    toolbarActionsPlaceholder: {
        width: 160,
        height: 52,
    },
    yearGlass: {
        minHeight: 44,
        borderRadius: 22,
        borderWidth: Platform.OS === "ios" ? 0 : 1,
    },
    yearButton: {
        minHeight: 44,
        borderRadius: 22,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingLeft: 10,
        paddingRight: 15,
        gap: 3,
    },
    yearText: {
        fontWeight: "900",
        fontSize: 17,
    },
    iconButton: {
        width: 58,
        height: 52,
        alignItems: "center",
        justifyContent: "center",
    },
    iconButtonActive: {
        borderRadius: 18,
        backgroundColor: "rgba(255, 255, 255, 0.035)",
    },
    toolbarDropdownBackdrop: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 30,
        elevation: 30,
        backgroundColor: "rgba(0,0,0,0.10)",
    },
    toolbarDropdown: {
        position: "absolute",
        transformOrigin: "top right",
        zIndex: 45,
        elevation: 45,
    },
    toolbarDropdownPosition: {
        right: 16,
    },
    toolbarDropdownGlass: {
        borderRadius: 26,
        borderWidth: Platform.OS === "ios" ? 0 : 1,
        shadowOffset: { width: 0, height: 18 },
        shadowOpacity: 0.28,
        shadowRadius: 28,
        elevation: 24,
    },
    viewToolbarDropdownGlass: {
        shadowOffset: { width: 0, height: 20 },
        shadowOpacity: 0.36,
        shadowRadius: 34,
        elevation: 26,
    },
    viewDropdownShell: {
        borderRadius: 26,
    },
    viewDropdownShellDark: {
        backgroundColor: "rgba(3,4,8,0.84)",
    },
    viewDropdownShellLight: {
        backgroundColor: "rgba(255,255,255,0.84)",
    },
    dropdownContent: {
        paddingTop: 7,
        paddingBottom: 8,
    },
    viewDropdownContent: {
        paddingTop: 7,
        paddingBottom: 8,
        position: "relative",
        overflow: "hidden",
    },
    viewDropdownReadableScrim: {
        ...StyleSheet.absoluteFillObject,
    },
    viewDropdownReadableScrimDark: {
        backgroundColor: "rgba(3,4,8,0.82)",
    },
    viewDropdownReadableScrimLight: {
        backgroundColor: "rgba(255,255,255,0.86)",
    },
    searchDropdownContent: {
        paddingHorizontal: 14,
    },
    actionDropdownContent: {
        paddingTop: 7,
        paddingBottom: 8,
        paddingHorizontal: 8,
    },
    viewModeRow: {
        minHeight: 47,
        borderRadius: 16,
        marginHorizontal: 8,
        paddingLeft: 10,
        paddingRight: 13,
        flexDirection: "row",
        alignItems: "center",
        gap: 11,
        position: "relative",
        overflow: "hidden",
    },
    viewModeSelectedPill: {
        position: "absolute",
        left: 5,
        right: 5,
        top: 5,
        bottom: 5,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
    },
    viewModeSelectedPillDark: {
        backgroundColor: "rgba(255,255,255,0.095)",
        borderColor: "rgba(255,255,255,0.13)",
    },
    viewModeSelectedPillLight: {
        backgroundColor: "rgba(0,0,0,0.052)",
        borderColor: "rgba(0,0,0,0.08)",
    },
    dropdownCheckSlot: {
        width: 24,
        alignItems: "center",
    },
    dropdownTitle: {
        fontSize: 17,
        fontWeight: "800",
        letterSpacing: 0,
    },
    dropdownRowDivider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 50,
        marginRight: 18,
        marginVertical: 5,
    },
    viewDropdownDivider: {
        opacity: 0.34,
    },
    dropdownActionRow: {
        alignSelf: "stretch",
        width: "100%",
        minHeight: 44,
        borderRadius: 15,
        marginHorizontal: 0,
        paddingLeft: 18,
        paddingRight: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 11,
    },
    dropdownActionIconSlot: {
        width: 26,
        alignItems: "center",
        justifyContent: "center",
    },
    inlineSearchField: {
        width: "100%",
        alignSelf: "stretch",
        height: 46,
        borderRadius: 23,
        borderWidth: StyleSheet.hairlineWidth,
        paddingLeft: 14,
        paddingRight: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
    inlineSearchInput: {
        flex: 1,
        paddingVertical: 0,
        fontSize: 18,
        fontWeight: "800",
        letterSpacing: 0,
    },
    inlineSearchClear: {
        width: 28,
        height: 28,
        alignItems: "center",
        justifyContent: "center",
    },
    dropdownEmpty: {
        minHeight: 142,
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        paddingHorizontal: 18,
    },
    dropdownEmptyText: {
        fontSize: 14,
        fontWeight: "700",
        textAlign: "center",
    },
    searchResultList: {
        paddingTop: 8,
    },
    searchResultRow: {
        minHeight: 58,
        marginHorizontal: 10,
        borderRadius: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        paddingRight: 8,
        flexDirection: "row",
        alignItems: "center",
    },
    searchResultBar: {
        width: 4,
        height: 34,
        borderRadius: 2,
        marginLeft: 8,
    },
    searchResultBody: {
        flex: 1,
        paddingLeft: 10,
        paddingRight: 10,
    },
    searchResultTitle: {
        fontSize: 16,
        fontWeight: "800",
        letterSpacing: 0,
    },
    searchResultMeta: {
        marginTop: 3,
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0,
    },
    searchResultTime: {
        minWidth: 68,
        textAlign: "right",
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0,
    },
    agenda: {
        flex: 1,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 18,
        paddingTop: 18,
    },
    calendarContent: {
        flex: 1,
        zIndex: 10,
        elevation: 10,
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
        borderWidth: Platform.OS === "ios" ? 0 : 1,
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
        borderWidth: Platform.OS === "ios" ? 0 : 1,
    },
    settingsButton: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
});
