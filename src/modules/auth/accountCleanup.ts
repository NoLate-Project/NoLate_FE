import { clearPushRegistrationAfterLogout } from "../notification/pushRegistration";
import { clearCalendarConnectionSnapshot } from "../onboarding/calendarConnectionStorage";
import { clearStoredGoogleCalendarAccessToken } from "../onboarding/googleCalendarImport";
import { clearLocalRoutePlaceCaches } from "../schedule/favoriteDeparture";
import { clearCalendarScheduleCache } from "../schedule/calendarScheduleCache";
import { clearScheduleDepartureStatusCache } from "../schedule/departureStatusCache";
import { clearSeenShareAttention } from "../share/shareAttention";
import { getAuthSessionEpoch } from "./authSessionEpoch";
import {
    clearDeliveredNotificationsForAuthSession,
} from "../notification/notificationSessionCleanup";

/** Clears data that belongs to the signed-in member before another account can load. */
export async function clearAccountScopedLocalData(): Promise<void> {
    const cleanupAuthEpoch = getAuthSessionEpoch();
    clearCalendarScheduleCache();
    clearScheduleDepartureStatusCache();
    const cleanups = [
        clearStoredGoogleCalendarAccessToken(),
        clearCalendarConnectionSnapshot(),
        clearLocalRoutePlaceCaches(),
        clearSeenShareAttention(),
        clearPushRegistrationAfterLogout(),
        clearDeliveredNotificationsForAuthSession({
            authEpoch: cleanupAuthEpoch,
        }),
    ];

    await Promise.allSettled(cleanups);
}
