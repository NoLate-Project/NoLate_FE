import { createScheduleIndexStyles } from '../../../../../app/schedule/index.styles';
import { useLayoutEffect } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import {
  getCalendarWeekStart,
  getCalendarWeekdayIndex,
} from '../../calendarNavigation';
import {
  DAY_MINUTES,
  DAY_TIMELINE_END_PADDING,
  DAY_TIMELINE_HOUR_HEIGHT,
} from '../../dayTimelineLayout';
import { CALENDAR_PRIMARY_PILL_LAYOUT } from '../../calendarMotion';
import {
  useScheduleDayDisplayController,
  type ScheduleDayDisplayProps,
} from './useScheduleDayDisplayController';
import { useScheduleDayTimelineContent } from './useScheduleDayTimelineContent';

const CALENDAR_CONTEXT_HEIGHT = 24;

const STICKY_MONTH_HEADER_HEIGHT = 50;

const STICKY_WEEKDAY_HEADER_HEIGHT = 18;

const STICKY_CALENDAR_HEADER_HEIGHT =
  STICKY_MONTH_HEADER_HEIGHT + STICKY_WEEKDAY_HEADER_HEIGHT;

const LIQUID_TOOLBAR_BUTTON_SIZE = 44;

const LIQUID_TOOLBAR_SEARCH_HEIGHT = 52;

const LIQUID_TOOLBAR_SLOT_WIDTH = 50;

const LIQUID_TOOLBAR_ACTIONS_WIDTH = LIQUID_TOOLBAR_SLOT_WIDTH * 3;

const LIQUID_TOOLBAR_CONTROL_CANVAS_HEIGHT = 260;

const LIQUID_YEAR_PILL_WIDTH = CALENDAR_PRIMARY_PILL_LAYOUT.monthMinWidth;

const DAY_WEEK_STRIP_HEIGHT = 71;

const DAY_WEEK_STRIP_HORIZONTAL_PADDING = 0;

const DAY_TIMELINE_GUTTER = 54;

function getDateSelectionId(date: string) {
  return `date-${date}`;
}

const styles = createScheduleIndexStyles({
  CALENDAR_CONTEXT_HEIGHT,
  DAY_MINUTES,
  DAY_TIMELINE_END_PADDING,
  DAY_TIMELINE_GUTTER,
  DAY_TIMELINE_HOUR_HEIGHT,
  DAY_WEEK_STRIP_HEIGHT,
  DAY_WEEK_STRIP_HORIZONTAL_PADDING,
  LIQUID_TOOLBAR_ACTIONS_WIDTH,
  LIQUID_TOOLBAR_BUTTON_SIZE,
  LIQUID_TOOLBAR_CONTROL_CANVAS_HEIGHT,
  LIQUID_TOOLBAR_SEARCH_HEIGHT,
  LIQUID_TOOLBAR_SLOT_WIDTH,
  LIQUID_YEAR_PILL_WIDTH,
  STICKY_CALENDAR_HEADER_HEIGHT,
  STICKY_MONTH_HEADER_HEIGHT,
  STICKY_WEEKDAY_HEADER_HEIGHT,
});

