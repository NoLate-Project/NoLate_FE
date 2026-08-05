const MAX_LOGICAL_EVENT_KEY_LENGTH = 100;
const MAX_PROVIDER_MESSAGE_ID_LENGTH = 300;
const CANONICAL_ACTION_EVENT_KEY = /^(?:key:[0-9a-f]{64}|event:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function normalizedText(value: unknown, maximumLength: number): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    return normalized && normalized.length <= maximumLength ? normalized : undefined;
}

function normalizedMemberId(value: unknown): number | undefined {
    const parsed = typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : value;
    return typeof parsed === "number" && Number.isSafeInteger(parsed) && parsed > 0
        ? parsed
        : undefined;
}

export function getLogicalEventKeyFromPushData(
    data?: Record<string, unknown>,
): string | undefined {
    return normalizedText(data?.logicalEventKey, MAX_LOGICAL_EVENT_KEY_LENGTH);
}

export type PushNotificationIdentityCandidate = {
    data?: Record<string, unknown>;
    providerMessageId?: unknown;
};

function canonicalActionIdentity(data: Record<string, unknown> | undefined): string | undefined {
    const candidate = data?.actionEventKey ?? data?.logicalEventKey;
    const normalized = normalizedText(candidate, MAX_LOGICAL_EVENT_KEY_LENGTH);
    return normalized && CANONICAL_ACTION_EVENT_KEY.test(normalized) ? normalized : undefined;
}

function canonicalPositiveIdentifier(value: unknown, maximumLength: number): string | undefined {
    return typeof value === "string" &&
        value.length <= maximumLength &&
        /^[1-9]\d*$/.test(value)
        ? value
        : undefined;
}

function hasActionIdentityField(data: Record<string, unknown> | undefined): boolean {
    return Boolean(data) && (
        Object.prototype.hasOwnProperty.call(data, "actionEventKey") ||
        Object.prototype.hasOwnProperty.call(data, "logicalEventKey")
    );
}

/** Correlates RNFirebase and Expo views without allowing stale explicit actions to cross events. */
export function isSamePushNotificationIdentity(
    first: PushNotificationIdentityCandidate,
    second: PushNotificationIdentityCandidate,
): boolean {
    const firstActionIdentity = canonicalActionIdentity(first.data);
    const secondActionIdentity = canonicalActionIdentity(second.data);
    if (firstActionIdentity && secondActionIdentity) {
        if (firstActionIdentity !== secondActionIdentity) return false;
        const firstRecipient = normalizedMemberId(first.data?.recipientMemberId);
        const secondRecipient = normalizedMemberId(second.data?.recipientMemberId);
        const firstScheduleId = canonicalPositiveIdentifier(first.data?.scheduleId, 200);
        const secondScheduleId = canonicalPositiveIdentifier(second.data?.scheduleId, 200);
        return Boolean(
            firstRecipient && secondRecipient && firstRecipient === secondRecipient &&
            firstScheduleId && firstScheduleId === secondScheduleId
        );
    }
    if (
        firstActionIdentity || secondActionIdentity ||
        hasActionIdentityField(first.data) || hasActionIdentityField(second.data)
    ) return false;

    const firstProviderMessageId = normalizedText(
        first.providerMessageId,
        MAX_PROVIDER_MESSAGE_ID_LENGTH,
    );
    const secondProviderMessageId = normalizedText(
        second.providerMessageId,
        MAX_PROVIDER_MESSAGE_ID_LENGTH,
    );
    return Boolean(
        firstProviderMessageId && secondProviderMessageId &&
        firstProviderMessageId === secondProviderMessageId
    );
}
