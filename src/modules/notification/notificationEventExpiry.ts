const STRICT_OFFSET_INSTANT =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

function parseStrictOffsetInstant(value: unknown): number | undefined {
    if (typeof value !== "string") return undefined;
    const match = STRICT_OFFSET_INSTANT.exec(value);
    if (!match) return undefined;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    if (
        month < 1 || month > 12 ||
        day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
        hour > 23 || minute > 59 || second > 59
    ) return undefined;
    if (match[8] !== "Z") {
        const offsetHour = Number(match[10]);
        const offsetMinute = Number(match[11]);
        if (offsetHour > 18 || offsetMinute > 59 || (offsetHour === 18 && offsetMinute !== 0)) {
            return undefined;
        }
    }
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) ? milliseconds : undefined;
}

/**
 * Standard departure reminder actions require the same expiration contract as Android's native
 * presenter. Ordinary legacy push types remain compatible; legacy departure rows can still open
 * their schedule through the default tap, which does not invoke this action/presentation fence.
 */
export function isNotificationEtaEventFresh(
    data: Record<string, unknown> | undefined,
    nowMilliseconds: number = Date.now(),
): boolean {
    if (!Number.isSafeInteger(nowMilliseconds) || nowMilliseconds < 0) return false;
    if (!data || !("etaEventExpiresAt" in data)) {
        return data?.type !== "SCHEDULE_DEPARTURE_REMINDER";
    }
    const expiresAt = parseStrictOffsetInstant(data.etaEventExpiresAt);
    return expiresAt !== undefined && expiresAt > nowMilliseconds;
}
