import { createScheduleIndexStyles } from '../../../../../app/schedule/index.styles';
import React from 'react';
import { Animated, StatusBar, View } from 'react-native';
import Reanimated from 'react-native-reanimated';
import CalendarWrapper from '../calendar/CalendarWrapper';
import CalendarYearOverviewModal from '../calendar/CalendarYearOverviewModal';
import CalendarSettingsModal from '../calendar/CalendarSettingsModal';
import CalendarScopeSheet from '../calendar/CalendarScopeSheet';
import ScheduleRouteFocusBoundary from '../ScheduleRouteFocusBoundary';
import { type CalendarViewModePreference } from '../calendar/viewMode';
import GlobalFloatingActionBar from '../shared/GlobalFloatingActionBar';
import ShareInvitationSheet from '../share/ShareInvitationSheet';
import ScheduleNewModal from '../form/ScheduleAddModal';
import CategoryLoadErrorBanner from '../form/CategoryLoadErrorBanner';
import QuickScheduleModal from '../form/QuickScheduleModal';
import { recordQuickScheduleReliabilityFeedbackDurably } from '../../quickScheduleReliabilityFeedbackQueue';
import { getScheduleAccessibilityVisibility } from '../../accessibilityVisibility';
import {
  DAY_MINUTES,
  DAY_TIMELINE_END_PADDING,
  DAY_TIMELINE_HOUR_HEIGHT,
} from '../../dayTimelineLayout';
import { ADD_MENU_SOURCE } from '../../addHandoffMotion';
import { CALENDAR_PRIMARY_PILL_LAYOUT } from '../../calendarMotion';
import { DayDisplay } from '../calendar/ScheduleDayDisplay';

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

const CALENDAR_CONTEXT_HEIGHT = 24;

const STICKY_MONTH_HEADER_HEIGHT = 50;

const STICKY_WEEKDAY_HEADER_HEIGHT = 18;

const STICKY_CALENDAR_HEADER_HEIGHT =
  STICKY_MONTH_HEADER_HEIGHT + STICKY_WEEKDAY_HEADER_HEIGHT;

const LIQUID_TOOLBAR_BUTTON_SIZE = 44;

const LIQUID_TOOLBAR_SEARCH_HEIGHT = 52;

const LIQUID_TOOLBAR_SLOT_WIDTH = 50;

const LIQUID_TOOLBAR_ACTIONS_WIDTH = LIQUID_TOOLBAR_SLOT_WIDTH * 3;

const LIQUID_TOOLBAR_ADD_DROPDOWN_HEIGHT = ADD_MENU_SOURCE.nativeHeight;

const LIQUID_TOOLBAR_CONTROL_CANVAS_HEIGHT = 260;

const LIQUID_YEAR_PILL_WIDTH = CALENDAR_PRIMARY_PILL_LAYOUT.monthMinWidth;

const LIQUID_TOOLBAR_TOP_OFFSET = 4;

const DAY_WEEK_STRIP_TOP_OFFSET =
  LIQUID_TOOLBAR_BUTTON_SIZE + LIQUID_TOOLBAR_TOP_OFFSET + 2;

const DAY_WEEK_STRIP_HEIGHT = 71;

const DAY_WEEK_STRIP_HORIZONTAL_PADDING = 0;

const DAY_TIMELINE_GUTTER = 54;

const MemoizedDayDisplay = React.memo(DayDisplay);

const MemoizedQuickScheduleModal = React.memo(
  QuickScheduleModal,
  (previous, next) =>
    Boolean(
      previous.prewarm && next.prewarm && !previous.visible && !next.visible,
    ),
);

const MemoizedScheduleNewModal = React.memo(
  ScheduleNewModal,
  (previous, next) =>
    Boolean(
      previous.prewarm && next.prewarm && !previous.visible && !next.visible,
    ),
);

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
import { useScheduleIndexController } from '../../hooks/useScheduleIndexController';
import { ScheduleIndexCalendarPrimaryLayer } from './ScheduleIndexCalendarPrimaryLayer';
import { ScheduleIndexCalendarOverlayMenus } from './ScheduleIndexCalendarOverlayMenus';

type Props = { initialCalendarViewMode: CalendarViewModePreference };

