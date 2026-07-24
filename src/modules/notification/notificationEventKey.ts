const INTERNAL_EVENT_KEY = "__nolateNotificationEventKey";
const LOGICAL_EVENT_ID_FIELDS = [
    "logicalEventKey",
    "eventKey",
    "eventId",
    "notificationId",
] as const;
const PROVIDER_EVENT_ID_FIELDS = [
    "messageId",
    "google.message_id",
    "gcm.message_id",
] as const;

export function getExplicitLogicalNotificationEventKey(
    data?: Record<string, unknown>,
): string | undefined {
    const value = data?.logicalEventKey;
    if (typeof value === "string" && value.trim()) {
        return `logical:${value.trim()}`;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return `logical:${value}`;
    }
    return undefined;
}

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
    const explicitLogicalEventKey = getExplicitLogicalNotificationEventKey(data);
    if (explicitLogicalEventKey) return explicitLogicalEventKey;

    for (const field of LOGICAL_EVENT_ID_FIELDS) {
        if (field === "logicalEventKey") continue;
        const value = data?.[field];
        if (typeof value === "string" && value.trim()) {
            return `logical:${value.trim()}`;
        }
        if (typeof value === "number" && Number.isFinite(value)) {
            return `logical:${value}`;
        }
    }

    const internalEventKey = data?.[INTERNAL_EVENT_KEY];
    if (typeof internalEventKey === "string" && internalEventKey.trim()) {
        return internalEventKey.trim();
    }

    if (providerEventId?.trim()) {
        return `provider:${providerEventId.trim()}`;
    }

    for (const field of PROVIDER_EVENT_ID_FIELDS) {
        const value = data?.[field];
        if (typeof value === "string" && value.trim()) {
            return `provider:${value.trim()}`;
        }
    }

    const entries = primitiveEntries(data);
    if (entries.length > 0) {
        return `payload:${entries.map(([key, value]) => `${key}=${value}`).join("&")}`;
    }

    return undefined;
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

export function consumeNotificationEventAfterValidation(
    consumer: ReturnType<typeof createNotificationEventConsumer>,
    key: string | undefined,
    valid: boolean,
    nowMs = Date.now(),
): boolean {
    return valid && consumer.consume(key, nowMs);
}

export function getExpoNotificationProviderMessageId(response: unknown): string | undefined {
    if (!response || typeof response !== "object") return undefined;
    const notification = (response as {
        notification?: {
            request?: {
                trigger?: unknown;
            };
        };
    }).notification;
    const trigger = notification?.request?.trigger;
    if (!trigger || typeof trigger !== "object") return undefined;

    const triggerRecord = trigger as {
        remoteMessage?: { messageId?: unknown };
        payload?: {
            messageId?: unknown;
            "google.message_id"?: unknown;
            "gcm.message_id"?: unknown;
        };
    };
    const candidates = [
        triggerRecord.remoteMessage?.messageId,
        triggerRecord.payload?.messageId,
        triggerRecord.payload?.["google.message_id"],
        triggerRecord.payload?.["gcm.message_id"],
    ];
    const messageId = candidates.find(
        (candidate): candidate is string =>
            typeof candidate === "string" && candidate.trim().length > 0,
    );
    return messageId?.trim();
}
