import { useMemo } from 'react';
import { Animated, type ViewStyle } from 'react-native';
import {
  getPrimaryPillWeekdayGap,
  showsStickyMonthTitle as shouldShowStickyMonthTitle,
  type CalendarViewMode,
} from '../components/calendar/viewMode';
import { getFloatingActionBarClearance } from '../components/shared/floatingActionBarLayout';
import type { MonthAgendaPanelKind } from '../calendarMotion';
import type { ToolbarMenu } from './useScheduleIndexToolbarActions';

type CalendarDepth = 'year' | 'month' | 'day';

const CALENDAR_TOOLBAR_HEIGHT = 56;
const CALENDAR_CONTEXT_HEIGHT = 24;
const STICKY_MONTH_HEADER_HEIGHT = 50;
const STICKY_WEEKDAY_HEADER_HEIGHT = 18;
const STICKY_CALENDAR_HEADER_HEIGHT =
  STICKY_MONTH_HEADER_HEIGHT + STICKY_WEEKDAY_HEADER_HEIGHT;
const LIQUID_TOOLBAR_ACTIONS_WIDTH = 150;
const SEARCH_FIELD_REVEAL_START_PROGRESS = 0.28;

/** 보기 모드에 따라 고정 월 제목과 요일 행이 차지할 높이를 반환한다. */
function getStickyCalendarHeaderHeight(viewMode: CalendarViewMode): number {
  return shouldShowStickyMonthTitle(viewMode)
    ? STICKY_CALENDAR_HEADER_HEIGHT
    : STICKY_WEEKDAY_HEADER_HEIGHT + getPrimaryPillWeekdayGap(viewMode);
}

type UseScheduleIndexToolbarPresentationParams = {
  activeToolbarMenu: ToolbarMenu | null;
  bottomInset: number;
  calendarDepth: CalendarDepth;
  calendarOverlayVisible: boolean;
  calendarViewMode: CalendarViewMode;
  firstDay: 0 | 1;
  isDarkMode: boolean;
  isDayToMonthTransition: boolean;
  isDayTransitionActive: boolean;
  isFocused: boolean;
  isMonthToDayTransition: boolean;
  isMonthToYearTransition: boolean;
  isMonthViewTransitionActive: boolean;
  isTodayFocusTransitionActive: boolean;
  isYearDepthTransitionActive: boolean;
  keyboardVisible: boolean;
  monthAgendaIsOpen: boolean;
  monthCalendarTransitionProgress: Animated.Value;
  outgoingMonthAgendaPanelKind: MonthAgendaPanelKind | null;
  primaryPillVisible: boolean;
  retainedMonthAgendaPanelKind: MonthAgendaPanelKind;
  searchHeaderTargetWidth: number;
  searchToolbarProgress: Animated.Value;
  textPrimaryColor: string;
  todayFocusOpacity: Animated.Value;
  toolbarDropdownProgress: Animated.Value;
  topInset: number;
  visibleMonth: string;
  yearOverviewClosing: boolean;
  yearOverviewVisible: boolean;
};

/**
 * 드롭다운·검색 툴바 애니메이션 값과 고정 월 헤더 표시 조건을 계산한다.
 * 접근성 소유권과 하단 바 여백까지 같은 화면 상태에서 파생해 렌더러가 서로 다른
 * 조건식을 중복 구현하지 않도록 한다.
 */
