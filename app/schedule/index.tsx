import { DEFAULT_CALENDAR_VIEW_MODE } from '../../src/modules/schedule/components/calendar/viewMode';
import { getCachedCalendarViewModePreference } from '../../src/modules/schedule/components/calendar/calendarViewModePreference';
import { ScheduleIndexScreenContent } from '../../src/modules/schedule/components/list/ScheduleIndexScreenContent';
import { useScreenFirstPaintPerformance } from '../../src/modules/performance/useScreenFirstPaintPerformance';

export default function ScheduleIndex() {
  useScreenFirstPaintPerformance('/schedule');
  const initialCalendarViewMode =
    getCachedCalendarViewModePreference() ?? DEFAULT_CALENDAR_VIEW_MODE;

  return (
    <ScheduleIndexScreenContent
      initialCalendarViewMode={initialCalendarViewMode}
    />
  );
}
