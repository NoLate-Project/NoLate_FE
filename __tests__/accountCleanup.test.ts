import { clearAccountScopedLocalData } from "../src/modules/auth/accountCleanup";
import { clearDepartureAlarmsForAccountCleanup } from "../src/modules/notification/departureAlarmSync";
import {
    clearDepartureAlarmScheduleReceiptQueueForCurrentAccount,
} from "../src/modules/notification/departureAlarmScheduleReceiptQueue";
import { clearPushDeliveryAckQueueForCurrentAccount } from "../src/modules/notification/pushDeliveryAckQueue";
import { clearPushRegistrationAfterLogout } from "../src/modules/notification/pushRegistration";
import {
    clearStandardDepartureActionFallbackForCurrentAccount,
} from "../src/modules/notification/nativeDepartureActionJournal";
import {
    clearForegroundPushPresentationClaimsForCurrentAccount,
} from "../src/modules/notification/foregroundPushPresentationClaim";
import { clearCalendarConnectionSnapshot } from "../src/modules/onboarding/calendarConnectionStorage";
import { clearStoredGoogleCalendarAccessToken } from "../src/modules/onboarding/googleCalendarImport";
import { clearLocalRoutePlaceCaches } from "../src/modules/schedule/favoriteDeparture";
import {
    clearScheduleArrivalObservationQueueForCurrentAccount,
} from "../src/modules/schedule/scheduleArrivalObservationQueue";
import {
    clearScheduleEtaObservationEngagementQueueForCurrentAccount,
} from "../src/modules/schedule/scheduleEtaObservationEngagementQueue";
import {
    clearQuickScheduleReliabilityFeedbackQueueForCurrentAccount,
} from "../src/modules/schedule/quickScheduleReliabilityFeedbackQueue";
import { clearSeenShareAttention } from "../src/modules/share/shareAttention";
import {
    clearNavigationPerformanceQueueForCurrentAccount,
} from "../src/modules/performance/navigationPerformanceQueue";
import {
    clearInteractionPerformanceQueueForCurrentAccount,
} from "../src/modules/performance/interactionPerformanceQueue";
import { clearScheduleCalendarMemoryCache } from "../src/modules/schedule/scheduleCalendarMemoryCache";
import { clearPersistedCalendarScheduleCacheForAccount } from "../src/modules/schedule/calendarScheduleCache";
import { disableRouteDetailAdvertising } from "../src/modules/advertising/routeDetailInterstitial";
import { getAuthMember } from "../src/modules/auth/authStorage";
import { clearNoLateWidgetSnapshot } from "../src/modules/widget/nativeWidgetBridge";

jest.mock("../src/modules/advertising/routeDetailInterstitial", () => ({
    disableRouteDetailAdvertising: jest.fn(),
}));

jest.mock("../src/modules/notification/departureAlarmSync", () => ({
    clearDepartureAlarmsForAccountCleanup: jest.fn().mockResolvedValue(true),
}));

jest.mock("../src/modules/notification/departureAlarmScheduleReceiptQueue", () => ({
    clearDepartureAlarmScheduleReceiptQueueForCurrentAccount: jest
        .fn()
        .mockResolvedValue(undefined),
}));

jest.mock("../src/modules/notification/pushDeliveryAckQueue", () => ({
    clearPushDeliveryAckQueueForCurrentAccount: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/modules/notification/pushRegistration", () => ({
    clearPushRegistrationAfterLogout: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/modules/notification/nativeDepartureActionJournal", () => ({
    clearStandardDepartureActionFallbackForCurrentAccount: jest
        .fn()
        .mockResolvedValue(undefined),
}));

jest.mock("../src/modules/notification/foregroundPushPresentationClaim", () => ({
    clearForegroundPushPresentationClaimsForCurrentAccount: jest
        .fn()
        .mockResolvedValue(undefined),
}));

jest.mock("../src/modules/onboarding/calendarConnectionStorage", () => ({
    clearCalendarConnectionSnapshot: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/modules/onboarding/googleCalendarImport", () => ({
    clearStoredGoogleCalendarAccessToken: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/modules/schedule/favoriteDeparture", () => ({
    clearLocalRoutePlaceCaches: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/modules/schedule/scheduleArrivalObservationQueue", () => ({
    clearScheduleArrivalObservationQueueForCurrentAccount: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/modules/schedule/scheduleEtaObservationEngagementQueue", () => ({
    clearScheduleEtaObservationEngagementQueueForCurrentAccount: jest
        .fn()
        .mockResolvedValue(undefined),
}));

