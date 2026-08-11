import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { Animated, Easing, unstable_batchedUpdates } from 'react-native';
import {
  Easing as ReanimatedEasing,
  ReduceMotion,
  cancelAnimation as cancelReanimatedAnimation,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import {
  CALENDAR_INTERACTION_BUDGET_MS,
  CALENDAR_DEPTH_MOTION,
  MONTH_AGENDA_MOTION,
  getMonthAgendaPanelKind,
  getMonthAgendaTransition,
  type MonthAgendaPanelKind,
} from '../calendarMotion';
import { rememberCalendarViewModePreference } from '../components/calendar/calendarViewModePreference';
import type { CalendarViewMode } from '../components/calendar/viewMode';

type CalendarDepth = 'year' | 'month' | 'day';
type DayViewMode = 'singleDay' | 'multiDay';

type MonthCalendarLayout = {
  calendarHeight: number;
  dayHeight: number;
};

type UseScheduleIndexViewModeTransitionParams = {
  animateDayModeTransition: (onComplete?: () => void) => void;
  calendarDepth: CalendarDepth;
  calendarTransition: Animated.Value;
  calendarViewMode: CalendarViewMode;
  closeToolbarMenu: (onClosed?: () => void) => void;
  dayPageNavigationActiveRef: MutableRefObject<boolean>;
  dayTransition: Animated.Value;
  dayViewMode: DayViewMode;
  detailMonthMotionCancelRef: MutableRefObject<(() => void) | null>;
  isDayTransitionActive: boolean;
  monthAgendaMotionDuration: number;
  monthAgendaPanelKind: MonthAgendaPanelKind | null;
  monthAgendaProgress: Animated.Value;
  monthAgendaSwapProgress: Animated.Value;
  monthCalendarAnimatedDayHeight: SharedValue<number>;
  monthCalendarAnimatedHeight: SharedValue<number>;
  monthCalendarDayHeightRef: MutableRefObject<number>;
  monthCalendarHeightRef: MutableRefObject<number>;
  monthCalendarTargetHeight: SharedValue<number>;
  monthCalendarTransitionProgress: Animated.Value;
  monthDisplayHeightRef: MutableRefObject<number>;
  monthViewCompletionAnimationRef: MutableRefObject<Animated.CompositeAnimation | null>;
  monthViewTransitionFrameRef: MutableRefObject<number | null>;
  monthViewTransitionGenerationRef: MutableRefObject<number>;
  monthViewTransitionWatchdogRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  reduceMotionEnabled: boolean;
  resolveMonthCalendarLayout: (viewMode: CalendarViewMode) => MonthCalendarLayout;
  setCalendarViewMode: Dispatch<SetStateAction<CalendarViewMode>>;
  setDayLayerMounted: Dispatch<SetStateAction<boolean>>;
  setDayModeTransitionFrom: Dispatch<SetStateAction<DayViewMode | null>>;
  setDayViewMode: Dispatch<SetStateAction<DayViewMode>>;
  setIsMonthViewTransitionActive: Dispatch<SetStateAction<boolean>>;
  setOutgoingMonthAgendaPanelKind: Dispatch<
    SetStateAction<MonthAgendaPanelKind | null>
  >;
  setRetainedMonthAgendaPanelKind: Dispatch<SetStateAction<MonthAgendaPanelKind>>;
  viewTransitioningRef: MutableRefObject<boolean>;
};

/**
 * 월 보기 모드와 일 보기 표시 방식을 전환하는 애니메이션을 관리한다.
 * 전환 중복 실행을 막고, 애니메이션 취소나 타임아웃이 발생해도 최종 레이아웃과
 * 터치 잠금 상태가 반드시 일치하도록 모든 완료 처리를 한곳에서 수행한다.
 */
export function useScheduleIndexViewModeTransition({
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
}: UseScheduleIndexViewModeTransitionParams) {
  /**
   * 월간 달력의 보기 모드를 변경한다.
   * 현재 렌더링 높이에서 목표 높이까지 달력과 일정 패널을 함께 보간하며,
   * 중단된 애니메이션도 감시 타이머를 통해 정확한 목표 상태로 보정한다.
   */
  const handleCalendarViewModeChange = useCallback(
    (nextMode: CalendarViewMode) => {
      if (viewTransitioningRef.current) return;

      rememberCalendarViewModePreference(nextMode);
      if (nextMode === calendarViewMode) return;

      detailMonthMotionCancelRef.current?.();
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
      const agendaTransition = getMonthAgendaTransition(
        calendarViewMode,
        nextMode,
      );
      const nextAgendaPanelKind = getMonthAgendaPanelKind(nextMode);
      const targetAgendaProgress = nextAgendaPanelKind ? 1 : 0;
      const sourceLayout = resolveMonthCalendarLayout(calendarViewMode);
      const targetLayout = resolveMonthCalendarLayout(nextMode);
      const liveCalendarHeight = monthCalendarAnimatedHeight.value;
      const liveDayHeight = monthCalendarAnimatedDayHeight.value;
      const sourceHeight =
        Number.isFinite(liveCalendarHeight) && liveCalendarHeight > 0
          ? liveCalendarHeight
          : monthCalendarHeightRef.current ||
            sourceLayout.calendarHeight ||
            monthDisplayHeightRef.current;
      const sourceDayHeight =
        Number.isFinite(liveDayHeight) && liveDayHeight > 0
          ? liveDayHeight
          : monthCalendarDayHeightRef.current || sourceLayout.dayHeight;
      const targetCalendarHeight = targetLayout.calendarHeight || sourceHeight;
      const targetDayHeight = targetLayout.dayHeight;
      const motionEasing = reduceMotionEnabled
        ? Easing.out(Easing.cubic)
        : Easing.bezier(...CALENDAR_DEPTH_MOTION.bezier);
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
      if (agendaTransition === 'enter' || agendaTransition === 'exit') {
        monthAgendaProgress.setValue(agendaTransition === 'exit' ? 1 : 0);
        monthAgendaSwapProgress.setValue(1);
      } else if (agendaTransition === 'swap') {
        monthAgendaProgress.setValue(1);
        monthAgendaSwapProgress.setValue(0);
      } else {
        monthAgendaSwapProgress.setValue(1);
      }

      unstable_batchedUpdates(() => {
        setIsMonthViewTransitionActive(true);
        setOutgoingMonthAgendaPanelKind(
          agendaTransition === 'swap' ? monthAgendaPanelKind : null,
        );
        if (nextAgendaPanelKind) {
          setRetainedMonthAgendaPanelKind(nextAgendaPanelKind);
        }
        setCalendarViewMode(nextMode);
      });

      let transitionFinalized = false;

      /** 애니메이션 종료 사유와 관계없이 월 보기 상태를 목표 레이아웃으로 확정한다. */
      const finishMonthViewTransition = () => {
        if (
          transitionFinalized ||
          transitionGeneration !== monthViewTransitionGenerationRef.current
        )
          return;

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
        if (transitionGeneration !== monthViewTransitionGenerationRef.current)
          return;

        const activeAnimation = monthViewCompletionAnimationRef.current;
        monthViewCompletionAnimationRef.current = null;
        activeAnimation?.stop();
        finishMonthViewTransition();
      }, CALENDAR_INTERACTION_BUDGET_MS);

      monthViewTransitionFrameRef.current = requestAnimationFrame(() => {
        monthViewTransitionFrameRef.current = null;
        if (transitionGeneration !== monthViewTransitionGenerationRef.current)
          return;

        monthCalendarTargetHeight.value = targetCalendarHeight;
        monthCalendarAnimatedHeight.value = withTiming(targetCalendarHeight, {
          duration: monthAgendaMotionDuration,
          easing: layoutEasing,
          reduceMotion: ReduceMotion.Never,
        });
        monthCalendarAnimatedDayHeight.value = withTiming(targetDayHeight, {
          duration: monthAgendaMotionDuration,
          easing: layoutEasing,
          reduceMotion: ReduceMotion.Never,
        });
        const animations: Animated.CompositeAnimation[] = [
          Animated.timing(monthCalendarTransitionProgress, {
            toValue: 1,
            duration: monthAgendaMotionDuration,
            easing: motionEasing,
            useNativeDriver: true,
            isInteraction: false,
          }),
        ];

        if (agendaTransition === 'enter' || agendaTransition === 'exit') {
          animations.push(
            Animated.timing(monthAgendaProgress, {
              toValue: targetAgendaProgress,
              duration: monthAgendaMotionDuration,
              easing: motionEasing,
              useNativeDriver: true,
              isInteraction: false,
            }),
          );
        } else if (agendaTransition === 'swap') {
          animations.push(
            Animated.timing(monthAgendaSwapProgress, {
              toValue: 1,
              duration: monthAgendaMotionDuration,
              easing: motionEasing,
              useNativeDriver: true,
              isInteraction: false,
            }),
          );
        }

        const completionAnimation = Animated.parallel(animations);
        monthViewCompletionAnimationRef.current = completionAnimation;
        completionAnimation.start(() => {
          if (
            transitionGeneration !== monthViewTransitionGenerationRef.current
          ) {
            return;
          }

          // 네이티브 애니메이션이 취소되더라도 이미 선택된 보기 모드에 맞춰
          // 레이아웃과 터치 잠금 상태를 반드시 최종값으로 정리한다.
          finishMonthViewTransition();
        });
      });
    },
    [
      calendarTransition,
      calendarViewMode,
      closeToolbarMenu,
      detailMonthMotionCancelRef,
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
      setIsMonthViewTransitionActive,
      setOutgoingMonthAgendaPanelKind,
      setRetainedMonthAgendaPanelKind,
      viewTransitioningRef,
    ],
  );

  /**
   * 일간 화면에서 단일 날짜와 여러 날짜 표시를 전환한다.
   * 페이지 스와이프나 깊이 전환 중에는 요청을 무시해 서로 다른 애니메이션이
   * 같은 상태를 동시에 수정하지 않도록 한다.
   */
  const handleDayViewMenuSelect = useCallback(
    (target: 'day' | 'multi') => {
      if (calendarDepth !== 'day') return;

      const nextMode: DayViewMode = target === 'day' ? 'singleDay' : 'multiDay';

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
    },
    [
      animateDayModeTransition,
      calendarDepth,
      closeToolbarMenu,
      dayPageNavigationActiveRef,
      dayTransition,
      dayViewMode,
      isDayTransitionActive,
      setDayLayerMounted,
      setDayModeTransitionFrom,
      setDayViewMode,
    ],
  );

  return { handleCalendarViewModeChange, handleDayViewMenuSelect };
}
