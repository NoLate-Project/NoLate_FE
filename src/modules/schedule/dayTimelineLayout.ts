import { startOfDay } from "../../../lib/util/data";
import { getRouteInfoFromRoute, isRouteInfo, type RouteInfo } from "./routeInfo";
import type { ScheduleItem, TravelMode } from "./types";

export const DAY_MINUTES = 24 * 60;
export const DAY_TIMELINE_HOUR_HEIGHT = 50;
export const DAY_TIMELINE_EVENT_GAP = 4;
export const DAY_TIMELINE_MIN_EVENT_HEIGHT = 46;
export const DAY_TIMELINE_MIN_TRAVEL_EVENT_HEIGHT = 64;
export const DAY_TIMELINE_COMPACT_EVENT_HEIGHT = 34;
export const DAY_TIMELINE_END_PADDING = DAY_TIMELINE_MIN_TRAVEL_EVENT_HEIGHT;
export const DAY_TIMELINE_CARD_VERTICAL_PADDING = 5;
export const DAY_TIMELINE_TITLE_LINE_HEIGHT = 18;
export const DAY_TIMELINE_META_LINE_HEIGHT = 14;
export const DAY_TIMELINE_TRAVEL_LINE_HEIGHT = 14;

export type PositionedEvent = {
    item: ScheduleItem;
    startMinute: number;
    endMinute: number;
    visualEndMinute: number;
    height: number;
    lane: number;
    laneCount: number;
};

export type DayTimelineEventMetadata = {
    location?: string;
    travelMinutes?: number;
    departureAt?: string;
    travelMode?: TravelMode;
    isTravel: boolean;
};

type DayTimelineLayoutOptions = {
    compact?: boolean;
};

function minuteOfDay(date: Date) {
    return date.getHours() * 60 + date.getMinutes();
}

function validPositiveMinutes(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? Math.round(value)
        : undefined;
}

function validDateString(value?: string) {
    if (!value) return undefined;
    return Number.isNaN(new Date(value).getTime()) ? undefined : value;
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
    for (const value of values) {
        const normalized = value?.trim();
        if (normalized) return normalized;
    }
    return undefined;
}

function inferTravelMode(routeInfo?: RouteInfo): TravelMode | undefined {
    if (!routeInfo) return undefined;
    if (routeInfo.steps.some((step) => step.type === "BUS" || step.type === "SUBWAY")) return "TRANSIT";
    if (routeInfo.steps.some((step) => step.type === "DRIVE")) return "CAR";
    if (routeInfo.steps.some((step) => step.type === "BIKE")) return "BIKE";
    if (routeInfo.steps.some((step) => step.type === "WALK")) return "WALK";
    return "ETC";
}

export function getDayTimelineEventMetadata(item: ScheduleItem): DayTimelineEventMetadata {
    const routeObject = item.route as Record<string, unknown> | undefined;
    const persistedRouteInfo = isRouteInfo(item.route)
        ? item.route
        : isRouteInfo(routeObject?.routeInfo)
            ? routeObject.routeInfo
            : undefined;
    const routeInfo = getRouteInfoFromRoute(item.route);
    const travelMinutes = validPositiveMinutes(item.travelMinutes)
        ?? validPositiveMinutes(routeInfo?.totalDurationMinutes);
    let departureAt = validDateString(item.departAt);

    if (!departureAt && travelMinutes) {
        const startAt = new Date(item.startAt);
        if (!Number.isNaN(startAt.getTime())) {
            departureAt = new Date(startAt.getTime() - travelMinutes * 60_000).toISOString();
        }
    }

    // 이전 버전이 현재 시각으로 저장한 nested routeInfo보다 일정 시각 기반 계산을 우선한다.
    departureAt ??= validDateString(persistedRouteInfo?.departureTime);

    const locationCandidate = firstNonEmpty(
        item.destination?.name,
        item.locationName,
        routeInfo?.destinationName
    );
    const normalizedTitle = item.title.trim().toLocaleLowerCase();
    const location = locationCandidate && !normalizedTitle.includes(locationCandidate.toLocaleLowerCase())
        ? locationCandidate
        : undefined;
    const isTravel = Boolean(
        validDateString(item.departAt) ||
        travelMinutes ||
        routeInfo
    );

    return {
        location,
        travelMinutes,
        departureAt,
        travelMode: item.travelMode ?? inferTravelMode(routeInfo),
        isTravel,
    };
}

