const INTERNAL_EVENT_KEY = "__nolateNotificationEventKey";
const EVENT_ID_FIELDS = [
    INTERNAL_EVENT_KEY,
    "eventId",
    "notificationId",
    "messageId",
    "google.message_id",
    "gcm.message_id",
] as const;

function primitiveEntries(data?: Record<string, unknown>): Array<[string, string]> {
    if (!data) return [];

    return Object.entries(data)
        .filter(([, value]) => (
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
        ))
        .map(([key, value]) => [key, String(value)] as [string, string])
        .sort(([left], [right]) => left.localeCompare(right));
}

export function createCanonicalNotificationEventKey(
    data?: Record<string, unknown>,
    providerEventId?: string,
): string | undefined {
    for (const field of EVENT_ID_FIELDS) {
        const value = data?.[field];
        if (typeof value === "string" && value.trim()) {
            return field === INTERNAL_EVENT_KEY
                ? value.trim()
                : `event:${value.trim()}`;
        }
        if (typeof value === "number" && Number.isFinite(value)) {
            return `event:${value}`;
        }
    }

    const entries = primitiveEntries(data);
    if (entries.length > 0) {
        return `payload:${entries.map(([key, value]) => `${key}=${value}`).join("&")}`;
    }

    return providerEventId?.trim()
        ? `provider:${providerEventId.trim()}`
        : undefined;
}

export function withCanonicalNotificationEventKey(
    data: Record<string, unknown>,
    providerEventId?: string,
): Record<string, unknown> {
    const eventKey = createCanonicalNotificationEventKey(data, providerEventId);
    return eventKey
        ? { ...data, [INTERNAL_EVENT_KEY]: eventKey }
        : data;
}

export function createNotificationEventConsumer(options: {
    ttlMs?: number;
    maxSize?: number;
} = {}) {
    const ttlMs = options.ttlMs ?? 30_000;
    const maxSize = options.maxSize ?? 100;
    const consumedAt = new Map<string, number>();

    const prune = (nowMs: number) => {
        consumedAt.forEach((timestamp, key) => {
            if (nowMs - timestamp >= ttlMs) consumedAt.delete(key);
        });
        while (consumedAt.size > maxSize) {
            const firstKey = consumedAt.keys().next().value as string | undefined;
            if (!firstKey) break;
            consumedAt.delete(firstKey);
        }
    };

    return {
        consume(key: string | undefined, nowMs = Date.now()): boolean {
            if (!key) return true;
            prune(nowMs);
            if (consumedAt.has(key)) return false;
            consumedAt.set(key, nowMs);
            prune(nowMs);
            return true;
        },
    };
}
