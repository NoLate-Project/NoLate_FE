import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
} from 'react';
import { Animated } from 'react-native';
import {
  Easing as ReanimatedEasing,
  ReduceMotion,
  cancelAnimation as cancelReanimatedAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { DayTransitionContext } from '../components/calendar/CalendarWrapper';
import type { LiquidGlassIconButtonHandle } from '../components/calendar/LiquidGlassIconButton';
import {
  type CalendarViewMode,
  usesMonthInPrimaryPill,
} from '../components/calendar/viewMode';
import { getCalendarMonthAnchor } from '../calendarNavigation';
import {
  CALENDAR_DEPTH_MOTION,
  DETAIL_MONTH_HEIGHT_MOTION,
  MONTH_AGENDA_MOTION,
  getMonthAgendaPanelKind,
  resolveCalendarPrimaryPillLayout,
} from '../calendarMotion';

type CalendarDepth = 'year' | 'month' | 'day';
type DayViewMode = 'singleDay' | 'multiDay';

const LIQUID_TOOLBAR_SLOT_WIDTH = 50;
const LIQUID_TOOLBAR_ACTIONS_WIDTH = LIQUID_TOOLBAR_SLOT_WIDTH * 3;

type UseScheduleIndexDisplayModelParams = {
  calendarDepth: CalendarDepth;
  calendarTransition: Animated.Value;
  calendarViewMode: CalendarViewMode;
  dayLayerMounted: boolean;
  dayTransitionContext: DayTransitionContext;
  dayTransitionTargetDay: string | null;
  dayViewMode: DayViewMode;
  isDayTransitionActive: boolean;
  isYearDepthTransitionActive: boolean;
  primaryDatePillNativeRef: MutableRefObject<LiquidGlassIconButtonHandle | null>;
  reduceMotionEnabled: boolean;
  screenWidth: number;
  selectedDay: string;
  todayFocusOpacity: Animated.Value;
  todayFocusTranslateY: Animated.Value;
  visibleMonth: string;
  visibleYear: number;
  yearOverviewClosing: boolean;
  yearOverviewVisible: boolean;
};

/**
 * 달력 깊이 전환 중 화면에 유지할 날짜와 상단 날짜 필의 표시 모델을 계산한다.
 * 월·일·연 레이어가 동시에 마운트되는 구간에서도 각 레이어가 전환 시작 시점의
 * 날짜를 유지하게 해 콘텐츠가 애니메이션 도중 바뀌어 보이지 않도록 한다.
 */
export function useScheduleIndexDisplayModel({
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
}: UseScheduleIndexDisplayModelParams) {
  const isMonthToDayTransition =
    dayTransitionContext === 'monthToDay' && isDayTransitionActive;
  const isDayToMonthTransition =
    dayTransitionContext === 'dayToMonth' && isDayTransitionActive;
  const isYearToMonthTransition =
    yearOverviewVisible && isYearDepthTransitionActive && yearOverviewClosing;
  const isMonthToYearTransition =
    yearOverviewVisible && isYearDepthTransitionActive && !yearOverviewClosing;
  const retainedMonthLayerDayRef = useRef(selectedDay);
  const retainedMonthLayerFocusRef = useRef(visibleMonth);

  if (
    !isMonthToDayTransition &&
    (isDayToMonthTransition || calendarDepth !== 'day')
  ) {
    retainedMonthLayerDayRef.current = isYearToMonthTransition
      ? visibleMonth
      : selectedDay;
    retainedMonthLayerFocusRef.current = visibleMonth;
  }
  const monthDisplaySelectedDay = retainedMonthLayerDayRef.current;
  const monthDisplayFocusedMonth = retainedMonthLayerFocusRef.current;
  const retainedDayLayerDayRef = useRef(selectedDay);
  if (calendarDepth === 'day' || isDayTransitionActive || !dayLayerMounted) {
    retainedDayLayerDayRef.current = dayTransitionTargetDay ?? selectedDay;
  }
  const dayDisplaySelectedDay = retainedDayLayerDayRef.current;
  const pillTargetDepth: CalendarDepth = isYearToMonthTransition
    ? 'month'
    : isMonthToYearTransition
    ? 'year'
    : isMonthToDayTransition
    ? 'day'
    : isDayToMonthTransition
    ? 'month'
    : calendarDepth;
  const pillDisplayDay = dayTransitionTargetDay ?? selectedDay;
  const detailMonthPrimaryLabel = `${visibleYear}년 ${Number(
    visibleMonth.slice(5, 7),
  )}월`;
  const monthUsesCombinedPrimaryPill = usesMonthInPrimaryPill(calendarViewMode);
  const visiblePrimaryLabel =
    pillTargetDepth === 'day'
      ? `${new Date(`${pillDisplayDay}T00:00:00`).getMonth() + 1}월`
      : pillTargetDepth === 'month' && monthUsesCombinedPrimaryPill
      ? detailMonthPrimaryLabel
      : `${visibleYear}년`;
  const monthPrimaryLabel = monthUsesCombinedPrimaryPill
    ? detailMonthPrimaryLabel
    : `${visibleYear}년`;
  const monthPrimaryPillLayout = resolveCalendarPrimaryPillLayout(
    'month',
    monthPrimaryLabel,
    screenWidth,
  );
  const primaryPillLayout = resolveCalendarPrimaryPillLayout(
    pillTargetDepth,
    visiblePrimaryLabel,
    screenWidth,
  );
  const primaryPillVisible = primaryPillLayout.visible;
  const primaryPillContentWidth = primaryPillVisible
    ? primaryPillLayout.width
    : monthPrimaryPillLayout.width;

  // 연간 화면에서 필을 숨기더라도 호스트 너비는 실제 값으로 유지한다.
  // 부모 너비가 0인 동안 네이티브 자식이 100% 너비를 사용하면 Fabric에서
  // 오래된 클리핑 경계가 남을 수 있기 때문이다.
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
  }, [primaryPillAnimatedWidth, primaryPillContentWidth, reduceMotionEnabled]);
  const primaryPillAnimatedStyle = useAnimatedStyle(() => ({
    width: primaryPillAnimatedWidth.value,
  }));

  /**
   * 상세 월 달력을 스크롤하는 동안 상단 필을 미리보기 월로 갱신한다.
   * 유효한 월 시작일만 받아 네이티브 텍스트와 필 너비 애니메이션을 함께 맞춘다.
   */
  const handleDetailMonthPreview = useCallback(
    (day: string) => {
      if (
        pillTargetDepth !== 'month' ||
        !usesMonthInPrimaryPill(calendarViewMode)
      )
        return;

      const monthAnchor = getCalendarMonthAnchor(day);
      if (!/^\d{4}-\d{2}-01$/.test(monthAnchor)) return;
      const previewLabel =
        `${Number(monthAnchor.slice(0, 4))}년 ` +
        `${Number(monthAnchor.slice(5, 7))}월`;
      const previewWidth = resolveCalendarPrimaryPillLayout(
        'month',
        previewLabel,
        screenWidth,
      ).width;

      primaryDatePillNativeRef.current?.setDisplayContent({
        label: previewLabel,
        buttonWidth: previewWidth,
      });
      cancelReanimatedAnimation(primaryPillAnimatedWidth);
      primaryPillAnimatedWidth.value = withTiming(previewWidth, {
        duration: reduceMotionEnabled
          ? CALENDAR_DEPTH_MOTION.reduceMotionDurationMs
          : CALENDAR_DEPTH_MOTION.depthSlideDurationMs,
        easing: reduceMotionEnabled
          ? ReanimatedEasing.out(ReanimatedEasing.cubic)
          : ReanimatedEasing.bezier(...CALENDAR_DEPTH_MOTION.bezier),
        reduceMotion: ReduceMotion.Never,
      });
    },
    [
      calendarViewMode,
      pillTargetDepth,
      primaryDatePillNativeRef,
      primaryPillAnimatedWidth,
      reduceMotionEnabled,
      screenWidth,
    ],
  );

  useLayoutEffect(() => {
    primaryDatePillNativeRef.current?.setDisplayContent({
      label: visiblePrimaryLabel,
      buttonWidth: primaryPillContentWidth,
    });
  }, [primaryDatePillNativeRef, primaryPillContentWidth, visiblePrimaryLabel]);

  const selectedLiquidMode: CalendarViewMode | 'day' | 'multi' =
    pillTargetDepth === 'day'
      ? dayViewMode === 'singleDay'
        ? 'day'
        : 'multi'
      : calendarViewMode;
  const collapsedLiquidToolbarWidth =
    pillTargetDepth === 'year'
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
    todayFocusOpacity,
  );
  const calendarContentTodayTranslateY = Animated.add(
    calendarContentTranslateY,
    todayFocusTranslateY,
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
  const monthDisplayLayoutAnchorDay = getCalendarMonthAnchor(
    monthDisplayFocusedMonth,
  );

  return {
    calendarContentScale,
    calendarContentTodayOpacity,
    calendarContentTodayTranslateY,
    calendarIconScale,
    calendarVisualProgress,
    collapsedLiquidToolbarWidth,
    dayDisplaySelectedDay,
    detailMonthHeightMotionDuration,
    handleDetailMonthPreview,
    isDayToMonthTransition,
    isMonthToDayTransition,
    isMonthToYearTransition,
    monthAgendaIsOpen,
    monthAgendaMotionDuration,
    monthAgendaPanelKind,
    monthDisplayFocusedMonth,
    monthDisplayLayoutAnchorDay,
    monthDisplaySelectedDay,
    pillTargetDepth,
    primaryPillAnimatedStyle,
    primaryPillContentWidth,
    primaryPillVisible,
    selectedLiquidMode,
    visiblePrimaryLabel,
  };
}
