import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    AccessibilityInfo,
    Alert,
    Animated,
    AppState,
    Easing,
    InteractionManager,
    Keyboard,
    PanResponder,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    useWindowDimensions,
    unstable_batchedUpdates,
    View,
    type LayoutChangeEvent,
    type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Reanimated, {
    Easing as ReanimatedEasing,
    ReduceMotion,
    cancelAnimation as cancelReanimatedAnimation,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import CalendarWrapper, { type DayTransitionContext } from "../../src/modules/schedule/components/calendar/CalendarWrapper";
import CalendarYearOverviewModal from "../../src/modules/schedule/components/calendar/CalendarYearOverviewModal";
import CalendarGlassSurface from "../../src/modules/schedule/components/calendar/CalendarGlassSurface";
import CalendarViewModeGlyph from "../../src/modules/schedule/components/calendar/CalendarViewModeGlyph";
import { getFixedScheduleCalendarHeight } from "../../src/modules/schedule/components/calendar/ScheduleCalendar";
import DayTimelineEventCard from "../../src/modules/schedule/components/calendar/DayTimelineEventCard";
import LiquidGlassIconButton, {
    isLiquidGlassIconButtonAvailable,
} from "../../src/modules/schedule/components/calendar/LiquidGlassIconButton";
import LiquidCalendarMenuPrototype, {
    isCalendarViewMode,
    isLiquidCalendarMenuPrototypeAvailable,
} from "../../src/modules/schedule/components/calendar/LiquidCalendarMenuPrototype";
import {
    CALENDAR_DAY_HEIGHTS,
    CALENDAR_VIEW_OPTIONS,
    isContinuousMonthViewMode,
    type CalendarViewMode,
} from "../../src/modules/schedule/components/calendar/viewMode";
import GlobalFloatingActionBar, { type FloatingBarAction } from "../../src/modules/schedule/components/shared/GlobalFloatingActionBar";
import {
    MonthAgendaList,
    SelectedDayAgendaPanel,
} from "../../src/modules/schedule/components/list/ScheduleAgendaViews";
import ScheduleNewModal, {
    type ScheduleAddMorphPresenter,
} from "../../src/modules/schedule/components/form/ScheduleAddModal";
import QuickScheduleModal, {
    type QuickScheduleMorphPresenter,
} from "../../src/modules/schedule/components/form/QuickScheduleModal";

import { useScheduleStore } from "../../src/modules/schedule/store";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { isOverlappingDay, startOfDay, toYmd } from "../../lib/util/data";
import type { ScheduleItem, ScheduleParseResult } from "../../src/modules/schedule/types";
import { createSchedule, getCalendarSchedules, parseScheduleText } from "../../src/api/schedule";
import { getScheduleCategoriesFromApi } from "../../src/api/scheduleCategories";
import { getShareInbox } from "../../src/api/scheduleSharing";
import { getMonthRange } from "../../src/modules/schedule/calendarRange";
import {
    DAY_MINUTES,
    DAY_TIMELINE_END_PADDING,
    DAY_TIMELINE_HOUR_HEIGHT,
    buildPositionedEvents,
} from "../../src/modules/schedule/dayTimelineLayout";
import {
    DAY_NAVIGATION_MOTION,
    consumeQueuedDayNavigation,
    getDayNavigationRemainingDuration,
    getDayNavigationResetDuration,
    queueLatestDayNavigation,
} from "../../src/modules/schedule/dayNavigationMotion";
import {
    ADD_HANDOFF_MOTION,
    ADD_MENU_SOURCE,
    shouldRestoreAddHandoffToolbar,
} from "../../src/modules/schedule/addHandoffMotion";
import {
    CALENDAR_DEPTH_MOTION,
    CALENDAR_PILL_MOTION,
    CURRENT_TIME_MOTION,
    MONTH_AGENDA_MOTION,
    formatCalendarCurrentTime,
    getMonthAgendaPanelKind,
    getMonthAgendaTransition,
    resolveMonthAgendaViewportLayout,
    shouldAnimateCurrentTimeStep,
    type MonthAgendaPanelKind,
} from "../../src/modules/schedule/calendarMotion";
import {
    createQaMonthScheduleItems,
    createQaScheduleItem,
} from "../../src/modules/schedule/qaSamples";
import {
    buildShareAttentionSummary,
    readSeenShareAttentionKeys,
    type ShareAttentionSummary,
} from "../../src/modules/share/shareAttention";
import {
    resolveQuickScheduleParseInput,
    type QuickScheduleMediaInput,
} from "../../src/modules/schedule/quickInputExtraction";

const getErrorMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : "요청 처리에 실패했습니다.";

    if (/403|forbidden/i.test(message)) {
        return "일정을 불러오지 못했습니다";
    }

    if (/network|timeout/i.test(message)) {
        return "네트워크 상태를 확인한 뒤 다시 시도해 주세요";
    }

    return message;
};

function getCalendarErrorMessage(message?: string | null) {
    if (!message) return null;

    if (/403|forbidden|status code/i.test(message)) {
        return "일정을 불러오지 못했습니다";
    }

    if (/network|timeout/i.test(message)) {
        return "네트워크 상태를 확인한 뒤 다시 시도해 주세요";
    }

    return message;
}

const PRIMARY_PILL_MIN_WIDTH = 132;

function sanitizeCalendarTransitionError(error?: string | null) {
    return getCalendarErrorMessage(error) ?? null;
}

type ToolbarMenu = "view" | "search" | "add";
type CalendarDepth = "year" | "month" | "day";
type DayViewMode = "singleDay" | "multiDay";

type CalendarDay = {
    dateString: string;
    day: number;
    weekday: string;
    month: number;
};

const CALENDAR_TOOLBAR_HEIGHT = 56;
const STICKY_MONTH_HEADER_HEIGHT = 50;
const STICKY_WEEKDAY_HEADER_HEIGHT = 18;
const STICKY_CALENDAR_HEADER_HEIGHT = STICKY_MONTH_HEADER_HEIGHT + STICKY_WEEKDAY_HEADER_HEIGHT;
const LIQUID_TOOLBAR_BUTTON_SIZE = 44;
const LIQUID_TOOLBAR_SLOT_WIDTH = 50;
const LIQUID_TOOLBAR_ACTIONS_WIDTH = LIQUID_TOOLBAR_SLOT_WIDTH * 3;
const LIQUID_TOOLBAR_ADD_DROPDOWN_WIDTH = ADD_MENU_SOURCE.nativeWidth;
const LIQUID_TOOLBAR_ADD_DROPDOWN_HEIGHT = ADD_MENU_SOURCE.nativeHeight;
const LIQUID_TOOLBAR_CONTROL_CANVAS_HEIGHT = 260;
// The view-mode menu still needs the wider 251pt host. The add menu itself is
// 238pt wide and stays aligned to this canvas' trailing edge.
const LIQUID_TOOLBAR_NATIVE_CANVAS_WIDTH = 251;
const LIQUID_TOOLBAR_QA_ACTION_DELAY_MS = 420;
const SHARE_ATTENTION_REFRESH_MS = 45_000;
const LIQUID_YEAR_PILL_WIDTH = PRIMARY_PILL_MIN_WIDTH;
const LIQUID_TOOLBAR_TOP_OFFSET = 4;
const DAY_WEEK_STRIP_TOP_OFFSET = LIQUID_TOOLBAR_BUTTON_SIZE + LIQUID_TOOLBAR_TOP_OFFSET + 2;
const DAY_WEEK_STRIP_HEIGHT = 71;
const DAY_WEEK_STRIP_HORIZONTAL_PADDING = 0;
const DAY_TIMELINE_GUTTER = 54;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const DAY_NAVIGATION_EASING = Easing.bezier(...DAY_NAVIGATION_MOTION.bezier);
const CALENDAR_DEPTH_EASING = Easing.bezier(...CALENDAR_DEPTH_MOTION.bezier);
const EMPTY_SHARE_ATTENTION = buildShareAttentionSummary({
    pendingInvitations: [],
    receivedShares: [],
});
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

