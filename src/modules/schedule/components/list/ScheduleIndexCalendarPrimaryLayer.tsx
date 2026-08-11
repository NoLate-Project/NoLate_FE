import { createScheduleIndexStyles } from '../../../../routeSupport/schedule/index.styles';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Reanimated from 'react-native-reanimated';
import CalendarGlassSurface from '../calendar/CalendarGlassSurface';
import CalendarScopeContextLabel from '../calendar/CalendarScopeContextLabel';
import CalendarViewModeGlyph from '../calendar/CalendarViewModeGlyph';
import LiquidGlassIconButton, {
  isLiquidGlassIconButtonAvailable,
} from '../calendar/LiquidGlassIconButton';
import LiquidCalendarMenuPrototype, {
  isCalendarViewMode,
} from '../calendar/LiquidCalendarMenuPrototype';
import { getScheduleAccessibilityVisibility } from '../../accessibilityVisibility';
import {
  DAY_MINUTES,
  DAY_TIMELINE_END_PADDING,
  DAY_TIMELINE_HOUR_HEIGHT,
} from '../../dayTimelineLayout';
import { ADD_MENU_SOURCE } from '../../addHandoffMotion';
import { CALENDAR_PRIMARY_PILL_LAYOUT } from '../../calendarMotion';
import type { ScheduleIndexController } from '../../hooks/useScheduleIndexController';

const CALENDAR_TOOLBAR_HEIGHT = 56;

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

const LIQUID_TOOLBAR_TOP_OFFSET = 4;

const DAY_WEEK_STRIP_HEIGHT = 71;

const DAY_WEEK_STRIP_HORIZONTAL_PADDING = 0;

const DAY_TIMELINE_GUTTER = 54;

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

