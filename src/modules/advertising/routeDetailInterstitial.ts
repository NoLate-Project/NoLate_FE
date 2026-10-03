import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import {
    getMySubscriptionPolicy,
    type SubscriptionPolicy,
} from "../../api/subscription";
import { getEnv } from "../../api/env";
import { resolveProductionRouteDetailAdUnitId } from "./adMobAdUnits";
import { ensureAppTrackingTransparencyResolved } from "../privacy/trackingTransparency";
import {
    parseRouteDetailAdFrequencyState,
    recordRouteDetailAdShown,
    registerRouteDetailEntry,
    type RouteDetailAdFrequencyState,
} from "./routeDetailAdFrequency";

const FREQUENCY_STORAGE_KEY = "@nolate/advertising/route-detail-frequency-v1";
const POLICY_FRESHNESS_MS = 60 * 1000;
const AD_RELOAD_DELAY_MS = 60 * 1000;
const SHOW_COMPLETION_TIMEOUT_MS = 60 * 1000;

type InterstitialHandle = {
    loaded: boolean;
    load: () => void;
    show: () => Promise<void>;
    addAdEventsListener: (
        listener: (event: { type: string; payload?: unknown }) => void,
    ) => () => void;
    removeAllListeners: () => void;
};

type GoogleMobileAdsModule = {
    default: () => { initialize: () => Promise<unknown> };
    AdsConsent: {
        gatherConsent: () => Promise<{ canRequestAds?: boolean }>;
        getConsentInfo: () => Promise<{ canRequestAds?: boolean }>;
    };
    InterstitialAd: {
        createForAdRequest: (adUnitId: string) => InterstitialHandle;
    };
    TestIds: { INTERSTITIAL: string };
    AdEventType: {
        LOADED: string;
        OPENED: string;
        CLOSED: string;
        ERROR: string;
    };
};

export type RouteDetailInterstitialOutcome = "shown" | "skipped";

let policyEnabled = false;
let policyLoadedAtMs = 0;
let policyRequest: Promise<void> | undefined;
let policyGeneration = 0;
let sdkReady = false;
let sdkRequest: Promise<void> | undefined;
let interstitial: InterstitialHandle | undefined;
let interstitialLoaded = false;
let adEventsUnsubscribe: (() => void) | undefined;
let reloadTimer: ReturnType<typeof setTimeout> | undefined;
let showInFlight = false;
let showOpened = false;
let showCompletion: ((opened: boolean) => void) | undefined;
let storageQueue: Promise<unknown> = Promise.resolve();
const defaultGoogleMobileAdsLoader = () => (
    import("react-native-google-mobile-ads") as unknown as Promise<GoogleMobileAdsModule>
);
let loadGoogleMobileAds = defaultGoogleMobileAdsLoader;

function productionAdUnitId(): string | undefined {
    return resolveProductionRouteDetailAdUnitId(
        Platform.OS,
        getEnv("EXPO_PUBLIC_ADMOB_ANDROID_ROUTE_DETAIL_INTERSTITIAL_ID"),
    );
}

/** PREMIUM is always ad-free, even if a malformed or stale server response says otherwise. */
export function shouldEnableRouteDetailAdvertising(
    policy: Pick<SubscriptionPolicy, "plan" | "adsEnabled">,
): boolean {
    return policy.plan === "FREE" && policy.adsEnabled === true;
}

function clearReloadTimer() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = undefined;
}

function releaseInterstitial() {
    clearReloadTimer();
    adEventsUnsubscribe?.();
    adEventsUnsubscribe = undefined;
    interstitial?.removeAllListeners();
    interstitial = undefined;
    interstitialLoaded = false;
    showCompletion?.(showOpened);
    showCompletion = undefined;
    showOpened = false;
    showInFlight = false;
}

function invalidateAdvertisingPolicy() {
    policyGeneration += 1;
    policyEnabled = false;
    policyLoadedAtMs = 0;
    policyRequest = undefined;
    sdkRequest = undefined;
    releaseInterstitial();
}

