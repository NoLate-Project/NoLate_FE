import { clearPushRegistrationAfterLogout } from "../notification/pushRegistration";
import { clearCalendarConnectionSnapshot } from "../onboarding/calendarConnectionStorage";
import { clearStoredGoogleCalendarAccessToken } from "../onboarding/googleCalendarImport";
import { clearLocalRoutePlaceCaches } from "../schedule/favoriteDeparture";
import { clearSeenShareAttention } from "../share/shareAttention";

/** Clears data that belongs to the signed-in member before another account can load. */
export async function clearAccountScopedLocalData(): Promise<void> {
    const cleanups = [
        clearStoredGoogleCalendarAccessToken(),
        clearCalendarConnectionSnapshot(),
        clearLocalRoutePlaceCaches(),
        clearSeenShareAttention(),
        clearPushRegistrationAfterLogout(),
    ];

    await Promise.allSettled(cleanups);
}
