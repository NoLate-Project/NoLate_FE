import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { Animated } from 'react-native';
import type { DayTransitionContext } from '../components/calendar/CalendarWrapper';

type CalendarDepth = 'year' | 'month' | 'day';
type DayViewMode = 'singleDay' | 'multiDay';

type UseScheduleIndexYearTransitionParams = {
  animateYearDepthTransition: (
    targetProgress: number,
    onComplete?: () => void,
  ) => void;
  calendarDepth: CalendarDepth;
  calendarTransition: Animated.Value;
  closeDayDisplay: () => void;
  closeToolbarMenu: (onClosed?: () => void) => void;
  dayTransition: Animated.Value;
  dispatch: (action: { type: 'SET_SELECTED_DAY'; day: string }) => void;
  isDayTransitionActive: boolean;
  isDayTransitionActiveRef: MutableRefObject<boolean>;
  isYearDepthTransitionActive: boolean;
  isYearDepthTransitionActiveRef: MutableRefObject<boolean>;
  setCalendarDepth: Dispatch<SetStateAction<CalendarDepth>>;
  setDayModeTransitionFrom: Dispatch<SetStateAction<DayViewMode | null>>;
  setDayTransitionContext: Dispatch<SetStateAction<DayTransitionContext>>;
  setIsYearDepthTransitionActive: Dispatch<SetStateAction<boolean>>;
  setOverviewYear: Dispatch<SetStateAction<number>>;
  setPendingSelectedDay: Dispatch<SetStateAction<string | null>>;
  setTodayButtonPrimed: Dispatch<SetStateAction<boolean>>;
  setTransitionMonthKey: Dispatch<SetStateAction<string | null>>;
  setVisibleMonth: Dispatch<SetStateAction<string>>;
  setYearOverviewClosing: Dispatch<SetStateAction<boolean>>;
  setYearOverviewPresentationRequest: Dispatch<SetStateAction<number>>;
  setYearOverviewVisible: Dispatch<SetStateAction<boolean>>;
  selectedDayRef: MutableRefObject<string>;
  todayKey: string;
  transitionStartedRef: MutableRefObject<boolean>;
  updateFetchVisibleMonth: (month: string) => void;
  viewTransitioningRef: MutableRefObject<boolean>;
  visibleMonth: string;
  visibleYear: number;
  yearDepthTransitionFrameRef: MutableRefObject<number | null>;
  yearOverviewClosing: boolean;
  yearOverviewProgress: Animated.Value;
  yearOverviewVisible: boolean;
};

/**
 * 연간·월간 캘린더 사이의 깊이 전환과 상단 날짜 버튼 동작을 관리한다.
 * 선택 날짜, 화면 표시 월, 데이터 조회 월을 같은 전환 완료 시점에 갱신해
 * 애니메이션 도중 서로 다른 월의 정보가 섞이지 않도록 한다.
 */