export function getDayTimelineEventMinimumHeight(
    item: ScheduleItem,
    options: DayTimelineLayoutOptions = {}
) {
    if (options.compact) return DAY_TIMELINE_COMPACT_EVENT_HEIGHT;
    return getDayTimelineEventMetadata(item).isTravel
        ? DAY_TIMELINE_MIN_TRAVEL_EVENT_HEIGHT
        : DAY_TIMELINE_MIN_EVENT_HEIGHT;
}

export function getDayTimelineEventHeight(
    item: ScheduleItem,
    startMinute: number,
    endMinute: number,
    options: DayTimelineLayoutOptions = {}
) {
    const durationHeight = Math.max(1, endMinute - startMinute) / 60 * DAY_TIMELINE_HOUR_HEIGHT
        - DAY_TIMELINE_EVENT_GAP;
    return Math.max(getDayTimelineEventMinimumHeight(item, options), durationHeight);
}

export function buildPositionedEvents(
    items: ScheduleItem[],
    day: string,
    options: DayTimelineLayoutOptions = {}
): PositionedEvent[] {
    const dayStart = startOfDay(day).getTime();
    const nextDay = dayStart + 24 * 60 * 60 * 1000;
    const events = items
        .filter((item) => !item.allDay)
        .flatMap((item) => {
            const rawStart = new Date(item.startAt).getTime();
            const rawEnd = new Date(item.endAt).getTime();
            if (!Number.isFinite(rawStart)) return [];

            const safeRawEnd = Number.isFinite(rawEnd) ? Math.max(rawEnd, rawStart + 60_000) : rawStart + 60_000;
            if (safeRawEnd <= dayStart || rawStart >= nextDay) return [];
            const clippedStart = new Date(Math.max(rawStart, dayStart));
            const clippedEnd = new Date(Math.min(safeRawEnd, nextDay));
            const startMinute = rawStart < dayStart ? 0 : minuteOfDay(clippedStart);
            const rawEndMinute = safeRawEnd >= nextDay ? DAY_MINUTES : minuteOfDay(clippedEnd);
            const endMinute = Math.max(startMinute + 1, rawEndMinute);
            const height = getDayTimelineEventHeight(item, startMinute, endMinute, options);
            const visualDurationMinutes = (height + DAY_TIMELINE_EVENT_GAP)
                / DAY_TIMELINE_HOUR_HEIGHT * 60;

            return [{
                item,
                startMinute,
                endMinute,
                visualEndMinute: startMinute + visualDurationMinutes,
                height,
                lane: 0,
                laneCount: 1,
            }];
        })
        .sort((a, b) => a.startMinute - b.startMinute || a.visualEndMinute - b.visualEndMinute);

    let groupStart = 0;
    while (groupStart < events.length) {
        let groupEnd = groupStart + 1;
        let latestEnd = events[groupStart].visualEndMinute;

        while (groupEnd < events.length && events[groupEnd].startMinute < latestEnd) {
            latestEnd = Math.max(latestEnd, events[groupEnd].visualEndMinute);
            groupEnd += 1;
        }

        const laneEnds: number[] = [];
        for (let index = groupStart; index < groupEnd; index += 1) {
            const event = events[index];
            let lane = laneEnds.findIndex((endMinute) => endMinute <= event.startMinute);
            if (lane < 0) lane = laneEnds.length;
            laneEnds[lane] = event.visualEndMinute;
            event.lane = lane;
        }

        const laneCount = Math.max(1, laneEnds.length);
        for (let index = groupStart; index < groupEnd; index += 1) {
            events[index].laneCount = laneCount;
        }
        groupStart = groupEnd;
    }

    return events;
}

export function formatDayTimelineClock(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const hour = date.getHours() % 12 || 12;
    return `${hour}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatDayTimelineTimeRange(item: ScheduleItem) {
    const start = formatDayTimelineClock(item.startAt);
    if (!start || item.hasEndTime === false) return start;
    const end = formatDayTimelineClock(item.endAt);
    return end ? `${start} - ${end}` : start;
}

export function formatDayTimelineDeparture(value?: string) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const meridiem = date.getHours() < 12 ? "오전" : "오후";
    const hour = date.getHours() % 12 || 12;
    return `${meridiem} ${hour}:${String(date.getMinutes()).padStart(2, "0")}`;
}
