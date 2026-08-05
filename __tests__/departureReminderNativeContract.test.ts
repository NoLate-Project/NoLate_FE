const fs = jest.requireActual("fs") as {
    readFileSync(filePath: string, encoding: string): string;
};
const read = (relativePath: string) => fs.readFileSync(relativePath, "utf8");

describe("Android departure reminder native contract", () => {
    const service = read(
        "modules/nolate-alarm/android/src/main/java/expo/modules/nolatealarm/" +
        "NoLateFirebaseMessagingService.kt",
    );
    const presenter = read(
        "modules/nolate-alarm/android/src/main/java/expo/modules/nolatealarm/" +
        "DepartureReminderPush.kt",
    );
    const interaction = read(
        "modules/nolate-alarm/android/src/main/java/expo/modules/nolatealarm/" +
        "DepartureReminderInteractionActivity.kt",
    );
    const appManifest = read("android/app/src/main/AndroidManifest.xml");
    const moduleManifest = read("modules/nolate-alarm/android/src/main/AndroidManifest.xml");

    it("intercepts canonical reminders independent of an app-state snapshot", () => {
        expect(service).toContain("override fun handleIntent(intent: Intent)");
        expect(service).not.toContain("SharedUtils.isAppInForeground");
        expect(service).toContain("Intent(intent)");
        expect(service).toContain("filter(::isFirebaseNotificationPresentationKey)");
        expect(service).toContain("sanitizedMessage.notification != null");
        expect(service).toContain("DepartureReminderPresentationCoordinator(");
    });

    it("installs one high-priority custom service and removes RNFirebase's original service", () => {
        expect(moduleManifest).toMatch(
            /android:name="expo\.modules\.nolatealarm\.NoLateFirebaseMessagingService"[\s\S]*android:priority="100"/,
        );
        expect(appManifest).toMatch(
            /android:name="io\.invertase\.firebase\.messaging\.ReactNativeFirebaseMessagingService"[\s\S]*tools:node="remove"/,
        );
        expect(moduleManifest).toContain(".DepartureReminderInteractionActivity");
    });

    it("expires the OS row and rejects stale interactions before journaling", () => {
        expect(presenter).toContain(".setTimeoutAfter(remainingMillis)");
        const expirationCheck = interaction.indexOf(
            "remainingDepartureReminderLifetimeMillis(payload, System.currentTimeMillis()) == null",
        );
        const actionRecord = interaction.indexOf("DepartureAlarmActionJournal(this).record(");
        expect(expirationCheck).toBeGreaterThanOrEqual(0);
        expect(expirationCheck).toBeLessThan(actionRecord);
        expect(interaction).toContain("DepartureReminderLifecycleLock.monitor");
    });

    it("keeps route tap and exact depart action on separate durable contracts", () => {
        expect(presenter).toContain(
            ".setContentIntent(interactionIntent(payload, DEPARTURE_REMINDER_ACTION_OPEN_ROUTE))",
        );
        expect(presenter).toMatch(
            /context\.getString\(R\.string\.nolate_departure_reminder_depart\),\s*interactionIntent\(payload, DEPARTURE_REMINDER_ACTION_DEPART\)/,
        );
        expect(interaction).toMatch(
            /DEPARTURE_REMINDER_ACTION_DEPART[\s\S]*DepartureAlarmActionJournal\(this\)\.record\(/,
        );
        expect(interaction).toContain("requiresRouteNavigation = false");
        expect(interaction).toMatch(
            /DEPARTURE_REMINDER_ACTION_OPEN_ROUTE[\s\S]*DepartureAlarmNavigationJournal\(this\)\.record\(/,
        );
        expect(read("modules/nolate-alarm/android/src/main/res/values/strings.xml"))
            .toContain('<string name="nolate_departure_reminder_depart">출발 완료</string>');
    });

    it("purges every app notification at Android and iOS account boundaries", () => {
        const androidModule = read(
            "modules/nolate-alarm/android/src/main/java/expo/modules/nolatealarm/" +
            "NoLateAlarmModule.kt",
        );
        const iosCoordinator = read("modules/nolate-alarm/ios/NoLateAlarmCoordinator.swift");
        expect(androidModule).toContain("?.cancelAll()");
        expect(iosCoordinator).toContain("removeAllPendingNotificationRequests()");
        expect(iosCoordinator).toContain("removeAllDeliveredNotifications()");
    });

    it("centralizes fresh-login native activation before authenticated providers mount", () => {
        const authContext = read("src/modules/auth/AuthContext.tsx");
        const activation = authContext.indexOf(
            "await activateDepartureAlarmSyncForAuthenticatedAccount",
        );
        const authenticatedState = authContext.indexOf(
            "setIsAuthenticated(authenticated)",
            activation,
        );
        expect(activation).toBeGreaterThanOrEqual(0);
        expect(authenticatedState).toBeGreaterThan(activation);
        expect(read("app/auth/login.tsx"))
            .not.toContain("activateDepartureAlarmSyncForAuthenticatedAccount");
        expect(read("app/auth/signup.tsx"))
            .not.toContain("activateDepartureAlarmSyncForAuthenticatedAccount");
    });
});
