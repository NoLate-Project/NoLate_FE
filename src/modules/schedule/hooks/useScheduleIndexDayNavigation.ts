import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import {
  Animated,
  Easing,
  unstable_batchedUpdates,
} from 'react-native';
import { useRouter } from 'expo-router';

import type { DayTransitionContext } from '../components/calendar/CalendarWrapper';
import {
  CALENDAR_DEPTH_MOTION,
  CALENDAR_INTERACTION_BUDGET_MS,
} from '../calendarMotion';
import { DAY_NAVIGATION_MOTION } from '../dayNavigationMotion';
import { getScheduleFocusDay } from '../calendarNavigation';
import type { ScheduleItem } from '../types';
import { useScheduleStore } from '../store';

const DAY_NAVIGATION_EASING = Easing.bezier(...DAY_NAVIGATION_MOTION.bezier);
const CALENDAR_DEPTH_EASING = Easing.bezier(...CALENDAR_DEPTH_MOTION.bezier);

type CalendarDepth = 'year' | 'month' | 'day';
type DayViewMode = 'singleDay' | 'multiDay';
type SetValue<T> = Dispatch<SetStateAction<T>>;

type Options = {
  addDaysToYmd: (day: string, offset: number) => string;
  addItem: (
    payload: Omit<ScheduleItem, 'id'>,
    options?: { showErrorAlert?: boolean },
  ) => Promise<void>;
  calendarDepth: CalendarDepth;
  calendarTransition: Animated.Value;
  closeToolbarMenu: (afterClose?: () => void) => void;
  dayDisplayPrepareRef: MutableRefObject<((day: string) => void) | null>;
  dayLayerMounted: boolean;
  dayLayerMountedRef: MutableRefObject<boolean>;
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
}: Options) {
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

  /** 빠른 일정 저장 후 실제 시작 일자로 달력 포커스를 이동하며 오류 표시는 모달에 위임한다. */
  const addQuickItem = async (payload: Omit<ScheduleItem, 'id'>) => {
    // 빠른 일정 모달이 저장 오류를 표시하므로 상위 Alert는 중복 노출하지 않는다.
    await addItem(payload, { showErrorAlert: false });

    const savedDay = getScheduleFocusDay(payload.startAt);
    if (savedDay) selectCalendarDay(savedDay);
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
        setIsDayTransitionActive(false);
        setDayTransitionContext('idle');
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
    (toValue: number, afterAnimation?: () => void) => {
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
        easing: reduceMotionEnabled
          ? Easing.out(Easing.cubic)
          : CALENDAR_DEPTH_EASING,
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
    (id: string) => {
      router.push({
        pathname: '/schedule/[id]',
        params: { id },
      });
    },
    [router],
  );

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
      /** 일간 레이어가 마운트된 뒤 선택 상태와 깊이를 목표 날짜로 커밋한다. */
      const startTransition = () => {
        animateDayTransition(
          1,
          () => {
            setPendingSelectedDay(day);
            dispatch({ type: 'SET_SELECTED_DAY', day });
            setVisibleMonth(day);
            setCalendarDepth('day');
            setDayTransitionTargetDay(null);
            setTransitionMonthKey(null);
          },
          'monthToDay',
        );
      };
      if (wasDayLayerMounted) {
        startTransition();
      } else {
        requestAnimationFrame(startTransition);
      }
    },
    [
      animateDayTransition,
      calendarTransition,
      closeToolbarMenu,
      dayDisplayPrepareRef,
      dayLayerMountedRef,
      dayTransition,
      dayModeTransition,
      dispatch,
      isDayTransitionActiveRef,
      isYearDepthTransitionActiveRef,
      selectedDayRef,
      setCalendarDepth,
      setDayLayerMounted,
      setDayModeTransitionFrom,
      setDayTransitionContext,
      setDayTransitionTargetDay,
      setDayViewMode,
      setIsDayTransitionActive,
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
    addQuickItem,
    animateDayModeTransition,
    animateDayTransition,
    animateYearDepthTransition,
    closeDayDisplay,
    handleNavigateTodayFromDayDisplay,
    handleOpenDay,
    handleOpenScheduleFromDayDisplay,
    handleSelectDay,
    handleSelectDayFromDayDisplay,
    handleShiftDay,
    handleVisibleMonthChange,
    selectCalendarDay,
  };
}
