import {
    isDepartureAlarmSyncData,
    parseDepartureAlarmSyncCommand,
    parseStrictUtcInstantMilliseconds,
} from "../src/modules/notification/departureAlarmContract";

describe("departure alarm sync contract", () => {
    const memberId = 7;
    const now = Date.parse("2026-07-29T02:00:00Z");

    it("parses a valid upsert command", () => {
        expect(parseDepartureAlarmSyncCommand({
            type: "DEPARTURE_ALARM_SYNC",
            alarmSchemaVersion: "1",
            recipientMemberId: "7",
            alarmOperation: "UPSERT",
            alarmId: "schedule:41:member:7",
            scheduleId: "41",
            alarmGeneration: "3",
            alarmTriggerAt: "2026-07-29T03:00:00Z",
            alarmTitle: "회의 출발 시간",
            snoozeMinutes: "5",
            logicalEventKey: "departure-alarm:41:7:3",
        }, memberId, now)).toEqual({
            operation: "UPSERT",
            alarmId: "schedule:41:member:7",
            scheduleId: "41",
            generation: 3,
            recipientMemberId: 7,
            logicalEventKey: "departure-alarm:41:7:3",
            triggerAt: "2026-07-29T03:00:00Z",
            title: "회의 출발 시간",
            snoozeMinutes: 5,
        });
    });

    it("allows cancellation without a trigger time", () => {
        expect(parseDepartureAlarmSyncCommand({
            type: "DEPARTURE_ALARM_SYNC",
            alarmSchemaVersion: "1",
            recipientMemberId: "7",
            alarmOperation: "CANCEL",
            alarmId: "schedule:41:member:7",
            scheduleId: "41",
            alarmGeneration: "4",
        }, memberId, now)).toEqual({
            operation: "CANCEL",
            alarmId: "schedule:41:member:7",
            scheduleId: "41",
            generation: 4,
            recipientMemberId: 7,
        });
    });

    it("only classifies the reserved sync type as a sync message", () => {
        expect(isDepartureAlarmSyncData({ type: "DEPARTURE_ALARM_SYNC" })).toBe(true);
        expect(isDepartureAlarmSyncData({ type: "SCHEDULE_DEPARTURE_REMINDER" })).toBe(false);
        expect(isDepartureAlarmSyncData(undefined)).toBe(false);
    });

    it.each([
        ["missing payload", undefined],
        ["missing schema", {
            type: "DEPARTURE_ALARM_SYNC",
        }],
        ["wrong schema", {
            type: "DEPARTURE_ALARM_SYNC",
            alarmSchemaVersion: "2",
        }],
        ["wrong account", {
            type: "DEPARTURE_ALARM_SYNC",
            alarmSchemaVersion: "1",
            recipientMemberId: "8",
            alarmOperation: "CANCEL",
            alarmId: "schedule:41:member:8",
            scheduleId: "41",
            alarmGeneration: "4",
        }],
        ["non-deterministic alarm id", {
            type: "DEPARTURE_ALARM_SYNC",
            alarmSchemaVersion: "1",
            recipientMemberId: "7",
            alarmOperation: "CANCEL",
            alarmId: "schedule:41",
            scheduleId: "41",
            alarmGeneration: "4",
        }],
        ["missing upsert fields", {
            type: "DEPARTURE_ALARM_SYNC",
            alarmSchemaVersion: "1",
            recipientMemberId: "7",
            alarmOperation: "UPSERT",
            alarmId: "schedule:41:member:7",
            scheduleId: "41",
            alarmGeneration: "1",
        }],
        ["non-canonical schedule id", {
            type: "DEPARTURE_ALARM_SYNC",
            alarmSchemaVersion: "1",
            recipientMemberId: "7",
            alarmOperation: "UPSERT",
            alarmId: "schedule:041:member:7",
            scheduleId: "041",
            alarmGeneration: "1",
            alarmTriggerAt: "2026-07-29T03:00:00Z",
            alarmTitle: "회의",
            snoozeMinutes: "5",
        }],
        ["past trigger", {
            type: "DEPARTURE_ALARM_SYNC",
            alarmSchemaVersion: "1",
            recipientMemberId: "7",
            alarmOperation: "UPSERT",
            alarmId: "schedule:41:member:7",
            scheduleId: "41",
            alarmGeneration: "1",
            alarmTriggerAt: "2026-07-29T01:00:00Z",
            alarmTitle: "회의",
            snoozeMinutes: "5",
        }],
        ["cancel carrying upsert fields", {
            type: "DEPARTURE_ALARM_SYNC",
            alarmSchemaVersion: "1",
            recipientMemberId: "7",
            alarmOperation: "CANCEL",
            alarmId: "schedule:41:member:7",
            scheduleId: "41",
            alarmGeneration: "2",
            alarmTitle: "회의",
        }],
        ["whitespace-normalized title", {
            type: "DEPARTURE_ALARM_SYNC",
            alarmSchemaVersion: "1",
            recipientMemberId: "7",
            alarmOperation: "UPSERT",
            alarmId: "schedule:41:member:7",
            scheduleId: "41",
            alarmGeneration: "1",
            alarmTriggerAt: "2026-07-29T03:00:00Z",
            alarmTitle: " 회의",
            snoozeMinutes: "5",
        }],
    ] as Array<[string, Record<string, unknown> | undefined]>)(
        "rejects %s",
        (_label, payload) => {
            expect(parseDepartureAlarmSyncCommand(
                payload as Record<string, unknown> | undefined,
                memberId,
                now,
            )).toBeUndefined();
        },
    );

    it.each([
        "2026-02-30T03:00:00Z",
        "2026-07-29T03:00:00",
        "2026-07-29T12:00:00+09:00",
        "2026-07-29T03:00:00.1234567890Z",
        " 2026-07-29T03:00:00Z",
    ])("rejects a non-server Instant timestamp: %s", (value) => {
        expect(parseStrictUtcInstantMilliseconds(value)).toBeUndefined();
    });

    it("accepts UTC Instants with up to nanosecond precision", () => {
        expect(parseStrictUtcInstantMilliseconds("2026-07-29T03:00:00Z"))
            .toBe(Date.parse("2026-07-29T03:00:00Z"));
        expect(parseStrictUtcInstantMilliseconds("2026-07-29T03:00:00.123456789Z"))
            .toBe(Date.parse("2026-07-29T03:00:00.123Z"));
    });
});
