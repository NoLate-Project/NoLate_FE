import {
  useCallback,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { Animated } from 'react-native';
import { isLiquidCalendarMenuPrototypeAvailable } from '../components/calendar/LiquidCalendarMenuPrototype';
import { CALENDAR_PILL_MOTION } from '../calendarMotion';
import { ADD_MENU_SOURCE } from '../addHandoffMotion';
import type { ToolbarMenu } from './useScheduleIndexToolbarActions';

type CalendarDepth = 'year' | 'month' | 'day';

const LIQUID_TOOLBAR_BUTTON_SIZE = 44;
const LIQUID_TOOLBAR_SEARCH_HEIGHT = 52;
const LIQUID_TOOLBAR_SLOT_WIDTH = 50;
const LIQUID_TOOLBAR_ACTIONS_WIDTH = LIQUID_TOOLBAR_SLOT_WIDTH * 3;
const LIQUID_TOOLBAR_ADD_DROPDOWN_WIDTH = ADD_MENU_SOURCE.nativeWidth;
const LIQUID_TOOLBAR_CONTROL_CANVAS_HEIGHT = 260;
const LIQUID_TOOLBAR_TOP_OFFSET = 4;
const SEARCH_TOOLBAR_LEFT_INSET = 16;

type UseScheduleIndexTransitionStylesParams = {
  activeToolbarMenu: ToolbarMenu | null;
  calendarDepth: CalendarDepth;
  dayLayerMounted: boolean;
  dayTransition: Animated.Value;
  insetsTop: number;
  isDayTransitionActive: boolean;
  liquidPrototypeOpen: boolean;
  reduceMotionEnabled: boolean;
  screenWidth: number;
  setPrototypeCloseRequest: Dispatch<SetStateAction<number>>;
  todayFocusOpacity: Animated.Value;
  yearOverviewProgress: Animated.Value;
};

/**
 * 달력 깊이 이동과 플로팅 툴바에 필요한 Animated 값 및 화면 치수를 계산한다.
 * 화면 폭·안전 영역·현재 메뉴를 한 번에 반영해 뷰 계층이 좌표 계산식을 직접
 * 소유하지 않도록 한다.
 */
export function useScheduleIndexTransitionStyles({
  activeToolbarMenu,
  calendarDepth,
  dayLayerMounted,
  dayTransition,
  insetsTop,
  isDayTransitionActive,
  liquidPrototypeOpen,
  reduceMotionEnabled,
  screenWidth,
  setPrototypeCloseRequest,
  todayFocusOpacity,
  yearOverviewProgress,
}: UseScheduleIndexTransitionStylesParams) {
  const dayPillBloomScaleX = dayTransition.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, CALENDAR_PILL_MOTION.bloomScaleX, 1],
  });
  const dayPillBloomScaleY = dayTransition.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, CALENDAR_PILL_MOTION.bloomScaleY, 1],
  });
  const primaryPillScaleX = reduceMotionEnabled ? 1 : dayPillBloomScaleX;
  const primaryPillScaleY = reduceMotionEnabled ? 1 : dayPillBloomScaleY;
  const primaryPillOpacity = yearOverviewProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const primaryPillTodayOpacity = Animated.multiply(
    primaryPillOpacity,
    todayFocusOpacity,
  );
  const primaryPillYearTranslateX = reduceMotionEnabled
    ? 0
    : yearOverviewProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, CALENDAR_PILL_MOTION.yearHiddenTranslateX],
        extrapolate: 'clamp',
      });
  const primaryPillYearScale = reduceMotionEnabled
    ? 1
    : yearOverviewProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, CALENDAR_PILL_MOTION.yearHiddenScale],
        extrapolate: 'clamp',
      });
  const calendarContentTranslateX = yearOverviewProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, screenWidth],
  });
  const yearOverviewTranslateX = yearOverviewProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-screenWidth, 0],
  });
  const monthDuringDayTranslateX = dayTransition.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -screenWidth],
  });
  const dayLayerTranslateX = dayTransition.interpolate({
    inputRange: [0, 1],
    outputRange: [screenWidth, 0],
  });
  const monthChromeTranslateX = Animated.add(
    calendarContentTranslateX,
    monthDuringDayTranslateX,
  );
  const dropdownMaxWidth = Math.max(0, screenWidth - 32);
  const dropdownWidth =
    activeToolbarMenu === 'add'
      ? Math.min(dropdownMaxWidth, 196)
      : activeToolbarMenu === 'view'
      ? Math.min(dropdownMaxWidth, 210)
      : Math.min(dropdownMaxWidth, 224);
  const toolbarDropdownTop =
    calendarDepth === 'day'
      ? insetsTop + LIQUID_TOOLBAR_TOP_OFFSET + LIQUID_TOOLBAR_BUTTON_SIZE + 10
      : insetsTop + 7;
  const usesLiquidViewModeControl = isLiquidCalendarMenuPrototypeAvailable;
  const addMenuSourceWidth = usesLiquidViewModeControl
    ? LIQUID_TOOLBAR_ADD_DROPDOWN_WIDTH
    : ADD_MENU_SOURCE.fallbackWidth;
  const isDayLayerVisible =
    calendarDepth === 'day' || dayLayerMounted || isDayTransitionActive;
  const actionDropdownRight = 16;
  const isSearchToolbarOpen = activeToolbarMenu === 'search';
  const searchHeaderRightInset = usesLiquidViewModeControl
    ? ADD_MENU_SOURCE.nativeRightInset
    : ADD_MENU_SOURCE.fallbackRightInset;
  const searchHeaderTargetWidth = Math.max(
    LIQUID_TOOLBAR_ACTIONS_WIDTH,
    screenWidth - SEARCH_TOOLBAR_LEFT_INSET - searchHeaderRightInset,
  );

  // 접힌 상태에서도 네이티브 검색 너비는 준비해 두되 호스트 높이는 검색 바만큼만
  // 유지한다. 투명한 전체 높이 Fabric 호스트가 달력 셀 터치를 가로채는 것을 막는다.
  const liquidPrototypeLayerWidth = searchHeaderTargetWidth;
  const liquidPrototypeLayerHeight = liquidPrototypeOpen
    ? LIQUID_TOOLBAR_CONTROL_CANVAS_HEIGHT
    : LIQUID_TOOLBAR_SEARCH_HEIGHT;

  /**
   * 네이티브 액체형 메뉴에 닫기 요청 세대를 전달한다.
   * Swift 쪽 닫힘 모핑이 끝난 뒤 JS 호스트가 줄어들 수 있도록 직접 상태를 닫지 않는다.
   */
  const requestCloseLiquidPrototype = useCallback(() => {
    if (!usesLiquidViewModeControl) return;
    setPrototypeCloseRequest(value => value + 1);
  }, [setPrototypeCloseRequest, usesLiquidViewModeControl]);

  return {
    actionDropdownRight,
    addMenuSourceWidth,
    calendarContentTranslateX,
    dayLayerTranslateX,
    dropdownWidth,
    isDayLayerVisible,
    isSearchToolbarOpen,
    liquidPrototypeLayerHeight,
    liquidPrototypeLayerWidth,
    monthChromeTranslateX,
    monthDuringDayTranslateX,
    primaryPillScaleX,
    primaryPillScaleY,
    primaryPillTodayOpacity,
    primaryPillYearScale,
    primaryPillYearTranslateX,
    requestCloseLiquidPrototype,
    searchHeaderRightInset,
    searchHeaderTargetWidth,
    toolbarDropdownTop,
    usesLiquidViewModeControl,
    yearOverviewTranslateX,
  };
}
