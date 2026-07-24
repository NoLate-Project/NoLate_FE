import { enumerateDaysBetween } from "../../../../../lib/util/data";
import type { ScheduleItem, TravelMode } from "../../types";

export const STACK_EVENT_LANE_COUNT = 2;

export type StackEventPosition = "single" | "start" | "middle" | "end";

export type StackEventPresentation = {
    id: string;
    title: string;
    color: string;
    startAt: string;
    allDay?: boolean;
    travelMode?: TravelMode;
    lane: number;
    position: StackEventPosition;
    connectsBefore: boolean;
    connectsAfter: boolean;
    showsLabel: boolean;
};

export type StackDayPresentation = {
    lanes: Array<StackEventPresentation | null>;
    overflowCount: number;
};

export type StackCalendarLayout = {
    byDate: Record<string, StackDayPresentation>;
};

type NormalizedStackEvent = Omit<
    StackEventPresentation,
    "lane" | "position" | "connectsBefore" | "connectsAfter" | "showsLabel"
> & {
    startDay: string;
    endDay: string;
    dayCount: number;
};

function toDateString(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate()
    ).padStart(2, "0")}`;
}

function moveDay(day: string, amount: number) {
    const date = new Date(`${day}T00:00:00`);
    date.setDate(date.getDate() + amount);
    return toDateString(date);
}

function getWeekdayColumn(day: string, firstDay: 0 | 1) {
    return (new Date(`${day}T00:00:00`).getDay() - firstDay + 7) % 7;
}

/** 일정 종료 시각은 exclusive이므로 자정 종료가 다음 날짜에 남지 않게 한다. */
export function enumerateStackScheduleDays(item: Pick<ScheduleItem, "startAt" | "endAt">) {
    const start = new Date(item.startAt);
    const end = new Date(item.endAt);
    if (Number.isNaN(start.getTime())) return [];
    if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
        return [toDateString(start)];
    }

    return enumerateDaysBetween(item.startAt, new Date(end.getTime() - 1));
}

function normalizeStackEvent(item: ScheduleItem): NormalizedStackEvent | null {
    const days = enumerateStackScheduleDays(item);
    const startDay = days[0];
    const endDay = days[days.length - 1];
    if (!startDay || !endDay) return null;

    return {
        id: item.id,
        title: item.title,
        color: item.category.color,
        startAt: item.startAt,
        allDay: item.allDay,
        travelMode: item.travelMode
            ?? (item.travelMinutes || item.departAt || item.route ? "ETC" : undefined),
        startDay,
        endDay,
        dayCount: days.length,
    };
}

function compareStackEvents(left: NormalizedStackEvent, right: NormalizedStackEvent) {
    if (Boolean(left.allDay) !== Boolean(right.allDay)) {
        return left.allDay ? -1 : 1;
    }
    if (left.startDay !== right.startDay) return left.startDay.localeCompare(right.startDay);
    if (left.dayCount !== right.dayCount) return right.dayCount - left.dayCount;

    const leftStart = new Date(left.startAt).getTime();
    const rightStart = new Date(right.startAt).getTime();
    if (Number.isFinite(leftStart) && Number.isFinite(rightStart) && leftStart !== rightStart) {
        return leftStart - rightStart;
    }

    const titleOrder = left.title.localeCompare(right.title, "ko");
    return titleOrder !== 0 ? titleOrder : left.id.localeCompare(right.id);
}

function toPresentation(
    event: NormalizedStackEvent,
    lane: number
): StackEventPresentation {
    return {
        id: event.id,
        title: event.title,
        color: event.color,
        startAt: event.startAt,
        allDay: event.allDay,
        travelMode: event.travelMode,
        lane,
        position: "single",
        connectsBefore: false,
        connectsAfter: false,
        showsLabel: true,
    };
}

/**
 * 연속 일정은 표시되는 동안 같은 lane을 유지한다. 두 lane이 모두 차 있으면
 * 해당 날짜의 +N에 포함하고, lane이 비는 다음 날짜부터 다시 배치한다.
 */
export function createStackCalendarLayout(
    items: ScheduleItem[],
    firstDay: 0 | 1
): StackCalendarLayout {
    const events = items
        .map(normalizeStackEvent)
        .filter((event): event is NormalizedStackEvent => Boolean(event));
    const eventsByDate = new Map<string, NormalizedStackEvent[]>();

    events.forEach((event) => {
        let day = event.startDay;
        while (day <= event.endDay) {
            const dayEvents = eventsByDate.get(day) ?? [];
            dayEvents.push(event);
            eventsByDate.set(day, dayEvents);
            day = moveDay(day, 1);
        }
    });

    const sortedDays = [...eventsByDate.keys()].sort();
    const activeLanes = new Map<string, number>();
    const byDate: Record<string, StackDayPresentation> = {};

    sortedDays.forEach((day) => {
        const dayEvents = (eventsByDate.get(day) ?? []).sort(compareStackEvents);
        const dayEventIds = new Set(dayEvents.map((event) => event.id));

        for (const eventId of activeLanes.keys()) {
            if (!dayEventIds.has(eventId)) activeLanes.delete(eventId);
        }

        const lanes: Array<StackEventPresentation | null> = Array.from(
            { length: STACK_EVENT_LANE_COUNT },
            () => null
        );

        dayEvents.forEach((event) => {
            const retainedLane = activeLanes.get(event.id);
            if (retainedLane === undefined || lanes[retainedLane]) return;
            lanes[retainedLane] = toPresentation(event, retainedLane);
        });

        const availableLane = () => lanes.findIndex((event) => event === null);
        dayEvents
            .filter((event) => event.dayCount > 1 && !activeLanes.has(event.id))
            .forEach((event) => {
                const lane = availableLane();
                if (lane < 0) return;
                activeLanes.set(event.id, lane);
                lanes[lane] = toPresentation(event, lane);
            });

        dayEvents
            .filter((event) => event.dayCount === 1)
            .forEach((event) => {
                const lane = availableLane();
                if (lane < 0) return;
                lanes[lane] = toPresentation(event, lane);
            });

        byDate[day] = {
            lanes,
            overflowCount: Math.max(0, dayEvents.length - lanes.filter(Boolean).length),
        };
    });

    sortedDays.forEach((day) => {
        const presentation = byDate[day];
        const previousDay = moveDay(day, -1);
        const nextDay = moveDay(day, 1);
        const weekdayColumn = getWeekdayColumn(day, firstDay);

        presentation.lanes = presentation.lanes.map((event, lane) => {
            if (!event) return null;

            const previousEvent = byDate[previousDay]?.lanes[lane];
            const nextEvent = byDate[nextDay]?.lanes[lane];
            const sameMonthAsPrevious = previousDay.slice(0, 7) === day.slice(0, 7);
            const sameMonthAsNext = nextDay.slice(0, 7) === day.slice(0, 7);
            const connectsBefore = Boolean(
                previousEvent?.id === event.id
                && (sameMonthAsPrevious || weekdayColumn === 0)
            );
            const connectsAfter = Boolean(
                nextEvent?.id === event.id
                && (sameMonthAsNext || weekdayColumn === 6)
            );
            const position: StackEventPosition = connectsBefore
                ? connectsAfter ? "middle" : "end"
                : connectsAfter ? "start" : "single";

            return {
                ...event,
                position,
                connectsBefore,
                connectsAfter,
                // 하나의 주간 stick 안에서는 제목을 한 번만 보여 준다.
                // 다음 주로 넘어가면 새 행의 첫 칸에서 맥락을 다시 제공한다.
                showsLabel: !connectsBefore || weekdayColumn === 0,
            };
        });
    });

    return { byDate };
}
