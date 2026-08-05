import type { ScheduleItem } from "./types";

export type ScheduleDepartureMutation = {
    departedAt?: string;
    myDepartedAt?: string;
};

export type ScheduleMutationEvent = {
    scheduleId?: string;
    departure?: ScheduleDepartureMutation;
};

type ScheduleMutationListener = (event: ScheduleMutationEvent) => void;

const listeners = new Set<ScheduleMutationListener>();

export function createScheduleDepartureMutationEvent(
    item: ScheduleItem,
): ScheduleMutationEvent {
    const departure: ScheduleDepartureMutation = {
        ...(item.departedAt ? { departedAt: item.departedAt } : {}),
        ...(item.myDepartedAt ? { myDepartedAt: item.myDepartedAt } : {}),
    };
    return { scheduleId: item.id, departure };
}

/** Merge only departure-owned monotonic fields; never replace concurrent title/route edits. */
export function mergeScheduleDepartureMutation(
    item: ScheduleItem,
    mutation: ScheduleMutationEvent,
): ScheduleItem {
    if (mutation.scheduleId !== item.id || !mutation.departure) return item;
    const departedAt = item.departedAt ?? mutation.departure.departedAt;
    const myDepartedAt = item.myDepartedAt ?? mutation.departure.myDepartedAt;
    if (departedAt === item.departedAt && myDepartedAt === item.myDepartedAt) return item;
    return {
        ...item,
        ...(departedAt ? { departedAt } : {}),
        ...(myDepartedAt ? { myDepartedAt } : {}),
    };
}

/** 로컬 mutation 또는 원격 가시성 변경 직후 조회 결과 캐시를 무효화한다. */
export function emitScheduleMutation(event: ScheduleMutationEvent = {}): void {
    listeners.forEach((listener) => {
        try {
            listener(event);
        } catch {
            // A cache listener must never turn a successful server mutation
            // into a client-visible mutation failure.
        }
    });
}

export function subscribeScheduleMutation(
    listener: ScheduleMutationListener,
): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
