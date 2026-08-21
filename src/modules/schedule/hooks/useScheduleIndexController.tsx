import { useEffect } from 'react';
import {
  AccessibilityInfo,
  AppState,
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { cancelAnimation as cancelReanimatedAnimation } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CalendarViewModePreference } from '../components/calendar/viewMode';
import { useTheme } from '../../theme/ThemeContext';
import { toYmd } from '../../../../lib/util/data';
import { useScheduleIndexCalendarData } from './useScheduleIndexCalendarData';
import { useScheduleIndexAuxiliaryData } from './useScheduleIndexAuxiliaryData';
import { useScheduleIndexToolbarActions } from './useScheduleIndexToolbarActions';
import { useScheduleIndexDayNavigation } from './useScheduleIndexDayNavigation';
import { useScheduleIndexTodayFocus } from './useScheduleIndexTodayFocus';
import { useScheduleIndexViewModeTransition } from './useScheduleIndexViewModeTransition';
import { useScheduleIndexYearTransition } from './useScheduleIndexYearTransition';
import { useScheduleIndexCalendarActions } from './useScheduleIndexCalendarActions';
import { useScheduleIndexDisplayModel } from './useScheduleIndexDisplayModel';
import { useScheduleIndexMonthLayout } from './useScheduleIndexMonthLayout';
import { useScheduleIndexTransitionStyles } from './useScheduleIndexTransitionStyles';
import { useScheduleIndexAddHandoff } from './useScheduleIndexAddHandoff';
import { useScheduleIndexToolbarPresentation } from './useScheduleIndexToolbarPresentation';
import { useScheduleIndexState } from './useScheduleIndexState';
import { useScheduleIndexLifecycle } from './useScheduleIndexLifecycle';
import { useScheduleIndexBottomBar } from './useScheduleIndexBottomBar';
import { useScheduleItemQuickActions } from './useScheduleItemQuickActions';
import {
  CALENDAR_FIRST_DAY_STORAGE_KEY,
  addDaysToYmd,
  getScheduleIndexErrorMessage as getErrorMessage,
} from './scheduleIndexControllerModel';

