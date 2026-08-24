const ADMOB_AD_UNIT_ID_PATTERN = /^ca-app-pub-\d{16}\/\d{10}$/;

export const IOS_ROUTE_DETAIL_INTERSTITIAL_AD_UNIT_ID =
    "ca-app-pub-6334753209593250/7417557605";

export function resolveProductionRouteDetailAdUnitId(
    platform: string,
    configuredAndroidAdUnitId?: string,
): string | undefined {
    if (platform === "ios") {
        return IOS_ROUTE_DETAIL_INTERSTITIAL_AD_UNIT_ID;
    }
    if (platform !== "android") {
        return undefined;
    }

    const candidate = configuredAndroidAdUnitId?.trim();
    return candidate && ADMOB_AD_UNIT_ID_PATTERN.test(candidate) ? candidate : undefined;
}
