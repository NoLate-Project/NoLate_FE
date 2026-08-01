import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    AccessibilityInfo,
    ActivityIndicator,
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
import AsyncStorage from "@react-native-async-storage/async-storage";
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
import CalendarSettingsModal from "../../src/modules/schedule/components/calendar/CalendarSettingsModal";
import CalendarViewModeGlyph from "../../src/modules/schedule/components/calendar/CalendarViewModeGlyph";
import ScheduleRouteFocusBoundary from "../../src/modules/schedule/components/ScheduleRouteFocusBoundary";
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
    getPrimaryPillWeekdayGap,
    prefetchesAdjacentMonths,
    showsStickyMonthTitle as shouldShowStickyMonthTitle,
    type CalendarViewMode,
    usesMonthInPrimaryPill,
} from "../../src/modules/schedule/components/calendar/viewMode";
import GlobalFloatingActionBar, { type FloatingBarAction } from "../../src/modules/schedule/components/shared/GlobalFloatingActionBar";
import {
    MonthAgendaList,
    SelectedDayAgendaPanel,
} from "../../src/modules/schedule/components/list/ScheduleAgendaViews";
import ScheduleNewModal, {
    type ScheduleAddMorphPresenter,
} from "../../src/modules/schedule/components/form/ScheduleAddModal";
import CategoryLoadErrorBanner from "../../src/modules/schedule/components/form/CategoryLoadErrorBanner";
import QuickScheduleModal, {
    type QuickScheduleMorphPresenter,
} from "../../src/modules/schedule/components/form/QuickScheduleModal";

import { useScheduleStore } from "../../src/modules/schedule/store";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { isOverlappingDay, startOfDay, toYmd } from "../../lib/util/data";
import type { ScheduleItem, ScheduleParseResult } from "../../src/modules/schedule/types";
import { buildRouteSetupEntryRoute } from "../../src/modules/schedule/routeSetupNavigation";
import {
    createSchedule,
    getCalendarSchedules,
    getSchedules,
    parseScheduleText,
    searchSchedules,
    synchronizeCalendarScheduleCacheRevision,
} from "../../src/api/schedule";
import {
    recordQuickScheduleReliabilityFeedbackDurably,
} from "../../src/modules/schedule/quickScheduleReliabilityFeedbackQueue";
import { getCalendarDays } from "../../src/api/calendar";
import { getScheduleCategoriesFromApi } from "../../src/api/scheduleCategories";
import { getShareInbox } from "../../src/api/scheduleSharing";
import { getAppNotificationUnreadCount } from "../../src/api/notification";
import { getMonthRange } from "../../src/modules/schedule/calendarRange";
import {
    hasCalendarScheduleMonthCache,
    readCalendarScheduleCache,
    refreshCalendarScheduleCache,
    subscribeCalendarScheduleCacheInvalidated,
} from "../../src/modules/schedule/calendarScheduleCache";
import {
    getCalendarMetadataPrefetchMonthKeys,
    getCalendarMetadataRange,
    indexCalendarDays,
    type CalendarDayMetadata,
} from "../../src/modules/schedule/calendarMetadata";
import {
    getCalendarWeekStart,
    getCalendarWeekdayIndex,
    getScheduleFocusDay,
    shiftCalendarMonth,
} from "../../src/modules/schedule/calendarNavigation";
import { getScheduleAccessibilityVisibility } from "../../src/modules/schedule/accessibilityVisibility";
import { getWritableScheduleCategories } from "../../src/modules/schedule/categoryPermissions";
import {
    DAY_MINUTES,
    DAY_TIMELINE_END_PADDING,
    DAY_TIMELINE_HOUR_HEIGHT,
    buildPositionedEvents,
    formatDayTimelineTimeRange,
} from "../../src/modules/schedule/dayTimelineLayout";
import {
    DAY_NAVIGATION_MOTION,
    DAY_NAVIGATION_RETARGET_MOTION,
    getDayNavigationRemainingDuration,
    getDayNavigationRetargetSettleDuration,
    getDayNavigationResetDuration,
} from "../../src/modules/schedule/dayNavigationMotion";
import {
    ADD_HANDOFF_MOTION,
    ADD_MENU_SOURCE,
    shouldRestoreAddHandoffToolbar,
} from "../../src/modules/schedule/addHandoffMotion";
import {
    CALENDAR_DEPTH_MOTION,
    CALENDAR_INTERACTION_BUDGET_MS,
    CALENDAR_PRIMARY_PILL_LAYOUT,
    CALENDAR_PILL_MOTION,
    CALENDAR_TODAY_FOCUS_MOTION,
    CURRENT_TIME_MOTION,
    DETAIL_MONTH_HEIGHT_MOTION,
    MONTH_AGENDA_MOTION,
    formatCalendarCurrentTime,
    getCalendarMonthWeekCount,
    getMonthAgendaPanelKind,
    getMonthAgendaTransition,
    resolveCalendarPrimaryPillLayout,
    resolveDetailMonthPanelLayout,
    resolveMonthAgendaViewportLayout,
    shouldAnimateCurrentTimeStep,
    type MonthAgendaPanelKind,
} from "../../src/modules/schedule/calendarMotion";
import {
    buildShareAttentionSummary,
    readSeenShareAttentionKeys,
    type ShareAttentionSummary,
} from "../../src/modules/share/shareAttention";
import { subscribeAppNotificationReceived } from "../../src/modules/notification/appNotificationEvents";
import {
    resolveQuickScheduleParseInput,
    type QuickScheduleMediaInput,
} from "../../src/modules/schedule/quickInputExtraction";
import BrandedLoader from "../../src/ui/BrandedLoader";

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

function sanitizeCalendarTransitionError(error?: string | null) {
    return getCalendarErrorMessage(error) ?? null;
}

type ToolbarMenu = "view" | "search" | "add";
type CalendarDepth = "year" | "month" | "day";
type DayViewMode = "singleDay" | "multiDay";
type TodayFocusTarget = {
    day: string;
    requiresMonthChange: boolean;
};
type AddItemOptions = {
    showErrorAlert?: boolean;
};

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
const LIQUID_TOOLBAR_SEARCH_HEIGHT = 52;
const LIQUID_TOOLBAR_SLOT_WIDTH = 50;
const LIQUID_TOOLBAR_ACTIONS_WIDTH = LIQUID_TOOLBAR_SLOT_WIDTH * 3;
const LIQUID_TOOLBAR_ADD_DROPDOWN_WIDTH = ADD_MENU_SOURCE.nativeWidth;
const LIQUID_TOOLBAR_ADD_DROPDOWN_HEIGHT = ADD_MENU_SOURCE.nativeHeight;
const LIQUID_TOOLBAR_CONTROL_CANVAS_HEIGHT = 260;
// The view-mode menu still needs the wider 251pt host. The add menu itself is
// 238pt wide and stays aligned to this canvas' trailing edge.
const SHARE_ATTENTION_REFRESH_MS = 45_000;
const LIQUID_YEAR_PILL_WIDTH = CALENDAR_PRIMARY_PILL_LAYOUT.monthMinWidth;
const LIQUID_TOOLBAR_TOP_OFFSET = 4;
const SEARCH_TOOLBAR_LEFT_INSET = 16;
const SEARCH_TOOLBAR_OPEN_DURATION_MS = 120;
const SEARCH_FIELD_REVEAL_START_PROGRESS = 0.28;
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
const CALENDAR_FIRST_DAY_STORAGE_KEY = "@nolate/calendar/first-day";

