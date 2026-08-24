import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { getCalendarTodayAccent } from './calendarTodayAccent';
import { useTheme } from '../../../theme/ThemeContext';
import { isOverlappingDay } from '../../../../../lib/util/data';
import type { ScheduleItem } from '../../types';
import type { ScheduleSwipeActionResolver } from '../ScheduleSwipeActions';
import { getCalendarWeekStart } from '../../calendarNavigation';
import {
  DAY_TIMELINE_HOUR_HEIGHT,
  buildPositionedEvents,
} from '../../dayTimelineLayout';
import {
  CURRENT_TIME_MOTION,
  formatCalendarCurrentTime,
  shouldAnimateCurrentTimeStep,
} from '../../calendarMotion';
import {
  type DayPanelNavigation,
  type QueuedDayNavigation,
  useScheduleDayNavigationActions,
} from './useScheduleDayNavigationActions';

function getCalendarErrorMessage(message?: string | null) {
  if (!message) return null;

  if (/403|forbidden|status code/i.test(message)) {
    return '일정을 불러오지 못했습니다';
  }

  if (/network|timeout/i.test(message)) {
    return '네트워크 상태를 확인한 뒤 다시 시도해 주세요';
  }

  return message;
}

function sanitizeCalendarTransitionError(error?: string | null) {
  return getCalendarErrorMessage(error) ?? null;
}

type DayViewMode = 'singleDay' | 'multiDay';

