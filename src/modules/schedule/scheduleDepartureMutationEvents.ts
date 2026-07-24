import type { ScheduleDepartureStatus } from "../../api/schedule";
import type { ScheduleItem } from "./types";
import { upsertCalendarScheduleCacheItem } from "./calendarScheduleCache";

export type ScheduleDepartureMutationEvent = {
    kind: "departed" | "snoozed";
    scheduleId: string;
    item?: ScheduleItem;
    status?: ScheduleDepartureStatus;
    refreshing?: boolean;
};

const listeners = new Set<(event: ScheduleDepartureMutationEvent) => void>();

export function emitScheduleDepartureMutation(
    event: ScheduleDepartureMutationEvent,
): void {
    if (event.item) upsertCalendarScheduleCacheItem(event.item);
    listeners.forEach((listener) => listener(event));
}

export function subscribeScheduleDepartureMutation(
    listener: (event: ScheduleDepartureMutationEvent) => void,
): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
