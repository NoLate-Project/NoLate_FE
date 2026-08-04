function padCalendarPart(value: number): string {
    return String(value).padStart(2, "0");
}

export type CalendarFirstDay = 0 | 1;

/** 날짜/월 값을 월 단위 상태에 사용할 수 있는 해당 월 1일로 정규화한다. */
export function getCalendarMonthAnchor(dayOrMonth: string): string {
    const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(dayOrMonth);
    if (!match) return dayOrMonth;

    const month = Number(match[2]);
    if (month < 1 || month > 12) return dayOrMonth;

    return `${match[1]}-${match[2]}-01`;
}

function parseLocalCalendarDay(day: string): Date | null {
    const [yearText, monthText, dayText] = day.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const date = Number(dayText);
    if (![year, month, date].every(Number.isFinite)) return null;

    const parsed = new Date(year, month - 1, date);
    if (
        parsed.getFullYear() !== year ||
        parsed.getMonth() !== month - 1 ||
        parsed.getDate() !== date
    ) return null;

    return parsed;
}

/** 사용자가 선택한 주 시작 요일(일/월)에 맞는 주의 첫 날짜를 반환한다. */
export function getCalendarWeekStart(
    day: string,
    firstDay: CalendarFirstDay
): string {
    const date = parseLocalCalendarDay(day);
    if (!date) return day;

    const weekdayIndex = (date.getDay() - firstDay + 7) % 7;
    date.setDate(date.getDate() - weekdayIndex);
    return [
        date.getFullYear(),
        padCalendarPart(date.getMonth() + 1),
        padCalendarPart(date.getDate()),
    ].join("-");
}

/** 주 시작 요일을 기준으로 날짜가 주간 스트립의 몇 번째 칸인지 반환한다. */
export function getCalendarWeekdayIndex(
    day: string,
    firstDay: CalendarFirstDay
): number {
    const date = parseLocalCalendarDay(day);
    if (!date) return 0;
    return (date.getDay() - firstDay + 7) % 7;
}

/** 저장된 일정이 보이도록 기기 현지 시각 기준의 캘린더 날짜를 반환한다. */
export function getScheduleFocusDay(startAt: string): string | null {
    const date = new Date(startAt);
    if (!Number.isFinite(date.getTime())) return null;

    return [
        date.getFullYear(),
        padCalendarPart(date.getMonth() + 1),
        padCalendarPart(date.getDate()),
    ].join("-");
}

/** 현재 일자를 최대한 유지하면서 월을 이동하고, 짧은 달에서는 말일로 보정한다. */
export function shiftCalendarMonth(day: string, offset: number): string {
    const [yearText, monthText, dayText] = day.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const preferredDay = Number(dayText) || 1;
    const normalizedOffset = Number.isFinite(offset) ? Math.trunc(offset) : 0;

    if (!Number.isFinite(year) || !Number.isFinite(month)) return day;

    const targetMonth = new Date(year, month - 1 + normalizedOffset, 1);
    const targetYear = targetMonth.getFullYear();
    const targetMonthNumber = targetMonth.getMonth() + 1;
    const lastDay = new Date(targetYear, targetMonthNumber, 0).getDate();
    const targetDay = Math.min(Math.max(1, preferredDay), lastDay);

    return `${targetYear}-${padCalendarPart(targetMonthNumber)}-${padCalendarPart(targetDay)}`;
}

/** 연 보기에서 오늘이 속한 월 행을 상단 캘린더 chrome 바로 아래에 맞춘다. */
export function getYearTodayScrollOffset(
    yearOffset: number,
    monthGridOffset: number,
    monthOffset: number,
    contentTopPadding: number
): number | null {
    if (![yearOffset, monthGridOffset, monthOffset, contentTopPadding].every(Number.isFinite)) {
        return null;
    }

    return Math.max(0, yearOffset + monthGridOffset + monthOffset - contentTopPadding);
}