function scheduleReload() {
    if (!policyEnabled || !sdkReady || reloadTimer) return;
    reloadTimer = setTimeout(() => {
        reloadTimer = undefined;
        createAndLoadInterstitial().catch(() => undefined);
    }, AD_RELOAD_DELAY_MS);
}

async function updateFrequencyState<T>(
    operation: (state: RouteDetailAdFrequencyState, nowMs: number) => {
        state: RouteDetailAdFrequencyState;
        result: T;
    },
): Promise<T> {
    const run = storageQueue.then(async () => {
        const nowMs = Date.now();
        const state = parseRouteDetailAdFrequencyState(
            await AsyncStorage.getItem(FREQUENCY_STORAGE_KEY),
            nowMs,
        );
        const next = operation(state, nowMs);
        await AsyncStorage.setItem(FREQUENCY_STORAGE_KEY, JSON.stringify(next.state));
        return next.result;
    });
    storageQueue = run.catch(() => undefined);
    return run;
}

async function markAdShown() {
    await updateFrequencyState((state, nowMs) => ({
        state: recordRouteDetailAdShown(state, nowMs),
        result: undefined,
    }));
}

async function createAndLoadInterstitial() {
    if (!policyEnabled || !sdkReady || interstitial || Platform.OS === "web") return;

    const ads = await loadGoogleMobileAds();
    if (!policyEnabled || !sdkReady || interstitial) return;
    const adUnitId = __DEV__ ? ads.TestIds.INTERSTITIAL : productionAdUnitId();
    if (!adUnitId) return;

    const candidate: InterstitialHandle = ads.InterstitialAd.createForAdRequest(adUnitId);
    interstitial = candidate;
    adEventsUnsubscribe = candidate.addAdEventsListener(({ type }) => {
        if (candidate !== interstitial) return;

        if (type === ads.AdEventType.LOADED) {
            interstitialLoaded = true;
            return;
        }
        if (type === ads.AdEventType.OPENED) {
            showOpened = true;
            markAdShown().catch(() => undefined);
            return;
        }
        if (type === ads.AdEventType.CLOSED) {
            releaseInterstitial();
            if (policyEnabled) createAndLoadInterstitial().catch(() => undefined);
            return;
        }
        if (type === ads.AdEventType.ERROR) {
            releaseInterstitial();
            scheduleReload();
        }
    });
    candidate.load();
}

async function initializeAdSdk() {
    if (!policyEnabled || sdkRequest || Platform.OS === "web") return sdkRequest;
    if (sdkReady) {
        await createAndLoadInterstitial();
        return;
    }
    if (!__DEV__ && !productionAdUnitId()) return;

    const requestGeneration = policyGeneration;
    const request = (async () => {
        // ATT must settle before importing/initializing the tracking-capable ads SDK. A denied
        // decision still allows Google to serve ads without IDFA-based tracking.
        await ensureAppTrackingTransparencyResolved();
        if (!policyEnabled || requestGeneration !== policyGeneration) return;

        const ads = await loadGoogleMobileAds();
        if (!policyEnabled || requestGeneration !== policyGeneration) return;
        let consentInfo;
        try {
            consentInfo = await ads.AdsConsent.gatherConsent();
        } catch {
            consentInfo = await ads.AdsConsent.getConsentInfo().catch(() => undefined);
        }
        if (
            !consentInfo?.canRequestAds ||
            !policyEnabled ||
            requestGeneration !== policyGeneration
        ) return;

        await ads.default().initialize();
        if (!policyEnabled || requestGeneration !== policyGeneration) return;
        sdkReady = true;
        await createAndLoadInterstitial();
    })().catch(() => undefined).finally(() => {
        if (sdkRequest === request) sdkRequest = undefined;
    });
    sdkRequest = request;
    return request;
}

/**
 * Refreshes the backend kill switch and preloads a test/production interstitial without blocking
 * navigation. A failed or stale policy always disables ads.
 */
