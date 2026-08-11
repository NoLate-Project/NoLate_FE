import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSharedValue } from 'react-native-reanimated';
import { useScheduleStore } from '../store';
import type { ScheduleItem, ScheduleParseResult } from '../types';
import type { ScheduleCalendar } from '../../../api/scheduleCalendars';
import {
  getCalendarMetadataPrefetchMonthKeys,
  type CalendarDayMetadata,
} from '../calendarMetadata';
import {
  getCalendarMetadataRetryTargetKey,
  resetCalendarMetadataRetryState,
  type CalendarMetadataRetryState,
} from '../calendarMetadataRetry';
import { getCalendarMonthAnchor } from '../calendarNavigation';
import { subscribeScheduleMutation } from '../scheduleMutationEvents';
import type { CalendarScope } from '../calendarScope';
import type { ShareAttentionSummary } from '../../share/shareAttention';
import type { DayTransitionContext } from '../components/calendar/CalendarWrapper';
import type { LiquidGlassIconButtonHandle } from '../components/calendar/LiquidGlassIconButton';
import type { ScheduleAddMorphPresenter } from '../components/form/ScheduleAddModal';
import type { QuickScheduleMorphPresenter } from '../components/form/QuickScheduleModal';
import {
  CALENDAR_DAY_HEIGHTS,
  type CalendarViewMode,
  type CalendarViewModePreference,
} from '../components/calendar/viewMode';
import {
  getMonthAgendaPanelKind,
  type MonthAgendaPanelKind,
} from '../calendarMotion';
import type { ToolbarMenu } from './useScheduleIndexToolbarActions';
import {
  CALENDAR_FIRST_DAY_STORAGE_KEY,
  EMPTY_SHARE_ATTENTION,
  getScheduleFetchRange,
  getScheduleIndexErrorMessage as getErrorMessage,
  type CalendarDepth,
  type DayViewMode,
  type TodayFocusTarget,
} from './scheduleIndexControllerModel';
import { toYmd } from '../../../../lib/util/data';

/**
 * 일정 화면 전반에서 공유하는 React 상태, Animated 값, 요청 수명주기 ref를 생성한다.
 * 상태 생성 순서와 ref 동기화를 한곳에 모아 기능 훅이 화면 컴포넌트와 독립적으로
 * 필요한 상태 묶음을 전달받을 수 있게 한다.
 */