/** 일정 목록 컨트롤러가 준비한 달력, 검색 결과, 툴바와 모달을 화면에 조합합니다. */
export function ScheduleIndexScreenContent({ initialCalendarViewMode }: Props) {
  const controller = useScheduleIndexController(initialCalendarViewMode);
  const {
    isFocused,
    insets,
    mode,
    colors,
    state,
    modalVisible,
    quickModalVisible,
    addFormsPrewarmed,
    formInitialValues,
    calendarViewMode,
    calendarDepth,
    dayViewMode,
    yearOverviewVisible,
    categoryLoading,
    categoryError,
    scheduleCalendars,
    activeCalendarScope,
    setActiveCalendarScope,
    calendarShareTarget,
    setCalendarShareTarget,
    firstDay,
    calendarScopeSelectorVisible,
    setCalendarScopeSelectorVisible,
    calendarSettingsVisible,
    setCalendarSettingsVisible,
    calendarScrollRequest,
    dayTodayRequest,
    yearTodayRequest,
    yearOverviewPresentationRequest,
    reduceMotionEnabled,
    transitionMonthKey,
    dayModeTransitionFrom,
    isDayTransitionActive,
    isMonthViewTransitionActive,
    todayFocusTarget,
    retainedMonthAgendaPanelKind,
    outgoingMonthAgendaPanelKind,
    monthCalendarAnimatedHeight,
    monthCalendarAnimatedDayHeight,
    detailMonthMotionActive,
    dayModeTransition,
    quickMorphPresenterRef,
    manualMorphPresenterRef,
    selectedDay,
    todayKey,
    calendarDaysByDate,
    scheduleError,
    registerDayDisplayPrepare,
    handleDayPageNavigationActiveChange,
    overviewYear,
    monthDisplaySelectedDay,
    monthDisplayFocusedMonth,
    dayDisplaySelectedDay,
    handleDetailMonthPreview,
    collapsedLiquidToolbarWidth,
    calendarContentTodayOpacity,
    calendarContentTodayTranslateY,
    calendarContentScale,
    monthAgendaIsOpen,
    detailMonthPageLayouts,
    monthAgendaPanelOpacity,
    monthAgendaSwapOutgoingOpacity,
    monthAgendaSwapIncomingOpacity,
    monthCalendarAnimatedStyle,
    monthAgendaSlotAnimatedStyle,
    monthCalendarTargetLayerStyle,
    handleMonthDisplayLayout,
    calendarContentTranslateX,
    yearOverviewTranslateX,
    monthDuringDayTranslateX,
    dayLayerTranslateX,
    usesLiquidViewModeControl,
    addMenuSourceWidth,
    isDayLayerVisible,
    handleAddModalMorphReady,
    handleQuickModalCloseStart,
    handleQuickModalClosed,
    handleScheduleModalClosed,
    calendarOverlayOwnsAccessibility,
    calendarHeaderOffset,
    bottomBarHidden,
    stackBottomContentInset,
    isAnyDepthTransitionActive,
    loadSchedules,
    retryCategoryLoad,
    itemsArray,
    loadYearOverviewSchedules,
    yearOverviewItems,
    writableCategories,
    addItem,
    openCategoryManager,
    handleQuickAnalyze,
    handleVisibleMonthChange,
    handleSelectDay,
    addQuickItem,
    handleSelectDayFromDayDisplay,
    handleShiftDay,
    handleNavigateTodayFromDayDisplay,
    handleOpenScheduleFromDayDisplay,
    handleOpenDay,
    handleTodayFocusReady,
    registerDetailMonthMotionCancel,
    handleDetailMonthMotionActiveChange,
    selectOverviewMonth,
    openCalendarSettingsFromSelector,
    flushPendingCalendarShare,
    openCalendarShareFromSelector,
    updateSharedCalendarContentMode,
    openSharedCalendarManagerFromSelector,
    handleFirstDayChange,
    bottomLeftActions,
    bottomRightActions,
    renderMonthAgendaPanelContent,
  } = controller;
  return (
    <ScheduleRouteFocusBoundary
      focused={isFocused}
      testID="schedule-index-route-root"
      style={[styles.root, { backgroundColor: colors.calendarBackground }]}
    >
      <StatusBar
        barStyle={mode === 'dark' ? 'light-content' : 'dark-content'}
      />

      {categoryError ? (
        <View
          accessibilityElementsHidden={calendarOverlayOwnsAccessibility}
          importantForAccessibility={
            calendarOverlayOwnsAccessibility ? 'no-hide-descendants' : 'auto'
          }
          style={[
            styles.categoryErrorLayer,
            {
              top:
                insets.top +
                LIQUID_TOOLBAR_TOP_OFFSET +
                LIQUID_TOOLBAR_BUTTON_SIZE +
                CALENDAR_CONTEXT_HEIGHT +
                10,
            },
          ]}
        >
          <CategoryLoadErrorBanner
            retrying={categoryLoading}
            onRetry={retryCategoryLoad}
          />
        </View>
      ) : null}

      <View
        pointerEvents="none"
        style={[
          styles.bottomMaterialLayer,
          mode === 'dark'
            ? styles.bottomMaterialLayerDark
            : styles.bottomMaterialLayerLight,
        ]}
      />

      <View
        pointerEvents={isAnyDepthTransitionActive ? 'none' : 'box-none'}
        accessibilityElementsHidden={calendarOverlayOwnsAccessibility}
        importantForAccessibility={
          calendarOverlayOwnsAccessibility ? 'no-hide-descendants' : 'auto'
        }
        style={styles.toolbarLayer}
      >
        <ScheduleIndexCalendarPrimaryLayer controller={controller} />
        <ScheduleIndexCalendarOverlayMenus controller={controller} />
      </View>

      <Animated.View
        accessibilityElementsHidden={calendarOverlayOwnsAccessibility}
        importantForAccessibility={
          calendarOverlayOwnsAccessibility ? 'no-hide-descendants' : 'auto'
        }
        style={[
          styles.calendarContent,
          {
            opacity: calendarContentTodayOpacity,
            transform: [
              { translateX: calendarContentTranslateX },
              { translateY: calendarContentTodayTranslateY },
              { scale: calendarContentScale },
            ],
          },
        ]}
      >
        <View style={styles.displayStack}>
          <Animated.View
            pointerEvents={
              !isAnyDepthTransitionActive &&
              calendarDepth === 'month' &&
              !yearOverviewVisible
                ? 'auto'
                : 'none'
            }
            accessibilityElementsHidden={
              calendarDepth !== 'month' ||
              isAnyDepthTransitionActive ||
              yearOverviewVisible
            }
            importantForAccessibility={
              calendarDepth === 'month' &&
              !isAnyDepthTransitionActive &&
              !yearOverviewVisible
                ? 'auto'
                : 'no-hide-descendants'
            }
            style={[
              styles.monthDisplayLayer,
              {
                backgroundColor: colors.calendarBackground,
                transform: [{ translateX: monthDuringDayTranslateX }],
              },
            ]}
            onLayout={handleMonthDisplayLayout}
          >
            <Reanimated.View
              collapsable={false}
              style={[styles.monthCalendarFrame, monthCalendarAnimatedStyle]}
            >
              <Reanimated.View
                style={[
                  styles.monthCalendarIncomingLayer,
                  monthCalendarTargetLayerStyle,
                ]}
              >
                <View
                  style={[
                    monthAgendaIsOpen
                      ? styles.monthCalendarLayerContentCompact
                      : styles.monthCalendarLayerContentFull,
                  ]}
                >
                  <CalendarWrapper
                    selectedDay={monthDisplaySelectedDay}
                    focusedMonth={monthDisplayFocusedMonth}
                    items={itemsArray}
                    calendarDaysByDate={calendarDaysByDate}
                    onSelectDay={handleSelectDay}
                    onOpenDay={handleOpenDay}
                    viewMode={calendarViewMode}
                    firstDay={firstDay}
                    scrollRequest={calendarScrollRequest}
                    onVisibleMonthChange={handleVisibleMonthChange}
                    headerOffset={calendarHeaderOffset}
                    transitionMonthKey={transitionMonthKey ?? undefined}
                    transitionActive={isAnyDepthTransitionActive}
                    reduceMotionEnabled={reduceMotionEnabled}
                    todayFocusTarget={todayFocusTarget}
                    onTodayFocusReady={handleTodayFocusReady}
                    onRegisterDetailMonthMotionCancel={
                      registerDetailMonthMotionCancel
                    }
                    onDetailMonthPreview={handleDetailMonthPreview}
                    onCommitDetailMonth={handleSelectDay}
                    onDetailMonthMotionActiveChange={
                      handleDetailMonthMotionActiveChange
                    }
                    detailMonthMotionActive={detailMonthMotionActive}
                    animatedCalendarHeight={monthCalendarAnimatedHeight}
                    animatedDayHeight={monthCalendarAnimatedDayHeight}
                    detailMonthPageLayouts={detailMonthPageLayouts}
                    bottomContentInset={stackBottomContentInset}
                  />
                </View>
              </Reanimated.View>
            </Reanimated.View>

            <Reanimated.View
              collapsable={false}
              style={[styles.monthAgendaSlot, monthAgendaSlotAnimatedStyle]}
            >
              <Animated.View
                pointerEvents={
                  monthAgendaIsOpen && !isMonthViewTransitionActive
                    ? 'auto'
                    : 'none'
                }
                accessibilityElementsHidden={
                  !monthAgendaIsOpen || isMonthViewTransitionActive
                }
                importantForAccessibility={
                  monthAgendaIsOpen && !isMonthViewTransitionActive
                    ? 'auto'
                    : 'no-hide-descendants'
                }
                style={[
                  styles.monthAgendaMotion,
                  { opacity: monthAgendaPanelOpacity },
                ]}
              >
                {outgoingMonthAgendaPanelKind && (
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.monthAgendaSwapLayer,
                      { opacity: monthAgendaSwapOutgoingOpacity },
                    ]}
                  >
                    {renderMonthAgendaPanelContent(
                      outgoingMonthAgendaPanelKind,
                    )}
                  </Animated.View>
                )}
                <Animated.View
                  style={[
                    styles.monthAgendaCurrentLayer,
                    outgoingMonthAgendaPanelKind
                      ? { opacity: monthAgendaSwapIncomingOpacity }
                      : null,
                  ]}
                >
                  {renderMonthAgendaPanelContent(retainedMonthAgendaPanelKind)}
                </Animated.View>
              </Animated.View>
            </Reanimated.View>
          </Animated.View>

          {isDayLayerVisible && (
            <Animated.View
              pointerEvents={
                !isAnyDepthTransitionActive && calendarDepth === 'day'
                  ? 'auto'
                  : 'none'
              }
              accessibilityElementsHidden={
                calendarDepth !== 'day' || isAnyDepthTransitionActive
              }
              importantForAccessibility={
                calendarDepth === 'day' && !isAnyDepthTransitionActive
                  ? 'auto'
                  : 'no-hide-descendants'
              }
              style={[
                styles.dayDisplayLayer,
                {
                  backgroundColor: colors.calendarBackground,
                  transform: [{ translateX: dayLayerTranslateX }],
                },
              ]}
            >
              <MemoizedDayDisplay
                selectedDay={dayDisplaySelectedDay}
                firstDay={firstDay}
                dayViewMode={dayViewMode}
                todayKey={todayKey}
                items={itemsArray}
                loading={state.loading}
                error={sanitizeCalendarTransitionError(scheduleError)}
                topOffset={
                  insets.top +
                  DAY_WEEK_STRIP_TOP_OFFSET +
                  CALENDAR_CONTEXT_HEIGHT
                }
                bottomInset={insets.bottom}
                modeTransitionProgress={dayModeTransition}
                modeTransitionFrom={dayModeTransitionFrom}
                transitionActive={isDayTransitionActive}
                todayRequest={dayTodayRequest}
                reduceMotionEnabled={reduceMotionEnabled}
                onPrepareDayReady={registerDayDisplayPrepare}
                onPageNavigationActiveChange={
                  handleDayPageNavigationActiveChange
                }
                onSelectDay={handleSelectDayFromDayDisplay}
                onNavigateToday={handleNavigateTodayFromDayDisplay}
                onShiftDay={handleShiftDay}
                onPressRetry={loadSchedules}
                onOpenSchedule={handleOpenScheduleFromDayDisplay}
              />
            </Animated.View>
          )}
        </View>
      </Animated.View>

      <Animated.View
        pointerEvents={
          yearOverviewVisible && !isAnyDepthTransitionActive ? 'auto' : 'none'
        }
        {...getScheduleAccessibilityVisibility(
          yearOverviewVisible &&
            !isAnyDepthTransitionActive &&
            !calendarOverlayOwnsAccessibility,
        )}
        style={[
          styles.yearOverviewLayer,
          {
            opacity: yearOverviewVisible ? 1 : 0,
            backgroundColor: colors.calendarBackground,
            transform: [{ translateX: yearOverviewTranslateX }],
          },
        ]}
      >
        <CalendarYearOverviewModal
          year={overviewYear}
          selectedDay={selectedDay}
          firstDay={firstDay}
          items={yearOverviewItems}
          topInset={insets.top + CALENDAR_CONTEXT_HEIGHT}
          presentationRequest={yearOverviewPresentationRequest}
          todayRequest={yearTodayRequest}
          reduceMotionEnabled={reduceMotionEnabled}
          onSelectMonth={selectOverviewMonth}
          onVisibleYearChange={loadYearOverviewSchedules}
        />
      </Animated.View>

      {!bottomBarHidden && (
        <GlobalFloatingActionBar
          leftActions={bottomLeftActions}
          rightActions={bottomRightActions}
          bottomInset={insets.bottom}
          disabled={
            isAnyDepthTransitionActive || calendarOverlayOwnsAccessibility
          }
        />
      )}

      <CalendarScopeSheet
        visible={calendarScopeSelectorVisible}
        calendars={scheduleCalendars}
        value={activeCalendarScope}
        onChange={setActiveCalendarScope}
        onShareCalendar={openCalendarShareFromSelector}
        onManage={openSharedCalendarManagerFromSelector}
        onOpenSettings={openCalendarSettingsFromSelector}
        onClose={() => setCalendarScopeSelectorVisible(false)}
        onDismiss={flushPendingCalendarShare}
      />

      <ShareInvitationSheet
        visible={calendarShareTarget !== null}
        resourceType="calendar"
        resourceId={calendarShareTarget?.id.toString()}
        title={calendarShareTarget?.title ?? '공유 캘린더'}
        subtitle={
          calendarShareTarget
            ? calendarShareTarget.defaultContentMode === 'SCHEDULE_AND_TRAVEL'
              ? '일정 + 각자 경로'
              : '일정만'
            : undefined
        }
        initialContentMode={calendarShareTarget?.defaultContentMode}
        onCalendarContentModeChange={updateSharedCalendarContentMode}
        onClose={() => setCalendarShareTarget(null)}
      />

      <CalendarSettingsModal
        visible={calendarSettingsVisible}
        firstDay={firstDay}
        onChangeFirstDay={handleFirstDayChange}
        onClose={() => setCalendarSettingsVisible(false)}
      />

      <MemoizedQuickScheduleModal
        visible={quickModalVisible}
        prewarm={addFormsPrewarmed}
        morphPresenterRef={quickMorphPresenterRef}
        onClose={handleQuickModalClosed}
        onCloseStart={handleQuickModalCloseStart}
        onAnalyze={handleQuickAnalyze}
        onSave={addQuickItem}
        onFeedback={async feedback => {
          await recordQuickScheduleReliabilityFeedbackDurably(feedback);
        }}
        defaultDay={selectedDay}
        defaultCategory={writableCategories[0]}
        categories={writableCategories}
        categoryError={categoryError}
        categoryLoading={categoryLoading}
        onRetryCategories={retryCategoryLoad}
        sourceTopOffset={LIQUID_TOOLBAR_TOP_OFFSET}
        sourceWidth={addMenuSourceWidth}
        sourceHeight={LIQUID_TOOLBAR_ADD_DROPDOWN_HEIGHT}
        closeTargetWidth={collapsedLiquidToolbarWidth}
        sourceRightOffset={
          usesLiquidViewModeControl
            ? ADD_MENU_SOURCE.nativeRightInset
            : ADD_MENU_SOURCE.fallbackRightInset
        }
        onMorphReady={handleAddModalMorphReady}
      />

      <MemoizedScheduleNewModal
        visible={modalVisible}
        prewarm={addFormsPrewarmed}
        morphPresenterRef={manualMorphPresenterRef}
        onClose={handleScheduleModalClosed}
        onCloseStart={handleQuickModalCloseStart}
        onSubmit={addItem}
        categories={writableCategories}
        categoryError={categoryError}
        categoryLoading={categoryLoading}
        onRetryCategories={retryCategoryLoad}
        defaultDay={selectedDay}
        initialValues={formInitialValues}
        onManageCategories={openCategoryManager}
        presentation="morph"
        sourceTopOffset={LIQUID_TOOLBAR_TOP_OFFSET}
        sourceWidth={addMenuSourceWidth}
        sourceHeight={LIQUID_TOOLBAR_ADD_DROPDOWN_HEIGHT}
        closeTargetWidth={collapsedLiquidToolbarWidth}
        sourceRightOffset={
          usesLiquidViewModeControl
            ? ADD_MENU_SOURCE.nativeRightInset
            : ADD_MENU_SOURCE.fallbackRightInset
        }
        onMorphReady={handleAddModalMorphReady}
      />
    </ScheduleRouteFocusBoundary>
  );
}
