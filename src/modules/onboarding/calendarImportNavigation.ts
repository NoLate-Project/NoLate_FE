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

/** 신규 큐레이션은 제품 소개로 이어지고, 프로필의 재설정 흐름은 기존 일정으로 돌아갑니다. */
export function getCalendarImportCompletionRoute(isManagementEntry: boolean):
    | "/onboarding/product-tour"
    | "/schedule" {
    return isManagementEntry ? "/schedule" : "/onboarding/product-tour";
}
