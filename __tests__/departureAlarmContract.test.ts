import {
    isDepartureAlarmSyncData,
    parseDepartureAlarmSyncCommand,
    parseDepartureAlarmSyncPlanCommand,
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
            alarmValidationRevision: "0",
            alarmTriggerAt: "2026-07-29T03:00:00Z",
            alarmTitle: "회의 출발 시간",
            snoozeMinutes: "5",
            logicalEventKey: "departure-alarm:41:7:3",
        }, memberId, now)).toEqual({
            operation: "UPSERT",
            alarmId: "schedule:41:member:7",
            scheduleId: "41",
            generation: 3,
            validationRevision: 0,
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
            alarmValidationRevision: "2",
        }, memberId, now)).toEqual({
            operation: "CANCEL",
            alarmId: "schedule:41:member:7",
            scheduleId: "41",
            generation: 4,
            validationRevision: 2,
            recipientMemberId: 7,
        });
    });

    it("parses a v2 occurrence plan while retaining elapsed slots for reconciliation", () => {
        const occurrences = [
            {
                occurrenceId: "M15",
                triggerAt: "2026-07-29T01:55:00Z",
                title: "곧 출발할 시간이에요",
                body: "15분 뒤 출발하면 돼요.",
                decision: "ADVANCE_NOTICE",
                minutesBeforeDeparture: 15,
                actionEventKey: `key:${"a".repeat(64)}`,
            },
            {
                occurrenceId: "M10",
                triggerAt: "2026-07-29T02:00:00Z",
                title: "출발 10분 전이에요",
                body: "10분 뒤 출발하면 돼요.",
                decision: "ADVANCE_NOTICE",
                minutesBeforeDeparture: 10,
                actionEventKey: `key:${"b".repeat(64)}`,
            },
            {
                occurrenceId: "M5",
                triggerAt: "2026-07-29T02:05:00Z",
                title: "출발 5분 전이에요",
                body: "5분 뒤 출발하면 돼요.",
                decision: "ADVANCE_NOTICE",
                minutesBeforeDeparture: 5,
                actionEventKey: `key:${"c".repeat(64)}`,
            },
            {
                occurrenceId: "M0",
                triggerAt: "2026-07-29T02:10:00Z",
                title: "지금 출발할 시간이에요",
                body: "지금 출발하면 약속 시간에 맞을 수 있어요.",
                decision: "DEPART_NOW",
                minutesBeforeDeparture: 0,
                actionEventKey: `key:${"d".repeat(64)}`,
            },
        ];
        const plan = parseDepartureAlarmSyncPlanCommand({
            type: "DEPARTURE_ALARM_SYNC",
            alarmSchemaVersion: "1",
            alarmPlanSchemaVersion: "2",
            recipientMemberId: "7",
            alarmOperation: "UPSERT",
            alarmId: "schedule:41:member:7",
            scheduleId: "41",
            alarmGeneration: "5",
            alarmValidationRevision: "3",
            alarmTriggerAt: "2026-07-29T02:10:00Z",
            alarmTitle: "지금 출발할 시간이에요",
            snoozeMinutes: "5",
            alarmOccurrencesJson: JSON.stringify(occurrences),
        }, memberId, now);

        expect(plan).toMatchObject({
            planSchemaVersion: 2,
            generation: 5,
            validationRevision: 3,
            occurrences: [
                {
                    occurrenceId: "M15",
                    nativeAlarmId: "schedule:41:member:7:occurrence:M15",
                },
                expect.objectContaining({ occurrenceId: "M10" }),
                expect.objectContaining({ occurrenceId: "M5" }),
                {
                    occurrenceId: "M0",
                    nativeAlarmId: "schedule:41:member:7:occurrence:M0",
                },
            ],
        });
        expect(parseDepartureAlarmSyncCommand({
            type: "DEPARTURE_ALARM_SYNC",
            alarmSchemaVersion: "1",
            alarmPlanSchemaVersion: "2",
            recipientMemberId: "7",
            alarmOperation: "UPSERT",
            alarmId: "schedule:41:member:7",
            scheduleId: "41",
            alarmGeneration: "5",
            alarmValidationRevision: "3",
            alarmTriggerAt: "2026-07-29T02:10:00Z",
            alarmTitle: "지금 출발할 시간이에요",
            snoozeMinutes: "5",
            alarmOccurrencesJson: JSON.stringify(occurrences),
        }, memberId, now)).toMatchObject({ occurrenceId: "M0" });
    });

    it("rejects a v2 plan whose legacy M0 fields disagree with its M0 occurrence", () => {
        expect(parseDepartureAlarmSyncPlanCommand({
            type: "DEPARTURE_ALARM_SYNC",
            alarmSchemaVersion: "1",
            alarmPlanSchemaVersion: "2",
            recipientMemberId: "7",
            alarmOperation: "UPSERT",
            alarmId: "schedule:41:member:7",
            scheduleId: "41",
            alarmGeneration: "5",
            alarmValidationRevision: "3",
            alarmTriggerAt: "2026-07-29T03:00:00Z",
            alarmTitle: "다른 제목",
            snoozeMinutes: "5",
            alarmOccurrencesJson: JSON.stringify([{
                occurrenceId: "M0",
                triggerAt: "2026-07-29T03:00:00Z",
                title: "지금 출발할 시간이에요",
                body: "본문",
                decision: "DEPART_NOW",
                minutesBeforeDeparture: 0,
                actionEventKey: `key:${"c".repeat(64)}`,
            }]),
        }, memberId, now)).toBeUndefined();
    });

    it("only classifies the reserved sync type as a sync message", () => {
        expect(isDepartureAlarmSyncData({ type: "DEPARTURE_ALARM_SYNC" })).toBe(true);
        expect(isDepartureAlarmSyncData({ type: "SCHEDULE_DEPARTURE_REMINDER" })).toBe(false);
        expect(isDepartureAlarmSyncData(undefined)).toBe(false);
    });

    it("treats a missing validation revision as legacy revision zero", () => {
        expect(parseDepartureAlarmSyncCommand({
            type: "DEPARTURE_ALARM_SYNC",
            alarmSchemaVersion: "1",
            recipientMemberId: "7",
            alarmOperation: "CANCEL",
            alarmId: "schedule:41:member:7",
            scheduleId: "41",
            alarmGeneration: "4",
        }, memberId, now)).toMatchObject({
            generation: 4,
            validationRevision: 0,
        });
    });

    it.each([
        ["negative", "-1"],
        ["non-canonical", "01"],
        ["outside the JavaScript safe integer range", "9007199254740992"],
    ])("rejects a %s validation revision", (_label, alarmValidationRevision) => {
        expect(parseDepartureAlarmSyncCommand({
            type: "DEPARTURE_ALARM_SYNC",
            alarmSchemaVersion: "1",
            recipientMemberId: "7",
            alarmOperation: "CANCEL",
            alarmId: "schedule:41:member:7",
            scheduleId: "41",
            alarmGeneration: "4",
            alarmValidationRevision,
        }, memberId, now)).toBeUndefined();
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