export function useScheduleIndexYearTransition({
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
}: UseScheduleIndexYearTransitionParams) {
  /**
   * 연간 화면에서 지정한 연·월의 월간 화면으로 이동한다.
   * 기존 선택 일자가 해당 월의 말일을 넘으면 유효한 말일로 보정하고,
   * 목표 월이 한 번 렌더링된 다음 슬라이드 애니메이션을 시작한다.
   */
  const runYearToMonthTransition = useCallback(
    (year: number, month: number) => {
      if (
        isYearDepthTransitionActiveRef.current ||
        isDayTransitionActiveRef.current ||
        transitionStartedRef.current
      )
        return;
      transitionStartedRef.current = true;
      const monthKey = `${year}-${String(month).padStart(2, '0')}`;
      const currentDay = Number(selectedDayRef.current.slice(8, 10)) || 1;
      const targetDay = Math.min(
        currentDay,
        new Date(year, month, 0).getDate(),
      );
      const targetSelection = `${monthKey}-${String(targetDay).padStart(
        2,
        '0',
      )}`;
      const monthTransition = `month-${monthKey}`;
      closeToolbarMenu();
      dayTransition.stopAnimation();
      yearOverviewProgress.stopAnimation();
      calendarTransition.stopAnimation();
      dayTransition.setValue(0);
      yearOverviewProgress.setValue(1);
      calendarTransition.setValue(1);
      setDayTransitionContext('yearToMonth');
      setVisibleMonth(targetSelection);
      setTransitionMonthKey(monthTransition);
      setDayModeTransitionFrom(null);
      setTodayButtonPrimed(targetSelection === todayKey);
      setYearOverviewClosing(true);
      setIsYearDepthTransitionActive(true);

      // 화면 밖의 목표 월을 먼저 한 프레임 반영해 Fabric 레이아웃 계산과
      // 네이티브 슬라이드 애니메이션이 같은 프레임에서 경쟁하지 않게 한다.
      if (yearDepthTransitionFrameRef.current !== null) {
        cancelAnimationFrame(yearDepthTransitionFrameRef.current);
      }
      yearDepthTransitionFrameRef.current = requestAnimationFrame(() => {
        yearDepthTransitionFrameRef.current = null;
        animateYearDepthTransition(0, () => {
          setCalendarDepth('month');
          yearOverviewProgress.setValue(0);
          calendarTransition.setValue(1);
          setTransitionMonthKey(null);
          setYearOverviewVisible(false);
          setYearOverviewClosing(false);
          setDayTransitionContext('idle');
          setPendingSelectedDay(targetSelection);
          updateFetchVisibleMonth(targetSelection);
          dispatch({ type: 'SET_SELECTED_DAY', day: targetSelection });
        });
      });
    },
    [
      animateYearDepthTransition,
      calendarTransition,
      closeToolbarMenu,
      dayTransition,
      dispatch,
      isDayTransitionActiveRef,
      isYearDepthTransitionActiveRef,
      selectedDayRef,
      setCalendarDepth,
      setDayModeTransitionFrom,
      setDayTransitionContext,
      setIsYearDepthTransitionActive,
      setPendingSelectedDay,
      setTodayButtonPrimed,
      setTransitionMonthKey,
      setVisibleMonth,
      setYearOverviewClosing,
      setYearOverviewVisible,
      todayKey,
      transitionStartedRef,
      updateFetchVisibleMonth,
      yearDepthTransitionFrameRef,
      yearOverviewProgress,
    ],
  );

  /** 현재 보고 있는 월을 유지한 채 연간 화면을 닫고 월간 화면으로 돌아간다. */
  const closeYearOverview = useCallback(() => {
    if (!yearOverviewVisible) return;

    const focusedMonth = new Date(`${visibleMonth.slice(0, 7)}-01T00:00:00`);
    runYearToMonthTransition(
      focusedMonth.getFullYear(),
      focusedMonth.getMonth() + 1,
    );
  }, [runYearToMonthTransition, visibleMonth, yearOverviewVisible]);

  /**
   * 현재 표시 연도를 기준으로 연간 화면을 연다.
   * 일간 화면에서는 먼저 월간 화면 복귀를 요청하고, 다른 깊이 전환이 진행
   * 중이면 중복 요청을 무시한다.
   */
  const openYearOverview = useCallback(() => {
    if (calendarDepth === 'day') {
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
    )
      return;
    transitionStartedRef.current = true;

    closeToolbarMenu();
    setTransitionMonthKey(null);
    setOverviewYear(visibleYear);
    setYearOverviewPresentationRequest(request => request + 1);
    setYearOverviewClosing(false);
    setYearOverviewVisible(true);
    setIsYearDepthTransitionActive(true);
    setDayTransitionContext('idle');
    calendarTransition.stopAnimation();
    yearOverviewProgress.setValue(0);
    calendarTransition.setValue(1);

    animateYearDepthTransition(1, () => {
      setCalendarDepth('year');
    });
  }, [
    animateYearDepthTransition,
    calendarDepth,
    calendarTransition,
    closeDayDisplay,
    closeToolbarMenu,
    closeYearOverview,
    isDayTransitionActive,
    isYearDepthTransitionActive,
    setCalendarDepth,
    setDayTransitionContext,
    setIsYearDepthTransitionActive,
    setOverviewYear,
    setTransitionMonthKey,
    setYearOverviewClosing,
    setYearOverviewPresentationRequest,
    setYearOverviewVisible,
    transitionStartedRef,
    viewTransitioningRef,
    visibleYear,
    yearOverviewClosing,
    yearOverviewProgress,
    yearOverviewVisible,
  ]);

  /** 연간 화면에서 사용자가 누른 월을 월간 전환의 목표로 전달한다. */
  const selectOverviewMonth = useCallback(
    (year: number, month: number) => {
      runYearToMonthTransition(year, month);
    },
    [runYearToMonthTransition],
  );

  /**
   * 상단 날짜 버튼을 현재 깊이의 ‘뒤로 가기/연간 보기’ 동작으로 해석한다.
   * 일간에서는 월간으로, 연간에서는 월간으로 돌아가며, 월간에서는 연간을 연다.
   */
  const handlePrimaryDateButtonPress = useCallback(() => {
    if (calendarDepth === 'day') {
      closeDayDisplay();
      return;
    }

    if (calendarDepth === 'year') {
      closeYearOverview();
      return;
    }

    openYearOverview();
  }, [calendarDepth, closeDayDisplay, closeYearOverview, openYearOverview]);

  return {
    handlePrimaryDateButtonPress,
    selectOverviewMonth,
  };
}