type CalendarDay = {
  dateString: string;
  day: number;
  weekday: string;
  month: number;
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function toDateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(date.getDate()).padStart(2, '0')}`;
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
  return `${date.getFullYear()}년 ${
    date.getMonth() + 1
  }월 ${date.getDate()}일 ${WEEKDAYS[date.getDay()]}요일`;
}

function formatWeekRangeTitle(days: CalendarDay[]) {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return '';
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
    return '';
  }
  if (first.month === last.month)
    return `${first.month}월 ${first.day}-${last.day}일`;
  return `${first.month}월 ${first.day}일-${last.month}월 ${last.day}일`;
}

function formatCurrentTimeLabel(date: Date) {
  return formatCalendarCurrentTime(date);
}

function minuteOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

export type ScheduleDayDisplayProps = {
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
  getScheduleSwipeActions?: ScheduleSwipeActionResolver;
  onRequestScheduleActions?: (item: ScheduleItem) => void;
};

/** 하루·여러 날 보기의 선택 상태, 시간선 위치와 좌우 페이지 전환 제스처를 관리합니다. */
export function useScheduleDayDisplayController({
  selectedDay: selectedDayProp,
  firstDay,
  dayViewMode,
  todayKey,
  items,
  error,
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
}: ScheduleDayDisplayProps) {
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
  const dayNavigationCleanupTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const dayNavigationInterruptRef = useRef<(() => void) | null>(null);
  const dayNavigationRetargetRef = useRef<(() => void) | null>(null);
  const dayNavigationUnmountingRef = useRef(false);
  const queuedDayNavigationRef = useRef<QueuedDayNavigation | null>(null);
  const deferredDayNavigationRef = useRef<QueuedDayNavigation | null>(null);
  const [dayNavigation, setDayNavigation] = useState<DayPanelNavigation | null>(
    null,
  );
  const [timelineNow, setTimelineNow] = useState(() => new Date());
  const initialCurrentTimeY =
    (minuteOfDay(timelineNow) / 60) * DAY_TIMELINE_HOUR_HEIGHT;
  const currentTimeY = useRef(new Animated.Value(initialCurrentTimeY)).current;
  const currentTimeTargetYRef = useRef(initialCurrentTimeY);
  const daySwipeSettlingRef = useRef(false);
  const handledTodayRequestRef = useRef(todayRequest);
  const [preparedDay, setPreparedDay] = useState<string | null>(null);
  const selectedDay =
    dayNavigation?.targetDay ??
    (transitionActive ? preparedDay ?? selectedDayProp : selectedDayProp);

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
    const appStateSubscription = AppState.addEventListener(
      'change',
      nextState => {
        if (nextState !== 'active') return;
        refreshNow();
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
  }, []);

  useEffect(() => {
    if (preparedDay && preparedDay === selectedDayProp) {
      setPreparedDay(null);
    }
  }, [preparedDay, selectedDayProp]);

  const weekStart = useMemo(
    () => getCalendarWeekStart(selectedDay, firstDay),
    [firstDay, selectedDay],
  );
  const weekDays = useMemo(() => createWeekDays(weekStart), [weekStart]);
  const weekSchedulesByDay = useMemo(() => {
    const schedulesByDay = new Map<string, ScheduleItem[]>();
    weekDays.forEach(day => schedulesByDay.set(day.dateString, []));

    items.forEach(item => {
      weekDays.forEach(day => {
        if (isOverlappingDay(item.startAt, item.endAt, day.dateString)) {
          schedulesByDay.get(day.dateString)?.push(item);
        }
      });
    });

    return schedulesByDay;
  }, [items, weekDays]);
  const needsSingleDayContent =
    dayViewMode === 'singleDay' || modeTransitionFrom === 'singleDay';
  const needsMultiDayContent =
    dayViewMode === 'multiDay' || modeTransitionFrom === 'multiDay';
  const multiDayDays = useMemo(
    () => createSequentialDays(selectedDay, 2),
    [selectedDay],
  );
  const dayItems = useMemo(
    () =>
      needsSingleDayContent
        ? items
            .filter(item =>
              isOverlappingDay(item.startAt, item.endAt, selectedDay),
            )
            .sort(
              (a, b) =>
                new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
            )
        : [],
    [items, needsSingleDayContent, selectedDay],
  );
  const allDayItems = useMemo(
    () => dayItems.filter(item => item.allDay),
    [dayItems],
  );
  const positionedEvents = useMemo(
    () => buildPositionedEvents(dayItems, selectedDay),
    [dayItems, selectedDay],
  );
  const currentMinute =
    timelineNow.getHours() * 60 +
    timelineNow.getMinutes() +
    timelineNow.getSeconds() / 60;
  const currentTimeLabel = formatCurrentTimeLabel(timelineNow);
  const isSelectedToday = selectedDay === todayKey;
  const accentColor = getCalendarTodayAccent(mode);
  const multiDayRangeTitle = useMemo(
    () => formatWeekRangeTitle(multiDayDays),
    [multiDayDays],
  );
  const contentTitle =
    dayViewMode === 'singleDay'
      ? formatDayTitle(selectedDay)
      : multiDayRangeTitle;
  const inlineError = sanitizeCalendarTransitionError(error);
  const multiDayColumns = useMemo(
    () =>
      needsMultiDayContent
        ? multiDayDays.map(day => {
            const columnItems = items
              .filter(item =>
                isOverlappingDay(item.startAt, item.endAt, day.dateString),
              )
              .sort(
                (a, b) =>
                  new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
              );

            return {
              day,
              items: columnItems,
              allDayItems: columnItems.filter(item => item.allDay),
              positionedEvents: buildPositionedEvents(
                columnItems,
                day.dateString,
                { compact: true },
              ),
            };
          })
        : [],
    [items, multiDayDays, needsMultiDayContent],
  );
  const showsCurrentTimeInTimeline =
    isSelectedToday ||
    (dayViewMode === 'multiDay' &&
      multiDayColumns.some(column => column.day.dateString === todayKey));
  const multiDayItems = useMemo(
    () =>
      multiDayColumns
        .flatMap(column => column.items)
        .filter(
          (item, index, array) =>
            array.findIndex(target => target.id === item.id) === index,
        )
        .sort(
          (a, b) =>
            new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
        ),
    [multiDayColumns],
  );
  const multiDayAllDayItems = useMemo(
    () => multiDayItems.filter(item => item.allDay),
    [multiDayItems],
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
        extrapolate: 'clamp',
      })
    : 1;
  const modeSwitchIncomingTranslateY = isModeTransitionActive
    ? modeTransitionProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [12, 0],
        extrapolate: 'clamp',
      })
    : 0;
  const modeSwitchOutgoingOpacity = isModeTransitionActive
    ? modeTransitionProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0],
        extrapolate: 'clamp',
      })
    : 1;
  const modeSwitchOutgoingTranslateY = isModeTransitionActive
    ? modeTransitionProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, -8],
        extrapolate: 'clamp',
      })
    : 0;
  const modeBodyOpacity = modeTransitionProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.98, 1],
    extrapolate: 'clamp',
  });
  const modeBodyTranslateY = modeTransitionProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
    extrapolate: 'clamp',
  });

  const defaultTimelineOffset = Math.max(
    0,
    ((isSelectedToday
      ? currentMinute - CURRENT_TIME_MOTION.initialLeadHours * 60
      : 5 * 60) /
      60) *
      DAY_TIMELINE_HOUR_HEIGHT,
  );
  const initialTimelineOffset =
    timelineVerticalOffsetRef.current ?? defaultTimelineOffset;
  if (timelineVerticalOffsetRef.current === null) {
    timelineVerticalOffsetRef.current = initialTimelineOffset;
  }

  useEffect(() => {
    const nextY = (currentMinute / 60) * DAY_TIMELINE_HOUR_HEIGHT;
    const previousTargetY = currentTimeTargetYRef.current;
    currentTimeTargetYRef.current = nextY;
    currentTimeY.stopAnimation();

    if (
      !shouldAnimateCurrentTimeStep(
        previousTargetY,
        nextY,
        DAY_TIMELINE_HOUR_HEIGHT,
        showsCurrentTimeInTimeline,
        reduceMotionEnabled,
      )
    ) {
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
  }, [
    currentMinute,
    currentTimeY,
    reduceMotionEnabled,
    showsCurrentTimeInTimeline,
  ]);

  const scrollTimelineToNow = useCallback(
    (animated = true) => {
      const targetOffset = Math.max(
        0,
        ((currentMinute - CURRENT_TIME_MOTION.todayTargetLeadHours * 60) / 60) *
          DAY_TIMELINE_HOUR_HEIGHT,
      );
      const timeline =
        dayViewMode === 'multiDay'
          ? multiDayTimelineRef.current
          : singleDayTimelineRef.current;

      timeline?.scrollTo({
        y: targetOffset,
        animated: animated && !reduceMotionEnabled,
      });
      if (!animated || reduceMotionEnabled) {
        timelineVerticalOffsetRef.current = targetOffset;
      }
    },
    [currentMinute, dayViewMode, reduceMotionEnabled],
  );

  const handleTimelineScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number } } }) => {
      timelineVerticalOffsetRef.current = Math.max(
        0,
        event.nativeEvent.contentOffset.y,
      );
    },
    [],
  );

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
  const { navigateToDayFromWeekStrip, timelineSwipeResponder } =
    useScheduleDayNavigationActions({
      dayNavigation,
      dayNavigationActiveRef,
      dayNavigationCleanupTimerRef,
      dayNavigationInterruptRef,
      dayNavigationRetargetRef,
      dayNavigationSourceRef,
      dayNavigationTargetRef,
      dayNavigationUnmountingRef,
      dayPagerProgress,
      dayPanelSnapshotRef,
      daySwipeSettlingRef,
      daySwipeVisualXRef,
      daySwipeX,
      dayViewMode,
      deferredDayNavigationRef,
      handledTodayRequestRef,
      isModeTransitionActive,
      onNavigateToday,
      onPageNavigationActiveChange,
      onSelectDay,
      onShiftDay,
      queuedDayNavigationRef,
      reduceMotionEnabled,
      scrollTimelineToNow,
      selectedDay,
      setDayNavigation,
      todayRequest,
      todayKey,
      viewportWidth,
    });
  return {
    colors,
    mode,
    viewportWidth,
    singleDayTimelineRef,
    multiDayTimelineRef,
    didPositionSingleTimelineRef,
    didPositionMultiTimelineRef,
    daySwipeX,
    dayPagerProgress,
    dayPanelSnapshotRef,
    dayNavigation,
    currentTimeY,
    selectedDay,
    weekDays,
    weekSchedulesByDay,
    needsSingleDayContent,
    needsMultiDayContent,
    allDayItems,
    positionedEvents,
    currentTimeLabel,
    isSelectedToday,
    accentColor,
    contentTitle,
    inlineError,
    multiDayColumns,
    multiDayAllDayItems,
    isModeTransitionActive,
    stripSelectionOpacity,
    stripSelectionTranslateY,
    titleSectionOpacity,
    timelineSectionOpacity,
    timelineSectionTranslateY,
    modeSwitchIncomingOpacity,
    modeSwitchIncomingTranslateY,
    modeSwitchOutgoingOpacity,
    modeSwitchOutgoingTranslateY,
    modeBodyOpacity,
    modeBodyTranslateY,
    initialTimelineOffset,
    handleTimelineScroll,
    attachSingleDayTimelineRef,
    attachMultiDayTimelineRef,
    navigateToDayFromWeekStrip,
    timelineSwipeResponder,
  };
}

export type ScheduleDayDisplayController = ReturnType<
  typeof useScheduleDayDisplayController
>;
