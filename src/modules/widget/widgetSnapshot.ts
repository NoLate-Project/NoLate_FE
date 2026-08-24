import type { ScheduleItem } from "../schedule/types";

export const NO_LATE_WIDGET_SNAPSHOT_VERSION = 1 as const;
export const NO_LATE_WIDGET_MAX_SCHEDULES = 40;

const WIDGET_LOOKAHEAD_DAYS = 45;
const DEFAULT_CATEGORY_COLOR = "#0A84FF";

export type NoLateWidgetSchedule = {
    id: string;
    title: string;
    startAt: string;
    endAt: string;
    allDay?: boolean;
    hasEndTime: boolean;
    categoryTitle?: string;
    categoryColor: string;
    locationName?: string;
    destinationName?: string;
    travelMode?: ScheduleItem["travelMode"];
    travelMinutes?: number;
    departAt?: string;
    departureCompleted: boolean;
    routeSetupRequired?: boolean;
};

export type NoLateWidgetSnapshot = {
    version: typeof NO_LATE_WIDGET_SNAPSHOT_VERSION;
    generatedAt: string;
    schedules: NoLateWidgetSchedule[];
};

function startOfLocalDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
}

export function getNoLateWidgetScheduleRange(
    now = new Date(),
): { startAt: string; endAt: string } {
    const start = startOfLocalDay(now);
    const end = new Date(start);
    end.setDate(end.getDate() + WIDGET_LOOKAHEAD_DAYS);
    return { startAt: start.toISOString(), endAt: end.toISOString() };
}

function exactText(value: string | null | undefined, maxLength: number): string | undefined {
    const normalized = value?.trim().replace(/\s+/g, " ");
    if (!normalized) return undefined;
    return normalized.slice(0, maxLength);
}

function exactIso(value: string | null | undefined): string | undefined {
    if (!value) return undefined;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function exactMinutes(value: number | null | undefined): number | undefined {
    if (!Number.isFinite(value)) return undefined;
    const rounded = Math.round(value as number);
    return rounded >= 0 && rounded <= 24 * 60 ? rounded : undefined;
}

function exactCategoryColor(value: string | null | undefined): string {
    const normalized = value?.trim();
    if (!normalized) return DEFAULT_CATEGORY_COLOR;

    const shortHex = /^#([0-9a-f]{3})$/i.exec(normalized);
    if (shortHex) {
        return `#${shortHex[1]
            .split("")
            .map((character) => `${character}${character}`)
            .join("")}`.toUpperCase();
    }

    const fullHex = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(normalized);
    return fullHex ? `#${fullHex[1].toUpperCase()}` : DEFAULT_CATEGORY_COLOR;
}

function resolveDepartureAt(item: ScheduleItem): string | undefined {
    const storedDepartureAt = exactIso(item.departAt);
    if (storedDepartureAt) return storedDepartureAt;

    const travelMinutes = exactMinutes(item.travelMinutes);
    const startAt = exactIso(item.startAt);
    if (!startAt || !travelMinutes) return undefined;

    return new Date(new Date(startAt).getTime() - travelMinutes * 60_000).toISOString();
}

function toWidgetSchedule(item: ScheduleItem): NoLateWidgetSchedule | null {
    const id = exactText(item.id, 80);
    const title = exactText(item.title, 80);
    const startAt = exactIso(item.startAt);
    let endAt = exactIso(item.endAt);
    if (!id || !title || !startAt || !endAt) return null;

    if (item.allDay && new Date(endAt).getTime() <= new Date(startAt).getTime()) {
        const nextDay = new Date(startAt);
        nextDay.setDate(nextDay.getDate() + 1);
        endAt = nextDay.toISOString();
    }

    const locationName = exactText(item.locationName, 80);
    const destinationName = exactText(item.destination?.name, 80);
    const categoryTitle = exactText(item.category?.title, 40);
    const travelMinutes = exactMinutes(item.travelMinutes);
    const departAt = resolveDepartureAt(item);
    const departureCompleted = Boolean(
        exactIso(item.departedAt) || exactIso(item.myDepartedAt),
    );

    return {
        id,
        title,
        startAt,
        endAt,
        ...(item.allDay ? { allDay: true } : {}),
        hasEndTime: item.hasEndTime !== false,
        ...(categoryTitle ? { categoryTitle } : {}),
        categoryColor: exactCategoryColor(item.category?.color),
        ...(locationName ? { locationName } : {}),
        ...(destinationName ? { destinationName } : {}),
        ...(item.travelMode ? { travelMode: item.travelMode } : {}),
        ...(travelMinutes !== undefined ? { travelMinutes } : {}),
        ...(departAt ? { departAt } : {}),
        departureCompleted,
        ...(item.routeSetupRequired ? { routeSetupRequired: true } : {}),
    };
}

/**
 * Builds the deliberately small, non-sensitive payload shared with WidgetKit.
 * Notes, addresses, coordinates, routes and participant data never cross the App Group boundary.
 */
export function buildNoLateWidgetSnapshot(
    items: readonly ScheduleItem[],
    now = new Date(),
): NoLateWidgetSnapshot {
    const range = getNoLateWidgetScheduleRange(now);
    const startBoundary = new Date(range.startAt).getTime();
    const endBoundary = new Date(range.endAt).getTime();
    const schedulesById = new Map<string, NoLateWidgetSchedule>();

    items.forEach((item) => {
        const schedule = toWidgetSchedule(item);
        if (!schedule) return;

        const startAt = new Date(schedule.startAt).getTime();
        const endAt = new Date(schedule.endAt).getTime();
        if (endAt <= startBoundary || startAt >= endBoundary || endAt < startAt) return;

        schedulesById.set(schedule.id, schedule);
    });

    const schedules = Array.from(schedulesById.values())
        .sort((left, right) => {
            const startDifference = new Date(left.startAt).getTime() - new Date(right.startAt).getTime();
            if (startDifference !== 0) return startDifference;
            return left.id.localeCompare(right.id);
        })
        .slice(0, NO_LATE_WIDGET_MAX_SCHEDULES);

    return {
        version: NO_LATE_WIDGET_SNAPSHOT_VERSION,
        generatedAt: now.toISOString(),
        schedules,
    };
}
