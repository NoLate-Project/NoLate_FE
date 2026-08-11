import { createScheduleIndexStyles } from '../../../../../app/schedule/index.styles';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CalendarGlassSurface from '../calendar/CalendarGlassSurface';
import CalendarViewModeGlyph from '../calendar/CalendarViewModeGlyph';
import { CALENDAR_VIEW_OPTIONS } from '../calendar/viewMode';
import { useTheme } from '../../../theme/ThemeContext';
import {
  DAY_MINUTES,
  DAY_TIMELINE_END_PADDING,
  DAY_TIMELINE_HOUR_HEIGHT,
} from '../../dayTimelineLayout';
import { CALENDAR_PRIMARY_PILL_LAYOUT } from '../../calendarMotion';
import type { ScheduleIndexController } from '../../hooks/useScheduleIndexController';

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

const SEARCH_MIN_QUERY_LENGTH = 2;

const LIQUID_YEAR_PILL_WIDTH = CALENDAR_PRIMARY_PILL_LAYOUT.monthMinWidth;

const LIQUID_TOOLBAR_TOP_OFFSET = 4;

const DAY_WEEK_STRIP_HEIGHT = 71;

const DAY_WEEK_STRIP_HORIZONTAL_PADDING = 0;

const DAY_TIMELINE_GUTTER = 54;

