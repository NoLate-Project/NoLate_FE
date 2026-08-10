import AsyncStorage from "@react-native-async-storage/async-storage";

import {
    DEFAULT_CALENDAR_VIEW_MODE,
    isCalendarViewModePreference,
    type CalendarViewMode,
    type CalendarViewModePreference,
} from "./viewMode";

export const CALENDAR_VIEW_MODE_STORAGE_KEY = "@nolate/calendar/view-mode";

let cachedPreference: CalendarViewModePreference | null = null;
let preferenceRevision = 0;
let pendingPreferenceLoad: Promise<CalendarViewModePreference> | null = null;

export function getCachedCalendarViewModePreference(): CalendarViewModePreference | null {
    return cachedPreference;
}

export function loadCalendarViewModePreference(): Promise<CalendarViewModePreference> {
    if (cachedPreference) return Promise.resolve(cachedPreference);
    if (pendingPreferenceLoad) return pendingPreferenceLoad;

    const revisionAtStart = preferenceRevision;
    const load = AsyncStorage.getItem(CALENDAR_VIEW_MODE_STORAGE_KEY)
        .then((storedPreference) => {
            // A selection made while storage was being read always wins. This
            // also keeps the in-memory value correct for the next route mount.
            if (preferenceRevision !== revisionAtStart && cachedPreference) {
                return cachedPreference;
            }

            cachedPreference = isCalendarViewModePreference(storedPreference)
                ? storedPreference
                : DEFAULT_CALENDAR_VIEW_MODE;
            return cachedPreference;
        })
        .catch(() => cachedPreference ?? DEFAULT_CALENDAR_VIEW_MODE)
        .finally(() => {
            if (pendingPreferenceLoad === load) pendingPreferenceLoad = null;
        });

    pendingPreferenceLoad = load;
    return load;
}

export function rememberCalendarViewModePreference(mode: CalendarViewMode): boolean {
    if (!isCalendarViewModePreference(mode)) return false;

    cachedPreference = mode;
    preferenceRevision += 1;
    AsyncStorage.setItem(CALENDAR_VIEW_MODE_STORAGE_KEY, mode)
        .catch(() => undefined);
    return true;
}

export function resetCalendarViewModePreferenceCacheForTests() {
    cachedPreference = null;
    preferenceRevision = 0;
    pendingPreferenceLoad = null;
}