/** 날짜 보기 컨트롤러가 준비한 단일·다중 날짜 타임라인과 페이지 전환 화면을 렌더링합니다. */
export function DayDisplay(props: ScheduleDayDisplayProps) {
  const { firstDay, todayKey, topOffset } = props;
  const controller = useScheduleDayDisplayController(props);
  const {
    colors,
    viewportWidth,
    daySwipeX,
    dayPagerProgress,
    dayPanelSnapshotRef,
    dayNavigation,
    selectedDay,
    weekDays,
    weekSchedulesByDay,
    accentColor,
    isModeTransitionActive,
    stripSelectionOpacity,
    stripSelectionTranslateY,
    modeSwitchIncomingOpacity,
    modeBodyOpacity,
    modeBodyTranslateY,
    navigateToDayFromWeekStrip,
    timelineSwipeResponder,
  } = controller;
  const { nonSingleDayPanelContent, currentDayPanelContent } =
    useScheduleDayTimelineContent(props, controller);

  // Keep the last rendered panel as an immutable outgoing snapshot so its
  // title, all-day row, and timeline remain mounted while the target enters.
  useLayoutEffect(() => {
    if (!isModeTransitionActive) {
      dayPanelSnapshotRef.current = currentDayPanelContent;
    }
  });

  const pagerWidth = Math.max(320, viewportWidth);
  const dayPagerOutgoingTranslateX = dayNavigation
    ? dayPagerProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, -dayNavigation.direction * pagerWidth],
        extrapolate: 'clamp',
      })
    : 0;
  const dayPagerIncomingTranslateX = dayNavigation
    ? dayPagerProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [dayNavigation.direction * pagerWidth, 0],
        extrapolate: 'clamp',
      })
    : daySwipeX;
  const navigationSelectionVisible = Boolean(
    dayNavigation &&
      getCalendarWeekStart(dayNavigation.fromDay, firstDay) ===
        getCalendarWeekStart(dayNavigation.targetDay, firstDay),
  );
  const navigationFromIndex = dayNavigation
    ? getCalendarWeekdayIndex(dayNavigation.fromDay, firstDay)
    : 0;
  const navigationTargetIndex = dayNavigation
    ? getCalendarWeekdayIndex(dayNavigation.targetDay, firstDay)
    : 0;
  const weekCellWidth = viewportWidth / 7;
  const navigationSelectionLeft =
    navigationFromIndex * weekCellWidth + (weekCellWidth - 34) / 2;
  const navigationTargetSelectionLeft =
    navigationTargetIndex * weekCellWidth + (weekCellWidth - 34) / 2;
  const navigationFromOpacity = dayNavigation
    ? dayPagerProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0],
        extrapolate: 'clamp',
      })
    : 0;
  const navigationTargetOpacity = dayNavigation
    ? dayPagerProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      })
    : 0;
  const navigationFromScale = dayNavigation
    ? dayPagerProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0.92],
        extrapolate: 'clamp',
      })
    : 1;
  const navigationTargetScale = dayNavigation
    ? dayPagerProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.92, 1],
        extrapolate: 'clamp',
      })
    : 1;
  const useDayPager = !isModeTransitionActive;

  return (
    <View
      style={[
        styles.dayRoot,
        {
          paddingTop: topOffset,
          backgroundColor: colors.calendarBackground,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.dayWeekStrip,
          {
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Animated.View
          style={[
            styles.dayWeekStripInner,
            {
              opacity: isModeTransitionActive ? modeSwitchIncomingOpacity : 1,
            },
          ]}
        >
          {weekDays.map(day => {
            const isSelected = day.dateString === selectedDay;
            const isNavigationEndpoint = Boolean(
              navigationSelectionVisible &&
                dayNavigation &&
                (day.dateString === dayNavigation.fromDay ||
                  day.dateString === dayNavigation.targetDay),
            );
            const isToday = day.dateString === todayKey;
            const daySchedules = weekSchedulesByDay.get(day.dateString) ?? [];
            const selectedFill = isToday ? accentColor : colors.selectedDayBg;
            const selectedText = isToday ? '#ffffff' : colors.selectedDayText;
            const unselectedText = isToday ? accentColor : colors.textPrimary;

            return (
              <Pressable
                key={day.dateString}
                onPress={() => navigateToDayFromWeekStrip(day.dateString)}
                accessibilityRole="button"
                accessibilityLabel={`${day.month}월 ${day.day}일 ${day.weekday}요일`}
                hitSlop={{ top: 8, right: 6, bottom: 8, left: 6 }}
                style={({ pressed }) => [
                  styles.dayWeekCell,
                  { opacity: pressed ? 0.58 : 1 },
                ]}
              >
                <Text
                  style={[
                    styles.dayWeekdayLabel,
                    {
                      color: isSelected
                        ? colors.textPrimary
                        : colors.textSecondary,
                    },
                  ]}
                >
                  {day.weekday}
                </Text>
                <Animated.View
                  nativeID={getDateSelectionId(day.dateString)}
                  pointerEvents="none"
                  style={[
                    styles.dayWeekCircle,
                    isSelected && {
                      backgroundColor: selectedFill,
                      borderColor: selectedFill,
                    },
                    {
                      opacity: isNavigationEndpoint
                        ? 0
                        : isSelected
                        ? stripSelectionOpacity
                        : 1,
                      transform: [
                        {
                          translateY: isSelected ? stripSelectionTranslateY : 0,
                        },
                      ],
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.dayWeekText,
                      {
                        color: isSelected ? selectedText : unselectedText,
                      },
                    ]}
                  >
                    {day.day}
                  </Text>
                </Animated.View>
                <View pointerEvents="none" style={styles.dayWeekDots}>
                  {!isSelected && isToday && daySchedules.length === 0 && (
                    <View
                      style={[
                        styles.dayWeekDot,
                        { backgroundColor: accentColor },
                      ]}
                    />
                  )}
                  {daySchedules.slice(0, 3).map(item => (
                    <View
                      key={item.id}
                      style={[
                        styles.dayWeekDot,
                        { backgroundColor: item.category?.color ?? '#8e8e93' },
                      ]}
                    />
                  ))}
                </View>
              </Pressable>
            );
          })}

          {navigationSelectionVisible && dayNavigation ? (
            <>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.dayNavigationSelectionLayer,
                  {
                    left: navigationSelectionLeft,
                    opacity: navigationFromOpacity,
                    transform: [{ scale: navigationFromScale }],
                  },
                ]}
              >
                <View
                  style={[
                    styles.dayNavigationSelectionCircle,
                    {
                      backgroundColor:
                        dayNavigation.fromDay === todayKey
                          ? accentColor
                          : colors.selectedDayBg,
                      borderColor:
                        dayNavigation.fromDay === todayKey
                          ? accentColor
                          : colors.selectedDayBg,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.dayWeekText,
                      {
                        color:
                          dayNavigation.fromDay === todayKey
                            ? '#ffffff'
                            : colors.selectedDayText,
                      },
                    ]}
                  >
                    {new Date(`${dayNavigation.fromDay}T00:00:00`).getDate()}
                  </Text>
                </View>
              </Animated.View>

              <Animated.View
                pointerEvents="none"
                style={[
                  styles.dayNavigationSelectionLayer,
                  {
                    left: navigationTargetSelectionLeft,
                    opacity: navigationTargetOpacity,
                    transform: [{ scale: navigationTargetScale }],
                  },
                ]}
              >
                <View
                  style={[
                    styles.dayNavigationSelectionCircle,
                    {
                      backgroundColor:
                        dayNavigation.targetDay === todayKey
                          ? accentColor
                          : colors.selectedDayBg,
                      borderColor:
                        dayNavigation.targetDay === todayKey
                          ? accentColor
                          : colors.selectedDayBg,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.dayWeekText,
                      {
                        color:
                          dayNavigation.targetDay === todayKey
                            ? '#ffffff'
                            : colors.selectedDayText,
                      },
                    ]}
                  >
                    {new Date(`${dayNavigation.targetDay}T00:00:00`).getDate()}
                  </Text>
                </View>
              </Animated.View>
            </>
          ) : null}
        </Animated.View>
      </Animated.View>

      <Animated.View style={styles.dayBodyEntry}>
        {useDayPager ? (
          <Animated.View
            style={[
              styles.dayModeBody,
              {
                opacity: modeBodyOpacity,
                transform: [{ translateY: modeBodyTranslateY }],
              },
            ]}
          >
            <View
              {...timelineSwipeResponder.panHandlers}
              style={styles.dayPagerViewport}
            >
              {/* Matching date keys move the mounted source into
                                the outgoing slot and preserve the destination
                                after cleanup instead of remounting both pages. */}
              {dayNavigation ? (
                <Animated.View
                  key={`day-panel-${dayNavigation.fromDay}`}
                  pointerEvents="none"
                  style={[
                    styles.dayPagerPanel,
                    { transform: [{ translateX: dayPagerOutgoingTranslateX }] },
                  ]}
                >
                  {dayNavigation.outgoingPanel}
                </Animated.View>
              ) : null}

              <Animated.View
                key={`day-panel-${selectedDay}`}
                style={[
                  styles.dayPagerPanel,
                  { transform: [{ translateX: dayPagerIncomingTranslateX }] },
                ]}
              >
                {currentDayPanelContent}
              </Animated.View>
            </View>
          </Animated.View>
        ) : (
          nonSingleDayPanelContent
        )}
      </Animated.View>
    </View>
  );
}
