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

export function validateNotificationAccountBinding(options: {
    data?: Record<string, unknown>;
    currentMemberId?: number | null;
    requireRecipient: boolean;
}): boolean {
    const recipientMemberId = getNotificationRecipientMemberId(options.data);
    if (recipientMemberId === undefined) return !options.requireRecipient;
    return options.currentMemberId === recipientMemberId;
}
