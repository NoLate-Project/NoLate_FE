import type { ScheduleItem } from "./types";

const WEEKDAY_LABELS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

export type AgendaSection = {
    dateKey: string;
    header: string;
    itemCount: number;
    items: ScheduleItem[];
};

export type AgendaMultiDaySummary = {
    dayCount: number;
    nightCount: number;
    stayLabel: string;
    dateRangeLabel: string;
};

export type AgendaDetailTimeColumn = {
    startLabel: string;
    endLabel: string | null;
};

type TimeRange = {
    start: number;
    end: number;
};

const pad2 = (value: number) => String(value).padStart(2, "0");

function toDateKey(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseMonthStart(visibleMonth: string): Date | null {
    const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(visibleMonth);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isInteger(year) || month < 1 || month > 12) return null;

    return new Date(year, month - 1, 1, 0, 0, 0, 0);
}

function parseDayStart(dateKey: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day, 0, 0, 0, 0);

    if (
        date.getFullYear() !== year
        || date.getMonth() !== month - 1
        || date.getDate() !== day
    ) {
        return null;
    }

    return date;
}

function localCalendarDayOrdinal(date: Date): number {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

function formatAgendaClock(date: Date): string {
    const meridiem = date.getHours() < 12 ? "오전" : "오후";
    const hour = date.getHours() % 12 || 12;
    return `${meridiem} ${hour}:${pad2(date.getMinutes())}`;
}

function formatAgendaDateTime(date: Date, includeYear: boolean): string {
    const dateLabel = includeYear
        ? `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`
        : `${date.getMonth() + 1}월 ${date.getDate()}일`;
    return `${dateLabel} ${formatAgendaClock(date)}`;
}

function formatCompactAgendaDate(date: Date, includeYear: boolean): string {
    return includeYear
        ? `${String(date.getFullYear()).slice(-2)}.${date.getMonth() + 1}.${date.getDate()}`
        : `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatAgendaDateRange(start: Date, end: Date): string {
    if (start.getFullYear() !== end.getFullYear()) {
        return [
            `${start.getFullYear()}년 ${start.getMonth() + 1}월 ${start.getDate()}일`,
            `${end.getFullYear()}년 ${end.getMonth() + 1}월 ${end.getDate()}일`,
        ].join("–");
    }

    if (start.getMonth() !== end.getMonth()) {
        return [
            `${start.getMonth() + 1}월 ${start.getDate()}일`,
            `${end.getMonth() + 1}월 ${end.getDate()}일`,
        ].join("–");
    }

    return `${start.getMonth() + 1}월 ${start.getDate()}일–${end.getDate()}일`;
}

/**
 * 상세형 카드에 표시할 연속 일정의 로컬 달력 기간을 계산한다.
 * endAt은 exclusive이므로 자정 종료는 직전 날짜까지로 처리한다.
 */
export function getAgendaMultiDaySummary(
    item: Pick<ScheduleItem, "startAt" | "endAt" | "allDay" | "hasEndTime">
): AgendaMultiDaySummary | null {
    if (!item.allDay && item.hasEndTime === false) return null;

    const start = new Date(item.startAt);
    const end = new Date(item.endAt);
    const startTime = start.getTime();
    const endTime = end.getTime();
    if (
        !Number.isFinite(startTime)
        || !Number.isFinite(endTime)
        || endTime <= startTime
    ) {
        return null;
    }

    const inclusiveEnd = new Date(endTime - 1);
    const dayCount = localCalendarDayOrdinal(inclusiveEnd)
        - localCalendarDayOrdinal(start)
        + 1;
    if (!Number.isFinite(dayCount) || dayCount <= 1) return null;

    const nightCount = dayCount - 1;
    return {
        dayCount,
        nightCount,
        stayLabel: `${nightCount}박 ${dayCount}일`,
        dateRangeLabel: formatAgendaDateRange(start, inclusiveEnd),
    };
}

/**
 * 상세형 카드의 날짜를 넘기는 시간 일정에 실제 시작·종료 날짜와 시각을 표시한다.
 * 숙박 계산과 달리 종료 시각은 원본 값을 그대로 사용해 자정 종료도 명확히 보여 준다.
 */
export function formatAgendaMultiDayTimeRange(
    item: Pick<ScheduleItem, "startAt" | "endAt" | "allDay" | "hasEndTime">
): string | null {
    if (item.allDay || item.hasEndTime === false) return null;

    const start = new Date(item.startAt);
    const end = new Date(item.endAt);
    const startTime = start.getTime();
    const endTime = end.getTime();
    if (
        !Number.isFinite(startTime)
        || !Number.isFinite(endTime)
        || endTime <= startTime
        || localCalendarDayOrdinal(start) === localCalendarDayOrdinal(end)
    ) {
        return null;
    }

    const includeYear = start.getFullYear() !== end.getFullYear();
    return [
        formatAgendaDateTime(start, includeYear),
        formatAgendaDateTime(end, includeYear),
    ].join(" → ");
}

/**
 * 상세형 카드의 두 번째 줄에 사용할 일정 시각이다.
 * 당일 일정도 날짜를 포함하고, 종일 일정은 end-exclusive 날짜 범위를 사용한다.
 */
export function formatAgendaDetailScheduleTime(
    item: Pick<ScheduleItem, "startAt" | "endAt" | "allDay" | "hasEndTime">
): string {
    const start = new Date(item.startAt);
    if (!Number.isFinite(start.getTime())) return item.allDay ? "종일" : "";

    if (item.allDay) {
        const summary = getAgendaMultiDaySummary(item);
        const dateLabel = summary?.dateRangeLabel
            ?? `${start.getMonth() + 1}월 ${start.getDate()}일`;
        return `${dateLabel} · 종일`;
    }

    const startLabel = formatAgendaDateTime(start, false);
    if (item.hasEndTime === false) return startLabel;

    const end = new Date(item.endAt);
    if (!Number.isFinite(end.getTime()) || end.getTime() <= start.getTime()) {
        return startLabel;
    }

    const multiDayRange = formatAgendaMultiDayTimeRange(item);
    if (multiDayRange) return multiDayRange;

    return `${startLabel} → ${formatAgendaClock(end)}`;
}

/**
 * 상세형 카드 우측에 표시할 시작·종료 시각 두 줄을 만든다.
 * 같은 날은 시각만, 날짜를 넘기면 각 줄에 날짜를 함께 표시한다.
 */
export function formatAgendaDetailTimeColumn(
    item: Pick<ScheduleItem, "startAt" | "endAt" | "allDay" | "hasEndTime">
): AgendaDetailTimeColumn {
    const start = new Date(item.startAt);
    if (!Number.isFinite(start.getTime())) {
        return {
            startLabel: item.allDay ? "종일" : "",
            endLabel: null,
        };
    }

    const end = new Date(item.endAt);
    const hasValidEnd =
        item.hasEndTime !== false
        && Number.isFinite(end.getTime())
        && end.getTime() > start.getTime();

    if (item.allDay) {
        const summary = getAgendaMultiDaySummary(item);
        if (!summary || !hasValidEnd) {
            return { startLabel: "종일", endLabel: null };
        }

        const inclusiveEnd = new Date(end.getTime() - 1);
        const includeYear = start.getFullYear() !== inclusiveEnd.getFullYear();
        return {
            startLabel: `${formatCompactAgendaDate(start, includeYear)} 시작`,
            endLabel: `${formatCompactAgendaDate(inclusiveEnd, includeYear)} 종료`,
        };
    }

    if (!hasValidEnd) {
        return {
            startLabel: formatAgendaClock(start),
            endLabel: null,
        };
    }

    const spansMultipleDays =
        localCalendarDayOrdinal(start) !== localCalendarDayOrdinal(end);
    if (!spansMultipleDays) {
        return {
            startLabel: formatAgendaClock(start),
            endLabel: formatAgendaClock(end),
        };
    }

    const includeYear = start.getFullYear() !== end.getFullYear();
    return {
        startLabel: `${formatCompactAgendaDate(start, includeYear)} ${formatAgendaClock(start)}`,
        endLabel: `${formatCompactAgendaDate(end, includeYear)} ${formatAgendaClock(end)}`,
    };
}

function getItemRange(item: ScheduleItem): TimeRange | null {
    const start = new Date(item.startAt).getTime();
    if (!Number.isFinite(start)) return null;

    const parsedEnd = new Date(item.endAt).getTime();
    // A missing or non-positive duration still represents an event at startAt.
    // Giving it a 1ms interval keeps it visible without changing end-exclusive
    // behavior for valid schedules.
    const end = Number.isFinite(parsedEnd) && parsedEnd > start
        ? parsedEnd
        : start + 1;

    return { start, end };
}

function overlaps(range: TimeRange, start: number, end: number): boolean {
    return range.start < end && range.end > start;
}

function dedupeAndSort(items: ScheduleItem[]): ScheduleItem[] {
    const itemsById = new Map<string, ScheduleItem>();
    items.forEach((item) => itemsById.set(item.id, item));

    return Array.from(itemsById.values())
        .filter((item) => getItemRange(item) !== null)
        .sort((left, right) => (
            new Date(left.startAt).getTime() - new Date(right.startAt).getTime()
        ));
}

export function formatAgendaSectionHeader(dateKey: string): string {
    const date = parseDayStart(dateKey);
    if (!date) return dateKey;

    return `${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAY_LABELS[date.getDay()]}`;
}

/** Returns the unique schedules that overlap the visible local calendar month. */
export function getVisibleMonthAgendaItems(
    items: ScheduleItem[],
    visibleMonth: string
): ScheduleItem[] {
    const monthStartDate = parseMonthStart(visibleMonth);
    if (!monthStartDate) return [];

    const monthEndDate = new Date(
        monthStartDate.getFullYear(),
        monthStartDate.getMonth() + 1,
        1,
        0,
        0,
        0,
        0
    );
    const monthStart = monthStartDate.getTime();
    const monthEnd = monthEndDate.getTime();

    return dedupeAndSort(items).filter((item) => {
        const range = getItemRange(item);
        return range ? overlaps(range, monthStart, monthEnd) : false;
    });
}

/**
 * Builds non-empty, chronological date sections for the visible month.
 * Each schedule appears once, under its local start date. A schedule that
 * started before the visible month but still overlaps it is anchored to the
 * first day of the visible month.
 */
export function buildMonthAgendaSections(
    items: ScheduleItem[],
    visibleMonth: string
): AgendaSection[] {
    const monthStart = parseMonthStart(visibleMonth);
    if (!monthStart) return [];

    const monthItems = getVisibleMonthAgendaItems(items, visibleMonth);
    const monthStartTime = monthStart.getTime();
    const itemsByDate = new Map<string, ScheduleItem[]>();

    monthItems.forEach((item) => {
        const itemStart = new Date(item.startAt);
        const anchorDate = itemStart.getTime() < monthStartTime
            ? monthStart
            : itemStart;
        const dateKey = toDateKey(anchorDate);
        const dayItems = itemsByDate.get(dateKey) ?? [];
        dayItems.push(item);
        itemsByDate.set(dateKey, dayItems);
    });

    return Array.from(itemsByDate.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([dateKey, dayItems]) => ({
            dateKey,
            header: formatAgendaSectionHeader(dateKey),
            itemCount: dayItems.length,
            items: dayItems,
        }));
}

/** Returns unique, start-time-sorted schedules overlapping a selected local day. */
export function getSelectedDayAgendaItems(
    items: ScheduleItem[],
    selectedDay: string
): ScheduleItem[] {
    const dayStartDate = parseDayStart(selectedDay);
    if (!dayStartDate) return [];

    const dayEndDate = new Date(
        dayStartDate.getFullYear(),
        dayStartDate.getMonth(),
        dayStartDate.getDate() + 1,
        0,
        0,
        0,
        0
    );
    const dayStart = dayStartDate.getTime();
    const dayEnd = dayEndDate.getTime();

    return dedupeAndSort(items).filter((item) => {
        const range = getItemRange(item);
        return range ? overlaps(range, dayStart, dayEnd) : false;
    });
}
