import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import {
  Animated,
  Easing,
  unstable_batchedUpdates,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { isContinuousMonthViewMode, type CalendarViewMode } from '../components/calendar/viewMode';
import type { DayTransitionContext } from '../components/calendar/CalendarWrapper';
import {
  CALENDAR_DEPTH_MOTION,
  CALENDAR_INTERACTION_BUDGET_MS,
} from '../calendarMotion';
import { DAY_NAVIGATION_MOTION } from '../dayNavigationMotion';
import { getScheduleFocusDay } from '../calendarNavigation';
import type { ScheduleItem } from '../types';
import { useScheduleStore } from '../store';
import { useImmediateNavigationTransition } from '../../performance/ImmediateNavigationTransition';

const DAY_NAVIGATION_EASING = Easing.bezier(...DAY_NAVIGATION_MOTION.bezier);
const CALENDAR_DEPTH_EASING = Easing.bezier(...CALENDAR_DEPTH_MOTION.bezier);

type CalendarDepth = 'year' | 'month' | 'day';
type DayViewMode = 'singleDay' | 'multiDay';
type SetValue<T> = Dispatch<SetStateAction<T>>;

type Options = {
  addDaysToYmd: (day: string, offset: number) => string;
  addItem: (payload: Omit<ScheduleItem, 'id'>) => Promise<ScheduleItem>;
  calendarDepth: CalendarDepth;
  calendarViewMode: CalendarViewMode;
  calendarTransition: Animated.Value;
  closeToolbarMenu: (afterClose?: () => void) => void;
  dayLayerMounted: boolean;
  dayTransitionContext: DayTransitionContext;
  dayTransitionTargetDay: string | null;
  dayModeTransition: Animated.Value;
  dayPageNavigationActiveRef: MutableRefObject<boolean>;
  dayTransition: Animated.Value;
  dayTransitionCleanupTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  dispatch: ReturnType<typeof useScheduleStore>['dispatch'];
  isDayTransitionActive: boolean;
  isDayTransitionActiveRef: MutableRefObject<boolean>;
  isYearDepthTransitionActive: boolean;
  isYearDepthTransitionActiveRef: MutableRefObject<boolean>;
  reduceMotionEnabled: boolean;
  router: ReturnType<typeof useRouter>;
  selectedDay: string;
  selectedDayRef: MutableRefObject<string>;
  setCalendarDepth: SetValue<CalendarDepth>;
  setDayLayerMounted: SetValue<boolean>;
  setDayModeTransitionFrom: SetValue<DayViewMode | null>;
  setDayTransitionContext: SetValue<DayTransitionContext>;
  setDayTransitionTargetDay: SetValue<string | null>;
  setDayViewMode: SetValue<DayViewMode>;
  setIsDayTransitionActive: SetValue<boolean>;
  setIsYearDepthTransitionActive: SetValue<boolean>;
  setPendingSelectedDay: SetValue<string | null>;
  setTodayButtonPrimed: SetValue<boolean>;
  setTransitionMonthKey: SetValue<string | null>;
  setVisibleMonth: SetValue<string>;
  setYearOverviewClosing: SetValue<boolean>;
  setYearOverviewVisible: SetValue<boolean>;
  todayKey: string;
  transitionStartedRef: MutableRefObject<boolean>;
  viewTransitioningRef: MutableRefObject<boolean>;
  yearOverviewProgress: Animated.Value;
};

/**
 * 월 달력의 날짜 선택과 일 상세 진입·이동·복귀 애니메이션을 관리한다.
 * 전환 잠금과 watchdog을 공유해 중복 탭이나 페이지 이동이 깊이 전환을 중간 상태에 남기지 않게 한다.
 */
export function useScheduleIndexDayNavigation({
  addDaysToYmd,
  addItem,
  calendarDepth,
  calendarViewMode,
  calendarTransition,
  closeToolbarMenu,
  dayLayerMounted,
  dayTransitionContext,
  dayTransitionTargetDay,
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
}: Options) {
  const { runWithTransitionShell } = useImmediateNavigationTransition();
  const openedSchedule = useRef<{ id: string; restoreFocus?: () => void } | null>(null);
  const returnFocusFrame = useRef<number | null>(null);
  useEffect(() => () => {
    if (returnFocusFrame.current !== null) cancelAnimationFrame(returnFocusFrame.current);
  }, []);
  const returnOpacity = useRef(new Animated.Value(0)).current;
  const [returnedScheduleId, setReturnedScheduleId] = useState<string | null>(null);
  const [savedAgendaTarget, setSavedAgendaTarget] = useState<{
    day: string;
    itemId: string;
    categoryId?: string;
    stackPending?: boolean;
  }>();
  const clearSavedAgendaTarget = useCallback(() => setSavedAgendaTarget(undefined), []);
  const pendingStackSaveRef = useRef<{ itemId: string; finish: (apply?: boolean) => void } | null>(null);
  const stackSaveCloseRef = useRef<{ itemId: string; resolve: () => void } | null>(null);
  useEffect(() => () => {
    pendingStackSaveRef.current?.finish(false);
    stackSaveCloseRef.current?.resolve();
  }, []);
  useEffect(() => {
    const close = stackSaveCloseRef.current;
    if (!close || savedAgendaTarget?.itemId !== close.itemId || savedAgendaTarget.stackPending) return;
    // Let the calendar commit paint before the native close animation uncovers it.
    let closeFrame: number | undefined;
    const paintFrame = requestAnimationFrame(() => {
      closeFrame = requestAnimationFrame(() => {
        if (stackSaveCloseRef.current !== close) return;
        stackSaveCloseRef.current = null;
        close.resolve();
      });
    });
    return () => {
      cancelAnimationFrame(paintFrame);
      if (closeFrame !== undefined) cancelAnimationFrame(closeFrame);
    };
  }, [savedAgendaTarget]);
  const handleSavedStackPositionReady = useCallback((itemId: string) => {
    const pending = pendingStackSaveRef.current;
    if (pending?.itemId === itemId) pending.finish();
  }, []);
  const highlightReturnedSchedule = useCallback(() => {
    const entry = openedSchedule.current;
    openedSchedule.current = null;
    if (!entry) return;
    setReturnedScheduleId(entry.id);
    if (entry.restoreFocus) {
      if (returnFocusFrame.current !== null) cancelAnimationFrame(returnFocusFrame.current);
      returnFocusFrame.current = requestAnimationFrame(() => {
        returnFocusFrame.current = null;
        entry.restoreFocus?.();
      });
    }
  }, []);
  useFocusEffect(highlightReturnedSchedule);
  useEffect(() => {
    if (!returnedScheduleId || reduceMotionEnabled) {
      returnOpacity.setValue(0);
      if (returnedScheduleId) setReturnedScheduleId(null);
      return;
    }
    returnOpacity.setValue(0.09);
    const fade = Animated.timing(returnOpacity, { toValue: 0, duration: 180, useNativeDriver: true });
    fade.start(({ finished }) => {
      if (finished) setReturnedScheduleId(null);
    });
    return () => fade.stop();
  }, [reduceMotionEnabled, returnOpacity, returnedScheduleId]);
  /** 달력이 보고한 표시 월을 반영하고 오늘이 아닌 월로 이동하면 오늘 버튼의 준비 상태를 해제한다. */
  const handleVisibleMonthChange = useCallback(
    (month: string) => {
      setVisibleMonth(month);
      setTransitionMonthKey(null);
      if (month.slice(0, 7) !== todayKey.slice(0, 7)) {
        setTodayButtonPrimed(false);
      }
    },
    [
      setTodayButtonPrimed,
      setTransitionMonthKey,
      setVisibleMonth,
      todayKey,
    ],
  );

  /** 선택 일자·표시 월·오늘 버튼 상태를 하나의 사용자 선택으로 함께 갱신한다. */
  const selectCalendarDay = useCallback(
    (day: string) => {
      setPendingSelectedDay(day);
      dispatch({ type: 'SET_SELECTED_DAY', day });
      setVisibleMonth(day);
      setTransitionMonthKey(null);
      setTodayButtonPrimed(day === todayKey);
    },
    [
      dispatch,
      setPendingSelectedDay,
      setTodayButtonPrimed,
      setTransitionMonthKey,
      setVisibleMonth,
      todayKey,
    ],
  );

  /** 달력 셀의 선택 이벤트를 공통 일자 선택 경로로 전달한다. */
  const handleSelectDay = useCallback(
    (day: string) => {
      selectCalendarDay(day);
    },
    [selectCalendarDay],
  );

  /** 저장한 일정의 시작 일자를 달력에서 선택하고 모달에서 저장 오류를 표시한다. */
  const addAndRevealItem = async (payload: Omit<ScheduleItem, 'id'>) => {
    const saved = await addItem(payload);

    const savedDay = getScheduleFocusDay(saved.startAt);
    if (!savedDay) return;

    const target = { day: savedDay, itemId: saved.id, categoryId: saved.category?.id };
    if (calendarDepth !== 'month' || !isContinuousMonthViewMode(calendarViewMode)) {
      selectCalendarDay(savedDay);
      setSavedAgendaTarget(target);
      return;
    }

    await new Promise<void>(resolve => {
      // Keep the editor open until native scrolling confirms the return position.
      const finish = (apply = true) => {
        clearTimeout(watchdog);
        pendingStackSaveRef.current = null;
        if (apply) {
          stackSaveCloseRef.current?.resolve();
          stackSaveCloseRef.current = { itemId: saved.id, resolve };
          unstable_batchedUpdates(() => {
            setVisibleMonth(savedDay);
            setSavedAgendaTarget(target);
          });
        } else {
          resolve();
        }
      };
      const watchdog = setTimeout(finish, CALENDAR_INTERACTION_BUDGET_MS);
      pendingStackSaveRef.current?.finish(false);
      pendingStackSaveRef.current = { itemId: saved.id, finish };
      unstable_batchedUpdates(() => {
        setPendingSelectedDay(savedDay);
        dispatch({ type: 'SET_SELECTED_DAY', day: savedDay });
        setTransitionMonthKey(null);
        setTodayButtonPrimed(savedDay === todayKey);
        setSavedAgendaTarget({ ...target, stackPending: true });
      });
    });
  };

  /** 월간·일간 레이어 사이의 이동을 실행하고 watchdog으로 중단된 전환도 목표 상태에 확정한다. */
  const animateDayTransition = useCallback(
    (
      toValue: number,
      afterAnimation?: () => void,
      context: DayTransitionContext = 'monthToDay',
    ) => {
      let didFinish = false;
      /** 애니메이션과 watchdog 중 먼저 끝난 경로만 후처리를 수행하도록 전환을 단일 완료한다. */
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
        unstable_batchedUpdates(() => {
          if (finished || forceValue) afterAnimation?.();
          setIsDayTransitionActive(false);
          setDayTransitionContext('idle');
          transitionStartedRef.current = false;
        });
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
        easing: reduceMotionEnabled
          ? Easing.out(Easing.cubic)
          : CALENDAR_DEPTH_EASING,
        useNativeDriver: true,
        isInteraction: false,
      }).start(({ finished }) => finishTransition(finished));
    },
    [
      dayTransition,
      dayTransitionCleanupTimerRef,
      reduceMotionEnabled,
      setDayTransitionContext,
      setIsDayTransitionActive,
      transitionStartedRef,
    ],
  );

  /** 연간·월간 깊이 이동을 실행하고 완료 상태 변경을 한 React 배치로 반영한다. */
  const animateYearDepthTransition = useCallback(
    (toValue: number, afterAnimation?: () => void, durationMs: number = CALENDAR_DEPTH_MOTION.depthSlideDurationMs) => {
      let didFinish = false;
      /** 연간 전환의 중복 완료를 차단하고 필요하면 애니메이션 값을 목표 깊이로 강제 보정한다. */
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

      if (reduceMotionEnabled) {
        finishTransition(true, true);
        return;
      }
      dayTransitionCleanupTimerRef.current = setTimeout(() => {
        finishTransition(true, true);
      }, Math.max(CALENDAR_INTERACTION_BUDGET_MS, durationMs + 32));

      yearOverviewProgress.stopAnimation();
      Animated.timing(yearOverviewProgress, {
        toValue,
        duration: durationMs,
        easing: CALENDAR_DEPTH_EASING,
        useNativeDriver: true,
        isInteraction: false,
      }).start(({ finished }) => finishTransition(finished));
    },
    [
      dayTransitionCleanupTimerRef,
      reduceMotionEnabled,
      setIsYearDepthTransitionActive,
      transitionStartedRef,
      yearOverviewProgress,
    ],
  );

  /** 일간 화면 내부 보기 모드 변경을 짧은 전환으로 표현하고 성공 시 후속 작업을 실행한다. */
  const animateDayModeTransition = useCallback(
    (afterAnimation?: () => void) => {
      dayModeTransition.stopAnimation();
      dayModeTransition.setValue(0);

      Animated.timing(dayModeTransition, {
        toValue: 1,
        duration: reduceMotionEnabled
          ? CALENDAR_DEPTH_MOTION.reduceMotionDurationMs
          : CALENDAR_DEPTH_MOTION.modeChangeDurationMs,
        easing: reduceMotionEnabled
          ? Easing.out(Easing.cubic)
          : DAY_NAVIGATION_EASING,
        useNativeDriver: true,
        isInteraction: false,
      }).start(({ finished }) => {
        if (finished) afterAnimation?.();
      });
    },
    [dayModeTransition, reduceMotionEnabled],
  );

  /** 일간 화면에서 선택한 날짜를 반영하고 일간 레이어를 열린 최종 위치에 유지한다. */
  const handleSelectDayFromDayDisplay = useCallback(
    (day: string) => {
      setDayTransitionTargetDay(null);
      selectCalendarDay(day);
      setDayLayerMounted(true);
      dayTransition.setValue(1);
    },
    [
      dayTransition,
      selectCalendarDay,
      setDayLayerMounted,
      setDayTransitionTargetDay,
    ],
  );

  /** 현재 일자를 지정 일수만큼 이동하고 일간 보기의 깊이와 전환 값을 유지한다. */
  const handleShiftDay = useCallback(
    (offset: number) => {
      const nextDay = addDaysToYmd(selectedDayRef.current, offset);
      setDayTransitionTargetDay(null);
      selectCalendarDay(nextDay);
      setDayLayerMounted(true);
      setCalendarDepth('day');
      dayTransition.setValue(1);
    },
    [
      addDaysToYmd,
      dayTransition,
      selectCalendarDay,
      selectedDayRef,
      setCalendarDepth,
      setDayLayerMounted,
      setDayTransitionTargetDay,
    ],
  );

  /** 일간 화면의 오늘 이동 요청을 선택 상태에 반영하고 일간 레이어를 안정 상태로 맞춘다. */
  const handleNavigateTodayFromDayDisplay = useCallback(
    (day: string) => {
      setDayTransitionTargetDay(null);
      selectCalendarDay(day);
      setDayLayerMounted(true);
      setCalendarDepth('day');
      dayTransition.setValue(1);
    },
    [
      dayTransition,
      selectCalendarDay,
      setCalendarDepth,
      setDayLayerMounted,
      setDayTransitionTargetDay,
    ],
  );

  /** 일간 화면에서 선택한 일정의 상세 라우트로 이동한다. */
  const handleOpenScheduleFromDayDisplay = useCallback(
    (id: string, restoreFocus?: () => void) => {
      openedSchedule.current = { id, restoreFocus };
      setReturnedScheduleId(null);
      runWithTransitionShell(
        {
          route: '/schedule/[id]',
          title: '일정 상세',
          backAccessibilityLabel: '이전 화면으로 돌아가기',
          sceneKey: id,
          onSceneClose: highlightReturnedSchedule,
        },
        () => router.push({
          pathname: '/schedule/[id]',
          params: { id },
        }),
      );
    },
    [highlightReturnedSchedule, router, runWithTransitionShell],
  );

  useEffect(() => {
    if (dayTransitionContext !== 'monthToDay' || !dayTransitionTargetDay) return;
    const targetDay = dayTransitionTargetDay;
    // Start revealing the timeline after the target date has committed to its view.
    let revealFrame: number | undefined;
    const prepareFrame = requestAnimationFrame(() => {
      revealFrame = requestAnimationFrame(() => {
        const commitDay = () => {
          setPendingSelectedDay(targetDay);
          dispatch({ type: 'SET_SELECTED_DAY', day: targetDay });
          setVisibleMonth(targetDay);
          setCalendarDepth('day');
          setDayTransitionTargetDay(null);
          setTransitionMonthKey(null);
        };
        if (reduceMotionEnabled) {
          unstable_batchedUpdates(() => {
            commitDay();
            setIsDayTransitionActive(false);
            setDayTransitionContext('idle');
            transitionStartedRef.current = false;
          });
          dayTransition.setValue(1);
          return;
        }
        animateDayTransition(1, commitDay, 'monthToDay');
      });
    });
    return () => {
      cancelAnimationFrame(prepareFrame);
      if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
    };
  }, [
    animateDayTransition, dayTransition, dayTransitionContext,
    dayTransitionTargetDay, dispatch, reduceMotionEnabled, setCalendarDepth,
    setDayTransitionContext, setDayTransitionTargetDay, setIsDayTransitionActive,
    setPendingSelectedDay, setTransitionMonthKey, setVisibleMonth, transitionStartedRef,
  ]);

  /** 월간 화면에서 누른 날짜를 준비한 뒤 잠금 상태를 공유하며 일간 깊이로 전환한다. */
  const handleOpenDay = useCallback(
    (day: string) => {
      if (
        isDayTransitionActiveRef.current ||
        isYearDepthTransitionActiveRef.current ||
        transitionStartedRef.current ||
        viewTransitioningRef.current
      )
        return;
      transitionStartedRef.current = true;

      closeToolbarMenu();
      calendarTransition.stopAnimation();
      calendarTransition.setValue(1);
      dayTransition.stopAnimation();
      dayTransition.setValue(0);
      setDayTransitionTargetDay(day);
      setTodayButtonPrimed(day === todayKey);
      setTransitionMonthKey(
        day.slice(0, 7) === selectedDayRef.current.slice(0, 7)
          ? null
          : day.slice(0, 7),
      );
      yearOverviewProgress.stopAnimation();
      yearOverviewProgress.setValue(0);
      setYearOverviewVisible(false);
      setYearOverviewClosing(false);
      setDayLayerMounted(true);
      setDayViewMode('singleDay');
      setDayModeTransitionFrom(null);
      dayModeTransition.setValue(1);
      setDayTransitionContext('monthToDay');
      setIsDayTransitionActive(true);
    },
    [
      calendarTransition,
      closeToolbarMenu,
      dayTransition,
      dayModeTransition,
      isDayTransitionActiveRef,
      isYearDepthTransitionActiveRef,
      selectedDayRef,
      setDayLayerMounted,
      setDayModeTransitionFrom,
      setDayTransitionContext,
      setDayTransitionTargetDay,
      setDayViewMode,
      setIsDayTransitionActive,
      setTodayButtonPrimed,
      setTransitionMonthKey,
      setYearOverviewClosing,
      setYearOverviewVisible,
      todayKey,
      transitionStartedRef,
      viewTransitioningRef,
      yearOverviewProgress,
    ],
  );

  /** 진행 중인 페이지 이동이 없을 때 일간 레이어를 닫고 월간 깊이로 복귀한다. */
  const closeDayDisplay = useCallback(() => {
    if (calendarDepth !== 'day' && !dayLayerMounted) return;
    if (
      dayPageNavigationActiveRef.current ||
      isDayTransitionActive ||
      isYearDepthTransitionActive ||
      transitionStartedRef.current
    )
      return;
    transitionStartedRef.current = true;

    closeToolbarMenu();
    setDayTransitionTargetDay(selectedDay);
    setDayModeTransitionFrom(null);
    setTransitionMonthKey(null);
    setDayTransitionContext('dayToMonth');
    setIsDayTransitionActive(true);
    animateDayTransition(
      0,
      () => {
        setCalendarDepth('month');
        setDayTransitionTargetDay(null);
        setTransitionMonthKey(null);
      },
      'dayToMonth',
    );
  }, [
    animateDayTransition,
    calendarDepth,
    closeToolbarMenu,
    dayPageNavigationActiveRef,
    dayLayerMounted,
    isDayTransitionActive,
    isYearDepthTransitionActive,
    selectedDay,
    setCalendarDepth,
    setDayModeTransitionFrom,
    setDayTransitionContext,
    setDayTransitionTargetDay,
    setIsDayTransitionActive,
    setTransitionMonthKey,
    transitionStartedRef,
  ]);


  return {
    addAndRevealItem,
    savedAgendaTarget,
    clearSavedAgendaTarget,
    animateDayModeTransition,
    animateDayTransition,
    animateYearDepthTransition,
    closeDayDisplay,
    handleNavigateTodayFromDayDisplay,
    handleOpenDay,
    handleOpenScheduleFromDayDisplay,
    agendaReturnHighlight: returnedScheduleId && !reduceMotionEnabled
      ? { id: returnedScheduleId, opacity: returnOpacity }
      : undefined,
    handleSelectDay,
    handleSavedStackPositionReady,
    handleSelectDayFromDayDisplay,
    handleShiftDay,
    handleVisibleMonthChange,
    selectCalendarDay,
  };
}
