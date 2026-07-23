export type CalendarHoliday = {
    name: string;
    type: string;
};

export type CalendarDayMetadata = {
    date: string;
    lunarYear?: number;
    lunarMonth?: number;
    lunarDay?: number;
    leapMonth?: boolean;
    holidays: CalendarHoliday[];
};

export type CalendarMetadataRange = {
    startDate: string;
    endDate: string;
};

function toDateString(date: Date): string {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
    ].join("-");
}

/** 월간 달력에 노출되는 앞뒤 주의 날짜까지 포함한다. */
export function getCalendarMetadataRange(
    month: string,
    firstDay: 0 | 1
): CalendarMetadataRange {
    const [yearText, monthText] = month.slice(0, 7).split("-");
    const year = Number(yearText);
    const monthIndex = Number(monthText) - 1;
    const now = new Date();
    const safeYear = Number.isFinite(year) ? year : now.getFullYear();
    const safeMonthIndex = Number.isFinite(monthIndex) && monthIndex >= 0 && monthIndex <= 11
        ? monthIndex
        : now.getMonth();
    const monthStart = new Date(safeYear, safeMonthIndex, 1);
    const monthEnd = new Date(safeYear, safeMonthIndex + 1, 0);
    const startDate = new Date(monthStart);
    const endDate = new Date(monthEnd);

    startDate.setDate(
        monthStart.getDate() - ((monthStart.getDay() - firstDay + 7) % 7)
    );
    endDate.setDate(
        monthEnd.getDate() + ((firstDay + 6 - monthEnd.getDay() + 7) % 7)
    );

    return {
        startDate: toDateString(startDate),
        endDate: toDateString(endDate),
    };
}

export function indexCalendarDays(
    days: CalendarDayMetadata[]
): Record<string, CalendarDayMetadata> {
    return Object.fromEntries(days.map((day) => [day.date, day]));
}

export function formatLunarCalendarDay(
    day?: CalendarDayMetadata
): string | null {
    if (!day?.lunarMonth || !day.lunarDay) return null;
    return day.leapMonth
        ? `음 윤${day.lunarMonth}.${day.lunarDay}`
        : `음 ${day.lunarMonth}.${day.lunarDay}`;
}

