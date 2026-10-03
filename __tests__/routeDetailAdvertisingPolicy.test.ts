import { getMySubscriptionPolicy, type SubscriptionPolicy } from "../src/api/subscription";
import { ensureAppTrackingTransparencyResolved } from "../src/modules/privacy/trackingTransparency";
import {
    disableRouteDetailAdvertising,
    primeRouteDetailAdvertising,
    refreshRouteDetailAdvertisingPolicy,
    resetRouteDetailAdvertisingForTests,
    setRouteDetailAdsModuleLoaderForTests,
    shouldEnableRouteDetailAdvertising,
    showRouteDetailInterstitialIfEligible,
} from "../src/modules/advertising/routeDetailInterstitial";

let mockStoredFrequency: string | null = null;
let mockAdEventListener: ((event: { type: string }) => void) | undefined;
const mockRemoveAllListeners = jest.fn();
const mockLoadInterstitial = jest.fn();
const mockShowInterstitial = jest.fn(async () => {
    mockAdEventListener?.({ type: "opened" });
    mockAdEventListener?.({ type: "closed" });
});
const mockCreateInterstitial = jest.fn(() => ({
    loaded: false,
    load: mockLoadInterstitial,
    show: mockShowInterstitial,
    addAdEventsListener: jest.fn((listener: (event: { type: string }) => void) => {
        mockAdEventListener = listener;
        return jest.fn();
    }),
    removeAllListeners: mockRemoveAllListeners,
}));
const mockInitializeAds = jest.fn().mockResolvedValue(undefined);
const mockGatherConsent = jest.fn().mockResolvedValue({ canRequestAds: true });

jest.mock("../src/api/subscription", () => ({
    getMySubscriptionPolicy: jest.fn(),
}));

jest.mock("../src/api/env", () => ({
    getEnv: jest.fn(),
}));

jest.mock("../src/modules/privacy/trackingTransparency", () => ({
    ensureAppTrackingTransparencyResolved: jest.fn().mockResolvedValue("denied"),
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
    getItem: jest.fn(async () => mockStoredFrequency),
    setItem: jest.fn(async (_key: string, value: string) => {
        mockStoredFrequency = value;
    }),
}));

const mockedGetMySubscriptionPolicy = jest.mocked(getMySubscriptionPolicy);
const mockedEnsureAppTrackingTransparencyResolved = jest.mocked(
    ensureAppTrackingTransparencyResolved,
);