function toDateString(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfWeek(ymd: string) {
    const date = new Date(`${ymd}T00:00:00`);
    date.setDate(date.getDate() - date.getDay());
    return toDateString(date);
}

function addDaysToYmd(ymd: string, offset: number) {
    const date = new Date(`${ymd}T00:00:00`);
    date.setDate(date.getDate() + offset);
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

function createSequentialDays(startYmd: string, count: number): CalendarDay[] {
    const start = new Date(`${startYmd}T00:00:00`);

    return Array.from({ length: count }, (_, index) => {
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

function formatDayTitle(ymd: string) {
    const date = new Date(`${ymd}T00:00:00`);
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAYS[date.getDay()]}요일`;
}

function formatWeekRangeTitle(days: CalendarDay[]) {
    const first = days[0];
    const last = days[days.length - 1];
    if (!first || !last) return "";
    if (
        !Number.isFinite(first.month) ||
        !Number.isFinite(first.day) ||
        !Number.isFinite(last.month) ||
        !Number.isFinite(last.day) ||
        first.month < 1 ||
        first.day < 1 ||
        last.month < 1 ||
        last.day < 1
    ) {
        return "";
    }
    if (first.month === last.month) return `${first.month}월 ${first.day}-${last.day}일`;
    return `${first.month}월 ${first.day}일-${last.month}월 ${last.day}일`;
}

function formatTimelineHour(hour: number) {
    if (hour === 0) return "자정";
    if (hour === 12) return "정오";
    if (hour < 12) return `오전 ${hour}시`;
    return `오후 ${hour - 12}시`;
}

function formatCurrentTimeLabel(date: Date) {
    return formatCalendarCurrentTime(date);
}

function minuteOfDay(date: Date) {
    return date.getHours() * 60 + date.getMinutes();
}

function getDateSelectionId(date: string) {
    return `date-${date}`;
}

function getScheduleFetchRange(
    visibleMonth: string,
    selectedDay: string,
    calendarDepth: CalendarDepth,
    dayViewMode: DayViewMode
) {
    const monthRange = getMonthRange(visibleMonth);
    const startTimes = [new Date(monthRange.startAt).getTime()];
    const endTimes = [new Date(monthRange.endAt).getTime()];

    if (calendarDepth === "day") {
        const visibleDays = dayViewMode === "multiDay"
            ? createSequentialDays(selectedDay, 2).map((day) => day.dateString)
            : [selectedDay];
        const firstDay = visibleDays[0] ?? selectedDay;
        const lastDay = visibleDays[visibleDays.length - 1] ?? selectedDay;
        const dayStart = startOfDay(firstDay);
        const dayEnd = startOfDay(addDaysToYmd(lastDay, 1));
        dayEnd.setMilliseconds(dayEnd.getMilliseconds() - 1);

        startTimes.push(dayStart.getTime());
        endTimes.push(dayEnd.getTime());
    }

    return {
        startAt: new Date(Math.min(...startTimes)).toISOString(),
        endAt: new Date(Math.max(...endTimes)).toISOString(),
    };
}

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
        focusDay?: string | string[];
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
    const isDirectCreateQaSurface = __DEV__ && (
        qaSurface === "event-create-empty" ||
        qaSurface === "event-create-filled" ||
        qaSurface === "event-create-keyboard"
    );
    const isPillCycleQaSurface = qaSurface === "pill-cycle";
    const isMonthCalendarQaSurface = __DEV__ && (
        qaSurface === "month-compact" || qaSurface === "month-stack"
    );
    const isMorphQaSurface = __DEV__ && (
        isQuickMorphQaSurface ||
        isManualMorphQaSurface
    );
    const focusRequest = Array.isArray(params.focus) ? params.focus[0] : params.focus;
    const focusDayRequest = Array.isArray(params.focusDay) ? params.focusDay[0] : params.focusDay;
    const focusRun = Array.isArray(params.focusRun) ? params.focusRun[0] : params.focusRun;
    const { state, dispatch } = useScheduleStore();
    const [modalVisible, setModalVisible] = useState(false);
    const [activeToolbarMenu, setActiveToolbarMenu] = useState<ToolbarMenu | null>(null);
    const [toolbarMenuClosing, setToolbarMenuClosing] = useState(false);
    const [liquidPrototypeOpen, setLiquidPrototypeOpen] = useState(false);
    const [quickModalVisible, setQuickModalVisible] = useState(false);
    const [addFormsPrewarmed, setAddFormsPrewarmed] = useState(false);
    const [quickHandoffHidden, setQuickHandoffHidden] = useState(false);
    const [shareAttention, setShareAttention] = useState<ShareAttentionSummary>(EMPTY_SHARE_ATTENTION);
    const [formInitialValues, setFormInitialValues] = useState<ScheduleParseResult | null>(null);
    const [calendarViewMode, setCalendarViewMode] = useState<CalendarViewMode>(() => {
        if (qaSurface === "month-compact") return "compact";
        if (qaSurface === "month-stack") return "stack";
        return "detail";
    });
    const [calendarDepth, setCalendarDepth] = useState<CalendarDepth>("month");
    const [dayViewMode, setDayViewMode] = useState<DayViewMode>("singleDay");
    const [dayLayerMounted, setDayLayerMounted] = useState(false);
    const [dayTransitionTargetDay, setDayTransitionTargetDay] = useState<string | null>(null);
    const [yearOverviewVisible, setYearOverviewVisible] = useState(false);
    const [yearOverviewClosing, setYearOverviewClosing] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [keyboardVisible, setKeyboardVisible] = useState(false);
    const [firstDay] = useState<0 | 1>(0);
    const [calendarScrollRequest, setCalendarScrollRequest] = useState(0);
    const [dayTodayRequest, setDayTodayRequest] = useState(0);
    const [yearTodayRequest, setYearTodayRequest] = useState(0);
    const [prototypeTapRequest, setPrototypeTapRequest] = useState(0);
    const [prototypeCloseRequest, setPrototypeCloseRequest] = useState(0);
    const [prototypeAddMenuRequest, setPrototypeAddMenuRequest] = useState(0);
    const [prototypeSearchRequest, setPrototypeSearchRequest] = useState(0);
    const [prototypeQuickAddRequest, setPrototypeQuickAddRequest] = useState(0);
    const [prototypeManualAddRequest, setPrototypeManualAddRequest] = useState(0);
    const [todayButtonPrimed, setTodayButtonPrimed] = useState(false);
    const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);
    const [transitionMonthKey, setTransitionMonthKey] = useState<string | null>(null);
    const [dayTransitionContext, setDayTransitionContext] = useState<DayTransitionContext>("idle");
    const [dayModeTransitionFrom, setDayModeTransitionFrom] = useState<DayViewMode | null>(null);
    const [isDayTransitionActive, setIsDayTransitionActive] = useState(false);
    const [isYearDepthTransitionActive, setIsYearDepthTransitionActive] = useState(false);
    const [isMonthViewTransitionActive, setIsMonthViewTransitionActive] = useState(false);
    const [retainedMonthAgendaPanelKind, setRetainedMonthAgendaPanelKind] =
        useState<MonthAgendaPanelKind>("detail");
    const [outgoingMonthAgendaPanelKind, setOutgoingMonthAgendaPanelKind] =
        useState<MonthAgendaPanelKind | null>(null);
    const shouldHideHandoffSurface = quickHandoffHidden && (quickModalVisible || modalVisible);
    const calendarTransition = useRef(new Animated.Value(1)).current;
    const monthAgendaProgress = useRef(new Animated.Value(1)).current;
    const monthAgendaSwapProgress = useRef(new Animated.Value(1)).current;
    const monthCalendarTransitionProgress = useRef(new Animated.Value(1)).current;
    const monthCalendarAnimatedHeight = useSharedValue(0);
    const monthCalendarTargetHeight = useSharedValue(0);
    const monthCalendarAnimatedDayHeight = useSharedValue(
        CALENDAR_DAY_HEIGHTS.detail
    );
    const yearOverviewProgress = useRef(new Animated.Value(0)).current;
    const dayTransition = useRef(new Animated.Value(0)).current;
    const dayModeTransition = useRef(new Animated.Value(1)).current;
    const toolbarDropdownProgress = useRef(new Animated.Value(0)).current;
    const searchToolbarProgress = useRef(new Animated.Value(0)).current;
    const addHandoffToolbarOpacity = useRef(new Animated.Value(1)).current;
    const searchInputRef = useRef<TextInput>(null);
    const dayDisplayPrepareRef = useRef<((day: string) => void) | null>(null);
    const monthCalendarHeightRef = useRef(0);
    const monthDisplayHeightRef = useRef(0);
    const monthViewTransitionGenerationRef = useRef(0);
    const monthViewTransitionFrameRef = useRef<number | null>(null);
    const monthViewCompletionAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
    const transitionStartedRef = useRef(false);
    const dayTransitionCleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const viewTransitioningRef = useRef(false);
    const quickHandoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const quickMorphPresenterRef = useRef<QuickScheduleMorphPresenter | null>(null);
    const manualMorphPresenterRef = useRef<ScheduleAddMorphPresenter | null>(null);
    const addHandoffPendingRef = useRef(false);
    const addHandoffClosingRef = useRef(false);
    const addHandoffNativeResetRef = useRef(false);
    const handledQaSurfaceRef = useRef<string | null>(null);
    const handledCalendarTransitionQaRef = useRef<string | null>(null);
    const handledFocusRequestRef = useRef<string | null>(null);
    const scheduleLoadSequenceRef = useRef(0);

    const [pendingSelectedDay, setPendingSelectedDay] = useState<string | null>(null);
    const selectedDay = pendingSelectedDay ?? state.selectedDay;
    const [todayKey, setTodayKey] = useState(() => toYmd(new Date()));
    const [visibleMonth, setVisibleMonth] = useState(selectedDay);
    const [fetchVisibleMonth, setFetchVisibleMonth] = useState(selectedDay);
    const scheduleError = useMemo(
        () => state.error ? getErrorMessage(new Error(state.error)) : null,
        [state.error]
    );
    const scheduleFetchRange = useMemo(
        () => getScheduleFetchRange(fetchVisibleMonth, selectedDay, calendarDepth, dayViewMode),
        [calendarDepth, dayViewMode, fetchVisibleMonth, selectedDay]
    );
    const scheduleFetchStartAt = scheduleFetchRange.startAt;
    const scheduleFetchEndAt = scheduleFetchRange.endAt;

    useEffect(() => {
        if (!isFocused || addFormsPrewarmed) return;

        // Pay the form mount/layout cost after the calendar's initial work,
        // not in the frame where an add-menu row is selected.
        const task = InteractionManager.runAfterInteractions(() => {
            setAddFormsPrewarmed(true);
        });
        return () => task.cancel();
    }, [addFormsPrewarmed, isFocused]);

    useEffect(() => {
        if (isYearDepthTransitionActive) return;

        if (calendarDepth === "day") {
            setFetchVisibleMonth(visibleMonth);
            return;
        }

        const timer = setTimeout(() => setFetchVisibleMonth(visibleMonth), 180);
        return () => clearTimeout(timer);
    }, [calendarDepth, isYearDepthTransitionActive, visibleMonth]);

    useEffect(() => {
        if (pendingSelectedDay && state.selectedDay === pendingSelectedDay) {
            setPendingSelectedDay(null);
        }
    }, [pendingSelectedDay, state.selectedDay]);

    const registerDayDisplayPrepare = useCallback((prepare: ((day: string) => void) | null) => {
        dayDisplayPrepareRef.current = prepare;
    }, []);
    const [overviewYear, setOverviewYear] = useState(
        new Date(`${selectedDay}T00:00:00`).getFullYear()
    );
    const visibleYear = new Date(`${visibleMonth}T00:00:00`).getFullYear();
    const isMonthToDayTransition = dayTransitionContext === "monthToDay" && isDayTransitionActive;
    const isDayToMonthTransition = dayTransitionContext === "dayToMonth" && isDayTransitionActive;
    const isYearToMonthTransition =
        yearOverviewVisible && isYearDepthTransitionActive && yearOverviewClosing;
    const isMonthToYearTransition =
        yearOverviewVisible &&
        isYearDepthTransitionActive &&
        !yearOverviewClosing;
    const monthDisplaySelectedDay = isYearToMonthTransition ? visibleMonth : selectedDay;
    const pillTargetDepth: CalendarDepth = isYearToMonthTransition
        ? "month"
        : isMonthToYearTransition
            ? "year"
            : isMonthToDayTransition
                ? "day"
                : isDayToMonthTransition
                    ? "month"
                    : calendarDepth;
    const pillDisplayDay = dayTransitionTargetDay ?? selectedDay;
    const visiblePrimaryLabel = pillTargetDepth === "day"
        ? `${new Date(`${pillDisplayDay}T00:00:00`).getMonth() + 1}월`
        : `${visibleYear}년`;
    const visiblePrimaryLabelWidth = Math.max(
        LIQUID_YEAR_PILL_WIDTH,
        Math.min(
            screenWidth - 172,
            Math.ceil(visiblePrimaryLabel.length * 18) + 48
        )
    );
    const primaryDatePillWidth = pillTargetDepth === "day" && dayViewMode !== "singleDay"
        ? Math.min(224, Math.max(visiblePrimaryLabelWidth, screenWidth - LIQUID_TOOLBAR_ACTIONS_WIDTH - 56))
        : visiblePrimaryLabelWidth;
    const selectedLiquidMode: CalendarViewMode | "day" | "multi" = pillTargetDepth === "day"
        ? dayViewMode === "singleDay"
            ? "day"
            : "multi"
        : calendarViewMode;
    const collapsedLiquidToolbarWidth = pillTargetDepth === "year"
        ? LIQUID_TOOLBAR_SLOT_WIDTH * 2
        : LIQUID_TOOLBAR_ACTIONS_WIDTH;
    const calendarVisualProgress = calendarTransition;
    const calendarContentOpacity = calendarTransition;
    const calendarContentTranslateY = calendarTransition.interpolate({
        inputRange: [0, 1],
        outputRange: [8, 0],
    });
    const calendarContentScale = calendarTransition.interpolate({
        inputRange: [0, 1],
        outputRange: [0.97, 1],
    });
    const calendarIconScale = calendarTransition.interpolate({
        inputRange: [0, 1],
        outputRange: [0.82, 1],
    });
    const monthAgendaPanelKind = getMonthAgendaPanelKind(calendarViewMode);
    const monthAgendaIsOpen = monthAgendaPanelKind !== null;
    const monthAgendaMotionDuration = reduceMotionEnabled
        ? MONTH_AGENDA_MOTION.reduceMotionDurationMs
        : MONTH_AGENDA_MOTION.durationMs;
    const resolveMonthCalendarHeight = useCallback((viewMode: CalendarViewMode) => {
        const fullCalendarHeight = monthDisplayHeightRef.current;
        const targetHeaderOffset = insets.top
            + CALENDAR_TOOLBAR_HEIGHT
            + STICKY_CALENDAR_HEADER_HEIGHT;
        const panelCalendarHeight = getFixedScheduleCalendarHeight({
            viewMode,
            month: monthDisplaySelectedDay,
            firstDay,
            headerOffset: targetHeaderOffset,
        }) ?? fullCalendarHeight;

        return resolveMonthAgendaViewportLayout(viewMode, {
            fullCalendarHeight,
            panelCalendarHeight,
            expandedListTop: insets.top + CALENDAR_TOOLBAR_HEIGHT,
        }).calendarTargetHeight;
    }, [firstDay, insets.top, monthDisplaySelectedDay]);
    const monthAgendaPanelOpacity = monthAgendaProgress.interpolate({
        inputRange: [
            0,
            MONTH_AGENDA_MOTION.fadeInStart,
            MONTH_AGENDA_MOTION.fadeInEnd,
            1,
        ],
        outputRange: [0, 0, 1, 1],
        extrapolate: "clamp",
    });
    const monthAgendaSwapOutgoingOpacity = monthAgendaSwapProgress.interpolate({
        inputRange: [0, 0.48, 1],
        outputRange: [1, 0, 0],
        extrapolate: "clamp",
    });
    const monthAgendaSwapIncomingOpacity = monthAgendaSwapProgress.interpolate({
        inputRange: [0, 0.52, 1],
        outputRange: [0, 0, 1],
        extrapolate: "clamp",
    });
    const monthCalendarAnimatedStyle = useAnimatedStyle(() => {
        const height = monthCalendarAnimatedHeight.value;
        return height > 0 ? { height } : {};
    });
    const monthAgendaSlotAnimatedStyle = useAnimatedStyle(() => {
        const top = monthCalendarAnimatedHeight.value;
        return {
            top: Math.max(0, top),
            opacity: top > 0 ? 1 : 0,
        };
    });
    const monthCalendarTargetLayerStyle = useAnimatedStyle(() => {
        const targetHeight = monthCalendarTargetHeight.value;
        if (targetHeight <= 0) return {};

        return { height: targetHeight };
    });
    const handleMonthDisplayLayout = useCallback((event: LayoutChangeEvent) => {
        const nextHeight = event.nativeEvent.layout.height;
        if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;

        monthDisplayHeightRef.current = nextHeight;
        if (!monthAgendaPanelKind && !isMonthViewTransitionActive) {
            monthCalendarHeightRef.current = nextHeight;
            monthCalendarAnimatedHeight.value = nextHeight;
            monthCalendarTargetHeight.value = nextHeight;
        }
    }, [
        isMonthViewTransitionActive,
        monthAgendaPanelKind,
        monthCalendarAnimatedHeight,
        monthCalendarTargetHeight,
    ]);
    useLayoutEffect(() => {
        if (isMonthViewTransitionActive) return;

        const targetHeight = resolveMonthCalendarHeight(calendarViewMode);
        if (!Number.isFinite(targetHeight) || targetHeight <= 0) return;

        cancelReanimatedAnimation(monthCalendarAnimatedHeight);
        monthCalendarHeightRef.current = targetHeight;
        monthCalendarAnimatedHeight.value = targetHeight;
        monthCalendarTargetHeight.value = targetHeight;
        monthCalendarAnimatedDayHeight.value = CALENDAR_DAY_HEIGHTS[calendarViewMode];
    }, [
        calendarViewMode,
        isMonthViewTransitionActive,
        monthCalendarAnimatedDayHeight,
        monthCalendarAnimatedHeight,
        monthCalendarTargetHeight,
        resolveMonthCalendarHeight,
    ]);
    const yearPillBloomScaleX = yearOverviewProgress.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [1, CALENDAR_PILL_MOTION.bloomScaleX, 1],
    });
    const yearPillBloomScaleY = yearOverviewProgress.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [1, CALENDAR_PILL_MOTION.bloomScaleY, 1],
    });
    const dayPillBloomScaleX = dayTransition.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [1, CALENDAR_PILL_MOTION.bloomScaleX, 1],
    });
    const dayPillBloomScaleY = dayTransition.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [1, CALENDAR_PILL_MOTION.bloomScaleY, 1],
    });
    const primaryPillScaleX = reduceMotionEnabled
        ? 1
        : Animated.multiply(yearPillBloomScaleX, dayPillBloomScaleX);
    const primaryPillScaleY = reduceMotionEnabled
        ? 1
        : Animated.multiply(yearPillBloomScaleY, dayPillBloomScaleY);
    const calendarContentTranslateX = yearOverviewProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, screenWidth],
    });
    const yearOverviewTranslateX = yearOverviewProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [-screenWidth, 0],
    });
    const monthDuringDayTranslateX = dayTransition.interpolate({
        inputRange: [0, 1],
        outputRange: [0, -screenWidth],
    });
    const dayLayerTranslateX = dayTransition.interpolate({
        inputRange: [0, 1],
        outputRange: [screenWidth, 0],
    });
    const monthChromeTranslateX = Animated.add(
        calendarContentTranslateX,
        monthDuringDayTranslateX
    );
    const dropdownMaxWidth = Math.max(0, screenWidth - 32);
    const dropdownWidth = activeToolbarMenu === "add"
        ? Math.min(dropdownMaxWidth, 196)
        : activeToolbarMenu === "view"
            ? Math.min(dropdownMaxWidth, 210)
        : Math.min(dropdownMaxWidth, 224);
    const toolbarDropdownTop = calendarDepth === "day"
        ? insets.top + LIQUID_TOOLBAR_TOP_OFFSET + LIQUID_TOOLBAR_BUTTON_SIZE + 10
        : insets.top + 7;
    const usesLiquidViewModeControl = isLiquidCalendarMenuPrototypeAvailable;
    const addMenuSourceWidth = usesLiquidViewModeControl
        ? LIQUID_TOOLBAR_ADD_DROPDOWN_WIDTH
        : ADD_MENU_SOURCE.fallbackWidth;
    const isDayLayerVisible =
        calendarDepth === "day" ||
        dayLayerMounted ||
        isDayTransitionActive;
    const actionDropdownRight = 16;
    const isSearchToolbarOpen = activeToolbarMenu === "search";
    const searchHeaderTargetWidth = Math.max(
        LIQUID_TOOLBAR_ACTIONS_WIDTH,
        screenWidth - 32
    );
    const liquidPrototypeLayerWidth = isSearchToolbarOpen
        ? searchHeaderTargetWidth
        : LIQUID_TOOLBAR_NATIVE_CANVAS_WIDTH;
    // Keep the native host pre-sized so opening the + menu never waits for a
    // Fabric height commit. Its UIKit pointInside/hitTest implementation limits
    // the idle hit target to the visible 44pt pill, so the transparent canvas
    // does not block the calendar below it.
    const liquidPrototypeLayerHeight = LIQUID_TOOLBAR_CONTROL_CANVAS_HEIGHT;
    const requestCloseLiquidPrototype = useCallback(() => {
        if (!usesLiquidViewModeControl) return;
        // The host stays pre-sized; this request only resets SwiftUI content.
        setPrototypeCloseRequest((value) => value + 1);
    }, [usesLiquidViewModeControl]);
    const clearQuickHandoffTimer = useCallback(() => {
        if (quickHandoffTimerRef.current) {
            clearTimeout(quickHandoffTimerRef.current);
            quickHandoffTimerRef.current = null;
        }
    }, []);
    const restoreToolbarAfterHandoff = useCallback(() => {
        addHandoffToolbarOpacity.stopAnimation();
        addHandoffToolbarOpacity.setValue(1);
        setQuickHandoffHidden(false);
    }, [addHandoffToolbarOpacity]);
    const prepareAddHandoff = useCallback(() => {
        clearQuickHandoffTimer();
        addHandoffPendingRef.current = usesLiquidViewModeControl;
        addHandoffClosingRef.current = false;
        addHandoffNativeResetRef.current = false;
        addHandoffToolbarOpacity.stopAnimation();
        addHandoffToolbarOpacity.setValue(1);
    }, [
        addHandoffToolbarOpacity,
        clearQuickHandoffTimer,
        usesLiquidViewModeControl,
    ]);

    const commitAddHandoffPresentation = useCallback((kind: "quick" | "manual") => {
        if (!addHandoffPendingRef.current || addHandoffClosingRef.current) return;

        // The modal is already composed and its UI-thread animation has been
        // queued. Commit React visibility while geometry is still stationary
        // in the ownership crossfade, never near the final scale frames.
        unstable_batchedUpdates(() => {
            setQuickHandoffHidden(true);
            if (kind === "quick") {
                setQuickModalVisible(true);
            } else {
                setFormInitialValues(null);
                setModalVisible(true);
            }
        });
    }, []);

    const handleAddModalMorphReady = useCallback(() => {
        if (
            !usesLiquidViewModeControl ||
            !addHandoffPendingRef.current ||
            addHandoffClosingRef.current
        ) {
            return;
        }

        clearQuickHandoffTimer();
        addHandoffToolbarOpacity.stopAnimation();
        Animated.timing(addHandoffToolbarOpacity, {
            toValue: ADD_HANDOFF_MOTION.toolbarParkedOpacity,
            duration: ADD_HANDOFF_MOTION.ownershipCrossfadeMs,
            easing: Easing.linear,
            useNativeDriver: true,
        }).start();

        quickHandoffTimerRef.current = setTimeout(() => {
            quickHandoffTimerRef.current = null;
            if (addHandoffClosingRef.current || !addHandoffPendingRef.current) return;

            // Reset the hidden SwiftUI tree only after ownership, geometry,
            // and a short compositor settle interval have all completed.
            addHandoffNativeResetRef.current = true;
            requestCloseLiquidPrototype();
        }, Math.max(
            ADD_HANDOFF_MOTION.ownershipCrossfadeMs,
            ADD_HANDOFF_MOTION.quickOpenMs,
            ADD_HANDOFF_MOTION.manualOpenMs
        )
            + ADD_HANDOFF_MOTION.nativeResetSettleMs);
    }, [
        addHandoffToolbarOpacity,
        clearQuickHandoffTimer,
        requestCloseLiquidPrototype,
        usesLiquidViewModeControl,
    ]);

    const handleQuickModalCloseStart = useCallback(() => {
        addHandoffClosingRef.current = true;
        clearQuickHandoffTimer();

        if (
            usesLiquidViewModeControl
            && addHandoffPendingRef.current
            && !addHandoffNativeResetRef.current
        ) {
            // If close happens before the post-open idle reset, collapse the
            // hidden SwiftUI host once. Avoiding a duplicate request here
            // keeps the close animation free of a parent React commit.
            addHandoffNativeResetRef.current = true;
            requestCloseLiquidPrototype();
        }

        if (!usesLiquidViewModeControl || !addHandoffPendingRef.current) {
            restoreToolbarAfterHandoff();
            return;
        }

        // Commit the hidden native pill before motion starts, then schedule its
        // complete fade on the native Animated clock. A JS timeout here used
        // to insert a late React commit into the final close frames.
        addHandoffToolbarOpacity.stopAnimation();
        addHandoffToolbarOpacity.setValue(ADD_HANDOFF_MOTION.toolbarParkedOpacity);
        Animated.timing(addHandoffToolbarOpacity, {
            toValue: 1,
            delay: ADD_HANDOFF_MOTION.toolbarReturnDelayMs,
            duration: ADD_HANDOFF_MOTION.toolbarReturnDurationMs,
            easing: Easing.linear,
            useNativeDriver: true,
        }).start();
    }, [
        addHandoffToolbarOpacity,
        clearQuickHandoffTimer,
        requestCloseLiquidPrototype,
        restoreToolbarAfterHandoff,
        usesLiquidViewModeControl,
    ]);
    const handleQuickModalClosed = useCallback(() => {
        clearQuickHandoffTimer();
        addHandoffPendingRef.current = false;
        addHandoffClosingRef.current = false;
        addHandoffNativeResetRef.current = false;
        restoreToolbarAfterHandoff();
        setQuickModalVisible(false);
    }, [clearQuickHandoffTimer, restoreToolbarAfterHandoff]);
    const handleScheduleModalClosed = useCallback(() => {
        clearQuickHandoffTimer();
        addHandoffPendingRef.current = false;
        addHandoffClosingRef.current = false;
        addHandoffNativeResetRef.current = false;
        restoreToolbarAfterHandoff();
        setModalVisible(false);
    }, [clearQuickHandoffTimer, restoreToolbarAfterHandoff]);

    useEffect(() => {
        if (!shouldRestoreAddHandoffToolbar({
            isFocused,
            modalVisible,
            quickModalVisible,
            handoffPending: addHandoffPendingRef.current,
            handoffClosing: addHandoffClosingRef.current,
            liquidMenuOpen: liquidPrototypeOpen,
        })) return;

        // The add-card handoff deliberately fades the native action pill out.
        // Reconcile the idle screen explicitly so an interrupted close,
        // navigation, or Fast Refresh can never leave all three actions hidden.
        clearQuickHandoffTimer();
        addHandoffPendingRef.current = false;
        addHandoffClosingRef.current = false;
        restoreToolbarAfterHandoff();
    }, [
        clearQuickHandoffTimer,
        isFocused,
        liquidPrototypeOpen,
        modalVisible,
        quickModalVisible,
        restoreToolbarAfterHandoff,
    ]);

    useEffect(() => () => {
        clearQuickHandoffTimer();
        addHandoffPendingRef.current = false;
        addHandoffClosingRef.current = false;
        addHandoffToolbarOpacity.stopAnimation();
        // Animated values survive Fast Refresh. Reset the visibility invariant
        // in cleanup instead of preserving a handoff's transient zero opacity.
        addHandoffToolbarOpacity.setValue(1);
    }, [addHandoffToolbarOpacity, clearQuickHandoffTimer]);
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
    const isStickyCalendarMode =
        calendarViewMode === "compact" ||
        calendarViewMode === "stack" ||
        calendarViewMode === "detail" ||
        calendarViewMode === "list";
    const nonSearchToolbarMenuActive =
        activeToolbarMenu !== null && activeToolbarMenu !== "search";
    const isFormOverlayVisible = modalVisible || quickModalVisible;
    const reservesStickyCalendarHeader =
        isStickyCalendarMode &&
        (calendarDepth !== "day" || isMonthToDayTransition || isDayToMonthTransition) &&
        (!keyboardVisible || isFormOverlayVisible);
    const isEnteringMonthCalendarFromExpandedList =
        isMonthViewTransitionActive &&
        calendarViewMode !== "list" &&
        (
            outgoingMonthAgendaPanelKind === "list" ||
            (!monthAgendaIsOpen && retainedMonthAgendaPanelKind === "list")
        );
    const showsStickyCalendarHeader =
        reservesStickyCalendarHeader &&
        (calendarViewMode !== "list" || isMonthViewTransitionActive) &&
        !nonSearchToolbarMenuActive &&
        (!yearOverviewVisible || yearOverviewClosing || isMonthToYearTransition);
    const stickyCalendarHeaderOpacity =
        isMonthViewTransitionActive && calendarViewMode === "list"
            ? monthCalendarTransitionProgress.interpolate({
                inputRange: [0, 0.65, 1],
                outputRange: [1, 0, 0],
                extrapolate: "clamp",
            })
            : isEnteringMonthCalendarFromExpandedList
                ? monthCalendarTransitionProgress.interpolate({
                    inputRange: [0, 0.25, 1],
                    outputRange: [0, 0, 1],
                    extrapolate: "clamp",
                })
                : 1;
    const calendarHeaderOffset = useMemo(
        () => insets.top
            + CALENDAR_TOOLBAR_HEIGHT
            + (reservesStickyCalendarHeader ? STICKY_CALENDAR_HEADER_HEIGHT : 0),
        [insets.top, reservesStickyCalendarHeader]
    );
    const stickyMonthTitle = `${Number(visibleMonth.slice(5, 7))}월`;
    const stickyMonthColorStyle = { color: colors.textPrimary };
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
    const isAnyDepthTransitionActive =
        isDayTransitionActive ||
        isYearDepthTransitionActive ||
        isMonthViewTransitionActive;

    useEffect(() => {
        return () => {
            clearQuickHandoffTimer();
            if (dayTransitionCleanupTimerRef.current) {
                clearTimeout(dayTransitionCleanupTimerRef.current);
            }
            monthViewTransitionGenerationRef.current += 1;
            if (monthViewTransitionFrameRef.current !== null) {
                cancelAnimationFrame(monthViewTransitionFrameRef.current);
                monthViewTransitionFrameRef.current = null;
            }
            monthViewCompletionAnimationRef.current?.stop();
            monthViewCompletionAnimationRef.current = null;
            cancelReanimatedAnimation(monthCalendarAnimatedHeight);
            cancelReanimatedAnimation(monthCalendarAnimatedDayHeight);
            monthAgendaProgress.stopAnimation();
            monthAgendaSwapProgress.stopAnimation();
            monthCalendarTransitionProgress.stopAnimation();
        };
    }, [
        clearQuickHandoffTimer,
        monthAgendaProgress,
        monthAgendaSwapProgress,
        monthCalendarAnimatedDayHeight,
        monthCalendarAnimatedHeight,
        monthCalendarTransitionProgress,
    ]);

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
        let mounted = true;

        AccessibilityInfo.isReduceMotionEnabled()
            .then((enabled) => {
                if (mounted) setReduceMotionEnabled(enabled);
            })
            .catch(() => {});

        const subscription = AccessibilityInfo.addEventListener?.(
            "reduceMotionChanged",
            setReduceMotionEnabled
        );

        return () => {
            mounted = false;
            subscription?.remove?.();
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

    useEffect(() => {
        let minuteTimer: ReturnType<typeof setInterval> | null = null;
        let alignmentTimer: ReturnType<typeof setTimeout> | null = null;
        const refreshToday = () => setTodayKey(toYmd(new Date()));
        const alignToNextMinute = () => {
            const delay = 60_000 - (Date.now() % 60_000) + 24;
            alignmentTimer = setTimeout(() => {
                refreshToday();
                minuteTimer = setInterval(refreshToday, 60_000);
            }, delay);
        };

        alignToNextMinute();
        const appStateSubscription = AppState.addEventListener("change", (nextState) => {
            if (nextState !== "active") return;
            refreshToday();
            if (minuteTimer) clearInterval(minuteTimer);
            if (alignmentTimer) clearTimeout(alignmentTimer);
            alignToNextMinute();
        });

        return () => {
            if (minuteTimer) clearInterval(minuteTimer);
            if (alignmentTimer) clearTimeout(alignmentTimer);
            appStateSubscription.remove();
        };
    }, []);

    const loadSchedules = useCallback(async () => {
        const requestSequence = scheduleLoadSequenceRef.current + 1;
        scheduleLoadSequenceRef.current = requestSequence;
        dispatch({ type: "SET_LOADING", loading: true });
        dispatch({ type: "SET_ERROR", error: null });

        try {
            const items = await getCalendarSchedules(scheduleFetchStartAt, scheduleFetchEndAt);
            if (requestSequence !== scheduleLoadSequenceRef.current) return;
            dispatch({ type: "SET_ITEMS", items });
        } catch (error) {
            if (requestSequence !== scheduleLoadSequenceRef.current) return;
            const message = getErrorMessage(error);
            dispatch({ type: "SET_ERROR", error: message });
            if (!__DEV__ && isFocused && !isMorphQaSurface) {
                Alert.alert("일정 조회 실패", message);
            }
        } finally {
            if (requestSequence === scheduleLoadSequenceRef.current) {
                dispatch({ type: "SET_LOADING", loading: false });
            }
        }
    }, [dispatch, isFocused, isMorphQaSurface, scheduleFetchEndAt, scheduleFetchStartAt]);

    useEffect(() => {
        loadSchedules();
    }, [loadSchedules]);

    const loadShareAttention = useCallback(async () => {
        const [inbox, seenKeys] = await Promise.all([
            getShareInbox(),
            readSeenShareAttentionKeys(),
        ]);

        return buildShareAttentionSummary(inbox, seenKeys);
    }, []);

    useEffect(() => {
        if (!isFocused) return;

        let cancelled = false;

        const refresh = () => {
            loadShareAttention()
                .then((summary) => {
                    if (!cancelled) setShareAttention(summary);
                })
                .catch(() => {
                    // 공유함 알림 표시는 보조 신호라 실패해도 일정 화면 사용 흐름은 유지한다.
                });
        };

        refresh();
        const timer = setInterval(refresh, SHARE_ATTENTION_REFRESH_MS);

        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [isFocused, loadShareAttention]);

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

    const qaMonthItems = useMemo(
        () => isMonthCalendarQaSurface ? createQaMonthScheduleItems() : null,
        [isMonthCalendarQaSurface]
    );
    const itemsArray = useMemo(
        () => qaMonthItems ?? Object.values(state.itemsById),
        [qaMonthItems, state.itemsById]
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
        if (!__DEV__) return;
        if (!qaSurface) {
            handledQaSurfaceRef.current = null;
            return;
        }

        if (
            isQuickMorphQaSurface ||
            isManualMorphQaSurface ||
            isPillCycleQaSurface
        ) {
            return;
        }

        const qaKey = `${qaSurface}:${qaRun ?? ""}`;
        if (handledQaSurfaceRef.current === qaKey) return;
        handledQaSurfaceRef.current = qaKey;

        if (isMonthCalendarQaSurface) {
            setActiveToolbarMenu(null);
            if (usesLiquidViewModeControl) {
                setPrototypeCloseRequest((request) => request + 1);
            }
            setCalendarDepth("month");
            setDayLayerMounted(false);
            setYearOverviewVisible(false);
            setCalendarViewMode(qaSurface === "month-stack" ? "stack" : "compact");
            setCalendarScrollRequest((request) => request + 1);
            return;
        }

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
        isManualMorphQaSurface,
        isMonthCalendarQaSurface,
        isPillCycleQaSurface,
        isQuickMorphQaSurface,
        openToolbarMenu,
        qaInitialValues,
        qaRun,
        qaSurface,
        usesLiquidViewModeControl,
    ]);

    const openBlankSchedule = useCallback(() => {
        prepareAddHandoff();
        if (usesLiquidViewModeControl) {
            const startedPrewarmedMorph = manualMorphPresenterRef.current?.() ?? false;
            if (startedPrewarmedMorph) {
                commitAddHandoffPresentation("manual");
                return;
            }

            setQuickHandoffHidden(true);
            setFormInitialValues(null);
            setModalVisible(true);
            return;
        }

        runToolbarAction(() => {
            setFormInitialValues(null);
            setModalVisible(true);
        });
    }, [commitAddHandoffPresentation, prepareAddHandoff, runToolbarAction, usesLiquidViewModeControl]);

    const openQuickSchedule = useCallback(() => {
        prepareAddHandoff();
        if (usesLiquidViewModeControl) {
            const startedPrewarmedMorph = quickMorphPresenterRef.current?.() ?? false;
            if (startedPrewarmedMorph) {
                commitAddHandoffPresentation("quick");
                return;
            }

            setQuickHandoffHidden(true);
            setQuickModalVisible(true);
            return;
        }

        runToolbarAction(() => {
            setQuickModalVisible(true);
        });
    }, [commitAddHandoffPresentation, prepareAddHandoff, runToolbarAction, usesLiquidViewModeControl]);

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
        // Do not benchmark the handoff while the calendar is committing its
        // initial schedule payload or while either destination is still being
        // mounted. Those unrelated commits previously landed mid-morph.
        if (state.loading || !addFormsPrewarmed) return;

        const qaKey = `${qaSurface}:${qaRun ?? ""}`;
        if (handledQaSurfaceRef.current === qaKey) return;
        handledQaSurfaceRef.current = qaKey;

        setQuickModalVisible(false);
        setModalVisible(false);
        setFormInitialValues(null);
        setQuickHandoffHidden(false);
        setActiveToolbarMenu(null);
        // Quick/manual requests are edge-triggered QA pulses, not cumulative
        // counters. Keeping their idle value at zero prevents Fabric from
        // replaying an old selection when it recreates the native host view.
        setPrototypeQuickAddRequest(0);
        setPrototypeManualAddRequest(0);
        if (usesLiquidViewModeControl) {
            setPrototypeAddMenuRequest((value) => value + 1);
            let actionResetTimer: ReturnType<typeof setTimeout> | null = null;
            const timer = setTimeout(() => {
                if (isQuickMorphQaSurface) {
                    setPrototypeQuickAddRequest(1);
                    actionResetTimer = setTimeout(() => {
                        actionResetTimer = null;
                        setPrototypeQuickAddRequest(0);
                    }, Math.max(
                        ADD_HANDOFF_MOTION.ownershipCrossfadeMs,
                        ADD_HANDOFF_MOTION.quickOpenMs
                    )
                        + ADD_HANDOFF_MOTION.nativeResetSettleMs
                        + 80);
                    return;
                }

                setPrototypeManualAddRequest(1);
                actionResetTimer = setTimeout(() => {
                    actionResetTimer = null;
                    setPrototypeManualAddRequest(0);
                }, Math.max(
                    ADD_HANDOFF_MOTION.ownershipCrossfadeMs,
                    ADD_HANDOFF_MOTION.manualOpenMs
                )
                    + ADD_HANDOFF_MOTION.nativeResetSettleMs
                    + 80);
            }, LIQUID_TOOLBAR_QA_ACTION_DELAY_MS);
            return () => {
                clearTimeout(timer);
                if (actionResetTimer !== null) {
                    clearTimeout(actionResetTimer);
                }
                setPrototypeQuickAddRequest(0);
                setPrototypeManualAddRequest(0);
            };
        } else {
            openToolbarMenu("add");
        }

        const timer = setTimeout(() => {
            if (isQuickMorphQaSurface) {
                openQuickSchedule();
                return;
            }

            openBlankSchedule();
        }, LIQUID_TOOLBAR_QA_ACTION_DELAY_MS);

        return () => clearTimeout(timer);
    }, [
        isManualMorphQaSurface,
        isPillCycleQaSurface,
        isQuickMorphQaSurface,
        addFormsPrewarmed,
        openToolbarMenu,
        openBlankSchedule,
        openQuickSchedule,
        qaRun,
        qaSurface,
        state.loading,
        usesLiquidViewModeControl,
    ]);

    useEffect(() => {
        if (!__DEV__ || !isPillCycleQaSurface || !usesLiquidViewModeControl) return;

        const qaKey = `${qaSurface}:${qaRun ?? ""}`;
        if (handledQaSurfaceRef.current === qaKey) return;
        handledQaSurfaceRef.current = qaKey;

        setQuickModalVisible(false);
        setModalVisible(false);
        setFormInitialValues(null);
        setQuickHandoffHidden(false);
        setActiveToolbarMenu(null);
        setSearchQuery("");

        const timers: ReturnType<typeof setTimeout>[] = [];
        const enqueue = (delayMs: number, action: () => void) => {
            timers.push(setTimeout(action, delayMs));
        };

        enqueue(900, () => setPrototypeTapRequest((value) => value + 1));
        enqueue(1700, () => setPrototypeCloseRequest((value) => value + 1));
        enqueue(2500, () => setPrototypeSearchRequest((value) => value + 1));
        enqueue(3300, () => setPrototypeCloseRequest((value) => value + 1));
        enqueue(4100, () => setPrototypeAddMenuRequest((value) => value + 1));
        enqueue(4900, () => setPrototypeCloseRequest((value) => value + 1));

        return () => {
            timers.forEach(clearTimeout);
        };
    }, [
        isPillCycleQaSurface,
        qaRun,
        qaSurface,
        usesLiquidViewModeControl,
    ]);

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
        setTransitionMonthKey(null);
        if (month.slice(0, 7) !== todayKey.slice(0, 7)) {
            setTodayButtonPrimed(false);
        }
    }, [todayKey]);

    const selectCalendarDay = useCallback((day: string) => {
        setPendingSelectedDay(day);
        dispatch({ type: "SET_SELECTED_DAY", day });
        setVisibleMonth(day);
        setTransitionMonthKey(null);
        setTodayButtonPrimed(day === todayKey);
    }, [dispatch, todayKey]);

    const handleSelectDay = useCallback((day: string) => {
        selectCalendarDay(day);
    }, [selectCalendarDay]);

    const animateDayTransition = useCallback((
        toValue: number,
        afterAnimation?: () => void,
        context: DayTransitionContext = "monthToDay"
    ) => {
        let didFinish = false;
        const finishTransition = (finished: boolean, forceValue = false) => {
            if (didFinish) return;
            didFinish = true;
            if (dayTransitionCleanupTimerRef.current) {
                clearTimeout(dayTransitionCleanupTimerRef.current);
                dayTransitionCleanupTimerRef.current = null;
            }
            if (forceValue) {
                dayTransition.stopAnimation();
                dayTransition.setValue(toValue);
            }
            setIsDayTransitionActive(false);
            setDayTransitionContext("idle");
            transitionStartedRef.current = false;
            if (finished || forceValue) {
                afterAnimation?.();
            }
        };

        dayTransition.stopAnimation();
        setIsDayTransitionActive(true);
        setDayTransitionContext(context);

        const transitionDuration = reduceMotionEnabled
            ? CALENDAR_DEPTH_MOTION.reduceMotionDurationMs
            : CALENDAR_DEPTH_MOTION.depthSlideDurationMs;
        dayTransitionCleanupTimerRef.current = setTimeout(() => {
            finishTransition(true, true);
        }, transitionDuration + 140);

        Animated.timing(dayTransition, {
            toValue,
            duration: transitionDuration,
            easing: reduceMotionEnabled ? Easing.out(Easing.cubic) : CALENDAR_DEPTH_EASING,
            useNativeDriver: true,
            isInteraction: false,
        }).start(({ finished }) => finishTransition(finished));
    }, [dayTransition, reduceMotionEnabled]);

    const animateYearDepthTransition = useCallback((
        toValue: number,
        afterAnimation?: () => void
    ) => {
        let didFinish = false;
        const finishTransition = (finished: boolean, forceValue = false) => {
            if (didFinish) return;
            didFinish = true;
            if (dayTransitionCleanupTimerRef.current) {
                clearTimeout(dayTransitionCleanupTimerRef.current);
                dayTransitionCleanupTimerRef.current = null;
            }
            if (forceValue) {
                yearOverviewProgress.stopAnimation();
                yearOverviewProgress.setValue(toValue);
            }
            setIsYearDepthTransitionActive(false);
            transitionStartedRef.current = false;
            if (finished || forceValue) {
                afterAnimation?.();
            }
        };

        const duration = reduceMotionEnabled
            ? CALENDAR_DEPTH_MOTION.reduceMotionDurationMs
            : CALENDAR_DEPTH_MOTION.depthSlideDurationMs;
        dayTransitionCleanupTimerRef.current = setTimeout(() => {
            finishTransition(true, true);
        }, duration + 140);

        yearOverviewProgress.stopAnimation();
        Animated.timing(yearOverviewProgress, {
            toValue,
            duration,
            easing: reduceMotionEnabled ? Easing.out(Easing.cubic) : CALENDAR_DEPTH_EASING,
            useNativeDriver: true,
            isInteraction: false,
        }).start(({ finished }) => finishTransition(finished));
    }, [reduceMotionEnabled, yearOverviewProgress]);

    const animateDayModeTransition = useCallback((afterAnimation?: () => void) => {
        dayModeTransition.stopAnimation();
        dayModeTransition.setValue(0);

        Animated.timing(dayModeTransition, {
            toValue: 1,
            duration: reduceMotionEnabled
                ? CALENDAR_DEPTH_MOTION.reduceMotionDurationMs
                : CALENDAR_DEPTH_MOTION.modeChangeDurationMs,
            easing: reduceMotionEnabled ? Easing.out(Easing.cubic) : DAY_NAVIGATION_EASING,
            useNativeDriver: true,
            isInteraction: false,
        }).start(({ finished }) => {
            if (finished) afterAnimation?.();
        });
    }, [dayModeTransition, reduceMotionEnabled]);

    const handleSelectDayFromDayDisplay = useCallback((day: string) => {
        setDayTransitionTargetDay(null);
        selectCalendarDay(day);
        setDayLayerMounted(true);
        dayTransition.setValue(1);

        if (dayViewMode !== "singleDay") {
            closeToolbarMenu();
            setDayModeTransitionFrom(dayViewMode);
            setDayViewMode("singleDay");
            animateDayModeTransition(() => setDayModeTransitionFrom(null));
        }
    }, [
        animateDayModeTransition,
        closeToolbarMenu,
        dayTransition,
        dayViewMode,
        selectCalendarDay,
    ]);

    const handleShiftDay = useCallback((offset: number) => {
        const nextDay = addDaysToYmd(selectedDay, offset);
        setDayTransitionTargetDay(null);
        selectCalendarDay(nextDay);
        setDayLayerMounted(true);
        setCalendarDepth("day");
        dayTransition.setValue(1);
    }, [
        dayTransition,
        selectedDay,
        selectCalendarDay,
    ]);

    const handleNavigateTodayFromDayDisplay = useCallback((day: string) => {
        setDayTransitionTargetDay(null);
        selectCalendarDay(day);
        setDayLayerMounted(true);
        setCalendarDepth("day");
        dayTransition.setValue(1);
    }, [dayTransition, selectCalendarDay]);

    const handleOpenDay = useCallback((day: string) => {
        if (
            isDayTransitionActive ||
            isYearDepthTransitionActive ||
            transitionStartedRef.current ||
            viewTransitioningRef.current
        ) return;
        transitionStartedRef.current = true;

        closeToolbarMenu();
        calendarTransition.stopAnimation();
        calendarTransition.setValue(1);
        dayTransition.stopAnimation();
        dayTransition.setValue(0);
        setDayTransitionTargetDay(day);
        dayDisplayPrepareRef.current?.(day);
        setTodayButtonPrimed(day === todayKey);
        setTransitionMonthKey(
            day.slice(0, 7) === selectedDay.slice(0, 7)
                ? null
                : day.slice(0, 7)
        );
        yearOverviewProgress.stopAnimation();
        yearOverviewProgress.setValue(0);
        setYearOverviewVisible(false);
        setYearOverviewClosing(false);
        setDayLayerMounted(true);
        setDayViewMode("singleDay");
        setDayModeTransitionFrom(null);
        dayModeTransition.setValue(1);
        setDayTransitionContext("monthToDay");
        setIsDayTransitionActive(true);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                animateDayTransition(1, () => {
                    setPendingSelectedDay(day);
                    dispatch({ type: "SET_SELECTED_DAY", day });
                    setVisibleMonth(day);
                    setCalendarDepth("day");
                    setDayTransitionTargetDay(null);
                    setTransitionMonthKey(null);
                }, "monthToDay");
            });
        });
    }, [
        animateDayTransition,
        calendarTransition,
        closeToolbarMenu,
        dayTransition,
        dayModeTransition,
        dispatch,
        isDayTransitionActive,
        isYearDepthTransitionActive,
        selectedDay,
        todayKey,
        yearOverviewProgress,
    ]);

    const closeDayDisplay = useCallback(() => {
        if (calendarDepth !== "day" && !dayLayerMounted) return;
        if (isDayTransitionActive || isYearDepthTransitionActive || transitionStartedRef.current) return;
        transitionStartedRef.current = true;

        closeToolbarMenu();
        setDayTransitionTargetDay(selectedDay);
        setDayModeTransitionFrom(null);
        setTransitionMonthKey(null);
        setDayTransitionContext("dayToMonth");
        setIsDayTransitionActive(true);
        requestAnimationFrame(() => {
            animateDayTransition(0, () => {
                setCalendarDepth("month");
                setDayLayerMounted(false);
                setDayTransitionTargetDay(null);
                setTransitionMonthKey(null);
            }, "dayToMonth");
        });
    }, [
        animateDayTransition,
        calendarDepth,
        closeToolbarMenu,
        dayLayerMounted,
        isDayTransitionActive,
        isYearDepthTransitionActive,
        selectedDay,
    ]);

    const focusTodayOnCalendar = useCallback((options?: { revealImmediately?: boolean }) => {
        closeToolbarMenu();
        setPendingSelectedDay(todayKey);
        dispatch({ type: "SET_SELECTED_DAY", day: todayKey });
        if (!isContinuousMonthViewMode(calendarViewMode)) {
            setVisibleMonth(todayKey);
        }
        setCalendarScrollRequest((request) => request + 1);
        setTodayButtonPrimed(true);
        if (options?.revealImmediately !== false) {
            calendarTransition.setValue(1);
        }
    }, [calendarTransition, calendarViewMode, closeToolbarMenu, dispatch, todayKey]);

    useEffect(() => {
        const focusKey = `${focusRequest ?? ""}:${focusDayRequest ?? ""}:${focusRun ?? ""}`;
        if (handledFocusRequestRef.current === focusKey) return;

        if (focusRequest === "today") {
            handledFocusRequestRef.current = focusKey;
            transitionStartedRef.current = false;
            yearOverviewProgress.stopAnimation();
            yearOverviewProgress.setValue(0);
            setYearOverviewVisible(false);
            setYearOverviewClosing(false);
            focusTodayOnCalendar();
            return;
        }

        if (focusRequest === "day" && focusDayRequest) {
            handledFocusRequestRef.current = focusKey;
            setTransitionMonthKey(focusDayRequest.slice(0, 7));
            handleOpenDay(focusDayRequest);
            calendarTransition.setValue(1);
            return;
        }

        if (focusRequest === "month" && focusDayRequest) {
            handledFocusRequestRef.current = focusKey;
            closeToolbarMenu();
            dayTransition.stopAnimation();
            yearOverviewProgress.stopAnimation();
            transitionStartedRef.current = false;
            setIsDayTransitionActive(false);
            setIsYearDepthTransitionActive(false);
            setDayTransitionContext("idle");
            setYearOverviewVisible(false);
            setYearOverviewClosing(false);
            setPendingSelectedDay(focusDayRequest);
            setDayTransitionTargetDay(null);
            dispatch({ type: "SET_SELECTED_DAY", day: focusDayRequest });
            setVisibleMonth(focusDayRequest);
            setCalendarScrollRequest((request) => request + 1);
            setTodayButtonPrimed(focusDayRequest === todayKey);
            setDayLayerMounted(false);
            setCalendarDepth("month");
            dayTransition.setValue(0);
            yearOverviewProgress.setValue(0);
            calendarTransition.setValue(1);
        }
    }, [
        calendarTransition,
        closeToolbarMenu,
        dayTransition,
        dispatch,
        focusDayRequest,
        focusRequest,
        focusRun,
        focusTodayOnCalendar,
        handleOpenDay,
        todayKey,
        yearOverviewProgress,
    ]);

    const handleGoToday = useCallback(() => {
        if (yearOverviewVisible) {
            closeToolbarMenu();
            selectCalendarDay(todayKey);
            setCalendarDepth("year");
            setYearTodayRequest((request) => request + 1);
            return;
        }

        if (calendarDepth === "day") {
            closeToolbarMenu();
            dayTransition.setValue(1);
            setDayTodayRequest((request) => request + 1);
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
        calendarDepth,
        closeToolbarMenu,
        dayTransition,
        focusTodayOnCalendar,
        handleOpenDay,
        selectCalendarDay,
        selectedDay,
        todayButtonPrimed,
        todayKey,
        visibleMonth,
        yearOverviewVisible,
    ]);

    const handleCalendarViewModeChange = useCallback((nextMode: CalendarViewMode) => {
        if (nextMode === calendarViewMode || viewTransitioningRef.current) return;

        closeToolbarMenu();
        viewTransitioningRef.current = true;
        const transitionGeneration = monthViewTransitionGenerationRef.current + 1;
        monthViewTransitionGenerationRef.current = transitionGeneration;
        if (monthViewTransitionFrameRef.current !== null) {
            cancelAnimationFrame(monthViewTransitionFrameRef.current);
            monthViewTransitionFrameRef.current = null;
        }
        monthViewCompletionAnimationRef.current?.stop();
        monthViewCompletionAnimationRef.current = null;
        const agendaTransition = getMonthAgendaTransition(calendarViewMode, nextMode);
        const nextAgendaPanelKind = getMonthAgendaPanelKind(nextMode);
        const targetAgendaProgress = nextAgendaPanelKind ? 1 : 0;
        const sourceHeight = monthCalendarHeightRef.current
            || resolveMonthCalendarHeight(calendarViewMode)
            || monthDisplayHeightRef.current;
        const targetCalendarHeight = resolveMonthCalendarHeight(nextMode) || sourceHeight;
        const motionEasing = reduceMotionEnabled
            ? Easing.out(Easing.cubic)
            : CALENDAR_DEPTH_EASING;
        const layoutEasing = reduceMotionEnabled
            ? ReanimatedEasing.out(ReanimatedEasing.cubic)
            : ReanimatedEasing.bezier(...MONTH_AGENDA_MOTION.bezier);

        calendarTransition.stopAnimation();
        calendarTransition.setValue(1);
        cancelReanimatedAnimation(monthCalendarAnimatedHeight);
        monthCalendarAnimatedHeight.value = sourceHeight;
        monthCalendarTargetHeight.value = targetCalendarHeight;
        cancelReanimatedAnimation(monthCalendarAnimatedDayHeight);
        monthCalendarAnimatedDayHeight.value = CALENDAR_DAY_HEIGHTS[calendarViewMode];
        monthCalendarTransitionProgress.stopAnimation();
        monthCalendarTransitionProgress.setValue(0);
        monthAgendaProgress.stopAnimation();
        monthAgendaSwapProgress.stopAnimation();
        if (agendaTransition === "enter" || agendaTransition === "exit") {
            monthAgendaProgress.setValue(agendaTransition === "exit" ? 1 : 0);
            monthAgendaSwapProgress.setValue(1);
        } else if (agendaTransition === "swap") {
            monthAgendaProgress.setValue(1);
            monthAgendaSwapProgress.setValue(0);
        } else {
            monthAgendaSwapProgress.setValue(1);
        }

        unstable_batchedUpdates(() => {
            setIsMonthViewTransitionActive(true);
            setOutgoingMonthAgendaPanelKind(
                agendaTransition === "swap" ? monthAgendaPanelKind : null
            );
            if (nextAgendaPanelKind) {
                setRetainedMonthAgendaPanelKind(nextAgendaPanelKind);
            }
            setCalendarViewMode(nextMode);
        });

        monthViewTransitionFrameRef.current = requestAnimationFrame(() => {
            monthViewTransitionFrameRef.current = null;
            if (transitionGeneration !== monthViewTransitionGenerationRef.current) return;

            monthCalendarTargetHeight.value = targetCalendarHeight;
            monthCalendarAnimatedHeight.value = withTiming(targetCalendarHeight, {
                duration: monthAgendaMotionDuration,
                easing: layoutEasing,
                reduceMotion: ReduceMotion.Never,
            });
            monthCalendarAnimatedDayHeight.value = withTiming(
                CALENDAR_DAY_HEIGHTS[nextMode],
                {
                    duration: monthAgendaMotionDuration,
                    easing: layoutEasing,
                    reduceMotion: ReduceMotion.Never,
                }
            );
            const animations: Animated.CompositeAnimation[] = [
                Animated.timing(monthCalendarTransitionProgress, {
                    toValue: 1,
                    duration: monthAgendaMotionDuration,
                    easing: motionEasing,
                    useNativeDriver: true,
                    isInteraction: false,
                }),
            ];

            if (agendaTransition === "enter" || agendaTransition === "exit") {
                animations.push(Animated.timing(monthAgendaProgress, {
                    toValue: targetAgendaProgress,
                    duration: monthAgendaMotionDuration,
                    easing: motionEasing,
                    useNativeDriver: true,
                    isInteraction: false,
                }));
            } else if (agendaTransition === "swap") {
                animations.push(Animated.timing(monthAgendaSwapProgress, {
                    toValue: 1,
                    duration: monthAgendaMotionDuration,
                    easing: motionEasing,
                    useNativeDriver: true,
                    isInteraction: false,
                }));
            }

            const completionAnimation = Animated.parallel(animations);
            monthViewCompletionAnimationRef.current = completionAnimation;
            completionAnimation.start(({ finished }) => {
                if (
                    !finished ||
                    transitionGeneration !== monthViewTransitionGenerationRef.current
                ) {
                    return;
                }

                monthViewCompletionAnimationRef.current = null;
                cancelReanimatedAnimation(monthCalendarAnimatedHeight);
                monthCalendarAnimatedHeight.value = targetCalendarHeight;
                monthCalendarTargetHeight.value = targetCalendarHeight;
                cancelReanimatedAnimation(monthCalendarAnimatedDayHeight);
                monthCalendarAnimatedDayHeight.value = CALENDAR_DAY_HEIGHTS[nextMode];
                monthCalendarHeightRef.current = targetCalendarHeight;
                monthCalendarTransitionProgress.setValue(1);
                monthAgendaProgress.setValue(targetAgendaProgress);
                monthAgendaSwapProgress.setValue(1);
                setOutgoingMonthAgendaPanelKind(null);
                setIsMonthViewTransitionActive(false);
                viewTransitioningRef.current = false;
            });
        });
    }, [
        calendarTransition,
        calendarViewMode,
        closeToolbarMenu,
        monthAgendaMotionDuration,
        monthAgendaPanelKind,
        monthAgendaProgress,
        monthAgendaSwapProgress,
        monthCalendarAnimatedDayHeight,
        monthCalendarAnimatedHeight,
        monthCalendarTargetHeight,
        monthCalendarTransitionProgress,
        reduceMotionEnabled,
        resolveMonthCalendarHeight,
    ]);

    const handleDayViewMenuSelect = useCallback((target: "day" | "multi") => {
        if (calendarDepth !== "day") return;

        const nextMode: DayViewMode = target === "day"
            ? "singleDay"
            : "multiDay";

        if (nextMode === dayViewMode) {
            closeToolbarMenu();
            return;
        }
        if (isDayTransitionActive) {
            return;
        }

        closeToolbarMenu();
        requestAnimationFrame(() => {
            unstable_batchedUpdates(() => {
                setDayLayerMounted(true);
                setDayModeTransitionFrom(dayViewMode);
                setDayViewMode(nextMode);
            });
            dayTransition.setValue(1);
            animateDayModeTransition(() => setDayModeTransitionFrom(null));
        });
    }, [animateDayModeTransition, calendarDepth, closeToolbarMenu, dayTransition, dayViewMode, isDayTransitionActive]);

    const runYearToMonthTransition = useCallback((year: number, month: number) => {
        if (isYearDepthTransitionActive || isDayTransitionActive || transitionStartedRef.current) return;
        transitionStartedRef.current = true;
        const monthKey = `${year}-${String(month).padStart(2, "0")}`;
        const currentDay = Number(selectedDay.slice(8, 10)) || 1;
        const targetDay = Math.min(currentDay, new Date(year, month, 0).getDate());
        const targetSelection = `${monthKey}-${String(targetDay).padStart(2, "0")}`;
        const monthTransition = `month-${monthKey}`;
        closeToolbarMenu();
        dayTransition.stopAnimation();
        yearOverviewProgress.stopAnimation();
        calendarTransition.stopAnimation();
        dayTransition.setValue(0);
        yearOverviewProgress.setValue(1);
        calendarTransition.setValue(1);
        setDayTransitionContext("yearToMonth");
        setVisibleMonth(targetSelection);
        setTransitionMonthKey(monthTransition);
        setDayModeTransitionFrom(null);
        setDayLayerMounted(false);
        setTodayButtonPrimed(targetSelection === todayKey);
        setYearOverviewClosing(true);
        setIsYearDepthTransitionActive(true);

        requestAnimationFrame(() => {
            animateYearDepthTransition(0, () => {
                setCalendarDepth("month");
                yearOverviewProgress.setValue(0);
                calendarTransition.setValue(1);
                setOverviewYear(year);
                setTransitionMonthKey(null);
                setYearOverviewVisible(false);
                setYearOverviewClosing(false);
                setDayTransitionContext("idle");
                setPendingSelectedDay(targetSelection);
                dispatch({ type: "SET_SELECTED_DAY", day: targetSelection });
            });
        });
    }, [
        animateYearDepthTransition,
        calendarTransition,
        closeToolbarMenu,
        dayTransition,
        dispatch,
        isDayTransitionActive,
        isYearDepthTransitionActive,
        selectedDay,
        todayKey,
        yearOverviewProgress,
    ]);

    const closeYearOverview = useCallback(() => {
        if (!yearOverviewVisible) return;

        const focusedMonth = new Date(`${visibleMonth.slice(0, 7)}-01T00:00:00`);
        runYearToMonthTransition(focusedMonth.getFullYear(), focusedMonth.getMonth() + 1);
    }, [runYearToMonthTransition, visibleMonth, yearOverviewVisible]);

    const openYearOverview = useCallback(() => {
        if (calendarDepth === "day") {
            closeDayDisplay();
            return;
        }

        if (yearOverviewVisible && !yearOverviewClosing) {
            closeYearOverview();
            return;
        }
        if (
            isYearDepthTransitionActive ||
            isDayTransitionActive ||
            transitionStartedRef.current ||
            viewTransitioningRef.current
        ) return;
        transitionStartedRef.current = true;

        closeToolbarMenu();
        setTransitionMonthKey(null);
        setOverviewYear(visibleYear);
        setYearOverviewClosing(false);
        setYearOverviewVisible(true);
        setIsYearDepthTransitionActive(true);
        setDayTransitionContext("idle");
        calendarTransition.stopAnimation();
        yearOverviewProgress.setValue(0);
        calendarTransition.setValue(1);

        requestAnimationFrame(() => {
            animateYearDepthTransition(1, () => {
                setCalendarDepth("year");
            });
        });
    }, [
        animateYearDepthTransition,
        calendarTransition,
        calendarDepth,
        closeToolbarMenu,
        closeDayDisplay,
        closeYearOverview,
        isDayTransitionActive,
        isYearDepthTransitionActive,
        visibleYear,
        yearOverviewClosing,
        yearOverviewProgress,
        yearOverviewVisible,
    ]);

    const selectOverviewMonth = useCallback((year: number, month: number) => {
        runYearToMonthTransition(year, month);
    }, [runYearToMonthTransition]);

    useEffect(() => {
        if (!__DEV__) return;
        if (
            qaSurface !== "year" &&
            qaSurface !== "year-month-transition" &&
            qaSurface !== "month-year-transition" &&
            qaSurface !== "day-month-transition"
        ) {
            return;
        }

        const qaKey = `${qaSurface}:${qaRun ?? ""}`;
        if (handledCalendarTransitionQaRef.current === qaKey) return;
        handledCalendarTransitionQaRef.current = qaKey;

        if (qaSurface === "year" || qaSurface === "month-year-transition") {
            const timer = setTimeout(() => openYearOverview(), 300);
            return () => clearTimeout(timer);
        }

        if (qaSurface === "day-month-transition") {
            const timer = setTimeout(() => closeDayDisplay(), 300);
            return () => clearTimeout(timer);
        }

        closeToolbarMenu();
        transitionStartedRef.current = false;
        setIsDayTransitionActive(false);
        setIsYearDepthTransitionActive(false);
        setDayTransitionContext("idle");
        setCalendarDepth("year");
        setOverviewYear(visibleYear);
        setYearOverviewClosing(false);
        setYearOverviewVisible(true);
        yearOverviewProgress.setValue(1);
        calendarTransition.setValue(1);

        const timer = setTimeout(() => {
            selectOverviewMonth(visibleYear, 7);
        }, 350);
        return () => clearTimeout(timer);
    }, [
        calendarTransition,
        closeToolbarMenu,
        closeDayDisplay,
        openYearOverview,
        qaRun,
        qaSurface,
        selectOverviewMonth,
        visibleYear,
        yearOverviewProgress,
    ]);

    const handlePrimaryDateButtonPress = useCallback(() => {
        if (calendarDepth === "day") {
            closeDayDisplay();
            return;
        }

        if (calendarDepth === "year") {
            closeYearOverview();
            return;
        }

        openYearOverview();
    }, [calendarDepth, closeDayDisplay, closeYearOverview, openYearOverview]);

    const openProfile = useCallback(() => {
        router.push("/profile");
    }, [router]);

    const bottomLeftActions = useMemo<FloatingBarAction[]>(() => [{
            key: "today",
            label: "오늘",
            accessibilityLabel: "오늘 날짜로 이동",
            onPress: handleGoToday,
        }], [handleGoToday]);

    const openInvitesShortcut = useCallback(() => {
        router.push({ pathname: "/share/inbox", params: { tab: "all" } });
    }, [router]);

    const shareBadgeCount = shareAttention.unseenCount;

    const bottomRightActions = useMemo<FloatingBarAction[]>(() => [{
        key: "share-inbox-shortcut",
        icon: "mail-unread-outline",
        badgeCount: shareBadgeCount,
        emphasized: shareBadgeCount > 0,
        accessibilityLabel: shareBadgeCount > 0
            ? `공유함, 새 공유 또는 초대 ${shareBadgeCount}개`
            : "공유함",
        onPress: openInvitesShortcut,
    }, {
        key: "profile-shortcut",
        icon: "person-circle-outline",
        accessibilityLabel: "프로필",
        onPress: openProfile,
    }], [openInvitesShortcut, openProfile, shareBadgeCount]);

    const renderMonthAgendaPanelContent = (panelKind: MonthAgendaPanelKind) => (
        panelKind === "detail" ? (
            <SelectedDayAgendaPanel
                selectedDay={monthDisplaySelectedDay}
                items={itemsArray}
                loading={state.loading}
                error={sanitizeCalendarTransitionError(scheduleError)}
                bottomInset={insets.bottom}
                onPressRetry={loadSchedules}
                onOpenSchedule={(id) => router.push({
                    pathname: "/schedule/[id]",
                    params: { id },
                })}
                onRequestViewMode={handleCalendarViewModeChange}
            />
        ) : (
            <MonthAgendaList
                visibleMonth={visibleMonth}
                items={itemsArray}
                loading={state.loading}
                error={sanitizeCalendarTransitionError(scheduleError)}
                bottomInset={insets.bottom}
                onPressRetry={loadSchedules}
                onOpenSchedule={(id) => router.push({
                    pathname: "/schedule/[id]",
                    params: { id },
                })}
                onRequestViewMode={handleCalendarViewModeChange}
            />
        )
    );

    return (
        <View
            style={[styles.root, { backgroundColor: colors.calendarBackground }]}
        >
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />

            <View
                pointerEvents="none"
                style={[
                    styles.bottomMaterialLayer,
                    mode === "dark" ? styles.bottomMaterialLayerDark : styles.bottomMaterialLayerLight,
                ]}
            />

            <View
                pointerEvents={isAnyDepthTransitionActive ? "none" : "box-none"}
                style={styles.toolbarLayer}
            >
                {(activeToolbarMenu !== null || toolbarMenuClosing || liquidPrototypeOpen) && (
                    <Pressable
                        style={[
                            styles.toolbarDropdownBackdrop,
                            liquidPrototypeOpen && styles.liquidToolbarBackdrop,
                        ]}
                        onPress={() => {
                            closeToolbarMenu();
                            if (liquidPrototypeOpen) requestCloseLiquidPrototype();
                        }}
                    />
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
                            <Animated.View
                                style={[
                                    styles.yearGlassMotion,
                                    {
                                        width: primaryDatePillWidth,
                                        transform: [
                                            { scaleX: primaryPillScaleX },
                                            { scaleY: primaryPillScaleY },
                                        ],
                                    },
                                ]}
                            >
                                {isLiquidGlassIconButtonAvailable ? (
                                    <Pressable
                                        onPress={handlePrimaryDateButtonPress}
                                        accessibilityLabel={pillTargetDepth === "day" ? "월 화면으로 돌아가기" : `${visibleYear}년 전체 월 보기`}
                                        accessibilityRole="button"
                                        style={({ pressed }) => [
                                            styles.yearGlass,
                                            {
                                                width: primaryDatePillWidth,
                                                opacity: pressed ? 0.68 : 1,
                                                transform: [{ scale: pressed ? 0.96 : 1 }],
                                            },
                                        ]}
                                    >
                                        <LiquidGlassIconButton
                                            pointerEvents="none"
                                            leadingSymbolName="chevron.left"
                                            label={visiblePrimaryLabel}
                                            buttonWidth={primaryDatePillWidth}
                                            buttonHeight={LIQUID_TOOLBAR_BUTTON_SIZE}
                                            colorScheme={mode === "dark" ? "dark" : "light"}
                                            accessibilityLabel={pillTargetDepth === "day" ? "월 화면으로 돌아가기" : `${visibleYear}년 전체 월 보기`}
                                            style={StyleSheet.absoluteFill}
                                        />
                                    </Pressable>
                                ) : (
                                    <Pressable
                                        onPress={handlePrimaryDateButtonPress}
                                        accessibilityLabel={pillTargetDepth === "day" ? "월 화면으로 돌아가기" : `${visibleYear}년 전체 월 보기`}
                                        accessibilityRole="button"
                                        style={({ pressed }) => [
                                            styles.yearGlass,
                                            {
                                                width: primaryDatePillWidth,
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
                                                {visiblePrimaryLabel}
                                            </Text>
                                        </View>
                                    </Pressable>
                                )}
                            </Animated.View>

                            <View pointerEvents="none" style={styles.toolbarActionsPlaceholder} />
                        </View>

                    </Animated.View>
                )}

                {usesLiquidViewModeControl ? (
                    <Animated.View
                        pointerEvents={shouldHideHandoffSurface ? "none" : "box-none"}
                        style={[
                            styles.liquidViewModeControl,
                            {
                                top: insets.top + LIQUID_TOOLBAR_TOP_OFFSET,
                                right: ADD_MENU_SOURCE.nativeRightInset,
                                width: liquidPrototypeLayerWidth,
                                height: liquidPrototypeLayerHeight,
                                opacity: addHandoffToolbarOpacity,
                            },
                        ]}
                    >
                        <LiquidCalendarMenuPrototype
                            style={StyleSheet.absoluteFill}
                            selectedMode={selectedLiquidMode}
                            viewModeVariant={pillTargetDepth === "day" ? "timeline" : "calendar"}
                            showsViewModeButton={pillTargetDepth !== "year"}
                            colorScheme={mode === "dark" ? "dark" : "light"}
                            tapRequest={prototypeTapRequest}
                            closeRequest={prototypeCloseRequest}
                            addMenuRequest={prototypeAddMenuRequest}
                            searchRequest={prototypeSearchRequest}
                            quickAddRequest={prototypeQuickAddRequest}
                            manualAddRequest={prototypeManualAddRequest}
                            searchExpandedWidth={searchHeaderTargetWidth}
                            searchQuery={searchQuery}
                            onSelect={(mode) => {
                                if (pillTargetDepth === "day") {
                                    if (mode === "day") {
                                        handleDayViewMenuSelect("day");
                                        return;
                                    }

                                    if (mode === "multi") {
                                        handleDayViewMenuSelect("multi");
                                        return;
                                    }

                                    // Block stale native timeline events from falling
                                    // through to the month-only calendar view modes.
                                    return;
                                }

                                if (isCalendarViewMode(mode)) {
                                    handleCalendarViewModeChange(mode);
                                    return;
                                }

                                if (mode === "day") {
                                    handleOpenDay(selectedDay);
                                    return;
                                }

                                if (mode === "multi") {
                                    closeDayDisplay();
                                    handleCalendarViewModeChange("week");
                                }
                            }}
                            onOpenChange={setLiquidPrototypeOpen}
                            onSearch={openSearchToolbar}
                            onSearchTextChange={setSearchQuery}
                            onSearchClose={closeSearchToolbar}
                            onQuickAdd={openQuickSchedule}
                            onManualAdd={openBlankSchedule}
                            onManageCategories={openCategoryManager}
                        />
                    </Animated.View>
                ) : (
                    <Animated.View
                        pointerEvents={shouldHideHandoffSurface ? "none" : "box-none"}
                        style={[
                            styles.scheduleActionPillLayer,
                            {
                                top: insets.top + LIQUID_TOOLBAR_TOP_OFFSET,
                                right: ADD_MENU_SOURCE.fallbackRightInset,
                                width: searchHeaderWidth,
                                opacity: addHandoffToolbarOpacity,
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
                                {pillTargetDepth !== "year" && (
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
                                                opacity: calendarVisualProgress,
                                                transform: [{ scale: calendarIconScale }],
                                            }}
                                        >
                                            {pillTargetDepth === "day" ? (
                                                <Ionicons name="calendar-outline" size={25} color={colors.textPrimary} />
                                            ) : (
                                                <CalendarViewModeGlyph
                                                    mode={calendarViewMode}
                                                    color={colors.textPrimary}
                                                    size={27}
                                                    toolbar
                                                />
                                            )}
                                        </Animated.View>
                                    </Pressable>
                                )}

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
                    <Animated.View
                        pointerEvents="none"
                        style={[
                            styles.stickyCalendarHeader,
                            stickyCalendarHeaderPosition,
                            {
                                opacity: stickyCalendarHeaderOpacity,
                                transform: [{ translateX: monthChromeTranslateX }],
                            },
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
                    </Animated.View>
                )}

                {!usesLiquidViewModeControl && activeToolbarMenu === "view" && (
                    <Animated.View
                        pointerEvents="box-none"
                        style={[
                            styles.toolbarDropdown,
                            styles.toolbarDropdownPosition,
                            {
                                top: toolbarDropdownTop,
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
                                    {calendarDepth === "day" ? (
                                        <View style={styles.dayViewModeMenu}>
                                            {[
                                                {
                                                    key: "day" as const,
                                                    icon: "calendar-outline" as const,
                                                    label: "일간",
                                                    selected: dayViewMode === "singleDay",
                                                },
                                                {
                                                    key: "multi" as const,
                                                    icon: "calendar-number-outline" as const,
                                                    label: "여러 날",
                                                    selected: dayViewMode === "multiDay",
                                                },
                                            ].map((option, index) => (
                                                <React.Fragment key={option.key}>
                                                    <Pressable
                                                        accessibilityRole="button"
                                                        accessibilityLabel={`${option.label} 보기`}
                                                        accessibilityState={{ selected: option.selected }}
                                                        onPress={() => handleDayViewMenuSelect(option.key)}
                                                        style={({ pressed }) => [
                                                            styles.viewModeRow,
                                                            option.selected && (
                                                                mode === "dark"
                                                                    ? styles.viewModeSelectedPillDark
                                                                    : styles.viewModeSelectedPillLight
                                                            ),
                                                            {
                                                                opacity: pressed ? 0.62 : 1,
                                                                transform: [{ scale: pressed ? 0.98 : 1 }],
                                                            },
                                                        ]}
                                                    >
                                                        <View style={styles.dayViewModeIconSlot}>
                                                            <Ionicons
                                                                name={option.icon}
                                                                size={22}
                                                                color={option.selected ? colors.textPrimary : colors.textSecondary}
                                                            />
                                                        </View>
                                                        <Text
                                                            style={[
                                                                styles.dropdownTitle,
                                                                {
                                                                    color: option.selected
                                                                        ? colors.textPrimary
                                                                        : colors.textSecondary,
                                                                },
                                                            ]}
                                                        >
                                                            {option.label}
                                                        </Text>
                                                    </Pressable>
                                                    {index < 1 && (
                                                        <View style={[styles.dropdownRowDivider, styles.viewDropdownDivider, { backgroundColor: colors.border }]} />
                                                    )}
                                                </React.Fragment>
                                            ))}
                                        </View>
                                    ) : (
                                        <View style={styles.viewModeIconGrid}>
                                        {CALENDAR_VIEW_OPTIONS.map((option) => {
                                            const selected = option.value === calendarViewMode;

                                            return (
                                                <Pressable
                                                    key={option.value}
                                                    accessibilityRole="button"
                                                    accessibilityLabel={`${option.label} 보기`}
                                                    accessibilityState={{ selected }}
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
                                                        color={selected ? colors.textPrimary : colors.textSecondary}
                                                        size={25}
                                                    />
                                                </Pressable>
                                            );
                                        })}
                                        </View>
                                    )}
                                </View>
                            </CalendarGlassSurface>
                        </View>
                    </Animated.View>
                )}

                {!usesLiquidViewModeControl && activeToolbarMenu === "add" && (
                    <Animated.View
                        pointerEvents="box-none"
                        style={[
                            styles.toolbarDropdown,
                            styles.toolbarDropdownPosition,
                            {
                                top: toolbarDropdownTop,
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
                        opacity: calendarContentOpacity,
                        transform: [
                            { translateX: calendarContentTranslateX },
                            { translateY: calendarContentTranslateY },
                            { scale: calendarContentScale },
                        ],
                    },
                ]}
            >
                <View style={styles.displayStack}>
                    <Animated.View
                        pointerEvents={
                            !isAnyDepthTransitionActive &&
                            calendarDepth === "month" &&
                            !yearOverviewVisible
                                ? "auto"
                                : "none"
                        }
                        accessibilityElementsHidden={
                            calendarDepth !== "month" ||
                            isAnyDepthTransitionActive ||
                            yearOverviewVisible
                        }
                        importantForAccessibility={
                            calendarDepth === "month" &&
                            !isAnyDepthTransitionActive &&
                            !yearOverviewVisible
                                ? "auto"
                                : "no-hide-descendants"
                        }
                        style={[
                            styles.monthDisplayLayer,
                            {
                                backgroundColor: colors.calendarBackground,
                                transform: [{ translateX: monthDuringDayTranslateX }],
                            },
                        ]}
                        onLayout={handleMonthDisplayLayout}
                    >
                        <Reanimated.View
                            collapsable={false}
                            style={[
                                styles.monthCalendarFrame,
                                monthCalendarAnimatedStyle,
                            ]}
                        >
                            <Reanimated.View
                                style={[
                                    styles.monthCalendarIncomingLayer,
                                    monthCalendarTargetLayerStyle,
                                ]}
                            >
                                <View
                                    style={[
                                        monthAgendaIsOpen
                                            ? styles.monthCalendarLayerContentCompact
                                            : styles.monthCalendarLayerContentFull,
                                    ]}
                                >
                                    <CalendarWrapper
                                        selectedDay={monthDisplaySelectedDay}
                                        focusedMonth={visibleMonth}
                                        items={itemsArray}
                                        onSelectDay={handleSelectDay}
                                        onOpenDay={handleOpenDay}
                                        viewMode={calendarViewMode}
                                        firstDay={firstDay}
                                        scrollRequest={calendarScrollRequest}
                                        onVisibleMonthChange={handleVisibleMonthChange}
                                        headerOffset={calendarHeaderOffset}
                                        transitionMonthKey={transitionMonthKey ?? undefined}
                                        transitionActive={isAnyDepthTransitionActive}
                                        transitionContext={dayTransitionContext}
                                        animatedDayHeight={monthCalendarAnimatedDayHeight}
                                    />
                                </View>
                            </Reanimated.View>
                        </Reanimated.View>

                        <Reanimated.View
                            collapsable={false}
                            style={[
                                styles.monthAgendaSlot,
                                monthAgendaSlotAnimatedStyle,
                            ]}
                        >
                            <Animated.View
                                pointerEvents={
                                    monthAgendaIsOpen && !isMonthViewTransitionActive
                                        ? "auto"
                                        : "none"
                                }
                                accessibilityElementsHidden={
                                    !monthAgendaIsOpen || isMonthViewTransitionActive
                                }
                                importantForAccessibility={
                                    monthAgendaIsOpen && !isMonthViewTransitionActive
                                        ? "auto"
                                        : "no-hide-descendants"
                                }
                                style={[
                                    styles.monthAgendaMotion,
                                    { opacity: monthAgendaPanelOpacity },
                                ]}
                            >
                                {outgoingMonthAgendaPanelKind && (
                                    <Animated.View
                                        pointerEvents="none"
                                        style={[
                                            styles.monthAgendaSwapLayer,
                                            { opacity: monthAgendaSwapOutgoingOpacity },
                                        ]}
                                    >
                                        {renderMonthAgendaPanelContent(outgoingMonthAgendaPanelKind)}
                                    </Animated.View>
                                )}
                                <Animated.View
                                    style={[
                                        styles.monthAgendaCurrentLayer,
                                        outgoingMonthAgendaPanelKind
                                            ? { opacity: monthAgendaSwapIncomingOpacity }
                                            : null,
                                    ]}
                                >
                                    {renderMonthAgendaPanelContent(retainedMonthAgendaPanelKind)}
                                </Animated.View>
                            </Animated.View>
                        </Reanimated.View>
                    </Animated.View>

                    {isDayLayerVisible && (
                        <Animated.View
                            pointerEvents={!isAnyDepthTransitionActive && calendarDepth === "day" ? "auto" : "none"}
                            accessibilityElementsHidden={calendarDepth !== "day" || isAnyDepthTransitionActive}
                            importantForAccessibility={
                                calendarDepth === "day" && !isAnyDepthTransitionActive
                                    ? "auto"
                                    : "no-hide-descendants"
                            }
                            style={[
                                styles.dayDisplayLayer,
                                {
                                    backgroundColor: colors.calendarBackground,
                                    transform: [{ translateX: dayLayerTranslateX }],
                                },
                            ]}
                        >
                            <DayDisplay
                                selectedDay={dayTransitionTargetDay ?? selectedDay}
                                dayViewMode={dayViewMode}
                                todayKey={todayKey}
                                items={itemsArray}
                                loading={state.loading}
                                error={sanitizeCalendarTransitionError(scheduleError)}
                                topOffset={insets.top + DAY_WEEK_STRIP_TOP_OFFSET}
                                bottomInset={insets.bottom}
                                modeTransitionProgress={dayModeTransition}
                                modeTransitionFrom={dayModeTransitionFrom}
                                transitionActive={isDayTransitionActive}
                                todayRequest={dayTodayRequest}
                                reduceMotionEnabled={reduceMotionEnabled}
                                onPrepareDayReady={registerDayDisplayPrepare}
                                onSelectDay={handleSelectDayFromDayDisplay}
                                onNavigateToday={handleNavigateTodayFromDayDisplay}
                                onShiftDay={handleShiftDay}
                                onPressRetry={loadSchedules}
                                onOpenSchedule={(id) => router.push({
                                    pathname: "/schedule/[id]",
                                    params: { id },
                                })}
                            />
                        </Animated.View>
                    )}
                </View>
            </Animated.View>

            <Animated.View
                pointerEvents={yearOverviewVisible && !isAnyDepthTransitionActive ? "auto" : "none"}
                importantForAccessibility={yearOverviewVisible ? "auto" : "no-hide-descendants"}
                style={[
                    styles.yearOverviewLayer,
                    {
                        opacity: yearOverviewVisible ? 1 : 0,
                        backgroundColor: colors.calendarBackground,
                        transform: [{ translateX: yearOverviewTranslateX }],
                    },
                ]}
            >
                <CalendarYearOverviewModal
                    visible={yearOverviewVisible}
                    year={overviewYear}
                    selectedDay={selectedDay}
                    firstDay={firstDay}
                    topInset={insets.top}
                    todayRequest={yearTodayRequest}
                    reduceMotionEnabled={reduceMotionEnabled}
                    onSelectMonth={selectOverviewMonth}
                />
            </Animated.View>

            {!bottomBarHidden && (
                <GlobalFloatingActionBar
                    leftActions={bottomLeftActions}
                    rightActions={bottomRightActions}
                    bottomInset={insets.bottom}
                    disabled={isAnyDepthTransitionActive}
                />
            )}

            <QuickScheduleModal
                visible={quickModalVisible}
                prewarm={addFormsPrewarmed}
                morphPresenterRef={quickMorphPresenterRef}
                onClose={handleQuickModalClosed}
                onCloseStart={handleQuickModalCloseStart}
                onAnalyze={handleQuickAnalyze}
                onSave={addItem}
                defaultDay={selectedDay}
                defaultCategory={state.categories[0]}
                sourceTopOffset={LIQUID_TOOLBAR_TOP_OFFSET}
                sourceWidth={addMenuSourceWidth}
                sourceHeight={LIQUID_TOOLBAR_ADD_DROPDOWN_HEIGHT}
                closeTargetWidth={collapsedLiquidToolbarWidth}
                sourceRightOffset={usesLiquidViewModeControl
                    ? ADD_MENU_SOURCE.nativeRightInset
                    : ADD_MENU_SOURCE.fallbackRightInset}
                onMorphReady={handleAddModalMorphReady}
                qaAutoCloseAfterMs={qaSurface === "quick-add-morph-close" ? 2400 : undefined}
            />

            <ScheduleNewModal
                visible={modalVisible}
                prewarm={addFormsPrewarmed}
                morphPresenterRef={manualMorphPresenterRef}
                onClose={handleScheduleModalClosed}
                onCloseStart={handleQuickModalCloseStart}
                onSubmit={addItem}
                categories={state.categories}
                defaultDay={selectedDay}
                initialValues={formInitialValues}
                onManageCategories={openCategoryManager}
                autoFocusTitle={qaSurface === "event-create-keyboard"}
                presentation={usesLiquidViewModeControl && !isDirectCreateQaSurface ? "morph" : "sheet"}
                sourceTopOffset={LIQUID_TOOLBAR_TOP_OFFSET}
                sourceWidth={addMenuSourceWidth}
                sourceHeight={LIQUID_TOOLBAR_ADD_DROPDOWN_HEIGHT}
                closeTargetWidth={collapsedLiquidToolbarWidth}
                sourceRightOffset={usesLiquidViewModeControl
                    ? ADD_MENU_SOURCE.nativeRightInset
                    : ADD_MENU_SOURCE.fallbackRightInset}
                onMorphReady={handleAddModalMorphReady}
                qaAutoCloseAfterMs={qaSurface === "manual-add-morph-close" ? 2600 : undefined}
            />

        </View>
    );
}

type DayPanelNavigation = {
    fromDay: string;
    targetDay: string;
    direction: 1 | -1;
    outgoingPanel: React.ReactNode;
};

type DayNavigationOptions = {
    commitDay?: (day: string) => void;
    prepareIncoming?: () => void;
};

type QueuedDayNavigation = {
    day: string;
    options: DayNavigationOptions;
};

type StartDayNavigation = (
    day: string,
    fromDay?: string,
    initialProgress?: number,
    options?: DayNavigationOptions
) => void;

function DayDisplay({
    selectedDay: selectedDayProp,
    dayViewMode,
    todayKey,
    items,
    loading,
    error,
    topOffset,
    bottomInset,
    modeTransitionProgress,
    modeTransitionFrom,
    transitionActive,
    todayRequest,
    reduceMotionEnabled,
    onPrepareDayReady,
    onSelectDay,
    onNavigateToday,
    onShiftDay,
    onPressRetry,
    onOpenSchedule,
}: {
    selectedDay: string;
    dayViewMode: DayViewMode;
    todayKey: string;
    items: ScheduleItem[];
    loading: boolean;
    error: string | null;
    topOffset: number;
    bottomInset: number;
    modeTransitionProgress: Animated.Value;
    modeTransitionFrom: DayViewMode | null;
    transitionActive: boolean;
    todayRequest: number;
    reduceMotionEnabled: boolean;
    onPrepareDayReady: (prepare: ((day: string) => void) | null) => void;
    onSelectDay: (day: string) => void;
    onNavigateToday: (day: string) => void;
    onShiftDay: (offset: number) => void;
    onPressRetry: () => void;
    onOpenSchedule: (id: string) => void;
}) {
    const { colors, mode } = useTheme();
    const { width: viewportWidth } = useWindowDimensions();
    const singleDayTimelineRef = useRef<ScrollView>(null);
    const multiDayTimelineRef = useRef<ScrollView>(null);
    const timelineVerticalOffsetRef = useRef<number | null>(null);
    const didPositionSingleTimelineRef = useRef(false);
    const didPositionMultiTimelineRef = useRef(false);
    const daySwipeX = useRef(new Animated.Value(0)).current;
    const daySwipeVisualXRef = useRef(0);
    const dayPagerProgress = useRef(new Animated.Value(0)).current;
    const dayPanelSnapshotRef = useRef<React.ReactNode>(null);
    const dayNavigationActiveRef = useRef(false);
    const dayNavigationTargetRef = useRef<string | null>(null);
    const queuedDayNavigationRef = useRef<QueuedDayNavigation | null>(null);
    const deferredDayNavigationRef = useRef<QueuedDayNavigation | null>(null);
    const modeTransitionActiveRef = useRef(Boolean(modeTransitionFrom));
    const startDayNavigationRef = useRef<StartDayNavigation | null>(null);
    const [dayNavigation, setDayNavigation] = useState<DayPanelNavigation | null>(null);
    const [timelineNow, setTimelineNow] = useState(() => new Date());
    const initialCurrentTimeY = minuteOfDay(timelineNow) / 60 * DAY_TIMELINE_HOUR_HEIGHT;
    const currentTimeY = useRef(new Animated.Value(initialCurrentTimeY)).current;
    const currentTimeTargetYRef = useRef(initialCurrentTimeY);
    const daySwipeSettlingRef = useRef(false);
    const handledTodayRequestRef = useRef(todayRequest);
    const [preparedDay, setPreparedDay] = useState<string | null>(null);
    const selectedDay = transitionActive
        ? preparedDay ?? selectedDayProp
        : selectedDayProp;

    useEffect(() => {
        onPrepareDayReady(setPreparedDay);
        return () => onPrepareDayReady(null);
    }, [onPrepareDayReady]);

    useEffect(() => {
        let minuteTimer: ReturnType<typeof setInterval> | null = null;
        let alignmentTimer: ReturnType<typeof setTimeout> | null = null;
        const refreshNow = () => setTimelineNow(new Date());
        const alignToNextMinute = () => {
            alignmentTimer = setTimeout(() => {
                refreshNow();
                minuteTimer = setInterval(refreshNow, 60_000);
            }, 60_000 - (Date.now() % 60_000) + 24);
        };

        alignToNextMinute();
        const appStateSubscription = AppState.addEventListener("change", (nextState) => {
            if (nextState !== "active") return;
            refreshNow();
            if (minuteTimer) clearInterval(minuteTimer);
            if (alignmentTimer) clearTimeout(alignmentTimer);
            alignToNextMinute();
        });

        return () => {
            if (minuteTimer) clearInterval(minuteTimer);
            if (alignmentTimer) clearTimeout(alignmentTimer);
            appStateSubscription.remove();
        };
    }, []);

    useEffect(() => {
        if (preparedDay && preparedDay === selectedDayProp) {
            setPreparedDay(null);
        }
    }, [preparedDay, selectedDayProp]);

    const weekStart = useMemo(() => startOfWeek(selectedDay), [selectedDay]);
    const weekDays = useMemo(() => createWeekDays(weekStart), [weekStart]);
    const multiDayDays = useMemo(() => createSequentialDays(selectedDay, 2), [selectedDay]);
    const dayItems = useMemo(() => (
        items
            .filter((item) => isOverlappingDay(item.startAt, item.endAt, selectedDay))
            .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    ), [items, selectedDay]);
    const allDayItems = useMemo(() => dayItems.filter((item) => item.allDay), [dayItems]);
    const positionedEvents = useMemo(() => buildPositionedEvents(dayItems, selectedDay), [dayItems, selectedDay]);
    const currentMinute = timelineNow.getHours() * 60 + timelineNow.getMinutes() + timelineNow.getSeconds() / 60;
    const currentTimeLabel = formatCurrentTimeLabel(timelineNow);
    const isSelectedToday = selectedDay === todayKey;
    const accentColor = mode === "dark" ? "#ff453a" : "#ff3b30";
    const multiDayRangeTitle = useMemo(() => formatWeekRangeTitle(multiDayDays), [multiDayDays]);
    const contentTitle = dayViewMode === "singleDay"
        ? formatDayTitle(selectedDay)
        : multiDayRangeTitle;
    const inlineError = sanitizeCalendarTransitionError(error);
    const multiDayColumns = useMemo(() => multiDayDays.map((day) => {
        const columnItems = items
            .filter((item) => isOverlappingDay(item.startAt, item.endAt, day.dateString))
            .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

        return {
            day,
            items: columnItems,
            allDayItems: columnItems.filter((item) => item.allDay),
            positionedEvents: buildPositionedEvents(columnItems, day.dateString, { compact: true }),
        };
    }), [items, multiDayDays]);
    const showsCurrentTimeInTimeline = isSelectedToday || (
        dayViewMode === "multiDay" &&
        multiDayColumns.some((column) => column.day.dateString === todayKey)
    );
    const multiDayItems = useMemo(() => (
        multiDayColumns
            .flatMap((column) => column.items)
            .filter((item, index, array) => array.findIndex((target) => target.id === item.id) === index)
            .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    ), [multiDayColumns]);
    const multiDayAllDayItems = useMemo(
        () => multiDayItems.filter((item) => item.allDay),
        [multiDayItems]
    );
    const isModeTransitionActive = Boolean(modeTransitionFrom);
    modeTransitionActiveRef.current = isModeTransitionActive;
    const stripSelectionOpacity = 1;
    const stripSelectionTranslateY = 0;
    const titleSectionOpacity = 1;
    const timelineSectionOpacity = 1;
    const timelineSectionTranslateY = 0;
    const modeSwitchIncomingOpacity = isModeTransitionActive
        ? modeTransitionProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 1],
            extrapolate: "clamp",
        })
        : 1;
    const modeSwitchIncomingTranslateY = isModeTransitionActive
        ? modeTransitionProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [12, 0],
            extrapolate: "clamp",
        })
        : 0;
    const modeSwitchOutgoingOpacity = isModeTransitionActive
        ? modeTransitionProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 0],
            extrapolate: "clamp",
        })
        : 1;
    const modeSwitchOutgoingTranslateY = isModeTransitionActive
        ? modeTransitionProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, -8],
            extrapolate: "clamp",
        })
        : 0;
    const modeBodyOpacity = modeTransitionProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.98, 1],
        extrapolate: "clamp",
    });
    const modeBodyTranslateY = modeTransitionProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [10, 0],
        extrapolate: "clamp",
    });

    const defaultTimelineOffset = Math.max(
        0,
        (
            isSelectedToday
                ? currentMinute - CURRENT_TIME_MOTION.initialLeadHours * 60
                : 5 * 60
        ) / 60 * DAY_TIMELINE_HOUR_HEIGHT
    );
    const initialTimelineOffset = timelineVerticalOffsetRef.current ?? defaultTimelineOffset;
    if (timelineVerticalOffsetRef.current === null) {
        timelineVerticalOffsetRef.current = initialTimelineOffset;
    }

    useEffect(() => {
        const nextY = currentMinute / 60 * DAY_TIMELINE_HOUR_HEIGHT;
        const previousTargetY = currentTimeTargetYRef.current;
        currentTimeTargetYRef.current = nextY;
        currentTimeY.stopAnimation();

        if (!shouldAnimateCurrentTimeStep(
            previousTargetY,
            nextY,
            DAY_TIMELINE_HOUR_HEIGHT,
            showsCurrentTimeInTimeline,
            reduceMotionEnabled
        )) {
            currentTimeY.setValue(nextY);
            return;
        }

        Animated.timing(currentTimeY, {
            toValue: nextY,
            duration: CURRENT_TIME_MOTION.minuteStepDurationMs,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
            isInteraction: false,
        }).start();
    }, [currentMinute, currentTimeY, reduceMotionEnabled, showsCurrentTimeInTimeline]);

    const scrollTimelineToNow = useCallback((animated = true) => {
        const targetOffset = Math.max(
            0,
            ((currentMinute - CURRENT_TIME_MOTION.todayTargetLeadHours * 60) / 60) * DAY_TIMELINE_HOUR_HEIGHT
        );
        const timeline = dayViewMode === "multiDay"
            ? multiDayTimelineRef.current
            : singleDayTimelineRef.current;

        timeline?.scrollTo({
            y: targetOffset,
            animated: animated && !reduceMotionEnabled,
        });
        if (!animated || reduceMotionEnabled) {
            timelineVerticalOffsetRef.current = targetOffset;
        }
    }, [currentMinute, dayViewMode, reduceMotionEnabled]);

    const handleTimelineScroll = useCallback((event: {
        nativeEvent: { contentOffset: { y: number } };
    }) => {
        timelineVerticalOffsetRef.current = Math.max(0, event.nativeEvent.contentOffset.y);
    }, []);

    const attachSingleDayTimelineRef = useCallback((node: ScrollView | null) => {
        // During a page transition the outgoing and incoming timelines overlap.
        // Keep the newest live node and ignore the outgoing node's detach callback.
        if (node) singleDayTimelineRef.current = node;
    }, []);

    const attachMultiDayTimelineRef = useCallback((node: ScrollView | null) => {
        // The outgoing snapshot and incoming panel temporarily share this ref.
        // Ignore the outgoing panel's detach so Today still reaches the live one.
        if (node) multiDayTimelineRef.current = node;
    }, []);

    const resetDaySwipe = useCallback((currentDx: number) => {
        const width = Math.max(320, viewportWidth);
        const duration = getDayNavigationResetDuration(currentDx, width);

        if (duration === 0) {
            daySwipeX.setValue(0);
            daySwipeVisualXRef.current = 0;
            daySwipeSettlingRef.current = false;
            return;
        }

        daySwipeSettlingRef.current = true;
        daySwipeVisualXRef.current = currentDx;
        daySwipeX.stopAnimation();
        daySwipeX.setValue(currentDx);
        Animated.timing(daySwipeX, {
            toValue: 0,
            duration,
            easing: DAY_NAVIGATION_EASING,
            useNativeDriver: true,
            isInteraction: false,
        }).start(({ finished }) => {
            if (!finished) return;
            daySwipeVisualXRef.current = 0;
            daySwipeSettlingRef.current = false;
        });
    }, [daySwipeX, viewportWidth]);

    const startDayNavigation = useCallback((
        day: string,
        fromDay = selectedDay,
        initialProgress = 0,
        options: DayNavigationOptions = {}
    ) => {
        if (day === fromDay) return;

        const commitDay = options.commitDay ?? onSelectDay;
        const outgoingPanel = dayPanelSnapshotRef.current;
        if (reduceMotionEnabled || !outgoingPanel) {
            queuedDayNavigationRef.current = null;
            dayNavigationActiveRef.current = false;
            dayNavigationTargetRef.current = null;
            daySwipeSettlingRef.current = false;
            daySwipeVisualXRef.current = 0;
            daySwipeX.setValue(0);
            commitDay(day);
            requestAnimationFrame(() => options.prepareIncoming?.());
            return;
        }

        const direction: 1 | -1 = new Date(`${day}T00:00:00`).getTime()
            > new Date(`${fromDay}T00:00:00`).getTime()
            ? 1
            : -1;

        const clampedInitialProgress = Math.max(0, Math.min(1, initialProgress));

        dayNavigationActiveRef.current = true;
        dayNavigationTargetRef.current = day;
        daySwipeSettlingRef.current = true;
        dayPagerProgress.stopAnimation();
        dayPagerProgress.setValue(clampedInitialProgress);

        unstable_batchedUpdates(() => {
            setDayNavigation({
                fromDay,
                targetDay: day,
                direction,
                outgoingPanel,
            });
            // Commit the destination in the same React batch as the pager panels
            // so the incoming day can never flash without its source.
            commitDay(day);
        });

        requestAnimationFrame(() => {
            options.prepareIncoming?.();
            // When a drag hands off to the pager, the outgoing panel already has
            // the same offset through dayPagerProgress. Clearing the gesture value
            // here therefore does not introduce a one-frame jump.
            daySwipeX.setValue(0);
            daySwipeVisualXRef.current = 0;
            Animated.timing(dayPagerProgress, {
                toValue: 1,
                duration: getDayNavigationRemainingDuration(clampedInitialProgress),
                easing: DAY_NAVIGATION_EASING,
                useNativeDriver: true,
                isInteraction: false,
            }).start(({ finished }) => {
                if (!finished) return;
                dayPagerProgress.setValue(1);
                dayNavigationActiveRef.current = false;
                dayNavigationTargetRef.current = null;
                daySwipeSettlingRef.current = false;
                setDayNavigation(null);

                const queuedRequest = queuedDayNavigationRef.current;
                queuedDayNavigationRef.current = null;
                const queuedDay = consumeQueuedDayNavigation(
                    day,
                    queuedRequest?.day ?? null
                );
                if (queuedDay && queuedRequest) {
                    if (modeTransitionActiveRef.current) {
                        deferredDayNavigationRef.current = {
                            day: queuedDay,
                            options: queuedRequest.options,
                        };
                    } else {
                        startDayNavigationRef.current?.(
                            queuedDay,
                            day,
                            0,
                            queuedRequest.options
                        );
                    }
                }
            });
        });
    }, [dayPagerProgress, daySwipeX, onSelectDay, reduceMotionEnabled, selectedDay]);

    startDayNavigationRef.current = startDayNavigation;

    const navigateToDayFromWeekStrip = useCallback((day: string) => {
        if (dayNavigationActiveRef.current) {
            if (day === dayNavigationTargetRef.current) {
                queuedDayNavigationRef.current = null;
                deferredDayNavigationRef.current = null;
                return;
            }

            if (dayViewMode !== "singleDay") {
                queuedDayNavigationRef.current = null;
                deferredDayNavigationRef.current = { day, options: {} };
                return;
            }

            deferredDayNavigationRef.current = null;
            const queuedDay = queueLatestDayNavigation(
                dayNavigationTargetRef.current,
                queuedDayNavigationRef.current?.day ?? null,
                day
            );
            queuedDayNavigationRef.current = queuedDay
                ? { day: queuedDay, options: {} }
                : null;
            return;
        }

        if (day === selectedDay) {
            queuedDayNavigationRef.current = null;
            deferredDayNavigationRef.current = null;
            return;
        }

        if (isModeTransitionActive) {
            queuedDayNavigationRef.current = null;
            deferredDayNavigationRef.current = { day, options: {} };
            return;
        }

        if (dayViewMode !== "singleDay") {
            onSelectDay(day);
            return;
        }

        startDayNavigation(day, selectedDay);
    }, [dayViewMode, isModeTransitionActive, onSelectDay, selectedDay, startDayNavigation]);

    useEffect(() => {
        if (isModeTransitionActive || dayNavigationActiveRef.current) return;

        const deferredRequest = deferredDayNavigationRef.current;
        if (!deferredRequest) return;
        deferredDayNavigationRef.current = null;

        if (deferredRequest.day === selectedDay) {
            requestAnimationFrame(() => deferredRequest.options.prepareIncoming?.());
            return;
        }

        if (dayViewMode !== "singleDay" && !deferredRequest.options.commitDay) {
            onSelectDay(deferredRequest.day);
            return;
        }

        startDayNavigation(
            deferredRequest.day,
            selectedDay,
            0,
            deferredRequest.options
        );
    }, [
        dayNavigation,
        dayViewMode,
        isModeTransitionActive,
        onSelectDay,
        selectedDay,
        startDayNavigation,
    ]);

    const finishDaySwipe = useCallback((direction: 1 | -1, currentDx: number) => {
        const width = Math.max(320, viewportWidth);

        const targetDay = addDaysToYmd(selectedDay, direction);
        startDayNavigation(
            targetDay,
            selectedDay,
            Math.min(1, Math.abs(currentDx) / width),
            dayViewMode === "singleDay"
                ? undefined
                : { commitDay: () => onShiftDay(direction) }
        );
    }, [dayViewMode, onShiftDay, selectedDay, startDayNavigation, viewportWidth]);

    useEffect(() => {
        if (handledTodayRequestRef.current === todayRequest) return;
        handledTodayRequestRef.current = todayRequest;

        const options: DayNavigationOptions = {
            commitDay: onNavigateToday,
            prepareIncoming: () => scrollTimelineToNow(false),
        };

        // The destination is committed at pager start, so selectedDay can
        // already equal today while the motion is still active. Handle the
        // active target first so a final Today press also cancels a stale queue.
        if (dayNavigationActiveRef.current) {
            deferredDayNavigationRef.current = null;
            const queuedDay = queueLatestDayNavigation(
                dayNavigationTargetRef.current,
                queuedDayNavigationRef.current?.day ?? null,
                todayKey
            );
            queuedDayNavigationRef.current = queuedDay
                ? { day: queuedDay, options }
                : null;
            return;
        }

        if (selectedDay === todayKey) {
            requestAnimationFrame(() => scrollTimelineToNow(true));
            return;
        }

        if (isModeTransitionActive) {
            queuedDayNavigationRef.current = null;
            deferredDayNavigationRef.current = { day: todayKey, options };
            return;
        }

        if (reduceMotionEnabled) {
            onNavigateToday(todayKey);
            requestAnimationFrame(() => scrollTimelineToNow(false));
            return;
        }

        startDayNavigation(todayKey, selectedDay, 0, options);
    }, [
        isModeTransitionActive,
        onNavigateToday,
        reduceMotionEnabled,
        scrollTimelineToNow,
        selectedDay,
        startDayNavigation,
        todayKey,
        todayRequest,
    ]);

    const timelineSwipeResponder = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => (
            !daySwipeSettlingRef.current &&
            Math.abs(gestureState.dx) > 16 &&
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.15
        ),
        onMoveShouldSetPanResponderCapture: (_, gestureState) => (
            !daySwipeSettlingRef.current &&
            Math.abs(gestureState.dx) > 16 &&
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.15
        ),
        onPanResponderMove: (_, gestureState) => {
            const dx = gestureState.dx;
            const dy = gestureState.dy;

            if (Math.abs(dx) <= Math.abs(dy) * 1.15) return;
            daySwipeVisualXRef.current = dx;
            daySwipeX.setValue(dx);
        },
        onPanResponderRelease: (_, gestureState) => {
            const dx = gestureState.dx;
            const dy = gestureState.dy;
            const projectedX = dx + gestureState.vx * 80;
            const reversesDirection = dx !== 0 && Math.sign(projectedX) !== Math.sign(dx);

            if (
                Math.abs(projectedX) <= 54 ||
                Math.abs(dx) <= Math.abs(dy) * 1.15 ||
                reversesDirection
            ) {
                resetDaySwipe(daySwipeVisualXRef.current);
                return;
            }

            finishDaySwipe(projectedX < 0 ? 1 : -1, dx);
        },
        onPanResponderTerminate: () => resetDaySwipe(daySwipeVisualXRef.current),
    }), [daySwipeX, finishDaySwipe, resetDaySwipe]);

    const singleDayTimeline = useMemo(() => (
        <ScrollView
            ref={attachSingleDayTimelineRef}
            key={`single-day-timeline-${selectedDay}`}
            style={[
                styles.dayTimelineScroll,
                { backgroundColor: colors.calendarBackground },
            ]}
            contentContainerStyle={[
                styles.dayTimelineContent,
                { paddingBottom: Math.max(bottomInset + 146, 162) },
            ]}
            showsVerticalScrollIndicator={false}
            contentOffset={{ x: 0, y: initialTimelineOffset }}
            onScroll={handleTimelineScroll}
            scrollEventThrottle={16}
            onContentSizeChange={() => {
                if (didPositionSingleTimelineRef.current) return;
                didPositionSingleTimelineRef.current = true;
                requestAnimationFrame(() => {
                    singleDayTimelineRef.current?.scrollTo({
                        y: initialTimelineOffset,
                        animated: false,
                    });
                });
            }}
        >
            {loading || inlineError ? (
                <Pressable
                    disabled={!inlineError}
                    onPress={inlineError ? onPressRetry : undefined}
                    style={styles.timelineInlineState}
                >
                    <Text style={[styles.timelineInlineStateText, { color: colors.textSecondary }]}>
                        {loading ? "일정을 불러오는 중이에요" : inlineError}
                    </Text>
                </Pressable>
            ) : null}
            <View style={styles.dayTimelineCanvas}>
                {Array.from({ length: 25 }, (_, hour) => (
                    <View
                        key={hour}
                        style={[
                            styles.dayHourRow,
                            {
                                top: hour * DAY_TIMELINE_HOUR_HEIGHT,
                                borderTopColor: colors.border,
                            },
                        ]}
                    >
                        {hour < 24 && (
                            <Text style={[styles.dayHourText, { color: colors.textSecondary }]}>
                                {formatTimelineHour(hour)}
                            </Text>
                        )}
                    </View>
                ))}

                <View style={styles.dayEventLayer}>
                    {positionedEvents.map(({ item, startMinute, height, lane, laneCount }) => {
                        const top = startMinute / 60 * DAY_TIMELINE_HOUR_HEIGHT;
                        const laneWidth = 100 / laneCount;
                        const laneInset = laneCount > 1 ? 0.5 : 0;

                        return (
                            <DayTimelineEventCard
                                key={item.id}
                                item={item}
                                top={top}
                                height={height}
                                left={`${lane * laneWidth + laneInset}%`}
                                width={`${Math.max(0, laneWidth - laneInset * 2)}%`}
                                laneCount={laneCount}
                                onPress={() => onOpenSchedule(item.id)}
                            />
                        );
                    })}
                </View>

                {isSelectedToday && (
                    <Animated.View
                        pointerEvents="none"
                        style={[
                            styles.dayNowLine,
                            { transform: [{ translateY: currentTimeY }] },
                        ]}
                    >
                        <View style={styles.dayNowTimeGutter}>
                            <View style={[styles.dayNowTimeBadge, { backgroundColor: accentColor }]}>
                                <Text style={styles.dayNowTimeText}>{currentTimeLabel}</Text>
                            </View>
                        </View>
                        <View style={[styles.dayNowRule, { backgroundColor: accentColor }]} />
                    </Animated.View>
                )}
            </View>
        </ScrollView>
    ), [
        colors.border,
        colors.calendarBackground,
        colors.textSecondary,
        accentColor,
        attachSingleDayTimelineRef,
        bottomInset,
        currentTimeLabel,
        currentTimeY,
        handleTimelineScroll,
        isSelectedToday,
        loading,
        inlineError,
        initialTimelineOffset,
        onOpenSchedule,
        onPressRetry,
        positionedEvents,
        selectedDay,
    ]);

    const multiDayTimeline = useMemo(() => (
        <ScrollView
            ref={attachMultiDayTimelineRef}
            style={[
                styles.dayTimelineScroll,
                { backgroundColor: colors.calendarBackground },
            ]}
            contentContainerStyle={[
                styles.dayTimelineContent,
                { paddingBottom: Math.max(bottomInset + 146, 162) },
            ]}
            showsVerticalScrollIndicator={false}
            contentOffset={{ x: 0, y: initialTimelineOffset }}
            onScroll={handleTimelineScroll}
            scrollEventThrottle={16}
            onContentSizeChange={() => {
                if (didPositionMultiTimelineRef.current) return;
                didPositionMultiTimelineRef.current = true;
                requestAnimationFrame(() => {
                    multiDayTimelineRef.current?.scrollTo({
                        y: initialTimelineOffset,
                        animated: false,
                    });
                });
            }}
        >
            {loading || inlineError ? (
                <Pressable
                    disabled={!inlineError}
                    onPress={inlineError ? onPressRetry : undefined}
                    style={styles.timelineInlineState}
                >
                    <Text style={[styles.timelineInlineStateText, { color: colors.textSecondary }]}>
                        {loading ? "일정을 불러오는 중이에요" : inlineError}
                    </Text>
                </Pressable>
            ) : null}
            <View style={styles.multiDayTimelineCanvas}>
                {Array.from({ length: 25 }, (_, hour) => (
                    <View
                        key={hour}
                        style={[
                            styles.dayHourRow,
                            {
                                top: hour * DAY_TIMELINE_HOUR_HEIGHT,
                                borderTopColor: colors.border,
                            },
                        ]}
                    >
                        {hour < 24 && (
                            <Text style={[styles.dayHourText, { color: colors.textSecondary }]}>
                                {formatTimelineHour(hour)}
                            </Text>
                        )}
                    </View>
                ))}
                {multiDayColumns.some((column) => column.day.dateString === todayKey) && (
                    <Animated.View
                        pointerEvents="none"
                        style={[
                            styles.multiDayNowTimeGutter,
                            {
                                transform: [{ translateY: currentTimeY }],
                            },
                        ]}
                    >
                        <View style={[styles.dayNowTimeBadge, { backgroundColor: accentColor }]}>
                            <Text style={styles.dayNowTimeText}>{currentTimeLabel}</Text>
                        </View>
                    </Animated.View>
                )}
                <View style={styles.multiDayColumns}>
                    {multiDayColumns.map((column, columnIndex) => (
                        <View
                            key={column.day.dateString}
                            style={[
                                styles.multiDayColumn,
                                {
                                    borderLeftColor: colors.border,
                                    borderRightWidth: columnIndex === multiDayColumns.length - 1
                                        ? 0
                                        : StyleSheet.hairlineWidth,
                                    borderRightColor: colors.border,
                                },
                            ]}
                        >
                            {column.day.dateString === todayKey && (
                                <Animated.View
                                    pointerEvents="none"
                                    style={[
                                        styles.multiDayNowLine,
                                        { transform: [{ translateY: currentTimeY }] },
                                    ]}
                                >
                                    <View style={[styles.multiDayNowRule, { backgroundColor: accentColor }]} />
                                </Animated.View>
                            )}
                            {column.positionedEvents.map(({ item, startMinute, height, lane, laneCount }) => {
                                const color = item.category?.color ?? "#8e8e93";
                                const top = startMinute / 60 * DAY_TIMELINE_HOUR_HEIGHT;
                                const laneWidth = 100 / laneCount;

                                return (
                                    <Pressable
                                        key={item.id}
                                        onPress={() => onOpenSchedule(item.id)}
                                        style={({ pressed }) => [
                                            styles.multiDayTimelineEvent,
                                            {
                                                top,
                                                height,
                                                left: `${lane * laneWidth + 1}%`,
                                                width: `${Math.max(0, laneWidth - 2)}%`,
                                                backgroundColor: mode === "dark"
                                                    ? colorWithOpacity(color, 0.24)
                                                    : colorWithOpacity(color, 0.13),
                                                borderColor: colorWithOpacity(color, mode === "dark" ? 0.55 : 0.32),
                                                opacity: pressed ? 0.58 : 1,
                                            },
                                        ]}
                                    >
                                        <Text
                                            numberOfLines={2}
                                            style={[styles.multiDayEventTitle, { color: colors.textPrimary }]}
                                        >
                                            {item.title}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </View>
                    ))}
                </View>
            </View>
        </ScrollView>
    ), [
        attachMultiDayTimelineRef,
        accentColor,
        colors.border,
        colors.calendarBackground,
        colors.textSecondary,
        colors.textPrimary,
        bottomInset,
        currentTimeLabel,
        currentTimeY,
        handleTimelineScroll,
        inlineError,
        initialTimelineOffset,
        loading,
        mode,
        multiDayColumns,
        onOpenSchedule,
        onPressRetry,
        todayKey,
    ]);

    const currentModeTimeline = useMemo(() => {
        if (dayViewMode === "singleDay") return singleDayTimeline;
        return multiDayTimeline;
    }, [dayViewMode, multiDayTimeline, singleDayTimeline]);

    const previousModeTimeline = useMemo(() => {
        if (!modeTransitionFrom) return null;
        if (modeTransitionFrom === "singleDay") return singleDayTimeline;
        return multiDayTimeline;
    }, [modeTransitionFrom, multiDayTimeline, singleDayTimeline]);

    const singleDayAllDaySection = useMemo(() => (
        <View style={[styles.dayAllDaySection, { borderBottomColor: colors.border }]}>
            <Text style={[styles.dayAllDayLabel, { color: colors.textSecondary }]}>
                종일
            </Text>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.dayAllDayItems}
            >
                {allDayItems.length === 0 ? (
                    <View style={styles.dayAllDayEmptySpacer} />
                ) : allDayItems.map((item) => {
                    const color = item.category?.color ?? "#8e8e93";
                    return (
                        <Pressable
                            key={item.id}
                            onPress={() => onOpenSchedule(item.id)}
                            style={({ pressed }) => [
                                styles.dayAllDayEvent,
                                {
                                    backgroundColor: colorWithOpacity(color, mode === "dark" ? 0.24 : 0.14),
                                    borderColor: colorWithOpacity(color, 0.5),
                                    opacity: pressed ? 0.58 : 1,
                                },
                            ]}
                        >
                            <View style={[styles.dayAllDayDot, { backgroundColor: color }]} />
                            <Text numberOfLines={1} style={[styles.dayAllDayTitle, { color }]}>
                                {item.title}
                            </Text>
                        </Pressable>
                    );
                })}
            </ScrollView>
        </View>
    ), [
        allDayItems,
        colors.border,
        colors.textSecondary,
        mode,
        onOpenSchedule,
    ]);

    const multiDayAllDaySection = useMemo(() => (
        <View style={[styles.dayAllDaySection, { borderBottomColor: colors.border }]}>
            <Text style={[styles.dayAllDayLabel, { color: colors.textSecondary }]}>
                종일
            </Text>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.dayAllDayItems}
            >
                {multiDayAllDayItems.length === 0 ? (
                    <View style={styles.dayAllDayEmptySpacer} />
                ) : multiDayAllDayItems.map((item) => {
                    const color = item.category?.color ?? "#8e8e93";
                    return (
                        <Pressable
                            key={item.id}
                            onPress={() => onOpenSchedule(item.id)}
                            style={({ pressed }) => [
                                styles.dayAllDayEvent,
                                {
                                    backgroundColor: colorWithOpacity(color, mode === "dark" ? 0.24 : 0.14),
                                    borderColor: colorWithOpacity(color, 0.5),
                                    opacity: pressed ? 0.58 : 1,
                                },
                            ]}
                        >
                            <View style={[styles.dayAllDayDot, { backgroundColor: color }]} />
                            <Text numberOfLines={1} style={[styles.dayAllDayTitle, { color }]}>
                                {item.title}
                            </Text>
                        </Pressable>
                    );
                })}
            </ScrollView>
        </View>
    ), [
        colors.border,
        colors.textSecondary,
        mode,
        onOpenSchedule,
        multiDayAllDayItems,
    ]);

    const currentAllDaySection = useMemo(() => {
        if (dayViewMode === "singleDay" && allDayItems.length > 0) return singleDayAllDaySection;
        if (dayViewMode === "multiDay" && multiDayAllDayItems.length > 0) return multiDayAllDaySection;
        return null;
    }, [allDayItems.length, dayViewMode, multiDayAllDayItems.length, multiDayAllDaySection, singleDayAllDaySection]);

    const previousAllDaySection = useMemo(() => {
        if (!modeTransitionFrom) return null;
        if (modeTransitionFrom === "singleDay" && allDayItems.length > 0) return singleDayAllDaySection;
        if (modeTransitionFrom === "multiDay" && multiDayAllDayItems.length > 0) return multiDayAllDaySection;
        return null;
    }, [allDayItems.length, modeTransitionFrom, multiDayAllDayItems.length, multiDayAllDaySection, singleDayAllDaySection]);

    const singleDayPanelContent = (
        <View
            style={[
                styles.daySinglePanel,
                { backgroundColor: colors.calendarBackground },
            ]}
        >
            <Animated.View style={{ opacity: titleSectionOpacity }}>
                <View style={[styles.dayDateTitleBar, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.dayDateTitleText, { color: colors.textPrimary }]}>
                        {formatDayTitle(selectedDay)}
                    </Text>
                </View>
            </Animated.View>

            <Animated.View
                style={[
                    styles.daySinglePanelBody,
                    {
                        opacity: timelineSectionOpacity,
                        transform: [{ translateY: timelineSectionTranslateY }],
                    },
                ]}
            >
                {allDayItems.length > 0 ? singleDayAllDaySection : null}
                {singleDayTimeline}
            </Animated.View>
        </View>
    );

    const nonSingleDayPanelContent = (
        <>
            <View
                style={styles.dayModeTitleSlot}
                pointerEvents="none"
            >
                <View style={[styles.dayDateTitleBar, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.dayDateTitleText, { color: colors.textPrimary }]}>
                        {contentTitle}
                    </Text>
                </View>
            </View>

            <Animated.View
                style={[
                    styles.dayModeBody,
                    {
                        opacity: modeBodyOpacity,
                        transform: [{ translateY: modeBodyTranslateY }],
                    },
                ]}
            >
                <Animated.View
                    style={[
                        styles.dayAllDaySectionSpacer,
                        {
                            opacity: timelineSectionOpacity,
                            transform: [{ translateY: timelineSectionTranslateY }],
                        },
                    ]}
                >
                    {isModeTransitionActive && previousAllDaySection ? (
                        <Animated.View
                            style={{
                                opacity: modeSwitchOutgoingOpacity,
                                transform: [{ translateY: modeSwitchOutgoingTranslateY }],
                            }}
                            pointerEvents="none"
                        >
                            {previousAllDaySection}
                        </Animated.View>
                    ) : null}

                    {currentAllDaySection}

                    <Animated.View
                        style={{
                            flex: 1,
                            backgroundColor: colors.calendarBackground,
                        }}
                    >
                        {isModeTransitionActive && previousModeTimeline ? (
                            <Animated.View
                                style={{
                                    position: "absolute",
                                    inset: 0,
                                    opacity: modeSwitchOutgoingOpacity,
                                    transform: [{ translateY: modeSwitchOutgoingTranslateY }],
                                }}
                                pointerEvents="none"
                            >
                                {previousModeTimeline}
                            </Animated.View>
                        ) : null}

                        <Animated.View
                            style={{
                                flex: 1,
                                opacity: modeSwitchIncomingOpacity,
                                transform: [{ translateY: modeSwitchIncomingTranslateY }],
                            }}
                        >
                            {currentModeTimeline}
                        </Animated.View>
                    </Animated.View>
                </Animated.View>
            </Animated.View>
        </>
    );

    const currentDayPanelContent = dayViewMode === "singleDay"
        ? singleDayPanelContent
        : nonSingleDayPanelContent;

    // Keep the last committed panel as an immutable outgoing snapshot. The
    // destination can then be committed immediately without making the source
    // title, all-day row, or timeline disappear between animation phases.
    useLayoutEffect(() => {
        if (!isModeTransitionActive) {
            dayPanelSnapshotRef.current = currentDayPanelContent;
        }
    });

    const pagerWidth = Math.max(320, viewportWidth);
    const dayPagerOutgoingTranslateX = dayNavigation
        ? dayPagerProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, -dayNavigation.direction * pagerWidth],
            extrapolate: "clamp",
        })
        : 0;
    const dayPagerIncomingTranslateX = dayNavigation
        ? dayPagerProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [dayNavigation.direction * pagerWidth, 0],
            extrapolate: "clamp",
        })
        : daySwipeX;
    const navigationSelectionVisible = Boolean(
        dayNavigation && startOfWeek(dayNavigation.fromDay) === startOfWeek(dayNavigation.targetDay)
    );
    const navigationFromIndex = dayNavigation
        ? new Date(`${dayNavigation.fromDay}T00:00:00`).getDay()
        : 0;
    const navigationTargetIndex = dayNavigation
        ? new Date(`${dayNavigation.targetDay}T00:00:00`).getDay()
        : 0;
    const weekCellWidth = viewportWidth / 7;
    const navigationSelectionLeft = navigationFromIndex * weekCellWidth + (weekCellWidth - 34) / 2;
    const navigationTargetSelectionLeft = navigationTargetIndex * weekCellWidth + (weekCellWidth - 34) / 2;
    const navigationFromOpacity = dayNavigation
        ? dayPagerProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 0],
            extrapolate: "clamp",
        })
        : 0;
    const navigationTargetOpacity = dayNavigation
        ? dayPagerProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 1],
            extrapolate: "clamp",
        })
        : 0;
    const navigationFromScale = dayNavigation
        ? dayPagerProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 0.92],
            extrapolate: "clamp",
        })
        : 1;
    const navigationTargetScale = dayNavigation
        ? dayPagerProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [0.92, 1],
            extrapolate: "clamp",
        })
        : 1;
    const useDayPager = !isModeTransitionActive;

    return (
        <View
            style={[
                styles.dayRoot,
                {
                    paddingTop: topOffset,
                    backgroundColor: colors.calendarBackground,
                },
            ]}
        >
            <Animated.View
                style={[
                    styles.dayWeekStrip,
                    {
                        borderBottomColor: colors.border,
                    },
                ]}
            >
                <Animated.View
                    style={[
                        styles.dayWeekStripInner,
                        {
                            opacity: isModeTransitionActive ? modeSwitchIncomingOpacity : 1,
                        },
                    ]}
                >
                {weekDays.map((day) => {
                    const isSelected = day.dateString === selectedDay;
                    const isNavigationEndpoint = Boolean(
                        navigationSelectionVisible && dayNavigation && (
                            day.dateString === dayNavigation.fromDay ||
                            day.dateString === dayNavigation.targetDay
                        )
                    );
                    const isToday = day.dateString === todayKey;
                    const daySchedules = items.filter((item) =>
                        isOverlappingDay(item.startAt, item.endAt, day.dateString)
                    );
                    const selectedFill = isToday ? accentColor : colors.selectedDayBg;
                    const selectedText = isToday ? "#ffffff" : colors.selectedDayText;
                    const unselectedText = isToday ? accentColor : colors.textPrimary;

                    return (
                        <Pressable
                            key={day.dateString}
                            onPress={() => navigateToDayFromWeekStrip(day.dateString)}
                            accessibilityRole="button"
                            accessibilityLabel={`${day.month}월 ${day.day}일 ${day.weekday}요일`}
                            hitSlop={{ top: 8, right: 6, bottom: 8, left: 6 }}
                            style={({ pressed }) => [
                                styles.dayWeekCell,
                                { opacity: pressed ? 0.58 : 1 },
                            ]}
                        >
                            <Text
                                style={[
                                    styles.dayWeekdayLabel,
                                    { color: isSelected ? colors.textPrimary : colors.textSecondary },
                                ]}
                            >
                                {day.weekday}
                            </Text>
                            <Animated.View
                                nativeID={getDateSelectionId(day.dateString)}
                                pointerEvents="none"
                                style={[
                                    styles.dayWeekCircle,
                                    isSelected && {
                                        backgroundColor: selectedFill,
                                        borderColor: selectedFill,
                                    },
                                    {
                                            opacity: isNavigationEndpoint
                                                ? 0
                                                : isSelected
                                                ? stripSelectionOpacity
                                                : 1,
                                            transform: [{
                                                translateY: isSelected ? stripSelectionTranslateY : 0,
                                            }],
                                        },
                                    ]}
                                >
                                    <Text
                                    style={[
                                        styles.dayWeekText,
                                        {
                                            color: isSelected ? selectedText : unselectedText,
                                        },
                                    ]}
                                >
                                    {day.day}
                                </Text>
                                </Animated.View>
                            <View pointerEvents="none" style={styles.dayWeekDots}>
                                {!isSelected && isToday && daySchedules.length === 0 && (
                                    <View style={[styles.dayWeekDot, { backgroundColor: accentColor }]} />
                                )}
                                {daySchedules.slice(0, 3).map((item) => (
                                    <View
                                        key={item.id}
                                        style={[
                                            styles.dayWeekDot,
                                            { backgroundColor: item.category?.color ?? "#8e8e93" },
                                        ]}
                                    />
                                ))}
                            </View>
                        </Pressable>
                    );
                })}

                {navigationSelectionVisible && dayNavigation ? (
                    <>
                        <Animated.View
                            pointerEvents="none"
                            style={[
                                styles.dayNavigationSelectionLayer,
                                {
                                    left: navigationSelectionLeft,
                                    opacity: navigationFromOpacity,
                                    transform: [{ scale: navigationFromScale }],
                                },
                            ]}
                        >
                            <View
                                style={[
                                    styles.dayNavigationSelectionCircle,
                                    {
                                        backgroundColor: dayNavigation.fromDay === todayKey
                                            ? accentColor
                                            : colors.selectedDayBg,
                                        borderColor: dayNavigation.fromDay === todayKey
                                            ? accentColor
                                            : colors.selectedDayBg,
                                    },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.dayWeekText,
                                        {
                                            color: dayNavigation.fromDay === todayKey
                                                ? "#ffffff"
                                                : colors.selectedDayText,
                                        },
                                    ]}
                                >
                                    {new Date(`${dayNavigation.fromDay}T00:00:00`).getDate()}
                                </Text>
                            </View>
                        </Animated.View>

                        <Animated.View
                            pointerEvents="none"
                            style={[
                                styles.dayNavigationSelectionLayer,
                                {
                                    left: navigationTargetSelectionLeft,
                                    opacity: navigationTargetOpacity,
                                    transform: [{ scale: navigationTargetScale }],
                                },
                            ]}
                        >
                            <View
                                style={[
                                    styles.dayNavigationSelectionCircle,
                                    {
                                        backgroundColor: dayNavigation.targetDay === todayKey
                                            ? accentColor
                                            : colors.selectedDayBg,
                                        borderColor: dayNavigation.targetDay === todayKey
                                            ? accentColor
                                            : colors.selectedDayBg,
                                    },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.dayWeekText,
                                        {
                                            color: dayNavigation.targetDay === todayKey
                                                ? "#ffffff"
                                                : colors.selectedDayText,
                                        },
                                    ]}
                                >
                                    {new Date(`${dayNavigation.targetDay}T00:00:00`).getDate()}
                                </Text>
                            </View>
                        </Animated.View>
                    </>
                ) : null}
                </Animated.View>
            </Animated.View>

            <Animated.View
                style={styles.dayBodyEntry}
            >
                {useDayPager ? (
                    <Animated.View
                        style={[
                            styles.dayModeBody,
                            {
                                opacity: modeBodyOpacity,
                                transform: [{ translateY: modeBodyTranslateY }],
                            },
                        ]}
                    >
                        <View
                            {...timelineSwipeResponder.panHandlers}
                            style={styles.dayPagerViewport}
                        >
                            {dayNavigation ? (
                                <Animated.View
                                    key={`outgoing-${dayNavigation.fromDay}-${dayNavigation.targetDay}`}
                                    pointerEvents="none"
                                    style={[
                                        styles.dayPagerPanel,
                                        { transform: [{ translateX: dayPagerOutgoingTranslateX }] },
                                    ]}
                                >
                                    {dayNavigation.outgoingPanel}
                                </Animated.View>
                            ) : null}

                            <Animated.View
                                key={`incoming-${selectedDay}`}
                                style={[
                                    styles.dayPagerPanel,
                                    { transform: [{ translateX: dayPagerIncomingTranslateX }] },
                                ]}
                            >
                                {currentDayPanelContent}
                            </Animated.View>
                        </View>
                    </Animated.View>
                ) : nonSingleDayPanelContent}
            </Animated.View>
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
        overflow: "hidden",
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
        paddingHorizontal: 20,
        justifyContent: "center",
        zIndex: 2,
        elevation: 2,
    },
    stickyMonthTitle: {
        fontSize: 33,
        fontWeight: "700",
        letterSpacing: 0,
        transform: [{ translateY: -1.5 }],
    },
    stickyMonthTitleCurrentDark: {
        color: "#ff453a",
    },
    stickyMonthTitleCurrentLight: {
        color: "#ff3b30",
    },
    stickyWeekdayHeader: {
        height: STICKY_WEEKDAY_HEADER_HEIGHT,
        paddingHorizontal: 0,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        zIndex: 3,
        elevation: 3,
    },
    stickyWeekdayText: {
        width: "14.2857%",
        textAlign: "center",
        fontSize: 10,
        fontWeight: "600",
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
        height: LIQUID_TOOLBAR_CONTROL_CANVAS_HEIGHT,
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
    yearGlassMotion: {
        height: LIQUID_TOOLBAR_BUTTON_SIZE,
        borderRadius: LIQUID_TOOLBAR_BUTTON_SIZE / 2,
    },
    yearGlass: {
        width: LIQUID_YEAR_PILL_WIDTH,
        height: LIQUID_TOOLBAR_BUTTON_SIZE,
        borderRadius: LIQUID_TOOLBAR_BUTTON_SIZE / 2,
        borderWidth: Platform.OS === "ios" ? 0 : 1,
        // The native iOS glass pill draws its depth shadow outside the 44pt
        // hit target. Keep that shadow visible while Android retains clipping.
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
    liquidToolbarBackdrop: {
        zIndex: 55,
        elevation: 55,
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
    dayViewModeMenu: {
        paddingHorizontal: 8,
        paddingVertical: 2,
    },
    dayViewModeIconSlot: {
        width: 24,
        alignItems: "center",
        justifyContent: "center",
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
    monthCalendarFrame: {
        minHeight: 0,
        alignSelf: "stretch",
        position: "relative",
        overflow: "hidden",
    },
    monthCalendarIncomingLayer: {
        minHeight: 0,
        alignSelf: "stretch",
        transformOrigin: "top",
    },
    monthCalendarLayerContentFull: {
        flex: 1,
        minHeight: 0,
        alignSelf: "stretch",
    },
    monthCalendarLayerContentCompact: {
        minHeight: 0,
        flexShrink: 0,
        alignSelf: "stretch",
    },
    monthAgendaSlot: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        minHeight: 0,
        alignSelf: "stretch",
        overflow: "visible",
        zIndex: 2,
        elevation: 2,
    },
    monthAgendaMotion: {
        flex: 1,
        minHeight: 0,
    },
    monthAgendaCurrentLayer: {
        flex: 1,
        minHeight: 0,
        zIndex: 2,
    },
    monthAgendaSwapLayer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1,
    },
    calendarContent: {
        flex: 1,
        zIndex: 10,
        elevation: 10,
        overflow: "hidden",
    },
    displayStack: {
        flex: 1,
        overflow: "hidden",
    },
    monthDisplayLayer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1,
        elevation: 1,
        overflow: "hidden",
    },
    dayDisplayLayer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 2,
        elevation: 2,
        overflow: "hidden",
    },
    dayRoot: {
        flex: 1,
        overflow: "hidden",
    },
    dayBodyEntry: {
        flex: 1,
    },
    dayAllDaySectionSpacer: {
        flex: 1,
    },
    dayModeBody: {
        flex: 1,
    },
    dayPagerViewport: {
        flex: 1,
        overflow: "hidden",
    },
    dayPagerPanel: {
        ...StyleSheet.absoluteFillObject,
    },
    daySinglePanel: {
        flex: 1,
    },
    daySinglePanelBody: {
        flex: 1,
    },
    dayWeekStrip: {
        height: DAY_WEEK_STRIP_HEIGHT,
        paddingHorizontal: DAY_WEEK_STRIP_HORIZONTAL_PADDING,
        paddingTop: 9,
        paddingBottom: 1,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "stretch",
        zIndex: 5,
        elevation: 5,
        overflow: "hidden",
    },
    dayWeekStripInner: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "stretch",
    },
    dayWeekCell: {
        flex: 1,
        minHeight: 61,
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
    },
    dayWeekdayLabel: {
        fontSize: 10,
        fontWeight: "600",
        letterSpacing: 0,
        transform: [{ translateY: -4 }],
    },
    dayWeekCircle: {
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: "transparent",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "transparent",
    },
    dayNavigationSelectionLayer: {
        position: "absolute",
        top: 16,
        width: 34,
        height: 34,
        zIndex: 8,
        elevation: 8,
    },
    dayNavigationSelectionCircle: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 17,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    dayWeekText: {
        fontSize: 16,
        fontWeight: "700",
        letterSpacing: 0,
    },
    dayWeekDots: {
        height: 6,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
    },
    dayWeekDot: {
        width: 5,
        height: 5,
        borderRadius: 3,
    },
    dayDateTitleBar: {
        height: 36.5,
        borderBottomWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
    },
    dayModeTitleSlot: {
        flexShrink: 0,
        overflow: "hidden",
    },
    dayDateTitleText: {
        fontSize: 15,
        fontWeight: "700",
        letterSpacing: 0,
    },
    dayAllDaySection: {
        minHeight: 50,
        borderBottomWidth: StyleSheet.hairlineWidth,
        paddingVertical: 8,
        paddingLeft: 18,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    dayAllDayLabel: {
        width: 40,
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0,
    },
    dayAllDayItems: {
        paddingRight: 18,
        gap: 8,
        alignItems: "center",
    },
    dayAllDayEmptySpacer: {
        width: 1,
        height: 28,
    },
    dayAllDayEvent: {
        maxWidth: 180,
        minHeight: 34,
        borderRadius: 17,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 11,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
    dayAllDayDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
    },
    dayAllDayTitle: {
        flexShrink: 1,
        fontSize: 13,
        fontWeight: "800",
        letterSpacing: 0,
    },
    dayTimelineScroll: {
        flex: 1,
    },
    dayTimelineContent: {
        paddingHorizontal: 0,
        paddingTop: 0,
    },
    timelineInlineState: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        elevation: 10,
        height: 34,
        paddingLeft: DAY_TIMELINE_GUTTER + 18,
        justifyContent: "center",
    },
    timelineInlineStateText: {
        fontSize: 13,
        fontWeight: "700",
        letterSpacing: 0,
    },
    dayTimelineEmptyText: {
        marginTop: 8,
        paddingLeft: 4,
        fontSize: 13,
        fontWeight: "700",
        letterSpacing: 0,
    },
    dayTimelineCanvas: {
        height: DAY_MINUTES / 60 * DAY_TIMELINE_HOUR_HEIGHT + DAY_TIMELINE_END_PADDING,
    },
    multiDayTimelineCanvas: {
        height: DAY_MINUTES / 60 * DAY_TIMELINE_HOUR_HEIGHT + DAY_TIMELINE_END_PADDING,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    multiDayColumns: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: DAY_TIMELINE_GUTTER + 18,
        right: 0,
        flexDirection: "row",
    },
    multiDayColumn: {
        flex: 1,
        borderLeftWidth: StyleSheet.hairlineWidth,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    multiDayTimelineEvent: {
        position: "absolute",
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 6,
        paddingVertical: 6,
        overflow: "hidden",
    },
    multiDayNowLine: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 18,
        marginTop: -9,
        justifyContent: "center",
        zIndex: 12,
    },
    multiDayNowTimeGutter: {
        position: "absolute",
        top: 0,
        left: 0,
        width: DAY_TIMELINE_GUTTER + 18,
        height: 18,
        marginTop: -9,
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 12,
    },
    multiDayNowRule: {
        height: 1.5,
        borderRadius: 1,
    },
    multiDayEventTitle: {
        fontSize: 10.5,
        fontWeight: "800",
        letterSpacing: 0,
    },
    dayHourRow: {
        position: "absolute",
        left: DAY_TIMELINE_GUTTER + 18,
        right: 0,
        height: DAY_TIMELINE_HOUR_HEIGHT,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    dayHourText: {
        position: "absolute",
        top: -9,
        left: -(DAY_TIMELINE_GUTTER + 18),
        width: DAY_TIMELINE_GUTTER + 12,
        fontSize: 12,
        fontWeight: "500",
        textAlign: "right",
        letterSpacing: 0,
    },
    dayEventLayer: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: DAY_TIMELINE_GUTTER + 18,
        right: 12,
    },
    dayNowLine: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 18,
        marginTop: -9,
        flexDirection: "row",
        alignItems: "center",
        zIndex: 12,
    },
    dayNowTimeGutter: {
        width: DAY_TIMELINE_GUTTER + 18,
        height: 18,
        alignItems: "flex-end",
        justifyContent: "center",
    },
    dayNowTimeBadge: {
        minWidth: 42,
        height: 18,
        paddingHorizontal: 6,
        borderRadius: 9,
        alignItems: "center",
        justifyContent: "center",
    },
    dayNowTimeText: {
        color: "#ffffff",
        fontSize: 12,
        lineHeight: 14,
        fontWeight: "700",
        fontVariant: ["tabular-nums"],
        letterSpacing: 0,
    },
    dayNowRule: {
        flex: 1,
        height: 1.5,
        borderRadius: 1,
    },
    yearOverviewLayer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 30,
        elevation: 30,
        overflow: "hidden",
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
