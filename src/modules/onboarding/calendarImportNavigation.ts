export function isCalendarImportManagementEntry({
    source,
    isCurationCompleted,
}: {
    source?: string | string[];
    isCurationCompleted: boolean;
}): boolean {
    const normalizedSource = (Array.isArray(source) ? source[0] : source)?.trim();
    return normalizedSource === "profile" && isCurationCompleted;
}

export function shouldConsumeCalendarImportHardwareBack({
    busy,
    canGoBack,
}: {
    busy: boolean;
    canGoBack: boolean;
}): boolean {
    return busy || canGoBack;
}
