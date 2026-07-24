import type { ScheduleDepartureStatus } from "../src/api/schedule";
import { clearAccountScopedLocalData } from "../src/modules/auth/accountCleanup";
import {
    getCachedScheduleDepartureStatus,
    setCachedScheduleDepartureStatus,
} from "../src/modules/schedule/departureStatusCache";
import {
    clearDeliveredNotificationsForAuthSession,
} from "../src/modules/notification/notificationSessionCleanup";

jest.mock("../src/modules/notification/pushRegistration", () => ({
    clearPushRegistrationAfterLogout: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../src/modules/notification/notificationSessionCleanup", () => ({
    clearDeliveredNotificationsForAuthSession: jest.fn().mockResolvedValue(true),
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
jest.mock("../src/modules/share/shareAttention", () => ({
    clearSeenShareAttention: jest.fn().mockResolvedValue(undefined),
}));

const status: ScheduleDepartureStatus = {
    scheduleId: "42",
    travelMinutes: 28,
    recommendedDepartureAt: null,
    evaluatedAt: null,
    liveFetchedAt: null,
    source: "SAVED_FALLBACK",
    stale: true,
    confidence: "LOW",
    failureReason: null,
    lastTrafficChangeMinutes: null,
    lastChangedAt: null,
    nextCheckAt: null,
    preparationMinutes: null,
    preparationStartAt: null,
    safetyBufferMinutes: null,
    timeZone: null,
};

test("logout/auth invalidation account cleanup clears departure ETA cache synchronously", async () => {
    setCachedScheduleDepartureStatus("member:A", status);

    const cleanup = clearAccountScopedLocalData();
    expect(getCachedScheduleDepartureStatus("member:A", "42")).toBeUndefined();
    await cleanup;
    expect(clearDeliveredNotificationsForAuthSession).toHaveBeenCalledWith({
        authEpoch: expect.any(Number),
    });
});