jest.mock("../src/modules/schedule/quickScheduleReliabilityFeedbackQueue", () => ({
    clearQuickScheduleReliabilityFeedbackQueueForCurrentAccount: jest
        .fn()
        .mockResolvedValue(undefined),
}));

jest.mock("../src/modules/share/shareAttention", () => ({
    clearSeenShareAttention: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/modules/performance/navigationPerformanceQueue", () => ({
    clearNavigationPerformanceQueueForCurrentAccount: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/modules/performance/interactionPerformanceQueue", () => ({
    clearInteractionPerformanceQueueForCurrentAccount: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/modules/schedule/scheduleCalendarMemoryCache", () => ({
    clearScheduleCalendarMemoryCache: jest.fn(),
}));

jest.mock("../src/modules/schedule/calendarScheduleCache", () => ({
    clearPersistedCalendarScheduleCacheForAccount: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/modules/auth/authStorage", () => ({
    getAuthMember: jest.fn().mockResolvedValue({ id: 7 }),
}));

jest.mock("../src/modules/widget/nativeWidgetBridge", () => ({
    clearNoLateWidgetSnapshot: jest.fn().mockResolvedValue(true),
}));

const mockedAlarmCleanup = jest.mocked(clearDepartureAlarmsForAccountCleanup);
const mockedReceiptCleanup = jest.mocked(
    clearDepartureAlarmScheduleReceiptQueueForCurrentAccount
);
const mockedDisableRouteDetailAdvertising = jest.mocked(disableRouteDetailAdvertising);
const mockedClearScheduleCalendarMemoryCache = jest.mocked(clearScheduleCalendarMemoryCache);
const mockedWidgetCleanup = jest.mocked(clearNoLateWidgetSnapshot);
const allOtherCleanupMocks = [
    clearPushDeliveryAckQueueForCurrentAccount,
    clearPushRegistrationAfterLogout,
    clearStandardDepartureActionFallbackForCurrentAccount,
    clearForegroundPushPresentationClaimsForCurrentAccount,
    clearCalendarConnectionSnapshot,
    clearStoredGoogleCalendarAccessToken,
    clearLocalRoutePlaceCaches,
    clearScheduleArrivalObservationQueueForCurrentAccount,
    clearScheduleEtaObservationEngagementQueueForCurrentAccount,
    clearQuickScheduleReliabilityFeedbackQueueForCurrentAccount,
    clearSeenShareAttention,
    clearNavigationPerformanceQueueForCurrentAccount,
    clearInteractionPerformanceQueueForCurrentAccount,
    clearPersistedCalendarScheduleCacheForAccount,
    clearNoLateWidgetSnapshot,
].map((cleanup) => jest.mocked(cleanup));

describe("clearAccountScopedLocalData", () => {
    afterEach(() => {
        jest.clearAllMocks();
        mockedAlarmCleanup.mockResolvedValue(true);
        mockedWidgetCleanup.mockResolvedValue(true);
    });

    it("removes the account-bound alarm schedule receipt queue", async () => {
        await clearAccountScopedLocalData();

        expect(mockedReceiptCleanup).toHaveBeenCalledTimes(1);
        expect(mockedDisableRouteDetailAdvertising).toHaveBeenCalledTimes(1);
        expect(mockedClearScheduleCalendarMemoryCache).toHaveBeenCalledTimes(1);
        expect(getAuthMember).toHaveBeenCalledTimes(1);
        expect(clearPersistedCalendarScheduleCacheForAccount).toHaveBeenCalledWith(7);
        for (const cleanup of allOtherCleanupMocks) {
            expect(cleanup).toHaveBeenCalledTimes(1);
        }
    });

    it("still runs receipt cleanup and propagates a native alarm cleanup failure", async () => {
        const failure = new Error("native alarm cleanup failed");
        mockedAlarmCleanup.mockRejectedValueOnce(failure);

        await expect(clearAccountScopedLocalData()).rejects.toBe(failure);
        expect(mockedReceiptCleanup).toHaveBeenCalledTimes(1);
    });

    it("propagates a widget privacy cleanup failure before credentials can be removed", async () => {
        const failure = new Error("widget snapshot cleanup failed");
        mockedWidgetCleanup.mockRejectedValueOnce(failure);

        await expect(clearAccountScopedLocalData()).rejects.toBe(failure);
        expect(mockedAlarmCleanup).toHaveBeenCalledTimes(1);
        expect(mockedReceiptCleanup).toHaveBeenCalledTimes(1);
    });
});
