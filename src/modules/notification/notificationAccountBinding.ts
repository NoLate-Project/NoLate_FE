import { getExplicitLogicalNotificationEventKey } from "./notificationEventKey";

export function getNotificationRecipientMemberId(
    data?: Record<string, unknown>,
): number | undefined {
    const value = data?.recipientMemberId;
    const normalized = typeof value === "number"
        ? value
        : typeof value === "string" && /^\d+$/.test(value.trim())
            ? Number(value.trim())
            : Number.NaN;
    return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : undefined;
}

export type ValidatedNotificationAccountBinding = {
    recipientMemberId: number;
    logicalEventKey: string;
};

export function getValidatedNotificationAccountBinding(options: {
    data?: Record<string, unknown>;
    currentMemberId?: number | null;
}): ValidatedNotificationAccountBinding | undefined {
    const recipientMemberId = getNotificationRecipientMemberId(options.data);
    const logicalEventKey = getExplicitLogicalNotificationEventKey(options.data);
    if (
        recipientMemberId === undefined ||
        !logicalEventKey ||
        options.currentMemberId !== recipientMemberId
    ) return undefined;
    return { recipientMemberId, logicalEventKey };
}

export function validateNotificationAccountBinding(options: {
    data?: Record<string, unknown>;
    currentMemberId?: number | null;
}): boolean {
    return getValidatedNotificationAccountBinding(options) !== undefined;
}
