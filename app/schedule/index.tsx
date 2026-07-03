import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Animated,
    Easing,
    Keyboard,
    Platform,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    useWindowDimensions,
    View,
    type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import CalendarWrapper from "../../src/modules/schedule/components/calendar/CalendarWrapper";
import CalendarYearOverviewModal from "../../src/modules/schedule/components/calendar/CalendarYearOverviewModal";
import CalendarGlassSurface from "../../src/modules/schedule/components/calendar/CalendarGlassSurface";
import CalendarViewModeGlyph from "../../src/modules/schedule/components/calendar/CalendarViewModeGlyph";
import LiquidGlassIconButton, {
    isLiquidGlassIconButtonAvailable,
} from "../../src/modules/schedule/components/calendar/LiquidGlassIconButton";
import LiquidCalendarMenuPrototype, {
    isCalendarViewMode,
    isLiquidCalendarMenuPrototypeAvailable,
} from "../../src/modules/schedule/components/calendar/LiquidCalendarMenuPrototype";
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
import {
    resolveQuickScheduleParseInput,
    type QuickScheduleMediaInput,
} from "../../src/modules/schedule/quickInputExtraction";

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "요청 처리에 실패했습니다.";

type ToolbarMenu = "view" | "search" | "add";

const CALENDAR_TOOLBAR_HEIGHT = 56;
const STICKY_MONTH_HEADER_HEIGHT = 62;
const STICKY_WEEKDAY_HEADER_HEIGHT = 42;
const STICKY_CALENDAR_HEADER_HEIGHT = STICKY_MONTH_HEADER_HEIGHT + STICKY_WEEKDAY_HEADER_HEIGHT;
const LIQUID_TOOLBAR_BUTTON_SIZE = 44;
const LIQUID_TOOLBAR_SLOT_WIDTH = 50;
const LIQUID_TOOLBAR_ACTIONS_WIDTH = LIQUID_TOOLBAR_SLOT_WIDTH * 3;
const LIQUID_TOOLBAR_ADD_DROPDOWN_WIDTH = 238;
const LIQUID_TOOLBAR_ADD_DROPDOWN_HEIGHT = 164;
const LIQUID_VIEW_MODE_CONTROL_HEIGHT = 260;
const LIQUID_YEAR_PILL_WIDTH = 112;
const LIQUID_TOOLBAR_TOP_OFFSET = 4;

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
    const params = useLocalSearchParams<{
        qaSurface?: string | string[];
        qaRun?: string | string[];
        focus?: string | string[];
        focusRun?: string | string[];
    }>();
    const insets = useSafeAreaInsets();
    const { width: screenWidth } = useWindowDimensions();
    const { mode, colors } = useTheme();
    const qaSurface = Array.isArray(params.qaSurface) ? params.qaSurface[0] : params.qaSurface;
    const qaRun = Array.isArray(params.qaRun) ? params.qaRun[0] : params.qaRun;
    const isQuickMorphQaSurface =
        qaSurface === "quick-add-morph" ||
        qaSurface === "quick-add-morph-close";
    const isManualMorphQaSurface =
        qaSurface === "manual-add-morph" ||
        qaSurface === "manual-add-morph-close";
    const isMorphQaSurface = __DEV__ && (
        isQuickMorphQaSurface ||
        isManualMorphQaSurface
    );
    const focusRequest = Array.isArray(params.focus) ? params.focus[0] : params.focus;
    const focusRun = Array.isArray(params.focusRun) ? params.focusRun[0] : params.focusRun;
    const { state, dispatch } = useScheduleStore();
    const [modalVisible, setModalVisible] = useState(false);
    const [activeToolbarMenu, setActiveToolbarMenu] = useState<ToolbarMenu | null>(null);
    const [toolbarMenuClosing, setToolbarMenuClosing] = useState(false);
    const [liquidPrototypeOpen, setLiquidPrototypeOpen] = useState(false);
    const [liquidPrototypeResetKey, setLiquidPrototypeResetKey] = useState(0);
    const [quickModalVisible, setQuickModalVisible] = useState(false);
    const [quickHandoffHidden, setQuickHandoffHidden] = useState(false);
    const [quickModalSource, setQuickModalSource] = useState<{
        width: number;
        height: number;
        content: "toolbar" | "addMenu";
    }>({
        width: LIQUID_TOOLBAR_ACTIONS_WIDTH,
        height: LIQUID_TOOLBAR_BUTTON_SIZE,
        content: "toolbar",
    });
    const [scheduleModalSource, setScheduleModalSource] = useState<{
        width: number;
        height: number;
        content: "toolbar" | "addMenu";
    }>({
        width: LIQUID_TOOLBAR_ADD_DROPDOWN_WIDTH,
        height: LIQUID_TOOLBAR_ADD_DROPDOWN_HEIGHT,
        content: "addMenu",
    });
    const [formInitialValues, setFormInitialValues] = useState<ScheduleParseResult | null>(null);
    const [calendarViewMode, setCalendarViewMode] = useState<CalendarViewMode>("stack");
    const [yearOverviewVisible, setYearOverviewVisible] = useState(false);
    const [yearOverviewClosing, setYearOverviewClosing] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [keyboardVisible, setKeyboardVisible] = useState(false);
    const [firstDay] = useState<0 | 1>(0);
    const [calendarScrollRequest, setCalendarScrollRequest] = useState(0);
    const [prototypeTapRequest, setPrototypeTapRequest] = useState(0);
    const [prototypeCloseRequest, setPrototypeCloseRequest] = useState(0);
    const [prototypeAddMenuRequest, setPrototypeAddMenuRequest] = useState(0);
    const [prototypeQuickAddRequest, setPrototypeQuickAddRequest] = useState(0);
    const [prototypeManualAddRequest, setPrototypeManualAddRequest] = useState(0);
    const [todayButtonPrimed, setTodayButtonPrimed] = useState(false);
    const calendarTransition = useRef(new Animated.Value(1)).current;
    const yearOverviewProgress = useRef(new Animated.Value(0)).current;
    const toolbarDropdownProgress = useRef(new Animated.Value(0)).current;
    const searchToolbarProgress = useRef(new Animated.Value(0)).current;
    const searchInputRef = useRef<TextInput>(null);
    const viewTransitioningRef = useRef(false);
    const quickHandoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const quickHandoffReturnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handledQaSurfaceRef = useRef<string | null>(null);
    const handledFocusRequestRef = useRef<string | null>(null);

    const selectedDay = state.selectedDay;
    const todayKey = useMemo(() => toYmd(new Date()), []);
    const [visibleMonth, setVisibleMonth] = useState(selectedDay);
    const [overviewYear, setOverviewYear] = useState(
        new Date(`${selectedDay}T00:00:00`).getFullYear()
    );
    const visibleYear = new Date(`${visibleMonth}T00:00:00`).getFullYear();
    const calendarContentTranslateY = calendarTransition.interpolate({
        inputRange: [0, 1],
        outputRange: [-10, 0],
    });
    const calendarContentScale = calendarTransition.interpolate({
        inputRange: [0, 1],
        outputRange: [0.992, 1],
    });
    const calendarIconScale = calendarTransition.interpolate({
        inputRange: [0, 1],
        outputRange: [0.82, 1],
    });
    const yearOverviewScale = yearOverviewProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.96, 1],
    });
    const yearOverviewTranslateY = yearOverviewProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [10, 0],
    });
    const dropdownMaxWidth = Math.max(0, screenWidth - 32);
    const dropdownWidth = activeToolbarMenu === "add"
        ? Math.min(dropdownMaxWidth, 196)
        : activeToolbarMenu === "view"
            ? Math.min(dropdownMaxWidth, 210)
        : Math.min(dropdownMaxWidth, 224);
    const usesLiquidViewModeControl = isLiquidCalendarMenuPrototypeAvailable;
    const actionDropdownRight = 16;
    const isSearchToolbarOpen = activeToolbarMenu === "search";
    const searchHeaderTargetWidth = Math.max(
        LIQUID_TOOLBAR_ACTIONS_WIDTH,
        screenWidth - 32
    );
    const liquidPrototypeLayerWidth = searchHeaderTargetWidth;
    const requestCloseLiquidPrototype = useCallback(() => {
        if (!usesLiquidViewModeControl) return;
        setLiquidPrototypeOpen(false);
        setPrototypeCloseRequest((value) => value + 1);
    }, [usesLiquidViewModeControl]);
    const clearQuickHandoffTimer = useCallback(() => {
        if (quickHandoffTimerRef.current) {
            clearTimeout(quickHandoffTimerRef.current);
            quickHandoffTimerRef.current = null;
        }
        if (quickHandoffReturnTimerRef.current) {
            clearTimeout(quickHandoffReturnTimerRef.current);
            quickHandoffReturnTimerRef.current = null;
        }
    }, []);
    const restoreToolbarAfterHandoff = useCallback(() => {
        setQuickHandoffHidden(false);
    }, []);
    const scheduleQuickHandoffHide = useCallback((delay = 0) => {
        clearQuickHandoffTimer();
        if (delay <= 0) {
            setQuickHandoffHidden(true);
            requestCloseLiquidPrototype();
            return;
        }
        quickHandoffTimerRef.current = setTimeout(() => {
            setQuickHandoffHidden(true);
            requestCloseLiquidPrototype();
            quickHandoffTimerRef.current = null;
        }, delay);
    }, [clearQuickHandoffTimer, requestCloseLiquidPrototype]);
    const scheduleQuickHandoffReturn = useCallback((delay = 260) => {
        if (quickHandoffReturnTimerRef.current) {
            clearTimeout(quickHandoffReturnTimerRef.current);
        }
        quickHandoffReturnTimerRef.current = setTimeout(() => {
            restoreToolbarAfterHandoff();
            quickHandoffReturnTimerRef.current = null;
        }, delay);
    }, [restoreToolbarAfterHandoff]);
    const handleQuickModalCloseStart = useCallback((returnDelay = 260) => {
        clearQuickHandoffTimer();
        setQuickHandoffHidden(true);
        requestCloseLiquidPrototype();
        scheduleQuickHandoffReturn(returnDelay);
    }, [clearQuickHandoffTimer, requestCloseLiquidPrototype, scheduleQuickHandoffReturn]);
    const handleQuickModalClosed = useCallback(() => {
        if (quickHandoffTimerRef.current) {
            clearTimeout(quickHandoffTimerRef.current);
            quickHandoffTimerRef.current = null;
        }
        if (quickHandoffReturnTimerRef.current) {
            clearTimeout(quickHandoffReturnTimerRef.current);
            quickHandoffReturnTimerRef.current = null;
            restoreToolbarAfterHandoff();
        } else {
            setQuickHandoffHidden(false);
        }
        setQuickModalVisible(false);
    }, [restoreToolbarAfterHandoff]);
    const handleScheduleModalClosed = useCallback(() => {
        if (quickHandoffTimerRef.current) {
            clearTimeout(quickHandoffTimerRef.current);
            quickHandoffTimerRef.current = null;
        }
        if (quickHandoffReturnTimerRef.current) {
            clearTimeout(quickHandoffReturnTimerRef.current);
            quickHandoffReturnTimerRef.current = null;
            restoreToolbarAfterHandoff();
        } else {
            setQuickHandoffHidden(false);
        }
        setModalVisible(false);
    }, [restoreToolbarAfterHandoff]);
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
    const searchHeaderWidth = searchToolbarProgress.interpolate({
        inputRange: [0, 0.1, 1],
        outputRange: [
            LIQUID_TOOLBAR_ACTIONS_WIDTH,
            LIQUID_TOOLBAR_ACTIONS_WIDTH,
            searchHeaderTargetWidth,
        ],
    });
    const searchMorphSeedOpacity = searchToolbarProgress.interpolate({
        inputRange: [0, 0.48, 0.78, 1],
        outputRange: [1, 0.94, 0.16, 0],
        extrapolate: "clamp",
    });
    const searchMorphSeedScale = searchToolbarProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 1],
    });
    const searchFieldContentOpacity = searchToolbarProgress.interpolate({
        inputRange: [0, 0.72, 1],
        outputRange: [0, 0, 1],
        extrapolate: "clamp",
    });
    const searchFieldContentTranslateX = searchToolbarProgress.interpolate({
        inputRange: [0, 0.72, 1],
        outputRange: [6, 6, 0],
        extrapolate: "clamp",
    });
    const searchFieldContentTranslateY = searchToolbarProgress.interpolate({
        inputRange: [0, 0.72, 1],
        outputRange: [3, 3, 0],
        extrapolate: "clamp",
    });
    const dropdownOpacity = toolbarDropdownProgress.interpolate({
        inputRange: [0, 0.32, 1],
        outputRange: [0, 0.86, 1],
    });
    const viewDropdownOpacity = toolbarDropdownProgress.interpolate({
        inputRange: [0, 0.18, 1],
        outputRange: [0, 0.92, 1],
    });
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
    const showsFloatingMonthTitle = calendarViewMode === "list";
    const isStickyCalendarMode =
        calendarViewMode === "compact" || calendarViewMode === "stack" || calendarViewMode === "detail";
    const nonSearchToolbarMenuActive =
        activeToolbarMenu !== null && activeToolbarMenu !== "search";
    const isFormOverlayVisible = modalVisible || quickModalVisible;
    const showsStickyCalendarHeader =
        isStickyCalendarMode &&
        !nonSearchToolbarMenuActive &&
        (!keyboardVisible || isFormOverlayVisible) &&
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
        : { color: colors.textPrimary };
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
        keyboardVisible;

    useEffect(() => {
        return () => {
            clearQuickHandoffTimer();
        };
    }, [clearQuickHandoffTimer]);

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
        if (isFocused && !yearOverviewVisible && !viewTransitioningRef.current) {
            calendarTransition.setValue(1);
        }
    }, [calendarTransition, isFocused, yearOverviewVisible]);

    useEffect(() => {
        if (selectedDay !== todayKey) {
            setTodayButtonPrimed(false);
        }
    }, [selectedDay, todayKey]);

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
            if (!__DEV__ && isFocused && !isMorphQaSurface) {
                Alert.alert("일정 조회 실패", message);
            }
        } finally {
            dispatch({ type: "SET_LOADING", loading: false });
        }
    }, [dispatch, isFocused, isMorphQaSurface, visibleMonth]);

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
        requestCloseLiquidPrototype();

        if (!activeToolbarMenu) {
            afterClose?.();
            return;
        }

        setToolbarMenuClosing(true);
        const closingMenu = activeToolbarMenu;
        const closingProgress = closingMenu === "search" ? searchToolbarProgress : toolbarDropdownProgress;

        closingProgress.stopAnimation();
        Animated.timing(closingProgress, {
            toValue: 0,
            duration: closingMenu === "search" ? 95 : 153,
            easing: closingMenu === "search" ? Easing.out(Easing.cubic) : Easing.inOut(Easing.cubic),
            useNativeDriver: closingMenu !== "search",
        }).start(({ finished }) => {
            if (!finished) return;

            setActiveToolbarMenu(null);
            setToolbarMenuClosing(false);
            afterClose?.();
        });
    }, [activeToolbarMenu, requestCloseLiquidPrototype, searchToolbarProgress, toolbarDropdownProgress]);

    const runToolbarAction = useCallback((action: () => void) => {
        Keyboard.dismiss();
        setToolbarMenuClosing(true);
        toolbarDropdownProgress.stopAnimation();
        Animated.timing(toolbarDropdownProgress, {
            toValue: 0,
            duration: 108,
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
        searchToolbarProgress.stopAnimation();
        toolbarDropdownProgress.setValue(0);
        searchToolbarProgress.setValue(0);
        setActiveToolbarMenu(menu);

        requestAnimationFrame(() => {
            if (menu === "search") {
                Animated.timing(searchToolbarProgress, {
                    toValue: 1,
                    duration: 158,
                    easing: Easing.inOut(Easing.cubic),
                    useNativeDriver: false,
                }).start();
                return;
            }

            Animated.spring(toolbarDropdownProgress, {
                toValue: 1,
                speed: 24.2,
                bounciness: 7,
                useNativeDriver: true,
            }).start();
        });
    }, [activeToolbarMenu, closeToolbarMenu, searchToolbarProgress, toolbarDropdownProgress]);

    const openSearchToolbar = useCallback(() => {
        setSearchQuery("");
        openToolbarMenu("search");
    }, [openToolbarMenu]);

    const closeSearchToolbar = useCallback(() => {
        setSearchQuery("");
        closeToolbarMenu();
    }, [closeToolbarMenu]);

    const qaInitialValues = useMemo<ScheduleParseResult>(() => {
        const sample = createQaScheduleItem();
        return {
            title: sample.title,
            notes: sample.notes,
            startAt: sample.startAt,
            endAt: sample.endAt,
            origin: sample.origin,
            destination: sample.destination,
            travelMinutes: sample.travelMinutes,
            travelMode: sample.travelMode,
            route: sample.route,
            notificationEnabled: sample.notificationEnabled,
            notificationLeadMinutes: sample.notificationLeadMinutes,
            notificationIntervalMinutes: sample.notificationIntervalMinutes,
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
        if (!qaSurface) {
            handledQaSurfaceRef.current = null;
            return;
        }

        if (
            isQuickMorphQaSurface ||
            isManualMorphQaSurface
        ) {
            return;
        }

        const qaKey = `${qaSurface}:${qaRun ?? ""}`;
        if (handledQaSurfaceRef.current === qaKey) return;
        handledQaSurfaceRef.current = qaKey;

        if (qaSurface === "popover") {
            if (usesLiquidViewModeControl) {
                setPrototypeTapRequest((value) => value + 1);
                return;
            }

            if (activeToolbarMenu !== "view") openToolbarMenu("view");
            return;
        }

        if (qaSurface === "search") {
            setSearchQuery("없는 일정");
            if (activeToolbarMenu !== "search") openToolbarMenu("search");
            return;
        }

        if (qaSurface === "add-dropdown") {
            setActiveToolbarMenu(null);
            if (usesLiquidViewModeControl) {
                setPrototypeAddMenuRequest((value) => value + 1);
                return;
            }
            openToolbarMenu("add");
            return;
        }

        if (qaSurface === "year") {
            closeToolbarMenu();
            setOverviewYear(visibleYear);
            setYearOverviewClosing(false);
            setYearOverviewVisible(true);
            yearOverviewProgress.setValue(0);
            calendarTransition.setValue(1);

            requestAnimationFrame(() => {
                Animated.parallel([
                    Animated.timing(calendarTransition, {
                        toValue: 0,
                        duration: 190,
                        easing: Easing.out(Easing.quad),
                        useNativeDriver: true,
                    }),
                    Animated.timing(yearOverviewProgress, {
                        toValue: 1,
                        duration: 260,
                        easing: Easing.out(Easing.cubic),
                        useNativeDriver: true,
                    }),
                ]).start();
            });
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
    }, [
        activeToolbarMenu,
        calendarTransition,
        closeToolbarMenu,
        openToolbarMenu,
        qaInitialValues,
        qaRun,
        qaSurface,
        usesLiquidViewModeControl,
        visibleYear,
        yearOverviewProgress,
    ]);

    const openBlankSchedule = () => {
        setFormInitialValues(null);
        setScheduleModalSource({
            width: LIQUID_TOOLBAR_ADD_DROPDOWN_WIDTH,
            height: LIQUID_TOOLBAR_ADD_DROPDOWN_HEIGHT,
            content: "addMenu",
        });
        if (usesLiquidViewModeControl) {
            clearQuickHandoffTimer();
            setQuickHandoffHidden(false);
            setModalVisible(true);
            scheduleQuickHandoffHide(0);
            return;
        }

        runToolbarAction(() => {
            setModalVisible(true);
        });
    };

    const openQuickSchedule = () => {
        clearQuickHandoffTimer();
        setQuickHandoffHidden(false);
        setQuickModalSource({
            width: LIQUID_TOOLBAR_ADD_DROPDOWN_WIDTH,
            height: LIQUID_TOOLBAR_ADD_DROPDOWN_HEIGHT,
            content: "addMenu",
        });
        if (usesLiquidViewModeControl) {
            setQuickHandoffHidden(false);
            setQuickModalVisible(true);
            scheduleQuickHandoffHide(0);
            return;
        }

        runToolbarAction(() => {
            setQuickModalVisible(true);
        });
    };

    const openCategoryManager = () => {
        runToolbarAction(() => {
            router.push("/schedule/categories");
        });
    };

    useEffect(() => {
        if (!__DEV__) return;
        if (
            !isQuickMorphQaSurface &&
            !isManualMorphQaSurface
        ) return;

        const qaKey = `${qaSurface}:${qaRun ?? ""}`;
        if (handledQaSurfaceRef.current === qaKey) return;
        handledQaSurfaceRef.current = qaKey;

        setQuickModalVisible(false);
        setModalVisible(false);
        setFormInitialValues(null);
        setQuickHandoffHidden(false);
        setActiveToolbarMenu(null);
        if (usesLiquidViewModeControl) {
            setPrototypeAddMenuRequest((value) => value + 1);
            const timer = setTimeout(() => {
                if (isQuickMorphQaSurface) {
                    setPrototypeQuickAddRequest((value) => value + 1);
                    return;
                }

                setPrototypeManualAddRequest((value) => value + 1);
            }, 180);
            return () => clearTimeout(timer);
        } else {
            openToolbarMenu("add");
        }

        const timer = setTimeout(() => {
            if (isQuickMorphQaSurface) {
                openQuickSchedule();
                return;
            }

            openBlankSchedule();
        }, 180);

        return () => clearTimeout(timer);
    }, [isManualMorphQaSurface, isQuickMorphQaSurface, qaRun, qaSurface]);

    const openScheduleFromSearch = (id: string) => {
        setSearchQuery("");
        runToolbarAction(() => {
            router.push({
                pathname: "/schedule/[id]",
                params: { id },
            });
        });
    };

    const handleQuickAnalyze = async (text: string, media?: QuickScheduleMediaInput) => {
        try {
            // 사진/음성은 서버로 파일을 보내지 않는다. iOS 네이티브에서 텍스트를 먼저 추출하고,
            // 기존 빠른일정 파서가 이해하는 text + inputType 계약으로만 백엔드에 전달한다.
            const parseInput = await resolveQuickScheduleParseInput(text, media);

            return await parseScheduleText({
                text: parseInput.text,
                inputType: parseInput.inputType,
                referenceDate: selectedDay,
                defaultDurationMinutes: 60,
            });
        } catch (error) {
            Alert.alert("일정 분석 실패", getErrorMessage(error));
            throw error;
        }
    };

    const handleVisibleMonthChange = useCallback((month: string) => {
        setVisibleMonth(month);
        if (month.slice(0, 7) !== todayKey.slice(0, 7)) {
            setTodayButtonPrimed(false);
        }
    }, [todayKey]);

    const handleSelectDay = useCallback((day: string) => {
        dispatch({ type: "SET_SELECTED_DAY", day });
        setTodayButtonPrimed(day === todayKey);
    }, [dispatch, todayKey]);

    const handleOpenDay = useCallback((day: string) => {
        closeToolbarMenu();
        setTodayButtonPrimed(false);
        dispatch({ type: "SET_SELECTED_DAY", day });
        calendarTransition.setValue(1);

        requestAnimationFrame(() => {
            router.push({
                pathname: "/schedule/timetable",
                params: { date: day, dateRun: String(Date.now()) },
            });
        });
    }, [calendarTransition, closeToolbarMenu, dispatch, router]);

    const focusTodayOnCalendar = useCallback((options?: { revealImmediately?: boolean }) => {
        closeToolbarMenu();
        dispatch({ type: "SET_SELECTED_DAY", day: todayKey });
        setVisibleMonth(todayKey);
        setCalendarScrollRequest((request) => request + 1);
        setTodayButtonPrimed(true);
        if (options?.revealImmediately !== false) {
            calendarTransition.setValue(1);
        }
    }, [calendarTransition, closeToolbarMenu, dispatch, todayKey]);

    useEffect(() => {
        const focusKey = `${focusRequest ?? ""}:${focusRun ?? ""}`;
        if (focusRequest !== "today" || handledFocusRequestRef.current === focusKey) return;

        handledFocusRequestRef.current = focusKey;
        setYearOverviewVisible(false);
        setYearOverviewClosing(false);
        focusTodayOnCalendar();
    }, [focusRequest, focusRun, focusTodayOnCalendar]);

    const handleGoToday = useCallback(() => {
        if (yearOverviewVisible) {
            focusTodayOnCalendar({ revealImmediately: false });
            setYearOverviewClosing(true);

            Animated.parallel([
                Animated.timing(yearOverviewProgress, {
                    toValue: 0,
                    duration: 185,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.timing(calendarTransition, {
                    toValue: 1,
                    duration: 245,
                    easing: Easing.bezier(0.2, 0.9, 0.2, 1),
                    useNativeDriver: true,
                }),
            ]).start(() => {
                setYearOverviewVisible(false);
                setYearOverviewClosing(false);
            });
            return;
        }

        const isTodayAlreadyFocused =
            selectedDay === todayKey &&
            visibleMonth.slice(0, 7) === todayKey.slice(0, 7);

        if (isTodayAlreadyFocused || todayButtonPrimed) {
            handleOpenDay(todayKey);
            return;
        }

        focusTodayOnCalendar();
    }, [
        calendarTransition,
        focusTodayOnCalendar,
        handleOpenDay,
        selectedDay,
        todayButtonPrimed,
        todayKey,
        visibleMonth,
        yearOverviewProgress,
        yearOverviewVisible,
    ]);

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

    const closeYearOverview = useCallback(() => {
        if (!yearOverviewVisible) return;

        setYearOverviewClosing(true);
        Animated.parallel([
            Animated.timing(yearOverviewProgress, {
                toValue: 0,
                duration: 180,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
            }),
            Animated.timing(calendarTransition, {
                toValue: 1,
                duration: 220,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
        ]).start(() => {
            setYearOverviewVisible(false);
            setYearOverviewClosing(false);
        });
    }, [calendarTransition, yearOverviewProgress, yearOverviewVisible]);

    const openYearOverview = useCallback(() => {
        if (yearOverviewVisible && !yearOverviewClosing) {
            closeYearOverview();
            return;
        }

        closeToolbarMenu();
        setOverviewYear(visibleYear);
        setYearOverviewClosing(false);
        setYearOverviewVisible(true);
        yearOverviewProgress.setValue(0);

        Animated.parallel([
            Animated.timing(calendarTransition, {
                toValue: 0.18,
                duration: 245,
                easing: Easing.bezier(0.2, 0.9, 0.2, 1),
                useNativeDriver: true,
            }),
            Animated.timing(yearOverviewProgress, {
                toValue: 1,
                duration: 235,
                easing: Easing.bezier(0.2, 0.9, 0.2, 1),
                useNativeDriver: true,
            }),
        ]).start();
    }, [
        calendarTransition,
        closeToolbarMenu,
        closeYearOverview,
        visibleYear,
        yearOverviewClosing,
        yearOverviewProgress,
        yearOverviewVisible,
    ]);

    const selectOverviewMonth = useCallback((year: number, month: number) => {
        const nextDay = `${year}-${String(month).padStart(2, "0")}-01`;
        dispatch({ type: "SET_SELECTED_DAY", day: nextDay });
        setVisibleMonth(nextDay);
        setOverviewYear(year);
        setCalendarScrollRequest((request) => request + 1);
        setTodayButtonPrimed(nextDay === todayKey);
        setYearOverviewClosing(true);

        Animated.parallel([
            Animated.timing(yearOverviewProgress, {
                toValue: 0,
                duration: 170,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
            }),
            Animated.timing(calendarTransition, {
                toValue: 1,
                duration: 240,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
        ]).start(() => {
            setYearOverviewVisible(false);
            setYearOverviewClosing(false);
        });
    }, [calendarTransition, dispatch, todayKey, yearOverviewProgress]);

    const openProfile = useCallback(() => {
        router.push("/profile");
    }, [router]);

    const bottomLeftActions = useMemo<FloatingBarAction[]>(() => [{
            key: "today",
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
        <View style={[styles.root, { backgroundColor: colors.calendarBackground }]}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />

            <View
                pointerEvents="none"
                style={[
                    styles.bottomMaterialLayer,
                    mode === "dark" ? styles.bottomMaterialLayerDark : styles.bottomMaterialLayerLight,
                ]}
            />

            <View
                pointerEvents="box-none"
                style={styles.toolbarLayer}
            >
                {(activeToolbarMenu !== null || toolbarMenuClosing || liquidPrototypeOpen) && (
                    <Pressable style={styles.toolbarDropdownBackdrop} onPress={() => closeToolbarMenu()} />
                )}

                {(
                    <Animated.View
                        pointerEvents={isSearchToolbarOpen ? "none" : "box-none"}
                        style={[
                            styles.toolbarChromeLayer,
                            { paddingTop: insets.top },
                        ]}
                    >
                        <View style={styles.toolbar}>
                            {isLiquidGlassIconButtonAvailable ? (
                                <Pressable
                                    onPressIn={openYearOverview}
                                    accessibilityLabel={`${visibleYear}년 전체 월 보기`}
                                    accessibilityRole="button"
                                    style={({ pressed }) => [
                                        styles.yearGlass,
                                        {
                                            opacity: pressed ? 0.68 : 1,
                                            transform: [{ scale: pressed ? 0.96 : 1 }],
                                        },
                                    ]}
                                >
                                    <LiquidGlassIconButton
                                        pointerEvents="none"
                                        leadingSymbolName="chevron.left"
                                        label={`${visibleYear}년`}
                                        buttonWidth={LIQUID_YEAR_PILL_WIDTH}
                                        buttonHeight={LIQUID_TOOLBAR_BUTTON_SIZE}
                                        colorScheme={mode === "dark" ? "dark" : "light"}
                                        accessibilityLabel={`${visibleYear}년 전체 월 보기`}
                                        style={StyleSheet.absoluteFill}
                                    />
                                </Pressable>
                            ) : (
                                <Pressable
                                    onPressIn={openYearOverview}
                                    accessibilityLabel={`${visibleYear}년 전체 월 보기`}
                                    accessibilityRole="button"
                                    style={({ pressed }) => [
                                        styles.yearGlass,
                                        {
                                            opacity: pressed ? 0.68 : 1,
                                            transform: [{ scale: pressed ? 0.96 : 1 }],
                                        },
                                    ]}
                                >
                                    <CalendarGlassSurface
                                        pointerEvents="none"
                                        interactive
                                        clear
                                        glow
                                        variant="bottomBar"
                                        tone="softGlass"
                                        style={[
                                            styles.yearGlassSurface,
                                            { borderColor: colors.border },
                                        ]}
                                    />
                                    <View pointerEvents="none" style={styles.yearButton}>
                                        <Ionicons name="chevron-back" size={23} color={colors.textPrimary} />
                                        <Text style={[styles.yearText, { color: colors.textPrimary }]}>
                                            {visibleYear}년
                                        </Text>
                                    </View>
                                </Pressable>
                            )}

                            <View pointerEvents="none" style={styles.toolbarActionsPlaceholder} />
                        </View>

                    {showsFloatingMonthTitle && (
                        <View pointerEvents="none" style={styles.floatingMonthTitleLayer}>
                            <Text style={[styles.floatingMonthTitle, { color: colors.textPrimary }]}>
                                {Number(visibleMonth.slice(5, 7))}월
                            </Text>
                        </View>
                    )}
                    </Animated.View>
                )}

                {!isSearchToolbarOpen && (
                    <Pressable
                        onPressIn={openYearOverview}
                        accessible={false}
                        importantForAccessibility="no"
                        style={[
                            styles.yearTapOverlay,
                            {
                                top: insets.top + LIQUID_TOOLBAR_TOP_OFFSET,
                                left: 16,
                            },
                        ]}
                    />
                )}

                {usesLiquidViewModeControl ? (
                    <Animated.View
                        pointerEvents="box-none"
                        style={[
                            styles.liquidViewModeControl,
                            {
                                top: insets.top + LIQUID_TOOLBAR_TOP_OFFSET,
                                right: 16,
                                width: liquidPrototypeLayerWidth,
                                opacity: quickHandoffHidden ? 0 : 1,
                            },
                        ]}
                    >
                        <LiquidCalendarMenuPrototype
                            key={`calendar-liquid-${liquidPrototypeResetKey}`}
                            selectedMode={calendarViewMode}
                            colorScheme={mode === "dark" ? "dark" : "light"}
                            tapRequest={prototypeTapRequest}
                            closeRequest={prototypeCloseRequest}
                            addMenuRequest={prototypeAddMenuRequest}
                            quickAddRequest={prototypeQuickAddRequest}
                            manualAddRequest={prototypeManualAddRequest}
                            searchExpandedWidth={searchHeaderTargetWidth}
                            searchQuery={searchQuery}
	                            onSelect={(mode) => {
	                                if (isCalendarViewMode(mode)) {
	                                    handleCalendarViewModeChange(mode);
	                                }
	                            }}
                            onOpenChange={setLiquidPrototypeOpen}
                            onSearch={openSearchToolbar}
                            onSearchTextChange={setSearchQuery}
                            onSearchClose={closeSearchToolbar}
                            onQuickAdd={openQuickSchedule}
                            onManualAdd={openBlankSchedule}
                            onManageCategories={openCategoryManager}
                            style={StyleSheet.absoluteFill}
                        />
                    </Animated.View>
                ) : (
                    <Animated.View
                        pointerEvents="box-none"
                        style={[
                            styles.scheduleActionPillLayer,
                            {
                                top: insets.top + LIQUID_TOOLBAR_TOP_OFFSET,
                                right: 16,
                                width: searchHeaderWidth,
                                opacity: quickHandoffHidden ? 0 : 1,
                            },
                        ]}
                    >
                        <CalendarGlassSurface
                            interactive
                            clear
                            glow
                            variant="bottomBar"
                            tone="softGlass"
                            style={[
                                styles.toolbarActions,
                                { borderColor: colors.border },
                            ]}
                        >
                            <Animated.View
                                pointerEvents={isSearchToolbarOpen ? "none" : "auto"}
                                style={[
                                    styles.searchFieldSeedRow,
                                    {
                                        opacity: searchMorphSeedOpacity,
                                        transform: [{ scale: searchMorphSeedScale }],
                                    },
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
                                    onPress={openSearchToolbar}
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
                            </Animated.View>

                            <Animated.View
                                pointerEvents={isSearchToolbarOpen ? "auto" : "none"}
                                style={[
                                    styles.searchFieldInner,
                                    {
                                        opacity: searchFieldContentOpacity,
                                        transform: [
                                            { translateX: searchFieldContentTranslateX },
                                            { translateY: searchFieldContentTranslateY },
                                        ],
                                    },
                                ]}
                            >
                                <Ionicons name="search" size={20} color={colors.textPrimary} />
                                <TextInput
                                    ref={searchInputRef}
                                    value={searchQuery}
                                    onChangeText={setSearchQuery}
                                    placeholder="검색"
                                    placeholderTextColor={colors.inputPlaceholder}
                                    returnKeyType="search"
                                    selectionColor={colors.textPrimary}
                                    style={[styles.searchHeaderInput, { color: colors.textPrimary }]}
                                />
                                {searchQuery.length > 0 ? (
                                    <Pressable
                                        onPress={() => setSearchQuery("")}
                                        accessibilityLabel="검색어 지우기"
                                        hitSlop={12}
                                        style={({ pressed }) => [
                                            styles.searchHeaderIconButton,
                                            { opacity: pressed ? 0.58 : 1 },
                                        ]}
                                    >
                                        <Ionicons name="close-circle" size={25} color={colors.textSecondary} />
                                    </Pressable>
                                ) : null}
                                <Pressable
                                    onPressIn={closeSearchToolbar}
                                    onPress={closeSearchToolbar}
                                    accessibilityLabel="검색 닫기"
                                    hitSlop={12}
                                    style={({ pressed }) => [
                                        styles.searchHeaderIconButton,
                                        { opacity: pressed ? 0.58 : 1 },
                                    ]}
                                >
                                    <Ionicons name="close" size={24} color={colors.textPrimary} />
                                </Pressable>
                            </Animated.View>
                        </CalendarGlassSurface>
                    </Animated.View>
                )}

                {isSearchToolbarOpen && searchQuery.trim().length > 0 && (
                    <Animated.View
                        pointerEvents="box-none"
                        style={[
                            styles.searchResultsLayer,
                            {
                                top: insets.top + 74,
                                right: 16,
                                width: searchHeaderTargetWidth,
                                opacity: searchFieldContentOpacity,
                                transform: [{ translateY: searchFieldContentTranslateY }],
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
                    </Animated.View>
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

                {!usesLiquidViewModeControl && activeToolbarMenu === "view" && (
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
                                    <View style={styles.viewModeIconGrid}>
                                    {CALENDAR_VIEW_OPTIONS.map((option) => {
                                        const selected = option.value === calendarViewMode;

                                        return (
                                            <Pressable
                                                key={option.value}
                                                accessibilityLabel={`${option.label} 보기`}
                                                onPress={() => handleCalendarViewModeChange(option.value)}
                                                style={({ pressed }) => [
                                                    styles.viewModeIconOption,
                                                    selected && (
                                                        mode === "dark"
                                                            ? styles.viewModeSelectedPillDark
                                                            : styles.viewModeSelectedPillLight
                                                    ),
                                                    {
                                                        opacity: pressed ? 0.62 : 1,
                                                        transform: [{ scale: pressed ? 0.92 : 1 }],
                                                    },
                                                ]}
                                            >
                                                <CalendarViewModeGlyph
                                                    mode={option.value}
                                                    color={colors.textPrimary}
                                                    size={25}
                                                />
                                            </Pressable>
                                        );
                                    })}
                                    </View>
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
                                right: actionDropdownRight,
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
                        transform: [
                            { translateY: calendarContentTranslateY },
                            { scale: calendarContentScale },
                        ],
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

            <Animated.View
                pointerEvents={yearOverviewVisible && !yearOverviewClosing ? "auto" : "none"}
                importantForAccessibility={yearOverviewVisible ? "auto" : "no-hide-descendants"}
                style={[
                    styles.yearOverviewLayer,
                    {
                        opacity: yearOverviewProgress,
                        transform: [
                            { translateY: yearOverviewTranslateY },
                            { scale: yearOverviewScale },
                        ],
                    },
                ]}
            >
                <CalendarYearOverviewModal
                    visible
                    year={overviewYear}
                    selectedDay={selectedDay}
                    firstDay={firstDay}
                    topInset={insets.top}
                    onChangeYear={setOverviewYear}
                    onSelectMonth={selectOverviewMonth}
                    onClose={closeYearOverview}
                />
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
                onClose={handleQuickModalClosed}
                onCloseStart={() => handleQuickModalCloseStart(260)}
                onAnalyze={handleQuickAnalyze}
                onSave={addItem}
                defaultDay={selectedDay}
                defaultCategory={state.categories[0]}
                sourceTopOffset={LIQUID_TOOLBAR_TOP_OFFSET}
                sourceWidth={quickModalSource.width}
                sourceHeight={quickModalSource.height}
                sourceContent={quickModalSource.content}
                qaAutoCloseAfterMs={qaSurface === "quick-add-morph-close" ? 2400 : undefined}
            />

            <ScheduleNewModal
                visible={modalVisible}
                onClose={handleScheduleModalClosed}
                onCloseStart={() => handleQuickModalCloseStart(300)}
                onSubmit={addItem}
                categories={state.categories}
                defaultDay={selectedDay}
                initialValues={formInitialValues}
                onManageCategories={openCategoryManager}
                autoFocusTitle={qaSurface === "event-create-keyboard"}
                presentation={usesLiquidViewModeControl ? "morph" : "sheet"}
                sourceTopOffset={LIQUID_TOOLBAR_TOP_OFFSET}
                sourceWidth={scheduleModalSource.width}
                sourceHeight={scheduleModalSource.height}
                sourceContent={scheduleModalSource.content}
                qaAutoCloseAfterMs={qaSurface === "manual-add-morph-close" ? 2600 : undefined}
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
        height: 34,
    },
    topMaterialBandDark: {
        backgroundColor: "rgba(0,0,0,0.30)",
    },
    topMaterialBandLight: {
        backgroundColor: "rgba(242,242,247,0.50)",
    },
    topFadeBandStrong: {
        position: "absolute",
        top: 18,
        left: 0,
        right: 0,
        height: 54,
    },
    topFadeBandDark: {
        backgroundColor: "rgba(0,0,0,0.11)",
    },
    topFadeBandLight: {
        backgroundColor: "rgba(242,242,247,0.20)",
    },
    topFadeBandSoft: {
        position: "absolute",
        top: 66,
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
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 4,
    },
    toolbarChromeLayer: {
        zIndex: 50,
        elevation: 50,
    },
    yearTapOverlay: {
        position: "absolute",
        width: LIQUID_YEAR_PILL_WIDTH,
        height: LIQUID_TOOLBAR_BUTTON_SIZE,
        borderRadius: LIQUID_TOOLBAR_BUTTON_SIZE / 2,
        zIndex: 58,
        elevation: 58,
        backgroundColor: "transparent",
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
        backgroundColor: "transparent",
    },
    stickyHeaderBackdropLight: {
        backgroundColor: "transparent",
    },
    stickyHeaderBackdropTop: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 42,
    },
    stickyHeaderBackdropTopDark: {
        backgroundColor: "transparent",
    },
    stickyHeaderBackdropTopLight: {
        backgroundColor: "transparent",
    },
    stickyHeaderBackdropBottom: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 58,
    },
    stickyHeaderBackdropBottomDark: {
        backgroundColor: "transparent",
    },
    stickyHeaderBackdropBottomLight: {
        backgroundColor: "transparent",
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
    scheduleActionPillLayer: {
        position: "absolute",
        zIndex: 56,
        elevation: 56,
    },
    liquidViewModeControl: {
        position: "absolute",
        height: LIQUID_VIEW_MODE_CONTROL_HEIGHT,
        zIndex: 56,
        elevation: 56,
        overflow: "visible",
    },
    searchFieldSeedRow: {
        position: "absolute",
        top: 0,
        right: 0,
        width: LIQUID_TOOLBAR_ACTIONS_WIDTH,
        height: LIQUID_TOOLBAR_BUTTON_SIZE,
        borderRadius: LIQUID_TOOLBAR_BUTTON_SIZE / 2,
        zIndex: 2,
        elevation: 2,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-around",
        paddingHorizontal: 11,
    },
    searchFieldInner: {
        flex: 1,
        minWidth: 0,
        height: "100%",
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        paddingLeft: 18,
        paddingRight: 12,
        zIndex: 3,
        elevation: 3,
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
        width: 34,
        height: 34,
        alignItems: "center",
        justifyContent: "center",
    },
    searchResultsGlass: {
        marginTop: 8,
        borderRadius: 22,
        borderWidth: 1,
        overflow: "hidden",
        maxHeight: 260,
    },
    searchResultsLayer: {
        position: "absolute",
        zIndex: 55,
        elevation: 55,
    },
    toolbarActions: {
        flexDirection: "row",
        alignItems: "center",
        height: LIQUID_TOOLBAR_BUTTON_SIZE,
        borderRadius: LIQUID_TOOLBAR_BUTTON_SIZE / 2,
        borderWidth: Platform.OS === "ios" ? 0 : 1,
        paddingHorizontal: 0,
        overflow: "hidden",
    },
    toolbarActionsPlaceholder: {
        width: LIQUID_TOOLBAR_ACTIONS_WIDTH,
        height: LIQUID_TOOLBAR_BUTTON_SIZE,
    },
    yearGlass: {
        width: LIQUID_YEAR_PILL_WIDTH,
        height: LIQUID_TOOLBAR_BUTTON_SIZE,
        borderRadius: LIQUID_TOOLBAR_BUTTON_SIZE / 2,
        borderWidth: Platform.OS === "ios" ? 0 : 1,
        overflow: Platform.OS === "ios" ? "visible" : "hidden",
    },
    yearGlassSurface: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: LIQUID_TOOLBAR_BUTTON_SIZE / 2,
        borderWidth: Platform.OS === "ios" ? 0 : 1,
        overflow: "hidden",
    },
    yearButton: {
        height: LIQUID_TOOLBAR_BUTTON_SIZE,
        borderRadius: LIQUID_TOOLBAR_BUTTON_SIZE / 2,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingLeft: 8,
        paddingRight: 12,
        gap: 3,
    },
    yearText: {
        fontWeight: "800",
        fontSize: 18,
    },
    iconButton: {
        width: LIQUID_TOOLBAR_SLOT_WIDTH,
        height: LIQUID_TOOLBAR_BUTTON_SIZE,
        alignItems: "center",
        justifyContent: "center",
    },
    iconButtonActive: {
        borderRadius: 18,
        backgroundColor: "rgba(255, 255, 255, 0.035)",
    },
    toolbarDropdownBackdrop: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 42,
        elevation: 42,
        backgroundColor: "transparent",
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
        paddingTop: 10,
        paddingBottom: 10,
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
    viewModeIconGrid: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingHorizontal: 10,
    },
    viewModeIconOption: {
        width: 40,
        height: 42,
        borderRadius: 17,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "transparent",
        alignItems: "center",
        justifyContent: "center",
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
        minHeight: 74,
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
    yearOverviewLayer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 30,
        elevation: 30,
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