/** 달력 본문, 범위 문맥과 기본 액체형 보기 컨트롤을 렌더링합니다. */
export function ScheduleIndexCalendarPrimaryLayer({ controller }: Props) {
  const {
    insets,
    mode,
    colors,
    activeToolbarMenu,
    toolbarMenuClosing,
    liquidPrototypeOpen,
    prototypeCloseRequest,
    calendarViewMode,
    searchQuery,
    setSearchQuery,
    shouldHideHandoffSurface,
    todayFocusOpacity,
    todayFocusTranslateY,
    addHandoffToolbarOpacity,
    primaryDatePillNativeRef,
    searchInputRef,
    selectedDay,
    visibleYear,
    pillTargetDepth,
    visiblePrimaryLabel,
    primaryPillContentWidth,
    primaryPillAnimatedStyle,
    selectedLiquidMode,
    calendarVisualProgress,
    calendarIconScale,
    primaryPillScaleX,
    primaryPillScaleY,
    primaryPillTodayOpacity,
    primaryPillYearTranslateX,
    primaryPillYearScale,
    usesLiquidViewModeControl,
    isSearchToolbarOpen,
    searchHeaderTargetWidth,
    liquidPrototypeLayerWidth,
    liquidPrototypeLayerHeight,
    searchHeaderWidth,
    searchMorphSeedOpacity,
    searchMorphSeedScale,
    searchFieldContentOpacity,
    searchFieldContentTranslateX,
    searchFieldContentTranslateY,
    primaryPillInteractionEnabled,
    closeToolbarMenu,
    openToolbarMenu,
    openSearchToolbar,
    closeSearchToolbar,
    handleLiquidPrototypeOpenChange,
    openBlankSchedule,
    openQuickSchedule,
    openCategoryManager,
    openSharedCalendarManager,
    handleOpenDay,
    closeDayDisplay,
    handleCalendarViewModeChange,
    handleDayViewMenuSelect,
    handlePrimaryDateButtonPress,
    activeCalendarPresentation,
    activeCalendarIconColor,
  } = controller;
  return (
    <>
      {(activeToolbarMenu !== null ||
        toolbarMenuClosing ||
        liquidPrototypeOpen) && (
        <Pressable
          accessible={false}
          disabled={toolbarMenuClosing}
          style={[
            styles.toolbarDropdownBackdrop,
            liquidPrototypeOpen && styles.liquidToolbarBackdrop,
          ]}
          onPress={() => closeToolbarMenu()}
        />
      )}
      {
        <Animated.View
          pointerEvents="box-none"
          {...getScheduleAccessibilityVisibility(!isSearchToolbarOpen)}
          style={[
            styles.toolbarChromeLayer,
            {
              paddingTop: insets.top,
            },
          ]}
        >
          <View style={styles.toolbar}>
            <Reanimated.View
              testID="calendar-primary-pill-host"
              pointerEvents={
                primaryPillInteractionEnabled ? 'box-none' : 'none'
              }
              accessibilityElementsHidden={
                !primaryPillInteractionEnabled || usesLiquidViewModeControl
              }
              importantForAccessibility={
                primaryPillInteractionEnabled && !usesLiquidViewModeControl
                  ? 'auto'
                  : 'no-hide-descendants'
              }
              style={[styles.primaryDatePillHost, primaryPillAnimatedStyle]}
            >
              <Animated.View
                testID="calendar-primary-pill-motion"
                style={[
                  styles.yearGlassMotion,
                  {
                    opacity: primaryPillTodayOpacity,
                    transform: [
                      { translateY: todayFocusTranslateY },
                      { translateX: primaryPillYearTranslateX },
                      { scale: primaryPillYearScale },
                      { scaleX: primaryPillScaleX },
                      { scaleY: primaryPillScaleY },
                    ],
                  },
                ]}
              >
                {isLiquidGlassIconButtonAvailable ? (
                  <Pressable
                    onPress={handlePrimaryDateButtonPress}
                    disabled={!primaryPillInteractionEnabled}
                    accessibilityLabel={
                      pillTargetDepth === 'day'
                        ? '월 화면으로 돌아가기'
                        : `${visibleYear}년 전체 월 보기`
                    }
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.yearGlass,
                      {
                        width: '100%',
                        opacity: pressed ? 0.68 : 1,
                        transform: [{ scale: pressed ? 0.96 : 1 }],
                      },
                    ]}
                  >
                    <LiquidGlassIconButton
                      ref={primaryDatePillNativeRef}
                      pointerEvents="none"
                      leadingSymbolName="chevron.left"
                      label={visiblePrimaryLabel}
                      buttonWidth={primaryPillContentWidth}
                      buttonHeight={LIQUID_TOOLBAR_BUTTON_SIZE}
                      colorScheme={mode === 'dark' ? 'dark' : 'light'}
                      animatesContentChanges={false}
                      accessibilityLabel={
                        pillTargetDepth === 'day'
                          ? '월 화면으로 돌아가기'
                          : `${visibleYear}년 전체 월 보기`
                      }
                      style={StyleSheet.absoluteFill}
                    />
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={handlePrimaryDateButtonPress}
                    disabled={!primaryPillInteractionEnabled}
                    accessibilityLabel={
                      pillTargetDepth === 'day'
                        ? '월 화면으로 돌아가기'
                        : `${visibleYear}년 전체 월 보기`
                    }
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.yearGlass,
                      {
                        width: '100%',
                        opacity: pressed ? 0.68 : 1,
                        transform: [{ scale: pressed ? 0.96 : 1 }],
                      },
                    ]}
                  >
                    <CalendarGlassSurface
                      pointerEvents="none"
                      interactive
                      clear
                      glow
                      variant="bottomBar"
                      tone="softGlass"
                      style={[
                        styles.yearGlassSurface,
                        { borderColor: colors.border },
                      ]}
                    />
                    <View pointerEvents="none" style={styles.yearButton}>
                      <Ionicons
                        accessible={false}
                        name="chevron-back"
                        size={23}
                        color={colors.textPrimary}
                      />
                      <Text
                        style={[styles.yearText, { color: colors.textPrimary }]}
                      >
                        {visiblePrimaryLabel}
                      </Text>
                    </View>
                  </Pressable>
                )}
              </Animated.View>
            </Reanimated.View>

            <View
              pointerEvents="none"
              style={styles.toolbarActionsPlaceholder}
            />
          </View>
        </Animated.View>
      }
      <Animated.View
        pointerEvents="none"
        style={[
          styles.calendarScopeContextLayer,
          {
            top: insets.top + CALENDAR_TOOLBAR_HEIGHT,
            opacity: todayFocusOpacity,
            transform: [{ translateY: todayFocusTranslateY }],
          },
        ]}
      >
        <CalendarScopeContextLabel
          title={activeCalendarPresentation.title}
          color={activeCalendarIconColor}
        />
      </Animated.View>
      {usesLiquidViewModeControl ? (
        <Animated.View
          pointerEvents={shouldHideHandoffSurface ? 'none' : 'box-none'}
          style={[
            styles.liquidViewModeControl,
            {
              top: insets.top + LIQUID_TOOLBAR_TOP_OFFSET,
              right: ADD_MENU_SOURCE.nativeRightInset,
              width: liquidPrototypeLayerWidth,
              height: liquidPrototypeLayerHeight,
              // The search morph now starts entirely on the
              // native UI thread. Keep that surface above the
              // React year pill even before the open event
              // reaches JS; transparent canvas hit-testing is
              // already limited to the compact pill.
              zIndex: 56,
              elevation: 56,
              opacity: addHandoffToolbarOpacity,
            },
          ]}
        >
          <LiquidCalendarMenuPrototype
            style={StyleSheet.absoluteFill}
            selectedMode={selectedLiquidMode}
            viewModeVariant={
              pillTargetDepth === 'day' ? 'timeline' : 'calendar'
            }
            showsViewModeButton={pillTargetDepth !== 'year'}
            colorScheme={mode === 'dark' ? 'dark' : 'light'}
            closeRequest={prototypeCloseRequest}
            searchExpandedWidth={searchHeaderTargetWidth}
            onSelect={mode => {
              if (pillTargetDepth === 'day') {
                if (mode === 'day') {
                  handleDayViewMenuSelect('day');
                  return;
                }

                if (mode === 'multi') {
                  handleDayViewMenuSelect('multi');
                  return;
                }

                // Block stale native timeline events from falling
                // through to the month-only calendar view modes.
                return;
              }

              if (isCalendarViewMode(mode)) {
                handleCalendarViewModeChange(mode);
                return;
              }

              if (mode === 'day') {
                handleOpenDay(selectedDay);
                return;
              }

              if (mode === 'multi') {
                closeDayDisplay();
                handleCalendarViewModeChange('week');
              }
            }}
            onOpenChange={handleLiquidPrototypeOpenChange}
            onSearch={openSearchToolbar}
            onSearchTextChange={setSearchQuery}
            onSearchClose={closeSearchToolbar}
            onQuickAdd={openQuickSchedule}
            onManualAdd={openBlankSchedule}
            onManageCategories={openCategoryManager}
            onManageCalendars={openSharedCalendarManager}
          />
        </Animated.View>
      ) : (
        <Animated.View
          pointerEvents={shouldHideHandoffSurface ? 'none' : 'box-none'}
          style={[
            styles.scheduleActionPillLayer,
            {
              top: insets.top + LIQUID_TOOLBAR_TOP_OFFSET,
              right: ADD_MENU_SOURCE.fallbackRightInset,
              width: searchHeaderWidth,
            },
          ]}
        >
          <Animated.View style={{ opacity: addHandoffToolbarOpacity }}>
            <CalendarGlassSurface
              interactive
              clear
              glow
              variant="bottomBar"
              tone="softGlass"
              style={[
                styles.toolbarActions,
                isSearchToolbarOpen && styles.searchToolbarActions,
                { borderColor: colors.border },
              ]}
            >
              <Animated.View
                pointerEvents={isSearchToolbarOpen ? 'none' : 'auto'}
                {...getScheduleAccessibilityVisibility(!isSearchToolbarOpen)}
                style={[
                  styles.searchFieldSeedRow,
                  {
                    opacity: searchMorphSeedOpacity,
                    transform: [{ scale: searchMorphSeedScale }],
                  },
                ]}
              >
                {pillTargetDepth !== 'year' && (
                  <Pressable
                    onPress={() => openToolbarMenu('view')}
                    accessibilityRole="button"
                    accessibilityLabel="캘린더 보기 방식 선택"
                    style={({ pressed }) => [
                      styles.iconButton,
                      {
                        opacity: pressed ? 0.68 : 1,
                        transform: [{ scale: pressed ? 0.88 : 1 }],
                      },
                    ]}
                  >
                    <Animated.View
                      style={{
                        opacity: calendarVisualProgress,
                        transform: [{ scale: calendarIconScale }],
                      }}
                    >
                      {pillTargetDepth === 'day' ? (
                        <Ionicons
                          accessible={false}
                          name="calendar-outline"
                          size={25}
                          color={colors.textPrimary}
                        />
                      ) : (
                        <CalendarViewModeGlyph
                          mode={calendarViewMode}
                          color={colors.textPrimary}
                          size={27}
                          toolbar
                        />
                      )}
                    </Animated.View>
                  </Pressable>
                )}

                <Pressable
                  onPress={() => openSearchToolbar()}
                  accessibilityRole="button"
                  accessibilityLabel="일정 검색"
                  style={({ pressed }) => [
                    styles.iconButton,
                    {
                      opacity: pressed ? 0.68 : 1,
                      transform: [{ scale: pressed ? 0.88 : 1 }],
                    },
                  ]}
                >
                  <Ionicons
                    accessible={false}
                    name="search"
                    size={24}
                    color={colors.textPrimary}
                  />
                </Pressable>

                <Pressable
                  onPress={() => openToolbarMenu('add')}
                  accessibilityRole="button"
                  accessibilityLabel="일정 추가"
                  style={({ pressed }) => [
                    styles.iconButton,
                    {
                      opacity: pressed ? 0.68 : 1,
                      transform: [{ scale: pressed ? 0.88 : 1 }],
                    },
                  ]}
                >
                  <Ionicons
                    accessible={false}
                    name="add"
                    size={27}
                    color={colors.textPrimary}
                  />
                </Pressable>
              </Animated.View>

              <Animated.View
                pointerEvents={isSearchToolbarOpen ? 'auto' : 'none'}
                {...getScheduleAccessibilityVisibility(isSearchToolbarOpen)}
                style={[
                  styles.searchFieldInner,
                  {
                    opacity: searchFieldContentOpacity,
                    transform: [
                      { translateX: searchFieldContentTranslateX },
                      { translateY: searchFieldContentTranslateY },
                    ],
                  },
                ]}
              >
                <Ionicons
                  accessible={false}
                  name="search"
                  size={22}
                  color={colors.textPrimary}
                />
                <TextInput
                  ref={searchInputRef}
                  accessibilityLabel="일정 검색어"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="검색"
                  placeholderTextColor={colors.inputPlaceholder}
                  returnKeyType="search"
                  selectionColor={colors.textPrimary}
                  style={[
                    styles.searchHeaderInput,
                    { color: colors.textPrimary },
                  ]}
                />
                {searchQuery.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setSearchQuery('')}
                    accessibilityLabel="검색어 지우기"
                    hitSlop={12}
                    style={({ pressed }) => [
                      styles.searchHeaderIconButton,
                      { opacity: pressed ? 0.58 : 1 },
                    ]}
                  >
                    <Ionicons
                      accessible={false}
                      name="close-circle"
                      size={27}
                      color={colors.textSecondary}
                    />
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={closeSearchToolbar}
                  accessibilityLabel="검색 닫기"
                  hitSlop={12}
                  style={({ pressed }) => [
                    styles.searchHeaderIconButton,
                    { opacity: pressed ? 0.58 : 1 },
                  ]}
                >
                  <Ionicons
                    accessible={false}
                    name="close"
                    size={25}
                    color={colors.textPrimary}
                  />
                </Pressable>
              </Animated.View>
            </CalendarGlassSurface>
          </Animated.View>
        </Animated.View>
      )}
    </>
  );
}
