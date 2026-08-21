import { createScheduleIndexStyles } from '../../../../../app/schedule/index.styles';
import { useMemo } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DayTimelineEventCard from './DayTimelineEventCard';
import { getFloatingActionBarClearance } from '../shared/floatingActionBarLayout';
import {
  DAY_MINUTES,
  DAY_TIMELINE_END_PADDING,
  DAY_TIMELINE_HOUR_HEIGHT,
  formatDayTimelineTimeRange,
} from '../../dayTimelineLayout';
import { CALENDAR_PRIMARY_PILL_LAYOUT } from '../../calendarMotion';
import BrandedLoader from '../../../../ui/BrandedLoader';
import type {
  ScheduleDayDisplayProps,
  ScheduleDayDisplayController,
} from './useScheduleDayDisplayController';

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

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function colorWithOpacity(color: string, opacity: number) {
  const normalized = color.replace('#', '');
  if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
    const r = Number.parseInt(normalized.slice(0, 2), 16);
    const g = Number.parseInt(normalized.slice(2, 4), 16);
    const b = Number.parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  return color;
}

function formatDayTitle(ymd: string) {
  const date = new Date(`${ymd}T00:00:00`);
  return `${date.getFullYear()}년 ${
    date.getMonth() + 1
  }월 ${date.getDate()}일 ${WEEKDAYS[date.getDay()]}요일`;
}