function formatScheduleDateTitle(startAt: string) {
  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) return '';

  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${
    weekdays[date.getDay()]
  })`;
}

function formatScheduleTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, '0');
  const meridiem = hour < 12 ? '오전' : '오후';
  const hour12 = hour % 12 || 12;
  return `${meridiem} ${hour12}:${minute}`;
}

function ToolbarDropdownAction({
  icon,
  title,
  onPress,
  colors,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.dropdownActionRow,
        {
          backgroundColor: pressed ? 'rgba(255,255,255,0.07)' : 'transparent',
        },
      ]}
    >
      <View style={styles.dropdownActionIconSlot}>
        <Ionicons
          accessible={false}
          name={icon}
          size={26}
          color={colors.textPrimary}
        />
      </View>
      <Text style={[styles.dropdownTitle, { color: colors.textPrimary }]}>
        {title}
      </Text>
    </Pressable>
  );
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

type Props = { controller: ScheduleIndexController };

/** 검색 결과, 고정 월 헤더와 폴백 보기·추가 메뉴를 렌더링합니다. */
export function ScheduleIndexCalendarOverlayMenus({ controller }: Props) {
  const {
    insets,
    mode,
    colors,
    activeToolbarMenu,
    liquidPrototypeOpen,
    calendarViewMode,
    calendarDepth,
    dayViewMode,
    searchQuery,
    searchResults,
    searchLoading,
    searchError,
    setSearchRetryKey,
    todayFocusTranslateY,
    visibleYear,
    pillTargetDepth,
    primaryPillContentWidth,
    monthChromeTranslateX,
    dropdownWidth,
    toolbarDropdownTop,
    usesLiquidViewModeControl,
    actionDropdownRight,
    isSearchToolbarOpen,
    searchHeaderRightInset,
    searchHeaderTargetWidth,
    dropdownScaleX,
    dropdownScaleY,
    dropdownTranslateY,
    viewDropdownScaleX,
    viewDropdownScaleY,
    viewDropdownTranslateY,
    searchFieldContentOpacity,
    searchFieldContentTranslateY,
    dropdownOpacity,
    viewDropdownOpacity,
    stickyWeekdayItems,
    stickyCalendarHeaderPosition,
    showsStickyMonthTitle,
    primaryPillWeekdayGap,
    reservedStickyCalendarHeaderHeight,
    showsStickyCalendarHeader,
    stickyCalendarHeaderTodayOpacity,
    stickyMonthTitle,
    stickyMonthColorStyle,
    stickyWeekdayColor,
    stickyWeekendColor,
    stickyWeekdayBorderColor,
    primaryPillInteractionEnabled,
    searchKeywordLength,
    openBlankSchedule,
    openQuickSchedule,
    openCategoryManager,
    openSharedCalendarManager,
    openScheduleFromSearch,
    handleCalendarViewModeChange,
    handleDayViewMenuSelect,
    handlePrimaryDateButtonPress,
  } = controller;
  return (
    <>
      {/* The collapsed native search canvas spans the toolbar so its
                          morph can start on the UI thread. Keep an exact React hit
                          target above only the visible left pill; once native content
                          opens, the native surface owns the full toolbar again. */}
      {usesLiquidViewModeControl &&
        !liquidPrototypeOpen &&
        primaryPillInteractionEnabled && (
          <Pressable
            testID="calendar-primary-pill-hit-target"
            accessibilityRole="button"
            accessibilityLabel={
              pillTargetDepth === 'day'
                ? '월 화면으로 돌아가기'
                : `${visibleYear}년 전체 월 보기`
            }
            accessibilityState={{ disabled: false }}
            onPress={handlePrimaryDateButtonPress}
            style={[
              styles.yearTapOverlay,
              {
                top: insets.top + LIQUID_TOOLBAR_TOP_OFFSET,
                width: primaryPillContentWidth,
              },
            ]}
          />
        )}
      {isSearchToolbarOpen && searchQuery.trim().length > 0 && (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.searchResultsLayer,
            {
              top: insets.top + 74,
              right: searchHeaderRightInset,
              width: searchHeaderTargetWidth,
              opacity: searchFieldContentOpacity,
              transform: [{ translateY: searchFieldContentTranslateY }],
            },
          ]}
        >
          <CalendarGlassSurface
            interactive
            prominent
            style={[styles.searchResultsGlass, { borderColor: colors.border }]}
          >
            {searchLoading ? (
              <View style={styles.dropdownEmpty}>
                <ActivityIndicator color={colors.textSecondary} />
                <Text
                  style={[
                    styles.dropdownEmptyText,
                    { color: colors.textSecondary },
                  ]}
                >
                  전체 일정 검색 중
                </Text>
              </View>
            ) : searchError ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="일정 검색 다시 시도"
                onPress={() => setSearchRetryKey(value => value + 1)}
                style={({ pressed }) => [
                  styles.dropdownEmpty,
                  { opacity: pressed ? 0.62 : 1 },
                ]}
              >
                <Ionicons
                  accessible={false}
                  name="refresh-outline"
                  size={20}
                  color={colors.textSecondary}
                />
                <Text
                  style={[
                    styles.dropdownEmptyText,
                    { color: colors.textSecondary },
                  ]}
                >
                  검색에 실패했어요. 눌러서 다시 시도해 주세요.
                </Text>
              </Pressable>
            ) : searchKeywordLength < SEARCH_MIN_QUERY_LENGTH ? (
              <View style={styles.dropdownEmpty}>
                <Text
                  style={[
                    styles.dropdownEmptyText,
                    { color: colors.textSecondary },
                  ]}
                >
                  두 글자 이상 입력해 주세요
                </Text>
              </View>
            ) : searchResults.length === 0 ? (
              <View style={styles.dropdownEmpty}>
                <Text
                  style={[
                    styles.dropdownEmptyText,
                    { color: colors.textSecondary },
                  ]}
                >
                  검색 결과가 없어요
                </Text>
              </View>
            ) : (
              <ScrollView
                style={styles.searchResultScroll}
                contentContainerStyle={styles.searchResultList}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {searchResults.map(item => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${
                      item.title
                    }, ${formatScheduleDateTitle(item.startAt)}, ${
                      item.allDay ? '종일' : formatScheduleTime(item.startAt)
                    }`}
                    onPress={() => openScheduleFromSearch(item.id)}
                    style={({ pressed }) => [
                      styles.searchResultRow,
                      {
                        borderBottomColor: colors.border,
                        backgroundColor: pressed
                          ? mode === 'dark'
                            ? 'rgba(255,255,255,0.08)'
                            : 'rgba(0,0,0,0.05)'
                          : 'transparent',
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.searchResultBar,
                        {
                          backgroundColor: item.category?.color ?? '#8e8e93',
                        },
                      ]}
                    />
                    <View style={styles.searchResultBody}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.searchResultTitle,
                          { color: colors.textPrimary },
                        ]}
                      >
                        {item.title}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.searchResultMeta,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {formatScheduleDateTitle(item.startAt)}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.searchResultTime,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {item.allDay ? '종일' : formatScheduleTime(item.startAt)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </CalendarGlassSurface>
        </Animated.View>
      )}
      {showsStickyCalendarHeader && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.stickyCalendarHeader,
            stickyCalendarHeaderPosition,
            {
              height: reservedStickyCalendarHeaderHeight,
              opacity: stickyCalendarHeaderTodayOpacity,
              transform: [
                { translateX: monthChromeTranslateX },
                { translateY: todayFocusTranslateY },
              ],
            },
          ]}
        >
          <View
            style={[
              styles.stickyHeaderBackdrop,
              mode === 'dark'
                ? styles.stickyHeaderBackdropDark
                : styles.stickyHeaderBackdropLight,
            ]}
          />
          <View
            style={[
              styles.stickyHeaderBackdropTop,
              mode === 'dark'
                ? styles.stickyHeaderBackdropTopDark
                : styles.stickyHeaderBackdropTopLight,
            ]}
          />
          <View
            style={[
              styles.stickyHeaderBackdropBottom,
              mode === 'dark'
                ? styles.stickyHeaderBackdropBottomDark
                : styles.stickyHeaderBackdropBottomLight,
            ]}
          />
          {showsStickyMonthTitle && (
            <View style={styles.stickyMonthHeader}>
              <Text style={[styles.stickyMonthTitle, stickyMonthColorStyle]}>
                {stickyMonthTitle}
              </Text>
            </View>
          )}
          <View
            style={[
              styles.stickyWeekdayHeader,
              {
                marginTop: primaryPillWeekdayGap,
                borderBottomColor: stickyWeekdayBorderColor,
              },
            ]}
          >
            {stickyWeekdayItems.map((item, index) => (
              <Text
                key={`${item.label}-${index}`}
                style={[
                  styles.stickyWeekdayText,
                  {
                    color: item.isWeekend
                      ? stickyWeekendColor
                      : stickyWeekdayColor,
                  },
                ]}
              >
                {item.label}
              </Text>
            ))}
          </View>
        </Animated.View>
      )}
      {!usesLiquidViewModeControl && activeToolbarMenu === 'view' && (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.toolbarDropdown,
            styles.toolbarDropdownPosition,
            {
              top: toolbarDropdownTop,
              width: dropdownWidth,
              opacity: viewDropdownOpacity,
              transform: [
                { translateY: viewDropdownTranslateY },
                { scaleX: viewDropdownScaleX },
                { scaleY: viewDropdownScaleY },
              ],
            },
          ]}
        >
          <View
            style={[
              styles.viewDropdownShell,
              mode === 'dark'
                ? styles.viewDropdownShellDark
                : styles.viewDropdownShellLight,
            ]}
          >
            <CalendarGlassSurface
              interactive
              prominent
              tone="menuLiquid"
              style={[
                styles.toolbarDropdownGlass,
                styles.viewToolbarDropdownGlass,
                {
                  borderColor: colors.border,
                  shadowColor: colors.textPrimary,
                },
              ]}
            >
              <View
                style={[styles.dropdownContent, styles.viewDropdownContent]}
              >
                <View
                  pointerEvents="none"
                  style={[
                    styles.viewDropdownReadableScrim,
                    mode === 'dark'
                      ? styles.viewDropdownReadableScrimDark
                      : styles.viewDropdownReadableScrimLight,
                  ]}
                />
                {calendarDepth === 'day' ? (
                  <View style={styles.dayViewModeMenu}>
                    {[
                      {
                        key: 'day' as const,
                        icon: 'calendar-outline' as const,
                        label: '일간',
                        selected: dayViewMode === 'singleDay',
                      },
                      {
                        key: 'multi' as const,
                        icon: 'calendar-number-outline' as const,
                        label: '여러 날',
                        selected: dayViewMode === 'multiDay',
                      },
                    ].map((option, index) => (
                      <React.Fragment key={option.key}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${option.label} 보기`}
                          accessibilityState={{ selected: option.selected }}
                          onPress={() => handleDayViewMenuSelect(option.key)}
                          style={({ pressed }) => [
                            styles.viewModeRow,
                            option.selected &&
                              (mode === 'dark'
                                ? styles.viewModeSelectedPillDark
                                : styles.viewModeSelectedPillLight),
                            {
                              opacity: pressed ? 0.62 : 1,
                              transform: [{ scale: pressed ? 0.98 : 1 }],
                            },
                          ]}
                        >
                          <View style={styles.dayViewModeIconSlot}>
                            <Ionicons
                              accessible={false}
                              name={option.icon}
                              size={22}
                              color={
                                option.selected
                                  ? colors.textPrimary
                                  : colors.textSecondary
                              }
                            />
                          </View>
                          <Text
                            style={[
                              styles.dropdownTitle,
                              {
                                color: option.selected
                                  ? colors.textPrimary
                                  : colors.textSecondary,
                              },
                            ]}
                          >
                            {option.label}
                          </Text>
                        </Pressable>
                        {index < 1 && (
                          <View
                            style={[
                              styles.dropdownRowDivider,
                              styles.viewDropdownDivider,
                              { backgroundColor: colors.border },
                            ]}
                          />
                        )}
                      </React.Fragment>
                    ))}
                  </View>
                ) : (
                  <View style={styles.viewModeIconGrid}>
                    {CALENDAR_VIEW_OPTIONS.map(option => {
                      const selected = option.value === calendarViewMode;

                      return (
                        <Pressable
                          key={option.value}
                          accessibilityRole="button"
                          accessibilityLabel={`${option.label} 보기`}
                          accessibilityState={{ selected }}
                          onPress={() =>
                            handleCalendarViewModeChange(option.value)
                          }
                          style={({ pressed }) => [
                            styles.viewModeIconOption,
                            selected &&
                              (mode === 'dark'
                                ? styles.viewModeSelectedPillDark
                                : styles.viewModeSelectedPillLight),
                            {
                              opacity: pressed ? 0.62 : 1,
                              transform: [{ scale: pressed ? 0.92 : 1 }],
                            },
                          ]}
                        >
                          <CalendarViewModeGlyph
                            mode={option.value}
                            color={
                              selected
                                ? colors.textPrimary
                                : colors.textSecondary
                            }
                            size={25}
                          />
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            </CalendarGlassSurface>
          </View>
        </Animated.View>
      )}
      {!usesLiquidViewModeControl && activeToolbarMenu === 'add' && (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.toolbarDropdown,
            styles.toolbarDropdownPosition,
            {
              top: toolbarDropdownTop,
              right: actionDropdownRight,
              width: dropdownWidth,
              opacity: dropdownOpacity,
              transform: [
                { translateY: dropdownTranslateY },
                { scaleX: dropdownScaleX },
                { scaleY: dropdownScaleY },
              ],
            },
          ]}
        >
          <CalendarGlassSurface
            interactive
            prominent
            tone="flat"
            style={[
              styles.toolbarDropdownGlass,
              {
                borderColor: colors.border,
                shadowColor: colors.textPrimary,
              },
            ]}
          >
            <View
              style={[styles.dropdownContent, styles.actionDropdownContent]}
            >
              <ToolbarDropdownAction
                icon="flash-outline"
                title="빠른 생성"
                onPress={openQuickSchedule}
                colors={colors}
              />
              <View
                style={[
                  styles.dropdownRowDivider,
                  { backgroundColor: colors.border },
                ]}
              />
              <ToolbarDropdownAction
                icon="create-outline"
                title="직접 입력"
                onPress={openBlankSchedule}
                colors={colors}
              />
              <View
                style={[
                  styles.dropdownRowDivider,
                  { backgroundColor: colors.border },
                ]}
              />
              <ToolbarDropdownAction
                icon="folder-open-outline"
                title="카테고리 관리"
                onPress={openCategoryManager}
                colors={colors}
              />
              <View
                style={[
                  styles.dropdownRowDivider,
                  { backgroundColor: colors.border },
                ]}
              />
              <ToolbarDropdownAction
                icon="people-outline"
                title="공유 캘린더"
                onPress={openSharedCalendarManager}
                colors={colors}
              />
            </View>
          </CalendarGlassSurface>
        </Animated.View>
      )}
    </>
  );
}