/** 일정 목록 화면의 데이터 로딩, 달력 전환, 검색, 추가·공유 모달 상태를 통합 관리합니다. */
export function useScheduleIndexController(
  initialCalendarViewMode: CalendarViewModePreference,
) {
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
  const focusRequest = Array.isArray(params.focus)
    ? params.focus[0]
    : params.focus;
  const focusDayRequest = Array.isArray(params.focusDay)
    ? params.focusDay[0]
    : params.focusDay;
  const focusRun = Array.isArray(params.focusRun)
    ? params.focusRun[0]
    : params.focusRun;
  const stateModel = useScheduleIndexState(initialCalendarViewMode);
  const {
    state,
    dispatch, modalVisible, setModalVisible,
    activeToolbarMenu, setActiveToolbarMenu, setToolbarMenuClosing,
    liquidPrototypeOpen, setLiquidPrototypeOpen, setPrototypeCloseRequest,
    quickModalVisible, setQuickModalVisible, setQuickHandoffHidden,
    shareAttention, setShareAttention, notificationUnreadCount,
    setNotificationUnreadCount, setFormInitialValues, calendarViewMode,
    setCalendarViewMode, calendarDepth, setCalendarDepth,
    dayViewMode, setDayViewMode, dayLayerMounted,
    setDayLayerMounted, dayTransitionTargetDay, setDayTransitionTargetDay,
    yearOverviewVisible, setYearOverviewVisible, yearOverviewClosing,
    setYearOverviewClosing, yearOverviewItemsByYear, setYearOverviewItemsByYear,
    yearOverviewLoadedYearsRef, yearOverviewLoadInFlightRef, yearOverviewLoadSessionRef,
    searchQuery, setSearchQuery, setSearchResults,
    setSearchLoading, setSearchError, searchRetryKey,
    searchInvalidationKey, setCategoryLoading, setCategoryError,
    categoryRetryKey, setCategoryRetryKey, scheduleCalendars,
    setScheduleCalendars, activeCalendarScope, setActiveCalendarScope,
    calendarShareTarget, setCalendarShareTarget, pendingCalendarShareTargetRef,
    calendarShareFallbackTimeoutRef, searchSequenceRef, searchAbortControllerRef,
    handledSearchRetryKeyRef, searchResultCacheRef, keyboardVisible,
    setKeyboardVisible, firstDay, setFirstDay,
    calendarScopeSelectorVisible, setCalendarScopeSelectorVisible, calendarSettingsVisible,
    setCalendarSettingsVisible, setCalendarScrollRequest, setDayTodayRequest,
    setYearTodayRequest, yearOverviewPresentationRequest, setYearOverviewPresentationRequest,
    todayButtonPrimed, setTodayButtonPrimed, reduceMotionEnabled,
    setReduceMotionEnabled, setTransitionMonthKey, dayTransitionContext,
    setDayTransitionContext, setDayModeTransitionFrom, isDayTransitionActive,
    setIsDayTransitionActive, isYearDepthTransitionActive, setIsYearDepthTransitionActive,
    isMonthViewTransitionActive, setIsMonthViewTransitionActive, isTodayFocusTransitionActive,
    setIsTodayFocusTransitionActive, setTodayFocusTarget, dayLayerMountedRef,
    isDayTransitionActiveRef, isYearDepthTransitionActiveRef, retainedMonthAgendaPanelKind,
    setRetainedMonthAgendaPanelKind, outgoingMonthAgendaPanelKind, setOutgoingMonthAgendaPanelKind,
    calendarTransition, todayFocusOpacity, todayFocusTranslateY,
    monthAgendaProgress, monthAgendaSwapProgress, monthCalendarTransitionProgress,
    monthCalendarAnimatedHeight, monthCalendarTargetHeight, monthCalendarAnimatedDayHeight,
    detailMonthMotionActive, yearOverviewProgress, dayTransition,
    dayModeTransition, toolbarDropdownProgress, searchToolbarProgress,
    addHandoffToolbarOpacity, nativeSearchGenerationRef, nativeSearchSessionRef,
    primaryDatePillNativeRef, searchInputRef, dayDisplayPrepareRef,
    monthCalendarHeightRef, monthCalendarDayHeightRef, monthDisplayHeightRef,
    monthDisplayHeight, setMonthDisplayHeight, monthViewTransitionGenerationRef,
    monthViewTransitionFrameRef, yearDepthTransitionFrameRef, monthViewCompletionAnimationRef,
    monthViewTransitionWatchdogRef, todayFocusAnimationRef, todayFocusWatchdogRef,
    todayFocusAnimationGenerationRef, todayFocusAnimationActiveRef, todayFocusCommittedRef,
    todayFocusEnterStartedRef, todayFocusReduceMotionRef, detailMonthMotionCancelRef,
    detailMonthMotionActiveRef, detailMonthFetchFlushFrameRef, transitionStartedRef,
    dayPageNavigationActiveRef, dayTransitionCleanupTimerRef, viewTransitioningRef,
    quickHandoffTimerRef, quickMorphPresenterRef, manualMorphPresenterRef,
    addHandoffPendingRef, addHandoffClosingRef, addHandoffNativeResetRef,
    handledFocusRequestRef, scheduleLoadSequenceRef, pendingScheduleSnapshotRef,
    calendarRevisionSyncPromiseRef, calendarMetadataMountedRef, calendarMetadataLoadedMonthKeysRef,
    calendarMetadataInFlightMonthKeysRef, calendarMetadataRetryTimerRef, calendarMetadataRetryStateRef,
    calendarMetadataLoadPendingRef, pendingCalendarMetadataByDateRef, scheduleItemsByIdRef,
    setPendingSelectedDay, selectedDay, selectedDayRef,
    todayKey, setTodayKey, visibleMonth,
    setVisibleMonth, visibleMonthRef, fetchVisibleMonth,
    updateFetchVisibleMonth, setCalendarDaysByDate, calendarMetadataRetrySequence,
    setCalendarMetadataRetrySequence, scheduleError, scheduleFetchStartAt,
    scheduleFetchEndAt, calendarMetadataPrefetchMonthKeys, calendarMetadataRetryTargetKey,
    calendarMetadataRetryTargetKeyRef,
  } = stateModel;
  const lifecycle = useScheduleIndexLifecycle({ isFocused, stateModel });
  const {
    getScheduleSwipeActions,
    requestScheduleQuickActions,
  } = useScheduleItemQuickActions();
  const {
    handleDayPageNavigationActiveChange,
    overviewYear,
    registerDayDisplayPrepare,
    setOverviewYear,
    visibleYear,
  } = lifecycle;
  const displayModel = useScheduleIndexDisplayModel({
    calendarDepth,
    calendarTransition,
    calendarViewMode,
    dayLayerMounted,
    dayTransitionContext,
    dayTransitionTargetDay,
    dayViewMode,
    isDayTransitionActive,
    isYearDepthTransitionActive,
    primaryDatePillNativeRef,
    reduceMotionEnabled,
    screenWidth,
    selectedDay,
    todayFocusOpacity,
    todayFocusTranslateY,
    visibleMonth,
    visibleYear,
    yearOverviewClosing,
    yearOverviewVisible,
  });
  const {
    detailMonthHeightMotionDuration,
    isDayToMonthTransition,
    isMonthToDayTransition,
    isMonthToYearTransition,
    monthAgendaIsOpen,
    monthAgendaMotionDuration,
    monthAgendaPanelKind,
    monthDisplayFocusedMonth,
    monthDisplayLayoutAnchorDay,
    monthDisplaySelectedDay,
    primaryPillVisible,
  } = displayModel;
  const monthLayout = useScheduleIndexMonthLayout({
    calendarViewMode,
    detailMonthHeightMotionDuration,
    detailMonthMotionActive,
    detailMonthMotionActiveRef,
    firstDay,
    insetsTop: insets.top,
    isDayTransitionActive,
    isMonthViewTransitionActive,
    isYearDepthTransitionActive,
    monthAgendaPanelKind,
    monthAgendaProgress,
    monthAgendaSwapProgress,
    monthCalendarAnimatedDayHeight,
    monthCalendarAnimatedHeight,
    monthCalendarDayHeightRef,
    monthCalendarHeightRef,
    monthCalendarTargetHeight,
    monthDisplayHeight,
    monthDisplayHeightRef,
    monthDisplayLayoutAnchorDay,
    reduceMotionEnabled,
    setMonthDisplayHeight,
  });
  const { resolveMonthCalendarLayout } = monthLayout;
  const transitionStyles = useScheduleIndexTransitionStyles({
    activeToolbarMenu,
    calendarDepth,
    dayLayerMounted,
    dayTransition,
    insetsTop: insets.top,
    isDayTransitionActive,
    liquidPrototypeOpen,
    reduceMotionEnabled,
    screenWidth,
    setPrototypeCloseRequest,
    todayFocusOpacity,
    yearOverviewProgress,
  });
  const {
    isSearchToolbarOpen,
    requestCloseLiquidPrototype,
    searchHeaderTargetWidth,
    usesLiquidViewModeControl,
  } = transitionStyles;
  const addHandoff = useScheduleIndexAddHandoff({
    addHandoffClosingRef,
    addHandoffNativeResetRef,
    addHandoffPendingRef,
    addHandoffToolbarOpacity,
    isFocused,
    liquidPrototypeOpen,
    modalVisible,
    quickHandoffTimerRef,
    quickModalVisible,
    requestCloseLiquidPrototype,
    setFormInitialValues,
    setModalVisible,
    setQuickHandoffHidden,
    setQuickModalVisible,
    usesLiquidViewModeControl,
  });
  const {
    clearQuickHandoffTimer,
    commitAddHandoffPresentation,
    prepareAddHandoff,
  } = addHandoff;
  const toolbarPresentation = useScheduleIndexToolbarPresentation({
    activeToolbarMenu,
    bottomInset: insets.bottom,
    calendarDepth,
    calendarOverlayVisible:
      modalVisible ||
      quickModalVisible ||
      calendarScopeSelectorVisible ||
      calendarSettingsVisible ||
      calendarShareTarget !== null,
    calendarViewMode,
    firstDay,
    isDarkMode: mode === 'dark',
    isDayToMonthTransition,
    isDayTransitionActive,
    isFocused,
    isMonthToDayTransition,
    isMonthToYearTransition,
    isMonthViewTransitionActive,
    isTodayFocusTransitionActive,
    isYearDepthTransitionActive,
    keyboardVisible,
    monthAgendaIsOpen,
    monthCalendarTransitionProgress,
    outgoingMonthAgendaPanelKind,
    primaryPillVisible,
    retainedMonthAgendaPanelKind,
    searchHeaderTargetWidth,
    searchToolbarProgress,
    textPrimaryColor: colors.textPrimary,
    todayFocusOpacity,
    toolbarDropdownProgress,
    topInset: insets.top,
    visibleMonth,
    yearOverviewClosing,
    yearOverviewVisible,
  });
  useEffect(() => {
    return () => {
      clearQuickHandoffTimer();
      // 타이머는 효과 생성 이후 전환 훅에서 등록되므로 해제 시점의 최신 값을 사용한다.
      if (dayTransitionCleanupTimerRef.current) {
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
    dayTransitionCleanupTimerRef,
    monthAgendaProgress,
    monthAgendaSwapProgress,
    monthCalendarAnimatedDayHeight,
    monthCalendarAnimatedHeight,
    monthCalendarTransitionProgress,
    monthViewCompletionAnimationRef,
    monthViewTransitionFrameRef,
    monthViewTransitionGenerationRef,
    monthViewTransitionWatchdogRef,
    todayFocusOpacity,
    todayFocusAnimationGenerationRef,
    todayFocusAnimationRef,
    todayFocusTranslateY,
    todayFocusWatchdogRef,
    yearDepthTransitionFrameRef,
  ]);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [setKeyboardVisible]);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => {
        if (mounted) setReduceMotionEnabled(enabled);
      })
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      setReduceMotionEnabled,
    );

    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, [setReduceMotionEnabled]);

  useEffect(() => {
    if (isFocused && !yearOverviewVisible && !viewTransitioningRef.current) {
      calendarTransition.setValue(1);
    }
  }, [
    calendarTransition,
    isFocused,
    viewTransitioningRef,
    yearOverviewVisible,
  ]);

  useEffect(() => {
    if (selectedDay !== todayKey) {
      setTodayButtonPrimed(false);
    }
  }, [selectedDay, setTodayButtonPrimed, todayKey]);

  useEffect(() => {
    let minuteTimer: ReturnType<typeof setInterval> | null = null;
    let alignmentTimer: ReturnType<typeof setTimeout> | null = null;
    /** 현재 시각을 화면의 오늘 키로 다시 계산한다. */
    const refreshToday = () => setTodayKey(toYmd(new Date()));
    /** 다음 분 경계에 맞춘 뒤 1분 간격 갱신 타이머를 시작한다. */
    const alignToNextMinute = () => {
      const delay = 60_000 - (Date.now() % 60_000) + 24;
      alignmentTimer = setTimeout(() => {
        refreshToday();
        minuteTimer = setInterval(refreshToday, 60_000);
      }, delay);
    };

    alignToNextMinute();
    const appStateSubscription = AppState.addEventListener(
      'change',
      nextState => {
        if (nextState !== 'active') return;
        refreshToday();
        if (minuteTimer) clearInterval(minuteTimer);
        if (alignmentTimer) clearTimeout(alignmentTimer);
        alignToNextMinute();
      },
    );

    return () => {
      if (minuteTimer) clearInterval(minuteTimer);
      if (alignmentTimer) clearTimeout(alignmentTimer);
      appStateSubscription.remove();
    };
  }, [setTodayKey]);

  const calendarData = useScheduleIndexCalendarData({
    calendarMetadataInFlightMonthKeysRef,
    calendarMetadataLoadPendingRef,
    calendarMetadataLoadedMonthKeysRef,
    calendarMetadataMountedRef,
    calendarMetadataPrefetchMonthKeys,
    calendarMetadataRetrySequence,
    calendarMetadataRetryStateRef,
    calendarMetadataRetryTargetKey,
    calendarMetadataRetryTargetKeyRef,
    calendarMetadataRetryTimerRef,
    calendarRevisionSyncPromiseRef,
    detailMonthMotionActiveRef,
    dispatch,
    fetchVisibleMonth,
    firstDay,
    getErrorMessage,
    isFocused,
    pendingCalendarMetadataByDateRef,
    pendingScheduleSnapshotRef,
    scheduleFetchEndAt,
    scheduleFetchStartAt,
    scheduleItemsByIdRef,
    scheduleLoadSequenceRef,
    setCalendarDaysByDate,
    setCalendarMetadataRetrySequence,
  });
  const {
    applyScheduleItemsToStore,
    loadSchedules,
    mergeCalendarMetadataIntoState,
  } = calendarData;
  const auxiliaryData = useScheduleIndexAuxiliaryData({
    activeCalendarScope,
    categoryRetryKey,
    dispatch,
    getErrorMessage,
    handledSearchRetryKeyRef,
    isFocused,
    itemsById: state.itemsById,
    overviewYear,
    scheduleCalendars,
    scheduleCategories: state.categories,
    searchAbortControllerRef,
    searchInvalidationKey,
    searchQuery,
    searchResultCacheRef,
    searchRetryKey,
    searchSequenceRef,
    setActiveCalendarScope,
    setCategoryError,
    setCategoryLoading,
    setCategoryRetryKey,
    setNotificationUnreadCount,
    setScheduleCalendars,
    setSearchError,
    setSearchLoading,
    setSearchResults,
    setShareAttention,
    setYearOverviewItemsByYear,
    yearOverviewItemsByYear,
    yearOverviewLoadedYearsRef,
    yearOverviewLoadInFlightRef,
    yearOverviewLoadSessionRef,
    yearOverviewPresentationRequest,
    yearOverviewVisible,
  });
  const {
    itemsArray,
    requireActiveCalendarWriteAccess,
    routeSetupItems,
  } = auxiliaryData;
  const toolbarActions = useScheduleIndexToolbarActions({
    activeCalendarScope,
    activeToolbarMenu,
    applyScheduleItemsToStore,
    commitAddHandoffPresentation,
    dispatch,
    fetchVisibleMonth,
    getErrorMessage,
    isSearchToolbarOpen,
    loadSchedules,
    manualMorphPresenterRef,
    nativeSearchGenerationRef,
    nativeSearchSessionRef,
    pendingScheduleSnapshotRef,
    prepareAddHandoff,
    quickMorphPresenterRef,
    requestCloseLiquidPrototype,
    requireActiveCalendarWriteAccess,
    router,
    scheduleCalendars,
    scheduleFetchEndAt,
    scheduleFetchStartAt,
    scheduleLoadSequenceRef,
    searchInputRef,
    searchToolbarProgress,
    setActiveToolbarMenu,
    setFormInitialValues,
    setLiquidPrototypeOpen,
    setModalVisible,
    setQuickHandoffHidden,
    setQuickModalVisible,
    setSearchQuery,
    setToolbarMenuClosing,
    todayKey,
    toolbarDropdownProgress,
    usesLiquidViewModeControl,
  });
  const {
    addItem,
    closeToolbarMenu,
  } = toolbarActions;
  const dayNavigation = useScheduleIndexDayNavigation({
    addDaysToYmd,
    addItem,
    calendarDepth,
    calendarTransition,
    closeToolbarMenu,
    dayDisplayPrepareRef,
    dayLayerMounted,
    dayLayerMountedRef,
    dayModeTransition,
    dayPageNavigationActiveRef,
    dayTransition,
    dayTransitionCleanupTimerRef,
    dispatch,
    isDayTransitionActive,
    isDayTransitionActiveRef,
    isYearDepthTransitionActive,
    isYearDepthTransitionActiveRef,
    reduceMotionEnabled,
    router,
    selectedDay,
    selectedDayRef,
    setCalendarDepth,
    setDayLayerMounted,
    setDayModeTransitionFrom,
    setDayTransitionContext,
    setDayTransitionTargetDay,
    setDayViewMode,
    setIsDayTransitionActive,
    setIsYearDepthTransitionActive,
    setPendingSelectedDay,
    setTodayButtonPrimed,
    setTransitionMonthKey,
    setVisibleMonth,
    setYearOverviewClosing,
    setYearOverviewVisible,
    todayKey,
    transitionStartedRef,
    viewTransitioningRef,
    yearOverviewProgress,
  });
  const {
    animateDayModeTransition,
    animateYearDepthTransition,
    closeDayDisplay,
    handleOpenDay,
    handleOpenScheduleFromDayDisplay,
    selectCalendarDay,
  } = dayNavigation;
  const todayFocus = useScheduleIndexTodayFocus({
    applyScheduleItemsToStore,
    calendarDepth,
    calendarMetadataLoadPendingRef,
    calendarTransition,
    closeToolbarMenu,
    dayTransition,
    detailMonthFetchFlushFrameRef,
    detailMonthMotionActive,
    detailMonthMotionActiveRef,
    detailMonthMotionCancelRef,
    dispatch,
    focusDayRequest,
    focusRequest,
    focusRun,
    handleOpenDay,
    handledFocusRequestRef,
    isDayTransitionActiveRef,
    isYearDepthTransitionActiveRef,
    mergeCalendarMetadataIntoState,
    pendingCalendarMetadataByDateRef,
    pendingScheduleSnapshotRef,
    reduceMotionEnabled,
    scheduleLoadSequenceRef,
    selectCalendarDay,
    selectedDay,
    setCalendarDepth,
    setCalendarMetadataRetrySequence,
    setCalendarScrollRequest,
    setDayTodayRequest,
    setDayTransitionContext,
    setDayTransitionTargetDay,
    setIsDayTransitionActive,
    setIsTodayFocusTransitionActive,
    setIsYearDepthTransitionActive,
    setPendingSelectedDay,
    setTodayButtonPrimed,
    setTodayFocusTarget,
    setTransitionMonthKey,
    setVisibleMonth,
    setYearOverviewClosing,
    setYearOverviewVisible,
    setYearTodayRequest,
    todayButtonPrimed,
    todayFocusAnimationActiveRef,
    todayFocusAnimationGenerationRef,
    todayFocusAnimationRef,
    todayFocusCommittedRef,
    todayFocusEnterStartedRef,
    todayFocusOpacity,
    todayFocusReduceMotionRef,
    todayFocusTranslateY,
    todayFocusWatchdogRef,
    todayKey,
    transitionStartedRef,
    updateFetchVisibleMonth,
    viewTransitioningRef,
    visibleMonth,
    visibleMonthRef,
    yearOverviewProgress,
    yearOverviewVisible,
  });
  const { handleGoToday } = todayFocus;
  const viewModeTransition = useScheduleIndexViewModeTransition({
      animateDayModeTransition,
      calendarDepth,
      calendarTransition,
      calendarViewMode,
      closeToolbarMenu,
      dayPageNavigationActiveRef,
      dayTransition,
      dayViewMode,
      detailMonthMotionCancelRef,
      isDayTransitionActive,
      monthAgendaMotionDuration,
      monthAgendaPanelKind,
      monthAgendaProgress,
      monthAgendaSwapProgress,
      monthCalendarAnimatedDayHeight,
      monthCalendarAnimatedHeight,
      monthCalendarDayHeightRef,
      monthCalendarHeightRef,
      monthCalendarTargetHeight,
      monthCalendarTransitionProgress,
      monthDisplayHeightRef,
      monthViewCompletionAnimationRef,
      monthViewTransitionFrameRef,
      monthViewTransitionGenerationRef,
      monthViewTransitionWatchdogRef,
      reduceMotionEnabled,
      resolveMonthCalendarLayout,
      setCalendarViewMode,
      setDayLayerMounted,
      setDayModeTransitionFrom,
      setDayViewMode,
      setIsMonthViewTransitionActive,
      setOutgoingMonthAgendaPanelKind,
      setRetainedMonthAgendaPanelKind,
      viewTransitioningRef,
    });
  const { handleCalendarViewModeChange } = viewModeTransition;
  const yearTransition = useScheduleIndexYearTransition({
      animateYearDepthTransition,
      calendarDepth,
      calendarTransition,
      closeDayDisplay,
      closeToolbarMenu,
      dayTransition,
      dispatch,
      isDayTransitionActive,
      isDayTransitionActiveRef,
      isYearDepthTransitionActive,
      isYearDepthTransitionActiveRef,
      setCalendarDepth,
      setDayModeTransitionFrom,
      setDayTransitionContext,
      setIsYearDepthTransitionActive,
      setOverviewYear,
      setPendingSelectedDay,
      setTodayButtonPrimed,
      setTransitionMonthKey,
      setVisibleMonth,
      setYearOverviewClosing,
      setYearOverviewPresentationRequest,
      setYearOverviewVisible,
      selectedDayRef,
      todayKey,
      transitionStartedRef,
      updateFetchVisibleMonth,
      viewTransitioningRef,
      visibleMonth,
      visibleYear,
      yearDepthTransitionFrameRef,
      yearOverviewClosing,
      yearOverviewProgress,
      yearOverviewVisible,
    });
  const calendarActions = useScheduleIndexCalendarActions({
    calendarShareFallbackTimeoutRef,
    calendarShareTarget,
    closeToolbarMenu,
    firstDayStorageKey: CALENDAR_FIRST_DAY_STORAGE_KEY,
    pendingCalendarShareTargetRef,
    routeSetupItems,
    setCalendarScopeSelectorVisible,
    setCalendarSettingsVisible,
    setCalendarShareTarget,
    setFirstDay,
    setScheduleCalendars,
  });
  const {
    openAccountSettings,
    openCalendarScopeSelector,
    openRouteSetupTarget,
  } = calendarActions;
  const bottomBar = useScheduleIndexBottomBar({
    activeCalendarScope,
    bottomInset: insets.bottom,
    calendarScopeSelectorVisible,
    handleCalendarViewModeChange,
    handleGoToday,
    handleOpenScheduleFromDayDisplay,
    getScheduleSwipeActions,
    onRequestScheduleActions: requestScheduleQuickActions,
    itemsArray,
    loadSchedules,
    monthDisplayFocusedMonth,
    monthDisplaySelectedDay,
    notificationUnreadCount,
    openAccountSettings,
    openCalendarScopeSelector,
    openRouteSetupTarget,
    routeSetupRequiredCount: routeSetupItems.length,
    scheduleCalendars,
    scheduleError,
    scheduleLoading: state.loading,
    shareBadgeCount: shareAttention.unseenCount,
    textSecondaryColor: colors.textSecondary,
  });
  return {
    isFocused,
    insets,
    mode,
    colors,
    getScheduleSwipeActions,
    requestScheduleQuickActions,
    ...stateModel,
    registerDayDisplayPrepare,
    handleDayPageNavigationActiveChange,
    overviewYear,
    visibleYear,
    ...displayModel,
    ...monthLayout,
    ...transitionStyles,
    ...addHandoff,
    ...toolbarPresentation,
    ...calendarData,
    ...auxiliaryData,
    ...toolbarActions,
    ...dayNavigation,
    ...todayFocus,
    ...viewModeTransition,
    ...yearTransition,
    ...calendarActions,
    ...bottomBar,
  };
}

export type ScheduleIndexController = ReturnType<
  typeof useScheduleIndexController
>;
