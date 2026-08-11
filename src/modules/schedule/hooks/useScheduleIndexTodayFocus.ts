import {
  startTransition as startReactTransition,
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { Animated, Easing } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import {
  CALENDAR_DEPTH_MOTION,
  CALENDAR_INTERACTION_BUDGET_MS,
  CALENDAR_TODAY_FOCUS_MOTION,
} from '../calendarMotion';
import type { CalendarDayMetadata } from '../calendarMetadata';
import type { DayTransitionContext } from '../components/calendar/CalendarWrapper';
import type { ScheduleItem } from '../types';
import { useScheduleStore } from '../store';

const CALENDAR_DEPTH_EASING = Easing.bezier(...CALENDAR_DEPTH_MOTION.bezier);

type CalendarDepth = 'year' | 'month' | 'day';
type TodayFocusTarget = {
  day: string;
  requiresMonthChange: boolean;
};
type SetValue<T> = Dispatch<SetStateAction<T>>;

type Options = {
  applyScheduleItemsToStore: (items: ScheduleItem[]) => void;
  calendarDepth: CalendarDepth;
  calendarMetadataLoadPendingRef: MutableRefObject<boolean>;
  calendarTransition: Animated.Value;
  closeToolbarMenu: (afterClose?: () => void) => void;
  dayTransition: Animated.Value;
  detailMonthFetchFlushFrameRef: MutableRefObject<number | null>;
  detailMonthMotionActive: SharedValue<boolean>;
  detailMonthMotionActiveRef: MutableRefObject<boolean>;
  detailMonthMotionCancelRef: MutableRefObject<(() => void) | null>;
  dispatch: ReturnType<typeof useScheduleStore>['dispatch'];
  focusDayRequest?: string;
  focusRequest?: string;
  focusRun?: string;
  handleOpenDay: (day: string) => void;
  handledFocusRequestRef: MutableRefObject<string | null>;
  isDayTransitionActiveRef: MutableRefObject<boolean>;
  isYearDepthTransitionActiveRef: MutableRefObject<boolean>;
  mergeCalendarMetadataIntoState: (
    metadata: Record<string, CalendarDayMetadata>,
  ) => void;
  pendingCalendarMetadataByDateRef: MutableRefObject<Record<string, CalendarDayMetadata>>;
  pendingScheduleSnapshotRef: MutableRefObject<{
    requestSequence: number;
    items: ScheduleItem[];
  } | null>;
  reduceMotionEnabled: boolean;
  scheduleLoadSequenceRef: MutableRefObject<number>;
  selectCalendarDay: (day: string) => void;
  selectedDay: string;
  setCalendarDepth: SetValue<CalendarDepth>;
  setCalendarMetadataRetrySequence: SetValue<number>;
  setCalendarScrollRequest: SetValue<number>;
  setDayTodayRequest: SetValue<number>;
  setDayTransitionContext: SetValue<DayTransitionContext>;
  setDayTransitionTargetDay: SetValue<string | null>;
  setIsDayTransitionActive: SetValue<boolean>;
  setIsTodayFocusTransitionActive: SetValue<boolean>;
  setIsYearDepthTransitionActive: SetValue<boolean>;
  setPendingSelectedDay: SetValue<string | null>;
  setTodayButtonPrimed: SetValue<boolean>;
  setTodayFocusTarget: SetValue<TodayFocusTarget | null>;
  setTransitionMonthKey: SetValue<string | null>;
  setVisibleMonth: SetValue<string>;
  setYearOverviewClosing: SetValue<boolean>;
  setYearOverviewVisible: SetValue<boolean>;
  setYearTodayRequest: SetValue<number>;
  todayButtonPrimed: boolean;
  todayFocusAnimationActiveRef: MutableRefObject<boolean>;
  todayFocusAnimationGenerationRef: MutableRefObject<number>;
  todayFocusAnimationRef: MutableRefObject<Animated.CompositeAnimation | null>;
  todayFocusCommittedRef: MutableRefObject<boolean>;
  todayFocusEnterStartedRef: MutableRefObject<boolean>;
  todayFocusOpacity: Animated.Value;
  todayFocusReduceMotionRef: MutableRefObject<boolean>;
  todayFocusTranslateY: Animated.Value;
  todayFocusWatchdogRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  todayKey: string;
  transitionStartedRef: MutableRefObject<boolean>;
  updateFetchVisibleMonth: (month: string) => void;
  viewTransitioningRef: MutableRefObject<boolean>;
  visibleMonth: string;
  visibleMonthRef: MutableRefObject<string>;
  yearOverviewProgress: Animated.Value;
  yearOverviewVisible: boolean;
};

/**
 * 오늘 이동의 퇴장·달력 갱신·재진입 애니메이션과 상세 월 제스처 종료 후 데이터 flush를 관리한다.
 * 외부 focus query와 화면 깊이를 함께 조정해 오늘 버튼과 딥링크가 같은 전환 규칙을 사용하게 한다.
 */
export function useScheduleIndexTodayFocus({
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
}: Options) {
  /** 오늘을 선택·표시 월·스크롤 요청에 함께 반영하고 필요하면 달력 레이어를 즉시 노출한다. */
  const focusTodayOnCalendar = useCallback(
    (options?: { revealImmediately?: boolean }) => {
      closeToolbarMenu();
      setPendingSelectedDay(todayKey);
      dispatch({ type: 'SET_SELECTED_DAY', day: todayKey });
      setVisibleMonth(todayKey);
      setCalendarScrollRequest(request => request + 1);
      setTodayButtonPrimed(true);
      if (options?.revealImmediately !== false) {
        calendarTransition.setValue(1);
      }
    },
    [
      calendarTransition,
      closeToolbarMenu,
      dispatch,
      setCalendarScrollRequest,
      setPendingSelectedDay,
      setTodayButtonPrimed,
      setVisibleMonth,
      todayKey,
    ],
  );

  /** 현재 세대의 오늘 전환을 종료하고 미커밋 상태라면 오늘 선택을 한 번만 확정한다. */
  const finishTodayFocusTransition = useCallback(
    (generation: number, commitIfNeeded = false) => {
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
    },
    [
      focusTodayOnCalendar,
      setIsTodayFocusTransitionActive,
      setTodayFocusTarget,
      todayFocusAnimationActiveRef,
      todayFocusAnimationGenerationRef,
      todayFocusAnimationRef,
      todayFocusCommittedRef,
      todayFocusEnterStartedRef,
      todayFocusOpacity,
      todayFocusTranslateY,
      todayFocusWatchdogRef,
      transitionStartedRef,
    ],
  );

  /** 오늘 월이 준비된 뒤 새 달력 레이어를 원래 위치와 불투명도로 진입시킨다. */
  const startTodayFocusEnterTransition = useCallback(
    (generation: number) => {
      if (
        generation !== todayFocusAnimationGenerationRef.current ||
        !todayFocusAnimationActiveRef.current ||
        !todayFocusCommittedRef.current ||
        todayFocusEnterStartedRef.current
      )
        return;

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
    },
    [
      finishTodayFocusTransition,
      todayFocusAnimationActiveRef,
      todayFocusAnimationGenerationRef,
      todayFocusAnimationRef,
      todayFocusCommittedRef,
      todayFocusEnterStartedRef,
      todayFocusOpacity,
      todayFocusReduceMotionRef,
      todayFocusTranslateY,
    ],
  );

  /** 달력이 오늘 목표의 렌더 준비를 알리면 해당 전환 세대의 진입 단계를 시작한다. */
  const handleTodayFocusReady = useCallback(
    (day: string) => {
      if (day !== todayKey) return;
      startTodayFocusEnterTransition(todayFocusAnimationGenerationRef.current);
    },
    [
      startTodayFocusEnterTransition,
      todayFocusAnimationGenerationRef,
      todayKey,
    ],
  );

  /** 상세 월 컴포넌트가 제공한 취소 함수를 등록해 오늘 이동이 진행 중 제스처를 선점할 수 있게 한다. */
  const registerDetailMonthMotionCancel = useCallback(
    (cancel: (() => void) | null) => {
      detailMonthMotionCancelRef.current = cancel;
    },
    [detailMonthMotionCancelRef],
  );

  /** 상세 월 제스처 소유권을 기록하고 종료 한 프레임 뒤 보류된 일정·메타데이터를 합쳐 반영한다. */
  const handleDetailMonthMotionActiveChange = useCallback(
    (active: boolean) => {
      detailMonthMotionActiveRef.current = active;
      detailMonthMotionActive.value = active;
      const pendingFrame = detailMonthFetchFlushFrameRef.current;
      if (pendingFrame !== null) {
        cancelAnimationFrame(pendingFrame);
        detailMonthFetchFlushFrameRef.current = null;
      }
      if (active) return;

      // A queued gesture can start from the UI-thread endpoint in the same
      // JS turn. Wait one paint before flushing so a continuous burst
      // performs schedule/metadata work only for its final month.
      const frame = requestAnimationFrame(() => {
        if (detailMonthFetchFlushFrameRef.current === frame) {
          detailMonthFetchFlushFrameRef.current = null;
        }
        if (detailMonthMotionActiveRef.current) return;
        const pendingMetadata = pendingCalendarMetadataByDateRef.current;
        pendingCalendarMetadataByDateRef.current = {};
        const shouldLoadPendingMetadata =
          calendarMetadataLoadPendingRef.current;
        calendarMetadataLoadPendingRef.current = false;
        const pendingSchedule = pendingScheduleSnapshotRef.current;
        pendingScheduleSnapshotRef.current = null;
        startReactTransition(() => {
          if (Object.keys(pendingMetadata).length > 0) {
            mergeCalendarMetadataIntoState(pendingMetadata);
          }
          if (
            pendingSchedule &&
            pendingSchedule.requestSequence === scheduleLoadSequenceRef.current
          ) {
            applyScheduleItemsToStore(pendingSchedule.items);
          }
          if (shouldLoadPendingMetadata) {
            setCalendarMetadataRetrySequence(current => current + 1);
          }
          updateFetchVisibleMonth(visibleMonthRef.current);
        });
      });
      detailMonthFetchFlushFrameRef.current = frame;
    },
    [
      applyScheduleItemsToStore,
      calendarMetadataLoadPendingRef,
      detailMonthFetchFlushFrameRef,
      detailMonthMotionActive,
      detailMonthMotionActiveRef,
      mergeCalendarMetadataIntoState,
      pendingCalendarMetadataByDateRef,
      pendingScheduleSnapshotRef,
      scheduleLoadSequenceRef,
      setCalendarMetadataRetrySequence,
      updateFetchVisibleMonth,
      visibleMonthRef,
    ],
  );

  useEffect(
    () => () => {
      const pendingFrame = detailMonthFetchFlushFrameRef.current;
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
    },
    [detailMonthFetchFlushFrameRef],
  );

  /** 현재 달력 레이어를 퇴장시킨 뒤 오늘을 커밋하고 새 월의 진입 준비 상태를 만든다. */
  const startTodayFocusTransition = useCallback(() => {
    if (
      todayFocusAnimationActiveRef.current ||
      isDayTransitionActiveRef.current ||
      isYearDepthTransitionActiveRef.current ||
      transitionStartedRef.current ||
      viewTransitioningRef.current
    )
      return;

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
        requiresMonthChange: visibleMonth.slice(0, 7) !== todayKey.slice(0, 7),
      });
      focusTodayOnCalendar({ revealImmediately: false });
    });
  }, [
    closeToolbarMenu,
    detailMonthMotionCancelRef,
    finishTodayFocusTransition,
    focusTodayOnCalendar,
    isDayTransitionActiveRef,
    isYearDepthTransitionActiveRef,
    reduceMotionEnabled,
    setIsTodayFocusTransitionActive,
    setTodayFocusTarget,
    todayKey,
    todayFocusAnimationActiveRef,
    todayFocusAnimationGenerationRef,
    todayFocusAnimationRef,
    todayFocusCommittedRef,
    todayFocusEnterStartedRef,
    todayFocusOpacity,
    todayFocusReduceMotionRef,
    todayFocusTranslateY,
    todayFocusWatchdogRef,
    transitionStartedRef,
    viewTransitioningRef,
    visibleMonth,
  ]);

  useEffect(() => {
    const focusKey = `${focusRequest ?? ''}:${focusDayRequest ?? ''}:${
      focusRun ?? ''
    }`;
    if (handledFocusRequestRef.current === focusKey) return;

    if (focusRequest === 'today') {
      handledFocusRequestRef.current = focusKey;
      transitionStartedRef.current = false;
      yearOverviewProgress.stopAnimation();
      yearOverviewProgress.setValue(0);
      setYearOverviewVisible(false);
      setYearOverviewClosing(false);
      const isTodayAlreadyFocused =
        selectedDay === todayKey &&
        visibleMonth.slice(0, 7) === todayKey.slice(0, 7);
      if (calendarDepth === 'month' && !isTodayAlreadyFocused) {
        startTodayFocusTransition();
      } else {
        focusTodayOnCalendar();
      }
      return;
    }

    if (focusRequest === 'day' && focusDayRequest) {
      handledFocusRequestRef.current = focusKey;
      setTransitionMonthKey(focusDayRequest.slice(0, 7));
      handleOpenDay(focusDayRequest);
      calendarTransition.setValue(1);
      return;
    }

    if (focusRequest === 'month' && focusDayRequest) {
      handledFocusRequestRef.current = focusKey;
      closeToolbarMenu();
      dayTransition.stopAnimation();
      yearOverviewProgress.stopAnimation();
      transitionStartedRef.current = false;
      setIsDayTransitionActive(false);
      setIsYearDepthTransitionActive(false);
      setDayTransitionContext('idle');
      setYearOverviewVisible(false);
      setYearOverviewClosing(false);
      setPendingSelectedDay(focusDayRequest);
      setDayTransitionTargetDay(null);
      dispatch({ type: 'SET_SELECTED_DAY', day: focusDayRequest });
      setVisibleMonth(focusDayRequest);
      setCalendarScrollRequest(request => request + 1);
      setTodayButtonPrimed(focusDayRequest === todayKey);
      setCalendarDepth('month');
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
    handledFocusRequestRef,
    handleOpenDay,
    selectedDay,
    setCalendarDepth,
    setCalendarScrollRequest,
    setDayTransitionContext,
    setDayTransitionTargetDay,
    setIsDayTransitionActive,
    setIsYearDepthTransitionActive,
    setPendingSelectedDay,
    setTodayButtonPrimed,
    setTransitionMonthKey,
    setVisibleMonth,
    setYearOverviewClosing,
    setYearOverviewVisible,
    startTodayFocusTransition,
    todayKey,
    transitionStartedRef,
    visibleMonth,
    yearOverviewProgress,
  ]);

  /** 현재 연간·일간·월간 깊이에 맞는 오늘 이동 동작을 선택하고 반복 탭은 일간 열기로 승격한다. */
  const handleGoToday = useCallback(() => {
    if (todayFocusAnimationActiveRef.current) return;

    if (yearOverviewVisible) {
      closeToolbarMenu();
      selectCalendarDay(todayKey);
      setCalendarDepth('year');
      setYearTodayRequest(request => request + 1);
      return;
    }

    if (calendarDepth === 'day') {
      closeToolbarMenu();
      dayTransition.setValue(1);
      setDayTodayRequest(request => request + 1);
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
    setCalendarDepth,
    setDayTodayRequest,
    setYearTodayRequest,
    startTodayFocusTransition,
    todayButtonPrimed,
    todayFocusAnimationActiveRef,
    todayKey,
    visibleMonth,
    yearOverviewVisible,
  ]);


  return {
    finishTodayFocusTransition,
    focusTodayOnCalendar,
    handleDetailMonthMotionActiveChange,
    handleGoToday,
    handleTodayFocusReady,
    registerDetailMonthMotionCancel,
    startTodayFocusTransition,
  };
}
