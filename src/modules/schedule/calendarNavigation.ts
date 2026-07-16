function padCalendarPart(value: number): string {
    return String(value).padStart(2, "0");
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
