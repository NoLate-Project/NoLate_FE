import { createScheduleIndexStyles } from '../../src/routeSupport/schedule/index.styles';
import { useEffect, useState } from 'react';
import { StatusBar } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import ScheduleRouteFocusBoundary from '../../src/modules/schedule/components/ScheduleRouteFocusBoundary';
import {
  DEFAULT_CALENDAR_VIEW_MODE,
  type CalendarViewModePreference,
} from '../../src/modules/schedule/components/calendar/viewMode';
import {
  getCachedCalendarViewModePreference,
  loadCalendarViewModePreference,
} from '../../src/modules/schedule/components/calendar/calendarViewModePreference';
import { useTheme } from '../../src/modules/theme/ThemeContext';
import {
  DAY_MINUTES,
  DAY_TIMELINE_END_PADDING,
  DAY_TIMELINE_HOUR_HEIGHT,
} from '../../src/modules/schedule/dayTimelineLayout';
import { CALENDAR_PRIMARY_PILL_LAYOUT } from '../../src/modules/schedule/calendarMotion';

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
import { ScheduleIndexScreenContent } from '../../src/modules/schedule/components/list/ScheduleIndexScreenContent';

export default function ScheduleIndex() {
  const isFocused = useIsFocused();
  const { mode, colors } = useTheme();
  const [initialCalendarViewMode, setInitialCalendarViewMode] =
    useState<CalendarViewModePreference | null>(() =>
      getCachedCalendarViewModePreference(),
    );

  useEffect(() => {
    if (initialCalendarViewMode) return;

    let cancelled = false;
    loadCalendarViewModePreference()
      .then(restoredMode => {
        if (!cancelled) setInitialCalendarViewMode(restoredMode);
      })
      .catch(() => {
        if (!cancelled) {
          setInitialCalendarViewMode(DEFAULT_CALENDAR_VIEW_MODE);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialCalendarViewMode]);

  if (!initialCalendarViewMode) {
    return (
      <ScheduleRouteFocusBoundary
        focused={isFocused}
        testID="schedule-index-route-root"
        style={[styles.root, { backgroundColor: colors.calendarBackground }]}
      >
        <StatusBar
          barStyle={mode === 'dark' ? 'light-content' : 'dark-content'}
        />
      </ScheduleRouteFocusBoundary>
    );
  }

  return (
    <ScheduleIndexScreenContent
      initialCalendarViewMode={initialCalendarViewMode}
    />
  );
}