export async function primeRouteDetailAdvertising(force = false): Promise<void> {
    if (force) invalidateAdvertisingPolicy();

    const nowMs = Date.now();
    if (!force && policyLoadedAtMs > 0 && nowMs - policyLoadedAtMs < POLICY_FRESHNESS_MS) {
        if (policyEnabled) initializeAdSdk().catch(() => undefined);
        return;
    }
    if (policyRequest) return policyRequest;

    const requestGeneration = policyGeneration;
    const request = getMySubscriptionPolicy()
        .then((policy) => {
            if (requestGeneration !== policyGeneration) return;
            policyEnabled = shouldEnableRouteDetailAdvertising(policy);
            policyLoadedAtMs = Date.now();
            if (!policyEnabled) {
                releaseInterstitial();
                return;
            }
            initializeAdSdk().catch(() => undefined);
        })
        .catch(() => {
            if (requestGeneration !== policyGeneration) return;
            policyEnabled = false;
            policyLoadedAtMs = Date.now();
            releaseInterstitial();
        })
        .finally(() => {
            if (policyRequest === request) policyRequest = undefined;
        });
    policyRequest = request;
    return request;
}

/**
 * Invalidates any FREE cache immediately, then rechecks the server entitlement. Purchase and
 * restore flows should await this after their server-side entitlement commit.
 */
export function refreshRouteDetailAdvertisingPolicy(): Promise<void> {
    return primeRouteDetailAdvertising(true);
}

/** Clears account-bound policy state immediately; persisted frequency caps remain device-wide. */
export function disableRouteDetailAdvertising() {
    invalidateAdvertisingPolicy();
}

/**
 * Attempts an ad only when the cached backend policy is fresh and the frequency cap allows it.
 * Every failure path resolves as skipped so route navigation can continue immediately.
 */
export async function showRouteDetailInterstitialIfEligible(
    options: { suppress?: boolean } = {},
): Promise<RouteDetailInterstitialOutcome> {
    if (options.suppress) return "skipped";

    const nowMs = Date.now();
    if (!policyEnabled || nowMs - policyLoadedAtMs >= POLICY_FRESHNESS_MS) {
        primeRouteDetailAdvertising().catch(() => undefined);
        return "skipped";
    }

    const eligible = await updateFrequencyState((state, entryNowMs) => {
        const decision = registerRouteDetailEntry(state, entryNowMs);
        return { state: decision.state, result: decision.eligible };
    }).catch(() => false);
    if (
        !policyEnabled ||
        !eligible ||
        showInFlight ||
        !interstitialLoaded ||
        !interstitial
    ) {
        if (policyEnabled && !interstitial) initializeAdSdk().catch(() => undefined);
        return "skipped";
    }

    showInFlight = true;
    showOpened = false;
    const completion = new Promise<boolean>((resolve) => {
        showCompletion = resolve;
    });
    let completionTimeout: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
        completionTimeout = setTimeout(
            () => resolve(showOpened),
            SHOW_COMPLETION_TIMEOUT_MS,
        );
    });

    try {
        await interstitial.show();
        const opened = await Promise.race([completion, timeout]);
        return opened ? "shown" : "skipped";
    } catch {
        releaseInterstitial();
        scheduleReload();
        return "skipped";
    } finally {
        if (completionTimeout) clearTimeout(completionTimeout);
        showInFlight = false;
        showCompletion = undefined;
    }
}

export function resetRouteDetailAdvertisingForTests() {
    invalidateAdvertisingPolicy();
    sdkReady = false;
    storageQueue = Promise.resolve();
    loadGoogleMobileAds = defaultGoogleMobileAdsLoader;
}

export function setRouteDetailAdsModuleLoaderForTests(
    loader: (() => Promise<unknown>) | undefined,
) {
    loadGoogleMobileAds = loader
        ? async () => await loader() as GoogleMobileAdsModule
        : defaultGoogleMobileAdsLoader;
}
