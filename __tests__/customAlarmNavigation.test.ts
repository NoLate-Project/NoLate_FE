import {
    createNoLateCustomAlarmRoute,
    getNoLateCustomAlarmNavigationTarget,
    getNoLateCustomAlarmRouteFromNotificationData,
    NO_LATE_CUSTOM_ALARM_CONFIRM_DEPARTURE_ACTION,
    NO_LATE_CUSTOM_ALARM_PREVIEW_DEPARTURE_ACTION,
    NO_LATE_CUSTOM_ALARM_PREVIEW_ROUTE_ACTION,
} from "../src/modules/notification/customAlarmNavigation";

const previewId = "5ef854e8-32de-4fde-98fa-280c2e9772dd";
const actionEventKey = `key:${"a".repeat(64)}`;

const actualAlarmData = {
    type: "NOLATE_CUSTOM_ALARM",
    alarmId: "schedule:42:member:7",
    nativeAlarmId: "schedule:42:member:7:occurrence:M0",
    scheduleId: "42",
    recipientMemberId: "7",
    alarmGeneration: "8",
    actionEventKey,
    occurrenceId: "M0",
    isPreview: "false",
};

describe("NoLate custom alarm notification navigation", () => {
    it("maps a preview body tap to the typed custom alarm route", () => {
        const data = {
            type: "NOLATE_CUSTOM_ALARM",
            alarmId: `preview:${previewId}`,
            previewId,
            scheduleId: "42",
            title: "NoLate 출발 알림",
            body: "출발 알람 화면을 확인해 보세요.",
            routeSummary: "서울역 → 강남역 · 36분",
            isPreview: "true",
        };

        expect(getNoLateCustomAlarmRouteFromNotificationData(data, "DEFAULT")).toEqual({
            pathname: "/alarm",
            params: {
                type: "NOLATE_CUSTOM_ALARM",
                alarmId: `preview:${previewId}`,
                previewId,
                scheduleId: "42",
                title: "NoLate 출발 알림",
                body: "출발 알람 화면을 확인해 보세요.",
                routeSummary: "서울역 → 강남역 · 36분",
                isPreview: "1",
                requestedAction: "open",
            },
        });
    });

    it.each([
        [NO_LATE_CUSTOM_ALARM_PREVIEW_ROUTE_ACTION, "route"],
        [NO_LATE_CUSTOM_ALARM_PREVIEW_DEPARTURE_ACTION, "confirmDeparture"],
        [NO_LATE_CUSTOM_ALARM_CONFIRM_DEPARTURE_ACTION, "confirmDeparture"],
    ] as const)("keeps action %s as a UI-only intent", (actionIdentifier, expected) => {
        const target = getNoLateCustomAlarmNavigationTarget({
            type: "NOLATE_CUSTOM_ALARM",
            alarmId: `preview:${previewId}`,
            previewId,
            isPreview: true,
        }, actionIdentifier);

        expect(target?.requestedAction).toBe(expected);
        expect(target && createNoLateCustomAlarmRoute(target)).toMatchObject({
            pathname: "/alarm",
            params: {
                type: "NOLATE_CUSTOM_ALARM",
                requestedAction: expected,
            },
        });
    });

    it("accepts only a canonical actual custom alarm identity", () => {
        expect(getNoLateCustomAlarmNavigationTarget(actualAlarmData)).toEqual({
            kind: "customAlarm",
            alarmId: "schedule:42:member:7",
            nativeAlarmId: "schedule:42:member:7:occurrence:M0",
            scheduleId: "42",
            recipientMemberId: 7,
            alarmGeneration: 8,
            actionEventKey,
            occurrenceId: "M0",
            isPreview: false,
            requestedAction: "open",
        });
    });

    it.each([
        ["missing type", { type: undefined }],
        ["wrong type", { type: "UNRELATED_PAYLOAD" }],
        ["missing native alarm id", { nativeAlarmId: undefined }],
        ["missing recipient", { recipientMemberId: undefined }],
        ["missing generation", { alarmGeneration: undefined }],
        ["missing action event key", { actionEventKey: undefined }],
        ["malformed action event key", { actionEventKey: "event:forged" }],
        ["mismatched recipient identity", { recipientMemberId: "8" }],
        ["mismatched native alarm identity", {
            nativeAlarmId: "schedule:99:member:7:occurrence:M0",
        }],
        ["invalid occurrence", { occurrenceId: "M20" }],
    ])("rejects an actual alarm with %s", (_label, override) => {
        expect(getNoLateCustomAlarmNavigationTarget({
            ...actualAlarmData,
            ...override,
        })).toBeUndefined();
    });

    it("rejects forged preview and route identifiers", () => {
        expect(getNoLateCustomAlarmNavigationTarget({
            type: "NOLATE_CUSTOM_ALARM",
            alarmId: "preview:bad",
            previewId: "bad",
            isPreview: "true",
        })).toBeUndefined();
        expect(getNoLateCustomAlarmNavigationTarget({
            ...actualAlarmData,
            alarmId: "schedule:abc",
            scheduleId: "abc",
        })).toBeUndefined();
    });
});
