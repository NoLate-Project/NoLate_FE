import { isIsolatedAlarmVerificationEnvironment as eligible } from "../src/modules/notification/isolatedAlarmVerification";

const allowed = { development: true, platform: "ios", physicalDevice: false,
    apiBase: "http://127.0.0.1:5523", memberId: 296, fixtureMarker: "h2-memory-only" };
test("allows only the marked private simulator backend and synthetic member", () => expect(eligible(allowed)).toBe(true));
test.each([
    { development: false }, { platform: "android" }, { physicalDevice: true },
    { apiBase: "http://127.0.0.1:5522" }, { apiBase: "https://production.example" },
    { memberId: 1 }, { memberId: undefined }, { fixtureMarker: null }, { fixtureMarker: "wrong" },
])("refuses an environment mismatch %j", mutation => expect(eligible({ ...allowed, ...mutation })).toBe(false));

const observationScreen = jest.requireActual("fs").readFileSync(
    "app/internal/eta-alarm-verification.tsx", "utf8",
) as string;

test("native observation exposes safe progress without replacing OS inspection", () => {
    for (const stage of ["FIXTURE", "OS_PERMISSIONS", "CAPABILITIES", "SNAPSHOT", "NATIVE_STORE", "FIRE_EVENTS", "OS_PENDING"]) {
        expect(observationScreen).toContain(`setStatus("INSPECTING_${stage}")`);
    }
    expect(observationScreen).toContain("await Notifications.getAllScheduledNotificationsAsync()");
    expect(observationScreen).toContain('(readOnly === "1" || sync.fetched) && sync.failedCount === 0 ? "INSPECTED" : "SYNC_FAILED"');
});

test("independent OS permission probe is read-only and cannot replace native capabilities", () => {
    expect(observationScreen).toContain("await Notifications.getPermissionsAsync()");
    expect(observationScreen).toContain("osPermissionsReadCompleted: true");
    expect(observationScreen).not.toContain("requestPermissionsAsync");
    expect(observationScreen).toContain("await getDepartureAlarmCapabilities()");
    expect(observationScreen.indexOf("if (!(await authorized()))"))
        .toBeLessThan(observationScreen.indexOf("await Notifications.getPermissionsAsync()"));
    expect(observationScreen.indexOf("await Notifications.getPermissionsAsync()"))
        .toBeLessThan(observationScreen.indexOf("await getDepartureAlarmCapabilities()"));
});

test("native observation still fails closed without rendering exception details", () => {
    expect(observationScreen).toContain('setStatus("BLOCKED")');
    expect(observationScreen).not.toContain("setEvidence(error");
    expect(observationScreen).not.toContain("scheduleDepartureAlarm(");
});
