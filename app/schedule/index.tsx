import { useEffect, useState } from 'react';
import {
  DEFAULT_CALENDAR_VIEW_MODE,
  type CalendarViewModePreference,
} from '../../src/modules/schedule/components/calendar/viewMode';
import {
  getCachedCalendarViewModePreference,
  loadCalendarViewModePreference,
} from '../../src/modules/schedule/components/calendar/calendarViewModePreference';
import { ScheduleIndexScreenContent } from '../../src/modules/schedule/components/list/ScheduleIndexScreenContent';

export default function ScheduleIndex() {
  const [initialCalendarViewMode, setInitialCalendarViewMode] =
    useState<CalendarViewModePreference>(() =>
      getCachedCalendarViewModePreference() ?? DEFAULT_CALENDAR_VIEW_MODE,
    );

  useEffect(() => {
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
  }, []);

  return (
    <ScheduleIndexScreenContent
      initialCalendarViewMode={initialCalendarViewMode}
    />
  );
}