export function useScheduleIndexState(
  initialCalendarViewMode: CalendarViewModePreference,
) {
  const { state, dispatch } = useScheduleStore();
  const [modalVisible, setModalVisible] = useState(false);
  const [activeToolbarMenu, setActiveToolbarMenu] =
    useState<ToolbarMenu | null>(null);
  const [toolbarMenuClosing, setToolbarMenuClosing] = useState(false);
  const [liquidPrototypeOpen, setLiquidPrototypeOpen] = useState(false);
  const [prototypeCloseRequest, setPrototypeCloseRequest] = useState(0);
  const [quickModalVisible, setQuickModalVisible] = useState(false);
  const [addFormsPrewarmed, setAddFormsPrewarmed] = useState(false);
  const [quickHandoffHidden, setQuickHandoffHidden] = useState(false);
  const [shareAttention, setShareAttention] = useState<ShareAttentionSummary>(
    EMPTY_SHARE_ATTENTION,
  );
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [formInitialValues, setFormInitialValues] =
    useState<ScheduleParseResult | null>(null);
  const [calendarViewMode, setCalendarViewMode] = useState<CalendarViewMode>(
    initialCalendarViewMode,
  );
  const [calendarDepth, setCalendarDepth] = useState<CalendarDepth>('month');
  const [dayViewMode, setDayViewMode] = useState<DayViewMode>('singleDay');
  const [dayLayerMounted, setDayLayerMounted] = useState(false);
  const [dayTransitionTargetDay, setDayTransitionTargetDay] = useState<
    string | null
  >(null);
  const [yearOverviewVisible, setYearOverviewVisible] = useState(false);
  const [yearOverviewClosing, setYearOverviewClosing] = useState(false);
  const [yearOverviewItemsByYear, setYearOverviewItemsByYear] = useState<
    Record<number, ScheduleItem[]>
  >({});
  const yearOverviewLoadedYearsRef = useRef(new Set<number>());
  const yearOverviewLoadInFlightRef = useRef(new Map<number, Promise<void>>());
  const yearOverviewLoadSessionRef = useRef(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ScheduleItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchRetryKey, setSearchRetryKey] = useState(0);
  const [searchInvalidationKey, setSearchInvalidationKey] = useState(0);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categoryRetryKey, setCategoryRetryKey] = useState(0);
  const [scheduleCalendars, setScheduleCalendars] = useState<
    ScheduleCalendar[]
  >([]);
  const [activeCalendarScope, setActiveCalendarScope] =
    useState<CalendarScope>('all');
  const [calendarShareTarget, setCalendarShareTarget] =
    useState<ScheduleCalendar | null>(null);
  const pendingCalendarShareTargetRef = useRef<ScheduleCalendar | null>(null);
  const calendarShareFallbackTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const searchSequenceRef = useRef(0);
  const searchAbortControllerRef = useRef<AbortController | null>(null);
  const handledSearchRetryKeyRef = useRef(searchRetryKey);
  const searchResultCacheRef = useRef(
    new Map<
      string,
      {
        items: ScheduleItem[];
        fetchedAt: number;
      }
    >(),
  );
  /** 검색 캐시를 비우고 무효화 키를 증가시켜 같은 검색어도 서버에서 다시 조회하게 한다. */
  const invalidateSearchResults = useCallback(() => {
    searchSequenceRef.current += 1;
    searchAbortControllerRef.current?.abort();
    searchAbortControllerRef.current = null;
    searchResultCacheRef.current.clear();
    setSearchResults([]);
    setSearchLoading(false);
    setSearchError(null);
    setSearchInvalidationKey(value => value + 1);
  }, []);
  useEffect(
    () => subscribeScheduleMutation(invalidateSearchResults),
    [invalidateSearchResults],
  );
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [firstDay, setFirstDay] = useState<0 | 1>(0);
  const [calendarScopeSelectorVisible, setCalendarScopeSelectorVisible] =
    useState(false);
  const [calendarSettingsVisible, setCalendarSettingsVisible] = useState(false);
  const [calendarScrollRequest, setCalendarScrollRequest] = useState(0);
  const [dayTodayRequest, setDayTodayRequest] = useState(0);
  const [yearTodayRequest, setYearTodayRequest] = useState(0);
  const [yearOverviewPresentationRequest, setYearOverviewPresentationRequest] =
    useState(0);
  const [todayButtonPrimed, setTodayButtonPrimed] = useState(false);
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);
  const [transitionMonthKey, setTransitionMonthKey] = useState<string | null>(
    null,
  );
  const [dayTransitionContext, setDayTransitionContext] =
    useState<DayTransitionContext>('idle');
  const [dayModeTransitionFrom, setDayModeTransitionFrom] =
    useState<DayViewMode | null>(null);
  const [isDayTransitionActive, setIsDayTransitionActive] = useState(false);
  const [isYearDepthTransitionActive, setIsYearDepthTransitionActive] =
    useState(false);
  const [isMonthViewTransitionActive, setIsMonthViewTransitionActive] =
    useState(false);
  const [isTodayFocusTransitionActive, setIsTodayFocusTransitionActive] =
    useState(false);
  const [todayFocusTarget, setTodayFocusTarget] =
    useState<TodayFocusTarget | null>(null);
  const dayLayerMountedRef = useRef(dayLayerMounted);
  const isDayTransitionActiveRef = useRef(isDayTransitionActive);
  const isYearDepthTransitionActiveRef = useRef(isYearDepthTransitionActive);
  dayLayerMountedRef.current = dayLayerMounted;
  isDayTransitionActiveRef.current = isDayTransitionActive;
  isYearDepthTransitionActiveRef.current = isYearDepthTransitionActive;

  useEffect(() => {
    let cancelled = false;

    AsyncStorage.getItem(CALENDAR_FIRST_DAY_STORAGE_KEY)
      .then(storedFirstDay => {
        if (cancelled) return;
        if (storedFirstDay === '0' || storedFirstDay === '1') {
          setFirstDay(Number(storedFirstDay) as 0 | 1);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);
  const [retainedMonthAgendaPanelKind, setRetainedMonthAgendaPanelKind] =
    useState<MonthAgendaPanelKind>(
      () => getMonthAgendaPanelKind(initialCalendarViewMode) ?? 'detail',
    );
  const [outgoingMonthAgendaPanelKind, setOutgoingMonthAgendaPanelKind] =
    useState<MonthAgendaPanelKind | null>(null);
  const shouldHideHandoffSurface =
    quickHandoffHidden && (quickModalVisible || modalVisible);
  const calendarTransition = useRef(new Animated.Value(1)).current;
  const todayFocusOpacity = useRef(new Animated.Value(1)).current;
  const todayFocusTranslateY = useRef(new Animated.Value(0)).current;
  const monthAgendaProgress = useRef(
    new Animated.Value(
      getMonthAgendaPanelKind(initialCalendarViewMode) ? 1 : 0,
    ),
  ).current;
  const monthAgendaSwapProgress = useRef(new Animated.Value(1)).current;
  const monthCalendarTransitionProgress = useRef(new Animated.Value(1)).current;
  const monthCalendarAnimatedHeight = useSharedValue(0);
  const monthCalendarTargetHeight = useSharedValue(0);
  const monthCalendarAnimatedDayHeight = useSharedValue(
    CALENDAR_DAY_HEIGHTS[initialCalendarViewMode],
  );
  const detailMonthMotionActive = useSharedValue(false);
  const yearOverviewProgress = useRef(new Animated.Value(0)).current;
  const dayTransition = useRef(new Animated.Value(0)).current;
  const dayModeTransition = useRef(new Animated.Value(1)).current;
  const toolbarDropdownProgress = useRef(new Animated.Value(0)).current;
  const searchToolbarProgress = useRef(new Animated.Value(0)).current;
  const addHandoffToolbarOpacity = useRef(new Animated.Value(1)).current;
  const nativeSearchGenerationRef = useRef(0);
  const nativeSearchSessionRef = useRef<string | null>(null);
  const primaryDatePillNativeRef = useRef<LiquidGlassIconButtonHandle>(null);
  const searchInputRef = useRef<TextInput>(null);
  const dayDisplayPrepareRef = useRef<((day: string) => void) | null>(null);
  const monthCalendarHeightRef = useRef(0);
  const monthCalendarDayHeightRef = useRef(
    CALENDAR_DAY_HEIGHTS[initialCalendarViewMode],
  );
  const monthDisplayHeightRef = useRef(0);
  const [monthDisplayHeight, setMonthDisplayHeight] = useState(0);
  const monthViewTransitionGenerationRef = useRef(0);
  const monthViewTransitionFrameRef = useRef<number | null>(null);
  const yearDepthTransitionFrameRef = useRef<number | null>(null);
  const monthViewCompletionAnimationRef =
    useRef<Animated.CompositeAnimation | null>(null);
  const monthViewTransitionWatchdogRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const todayFocusAnimationRef = useRef<Animated.CompositeAnimation | null>(
    null,
  );
  const todayFocusWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const todayFocusAnimationGenerationRef = useRef(0);
  const todayFocusAnimationActiveRef = useRef(false);
  const todayFocusCommittedRef = useRef(false);
  const todayFocusEnterStartedRef = useRef(false);
  const todayFocusReduceMotionRef = useRef(false);
  const detailMonthMotionCancelRef = useRef<(() => void) | null>(null);
  const detailMonthMotionActiveRef = useRef(false);
  const detailMonthFetchFlushFrameRef = useRef<number | null>(null);
  const transitionStartedRef = useRef(false);
  const dayPageNavigationActiveRef = useRef(false);
  const dayTransitionCleanupTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const viewTransitioningRef = useRef(false);
  const quickHandoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const quickMorphPresenterRef = useRef<QuickScheduleMorphPresenter | null>(
    null,
  );
  const manualMorphPresenterRef = useRef<ScheduleAddMorphPresenter | null>(
    null,
  );
  const addHandoffPendingRef = useRef(false);
  const addHandoffClosingRef = useRef(false);
  const addHandoffNativeResetRef = useRef(false);
  const handledFocusRequestRef = useRef<string | null>(null);
  const scheduleLoadSequenceRef = useRef(0);
  const pendingScheduleSnapshotRef = useRef<{
    requestSequence: number;
    items: ScheduleItem[];
  } | null>(null);
  const calendarRevisionSyncPromiseRef = useRef<Promise<boolean> | null>(null);
  const calendarMetadataMountedRef = useRef(true);
  const calendarMetadataLoadedMonthKeysRef = useRef(new Set<string>());
  const calendarMetadataInFlightMonthKeysRef = useRef(new Set<string>());
  const calendarMetadataRetryTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const calendarMetadataRetryStateRef = useRef<CalendarMetadataRetryState>(
    resetCalendarMetadataRetryState(),
  );
  const calendarMetadataLoadPendingRef = useRef(false);
  const pendingCalendarMetadataByDateRef = useRef<
    Record<string, CalendarDayMetadata>
  >({});
  const scheduleItemsByIdRef = useRef(state.itemsById);
  scheduleItemsByIdRef.current = state.itemsById;

  const [pendingSelectedDay, setPendingSelectedDay] = useState<string | null>(
    null,
  );
  const selectedDay = pendingSelectedDay ?? state.selectedDay;
  const selectedDayRef = useRef(selectedDay);
  selectedDayRef.current = selectedDay;
  const [todayKey, setTodayKey] = useState(() => toYmd(new Date()));
  const [visibleMonth, setVisibleMonth] = useState(selectedDay);
  const visibleMonthRef = useRef(visibleMonth);
  visibleMonthRef.current = visibleMonth;
  const visibleMonthAnchor = getCalendarMonthAnchor(visibleMonth);
  const [fetchVisibleMonth, setFetchVisibleMonth] = useState(() =>
    getCalendarMonthAnchor(selectedDay),
  );
  /** 표시 월과 조회 월이 달라진 경우에만 fetch 기준 월을 갱신해 불필요한 효과 실행을 막는다. */
  const updateFetchVisibleMonth = useCallback((month: string) => {
    const monthAnchor = getCalendarMonthAnchor(month);
    setFetchVisibleMonth(current =>
      current === monthAnchor ? current : monthAnchor,
    );
  }, []);
  const [calendarDaysByDate, setCalendarDaysByDate] = useState<
    Record<string, CalendarDayMetadata>
  >({});
  const [calendarMetadataRetrySequence, setCalendarMetadataRetrySequence] =
    useState(0);
  const scheduleError = useMemo(
    () => (state.error ? getErrorMessage(new Error(state.error)) : null),
    [state.error],
  );
  const scheduleFetchRange = useMemo(
    () =>
      getScheduleFetchRange(
        fetchVisibleMonth,
        selectedDay,
        calendarDepth,
        dayViewMode,
        calendarViewMode,
      ),
    [
      calendarDepth,
      calendarViewMode,
      dayViewMode,
      fetchVisibleMonth,
      selectedDay,
    ],
  );
  const scheduleFetchStartAt = scheduleFetchRange.startAt;
  const scheduleFetchEndAt = scheduleFetchRange.endAt;
  const calendarMetadataPrefetchMonthKeys = useMemo(
    () => getCalendarMetadataPrefetchMonthKeys(fetchVisibleMonth),
    [fetchVisibleMonth],
  );
  const calendarMetadataRetryTargetKey = useMemo(
    () =>
      getCalendarMetadataRetryTargetKey(
        calendarMetadataPrefetchMonthKeys,
        firstDay,
      ),
    [calendarMetadataPrefetchMonthKeys, firstDay],
  );
  const calendarMetadataRetryTargetKeyRef = useRef(
    calendarMetadataRetryTargetKey,
  );
  calendarMetadataRetryTargetKeyRef.current = calendarMetadataRetryTargetKey;


  return {
    state,
    dispatch,
    modalVisible,
    setModalVisible,
    activeToolbarMenu,
    setActiveToolbarMenu,
    toolbarMenuClosing,
    setToolbarMenuClosing,
    liquidPrototypeOpen,
    setLiquidPrototypeOpen,
    prototypeCloseRequest,
    setPrototypeCloseRequest,
    quickModalVisible,
    setQuickModalVisible,
    addFormsPrewarmed,
    setAddFormsPrewarmed,
    quickHandoffHidden,
    setQuickHandoffHidden,
    shareAttention,
    setShareAttention,
    notificationUnreadCount,
    setNotificationUnreadCount,
    formInitialValues,
    setFormInitialValues,
    calendarViewMode,
    setCalendarViewMode,
    calendarDepth,
    setCalendarDepth,
    dayViewMode,
    setDayViewMode,
    dayLayerMounted,
    setDayLayerMounted,
    dayTransitionTargetDay,
    setDayTransitionTargetDay,
    yearOverviewVisible,
    setYearOverviewVisible,
    yearOverviewClosing,
    setYearOverviewClosing,
    yearOverviewItemsByYear,
    setYearOverviewItemsByYear,
    yearOverviewLoadedYearsRef,
    yearOverviewLoadInFlightRef,
    yearOverviewLoadSessionRef,
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    searchLoading,
    setSearchLoading,
    searchError,
    setSearchError,
    searchRetryKey,
    setSearchRetryKey,
    searchInvalidationKey,
    categoryLoading,
    setCategoryLoading,
    categoryError,
    setCategoryError,
    categoryRetryKey,
    setCategoryRetryKey,
    scheduleCalendars,
    setScheduleCalendars,
    activeCalendarScope,
    setActiveCalendarScope,
    calendarShareTarget,
    setCalendarShareTarget,
    pendingCalendarShareTargetRef,
    calendarShareFallbackTimeoutRef,
    searchSequenceRef,
    searchAbortControllerRef,
    handledSearchRetryKeyRef,
    searchResultCacheRef,
    keyboardVisible,
    setKeyboardVisible,
    firstDay,
    setFirstDay,
    calendarScopeSelectorVisible,
    setCalendarScopeSelectorVisible,
    calendarSettingsVisible,
    setCalendarSettingsVisible,
    calendarScrollRequest,
    setCalendarScrollRequest,
    dayTodayRequest,
    setDayTodayRequest,
    yearTodayRequest,
    setYearTodayRequest,
    yearOverviewPresentationRequest,
    setYearOverviewPresentationRequest,
    todayButtonPrimed,
    setTodayButtonPrimed,
    reduceMotionEnabled,
    setReduceMotionEnabled,
    transitionMonthKey,
    setTransitionMonthKey,
    dayTransitionContext,
    setDayTransitionContext,
    dayModeTransitionFrom,
    setDayModeTransitionFrom,
    isDayTransitionActive,
    setIsDayTransitionActive,
    isYearDepthTransitionActive,
    setIsYearDepthTransitionActive,
    isMonthViewTransitionActive,
    setIsMonthViewTransitionActive,
    isTodayFocusTransitionActive,
    setIsTodayFocusTransitionActive,
    todayFocusTarget,
    setTodayFocusTarget,
    dayLayerMountedRef,
    isDayTransitionActiveRef,
    isYearDepthTransitionActiveRef,
    retainedMonthAgendaPanelKind,
    setRetainedMonthAgendaPanelKind,
    outgoingMonthAgendaPanelKind,
    setOutgoingMonthAgendaPanelKind,
    shouldHideHandoffSurface,
    calendarTransition,
    todayFocusOpacity,
    todayFocusTranslateY,
    monthAgendaProgress,
    monthAgendaSwapProgress,
    monthCalendarTransitionProgress,
    monthCalendarAnimatedHeight,
    monthCalendarTargetHeight,
    monthCalendarAnimatedDayHeight,
    detailMonthMotionActive,
    yearOverviewProgress,
    dayTransition,
    dayModeTransition,
    toolbarDropdownProgress,
    searchToolbarProgress,
    addHandoffToolbarOpacity,
    nativeSearchGenerationRef,
    nativeSearchSessionRef,
    primaryDatePillNativeRef,
    searchInputRef,
    dayDisplayPrepareRef,
    monthCalendarHeightRef,
    monthCalendarDayHeightRef,
    monthDisplayHeightRef,
    monthDisplayHeight,
    setMonthDisplayHeight,
    monthViewTransitionGenerationRef,
    monthViewTransitionFrameRef,
    yearDepthTransitionFrameRef,
    monthViewCompletionAnimationRef,
    monthViewTransitionWatchdogRef,
    todayFocusAnimationRef,
    todayFocusWatchdogRef,
    todayFocusAnimationGenerationRef,
    todayFocusAnimationActiveRef,
    todayFocusCommittedRef,
    todayFocusEnterStartedRef,
    todayFocusReduceMotionRef,
    detailMonthMotionCancelRef,
    detailMonthMotionActiveRef,
    detailMonthFetchFlushFrameRef,
    transitionStartedRef,
    dayPageNavigationActiveRef,
    dayTransitionCleanupTimerRef,
    viewTransitioningRef,
    quickHandoffTimerRef,
    quickMorphPresenterRef,
    manualMorphPresenterRef,
    addHandoffPendingRef,
    addHandoffClosingRef,
    addHandoffNativeResetRef,
    handledFocusRequestRef,
    scheduleLoadSequenceRef,
    pendingScheduleSnapshotRef,
    calendarRevisionSyncPromiseRef,
    calendarMetadataMountedRef,
    calendarMetadataLoadedMonthKeysRef,
    calendarMetadataInFlightMonthKeysRef,
    calendarMetadataRetryTimerRef,
    calendarMetadataRetryStateRef,
    calendarMetadataLoadPendingRef,
    pendingCalendarMetadataByDateRef,
    scheduleItemsByIdRef,
    pendingSelectedDay,
    setPendingSelectedDay,
    selectedDay,
    selectedDayRef,
    todayKey,
    setTodayKey,
    visibleMonth,
    setVisibleMonth,
    visibleMonthRef,
    visibleMonthAnchor,
    fetchVisibleMonth,
    updateFetchVisibleMonth,
    calendarDaysByDate,
    setCalendarDaysByDate,
    calendarMetadataRetrySequence,
    setCalendarMetadataRetrySequence,
    scheduleError,
    scheduleFetchStartAt,
    scheduleFetchEndAt,
    calendarMetadataPrefetchMonthKeys,
    calendarMetadataRetryTargetKey,
    calendarMetadataRetryTargetKeyRef,
  };
}

export type ScheduleIndexState = ReturnType<typeof useScheduleIndexState>;
