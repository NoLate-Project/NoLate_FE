import type { ScheduleCalendar } from '../../api/scheduleCalendars';

let scheduleCalendarMemoryCache: ScheduleCalendar[] | undefined;

export function getCachedScheduleCalendars(): ScheduleCalendar[] | undefined {
  return scheduleCalendarMemoryCache
    ? scheduleCalendarMemoryCache.map(calendar => ({ ...calendar }))
    : undefined;
}

export function setScheduleCalendarMemoryCache(calendars: ScheduleCalendar[]) {
  scheduleCalendarMemoryCache = calendars.map(calendar => ({ ...calendar }));
}

export function replaceCachedScheduleCalendar(next: ScheduleCalendar) {
  if (!scheduleCalendarMemoryCache) return;
  const index = scheduleCalendarMemoryCache.findIndex(
    calendar => calendar.id === next.id,
  );
  scheduleCalendarMemoryCache =
    index >= 0
      ? scheduleCalendarMemoryCache.map(calendar =>
          calendar.id === next.id ? next : calendar,
        )
      : [...scheduleCalendarMemoryCache, next];
}

export function removeCachedScheduleCalendar(calendarId: number) {
  scheduleCalendarMemoryCache = scheduleCalendarMemoryCache?.filter(
    calendar => calendar.id !== calendarId,
  );
}

export function updateCachedScheduleCalendarReminder(
  calendarId: number,
  routeReminderEnabled: boolean,
) {
  if (!scheduleCalendarMemoryCache) return;
  scheduleCalendarMemoryCache = scheduleCalendarMemoryCache.map(calendar =>
    calendar.id === calendarId
      ? { ...calendar, routeReminderEnabled }
      : calendar,
  );
}

export function clearScheduleCalendarMemoryCache() {
  scheduleCalendarMemoryCache = undefined;
}