function policy(
    plan: SubscriptionPolicy["plan"],
    adsEnabled: boolean,
): SubscriptionPolicy {
    return {
        plan,
        adsEnabled,





    };
}

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
} {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

async function settleAdInitialization(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
}

describe("route detail advertising subscription policy", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockStoredFrequency = null;
        mockAdEventListener = undefined;
        mockGatherConsent.mockResolvedValue({ canRequestAds: true });
        mockInitializeAds.mockResolvedValue(undefined);
        resetRouteDetailAdvertisingForTests();
        setRouteDetailAdsModuleLoaderForTests(async () => ({
            default: () => ({ initialize: mockInitializeAds }),
            AdsConsent: {
                gatherConsent: mockGatherConsent,
                getConsentInfo: jest.fn().mockResolvedValue({ canRequestAds: true }),
            },
            InterstitialAd: {
                createForAdRequest: mockCreateInterstitial,
            },
            TestIds: {
                INTERSTITIAL: "test-interstitial",
            },
            AdEventType: {
                LOADED: "loaded",
                OPENED: "opened",
                CLOSED: "closed",
                ERROR: "error",
            },
        }));
    });

    afterEach(() => {
        disableRouteDetailAdvertising();
    });

    it("enables ads only for a verified FREE policy", () => {
        expect(shouldEnableRouteDetailAdvertising(policy("FREE", true))).toBe(true);
        expect(shouldEnableRouteDetailAdvertising(policy("FREE", false))).toBe(false);
        expect(shouldEnableRouteDetailAdvertising(policy("PREMIUM", false))).toBe(false);
        expect(shouldEnableRouteDetailAdvertising(policy("PREMIUM", true))).toBe(false);
    });

    it("never initializes the ads SDK for PREMIUM even when adsEnabled is malformed", async () => {
        mockedGetMySubscriptionPolicy.mockResolvedValue(policy("PREMIUM", true));

        await primeRouteDetailAdvertising();

        expect(mockedEnsureAppTrackingTransparencyResolved).not.toHaveBeenCalled();
        await expect(showRouteDetailInterstitialIfEligible()).resolves.toBe("skipped");
        expect(mockedGetMySubscriptionPolicy).toHaveBeenCalledTimes(1);
    });

    it("preloads and shows an interstitial for an eligible FREE member after ATT denial", async () => {
        mockedGetMySubscriptionPolicy.mockResolvedValue(policy("FREE", true));

        await primeRouteDetailAdvertising();
        await settleAdInitialization();

        expect(mockedEnsureAppTrackingTransparencyResolved).toHaveBeenCalledTimes(1);
        expect(mockGatherConsent).toHaveBeenCalledTimes(1);
        expect(mockInitializeAds).toHaveBeenCalledTimes(1);
        expect(mockCreateInterstitial).toHaveBeenCalledWith("test-interstitial");
        expect(mockLoadInterstitial).toHaveBeenCalledTimes(1);

        mockAdEventListener?.({ type: "loaded" });
        await expect(showRouteDetailInterstitialIfEligible()).resolves.toBe("skipped");
        await expect(showRouteDetailInterstitialIfEligible()).resolves.toBe("skipped");
        await expect(showRouteDetailInterstitialIfEligible()).resolves.toBe("shown");
        expect(mockShowInterstitial).toHaveBeenCalledTimes(1);
    });

    it("does not initialize or load an ad when UMP cannot request ads", async () => {
        mockedGetMySubscriptionPolicy.mockResolvedValue(policy("FREE", true));
        mockGatherConsent.mockResolvedValue({ canRequestAds: false });

        await primeRouteDetailAdvertising();
        await settleAdInitialization();

        expect(mockedEnsureAppTrackingTransparencyResolved).toHaveBeenCalledTimes(1);
        expect(mockGatherConsent).toHaveBeenCalledTimes(1);
        expect(mockInitializeAds).not.toHaveBeenCalled();
        expect(mockCreateInterstitial).not.toHaveBeenCalled();
    });

    it("releases a preloaded FREE ad immediately when refresh returns PREMIUM", async () => {
        mockedGetMySubscriptionPolicy
            .mockResolvedValueOnce(policy("FREE", true))
            .mockResolvedValueOnce(policy("PREMIUM", false));

        await primeRouteDetailAdvertising();
        await settleAdInitialization();
        mockAdEventListener?.({ type: "loaded" });

        await refreshRouteDetailAdvertisingPolicy();

        expect(mockRemoveAllListeners).toHaveBeenCalledTimes(1);
        await expect(showRouteDetailInterstitialIfEligible()).resolves.toBe("skipped");
        expect(mockShowInterstitial).not.toHaveBeenCalled();
    });

    it("ignores an old FREE response after an entitlement refresh commits PREMIUM", async () => {
        const staleFreePolicy = deferred<SubscriptionPolicy>();
        mockedGetMySubscriptionPolicy
            .mockReturnValueOnce(staleFreePolicy.promise)
            .mockResolvedValueOnce(policy("PREMIUM", false));

        const staleRequest = primeRouteDetailAdvertising();
        await refreshRouteDetailAdvertisingPolicy();
        staleFreePolicy.resolve(policy("FREE", true));
        await staleRequest;

        await expect(showRouteDetailInterstitialIfEligible()).resolves.toBe("skipped");
        expect(mockedGetMySubscriptionPolicy).toHaveBeenCalledTimes(2);
        expect(mockedEnsureAppTrackingTransparencyResolved).not.toHaveBeenCalled();
    });

    it("ignores an in-flight account policy after advertising is disabled", async () => {
        const oldAccountPolicy = deferred<SubscriptionPolicy>();
        mockedGetMySubscriptionPolicy
            .mockReturnValueOnce(oldAccountPolicy.promise)
            .mockResolvedValueOnce(policy("PREMIUM", false));

        const staleRequest = primeRouteDetailAdvertising();
        disableRouteDetailAdvertising();
        oldAccountPolicy.resolve(policy("FREE", true));
        await staleRequest;

        await expect(showRouteDetailInterstitialIfEligible()).resolves.toBe("skipped");
        await Promise.resolve();
        expect(mockedGetMySubscriptionPolicy).toHaveBeenCalledTimes(2);
        expect(mockedEnsureAppTrackingTransparencyResolved).not.toHaveBeenCalled();
    });
});