export function useScheduleIndexToolbarPresentation({
  activeToolbarMenu,
  bottomInset,
  calendarDepth,
  calendarOverlayVisible,
  calendarViewMode,
  firstDay,
  isDarkMode,
  isDayToMonthTransition,
  isDayTransitionActive,
  isFocused,
  isMonthToDayTransition,
  isMonthToYearTransition,
  isMonthViewTransitionActive,
  isTodayFocusTransitionActive,
  isYearDepthTransitionActive,
  keyboardVisible,
  monthAgendaIsOpen,
  monthCalendarTransitionProgress,
  outgoingMonthAgendaPanelKind,
  primaryPillVisible,
  retainedMonthAgendaPanelKind,
  searchHeaderTargetWidth,
  searchToolbarProgress,
  textPrimaryColor,
  todayFocusOpacity,
  toolbarDropdownProgress,
  topInset,
  visibleMonth,
  yearOverviewClosing,
  yearOverviewVisible,
}: UseScheduleIndexToolbarPresentationParams) {
  const dropdownScaleX = toolbarDropdownProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.68, 1],
  });
  const dropdownScaleY = toolbarDropdownProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.2, 1],
  });
  const dropdownTranslateY = toolbarDropdownProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-4, 0],
  });
  const viewDropdownScaleX = toolbarDropdownProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1],
  });
  const viewDropdownScaleY = toolbarDropdownProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.86, 1],
  });
  const viewDropdownTranslateY = toolbarDropdownProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-8, 0],
  });
  const searchHeaderWidth = searchToolbarProgress.interpolate({
    inputRange: [0, 0.1, 1],
    outputRange: [
      LIQUID_TOOLBAR_ACTIONS_WIDTH,
      LIQUID_TOOLBAR_ACTIONS_WIDTH,
      searchHeaderTargetWidth,
    ],
  });
  const searchMorphSeedOpacity = searchToolbarProgress.interpolate({
    inputRange: [0, 0.48, 0.78, 1],
    outputRange: [1, 0.94, 0.16, 0],
    extrapolate: 'clamp',
  });
  const searchMorphSeedScale = searchToolbarProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1],
  });
  const searchFieldContentOpacity = searchToolbarProgress.interpolate({
    inputRange: [0, SEARCH_FIELD_REVEAL_START_PROGRESS, 1],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
  });
  const searchFieldContentTranslateX = searchToolbarProgress.interpolate({
    inputRange: [0, SEARCH_FIELD_REVEAL_START_PROGRESS, 1],
    outputRange: [6, 6, 0],
    extrapolate: 'clamp',
  });
  const searchFieldContentTranslateY = searchToolbarProgress.interpolate({
    inputRange: [0, SEARCH_FIELD_REVEAL_START_PROGRESS, 1],
    outputRange: [3, 3, 0],
    extrapolate: 'clamp',
  });
  const dropdownOpacity = toolbarDropdownProgress.interpolate({
    inputRange: [0, 0.32, 1],
    outputRange: [0, 0.86, 1],
  });
  const viewDropdownOpacity = toolbarDropdownProgress.interpolate({
    inputRange: [0, 0.18, 1],
    outputRange: [0, 0.92, 1],
  });
  const stickyWeekdayItems = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const weekdayIndex = (firstDay + index) % 7;
        return {
          label: ['일', '월', '화', '수', '목', '금', '토'][weekdayIndex],
          isWeekend: weekdayIndex === 0 || weekdayIndex === 6,
        };
      }),
    [firstDay],
  );
  const stickyCalendarHeaderPosition = useMemo<ViewStyle>(
    () => ({
      top: topInset + CALENDAR_TOOLBAR_HEIGHT + CALENDAR_CONTEXT_HEIGHT,
    }),
    [topInset],
  );
  const showsStickyMonthTitle = shouldShowStickyMonthTitle(calendarViewMode);
  const primaryPillWeekdayGap = getPrimaryPillWeekdayGap(calendarViewMode);
  const reservedStickyCalendarHeaderHeight =
    getStickyCalendarHeaderHeight(calendarViewMode);
  const isStickyCalendarMode =
    calendarViewMode === 'stack' ||
    calendarViewMode === 'detail' ||
    calendarViewMode === 'list';
  const nonSearchToolbarMenuActive =
    activeToolbarMenu !== null && activeToolbarMenu !== 'search';
  const isFormOverlayVisible = calendarOverlayVisible;
  const calendarOverlayOwnsAccessibility = calendarOverlayVisible;
  const reservesStickyCalendarHeader =
    isStickyCalendarMode &&
    (calendarDepth !== 'day' ||
      isMonthToDayTransition ||
      isDayToMonthTransition) &&
    (!keyboardVisible || isFormOverlayVisible);
  const isEnteringMonthCalendarFromExpandedList =
    isMonthViewTransitionActive &&
    calendarViewMode !== 'list' &&
    (outgoingMonthAgendaPanelKind === 'list' ||
      (!monthAgendaIsOpen && retainedMonthAgendaPanelKind === 'list'));
  const showsStickyCalendarHeader =
    reservesStickyCalendarHeader &&
    (calendarViewMode !== 'list' || isMonthViewTransitionActive) &&
    !nonSearchToolbarMenuActive &&
    (!yearOverviewVisible || yearOverviewClosing || isMonthToYearTransition);
  const stickyCalendarHeaderOpacity =
    isMonthViewTransitionActive && calendarViewMode === 'list'
      ? monthCalendarTransitionProgress.interpolate({
          inputRange: [0, 0.65, 1],
          outputRange: [1, 0, 0],
          extrapolate: 'clamp',
        })
      : isEnteringMonthCalendarFromExpandedList
      ? monthCalendarTransitionProgress.interpolate({
          inputRange: [0, 0.25, 1],
          outputRange: [0, 0, 1],
          extrapolate: 'clamp',
        })
      : 1;
  const stickyCalendarHeaderTodayOpacity = Animated.multiply(
    stickyCalendarHeaderOpacity,
    todayFocusOpacity,
  );
  const calendarHeaderOffset = useMemo(
    () =>
      topInset +
      CALENDAR_TOOLBAR_HEIGHT +
      CALENDAR_CONTEXT_HEIGHT +
      (reservesStickyCalendarHeader ? reservedStickyCalendarHeaderHeight : 0),
    [topInset, reservedStickyCalendarHeaderHeight, reservesStickyCalendarHeader],
  );
  const stickyMonthTitle = `${Number(visibleMonth.slice(5, 7))}월`;
  const stickyMonthColorStyle = { color: textPrimaryColor };
  const stickyWeekdayColor = isDarkMode ? '#FFFFFF' : '#111113';
  const stickyWeekendColor = isDarkMode
    ? 'rgba(238,238,244,0.98)'
    : 'rgba(68,68,76,0.96)';
  const stickyWeekdayBorderColor = isDarkMode
    ? 'rgba(255,255,255,0.08)'
    : 'rgba(0,0,0,0.08)';
  const bottomBarHidden = !isFocused || keyboardVisible;
  const stackBottomContentInset = bottomBarHidden
    ? 0
    : getFloatingActionBarClearance(bottomInset);
  const isAnyDepthTransitionActive =
    isDayTransitionActive ||
    isYearDepthTransitionActive ||
    isMonthViewTransitionActive ||
    isTodayFocusTransitionActive;
  const primaryPillInteractionEnabled =
    primaryPillVisible && !isAnyDepthTransitionActive;

  return {
    bottomBarHidden,
    calendarHeaderOffset,
    calendarOverlayOwnsAccessibility,
    dropdownOpacity,
    dropdownScaleX,
    dropdownScaleY,
    dropdownTranslateY,
    isAnyDepthTransitionActive,
    primaryPillInteractionEnabled,
    primaryPillWeekdayGap,
    reservedStickyCalendarHeaderHeight,
    searchFieldContentOpacity,
    searchFieldContentTranslateX,
    searchFieldContentTranslateY,
    searchHeaderWidth,
    searchMorphSeedOpacity,
    searchMorphSeedScale,
    showsStickyCalendarHeader,
    showsStickyMonthTitle,
    stackBottomContentInset,
    stickyCalendarHeaderPosition,
    stickyCalendarHeaderTodayOpacity,
    stickyMonthColorStyle,
    stickyMonthTitle,
    stickyWeekdayBorderColor,
    stickyWeekdayColor,
    stickyWeekdayItems,
    stickyWeekendColor,
    viewDropdownOpacity,
    viewDropdownScaleX,
    viewDropdownScaleY,
    viewDropdownTranslateY,
  };
}