function formatTimelineHour(hour: number) {
  if (hour === 0) return '자정';
  if (hour === 12) return '정오';
  if (hour < 12) return `오전 ${hour}시`;
  return `오후 ${hour - 12}시`;
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

/** 단일·다중 날짜의 시간선, 종일 일정과 현재 선택 패널을 메모이즈해 렌더링 부하를 제한합니다. */
export function useScheduleDayTimelineContent(
  props: ScheduleDayDisplayProps,
  controller: ScheduleDayDisplayController,
) {
  const {
    bottomInset,
    dayViewMode,
    loading,
    modeTransitionFrom,
    onOpenSchedule,
    getScheduleSwipeActions,
    onRequestScheduleActions,
    onPressRetry,
    todayKey,
  } = props;
  const {
    colors,
    mode,
    singleDayTimelineRef,
    multiDayTimelineRef,
    didPositionSingleTimelineRef,
    didPositionMultiTimelineRef,
    currentTimeY,
    selectedDay,
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
  } = controller;
  const singleDayTimeline = useMemo(() => {
    if (!needsSingleDayContent) return null;

    return (
      <ScrollView
        ref={attachSingleDayTimelineRef}
        style={[
          styles.dayTimelineScroll,
          {
            backgroundColor: colors.calendarBackground,
            marginBottom: getFloatingActionBarClearance(bottomInset),
          },
        ]}
        contentContainerStyle={[
          styles.dayTimelineContent,
          styles.floatingBarContentEnd,
        ]}
        showsVerticalScrollIndicator={false}
        contentOffset={{ x: 0, y: initialTimelineOffset }}
        onScroll={handleTimelineScroll}
        scrollEventThrottle={16}
        onContentSizeChange={() => {
          if (didPositionSingleTimelineRef.current) return;
          didPositionSingleTimelineRef.current = true;
          requestAnimationFrame(() => {
            singleDayTimelineRef.current?.scrollTo({
              y: initialTimelineOffset,
              animated: false,
            });
          });
        }}
      >
        {loading || inlineError ? (
          <Pressable
            accessible={Boolean(inlineError)}
            accessibilityRole={inlineError ? 'button' : undefined}
            accessibilityLabel={
              inlineError ? `${inlineError}. 일정 다시 조회` : undefined
            }
            accessibilityState={{ disabled: !inlineError, busy: loading }}
            disabled={!inlineError}
            onPress={inlineError ? onPressRetry : undefined}
            style={styles.timelineInlineState}
          >
            {loading ? (
              <BrandedLoader
                size="button"
                variant="schedule"
                accessibilityLabel="일정을 불러오는 중이에요"
              />
            ) : null}
            <Text
              style={[
                styles.timelineInlineStateText,
                { color: colors.textSecondary },
              ]}
            >
              {loading ? '일정을 불러오는 중이에요' : inlineError}
            </Text>
          </Pressable>
        ) : null}
        <View style={styles.dayTimelineCanvas}>
          {Array.from({ length: 25 }, (_, hour) => (
            <View
              key={hour}
              style={[
                styles.dayHourRow,
                {
                  top: hour * DAY_TIMELINE_HOUR_HEIGHT,
                  borderTopColor: colors.border,
                },
              ]}
            >
              {hour < 24 && (
                <Text
                  style={[styles.dayHourText, { color: colors.textSecondary }]}
                >
                  {formatTimelineHour(hour)}
                </Text>
              )}
            </View>
          ))}

          <View style={styles.dayEventLayer}>
            {positionedEvents.map(
              ({ item, startMinute, height, lane, laneCount }) => {
                const top = (startMinute / 60) * DAY_TIMELINE_HOUR_HEIGHT;
                const laneWidth = 100 / laneCount;
                const laneInset = laneCount > 1 ? 0.5 : 0;

                return (
                  <DayTimelineEventCard
                    key={item.id}
                    item={item}
                    top={top}
                    height={height}
                    left={`${lane * laneWidth + laneInset}%`}
                    width={`${Math.max(0, laneWidth - laneInset * 2)}%`}
                    laneCount={laneCount}
                    onPress={() => onOpenSchedule(item.id)}
                    swipeActions={getScheduleSwipeActions?.(item)}
                    onLongPress={onRequestScheduleActions
                      ? () => onRequestScheduleActions(item)
                      : undefined}
                  />
                );
              },
            )}
          </View>

          {isSelectedToday && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.dayNowLine,
                { transform: [{ translateY: currentTimeY }] },
              ]}
            >
              <View style={styles.dayNowTimeGutter}>
                <View
                  style={[
                    styles.dayNowTimeBadge,
                    { backgroundColor: accentColor },
                  ]}
                >
                  <Text style={styles.dayNowTimeText}>{currentTimeLabel}</Text>
                </View>
              </View>
              <View
                style={[styles.dayNowRule, { backgroundColor: accentColor }]}
              />
            </Animated.View>
          )}
        </View>
      </ScrollView>
    );
  }, [
    colors.border,
    colors.calendarBackground,
    colors.textSecondary,
    accentColor,
    attachSingleDayTimelineRef,
    bottomInset,
    currentTimeLabel,
    currentTimeY,
    didPositionSingleTimelineRef,
    handleTimelineScroll,
    isSelectedToday,
    loading,
    needsSingleDayContent,
    inlineError,
    initialTimelineOffset,
    getScheduleSwipeActions,
    onOpenSchedule,
    onRequestScheduleActions,
    onPressRetry,
    positionedEvents,
    singleDayTimelineRef,
  ]);

  const multiDayTimeline = useMemo(() => {
    if (!needsMultiDayContent) return null;

    return (
      <ScrollView
        ref={attachMultiDayTimelineRef}
        style={[
          styles.dayTimelineScroll,
          {
            backgroundColor: colors.calendarBackground,
            marginBottom: getFloatingActionBarClearance(bottomInset),
          },
        ]}
        contentContainerStyle={[
          styles.dayTimelineContent,
          styles.floatingBarContentEnd,
        ]}
        showsVerticalScrollIndicator={false}
        contentOffset={{ x: 0, y: initialTimelineOffset }}
        onScroll={handleTimelineScroll}
        scrollEventThrottle={16}
        onContentSizeChange={() => {
          if (didPositionMultiTimelineRef.current) return;
          didPositionMultiTimelineRef.current = true;
          requestAnimationFrame(() => {
            multiDayTimelineRef.current?.scrollTo({
              y: initialTimelineOffset,
              animated: false,
            });
          });
        }}
      >
        {loading || inlineError ? (
          <Pressable
            accessible={Boolean(inlineError)}
            accessibilityRole={inlineError ? 'button' : undefined}
            accessibilityLabel={
              inlineError ? `${inlineError}. 일정 다시 조회` : undefined
            }
            accessibilityState={{ disabled: !inlineError, busy: loading }}
            disabled={!inlineError}
            onPress={inlineError ? onPressRetry : undefined}
            style={styles.timelineInlineState}
          >
            {loading ? (
              <BrandedLoader
                size="button"
                variant="schedule"
                accessibilityLabel="일정을 불러오는 중이에요"
              />
            ) : null}
            <Text
              style={[
                styles.timelineInlineStateText,
                { color: colors.textSecondary },
              ]}
            >
              {loading ? '일정을 불러오는 중이에요' : inlineError}
            </Text>
          </Pressable>
        ) : null}
        <View style={styles.multiDayTimelineCanvas}>
          {Array.from({ length: 25 }, (_, hour) => (
            <View
              key={hour}
              style={[
                styles.dayHourRow,
                {
                  top: hour * DAY_TIMELINE_HOUR_HEIGHT,
                  borderTopColor: colors.border,
                },
              ]}
            >
              {hour < 24 && (
                <Text
                  style={[styles.dayHourText, { color: colors.textSecondary }]}
                >
                  {formatTimelineHour(hour)}
                </Text>
              )}
            </View>
          ))}
          {multiDayColumns.some(
            column => column.day.dateString === todayKey,
          ) && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.multiDayNowTimeGutter,
                {
                  transform: [{ translateY: currentTimeY }],
                },
              ]}
            >
              <View
                style={[
                  styles.dayNowTimeBadge,
                  { backgroundColor: accentColor },
                ]}
              >
                <Text style={styles.dayNowTimeText}>{currentTimeLabel}</Text>
              </View>
            </Animated.View>
          )}
          <View style={styles.multiDayColumns}>
            {multiDayColumns.map((column, columnIndex) => (
              <View
                key={column.day.dateString}
                style={[
                  styles.multiDayColumn,
                  {
                    borderLeftColor: colors.border,
                    borderRightWidth:
                      columnIndex === multiDayColumns.length - 1
                        ? 0
                        : StyleSheet.hairlineWidth,
                    borderRightColor: colors.border,
                  },
                ]}
              >
                {column.day.dateString === todayKey && (
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.multiDayNowLine,
                      { transform: [{ translateY: currentTimeY }] },
                    ]}
                  >
                    <View
                      style={[
                        styles.multiDayNowRule,
                        { backgroundColor: accentColor },
                      ]}
                    />
                  </Animated.View>
                )}
                {column.positionedEvents.map(
                  ({ item, startMinute, height, lane, laneCount }) => {
                    const color = item.category?.color ?? '#8e8e93';
                    const top = (startMinute / 60) * DAY_TIMELINE_HOUR_HEIGHT;
                    const laneWidth = 100 / laneCount;

                    return (
                      <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${
                          item.title
                        }, ${formatDayTimelineTimeRange(item)}`}
                        accessibilityHint={onRequestScheduleActions
                          ? '길게 누르면 수정 또는 삭제 메뉴가 열립니다'
                          : undefined}
                        onPress={() => onOpenSchedule(item.id)}
                        onLongPress={onRequestScheduleActions
                          ? () => onRequestScheduleActions(item)
                          : undefined}
                        delayLongPress={420}
                        style={({ pressed }) => [
                          styles.multiDayTimelineEvent,
                          {
                            top,
                            height,
                            left: `${lane * laneWidth + 1}%`,
                            width: `${Math.max(0, laneWidth - 2)}%`,
                            backgroundColor:
                              mode === 'dark'
                                ? colorWithOpacity(color, 0.24)
                                : colorWithOpacity(color, 0.13),
                            borderColor: colorWithOpacity(
                              color,
                              mode === 'dark' ? 0.55 : 0.32,
                            ),
                            opacity: pressed ? 0.58 : 1,
                          },
                        ]}
                      >
                        <Text
                          numberOfLines={2}
                          style={[
                            styles.multiDayEventTitle,
                            { color: colors.textPrimary },
                          ]}
                        >
                          {item.title}
                        </Text>
                      </Pressable>
                    );
                  },
                )}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    );
  }, [
    attachMultiDayTimelineRef,
    accentColor,
    colors.border,
    colors.calendarBackground,
    colors.textSecondary,
    colors.textPrimary,
    bottomInset,
    currentTimeLabel,
    currentTimeY,
    didPositionMultiTimelineRef,
    handleTimelineScroll,
    inlineError,
    initialTimelineOffset,
    loading,
    mode,
    multiDayTimelineRef,
    multiDayColumns,
    needsMultiDayContent,
    onOpenSchedule,
    onRequestScheduleActions,
    onPressRetry,
    todayKey,
  ]);

  const currentModeTimeline = useMemo(() => {
    if (dayViewMode === 'singleDay') return singleDayTimeline;
    return multiDayTimeline;
  }, [dayViewMode, multiDayTimeline, singleDayTimeline]);

  const previousModeTimeline = useMemo(() => {
    if (!modeTransitionFrom) return null;
    if (modeTransitionFrom === 'singleDay') return singleDayTimeline;
    return multiDayTimeline;
  }, [modeTransitionFrom, multiDayTimeline, singleDayTimeline]);

  const singleDayAllDaySection = useMemo(
    () => (
      <View
        style={[styles.dayAllDaySection, { borderBottomColor: colors.border }]}
      >
        <Text style={[styles.dayAllDayLabel, { color: colors.textSecondary }]}>
          종일
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dayAllDayItems}
        >
          {allDayItems.length === 0 ? (
            <View style={styles.dayAllDayEmptySpacer} />
          ) : (
            allDayItems.map(item => {
              const color = item.category?.color ?? '#8e8e93';
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}, 종일`}
                  accessibilityHint={onRequestScheduleActions ? '길게 누르면 수정 또는 삭제 메뉴가 열립니다' : undefined}
                  onPress={() => onOpenSchedule(item.id)}
                  onLongPress={onRequestScheduleActions
                    ? () => onRequestScheduleActions(item)
                    : undefined}
                  delayLongPress={420}
                  style={({ pressed }) => [
                    styles.dayAllDayEvent,
                    {
                      backgroundColor: colorWithOpacity(
                        color,
                        mode === 'dark' ? 0.24 : 0.14,
                      ),
                      borderColor: colorWithOpacity(color, 0.5),
                      opacity: pressed ? 0.58 : 1,
                    },
                  ]}
                >
                  <View
                    style={[styles.dayAllDayDot, { backgroundColor: color }]}
                  />
                  <Text
                    numberOfLines={1}
                    style={[styles.dayAllDayTitle, { color }]}
                  >
                    {item.title}
                  </Text>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>
    ),
    [allDayItems, colors.border, colors.textSecondary, mode, onOpenSchedule, onRequestScheduleActions],
  );

  const multiDayAllDaySection = useMemo(
    () => (
      <View
        style={[styles.dayAllDaySection, { borderBottomColor: colors.border }]}
      >
        <Text style={[styles.dayAllDayLabel, { color: colors.textSecondary }]}>
          종일
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dayAllDayItems}
        >
          {multiDayAllDayItems.length === 0 ? (
            <View style={styles.dayAllDayEmptySpacer} />
          ) : (
            multiDayAllDayItems.map(item => {
              const color = item.category?.color ?? '#8e8e93';
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}, 종일`}
                  accessibilityHint={onRequestScheduleActions ? '길게 누르면 수정 또는 삭제 메뉴가 열립니다' : undefined}
                  onPress={() => onOpenSchedule(item.id)}
                  onLongPress={onRequestScheduleActions
                    ? () => onRequestScheduleActions(item)
                    : undefined}
                  delayLongPress={420}
                  style={({ pressed }) => [
                    styles.dayAllDayEvent,
                    {
                      backgroundColor: colorWithOpacity(
                        color,
                        mode === 'dark' ? 0.24 : 0.14,
                      ),
                      borderColor: colorWithOpacity(color, 0.5),
                      opacity: pressed ? 0.58 : 1,
                    },
                  ]}
                >
                  <View
                    style={[styles.dayAllDayDot, { backgroundColor: color }]}
                  />
                  <Text
                    numberOfLines={1}
                    style={[styles.dayAllDayTitle, { color }]}
                  >
                    {item.title}
                  </Text>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>
    ),
    [
      colors.border,
      colors.textSecondary,
      mode,
      onOpenSchedule,
      onRequestScheduleActions,
      multiDayAllDayItems,
    ],
  );

  const currentAllDaySection = useMemo(() => {
    if (dayViewMode === 'singleDay' && allDayItems.length > 0)
      return singleDayAllDaySection;
    if (dayViewMode === 'multiDay' && multiDayAllDayItems.length > 0)
      return multiDayAllDaySection;
    return null;
  }, [
    allDayItems.length,
    dayViewMode,
    multiDayAllDayItems.length,
    multiDayAllDaySection,
    singleDayAllDaySection,
  ]);

  const previousAllDaySection = useMemo(() => {
    if (!modeTransitionFrom) return null;
    if (modeTransitionFrom === 'singleDay' && allDayItems.length > 0)
      return singleDayAllDaySection;
    if (modeTransitionFrom === 'multiDay' && multiDayAllDayItems.length > 0)
      return multiDayAllDaySection;
    return null;
  }, [
    allDayItems.length,
    modeTransitionFrom,
    multiDayAllDayItems.length,
    multiDayAllDaySection,
    singleDayAllDaySection,
  ]);

  const singleDayPanelContent = (
    <View
      style={[
        styles.daySinglePanel,
        { backgroundColor: colors.calendarBackground },
      ]}
    >
      <Animated.View style={{ opacity: titleSectionOpacity }}>
        <View
          style={[styles.dayDateTitleBar, { borderBottomColor: colors.border }]}
        >
          <Text
            style={[styles.dayDateTitleText, { color: colors.textPrimary }]}
          >
            {formatDayTitle(selectedDay)}
          </Text>
        </View>
      </Animated.View>

      <Animated.View
        style={[
          styles.daySinglePanelBody,
          {
            opacity: timelineSectionOpacity,
            transform: [{ translateY: timelineSectionTranslateY }],
          },
        ]}
      >
        {allDayItems.length > 0 ? singleDayAllDaySection : null}
        {singleDayTimeline}
      </Animated.View>
    </View>
  );

  const nonSingleDayPanelContent = (
    <>
      <View style={styles.dayModeTitleSlot} pointerEvents="none">
        <View
          style={[styles.dayDateTitleBar, { borderBottomColor: colors.border }]}
        >
          <Text
            style={[styles.dayDateTitleText, { color: colors.textPrimary }]}
          >
            {contentTitle}
          </Text>
        </View>
      </View>

      <Animated.View
        style={[
          styles.dayModeBody,
          {
            opacity: modeBodyOpacity,
            transform: [{ translateY: modeBodyTranslateY }],
          },
        ]}
      >
        <Animated.View
          style={[
            styles.dayAllDaySectionSpacer,
            {
              opacity: timelineSectionOpacity,
              transform: [{ translateY: timelineSectionTranslateY }],
            },
          ]}
        >
          {isModeTransitionActive && previousAllDaySection ? (
            <Animated.View
              style={{
                opacity: modeSwitchOutgoingOpacity,
                transform: [{ translateY: modeSwitchOutgoingTranslateY }],
              }}
              pointerEvents="none"
            >
              {previousAllDaySection}
            </Animated.View>
          ) : null}

          {currentAllDaySection}

          <Animated.View
            style={{
              flex: 1,
              backgroundColor: colors.calendarBackground,
            }}
          >
            {isModeTransitionActive && previousModeTimeline ? (
              <Animated.View
                style={{
                  position: 'absolute',
                  inset: 0,
                  opacity: modeSwitchOutgoingOpacity,
                  transform: [{ translateY: modeSwitchOutgoingTranslateY }],
                }}
                pointerEvents="none"
              >
                {previousModeTimeline}
              </Animated.View>
            ) : null}

            <Animated.View
              style={{
                flex: 1,
                opacity: modeSwitchIncomingOpacity,
                transform: [{ translateY: modeSwitchIncomingTranslateY }],
              }}
            >
              {currentModeTimeline}
            </Animated.View>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </>
  );

  const currentDayPanelContent =
    dayViewMode === 'singleDay'
      ? singleDayPanelContent
      : nonSingleDayPanelContent;
  return {
    nonSingleDayPanelContent,
    currentDayPanelContent,
  };
}
