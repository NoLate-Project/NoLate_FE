import {
  useCallback,
  useLayoutEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { Animated, type LayoutChangeEvent } from 'react-native';
import {
  Easing as ReanimatedEasing,
  ReduceMotion,
  cancelAnimation as cancelReanimatedAnimation,
  useAnimatedStyle,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import {
  getFixedScheduleCalendarHeight,
  type DetailMonthWeekCount,
} from '../components/calendar/ScheduleCalendar';
import {
  CALENDAR_DAY_HEIGHTS,
  getPrimaryPillWeekdayGap,
  showsStickyMonthTitle,
  type CalendarViewMode,
} from '../components/calendar/viewMode';
import { shiftCalendarMonth } from '../calendarNavigation';
import {
  DETAIL_MONTH_HEIGHT_MOTION,
  MONTH_AGENDA_MOTION,
  getCalendarMonthWeekCount,
  resolveDetailMonthPanelLayout,
  resolveMonthAgendaViewportLayout,
  type MonthAgendaPanelKind,
} from '../calendarMotion';

const CALENDAR_TOOLBAR_HEIGHT = 56;
const CALENDAR_CONTEXT_HEIGHT = 24;
const STICKY_MONTH_HEADER_HEIGHT = 50;
const STICKY_WEEKDAY_HEADER_HEIGHT = 18;
const STICKY_CALENDAR_HEADER_HEIGHT =
  STICKY_MONTH_HEADER_HEIGHT + STICKY_WEEKDAY_HEADER_HEIGHT;

const DETAIL_MONTH_LAYOUT_REPRESENTATIVE_MONTHS = {
  0: {
    4: '2026-02-01',
    5: '2026-07-01',
    6: '2026-08-01',
  },
  1: {
    4: '2021-02-01',
    5: '2026-07-01',
    6: '2026-08-01',
  },
} as const satisfies Record<0 | 1, Record<DetailMonthWeekCount, string>>;

/** 보기 모드에 맞춰 고정 월 제목과 요일 행이 차지할 높이를 계산한다. */
function getStickyCalendarHeaderHeight(viewMode: CalendarViewMode): number {
  return showsStickyMonthTitle(viewMode)
    ? STICKY_CALENDAR_HEADER_HEIGHT
    : STICKY_WEEKDAY_HEADER_HEIGHT + getPrimaryPillWeekdayGap(viewMode);
}

type UseScheduleIndexMonthLayoutParams = {
  calendarViewMode: CalendarViewMode;
  detailMonthHeightMotionDuration: number;
  detailMonthMotionActive: SharedValue<boolean>;
  detailMonthMotionActiveRef: MutableRefObject<boolean>;
  firstDay: 0 | 1;
  insetsTop: number;
  isDayTransitionActive: boolean;
  isMonthViewTransitionActive: boolean;
  isYearDepthTransitionActive: boolean;
  monthAgendaPanelKind: MonthAgendaPanelKind | null;
  monthAgendaProgress: Animated.Value;
  monthAgendaSwapProgress: Animated.Value;
  monthCalendarAnimatedDayHeight: SharedValue<number>;
  monthCalendarAnimatedHeight: SharedValue<number>;
  monthCalendarDayHeightRef: MutableRefObject<number>;
  monthCalendarHeightRef: MutableRefObject<number>;
  monthCalendarTargetHeight: SharedValue<number>;
  monthDisplayHeight: number;
  monthDisplayHeightRef: MutableRefObject<number>;
  monthDisplayLayoutAnchorDay: string;
  reduceMotionEnabled: boolean;
  setMonthDisplayHeight: Dispatch<SetStateAction<number>>;
};

/**
 * 월 달력과 하단 일정 패널의 높이·투명도·페이지별 상세 레이아웃을 계산한다.
 * 측정된 실제 높이를 기준으로 반응형 상세 월 높이를 보간하고, 화면 전환 훅이
 * 같은 레이아웃 계산기를 사용하도록 제공해 시작값과 종료값의 차이를 없앤다.
 */
export function useScheduleIndexMonthLayout({
  calendarViewMode,
  detailMonthHeightMotionDuration,
  detailMonthMotionActive,
  detailMonthMotionActiveRef,
  firstDay,
  insetsTop,
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
}: UseScheduleIndexMonthLayoutParams) {
  /**
   * 보기 모드와 기준 월에 필요한 달력 전체 높이 및 날짜 셀 높이를 계산한다.
   * 상세 모드에서는 사용 가능한 뷰포트에 맞춰 날짜 셀을 재배치하고, 일정 목록
   * 모드에서는 패널이 시작할 위치까지 반영한 목표 높이를 반환한다.
   */
  const resolveMonthCalendarLayout = useCallback(
    (
      viewMode: CalendarViewMode,
      month: string = monthDisplayLayoutAnchorDay,
    ) => {
      const fullCalendarHeight =
        monthDisplayHeight || monthDisplayHeightRef.current;
      const targetHeaderHeight = getStickyCalendarHeaderHeight(viewMode);
      const targetHeaderOffset =
        insetsTop +
        CALENDAR_TOOLBAR_HEIGHT +
        CALENDAR_CONTEXT_HEIGHT +
        targetHeaderHeight;
      const fixedCalendarHeight =
        getFixedScheduleCalendarHeight({
          viewMode,
          month,
          firstDay,
          headerOffset: targetHeaderOffset,
        }) ?? fullCalendarHeight;
      let panelCalendarHeight = fixedCalendarHeight;
      let dayHeight = CALENDAR_DAY_HEIGHTS[viewMode];

      if (viewMode === 'detail' && fullCalendarHeight > 0) {
        const weekCount = getCalendarMonthWeekCount(month, firstDay);
        const fixedChromeHeight = Math.max(
          0,
          fixedCalendarHeight - weekCount * CALENDAR_DAY_HEIGHTS.detail,
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
        expandedListTop:
          insetsTop + CALENDAR_TOOLBAR_HEIGHT + CALENDAR_CONTEXT_HEIGHT,
      });

      return {
        calendarHeight: viewportLayout.calendarTargetHeight,
        dayHeight,
      };
    },
    [
      firstDay,
      insetsTop,
      monthDisplayHeight,
      monthDisplayHeightRef,
      monthDisplayLayoutAnchorDay,
    ],
  );

  const detailMonthPageLayouts = useMemo(() => {
    const representativeMonths =
      DETAIL_MONTH_LAYOUT_REPRESENTATIVE_MONTHS[firstDay];
    const beforePreviousMonth = shiftCalendarMonth(
      monthDisplayLayoutAnchorDay,
      -2,
    );
    const previousMonth = shiftCalendarMonth(monthDisplayLayoutAnchorDay, -1);
    const nextMonth = shiftCalendarMonth(monthDisplayLayoutAnchorDay, 1);
    const afterNextMonth = shiftCalendarMonth(monthDisplayLayoutAnchorDay, 2);

    return {
      byWeekCount: {
        4: resolveMonthCalendarLayout('detail', representativeMonths[4]),
        5: resolveMonthCalendarLayout('detail', representativeMonths[5]),
        6: resolveMonthCalendarLayout('detail', representativeMonths[6]),
      },
      beforePrevious: {
        month: beforePreviousMonth.slice(0, 7),
        ...resolveMonthCalendarLayout('detail', beforePreviousMonth),
      },
      previous: {
        month: previousMonth.slice(0, 7),
        ...resolveMonthCalendarLayout('detail', previousMonth),
      },
      current: {
        month: monthDisplayLayoutAnchorDay.slice(0, 7),
        ...resolveMonthCalendarLayout('detail', monthDisplayLayoutAnchorDay),
      },
      next: {
        month: nextMonth.slice(0, 7),
        ...resolveMonthCalendarLayout('detail', nextMonth),
      },
      afterNext: {
        month: afterNextMonth.slice(0, 7),
        ...resolveMonthCalendarLayout('detail', afterNextMonth),
      },
    };
  }, [firstDay, monthDisplayLayoutAnchorDay, resolveMonthCalendarLayout]);

  const monthAgendaPanelOpacity = monthAgendaProgress.interpolate({
    inputRange: [
      0,
      MONTH_AGENDA_MOTION.fadeInStart,
      MONTH_AGENDA_MOTION.fadeInEnd,
      1,
    ],
    outputRange: [0, 0, 1, 1],
    extrapolate: 'clamp',
  });
  const monthAgendaSwapOutgoingOpacity = monthAgendaSwapProgress.interpolate({
    inputRange: [0, 0.48, 1],
    outputRange: [1, 0, 0],
    extrapolate: 'clamp',
  });
  const monthAgendaSwapIncomingOpacity = monthAgendaSwapProgress.interpolate({
    inputRange: [0, 0.52, 1],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
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
    const targetHeight = detailMonthMotionActive.value
      ? monthCalendarAnimatedHeight.value
      : monthCalendarTargetHeight.value;
    if (targetHeight <= 0) return {};

    return { height: targetHeight };
  });

  /** 달력 컨테이너의 실측 높이를 저장하고 패널이 닫힌 상태의 기준 높이로 사용한다. */
  const handleMonthDisplayLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const nextHeight = event.nativeEvent.layout.height;
      if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;

      monthDisplayHeightRef.current = nextHeight;
      setMonthDisplayHeight(currentHeight =>
        Math.abs(currentHeight - nextHeight) > 0.5 ? nextHeight : currentHeight,
      );
      if (!monthAgendaPanelKind && !isMonthViewTransitionActive) {
        monthCalendarHeightRef.current = nextHeight;
        monthCalendarAnimatedHeight.value = nextHeight;
        monthCalendarTargetHeight.value = nextHeight;
      }
    },
    [
      isMonthViewTransitionActive,
      monthAgendaPanelKind,
      monthCalendarAnimatedHeight,
      monthCalendarHeightRef,
      monthCalendarTargetHeight,
      monthDisplayHeightRef,
      setMonthDisplayHeight,
    ],
  );

  useLayoutEffect(() => {
    if (isMonthViewTransitionActive) return;

    const targetLayout = resolveMonthCalendarLayout(calendarViewMode);
    const targetHeight = targetLayout.calendarHeight;
    if (!Number.isFinite(targetHeight) || targetHeight <= 0) return;

    monthCalendarHeightRef.current = targetHeight;
    monthCalendarDayHeightRef.current = targetLayout.dayHeight;
    monthCalendarTargetHeight.value = targetHeight;
    if (calendarViewMode === 'detail' && detailMonthMotionActiveRef.current)
      return;

    const liveCalendarHeight = monthCalendarAnimatedHeight.value;
    const liveDayHeight = monthCalendarAnimatedDayHeight.value;
    cancelReanimatedAnimation(monthCalendarAnimatedHeight);
    cancelReanimatedAnimation(monthCalendarAnimatedDayHeight);
    const shouldAnimateResponsiveDetailLayout =
      calendarViewMode === 'detail' &&
      !isDayTransitionActive &&
      !isYearDepthTransitionActive &&
      liveCalendarHeight > 0 &&
      liveDayHeight > 0 &&
      (Math.abs(liveCalendarHeight - targetHeight) > 0.5 ||
        Math.abs(liveDayHeight - targetLayout.dayHeight) > 0.5);
    if (shouldAnimateResponsiveDetailLayout) {
      const layoutEasing = reduceMotionEnabled
        ? ReanimatedEasing.out(ReanimatedEasing.cubic)
        : ReanimatedEasing.bezier(...DETAIL_MONTH_HEIGHT_MOTION.bezier);
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
        },
      );
      return;
    }

    monthCalendarAnimatedHeight.value = targetHeight;
    monthCalendarAnimatedDayHeight.value = targetLayout.dayHeight;
  }, [
    calendarViewMode,
    detailMonthHeightMotionDuration,
    detailMonthMotionActiveRef,
    isDayTransitionActive,
    isMonthViewTransitionActive,
    isYearDepthTransitionActive,
    monthCalendarAnimatedDayHeight,
    monthCalendarAnimatedHeight,
    monthCalendarDayHeightRef,
    monthCalendarHeightRef,
    monthCalendarTargetHeight,
    reduceMotionEnabled,
    resolveMonthCalendarLayout,
  ]);

  return {
    detailMonthPageLayouts,
    handleMonthDisplayLayout,
    monthAgendaPanelOpacity,
    monthAgendaSlotAnimatedStyle,
    monthAgendaSwapIncomingOpacity,
    monthAgendaSwapOutgoingOpacity,
    monthCalendarAnimatedStyle,
    monthCalendarTargetLayerStyle,
    resolveMonthCalendarLayout,
  };
}
