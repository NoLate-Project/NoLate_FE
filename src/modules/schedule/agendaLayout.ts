import type { ScheduleItem } from "./types";

const WEEKDAY_LABELS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

export type AgendaSection = {
    dateKey: string;
    header: string;
    itemCount: number;
    items: ScheduleItem[];
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
