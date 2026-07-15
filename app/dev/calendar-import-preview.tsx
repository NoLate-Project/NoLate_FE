import { Redirect } from "expo-router";

import CalendarImportScreen from "../onboarding/calendar-import";

export default function DevCalendarImportPreview() {
    if (!__DEV__) {
        return <Redirect href="/auth/login" />;
    }

    return <CalendarImportScreen />;
}
