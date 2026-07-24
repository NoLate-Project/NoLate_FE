import type { ScheduleDepartureStatus } from "../../api/schedule";
import type { ScheduleItem } from "./types";
import { isAuthSessionActive } from "../auth/authSessionEpoch";
import {
    mutateCalendarScheduleCacheIfAuthSessionCurrent,
    upsertCalendarScheduleCacheItem,
} from "./calendarScheduleCache";

export type ScheduleDepartureMutationEvent = {
    authEpoch: number;
    kind: "departed" | "snoozed";
    scheduleId: string;
    item?: ScheduleItem;
    status?: ScheduleDepartureStatus;
    refreshing?: boolean;
};

const listeners = new Set<(event: ScheduleDepartureMutationEvent) => void>();

export function emitScheduleDepartureMutation(
    event: ScheduleDepartureMutationEvent,
): boolean {
    if (!isAuthSessionActive(event.authEpoch)) return false;
    const item = event.item;
    if (
        item &&
        !mutateCalendarScheduleCacheIfAuthSessionCurrent(
            event.authEpoch,
            () => upsertCalendarScheduleCacheItem(item),
        )
    ) return false;
    if (!isAuthSessionActive(event.authEpoch)) return false;
    listeners.forEach((listener) => listener(event));
    return true;
}

export function subscribeScheduleDepartureMutation(
    listener: (event: ScheduleDepartureMutationEvent) => void,
): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function subscribeScheduleDepartureMutationForAuthSession(
    authEpoch: number,
    listener: (event: ScheduleDepartureMutationEvent) => void,
): () => void {
    return subscribeScheduleDepartureMutation((event) => {
        if (
            event.authEpoch !== authEpoch ||
            !isAuthSessionActive(authEpoch)
        ) return;
        listener(event);
    });
}
