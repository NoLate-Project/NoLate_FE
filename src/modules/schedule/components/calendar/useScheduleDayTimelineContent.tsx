import { createScheduleIndexStyles } from '../../../../routeSupport/schedule/index.styles';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import DayTimelineEventCard from './DayTimelineEventCard';
import DayEventReturnHighlight from './DayEventReturnHighlight';
import { TimelineOverlapButton, TimelineOverlapSheet, type TimelineOverlapSelection } from './TimelineOverlapSheet';
import { getFloatingActionBarClearance } from '../shared/floatingActionBarLayout';
import {
  DAY_MINUTES,
  DAY_TIMELINE_END_PADDING,
  DAY_TIMELINE_EVENT_MAX_FONT_SCALE,
  DAY_TIMELINE_HOUR_HEIGHT,
  formatDayTimelineTimeRange,
  formatDayTimelineDeparture,
  getTimelineDisplayEntries,
} from '../../dayTimelineLayout';
import { addDaysToYmd } from '../../hooks/scheduleIndexControllerModel';
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

function TimelineScheduleButton({
  openSchedule,
  ...props
}: Omit<ComponentProps<typeof Pressable>, 'onPress'> & {
  openSchedule: (restoreFocus: () => void) => void;
}) {
  const button = useRef<ComponentRef<typeof Pressable>>(null);
  return (
    <Pressable
      {...props}
      ref={button}
      onPress={() => openSchedule(() => {
        if (button.current) AccessibilityInfo.sendAccessibilityEvent?.(button.current, 'focus');
      })}
    />
  );
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
    returnHighlight,
    getScheduleSwipeActions,
    onRequestScheduleActions,
    onPressRetry,
    reduceMotionEnabled,
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
    navigateToDayFromWeekStrip,
  } = controller;
  const { fontScale, width } = useWindowDimensions();
  const [overlapSelection, setOverlapSelection] = useState<TimelineOverlapSelection | null>(null);
  const [overlapVisible, setOverlapVisible] = useState(false);
  const pendingOverlapClose = useRef<{ id?: string } | null>(null);
  const openOverlap = useCallback((selection: TimelineOverlapSelection) => {
    pendingOverlapClose.current = null;
    setOverlapSelection(selection);
    setOverlapVisible(true);
  }, []);
  const closeOverlap = (id?: string) => {
    if (pendingOverlapClose.current || !overlapSelection) return;
    pendingOverlapClose.current = { id };
    setOverlapVisible(false);
  };
  const finishOverlapClose = useCallback(() => {
    const pending = pendingOverlapClose.current;
    if (!pending || !overlapSelection) return;
    pendingOverlapClose.current = null;
    setOverlapSelection(null);
    if (pending.id) onOpenSchedule(pending.id, overlapSelection.restoreFocus);
    else overlapSelection.restoreFocus();
  }, [onOpenSchedule, overlapSelection]);
  useEffect(() => {
    if (Platform.OS === 'ios' || overlapVisible || !pendingOverlapClose.current) return;
    const frame = requestAnimationFrame(finishOverlapClose);
    return () => cancelAnimationFrame(frame);
  }, [finishOverlapClose, overlapVisible]);
  const largeAllDayText = fontScale > 1.35;
  const allDayEventMaxWidth = largeAllDayText ? Math.min(300, width - 112) : 180;
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
          <View pointerEvents="none" style={[styles.dayTimelineGutterRule, { backgroundColor: colors.border }]} />
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
                  maxFontSizeMultiplier={1.35}
                  numberOfLines={1}
                  style={[styles.dayHourText, { color: colors.textSecondary }]}
                >
                  {formatTimelineHour(hour)}
                </Text>
              )}
            </View>
          ))}

          <View style={styles.dayEventLayer}>
            {getTimelineDisplayEntries(positionedEvents, width - DAY_TIMELINE_GUTTER).map(
              entry => {
                if ('events' in entry) return (
                  <TimelineOverlapButton key={entry.events[0].item.id} overlap={entry} day={selectedDay} onOpen={openOverlap} />
                );
                const { item, startMinute, height, lane, laneCount } = entry;
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
                    returnHighlightOpacity={returnHighlight?.id === item.id ? returnHighlight.opacity : undefined}
                    onPress={restoreFocus => onOpenSchedule(item.id, restoreFocus)}
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
    openOverlap,
    onRequestScheduleActions,
    onPressRetry,
    positionedEvents,
    returnHighlight,
    selectedDay,
    singleDayTimelineRef,
    width,
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
                  maxFontSizeMultiplier={1.35}
                  numberOfLines={1}
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
                {getTimelineDisplayEntries(column.positionedEvents, (width - DAY_TIMELINE_GUTTER) / multiDayColumns.length).map(
                  entry => {
                    if ('events' in entry) return (
                      <TimelineOverlapButton key={entry.events[0].item.id} overlap={entry} day={column.day.dateString} compact onOpen={openOverlap} />
                    );
                    const { item, startMinute, height, lane, laneCount } = entry;
                    const color = item.category?.color ?? '#8e8e93';
                    const top = (startMinute / 60) * DAY_TIMELINE_HOUR_HEIGHT;
                    const laneWidth = 100 / laneCount;
                    const timeRange = formatDayTimelineTimeRange(item);
                    const continuesFromPreviousDay = startMinute === 0 &&
                      new Date(item.startAt).getTime() < new Date(`${column.day.dateString}T00:00:00`).getTime();
                    const compactTime = continuesFromPreviousDay ? '자정부터' : formatDayTimelineDeparture(item.startAt);
                    const eventFontScale = Math.min(fontScale, DAY_TIMELINE_EVENT_MAX_FONT_SCALE);
                    const textHeight = Math.ceil(14 * eventFontScale);
                    const showsTime = height >= textHeight * 2 + 10;
                    const showsFullRange = showsTime && laneCount === 1 && width >= 360 && fontScale <= 1.3 && !continuesFromPreviousDay;
                    const showsInlineTime = !showsTime && laneCount === 1;

                    return (
                      <TimelineScheduleButton
                        key={item.id}
                        accessibilityRole="button"
                        accessibilityLabel={[item.title, timeRange, `${column.day.month}월 ${column.day.day}일`].filter(Boolean).join(', ')}
                        accessibilityHint={onRequestScheduleActions
                          ? '길게 누르면 수정 또는 삭제 메뉴가 열립니다'
                          : undefined}
                        openSchedule={restoreFocus => onOpenSchedule(item.id, restoreFocus)}
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
                            borderLeftColor: color,
                            opacity: pressed ? 0.58 : 1,
                          },
                        ]}
                      >
                        {returnHighlight?.id === item.id && (
                          <DayEventReturnHighlight opacity={returnHighlight.opacity} color={colors.textPrimary} />
                        )}
                        <View style={styles.multiDayEventHeading}>
                          <Text
                            maxFontSizeMultiplier={DAY_TIMELINE_EVENT_MAX_FONT_SCALE}
                            numberOfLines={1}
                            style={[
                              styles.multiDayEventTitle,
                              { color: colors.textPrimary },
                            ]}
                          >
                            {item.title}
                          </Text>
                          {showsInlineTime && (
                            <Text
                              maxFontSizeMultiplier={1.35}
                              numberOfLines={1}
                              style={[styles.multiDayEventTime, styles.multiDayInlineTime, { color: colors.textSecondary }]}
                            >
                              {compactTime}
                            </Text>
                          )}
                        </View>
                        {showsTime && (
                          <Text maxFontSizeMultiplier={DAY_TIMELINE_EVENT_MAX_FONT_SCALE} numberOfLines={1}
                            style={[styles.multiDayEventTime, { color: colors.textSecondary }]}>
                            {showsFullRange ? timeRange : compactTime}
                          </Text>
                        )}
                      </TimelineScheduleButton>
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
    fontScale,
    handleTimelineScroll,
    inlineError,
    initialTimelineOffset,
    loading,
    mode,
    multiDayTimelineRef,
    multiDayColumns,
    needsMultiDayContent,
    onOpenSchedule,
    openOverlap,
    onRequestScheduleActions,
    onPressRetry,
    returnHighlight,
    todayKey,
    width,
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
        <Text maxFontSizeMultiplier={1.35} numberOfLines={1} style={[styles.dayAllDayLabel, { color: colors.textSecondary }]}>
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
                <TimelineScheduleButton
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}, 종일`}
                  accessibilityHint={onRequestScheduleActions ? '길게 누르면 수정 또는 삭제 메뉴가 열립니다' : undefined}
                  openSchedule={restoreFocus => onOpenSchedule(item.id, restoreFocus)}
                  onLongPress={onRequestScheduleActions
                    ? () => onRequestScheduleActions(item)
                    : undefined}
                  delayLongPress={420}
                  style={({ pressed }) => [
                    styles.dayAllDayEvent,
                    {
                      maxWidth: allDayEventMaxWidth,
                      backgroundColor: colorWithOpacity(
                        color,
                        mode === 'dark' ? 0.24 : 0.14,
                      ),
                      borderColor: colorWithOpacity(color, 0.5),
                      opacity: pressed ? 0.58 : 1,
                    },
                  ]}
                >
                  {returnHighlight?.id === item.id && (
                    <DayEventReturnHighlight opacity={returnHighlight.opacity} color={colors.textPrimary} radius={17} />
                  )}
                  <View
                    style={[styles.dayAllDayDot, { backgroundColor: color }]}
                  />
                  <Text
                    numberOfLines={largeAllDayText ? 2 : 1}
                    style={[styles.dayAllDayTitle, { color }]}
                  >
                    {item.title}
                  </Text>
                </TimelineScheduleButton>
              );
            })
          )}
        </ScrollView>
      </View>
    ),
    [allDayEventMaxWidth, allDayItems, colors.border, colors.textPrimary, colors.textSecondary, largeAllDayText, mode, onOpenSchedule, onRequestScheduleActions, returnHighlight],
  );

  const multiDayAllDaySection = useMemo(
    () => (
      <View
        style={[styles.dayAllDaySection, { borderBottomColor: colors.border }]}
      >
        <Text maxFontSizeMultiplier={1.35} numberOfLines={1} style={[styles.dayAllDayLabel, { color: colors.textSecondary }]}>
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
                <TimelineScheduleButton
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}, 종일`}
                  accessibilityHint={onRequestScheduleActions ? '길게 누르면 수정 또는 삭제 메뉴가 열립니다' : undefined}
                  openSchedule={restoreFocus => onOpenSchedule(item.id, restoreFocus)}
                  onLongPress={onRequestScheduleActions
                    ? () => onRequestScheduleActions(item)
                    : undefined}
                  delayLongPress={420}
                  style={({ pressed }) => [
                    styles.dayAllDayEvent,
                    {
                      maxWidth: allDayEventMaxWidth,
                      backgroundColor: colorWithOpacity(
                        color,
                        mode === 'dark' ? 0.24 : 0.14,
                      ),
                      borderColor: colorWithOpacity(color, 0.5),
                      opacity: pressed ? 0.58 : 1,
                    },
                  ]}
                >
                  {returnHighlight?.id === item.id && (
                    <DayEventReturnHighlight opacity={returnHighlight.opacity} color={colors.textPrimary} radius={17} />
                  )}
                  <View
                    style={[styles.dayAllDayDot, { backgroundColor: color }]}
                  />
                  <Text
                    numberOfLines={largeAllDayText ? 2 : 1}
                    style={[styles.dayAllDayTitle, { color }]}
                  >
                    {item.title}
                  </Text>
                </TimelineScheduleButton>
              );
            })
          )}
        </ScrollView>
      </View>
    ),
    [
      allDayEventMaxWidth,
      colors.border,
      colors.textPrimary,
      colors.textSecondary,
      largeAllDayText,
      mode,
      onOpenSchedule,
      onRequestScheduleActions,
      multiDayAllDayItems,
      returnHighlight,
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

  const dateNavigation = (
    <View style={[styles.dayDateTitleBar, { borderBottomColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="이전 날짜"
        onPress={() => navigateToDayFromWeekStrip(addDaysToYmd(selectedDay, -1))}
        style={styles.dayDateStep}
      >
        <Ionicons accessible={false} name="chevron-back-outline" size={17} color={colors.textSecondary} />
      </Pressable>
      <Text accessibilityRole="header" maxFontSizeMultiplier={2} lineBreakStrategyIOS="hangul-word"
        style={[styles.dayDateTitleText, { color: colors.textPrimary }]}>
        {contentTitle}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="다음 날짜"
        onPress={() => navigateToDayFromWeekStrip(addDaysToYmd(selectedDay, 1))}
        style={styles.dayDateStep}
      >
        <Ionicons accessible={false} name="chevron-forward-outline" size={17} color={colors.textSecondary} />
      </Pressable>
    </View>
  );

  const multiDayColumnHeadings = (
    <View style={[styles.multiDayDateHeadings, { borderBottomColor: colors.border }]}>
      {multiDayColumns.map(({ day }) => (
        <Text key={day.dateString}
          accessibilityLabel={`${day.month}월 ${day.day}일 ${day.weekday}요일`}
          maxFontSizeMultiplier={1.6}
          style={[styles.multiDayDateHeading, { color: colors.textSecondary, borderLeftColor: colors.border }]}>
          {`${day.day}일 ${day.weekday}`}
        </Text>
      ))}
    </View>
  );

  const emptyTimelineNotice = !largeAllDayText && !loading && !inlineError ? (
    <Text
      testID="day-timeline-empty-notice"
      style={[styles.dayTimelineEmptyText, { color: colors.textSecondary, borderBottomColor: colors.border }]}
    >
      이 날짜에 등록된 일정이 없어요
    </Text>
  ) : null;

  const singleDayPanelContent = (
    <View
      style={[
        styles.daySinglePanel,
        { backgroundColor: colors.calendarBackground },
      ]}
    >
      <Animated.View style={{ opacity: titleSectionOpacity }}>
        {dateNavigation}
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
        {allDayItems.length === 0 && positionedEvents.length === 0 ? emptyTimelineNotice : null}
        {singleDayTimeline}
      </Animated.View>
    </View>
  );

  const nonSingleDayPanelContent = (
    <>
      <View style={styles.dayModeTitleSlot}>
        {dateNavigation}
        {dayViewMode === 'multiDay' && multiDayColumnHeadings}
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
          {dayViewMode === 'multiDay' && multiDayColumns.every(column => column.items.length === 0)
            ? emptyTimelineNotice
            : null}

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
    overlapSheet: (
      <TimelineOverlapSheet
        selection={overlapSelection}
        visible={overlapVisible}
        bottomInset={bottomInset}
        reduceMotion={reduceMotionEnabled}
        onClose={() => closeOverlap()}
        onSelect={closeOverlap}
        onDismiss={finishOverlapClose}
      />
    ),
  };
}
