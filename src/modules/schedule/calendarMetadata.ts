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
    metadataComplete?: boolean;
};

export type CalendarMetadataRange = {
    startDate: string;
    endDate: string;
};

function toMonthKey(date: Date): string {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
    ].join("-");
}

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

/** 현재 월을 열기 전에 달력 pager의 이전·현재·다음 월 메타데이터를 준비한다. */
export function getCalendarMetadataPrefetchMonthKeys(month: string): string[] {
    const [yearText, monthText] = month.slice(0, 7).split("-");
    const year = Number(yearText);
    const monthIndex = Number(monthText) - 1;
    const now = new Date();
    const safeYear = Number.isFinite(year) ? year : now.getFullYear();
    const safeMonthIndex = Number.isFinite(monthIndex) && monthIndex >= 0 && monthIndex <= 11
        ? monthIndex
        : now.getMonth();

    return [-1, 0, 1].map((delta) => (
        toMonthKey(new Date(safeYear, safeMonthIndex + delta, 1))
    ));
}

export function getCalendarMetadataPrefetchRange(
    month: string,
    firstDay: 0 | 1
): CalendarMetadataRange {
    const monthKeys = getCalendarMetadataPrefetchMonthKeys(month);
    const firstRange = getCalendarMetadataRange(monthKeys[0] ?? month, firstDay);
    const lastRange = getCalendarMetadataRange(
        monthKeys[monthKeys.length - 1] ?? month,
        firstDay
    );

    return {
        startDate: firstRange.startDate,
        endDate: lastRange.endDate,
    };
}

export function indexCalendarDays(
    days: CalendarDayMetadata[]
): Record<string, CalendarDayMetadata> {
    return Object.fromEntries(days.map((day) => [day.date, day]));
}

function isSameCalendarDayMetadata(
    left: CalendarDayMetadata | undefined,
    right: CalendarDayMetadata
): boolean {
    if (!left) return false;
    if (
        left.lunarYear !== right.lunarYear
        || left.lunarMonth !== right.lunarMonth
        || left.lunarDay !== right.lunarDay
        || left.leapMonth !== right.leapMonth
        || left.metadataComplete !== right.metadataComplete
        || left.holidays.length !== right.holidays.length
    ) return false;

    return left.holidays.every((holiday, index) => (
        holiday.name === right.holidays[index]?.name
        && holiday.type === right.holidays[index]?.type
    ));
}

/**
 * Merges overlapping month responses without allowing a later partial
 * response to erase lunar/holiday data that was already complete.
 */
export function mergeCalendarMetadataDays(
    currentDaysByDate: Readonly<Record<string, CalendarDayMetadata>>,
    nextDaysByDate: Readonly<Record<string, CalendarDayMetadata>>,
): Record<string, CalendarDayMetadata> {
    let mergedDaysByDate = currentDaysByDate as Record<string, CalendarDayMetadata>;

    Object.entries(nextDaysByDate).forEach(([date, nextDay]) => {
        const currentDay = currentDaysByDate[date];
        if (
            currentDay?.metadataComplete === true
            && nextDay.metadataComplete !== true
        ) return;
        if (isSameCalendarDayMetadata(currentDay, nextDay)) return;

        if (mergedDaysByDate === currentDaysByDate) {
            mergedDaysByDate = { ...currentDaysByDate };
        }
        mergedDaysByDate[date] = nextDay;
    });

    return mergedDaysByDate;
}

export function isCalendarMetadataMonthComplete(
    daysByDate: Readonly<Record<string, CalendarDayMetadata>>,
    month: string
): boolean {
    const [year, monthNumber] = month.slice(0, 7).split("-").map(Number);
    if (
        !Number.isFinite(year)
        || !Number.isFinite(monthNumber)
        || monthNumber < 1
        || monthNumber > 12
    ) return false;

    const dayCount = new Date(year, monthNumber, 0).getDate();
    return Array.from({ length: dayCount }, (_, index) => (
        `${month.slice(0, 7)}-${String(index + 1).padStart(2, "0")}`
    )).every((date) => daysByDate[date]?.metadataComplete === true);
}

export function formatLunarCalendarDay(
    day?: CalendarDayMetadata
): string | null {
    if (!day?.lunarMonth || !day.lunarDay) return null;
    return day.leapMonth
        ? `음 윤${day.lunarMonth}.${day.lunarDay}`
        : `음 ${day.lunarMonth}.${day.lunarDay}`;
}