function getStickyCalendarHeaderHeight(viewMode: CalendarViewMode): number {
    return shouldShowStickyMonthTitle(viewMode)
        ? STICKY_CALENDAR_HEADER_HEIGHT
        : STICKY_WEEKDAY_HEADER_HEIGHT + getPrimaryPillWeekdayGap(viewMode);
}

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
    dayViewMode: DayViewMode,
    calendarViewMode: CalendarViewMode
) {
    const monthRange = getMonthRange(visibleMonth);
    const startTimes = [new Date(monthRange.startAt).getTime()];
    const endTimes = [new Date(monthRange.endAt).getTime()];

    if (calendarDepth === "month" && prefetchesAdjacentMonths(calendarViewMode)) {
        const previousMonthRange = getMonthRange(shiftCalendarMonth(visibleMonth, -2));
        const nextMonthRange = getMonthRange(shiftCalendarMonth(visibleMonth, 2));
        startTimes.push(new Date(previousMonthRange.startAt).getTime());
        endTimes.push(new Date(nextMonthRange.endAt).getTime());
    }

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

const MemoizedDayDisplay = React.memo(DayDisplay);
const MemoizedSelectedDayAgendaPanel = React.memo(SelectedDayAgendaPanel);
const MemoizedMonthAgendaList = React.memo(MonthAgendaList);
const MemoizedQuickScheduleModal = React.memo(
    QuickScheduleModal,
    (previous, next) => Boolean(
        previous.prewarm &&
        next.prewarm &&
        !previous.visible &&
        !next.visible
    )
);
const MemoizedScheduleNewModal = React.memo(
    ScheduleNewModal,
    (previous, next) => Boolean(
        previous.prewarm &&
        next.prewarm &&
        !previous.visible &&
        !next.visible
    )
);

export default function ScheduleIndex() {
    const router = useRouter();
    const isFocused = useIsFocused();
    const params = useLocalSearchParams<{
        focus?: string | string[];
        focusDay?: string | string[];
        focusRun?: string | string[];
    }>();
    const insets = useSafeAreaInsets();
    const { width: screenWidth } = useWindowDimensions();
    const { mode, colors } = useTheme();
    const focusRequest = Array.isArray(params.focus) ? params.focus[0] : params.focus;
    const focusDayRequest = Array.isArray(params.focusDay) ? params.focusDay[0] : params.focusDay;
    const focusRun = Array.isArray(params.focusRun) ? params.focusRun[0] : params.focusRun;
    const { state, dispatch } = useScheduleStore();
    const [modalVisible, setModalVisible] = useState(false);
    const [activeToolbarMenu, setActiveToolbarMenu] = useState<ToolbarMenu | null>(null);
    const [toolbarMenuClosing, setToolbarMenuClosing] = useState(false);
    const [liquidPrototypeOpen, setLiquidPrototypeOpen] = useState(false);
    const [prototypeCloseRequest, setPrototypeCloseRequest] = useState(0);
    const [quickModalVisible, setQuickModalVisible] = useState(false);
    const [addFormsPrewarmed, setAddFormsPrewarmed] = useState(false);
    const [quickHandoffHidden, setQuickHandoffHidden] = useState(false);
    const [shareAttention, setShareAttention] = useState<ShareAttentionSummary>(EMPTY_SHARE_ATTENTION);
    const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
    const [routeSetupItems, setRouteSetupItems] = useState<ScheduleItem[]>([]);
    const [formInitialValues, setFormInitialValues] = useState<ScheduleParseResult | null>(null);
    const [calendarViewMode, setCalendarViewMode] = useState<CalendarViewMode>("detail");
    const [calendarDepth, setCalendarDepth] = useState<CalendarDepth>("month");
    const [dayViewMode, setDayViewMode] = useState<DayViewMode>("singleDay");
    const [dayLayerMounted, setDayLayerMounted] = useState(false);
    const [dayTransitionTargetDay, setDayTransitionTargetDay] = useState<string | null>(null);
    const [yearOverviewVisible, setYearOverviewVisible] = useState(false);
    const [yearOverviewClosing, setYearOverviewClosing] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<ScheduleItem[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchRetryKey, setSearchRetryKey] = useState(0);
    const [categoryLoading, setCategoryLoading] = useState(false);
    const [categoryError, setCategoryError] = useState<string | null>(null);
    const [categoryRetryKey, setCategoryRetryKey] = useState(0);
    const searchSequenceRef = useRef(0);
    const [keyboardVisible, setKeyboardVisible] = useState(false);
    const [firstDay, setFirstDay] = useState<0 | 1>(0);
    const [calendarSettingsVisible, setCalendarSettingsVisible] = useState(false);
    const [calendarScrollRequest, setCalendarScrollRequest] = useState(0);
    const [dayTodayRequest, setDayTodayRequest] = useState(0);
    const [yearTodayRequest, setYearTodayRequest] = useState(0);
    const [yearOverviewPresentationRequest, setYearOverviewPresentationRequest] = useState(0);
    const [todayButtonPrimed, setTodayButtonPrimed] = useState(false);
    const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);
    const [transitionMonthKey, setTransitionMonthKey] = useState<string | null>(null);
    const [dayTransitionContext, setDayTransitionContext] = useState<DayTransitionContext>("idle");
    const [dayModeTransitionFrom, setDayModeTransitionFrom] = useState<DayViewMode | null>(null);
    const [isDayTransitionActive, setIsDayTransitionActive] = useState(false);
    const [isYearDepthTransitionActive, setIsYearDepthTransitionActive] = useState(false);
    const [isMonthViewTransitionActive, setIsMonthViewTransitionActive] = useState(false);
    const [isTodayFocusTransitionActive, setIsTodayFocusTransitionActive] = useState(false);
    const [todayFocusTarget, setTodayFocusTarget] = useState<TodayFocusTarget | null>(null);
    const dayLayerMountedRef = useRef(dayLayerMounted);
    const isDayTransitionActiveRef = useRef(isDayTransitionActive);
    const isYearDepthTransitionActiveRef = useRef(isYearDepthTransitionActive);
    dayLayerMountedRef.current = dayLayerMounted;
    isDayTransitionActiveRef.current = isDayTransitionActive;
    isYearDepthTransitionActiveRef.current = isYearDepthTransitionActive;

    useEffect(() => {
        let cancelled = false;

        AsyncStorage.getItem(CALENDAR_FIRST_DAY_STORAGE_KEY)
            .then((storedFirstDay) => {
                if (cancelled) return;
                if (storedFirstDay === "0" || storedFirstDay === "1") {
                    setFirstDay(Number(storedFirstDay) as 0 | 1);
                }
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, []);
    const [retainedMonthAgendaPanelKind, setRetainedMonthAgendaPanelKind] =
        useState<MonthAgendaPanelKind>("detail");
    const [outgoingMonthAgendaPanelKind, setOutgoingMonthAgendaPanelKind] =
        useState<MonthAgendaPanelKind | null>(null);
    const shouldHideHandoffSurface = quickHandoffHidden && (quickModalVisible || modalVisible);
    const calendarTransition = useRef(new Animated.Value(1)).current;
    const todayFocusOpacity = useRef(new Animated.Value(1)).current;
    const todayFocusTranslateY = useRef(new Animated.Value(0)).current;
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
    const nativeSearchGenerationRef = useRef(0);
    const nativeSearchSessionRef = useRef<string | null>(null);
    const searchInputRef = useRef<TextInput>(null);
    const dayDisplayPrepareRef = useRef<((day: string) => void) | null>(null);
    const monthCalendarHeightRef = useRef(0);
    const monthCalendarDayHeightRef = useRef(CALENDAR_DAY_HEIGHTS.detail);
    const monthDisplayHeightRef = useRef(0);
    const [monthDisplayHeight, setMonthDisplayHeight] = useState(0);
    const monthViewTransitionGenerationRef = useRef(0);
    const monthViewTransitionFrameRef = useRef<number | null>(null);
    const yearDepthTransitionFrameRef = useRef<number | null>(null);
    const monthViewCompletionAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
    const monthViewTransitionWatchdogRef =
        useRef<ReturnType<typeof setTimeout> | null>(null);
    const todayFocusAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
    const todayFocusWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const todayFocusAnimationGenerationRef = useRef(0);
    const todayFocusAnimationActiveRef = useRef(false);
    const todayFocusCommittedRef = useRef(false);
    const todayFocusEnterStartedRef = useRef(false);
    const todayFocusReduceMotionRef = useRef(false);
    const detailMonthMotionCancelRef = useRef<(() => void) | null>(null);
    const transitionStartedRef = useRef(false);
    const dayPageNavigationActiveRef = useRef(false);
    const dayTransitionCleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const viewTransitioningRef = useRef(false);
    const quickHandoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const quickMorphPresenterRef = useRef<QuickScheduleMorphPresenter | null>(null);
    const manualMorphPresenterRef = useRef<ScheduleAddMorphPresenter | null>(null);
    const addHandoffPendingRef = useRef(false);
    const addHandoffClosingRef = useRef(false);
    const addHandoffNativeResetRef = useRef(false);
    const handledFocusRequestRef = useRef<string | null>(null);
    const scheduleLoadSequenceRef = useRef(0);
    const calendarMetadataMountedRef = useRef(true);
    const calendarMetadataLoadedMonthKeysRef = useRef(new Set<string>());
    const calendarMetadataInFlightMonthKeysRef = useRef(new Set<string>());
    const scheduleItemsByIdRef = useRef(state.itemsById);
    scheduleItemsByIdRef.current = state.itemsById;

    const [pendingSelectedDay, setPendingSelectedDay] = useState<string | null>(null);
    const selectedDay = pendingSelectedDay ?? state.selectedDay;
    const selectedDayRef = useRef(selectedDay);
    selectedDayRef.current = selectedDay;
    const [todayKey, setTodayKey] = useState(() => toYmd(new Date()));
    const [visibleMonth, setVisibleMonth] = useState(selectedDay);
    const [fetchVisibleMonth, setFetchVisibleMonth] = useState(selectedDay);
    const [calendarDaysByDate, setCalendarDaysByDate] = useState<
        Record<string, CalendarDayMetadata>
    >({});
    const scheduleError = useMemo(
        () => state.error ? getErrorMessage(new Error(state.error)) : null,
        [state.error]
    );
    const scheduleFetchRange = useMemo(
        () => getScheduleFetchRange(
            fetchVisibleMonth,
            selectedDay,
            calendarDepth,
            dayViewMode,
            calendarViewMode
        ),
        [calendarDepth, calendarViewMode, dayViewMode, fetchVisibleMonth, selectedDay]
    );
    const scheduleFetchStartAt = scheduleFetchRange.startAt;
    const scheduleFetchEndAt = scheduleFetchRange.endAt;
    const calendarMetadataPrefetchMonthKeys = useMemo(
        () => getCalendarMetadataPrefetchMonthKeys(fetchVisibleMonth),
        [fetchVisibleMonth]
    );

    useEffect(() => {
        calendarMetadataMountedRef.current = true;
        return () => {
            calendarMetadataMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (
            !isFocused ||
            addFormsPrewarmed ||
            !dayLayerMounted ||
            isDayTransitionActive ||
            isYearDepthTransitionActive ||
            isMonthViewTransitionActive
        ) return;

        // Pay the form mount/layout cost after the calendar's initial work,
        // not in a calendar transition or the frame where an add-menu row is selected.
        const task = InteractionManager.runAfterInteractions(() => {
            setAddFormsPrewarmed(true);
        });
        return () => task.cancel();
    }, [
        addFormsPrewarmed,
        dayLayerMounted,
        isDayTransitionActive,
        isFocused,
        isMonthViewTransitionActive,
        isYearDepthTransitionActive,
    ]);

    useEffect(() => {
        if (
            !isFocused ||
            dayLayerMounted ||
            calendarDepth !== "month" ||
            isDayTransitionActive ||
            isYearDepthTransitionActive
        ) return;

        // Build the timeline while the month screen is idle. The first tap can
        // then start the compositor transition immediately instead of waiting
        // for 24 hour rows and event cards to mount.
        const task = InteractionManager.runAfterInteractions(() => {
            setDayLayerMounted(true);
        });
        return () => task.cancel();
    }, [
        calendarDepth,
        dayLayerMounted,
        isDayTransitionActive,
        isFocused,
        isYearDepthTransitionActive,
    ]);

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
    const handleDayPageNavigationActiveChange = useCallback((active: boolean) => {
        dayPageNavigationActiveRef.current = active;
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
    const retainedMonthLayerDayRef = useRef(selectedDay);
    const retainedMonthLayerFocusRef = useRef(visibleMonth);
    if (!isMonthToDayTransition && (isDayToMonthTransition || calendarDepth !== "day")) {
        retainedMonthLayerDayRef.current = isYearToMonthTransition ? visibleMonth : selectedDay;
        retainedMonthLayerFocusRef.current = visibleMonth;
    }
    const monthDisplaySelectedDay = retainedMonthLayerDayRef.current;
    const monthDisplayFocusedMonth = retainedMonthLayerFocusRef.current;
    const retainedDayLayerDayRef = useRef(selectedDay);
    if (calendarDepth === "day" || isDayTransitionActive || !dayLayerMounted) {
        retainedDayLayerDayRef.current = dayTransitionTargetDay ?? selectedDay;
    }
    const dayDisplaySelectedDay = retainedDayLayerDayRef.current;
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
    const detailMonthPrimaryLabel = `${visibleYear}년 ${Number(visibleMonth.slice(5, 7))}월`;
    const monthUsesCombinedPrimaryPill = usesMonthInPrimaryPill(calendarViewMode);
    const visiblePrimaryLabel = pillTargetDepth === "day"
        ? `${new Date(`${pillDisplayDay}T00:00:00`).getMonth() + 1}월`
        : pillTargetDepth === "month" && monthUsesCombinedPrimaryPill
            ? detailMonthPrimaryLabel
            : `${visibleYear}년`;
    const monthPrimaryLabel = monthUsesCombinedPrimaryPill
        ? detailMonthPrimaryLabel
        : `${visibleYear}년`;
    const monthPrimaryPillLayout = resolveCalendarPrimaryPillLayout(
        "month",
        monthPrimaryLabel,
        screenWidth
    );
    const primaryPillLayout = resolveCalendarPrimaryPillLayout(
        pillTargetDepth,
        visiblePrimaryLabel,
        screenWidth
    );
    const primaryPillVisible = primaryPillLayout.visible;
    const primaryPillContentWidth = primaryPillVisible
        ? primaryPillLayout.width
        : monthPrimaryPillLayout.width;
    // Keep the host at a concrete width while the year layer hides the pill.
    // Animating a parent from 0 while its native child uses width: "100%" can
    // leave the SwiftUI hosting view with stale clipped bounds under Fabric.
    const primaryPillAnimatedWidth = useSharedValue(primaryPillContentWidth);
    useEffect(() => {
        cancelReanimatedAnimation(primaryPillAnimatedWidth);
        primaryPillAnimatedWidth.value = withTiming(primaryPillContentWidth, {
            duration: reduceMotionEnabled
                ? CALENDAR_DEPTH_MOTION.reduceMotionDurationMs
                : CALENDAR_DEPTH_MOTION.depthSlideDurationMs,
            easing: reduceMotionEnabled
                ? ReanimatedEasing.out(ReanimatedEasing.cubic)
                : ReanimatedEasing.bezier(...CALENDAR_DEPTH_MOTION.bezier),
            reduceMotion: ReduceMotion.Never,
        });
        return () => cancelReanimatedAnimation(primaryPillAnimatedWidth);
    }, [
        primaryPillAnimatedWidth,
        primaryPillContentWidth,
        reduceMotionEnabled,
    ]);
    const primaryPillAnimatedStyle = useAnimatedStyle(() => ({
        width: primaryPillAnimatedWidth.value,
    }));
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
    const calendarContentTodayOpacity = Animated.multiply(
        calendarContentOpacity,
        todayFocusOpacity
    );
    const calendarContentTodayTranslateY = Animated.add(
        calendarContentTranslateY,
        todayFocusTranslateY
    );
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
    const detailMonthHeightMotionDuration = reduceMotionEnabled
        ? DETAIL_MONTH_HEIGHT_MOTION.reduceMotionDurationMs
        : DETAIL_MONTH_HEIGHT_MOTION.durationMs;
    const resolveMonthCalendarLayout = useCallback((viewMode: CalendarViewMode) => {
        const fullCalendarHeight = monthDisplayHeight || monthDisplayHeightRef.current;
        const targetHeaderHeight = getStickyCalendarHeaderHeight(viewMode);
        const targetHeaderOffset = insets.top
            + CALENDAR_TOOLBAR_HEIGHT
            + targetHeaderHeight;
        const fixedCalendarHeight = getFixedScheduleCalendarHeight({
            viewMode,
            month: monthDisplaySelectedDay,
            firstDay,
            headerOffset: targetHeaderOffset,
        }) ?? fullCalendarHeight;
        let panelCalendarHeight = fixedCalendarHeight;
        let dayHeight = CALENDAR_DAY_HEIGHTS[viewMode];

        if (viewMode === "detail" && fullCalendarHeight > 0) {
            const weekCount = getCalendarMonthWeekCount(
                monthDisplaySelectedDay,
                firstDay
            );
            const fixedChromeHeight = Math.max(
                0,
                fixedCalendarHeight - weekCount * CALENDAR_DAY_HEIGHTS.detail
            );
            const detailLayout = resolveDetailMonthPanelLayout({
                viewportHeight: fullCalendarHeight,
                fixedChromeHeight,
                weekCount,
                defaultDayHeight: CALENDAR_DAY_HEIGHTS.detail,
            });
            panelCalendarHeight = detailLayout.calendarHeight;
            dayHeight = detailLayout.dayHeight;
        }

        const viewportLayout = resolveMonthAgendaViewportLayout(viewMode, {
            fullCalendarHeight,
            panelCalendarHeight,
            expandedListTop: insets.top + CALENDAR_TOOLBAR_HEIGHT,
        });

        return {
            calendarHeight: viewportLayout.calendarTargetHeight,
            dayHeight,
        };
    }, [
        firstDay,
        insets.top,
        monthDisplayHeight,
        monthDisplaySelectedDay,
    ]);
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
        setMonthDisplayHeight((currentHeight) => (
            Math.abs(currentHeight - nextHeight) > 0.5 ? nextHeight : currentHeight
        ));
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

        const targetLayout = resolveMonthCalendarLayout(calendarViewMode);
        const targetHeight = targetLayout.calendarHeight;
        if (!Number.isFinite(targetHeight) || targetHeight <= 0) return;

        cancelReanimatedAnimation(monthCalendarAnimatedHeight);
        cancelReanimatedAnimation(monthCalendarAnimatedDayHeight);
        monthCalendarHeightRef.current = targetHeight;
        monthCalendarDayHeightRef.current = targetLayout.dayHeight;
        monthCalendarTargetHeight.value = targetHeight;

        const liveCalendarHeight = monthCalendarAnimatedHeight.value;
        const liveDayHeight = monthCalendarAnimatedDayHeight.value;
        const shouldAnimateResponsiveDetailLayout =
            calendarViewMode === "detail"
            && !isDayTransitionActive
            && !isYearDepthTransitionActive
            && liveCalendarHeight > 0
            && liveDayHeight > 0
            && (
                Math.abs(liveCalendarHeight - targetHeight) > 0.5
                || Math.abs(liveDayHeight - targetLayout.dayHeight) > 0.5
            );
        if (shouldAnimateResponsiveDetailLayout) {
            const layoutEasing = reduceMotionEnabled
                ? ReanimatedEasing.out(ReanimatedEasing.cubic)
                : ReanimatedEasing.bezier(
                    ...DETAIL_MONTH_HEIGHT_MOTION.bezier
                );
            monthCalendarAnimatedHeight.value = withTiming(targetHeight, {
                duration: detailMonthHeightMotionDuration,
                easing: layoutEasing,
                reduceMotion: ReduceMotion.Never,
            });
            monthCalendarAnimatedDayHeight.value = withTiming(
                targetLayout.dayHeight,
                {
                    duration: detailMonthHeightMotionDuration,
                    easing: layoutEasing,
                    reduceMotion: ReduceMotion.Never,
                }
            );
            return;
        }

        monthCalendarAnimatedHeight.value = targetHeight;
        monthCalendarAnimatedDayHeight.value = targetLayout.dayHeight;
    }, [
        calendarViewMode,
        detailMonthHeightMotionDuration,
        isDayTransitionActive,
        isMonthViewTransitionActive,
        isYearDepthTransitionActive,
        monthCalendarAnimatedDayHeight,
        monthCalendarAnimatedHeight,
        monthCalendarTargetHeight,
        reduceMotionEnabled,
        resolveMonthCalendarLayout,
    ]);
    const dayPillBloomScaleX = dayTransition.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [1, CALENDAR_PILL_MOTION.bloomScaleX, 1],
    });
    const dayPillBloomScaleY = dayTransition.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [1, CALENDAR_PILL_MOTION.bloomScaleY, 1],
    });
    const primaryPillScaleX = reduceMotionEnabled ? 1 : dayPillBloomScaleX;
    const primaryPillScaleY = reduceMotionEnabled ? 1 : dayPillBloomScaleY;
    const primaryPillOpacity = yearOverviewProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0],
        extrapolate: "clamp",
    });
    const primaryPillTodayOpacity = Animated.multiply(
        primaryPillOpacity,
        todayFocusOpacity
    );
    const primaryPillYearTranslateX = reduceMotionEnabled
        ? 0
        : yearOverviewProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, CALENDAR_PILL_MOTION.yearHiddenTranslateX],
            extrapolate: "clamp",
        });
    const primaryPillYearScale = reduceMotionEnabled
        ? 1
        : yearOverviewProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [1, CALENDAR_PILL_MOTION.yearHiddenScale],
            extrapolate: "clamp",
        });
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
    const searchHeaderRightInset = usesLiquidViewModeControl
        ? ADD_MENU_SOURCE.nativeRightInset
        : ADD_MENU_SOURCE.fallbackRightInset;
    const searchHeaderTargetWidth = Math.max(
        LIQUID_TOOLBAR_ACTIONS_WIDTH,
        screenWidth - SEARCH_TOOLBAR_LEFT_INSET - searchHeaderRightInset
    );
    // Keep the native search width ready while collapsed, but limit the host to
    // the search bar's height. A full-height Fabric host still wins hit-testing
    // over calendar cells even when its UIKit child rejects the transparent
    // area. Menus expand the canvas only after the native control reports open.
    const liquidPrototypeLayerWidth = searchHeaderTargetWidth;
    const liquidPrototypeLayerHeight = liquidPrototypeOpen
        ? LIQUID_TOOLBAR_CONTROL_CANVAS_HEIGHT
        : LIQUID_TOOLBAR_SEARCH_HEIGHT;
    const requestCloseLiquidPrototype = useCallback(() => {
        if (!usesLiquidViewModeControl) return;
        // Swift closes its content first and then reports `onOpenChange(false)`,
        // which lets the JS host shrink without clipping the close morph.
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
    }, [
        addHandoffToolbarOpacity,
        clearQuickHandoffTimer,
    ]);
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
        inputRange: [0, SEARCH_FIELD_REVEAL_START_PROGRESS, 1],
        outputRange: [0, 0, 1],
        extrapolate: "clamp",
    });
    const searchFieldContentTranslateX = searchToolbarProgress.interpolate({
        inputRange: [0, SEARCH_FIELD_REVEAL_START_PROGRESS, 1],
        outputRange: [6, 6, 0],
        extrapolate: "clamp",
    });
    const searchFieldContentTranslateY = searchToolbarProgress.interpolate({
        inputRange: [0, SEARCH_FIELD_REVEAL_START_PROGRESS, 1],
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
    const showsStickyMonthTitle = shouldShowStickyMonthTitle(calendarViewMode);
    const primaryPillWeekdayGap = getPrimaryPillWeekdayGap(calendarViewMode);
    const reservedStickyCalendarHeaderHeight =
        getStickyCalendarHeaderHeight(calendarViewMode);
    const isStickyCalendarMode =
        calendarViewMode === "stack" ||
        calendarViewMode === "detail" ||
        calendarViewMode === "list";
    const nonSearchToolbarMenuActive =
        activeToolbarMenu !== null && activeToolbarMenu !== "search";
    const isFormOverlayVisible = modalVisible || quickModalVisible;
    const calendarOverlayOwnsAccessibility = isFormOverlayVisible || calendarSettingsVisible;
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
    const stickyCalendarHeaderTodayOpacity = Animated.multiply(
        stickyCalendarHeaderOpacity,
        todayFocusOpacity
    );
    const calendarHeaderOffset = useMemo(
        () => insets.top
            + CALENDAR_TOOLBAR_HEIGHT
            + (reservesStickyCalendarHeader ? reservedStickyCalendarHeaderHeight : 0),
        [
            insets.top,
            reservedStickyCalendarHeaderHeight,
            reservesStickyCalendarHeader,
        ]
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
    const stackBottomContentInset = bottomBarHidden
        ? 0
        : 44 + Math.max(insets.bottom, 10) + 16;
    const isAnyDepthTransitionActive =
        isDayTransitionActive ||
        isYearDepthTransitionActive ||
        isMonthViewTransitionActive ||
        isTodayFocusTransitionActive;
    const primaryPillInteractionEnabled =
        primaryPillVisible && !isAnyDepthTransitionActive;

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
            if (yearDepthTransitionFrameRef.current !== null) {
                cancelAnimationFrame(yearDepthTransitionFrameRef.current);
                yearDepthTransitionFrameRef.current = null;
            }
            monthViewCompletionAnimationRef.current?.stop();
            monthViewCompletionAnimationRef.current = null;
            if (monthViewTransitionWatchdogRef.current !== null) {
                clearTimeout(monthViewTransitionWatchdogRef.current);
                monthViewTransitionWatchdogRef.current = null;
            }
            todayFocusAnimationGenerationRef.current += 1;
            if (todayFocusWatchdogRef.current !== null) {
                clearTimeout(todayFocusWatchdogRef.current);
                todayFocusWatchdogRef.current = null;
            }
            todayFocusAnimationRef.current?.stop();
            todayFocusAnimationRef.current = null;
            todayFocusOpacity.stopAnimation();
            todayFocusTranslateY.stopAnimation();
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
        todayFocusOpacity,
        todayFocusTranslateY,
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
        const cached = readCalendarScheduleCache(scheduleFetchStartAt, scheduleFetchEndAt);
        const hasVisibleMonthCache = hasCalendarScheduleMonthCache(fetchVisibleMonth);

        const hasNewCachedItems = cached.items.some(
            (item) => scheduleItemsByIdRef.current[item.id] !== item
        );
        if (cached.cachedMonthKeys.length > 0 && hasNewCachedItems) {
            // 월 이동 대상은 초기 5개월 묶음에 포함되어 있으므로 즉시 표시한다.
            dispatch({ type: "SET_ITEMS", items: cached.items });
        }
        dispatch({ type: "SET_LOADING", loading: !hasVisibleMonthCache });
        dispatch({ type: "SET_ERROR", error: null });

        // 현재 보이는 월이 이미 준비돼 있으면 월 이동 자체로는 API를 호출하지 않는다.
        // 초기 진입 또는 캐시 범위를 벗어난 월에서만 앞뒤 2개월을 한 번에 다시 채운다.
        if (hasVisibleMonthCache) {
            dispatch({ type: "SET_LOADING", loading: false });
            return;
        }

        try {
            const refreshed = await refreshCalendarScheduleCache(
                scheduleFetchStartAt,
                scheduleFetchEndAt,
                getCalendarSchedules,
            );
            if (requestSequence !== scheduleLoadSequenceRef.current) return;
            dispatch({ type: "SET_ITEMS", items: refreshed.items });
        } catch (error) {
            if (requestSequence !== scheduleLoadSequenceRef.current) return;
            // 화면에 표시할 월이 캐시에 있으면 프리패치 실패가 기존 일정을 가리지 않게 한다.
            if (!hasVisibleMonthCache) {
                const message = getErrorMessage(error);
                dispatch({ type: "SET_ERROR", error: message });
            }
        } finally {
            if (requestSequence === scheduleLoadSequenceRef.current) {
                dispatch({ type: "SET_LOADING", loading: false });
            }
        }
    }, [dispatch, fetchVisibleMonth, scheduleFetchEndAt, scheduleFetchStartAt]);

    useEffect(() => {
        if (!isFocused) {
            dispatch({ type: "SET_LOADING", loading: false });
            return undefined;
        }

        const synchronizeAndLoad = () => {
            synchronizeCalendarScheduleCacheRevision()
                .then((changed) => {
                    // revision 변경 시 clear가 아래 구독자를 통해 한 번만 다시 조회한다.
                    if (!changed) loadSchedules();
                })
                .catch(loadSchedules);
        };
        synchronizeAndLoad();
        const subscription = AppState.addEventListener("change", (nextState) => {
            if (nextState !== "active") return;
            synchronizeAndLoad();
        });
        const unsubscribeInvalidated = subscribeCalendarScheduleCacheInvalidated(loadSchedules);
        return () => {
            subscription.remove();
            unsubscribeInvalidated();
            // 화면을 벗어나거나 조회 범위가 바뀐 뒤 도착한 응답이
            // 상세 화면의 최신 수정값을 덮지 못하도록 무효화한다.
            scheduleLoadSequenceRef.current += 1;
        };
    }, [dispatch, isFocused, loadSchedules]);

    const loadCalendarMetadata = useCallback(async () => {
        const requestedMonths = calendarMetadataPrefetchMonthKeys.map((monthKey) => ({
            monthKey,
            cacheKey: `${firstDay}:${monthKey}`,
        }));
        const missingMonths = requestedMonths.filter(({ cacheKey }) => (
            !calendarMetadataLoadedMonthKeysRef.current.has(cacheKey) &&
            !calendarMetadataInFlightMonthKeysRef.current.has(cacheKey)
        ));
        if (missingMonths.length === 0) return;

        const firstMissingMonth = missingMonths[0]?.monthKey ?? fetchVisibleMonth;
        const lastMissingMonth = missingMonths[missingMonths.length - 1]?.monthKey
            ?? fetchVisibleMonth;
        const requestStartDate = getCalendarMetadataRange(
            firstMissingMonth,
            firstDay
        ).startDate;
        const requestEndDate = getCalendarMetadataRange(
            lastMissingMonth,
            firstDay
        ).endDate;
        missingMonths.forEach(({ cacheKey }) => {
            calendarMetadataInFlightMonthKeysRef.current.add(cacheKey);
        });
        try {
            const days = await getCalendarDays(
                requestStartDate,
                requestEndDate
            );

            if (
                typeof __DEV__ === "boolean" &&
                __DEV__ &&
                days.length > 0 &&
                !days.some((day) => day.lunarMonth !== undefined && day.lunarDay !== undefined)
            ) {
                console.warn("[calendar-metadata] lunar data missing from successful response", {
                    startDate: requestStartDate,
                    endDate: requestEndDate,
                    receivedDays: days.length,
                });
            }

            const nextDaysByDate = indexCalendarDays(days);
            missingMonths.forEach(({ cacheKey }) => {
                calendarMetadataLoadedMonthKeysRef.current.add(cacheKey);
            });
            if (calendarMetadataMountedRef.current) {
                setCalendarDaysByDate((currentDaysByDate) => {
                    const missingEntries = Object.entries(nextDaysByDate).filter(
                        ([date]) => currentDaysByDate[date] === undefined
                    );
                    if (missingEntries.length === 0) return currentDaysByDate;
                    return {
                        ...currentDaysByDate,
                        ...Object.fromEntries(missingEntries),
                    };
                });
            }
        } catch (error) {
            // 음력/공휴일은 보조 정보다. 조회 실패가 일정 화면을 막거나 오류 배너를
            // 띄우지 않도록, 마지막으로 성공한 메타데이터를 그대로 유지한다.
            if (typeof __DEV__ === "boolean" && __DEV__) {
                console.warn("[calendar-metadata] load failed", {
                    startDate: requestStartDate,
                    endDate: requestEndDate,
                    message: error instanceof Error ? error.message : "unknown error",
                });
            }
        } finally {
            missingMonths.forEach(({ cacheKey }) => {
                calendarMetadataInFlightMonthKeysRef.current.delete(cacheKey);
            });
        }
    }, [calendarMetadataPrefetchMonthKeys, fetchVisibleMonth, firstDay]);

    useEffect(() => {
        if (!isFocused) return undefined;

        loadCalendarMetadata();
        const subscription = AppState.addEventListener("change", (nextState) => {
            if (nextState === "active") loadCalendarMetadata();
        });
        return () => {
            subscription.remove();
        };
    }, [isFocused, loadCalendarMetadata]);

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

    const refreshNotificationUnreadCount = useCallback(() => {
        getAppNotificationUnreadCount()
            .then(setNotificationUnreadCount)
            .catch(() => {
                // 알림 배지는 보조 정보다. 일시적인 조회 실패가 캘린더 사용을 막지 않는다.
            });
    }, []);

    useEffect(() => {
        if (!isFocused) return undefined;

        refreshNotificationUnreadCount();
        const timer = setInterval(refreshNotificationUnreadCount, SHARE_ATTENTION_REFRESH_MS);
        const appStateSubscription = AppState.addEventListener("change", (nextState) => {
            if (nextState === "active") refreshNotificationUnreadCount();
        });
        const unsubscribeReceived = subscribeAppNotificationReceived(
            refreshNotificationUnreadCount,
        );

        return () => {
            clearInterval(timer);
            appStateSubscription.remove();
            unsubscribeReceived();
        };
    }, [isFocused, refreshNotificationUnreadCount]);

    useEffect(() => {
        let cancelled = false;
        setCategoryLoading(true);

        getScheduleCategoriesFromApi()
            .then((categories) => {
                if (cancelled) return;
                dispatch({ type: "SET_CATEGORIES", categories });
                setCategoryError(null);
            })
            .catch(() => {
                if (!cancelled) {
                    setCategoryError("카테고리를 불러오지 못했어요.");
                }
            })
            .finally(() => {
                if (!cancelled) setCategoryLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [categoryRetryKey, dispatch]);

    const retryCategoryLoad = useCallback(() => {
        setCategoryRetryKey((value) => value + 1);
    }, []);

    const itemsArray = useMemo(
        () => Object.values(state.itemsById),
        [state.itemsById]
    );
    const loadRouteSetupItems = useCallback(async () => {
        const items = await getSchedules();
        return items.filter((item) => item.routeSetupRequired === true);
    }, []);
    useEffect(() => {
        if (!isFocused) return;

        let cancelled = false;
        const refresh = () => {
            loadRouteSetupItems()
                .then((items) => {
                    if (!cancelled) setRouteSetupItems(items);
                })
                .catch(() => {
                    // 후속 설정 배너는 보조 UI이므로 조회 실패가 캘린더 사용을 막지 않는다.
                    if (!cancelled) setRouteSetupItems([]);
                });
        };

        refresh();
        const subscription = AppState.addEventListener("change", (nextState) => {
            if (nextState === "active") refresh();
        });
        return () => {
            cancelled = true;
            subscription.remove();
        };
    }, [isFocused, loadRouteSetupItems]);
    const writableCategories = useMemo(
        () => getWritableScheduleCategories(state.categories),
        [state.categories]
    );
    useEffect(() => {
        const keyword = searchQuery.trim();
        const sequence = searchSequenceRef.current + 1;
        searchSequenceRef.current = sequence;
        if (!keyword) {
            setSearchResults([]);
            setSearchLoading(false);
            setSearchError(null);
            return undefined;
        }

        setSearchLoading(true);
        setSearchError(null);
        const timer = setTimeout(() => {
            searchSchedules({ keyword })
                .then((items) => {
                    if (searchSequenceRef.current !== sequence) return;
                    setSearchResults(items
                        .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
                        .slice(0, 20));
                })
                .catch((error) => {
                    if (searchSequenceRef.current !== sequence) return;
                    setSearchResults([]);
                    setSearchError(getErrorMessage(error));
                })
                .finally(() => {
                    if (searchSequenceRef.current === sequence) setSearchLoading(false);
                });
        }, 300);

        return () => clearTimeout(timer);
    }, [searchQuery, searchRetryKey]);

    // 새 일정 payload를 백엔드에 저장한 뒤 응답 값을 일정 저장소에 추가한다.
    const addItem = async (
        payload: Omit<ScheduleItem, "id">,
        { showErrorAlert = true }: AddItemOptions = {},
    ) => {
        try {
            const item = await createSchedule(payload);
            // 생성 요청보다 먼저 시작된 캘린더 조회는 새 일정을 포함하지 않을 수 있다.
            // 해당 응답을 무효화해 방금 저장한 일정이 화면에서 다시 사라지지 않게 한다.
            scheduleLoadSequenceRef.current += 1;
            dispatch({ type: "ADD_ITEM", item });
            dispatch({ type: "SET_LOADING", loading: false });
        } catch (error) {
            const message = getErrorMessage(error);
            if (showErrorAlert) {
                Alert.alert("일정 등록 실패", message);
            }
            throw error;
        }
    };

    const closeToolbarMenu = useCallback((afterClose?: () => void) => {
        if (activeToolbarMenu === "search" && usesLiquidViewModeControl) {
            setSearchQuery("");
            setToolbarMenuClosing(true);
            requestCloseLiquidPrototype();
            afterClose?.();
            return;
        }

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
    }, [
        activeToolbarMenu,
        requestCloseLiquidPrototype,
        searchToolbarProgress,
        toolbarDropdownProgress,
        usesLiquidViewModeControl,
    ]);

    const runToolbarAction = useCallback((action: () => void) => {
        if (activeToolbarMenu === "search" && usesLiquidViewModeControl) {
            requestCloseLiquidPrototype();
            setActiveToolbarMenu(null);
            setToolbarMenuClosing(false);
            requestAnimationFrame(action);
            return;
        }

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
    }, [
        activeToolbarMenu,
        requestCloseLiquidPrototype,
        toolbarDropdownProgress,
        usesLiquidViewModeControl,
    ]);

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
                    duration: SEARCH_TOOLBAR_OPEN_DURATION_MS,
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
    }, [
        activeToolbarMenu,
        closeToolbarMenu,
        searchToolbarProgress,
        toolbarDropdownProgress,
    ]);

    const openSearchToolbar = useCallback((nativeContext?: {
        generation: number;
        session: string;
    }) => {
        if (nativeContext) {
            if (
                nativeContext.session
                && nativeSearchSessionRef.current !== nativeContext.session
            ) {
                nativeSearchSessionRef.current = nativeContext.session;
                nativeSearchGenerationRef.current = nativeContext.generation;
            } else {
                nativeSearchGenerationRef.current = Math.max(
                    nativeSearchGenerationRef.current,
                    nativeContext.generation,
                );
            }
        }
        setSearchQuery("");
        if (usesLiquidViewModeControl) {
            setToolbarMenuClosing(false);
            setActiveToolbarMenu("search");
            return;
        }
        openToolbarMenu("search");
    }, [
        openToolbarMenu,
        usesLiquidViewModeControl,
    ]);

    const closeSearchToolbar = useCallback(() => {
        if (usesLiquidViewModeControl) {
            // Swift owns the reverse morph. Do not enqueue calendar state work
            // ahead of its close-complete event; that previously stalled the
            // next search tap for more than a second under repeated input.
            return;
        }
        setSearchQuery("");
        closeToolbarMenu();
    }, [
        closeToolbarMenu,
        usesLiquidViewModeControl,
    ]);

    const handleLiquidPrototypeOpenChange = useCallback((
        open: boolean,
        context: {
            search: boolean;
            generation: number;
            session: string;
        },
    ) => {
        if (context.search && context.session) {
            const currentSession = nativeSearchSessionRef.current;
            if (currentSession && currentSession !== context.session) {
                return;
            }
            if (!currentSession) {
                nativeSearchGenerationRef.current = context.generation;
                nativeSearchSessionRef.current = context.session;
            }
        }

        if (
            !open
            && context.search
            && context.generation < nativeSearchGenerationRef.current
        ) {
            return;
        }

        setLiquidPrototypeOpen(open);
        if (open) return;

        setSearchQuery("");
        setToolbarMenuClosing(false);
        setActiveToolbarMenu((currentMenu) => (
            currentMenu === "search" ? null : currentMenu
        ));
    }, []);

    useEffect(() => {
        if (!isSearchToolbarOpen || usesLiquidViewModeControl) return;

        const focusFrame = requestAnimationFrame(() => {
            searchInputRef.current?.focus();
        });

        return () => cancelAnimationFrame(focusFrame);
    }, [isSearchToolbarOpen, usesLiquidViewModeControl]);

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

    const openSharedCalendarManager = () => {
        runToolbarAction(() => {
            router.push("/schedule/calendars");
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

    const handleQuickAnalyze = async (text: string, media?: QuickScheduleMediaInput) => {
        // 사진/음성은 서버로 파일을 보내지 않는다. iOS 네이티브에서 텍스트를 먼저 추출하고,
        // 기존 빠른일정 파서가 이해하는 텍스트와 기기 인식 신뢰도만 백엔드에 전달한다.
        const parseInput = await resolveQuickScheduleParseInput(text, media);

        return parseScheduleText({
            text: parseInput.text,
            inputType: parseInput.inputType,
            recognitionConfidence: parseInput.recognitionConfidence,
            // `referenceDate`는 "오늘", "내일" 같은 상대 날짜 표현의 기준이다.
            // 캘린더에서 보고 있는 날짜는 다른 달일 수 있으므로, 빠른 자연어 입력은
            // 앱이 주기적으로 갱신하는 실제 오늘 날짜를 기준으로 분석한다.
            referenceDate: todayKey,
            defaultDurationMinutes: 60,
        });
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

    const addQuickItem = async (payload: Omit<ScheduleItem, "id">) => {
        // 빠른 일정 모달이 저장 오류를 표시하므로 상위 Alert는 중복 노출하지 않는다.
        await addItem(payload, { showErrorAlert: false });

        const savedDay = getScheduleFocusDay(payload.startAt);
        if (savedDay) selectCalendarDay(savedDay);

    };

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
        }, CALENDAR_INTERACTION_BUDGET_MS);

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
            if (finished || forceValue) {
                yearOverviewProgress.stopAnimation();
                yearOverviewProgress.setValue(toValue);
            }
            transitionStartedRef.current = false;
            if (finished || forceValue) {
                unstable_batchedUpdates(() => {
                    afterAnimation?.();
                    setIsYearDepthTransitionActive(false);
                });
                return;
            }
            setIsYearDepthTransitionActive(false);
        };

        const duration = reduceMotionEnabled
            ? CALENDAR_DEPTH_MOTION.reduceMotionDurationMs
            : CALENDAR_DEPTH_MOTION.depthSlideDurationMs;
        dayTransitionCleanupTimerRef.current = setTimeout(() => {
            finishTransition(true, true);
        }, CALENDAR_INTERACTION_BUDGET_MS);

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
    }, [
        dayTransition,
        selectCalendarDay,
    ]);

    const handleShiftDay = useCallback((offset: number) => {
        const nextDay = addDaysToYmd(selectedDayRef.current, offset);
        setDayTransitionTargetDay(null);
        selectCalendarDay(nextDay);
        setDayLayerMounted(true);
        setCalendarDepth("day");
        dayTransition.setValue(1);
    }, [
        dayTransition,
        selectCalendarDay,
    ]);

    const handleNavigateTodayFromDayDisplay = useCallback((day: string) => {
        setDayTransitionTargetDay(null);
        selectCalendarDay(day);
        setDayLayerMounted(true);
        setCalendarDepth("day");
        dayTransition.setValue(1);
    }, [dayTransition, selectCalendarDay]);

    const handleOpenScheduleFromDayDisplay = useCallback((id: string) => {
        router.push({
            pathname: "/schedule/[id]",
            params: { id },
        });
    }, [router]);

    const handleOpenDay = useCallback((day: string) => {
        if (
            isDayTransitionActiveRef.current ||
            isYearDepthTransitionActiveRef.current ||
            transitionStartedRef.current ||
            viewTransitioningRef.current
        ) return;
        transitionStartedRef.current = true;
        const wasDayLayerMounted = dayLayerMountedRef.current;

        closeToolbarMenu();
        calendarTransition.stopAnimation();
        calendarTransition.setValue(1);
        dayTransition.stopAnimation();
        dayTransition.setValue(0);
        setDayTransitionTargetDay(day);
        dayDisplayPrepareRef.current?.(day);
        setTodayButtonPrimed(day === todayKey);
        setTransitionMonthKey(
            day.slice(0, 7) === selectedDayRef.current.slice(0, 7)
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
        const startTransition = () => {
            animateDayTransition(1, () => {
                setPendingSelectedDay(day);
                dispatch({ type: "SET_SELECTED_DAY", day });
                setVisibleMonth(day);
                setCalendarDepth("day");
                setDayTransitionTargetDay(null);
                setTransitionMonthKey(null);
            }, "monthToDay");
        };
        if (wasDayLayerMounted) {
            startTransition();
        } else {
            requestAnimationFrame(startTransition);
        }
    }, [
        animateDayTransition,
        calendarTransition,
        closeToolbarMenu,
        dayTransition,
        dayModeTransition,
        dispatch,
        todayKey,
        yearOverviewProgress,
    ]);

    const closeDayDisplay = useCallback(() => {
        if (calendarDepth !== "day" && !dayLayerMounted) return;
        if (
            dayPageNavigationActiveRef.current ||
            isDayTransitionActive ||
            isYearDepthTransitionActive ||
            transitionStartedRef.current
        ) return;
        transitionStartedRef.current = true;

        closeToolbarMenu();
        setDayTransitionTargetDay(selectedDay);
        setDayModeTransitionFrom(null);
        setTransitionMonthKey(null);
        setDayTransitionContext("dayToMonth");
        setIsDayTransitionActive(true);
        animateDayTransition(0, () => {
            setCalendarDepth("month");
            setDayTransitionTargetDay(null);
            setTransitionMonthKey(null);
        }, "dayToMonth");
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
        setVisibleMonth(todayKey);
        setCalendarScrollRequest((request) => request + 1);
        setTodayButtonPrimed(true);
        if (options?.revealImmediately !== false) {
            calendarTransition.setValue(1);
        }
    }, [calendarTransition, closeToolbarMenu, dispatch, todayKey]);

    const finishTodayFocusTransition = useCallback((
        generation: number,
        commitIfNeeded = false
    ) => {
        if (generation !== todayFocusAnimationGenerationRef.current) return;

        todayFocusAnimationGenerationRef.current += 1;
        const activeAnimation = todayFocusAnimationRef.current;
        todayFocusAnimationRef.current = null;

        if (todayFocusWatchdogRef.current !== null) {
            clearTimeout(todayFocusWatchdogRef.current);
            todayFocusWatchdogRef.current = null;
        }
        activeAnimation?.stop();
        if (commitIfNeeded && !todayFocusCommittedRef.current) {
            todayFocusCommittedRef.current = true;
            focusTodayOnCalendar({ revealImmediately: false });
        }

        todayFocusOpacity.stopAnimation();
        todayFocusTranslateY.stopAnimation();
        todayFocusOpacity.setValue(1);
        todayFocusTranslateY.setValue(0);
        todayFocusAnimationActiveRef.current = false;
        todayFocusCommittedRef.current = false;
        todayFocusEnterStartedRef.current = false;
        transitionStartedRef.current = false;
        setTodayFocusTarget(null);
        setIsTodayFocusTransitionActive(false);
    }, [focusTodayOnCalendar, todayFocusOpacity, todayFocusTranslateY]);

    const startTodayFocusEnterTransition = useCallback((generation: number) => {
        if (
            generation !== todayFocusAnimationGenerationRef.current ||
            !todayFocusAnimationActiveRef.current ||
            !todayFocusCommittedRef.current ||
            todayFocusEnterStartedRef.current
        ) return;

        todayFocusEnterStartedRef.current = true;
        const reduceMotion = todayFocusReduceMotionRef.current;
        const enterDuration = reduceMotion
            ? CALENDAR_TODAY_FOCUS_MOTION.reduceMotionEnterDurationMs
            : CALENDAR_TODAY_FOCUS_MOTION.enterDurationMs;
        const easing = reduceMotion
            ? Easing.out(Easing.cubic)
            : CALENDAR_DEPTH_EASING;
        const enterAnimation = Animated.parallel([
            Animated.timing(todayFocusOpacity, {
                toValue: 1,
                duration: enterDuration,
                easing,
                useNativeDriver: true,
                isInteraction: false,
            }),
            Animated.timing(todayFocusTranslateY, {
                toValue: 0,
                duration: enterDuration,
                easing,
                useNativeDriver: true,
                isInteraction: false,
            }),
        ]);
        todayFocusAnimationRef.current = enterAnimation;
        enterAnimation.start(() => finishTodayFocusTransition(generation));
    }, [
        finishTodayFocusTransition,
        todayFocusOpacity,
        todayFocusTranslateY,
    ]);

    const handleTodayFocusReady = useCallback((day: string) => {
        if (day !== todayKey) return;
        startTodayFocusEnterTransition(
            todayFocusAnimationGenerationRef.current
        );
    }, [startTodayFocusEnterTransition, todayKey]);

    const registerDetailMonthMotionCancel = useCallback((cancel: (() => void) | null) => {
        detailMonthMotionCancelRef.current = cancel;
    }, []);

    const startTodayFocusTransition = useCallback(() => {
        if (
            todayFocusAnimationActiveRef.current ||
            isDayTransitionActiveRef.current ||
            isYearDepthTransitionActiveRef.current ||
            transitionStartedRef.current ||
            viewTransitioningRef.current
        ) return;

        detailMonthMotionCancelRef.current?.();
        const generation = todayFocusAnimationGenerationRef.current + 1;
        todayFocusAnimationGenerationRef.current = generation;
        todayFocusAnimationActiveRef.current = true;
        todayFocusCommittedRef.current = false;
        todayFocusEnterStartedRef.current = false;
        todayFocusReduceMotionRef.current = reduceMotionEnabled;
        transitionStartedRef.current = true;
        setTodayFocusTarget(null);
        setIsTodayFocusTransitionActive(true);
        closeToolbarMenu();

        const travel = reduceMotionEnabled
            ? CALENDAR_TODAY_FOCUS_MOTION.reduceMotionTravel
            : CALENDAR_TODAY_FOCUS_MOTION.outgoingTravel;
        const exitDuration = reduceMotionEnabled
            ? CALENDAR_TODAY_FOCUS_MOTION.reduceMotionExitDurationMs
            : CALENDAR_TODAY_FOCUS_MOTION.exitDurationMs;
        const incomingTravel = reduceMotionEnabled
            ? CALENDAR_TODAY_FOCUS_MOTION.reduceMotionTravel
            : CALENDAR_TODAY_FOCUS_MOTION.incomingTravel;
        const easing = reduceMotionEnabled
            ? Easing.out(Easing.cubic)
            : CALENDAR_DEPTH_EASING;

        todayFocusAnimationRef.current?.stop();
        todayFocusOpacity.stopAnimation();
        todayFocusTranslateY.stopAnimation();
        todayFocusOpacity.setValue(1);
        todayFocusTranslateY.setValue(0);

        todayFocusWatchdogRef.current = setTimeout(() => {
            finishTodayFocusTransition(generation, true);
        }, CALENDAR_INTERACTION_BUDGET_MS);

        const exitAnimation = Animated.parallel([
            Animated.timing(todayFocusOpacity, {
                toValue: 0,
                duration: exitDuration,
                easing,
                useNativeDriver: true,
                isInteraction: false,
            }),
            Animated.timing(todayFocusTranslateY, {
                toValue: -travel,
                duration: exitDuration,
                easing,
                useNativeDriver: true,
                isInteraction: false,
            }),
        ]);
        todayFocusAnimationRef.current = exitAnimation;
        exitAnimation.start(({ finished }) => {
            if (generation !== todayFocusAnimationGenerationRef.current) return;
            if (!finished) {
                finishTodayFocusTransition(generation);
                return;
            }

            todayFocusAnimationRef.current = null;
            todayFocusOpacity.setValue(0);
            todayFocusTranslateY.setValue(incomingTravel);
            todayFocusCommittedRef.current = true;
            setTodayFocusTarget({
                day: todayKey,
                requiresMonthChange:
                    visibleMonth.slice(0, 7) !== todayKey.slice(0, 7),
            });
            focusTodayOnCalendar({ revealImmediately: false });
        });
    }, [
        closeToolbarMenu,
        finishTodayFocusTransition,
        focusTodayOnCalendar,
        reduceMotionEnabled,
        todayKey,
        todayFocusOpacity,
        todayFocusTranslateY,
        visibleMonth,
    ]);

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
            const isTodayAlreadyFocused =
                selectedDay === todayKey &&
                visibleMonth.slice(0, 7) === todayKey.slice(0, 7);
            if (calendarDepth === "month" && !isTodayAlreadyFocused) {
                startTodayFocusTransition();
            } else {
                focusTodayOnCalendar();
            }
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
            setCalendarDepth("month");
            dayTransition.setValue(0);
            yearOverviewProgress.setValue(0);
            calendarTransition.setValue(1);
        }
    }, [
        calendarTransition,
        calendarDepth,
        closeToolbarMenu,
        dayTransition,
        dispatch,
        focusDayRequest,
        focusRequest,
        focusRun,
        focusTodayOnCalendar,
        handleOpenDay,
        selectedDay,
        startTodayFocusTransition,
        todayKey,
        visibleMonth,
        yearOverviewProgress,
    ]);

    const handleGoToday = useCallback(() => {
        if (todayFocusAnimationActiveRef.current) return;

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

        startTodayFocusTransition();
    }, [
        calendarDepth,
        closeToolbarMenu,
        dayTransition,
        handleOpenDay,
        selectCalendarDay,
        selectedDay,
        startTodayFocusTransition,
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
        if (monthViewTransitionWatchdogRef.current !== null) {
            clearTimeout(monthViewTransitionWatchdogRef.current);
            monthViewTransitionWatchdogRef.current = null;
        }
        monthViewCompletionAnimationRef.current?.stop();
        monthViewCompletionAnimationRef.current = null;
        const agendaTransition = getMonthAgendaTransition(calendarViewMode, nextMode);
        const nextAgendaPanelKind = getMonthAgendaPanelKind(nextMode);
        const targetAgendaProgress = nextAgendaPanelKind ? 1 : 0;
        const sourceLayout = resolveMonthCalendarLayout(calendarViewMode);
        const targetLayout = resolveMonthCalendarLayout(nextMode);
        const liveCalendarHeight = monthCalendarAnimatedHeight.value;
        const liveDayHeight = monthCalendarAnimatedDayHeight.value;
        const sourceHeight = (
            Number.isFinite(liveCalendarHeight) && liveCalendarHeight > 0
        )
            ? liveCalendarHeight
            : monthCalendarHeightRef.current
            || sourceLayout.calendarHeight
            || monthDisplayHeightRef.current;
        const sourceDayHeight = (
            Number.isFinite(liveDayHeight) && liveDayHeight > 0
        )
            ? liveDayHeight
            : monthCalendarDayHeightRef.current || sourceLayout.dayHeight;
        const targetCalendarHeight = targetLayout.calendarHeight || sourceHeight;
        const targetDayHeight = targetLayout.dayHeight;
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
        monthCalendarAnimatedDayHeight.value = sourceDayHeight;
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

        let transitionFinalized = false;
        const finishMonthViewTransition = () => {
            if (
                transitionFinalized
                || transitionGeneration !== monthViewTransitionGenerationRef.current
            ) return;

            transitionFinalized = true;
            if (monthViewTransitionWatchdogRef.current !== null) {
                clearTimeout(monthViewTransitionWatchdogRef.current);
                monthViewTransitionWatchdogRef.current = null;
            }
            if (monthViewTransitionFrameRef.current !== null) {
                cancelAnimationFrame(monthViewTransitionFrameRef.current);
                monthViewTransitionFrameRef.current = null;
            }
            monthViewCompletionAnimationRef.current = null;
            cancelReanimatedAnimation(monthCalendarAnimatedHeight);
            monthCalendarAnimatedHeight.value = targetCalendarHeight;
            monthCalendarTargetHeight.value = targetCalendarHeight;
            cancelReanimatedAnimation(monthCalendarAnimatedDayHeight);
            monthCalendarAnimatedDayHeight.value = targetDayHeight;
            monthCalendarHeightRef.current = targetCalendarHeight;
            monthCalendarDayHeightRef.current = targetDayHeight;
            monthCalendarTransitionProgress.setValue(1);
            monthAgendaProgress.setValue(targetAgendaProgress);
            monthAgendaSwapProgress.setValue(1);
            setOutgoingMonthAgendaPanelKind(null);
            setIsMonthViewTransitionActive(false);
            viewTransitioningRef.current = false;
        };

        monthViewTransitionWatchdogRef.current = setTimeout(() => {
            if (transitionGeneration !== monthViewTransitionGenerationRef.current) return;

            const activeAnimation = monthViewCompletionAnimationRef.current;
            monthViewCompletionAnimationRef.current = null;
            activeAnimation?.stop();
            finishMonthViewTransition();
        }, CALENDAR_INTERACTION_BUDGET_MS);

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
                targetDayHeight,
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
            completionAnimation.start(() => {
                if (transitionGeneration !== monthViewTransitionGenerationRef.current) {
                    return;
                }

                // A cancelled native animation still leaves nextMode committed.
                // Always reconcile to that endpoint so toolbar hit-testing and
                // subsequent view changes cannot remain permanently locked.
                finishMonthViewTransition();
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
        resolveMonthCalendarLayout,
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
        if (dayPageNavigationActiveRef.current || isDayTransitionActive) {
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
        if (
            isYearDepthTransitionActiveRef.current ||
            isDayTransitionActiveRef.current ||
            transitionStartedRef.current
        ) return;
        transitionStartedRef.current = true;
        const monthKey = `${year}-${String(month).padStart(2, "0")}`;
        const currentDay = Number(selectedDayRef.current.slice(8, 10)) || 1;
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
        setTodayButtonPrimed(targetSelection === todayKey);
        setYearOverviewClosing(true);
        setIsYearDepthTransitionActive(true);

        // Let the off-screen target month commit once before starting the
        // native slide. This avoids competing with Calendar/Fabric layout in
        // the first visible transition frame.
        if (yearDepthTransitionFrameRef.current !== null) {
            cancelAnimationFrame(yearDepthTransitionFrameRef.current);
        }
        yearDepthTransitionFrameRef.current = requestAnimationFrame(() => {
            yearDepthTransitionFrameRef.current = null;
            animateYearDepthTransition(0, () => {
                setCalendarDepth("month");
                yearOverviewProgress.setValue(0);
                calendarTransition.setValue(1);
                setTransitionMonthKey(null);
                setYearOverviewVisible(false);
                setYearOverviewClosing(false);
                setDayTransitionContext("idle");
                setPendingSelectedDay(targetSelection);
                setFetchVisibleMonth(targetSelection);
                dispatch({ type: "SET_SELECTED_DAY", day: targetSelection });
            });
        });
    }, [
        animateYearDepthTransition,
        calendarTransition,
        closeToolbarMenu,
        dayTransition,
        dispatch,
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
        setYearOverviewPresentationRequest((request) => request + 1);
        setYearOverviewClosing(false);
        setYearOverviewVisible(true);
        setIsYearDepthTransitionActive(true);
        setDayTransitionContext("idle");
        calendarTransition.stopAnimation();
        yearOverviewProgress.setValue(0);
        calendarTransition.setValue(1);

        animateYearDepthTransition(1, () => {
            setCalendarDepth("year");
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

    const openCalendarSettings = useCallback(() => {
        closeToolbarMenu(() => setCalendarSettingsVisible(true));
    }, [closeToolbarMenu]);

    const routeSetupTarget = useMemo(() => {
        const now = Date.now();
        return [...routeSetupItems].sort((a, b) => {
            const aTime = new Date(a.startAt).getTime();
            const bTime = new Date(b.startAt).getTime();
            const aFuture = aTime >= now;
            const bFuture = bTime >= now;
            if (aFuture !== bFuture) return aFuture ? -1 : 1;
            return aFuture ? aTime - bTime : bTime - aTime;
        })[0];
    }, [routeSetupItems]);

    const openRouteSetupTarget = useCallback(() => {
        if (!routeSetupTarget) return;
        router.push(buildRouteSetupEntryRoute(routeSetupTarget.id));
    }, [routeSetupTarget, router]);

    const handleFirstDayChange = useCallback((nextFirstDay: 0 | 1) => {
        setFirstDay(nextFirstDay);
        AsyncStorage.setItem(CALENDAR_FIRST_DAY_STORAGE_KEY, String(nextFirstDay))
            .catch(() => undefined);
    }, []);

    const bottomLeftActions = useMemo<FloatingBarAction[]>(() => [{
            key: "today",
            label: "오늘",
            accessibilityLabel: "오늘 날짜로 이동",
            onPress: handleGoToday,
        }], [handleGoToday]);

    const openInvitesShortcut = useCallback(() => {
        router.push({ pathname: "/share/inbox", params: { tab: "all" } });
    }, [router]);

    const openNotificationInbox = useCallback(() => {
        router.push("/notifications");
    }, [router]);

    const shareBadgeCount = shareAttention.unseenCount;

    const bottomRightActions = useMemo<FloatingBarAction[]>(() => [{
        key: "notification-inbox-shortcut",
        icon: "notifications-outline",
        badgeCount: notificationUnreadCount,
        emphasized: notificationUnreadCount > 0,
        accessibilityLabel: notificationUnreadCount > 0
            ? `알림함, 읽지 않은 알림 ${notificationUnreadCount}개`
            : "알림함",
        onPress: openNotificationInbox,
    }, {
        key: "share-inbox-shortcut",
        icon: "mail-unread-outline",
        badgeCount: shareBadgeCount,
        emphasized: shareBadgeCount > 0,
        accessibilityLabel: shareBadgeCount > 0
            ? `공유함, 새 공유 또는 초대 ${shareBadgeCount}개`
            : "공유함",
        onPress: openInvitesShortcut,
    }, {
        key: "calendar-settings-shortcut",
        icon: "settings-outline",
        accessibilityLabel: "캘린더 설정",
        onPress: openCalendarSettings,
    }, {
        key: "profile-shortcut",
        icon: "person-circle-outline",
        accessibilityLabel: "프로필",
        onPress: openProfile,
    }], [
        notificationUnreadCount,
        openCalendarSettings,
        openInvitesShortcut,
        openNotificationInbox,
        openProfile,
        shareBadgeCount,
    ]);

    const renderMonthAgendaPanelContent = (panelKind: MonthAgendaPanelKind) => (
        panelKind === "detail" ? (
            <MemoizedSelectedDayAgendaPanel
                selectedDay={monthDisplaySelectedDay}
                items={itemsArray}
                loading={state.loading}
                error={sanitizeCalendarTransitionError(scheduleError)}
                bottomInset={insets.bottom}
                onPressRetry={loadSchedules}
                onOpenSchedule={handleOpenScheduleFromDayDisplay}
                routeSetupRequiredCount={routeSetupItems.length}
                onOpenRouteSetup={openRouteSetupTarget}
                onRequestViewMode={handleCalendarViewModeChange}
            />
        ) : (
            <MemoizedMonthAgendaList
                visibleMonth={monthDisplayFocusedMonth}
                items={itemsArray}
                loading={state.loading}
                error={sanitizeCalendarTransitionError(scheduleError)}
                bottomInset={insets.bottom}
                onPressRetry={loadSchedules}
                onOpenSchedule={handleOpenScheduleFromDayDisplay}
                routeSetupRequiredCount={routeSetupItems.length}
                onOpenRouteSetup={openRouteSetupTarget}
                onRequestViewMode={handleCalendarViewModeChange}
            />
        )
    );

    return (
        <ScheduleRouteFocusBoundary
            focused={isFocused}
            testID="schedule-index-route-root"
            style={[styles.root, { backgroundColor: colors.calendarBackground }]}
        >
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />

            {categoryError ? (
                <View
                    accessibilityElementsHidden={calendarOverlayOwnsAccessibility}
                    importantForAccessibility={
                        calendarOverlayOwnsAccessibility ? "no-hide-descendants" : "auto"
                    }
                    style={[
                        styles.categoryErrorLayer,
                        { top: insets.top + LIQUID_TOOLBAR_TOP_OFFSET + LIQUID_TOOLBAR_BUTTON_SIZE + 10 },
                    ]}
                >
                    <CategoryLoadErrorBanner
                        retrying={categoryLoading}
                        onRetry={retryCategoryLoad}
                    />
                </View>
            ) : null}

            <View
                pointerEvents="none"
                style={[
                    styles.bottomMaterialLayer,
                    mode === "dark" ? styles.bottomMaterialLayerDark : styles.bottomMaterialLayerLight,
                ]}
            />

            <View
                pointerEvents={isAnyDepthTransitionActive ? "none" : "box-none"}
                accessibilityElementsHidden={calendarOverlayOwnsAccessibility}
                importantForAccessibility={
                    calendarOverlayOwnsAccessibility ? "no-hide-descendants" : "auto"
                }
                style={styles.toolbarLayer}
            >
                {(activeToolbarMenu !== null || toolbarMenuClosing || liquidPrototypeOpen) && (
                    <Pressable
                        accessible={false}
                        disabled={toolbarMenuClosing}
                        style={[
                            styles.toolbarDropdownBackdrop,
                            liquidPrototypeOpen && styles.liquidToolbarBackdrop,
                        ]}
                        onPress={() => closeToolbarMenu()}
                    />
                )}

                {(
                    <Animated.View
                        pointerEvents="box-none"
                        {...getScheduleAccessibilityVisibility(!isSearchToolbarOpen)}
                        style={[
                            styles.toolbarChromeLayer,
                            {
                                paddingTop: insets.top,
                            },
                        ]}
                    >
                        <View style={styles.toolbar}>
                            <Reanimated.View
                                testID="calendar-primary-pill-host"
                                pointerEvents={primaryPillInteractionEnabled ? "box-none" : "none"}
                                accessibilityElementsHidden={
                                    !primaryPillInteractionEnabled
                                    || usesLiquidViewModeControl
                                }
                                importantForAccessibility={
                                    primaryPillInteractionEnabled
                                    && !usesLiquidViewModeControl
                                        ? "auto"
                                        : "no-hide-descendants"
                                }
                                style={[
                                    styles.primaryDatePillHost,
                                    primaryPillAnimatedStyle,
                                ]}
                            >
                                <Animated.View
                                    testID="calendar-primary-pill-motion"
                                    style={[
                                        styles.yearGlassMotion,
                                        {
                                            opacity: primaryPillTodayOpacity,
                                            transform: [
                                                { translateY: todayFocusTranslateY },
                                                { translateX: primaryPillYearTranslateX },
                                                { scale: primaryPillYearScale },
                                                { scaleX: primaryPillScaleX },
                                                { scaleY: primaryPillScaleY },
                                            ],
                                        },
                                    ]}
                                >
                                    {isLiquidGlassIconButtonAvailable ? (
                                        <Pressable
                                            onPress={handlePrimaryDateButtonPress}
                                            disabled={!primaryPillInteractionEnabled}
                                            accessibilityLabel={pillTargetDepth === "day" ? "월 화면으로 돌아가기" : `${visibleYear}년 전체 월 보기`}
                                            accessibilityRole="button"
                                            style={({ pressed }) => [
                                                styles.yearGlass,
                                                {
                                                    width: "100%",
                                                    opacity: pressed ? 0.68 : 1,
                                                    transform: [{ scale: pressed ? 0.96 : 1 }],
                                                },
                                            ]}
                                        >
                                            <LiquidGlassIconButton
                                                pointerEvents="none"
                                                leadingSymbolName="chevron.left"
                                                label={visiblePrimaryLabel}
                                                buttonWidth={primaryPillContentWidth}
                                                buttonHeight={LIQUID_TOOLBAR_BUTTON_SIZE}
                                                colorScheme={mode === "dark" ? "dark" : "light"}
                                                animatesContentChanges={false}
                                                accessibilityLabel={pillTargetDepth === "day" ? "월 화면으로 돌아가기" : `${visibleYear}년 전체 월 보기`}
                                                style={StyleSheet.absoluteFill}
                                            />
                                        </Pressable>
                                    ) : (
                                        <Pressable
                                            onPress={handlePrimaryDateButtonPress}
                                            disabled={!primaryPillInteractionEnabled}
                                            accessibilityLabel={pillTargetDepth === "day" ? "월 화면으로 돌아가기" : `${visibleYear}년 전체 월 보기`}
                                            accessibilityRole="button"
                                            style={({ pressed }) => [
                                                styles.yearGlass,
                                                {
                                                    width: "100%",
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
                                                <Ionicons accessible={false} name="chevron-back" size={23} color={colors.textPrimary} />
                                                <Text style={[styles.yearText, { color: colors.textPrimary }]}>
                                                    {visiblePrimaryLabel}
                                                </Text>
                                            </View>
                                        </Pressable>
                                    )}
                                </Animated.View>
                            </Reanimated.View>

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
                                // The search morph now starts entirely on the
                                // native UI thread. Keep that surface above the
                                // React year pill even before the open event
                                // reaches JS; transparent canvas hit-testing is
                                // already limited to the compact pill.
                                zIndex: 56,
                                elevation: 56,
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
                            closeRequest={prototypeCloseRequest}
                            searchExpandedWidth={searchHeaderTargetWidth}
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
                            onOpenChange={handleLiquidPrototypeOpenChange}
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
                            },
                        ]}
                    >
                        <Animated.View
                            style={{ opacity: addHandoffToolbarOpacity }}
                        >
                            <CalendarGlassSurface
                                interactive
                                clear
                                glow
                                variant="bottomBar"
                                tone="softGlass"
                                style={[
                                    styles.toolbarActions,
                                    isSearchToolbarOpen && styles.searchToolbarActions,
                                    { borderColor: colors.border },
                                ]}
                            >
                                <Animated.View
                                    pointerEvents={isSearchToolbarOpen ? "none" : "auto"}
                                    {...getScheduleAccessibilityVisibility(!isSearchToolbarOpen)}
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
                                            accessibilityRole="button"
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
                                                    <Ionicons accessible={false} name="calendar-outline" size={25} color={colors.textPrimary} />
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
                                        onPress={() => openSearchToolbar()}
                                        accessibilityRole="button"
                                        accessibilityLabel="일정 검색"
                                        style={({ pressed }) => [
                                            styles.iconButton,
                                            {
                                                opacity: pressed ? 0.68 : 1,
                                                transform: [{ scale: pressed ? 0.88 : 1 }],
                                            },
                                        ]}
                                    >
                                        <Ionicons accessible={false} name="search" size={24} color={colors.textPrimary} />
                                    </Pressable>

                                    <Pressable
                                        onPress={() => openToolbarMenu("add")}
                                        accessibilityRole="button"
                                        accessibilityLabel="일정 추가"
                                        style={({ pressed }) => [
                                            styles.iconButton,
                                            {
                                                opacity: pressed ? 0.68 : 1,
                                                transform: [{ scale: pressed ? 0.88 : 1 }],
                                            },
                                        ]}
                                    >
                                        <Ionicons accessible={false} name="add" size={27} color={colors.textPrimary} />
                                    </Pressable>
                                </Animated.View>

                                <Animated.View
                                    pointerEvents={isSearchToolbarOpen ? "auto" : "none"}
                                    {...getScheduleAccessibilityVisibility(isSearchToolbarOpen)}
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
                                    <Ionicons accessible={false} name="search" size={22} color={colors.textPrimary} />
                                    <TextInput
                                        ref={searchInputRef}
                                        accessibilityLabel="일정 검색어"
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
                                            accessibilityRole="button"
                                            onPress={() => setSearchQuery("")}
                                            accessibilityLabel="검색어 지우기"
                                            hitSlop={12}
                                            style={({ pressed }) => [
                                                styles.searchHeaderIconButton,
                                                { opacity: pressed ? 0.58 : 1 },
                                            ]}
                                        >
                                            <Ionicons accessible={false} name="close-circle" size={27} color={colors.textSecondary} />
                                        </Pressable>
                                    ) : null}
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={closeSearchToolbar}
                                        accessibilityLabel="검색 닫기"
                                        hitSlop={12}
                                        style={({ pressed }) => [
                                            styles.searchHeaderIconButton,
                                            { opacity: pressed ? 0.58 : 1 },
                                        ]}
                                    >
                                        <Ionicons accessible={false} name="close" size={25} color={colors.textPrimary} />
                                    </Pressable>
                                </Animated.View>
                            </CalendarGlassSurface>
                        </Animated.View>
                    </Animated.View>
                )}

                {/* The collapsed native search canvas spans the toolbar so its
                    morph can start on the UI thread. Keep an exact React hit
                    target above only the visible left pill; once native content
                    opens, the native surface owns the full toolbar again. */}
                {usesLiquidViewModeControl
                    && !liquidPrototypeOpen
                    && primaryPillInteractionEnabled && (
                    <Pressable
                        testID="calendar-primary-pill-hit-target"
                        accessibilityRole="button"
                        accessibilityLabel={
                            pillTargetDepth === "day"
                                ? "월 화면으로 돌아가기"
                                : `${visibleYear}년 전체 월 보기`
                        }
                        accessibilityState={{ disabled: false }}
                        onPress={handlePrimaryDateButtonPress}
                        style={[
                            styles.yearTapOverlay,
                            {
                                top: insets.top + LIQUID_TOOLBAR_TOP_OFFSET,
                                width: primaryPillContentWidth,
                            },
                        ]}
                    />
                )}

                {isSearchToolbarOpen && searchQuery.trim().length > 0 && (
                    <Animated.View
                        pointerEvents="box-none"
                        style={[
                            styles.searchResultsLayer,
                            {
                                top: insets.top + 74,
                                right: searchHeaderRightInset,
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
                            {searchLoading ? (
                                <View style={styles.dropdownEmpty}>
                                    <ActivityIndicator color={colors.textSecondary} />
                                    <Text style={[styles.dropdownEmptyText, { color: colors.textSecondary }]}>전체 일정 검색 중</Text>
                                </View>
                            ) : searchError ? (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="일정 검색 다시 시도"
                                    onPress={() => setSearchRetryKey((value) => value + 1)}
                                    style={({ pressed }) => [styles.dropdownEmpty, { opacity: pressed ? 0.62 : 1 }]}
                                >
                                    <Ionicons accessible={false} name="refresh-outline" size={20} color={colors.textSecondary} />
                                    <Text style={[styles.dropdownEmptyText, { color: colors.textSecondary }]}>검색에 실패했어요. 눌러서 다시 시도해 주세요.</Text>
                                </Pressable>
                            ) : searchResults.length === 0 ? (
                                <View style={styles.dropdownEmpty}>
                                    <Text style={[styles.dropdownEmptyText, { color: colors.textSecondary }]}>
                                        검색 결과가 없어요
                                    </Text>
                                </View>
                            ) : (
                                <ScrollView
                                    style={styles.searchResultScroll}
                                    contentContainerStyle={styles.searchResultList}
                                    keyboardShouldPersistTaps="handled"
                                    showsVerticalScrollIndicator={false}
                                >
                                    {searchResults.map((item) => (
                                        <Pressable
                                            key={item.id}
                                            accessibilityRole="button"
                                            accessibilityLabel={`${item.title}, ${formatScheduleDateTitle(item.startAt)}, ${item.allDay ? "종일" : formatScheduleTime(item.startAt)}`}
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
                                </ScrollView>
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
                                height: reservedStickyCalendarHeaderHeight,
                                opacity: stickyCalendarHeaderTodayOpacity,
                                transform: [
                                    { translateX: monthChromeTranslateX },
                                    { translateY: todayFocusTranslateY },
                                ],
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
                        {showsStickyMonthTitle && (
                            <View style={styles.stickyMonthHeader}>
                                <Text style={[styles.stickyMonthTitle, stickyMonthColorStyle]}>
                                    {stickyMonthTitle}
                                </Text>
                            </View>
                        )}
                        <View
                            style={[
                                styles.stickyWeekdayHeader,
                                {
                                    marginTop: primaryPillWeekdayGap,
                                    borderBottomColor: stickyWeekdayBorderColor,
                                },
                            ]}
                        >
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
                                                                accessible={false}
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
                                <View style={[styles.dropdownRowDivider, { backgroundColor: colors.border }]} />
                                <ToolbarDropdownAction
                                    icon="people-outline"
                                    title="공유 캘린더"
                                    onPress={openSharedCalendarManager}
                                    colors={colors}
                                />
                            </View>
                        </CalendarGlassSurface>
                    </Animated.View>
                )}
            </View>

            <Animated.View
                accessibilityElementsHidden={calendarOverlayOwnsAccessibility}
                importantForAccessibility={
                    calendarOverlayOwnsAccessibility ? "no-hide-descendants" : "auto"
                }
                style={[
                    styles.calendarContent,
                    {
                        opacity: calendarContentTodayOpacity,
                        transform: [
                            { translateX: calendarContentTranslateX },
                            { translateY: calendarContentTodayTranslateY },
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
                                        focusedMonth={monthDisplayFocusedMonth}
                                        items={itemsArray}
                                        calendarDaysByDate={calendarDaysByDate}
                                        onSelectDay={handleSelectDay}
                                        onOpenDay={handleOpenDay}
                                        viewMode={calendarViewMode}
                                        firstDay={firstDay}
                                        scrollRequest={calendarScrollRequest}
                                        onVisibleMonthChange={handleVisibleMonthChange}
                                        headerOffset={calendarHeaderOffset}
                                        transitionMonthKey={transitionMonthKey ?? undefined}
                                        transitionActive={isAnyDepthTransitionActive}
                                        reduceMotionEnabled={reduceMotionEnabled}
                                        todayFocusTarget={todayFocusTarget}
                                        onTodayFocusReady={handleTodayFocusReady}
                                        onRegisterDetailMonthMotionCancel={
                                            registerDetailMonthMotionCancel
                                        }
                                        animatedDayHeight={monthCalendarAnimatedDayHeight}
                                        bottomContentInset={stackBottomContentInset}
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
                            <MemoizedDayDisplay
                                selectedDay={dayDisplaySelectedDay}
                                firstDay={firstDay}
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
                                onPageNavigationActiveChange={handleDayPageNavigationActiveChange}
                                onSelectDay={handleSelectDayFromDayDisplay}
                                onNavigateToday={handleNavigateTodayFromDayDisplay}
                                onShiftDay={handleShiftDay}
                                onPressRetry={loadSchedules}
                                onOpenSchedule={handleOpenScheduleFromDayDisplay}
                            />
                        </Animated.View>
                    )}
                </View>
            </Animated.View>

            <Animated.View
                pointerEvents={yearOverviewVisible && !isAnyDepthTransitionActive ? "auto" : "none"}
                {...getScheduleAccessibilityVisibility(
                    yearOverviewVisible &&
                        !isAnyDepthTransitionActive &&
                        !calendarOverlayOwnsAccessibility
                )}
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
                    year={overviewYear}
                    selectedDay={selectedDay}
                    firstDay={firstDay}
                    topInset={insets.top}
                    presentationRequest={yearOverviewPresentationRequest}
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
                    disabled={isAnyDepthTransitionActive || calendarOverlayOwnsAccessibility}
                />
            )}

            <CalendarSettingsModal
                visible={calendarSettingsVisible}
                firstDay={firstDay}
                onChangeFirstDay={handleFirstDayChange}
                onClose={() => setCalendarSettingsVisible(false)}
            />

            <MemoizedQuickScheduleModal
                visible={quickModalVisible}
                prewarm={addFormsPrewarmed}
                morphPresenterRef={quickMorphPresenterRef}
                onClose={handleQuickModalClosed}
                onCloseStart={handleQuickModalCloseStart}
                onAnalyze={handleQuickAnalyze}
                onSave={addQuickItem}
                onFeedback={async feedback => {
                    await recordQuickScheduleReliabilityFeedbackDurably(feedback);
                }}
                defaultDay={selectedDay}
                defaultCategory={writableCategories[0]}
                categoryError={categoryError}
                categoryLoading={categoryLoading}
                onRetryCategories={retryCategoryLoad}
                sourceTopOffset={LIQUID_TOOLBAR_TOP_OFFSET}
                sourceWidth={addMenuSourceWidth}
                sourceHeight={LIQUID_TOOLBAR_ADD_DROPDOWN_HEIGHT}
                closeTargetWidth={collapsedLiquidToolbarWidth}
                sourceRightOffset={usesLiquidViewModeControl
                    ? ADD_MENU_SOURCE.nativeRightInset
                    : ADD_MENU_SOURCE.fallbackRightInset}
                onMorphReady={handleAddModalMorphReady}
            />

            <MemoizedScheduleNewModal
                visible={modalVisible}
                prewarm={addFormsPrewarmed}
                morphPresenterRef={manualMorphPresenterRef}
                onClose={handleScheduleModalClosed}
                onCloseStart={handleQuickModalCloseStart}
                onSubmit={addItem}
                categories={writableCategories}
                categoryError={categoryError}
                categoryLoading={categoryLoading}
                onRetryCategories={retryCategoryLoad}
                defaultDay={selectedDay}
                initialValues={formInitialValues}
                onManageCategories={openCategoryManager}
                onManageCalendars={openSharedCalendarManager}
                presentation={usesLiquidViewModeControl ? "morph" : "sheet"}
                sourceTopOffset={LIQUID_TOOLBAR_TOP_OFFSET}
                sourceWidth={addMenuSourceWidth}
                sourceHeight={LIQUID_TOOLBAR_ADD_DROPDOWN_HEIGHT}
                closeTargetWidth={collapsedLiquidToolbarWidth}
                sourceRightOffset={usesLiquidViewModeControl
                    ? ADD_MENU_SOURCE.nativeRightInset
                    : ADD_MENU_SOURCE.fallbackRightInset}
                onMorphReady={handleAddModalMorphReady}
            />

        </ScheduleRouteFocusBoundary>
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

function DayDisplay({
    selectedDay: selectedDayProp,
    firstDay,
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
    onPageNavigationActiveChange,
    onSelectDay,
    onNavigateToday,
    onShiftDay,
    onPressRetry,
    onOpenSchedule,
}: {
    selectedDay: string;
    firstDay: 0 | 1;
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
    onPageNavigationActiveChange: (active: boolean) => void;
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
    const dayNavigationSourceRef = useRef<string | null>(null);
    const dayNavigationTargetRef = useRef<string | null>(null);
    const dayNavigationCleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dayNavigationInterruptRef = useRef<(() => void) | null>(null);
    const dayNavigationRetargetRef = useRef<(() => void) | null>(null);
    const dayNavigationUnmountingRef = useRef(false);
    const queuedDayNavigationRef = useRef<QueuedDayNavigation | null>(null);
    const deferredDayNavigationRef = useRef<QueuedDayNavigation | null>(null);
    const [dayNavigation, setDayNavigation] = useState<DayPanelNavigation | null>(null);
    const [timelineNow, setTimelineNow] = useState(() => new Date());
    const initialCurrentTimeY = minuteOfDay(timelineNow) / 60 * DAY_TIMELINE_HOUR_HEIGHT;
    const currentTimeY = useRef(new Animated.Value(initialCurrentTimeY)).current;
    const currentTimeTargetYRef = useRef(initialCurrentTimeY);
    const daySwipeSettlingRef = useRef(false);
    const handledTodayRequestRef = useRef(todayRequest);
    const [preparedDay, setPreparedDay] = useState<string | null>(null);
    const selectedDay = dayNavigation?.targetDay ?? (
        transitionActive ? preparedDay ?? selectedDayProp : selectedDayProp
    );

    useEffect(() => {
        onPrepareDayReady(setPreparedDay);
        return () => onPrepareDayReady(null);
    }, [onPrepareDayReady]);

    useEffect(() => {
        dayNavigationUnmountingRef.current = false;
        return () => {
            dayNavigationUnmountingRef.current = true;
            dayNavigationInterruptRef.current?.();
            if (dayNavigationCleanupTimerRef.current) {
                clearTimeout(dayNavigationCleanupTimerRef.current);
                dayNavigationCleanupTimerRef.current = null;
            }
            dayNavigationInterruptRef.current = null;
            dayNavigationRetargetRef.current = null;
            dayNavigationActiveRef.current = false;
            dayNavigationSourceRef.current = null;
            dayNavigationTargetRef.current = null;
            queuedDayNavigationRef.current = null;
            dayPagerProgress.stopAnimation();
            onPageNavigationActiveChange(false);
        };
    }, [dayPagerProgress, onPageNavigationActiveChange]);

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

    const weekStart = useMemo(
        () => getCalendarWeekStart(selectedDay, firstDay),
        [firstDay, selectedDay]
    );
    const weekDays = useMemo(() => createWeekDays(weekStart), [weekStart]);
    const weekSchedulesByDay = useMemo(() => {
        const schedulesByDay = new Map<string, ScheduleItem[]>();
        weekDays.forEach((day) => schedulesByDay.set(day.dateString, []));

        items.forEach((item) => {
            weekDays.forEach((day) => {
                if (isOverlappingDay(item.startAt, item.endAt, day.dateString)) {
                    schedulesByDay.get(day.dateString)?.push(item);
                }
            });
        });

        return schedulesByDay;
    }, [items, weekDays]);
    const needsSingleDayContent =
        dayViewMode === "singleDay" || modeTransitionFrom === "singleDay";
    const needsMultiDayContent =
        dayViewMode === "multiDay" || modeTransitionFrom === "multiDay";
    const multiDayDays = useMemo(() => createSequentialDays(selectedDay, 2), [selectedDay]);
    const dayItems = useMemo(() => (
        needsSingleDayContent ? items
            .filter((item) => isOverlappingDay(item.startAt, item.endAt, selectedDay))
            .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
            : []
    ), [items, needsSingleDayContent, selectedDay]);
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
    const multiDayColumns = useMemo(() => (
        needsMultiDayContent ? multiDayDays.map((day) => {
            const columnItems = items
                .filter((item) => isOverlappingDay(item.startAt, item.endAt, day.dateString))
                .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

            return {
                day,
                items: columnItems,
                allDayItems: columnItems.filter((item) => item.allDay),
                positionedEvents: buildPositionedEvents(columnItems, day.dateString, { compact: true }),
            };
        }) : []
    ), [items, multiDayDays, needsMultiDayContent]);
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
            if (!finished) {
                daySwipeVisualXRef.current = 0;
                daySwipeSettlingRef.current = dayNavigationActiveRef.current;
                return;
            }
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
            if (dayNavigationCleanupTimerRef.current) {
                clearTimeout(dayNavigationCleanupTimerRef.current);
                dayNavigationCleanupTimerRef.current = null;
            }
            dayNavigationInterruptRef.current = null;
            dayNavigationRetargetRef.current = null;
            queuedDayNavigationRef.current = null;
            dayNavigationActiveRef.current = false;
            dayNavigationSourceRef.current = null;
            dayNavigationTargetRef.current = null;
            daySwipeSettlingRef.current = false;
            daySwipeVisualXRef.current = 0;
            daySwipeX.setValue(0);
            onPageNavigationActiveChange(false);
            commitDay(day);
            requestAnimationFrame(() => options.prepareIncoming?.());
            return;
        }

        const direction: 1 | -1 = new Date(`${day}T00:00:00`).getTime()
            > new Date(`${fromDay}T00:00:00`).getTime()
            ? 1
            : -1;

        const clampedInitialProgress = Math.max(0, Math.min(1, initialProgress));
        let didComplete = false;
        let cancelRequested = false;
        let animationGeneration = 0;
        let currentLegTarget = day;
        let currentLegOptions = options;
        let preparedOptions: DayNavigationOptions | null = null;

        function prepareIncoming(requestOptions: DayNavigationOptions) {
            if (!requestOptions.prepareIncoming || preparedOptions === requestOptions) return;
            preparedOptions = requestOptions;
            requestOptions.prepareIncoming();
        }

        function scheduleInteractionDeadline() {
            if (dayNavigationCleanupTimerRef.current) {
                clearTimeout(dayNavigationCleanupTimerRef.current);
            }
            dayNavigationCleanupTimerRef.current = setTimeout(() => {
                finishNavigation(true, true);
            }, CALENDAR_INTERACTION_BUDGET_MS);
        }

        function finishNavigation(finished: boolean, forceValue = false) {
            if (didComplete) return;
            didComplete = true;
            animationGeneration += 1;
            dayNavigationInterruptRef.current = null;
            dayNavigationRetargetRef.current = null;
            if (dayNavigationCleanupTimerRef.current) {
                clearTimeout(dayNavigationCleanupTimerRef.current);
                dayNavigationCleanupTimerRef.current = null;
            }
            if (forceValue) {
                dayPagerProgress.stopAnimation();
                dayPagerProgress.setValue(1);
            } else {
                dayPagerProgress.setValue(cancelRequested ? 0 : finished ? 1 : 0);
            }
            const latestRequest = queuedDayNavigationRef.current;
            queuedDayNavigationRef.current = null;
            const finalDay = latestRequest?.day ?? currentLegTarget;
            const finalOptions = latestRequest?.options ?? currentLegOptions;
            const finalCommitDay = finalOptions.commitDay ?? onSelectDay;
            dayNavigationActiveRef.current = false;
            dayNavigationSourceRef.current = null;
            dayNavigationTargetRef.current = null;
            daySwipeSettlingRef.current = false;
            daySwipeX.setValue(0);
            daySwipeVisualXRef.current = 0;
            onPageNavigationActiveChange(false);

            if (cancelRequested) {
                if (!dayNavigationUnmountingRef.current) {
                    setDayNavigation(null);
                }
                return;
            }

            // Keep the expensive parent calendar and month-range fetch out of
            // the animation frame. The DayDisplay renders its local target
            // immediately and publishes the selection only when motion settles.
            unstable_batchedUpdates(() => {
                finalCommitDay(finalDay);
                setDayNavigation(null);
            });

            if (finalOptions.prepareIncoming && preparedOptions !== finalOptions) {
                requestAnimationFrame(() => finalOptions.prepareIncoming?.());
            }
        }

        function runCurrentLegToEnd(durationMs: number) {
            if (didComplete) return;
            const generation = ++animationGeneration;
            if (durationMs <= 0) {
                dayPagerProgress.setValue(1);
                completeCurrentLeg();
                return;
            }

            Animated.timing(dayPagerProgress, {
                toValue: 1,
                duration: durationMs,
                easing: DAY_NAVIGATION_EASING,
                useNativeDriver: true,
                isInteraction: false,
            }).start(({ finished }) => {
                if (
                    didComplete ||
                    generation !== animationGeneration ||
                    !finished
                ) return;
                completeCurrentLeg();
            });
        }

        function beginFollowUpLeg(request: QueuedDayNavigation) {
            const sourceDay = currentLegTarget;
            const nextOutgoingPanel = dayPanelSnapshotRef.current ?? outgoingPanel;
            currentLegTarget = request.day;
            currentLegOptions = request.options;
            preparedOptions = null;
            const nextDirection: 1 | -1 = new Date(`${request.day}T00:00:00`).getTime()
                > new Date(`${sourceDay}T00:00:00`).getTime()
                ? 1
                : -1;

            dayNavigationSourceRef.current = sourceDay;
            dayNavigationTargetRef.current = request.day;
            unstable_batchedUpdates(() => {
                dayPagerProgress.setValue(0);
                setDayNavigation({
                    fromDay: sourceDay,
                    targetDay: request.day,
                    direction: nextDirection,
                    outgoingPanel: nextOutgoingPanel,
                });
            });

            const scheduledGeneration = ++animationGeneration;
            requestAnimationFrame(() => {
                if (didComplete || scheduledGeneration !== animationGeneration) return;
                prepareIncoming(currentLegOptions);
                runCurrentLegToEnd(DAY_NAVIGATION_RETARGET_MOTION.followDurationMs);
            });
        }

        function completeCurrentLeg() {
            if (didComplete) return;
            dayPagerProgress.setValue(1);
            const latestRequest = queuedDayNavigationRef.current;

            if (latestRequest && latestRequest.day !== currentLegTarget) {
                queuedDayNavigationRef.current = null;
                beginFollowUpLeg(latestRequest);
                return;
            }

            if (latestRequest) {
                queuedDayNavigationRef.current = null;
                currentLegOptions = latestRequest.options;
            }
            finishNavigation(true);
        }

        dayNavigationActiveRef.current = true;
        dayNavigationSourceRef.current = fromDay;
        dayNavigationTargetRef.current = day;
        daySwipeSettlingRef.current = true;
        onPageNavigationActiveChange(true);
        dayPagerProgress.stopAnimation();
        dayPagerProgress.setValue(clampedInitialProgress);

        scheduleInteractionDeadline();
        dayNavigationInterruptRef.current = () => {
            cancelRequested = true;
            animationGeneration += 1;
            dayPagerProgress.stopAnimation();
            finishNavigation(false);
        };
        dayNavigationRetargetRef.current = () => {
            if (didComplete) return;
            scheduleInteractionDeadline();
            const generation = ++animationGeneration;
            dayPagerProgress.stopAnimation((value) => {
                if (didComplete || generation !== animationGeneration) return;
                const progress = Math.max(0, Math.min(1, value));
                const settleDuration = getDayNavigationRetargetSettleDuration(progress);
                runCurrentLegToEnd(settleDuration);
            });
        };

        setDayNavigation({
            fromDay,
            targetDay: day,
            direction,
            outgoingPanel,
        });

        const scheduledGeneration = ++animationGeneration;
        requestAnimationFrame(() => {
            if (didComplete || scheduledGeneration !== animationGeneration) return;
            prepareIncoming(currentLegOptions);
            // When a drag hands off to the pager, the outgoing panel already has
            // the same offset through dayPagerProgress. Clearing the gesture value
            // here therefore does not introduce a one-frame jump.
            daySwipeX.setValue(0);
            daySwipeVisualXRef.current = 0;
            runCurrentLegToEnd(getDayNavigationRemainingDuration(clampedInitialProgress));
        });
    }, [
        dayPagerProgress,
        daySwipeX,
        onPageNavigationActiveChange,
        onSelectDay,
        reduceMotionEnabled,
        selectedDay,
    ]);

    const retargetActiveDayNavigation = useCallback((
        day: string,
        options: DayNavigationOptions = {}
    ) => {
        const retarget = dayNavigationRetargetRef.current;
        if (!dayNavigationActiveRef.current || !retarget) return false;

        const activeTargetDay = dayNavigationTargetRef.current;
        if (!activeTargetDay) return false;
        const requestedTargetDay = queuedDayNavigationRef.current?.day ?? activeTargetDay;

        deferredDayNavigationRef.current = null;
        if (
            day === requestedTargetDay &&
            !options.commitDay &&
            !options.prepareIncoming
        ) {
            return true;
        }

        queuedDayNavigationRef.current = { day, options };
        retarget();
        return true;
    }, []);

    const navigateToDayFromWeekStrip = useCallback((day: string) => {
        if (retargetActiveDayNavigation(day)) return;

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

        startDayNavigation(day, selectedDay);
    }, [
        isModeTransitionActive,
        retargetActiveDayNavigation,
        selectedDay,
        startDayNavigation,
    ]);

    useEffect(() => {
        if (isModeTransitionActive || dayNavigationActiveRef.current) return;

        const deferredRequest = deferredDayNavigationRef.current;
        if (!deferredRequest) return;
        deferredDayNavigationRef.current = null;

        if (deferredRequest.day === selectedDay) {
            requestAnimationFrame(() => deferredRequest.options.prepareIncoming?.());
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
        isModeTransitionActive,
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

        // Handle the active target before the committed selection so a final
        // Today press can replace the in-flight destination without waiting.
        if (retargetActiveDayNavigation(todayKey, options)) return;

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
        retargetActiveDayNavigation,
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

    const singleDayTimeline = useMemo(() => {
        if (!needsSingleDayContent) return null;

        return (
        <ScrollView
            ref={attachSingleDayTimelineRef}
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
                    accessible={Boolean(inlineError)}
                    accessibilityRole={inlineError ? "button" : undefined}
                    accessibilityLabel={inlineError ? `${inlineError}. 일정 다시 조회` : undefined}
                    accessibilityState={{ disabled: !inlineError, busy: loading }}
                    disabled={!inlineError}
                    onPress={inlineError ? onPressRetry : undefined}
                    style={styles.timelineInlineState}
                >
                    {loading ? (
                        <BrandedLoader
                            size="button"
                            variant="schedule"
                            accessibilityLabel="일정을 불러오는 중이에요"
                        />
                    ) : null}
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
        );
    }, [
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
        needsSingleDayContent,
        inlineError,
        initialTimelineOffset,
        onOpenSchedule,
        onPressRetry,
        positionedEvents,
    ]);

    const multiDayTimeline = useMemo(() => {
        if (!needsMultiDayContent) return null;

        return (
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
                    accessible={Boolean(inlineError)}
                    accessibilityRole={inlineError ? "button" : undefined}
                    accessibilityLabel={inlineError ? `${inlineError}. 일정 다시 조회` : undefined}
                    accessibilityState={{ disabled: !inlineError, busy: loading }}
                    disabled={!inlineError}
                    onPress={inlineError ? onPressRetry : undefined}
                    style={styles.timelineInlineState}
                >
                    {loading ? (
                        <BrandedLoader
                            size="button"
                            variant="schedule"
                            accessibilityLabel="일정을 불러오는 중이에요"
                        />
                    ) : null}
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
                                        accessibilityRole="button"
                                        accessibilityLabel={`${item.title}, ${formatDayTimelineTimeRange(item)}`}
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
        );
    }, [
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
        needsMultiDayContent,
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
                            accessibilityRole="button"
                            accessibilityLabel={`${item.title}, 종일`}
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
                            accessibilityRole="button"
                            accessibilityLabel={`${item.title}, 종일`}
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

    // Keep the last rendered panel as an immutable outgoing snapshot so its
    // title, all-day row, and timeline remain mounted while the target enters.
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
        dayNavigation &&
        getCalendarWeekStart(dayNavigation.fromDay, firstDay) ===
            getCalendarWeekStart(dayNavigation.targetDay, firstDay)
    );
    const navigationFromIndex = dayNavigation
        ? getCalendarWeekdayIndex(dayNavigation.fromDay, firstDay)
        : 0;
    const navigationTargetIndex = dayNavigation
        ? getCalendarWeekdayIndex(dayNavigation.targetDay, firstDay)
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
                    const daySchedules = weekSchedulesByDay.get(day.dateString) ?? [];
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
                            {/* Matching date keys move the mounted source into
                                the outgoing slot and preserve the destination
                                after cleanup instead of remounting both pages. */}
                            {dayNavigation ? (
                                <Animated.View
                                    key={`day-panel-${dayNavigation.fromDay}`}
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
                                key={`day-panel-${selectedDay}`}
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
                <Ionicons accessible={false} name={icon} size={26} color={colors.textPrimary} />
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
        left: 16,
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
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
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
    categoryErrorLayer: {
        position: "absolute",
        left: 16,
        right: 16,
        zIndex: 64,
        elevation: 64,
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
        gap: 10,
        paddingLeft: 20,
        paddingRight: 10,
        zIndex: 3,
        elevation: 3,
    },
    searchHeaderInput: {
        flex: 1,
        minWidth: 0,
        paddingVertical: 0,
        fontSize: 17,
        fontWeight: "600",
        letterSpacing: 0,
    },
    searchHeaderIconButton: {
        width: 38,
        height: 42,
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
    searchToolbarActions: {
        height: LIQUID_TOOLBAR_SEARCH_HEIGHT,
        borderRadius: LIQUID_TOOLBAR_SEARCH_HEIGHT / 2,
    },
    toolbarActionsPlaceholder: {
        width: LIQUID_TOOLBAR_ACTIONS_WIDTH,
        height: LIQUID_TOOLBAR_BUTTON_SIZE,
    },
    yearGlassMotion: {
        width: "100%",
        height: LIQUID_TOOLBAR_BUTTON_SIZE,
        borderRadius: LIQUID_TOOLBAR_BUTTON_SIZE / 2,
    },
    primaryDatePillHost: {
        height: LIQUID_TOOLBAR_BUTTON_SIZE,
        borderRadius: LIQUID_TOOLBAR_BUTTON_SIZE / 2,
        overflow: "visible",
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
        paddingBottom: 8,
    },
    searchResultScroll: {
        maxHeight: 252,
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
        paddingLeft: DAY_TIMELINE_GUTTER + 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
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
