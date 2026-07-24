import type { ScheduleDepartureStatus } from "../../api/schedule";

type DepartureStatusInvalidationListener = () => void;

const cache = new Map<string, ScheduleDepartureStatus>();
const listeners = new Map<string, Set<DepartureStatusInvalidationListener>>();

function cacheKey(ownerKey: string, scheduleId: string): string {
    return `${ownerKey}:${scheduleId}`;
}

export function getCachedScheduleDepartureStatus(
    ownerKey: string,
    scheduleId: string,
): ScheduleDepartureStatus | undefined {
    return cache.get(cacheKey(ownerKey, scheduleId));
}

export function setCachedScheduleDepartureStatus(
    ownerKey: string,
    status: ScheduleDepartureStatus,
): void {
    cache.set(cacheKey(ownerKey, status.scheduleId), status);
}

export function removeCachedScheduleDepartureStatus(
    ownerKey: string,
    scheduleId: string,
): void {
    cache.delete(cacheKey(ownerKey, scheduleId));
}

/**
 * 교통 푸시는 기존 값을 즉시 버리지 않고 재검증만 요청한다. 네트워크가 끊겨도
 * 마지막 값을 stale로 표시할 수 있어, LIVE 값을 숨긴 채 legacy 값으로 점프하지 않는다.
 */
export function invalidateScheduleDepartureStatus(scheduleId: string): void {
    listeners.get(scheduleId)?.forEach((listener) => listener());
}

export function subscribeScheduleDepartureStatusInvalidation(
    scheduleId: string,
    listener: DepartureStatusInvalidationListener,
): () => void {
    const scheduleListeners = listeners.get(scheduleId) ?? new Set();
    scheduleListeners.add(listener);
    listeners.set(scheduleId, scheduleListeners);

    return () => {
        scheduleListeners.delete(listener);
        if (scheduleListeners.size === 0) listeners.delete(scheduleId);
    };
}

export function clearScheduleDepartureStatusCache(): void {
    cache.clear();
}
