import { startOfDay } from '../../../../lib/util/data';
import { getMonthRange } from '../calendarRange';
import { shiftCalendarMonth } from '../calendarNavigation';
import {
  prefetchesAdjacentMonths,
  type CalendarViewMode,
} from '../components/calendar/viewMode';
import { buildShareAttentionSummary } from '../../share/shareAttention';

export type CalendarDepth = 'year' | 'month' | 'day';
export type DayViewMode = 'singleDay' | 'multiDay';

export type TodayFocusTarget = {
  day: string;
  requiresMonthChange: boolean;
};

export type CalendarDay = {
  dateString: string;
  day: number;
  weekday: string;
  month: number;
};

export const STACK_MONTH_FETCH_COALESCE_MS = 160;
export const CALENDAR_FIRST_DAY_STORAGE_KEY = '@nolate/calendar/first-day';
export const EMPTY_SHARE_ATTENTION = buildShareAttentionSummary({
  pendingInvitations: [],
  receivedShares: [],
});

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** API 또는 런타임 오류를 일정 화면에 노출할 수 있는 사용자 메시지로 변환한다. */
export function getScheduleIndexErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : '요청 처리에 실패했습니다.';

  if (/403|forbidden/i.test(message)) {
    return '일정을 불러오지 못했습니다';
  }

  if (/network|timeout/i.test(message)) {
    return '네트워크 상태를 확인한 뒤 다시 시도해 주세요';
  }

  return message;
}

/** 달력 전환 표면에 표시할 서버 오류 문구에서 기술적인 상태 표현을 정리한다. */
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

/** 달력 일정 패널이 받을 오류 값을 사용자 메시지 또는 null로 정규화한다. */
export function sanitizeCalendarTransitionError(error?: string | null) {
  return getCalendarErrorMessage(error) ?? null;
}

/** Date를 로컬 시간 기준 YYYY-MM-DD 문자열로 직렬화한다. */
function toDateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(date.getDate()).padStart(2, '0')}`;
}

/** YYYY-MM-DD 날짜에 일 단위 오프셋을 적용하고 같은 형식으로 반환한다. */
export function addDaysToYmd(ymd: string, offset: number) {
  const date = new Date(`${ymd}T00:00:00`);
  date.setDate(date.getDate() + offset);
  return toDateString(date);
}

/** 시작 날짜부터 지정한 개수만큼 연속된 일간 화면 표시 모델을 만든다. */
export function createSequentialDays(
  startYmd: string,
  count: number,
): CalendarDay[] {
  const start = new Date(`${startYmd}T00:00:00`);

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);

    return {
      dateString: toDateString(date),
      day: date.getDate(),
      weekday: WEEKDAYS[date.getDay()],
      month: date.getMonth() + 1,
    };
  });
}

/**
 * 현재 달력 깊이와 보기 모드가 화면에 노출할 모든 날짜를 포함하도록 조회 범위를
 * 계산한다. 연속 월 보기에는 인접 월을, 다중 일 보기에는 마지막 날짜의 종료 시각을
 * 추가해 스크롤 직후 재조회 없이 일정을 표시할 수 있게 한다.
 */
export function getScheduleFetchRange(
  visibleMonth: string,
  selectedDay: string,
  calendarDepth: CalendarDepth,
  dayViewMode: DayViewMode,
  calendarViewMode: CalendarViewMode,
) {
  const monthRange = getMonthRange(visibleMonth);
  const startTimes = [new Date(monthRange.startAt).getTime()];
  const endTimes = [new Date(monthRange.endAt).getTime()];

  if (calendarDepth === 'month' && prefetchesAdjacentMonths(calendarViewMode)) {
    const previousMonthRange = getMonthRange(
      shiftCalendarMonth(visibleMonth, -2),
    );
    const nextMonthRange = getMonthRange(shiftCalendarMonth(visibleMonth, 2));
    startTimes.push(new Date(previousMonthRange.startAt).getTime());
    endTimes.push(new Date(nextMonthRange.endAt).getTime());
  }

  if (calendarDepth === 'day') {
    const visibleDays =
      dayViewMode === 'multiDay'
        ? createSequentialDays(selectedDay, 2).map(day => day.dateString)
        : [selectedDay];
    const firstDay = visibleDays[0] ?? selectedDay;
    const lastDay = visibleDays[visibleDays.length - 1] ?? selectedDay;
    const dayStart = startOfDay(firstDay);
    const dayEnd = startOfDay(addDaysToYmd(lastDay, 1));
    dayEnd.setMilliseconds(dayEnd.getMilliseconds() - 1);

    startTimes.push(dayStart.getTime());
    endTimes.push(dayEnd.getTime());
  }

  return {
    startAt: new Date(Math.min(...startTimes)).toISOString(),
    endAt: new Date(Math.max(...endTimes)).toISOString(),
  };
}
