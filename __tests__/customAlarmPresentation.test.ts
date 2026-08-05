import * as Crypto from "expo-crypto";

import {
    issueNoLateCustomAlarmCapability,
    resetNoLateCustomAlarmCapabilitiesForTests,
} from "../src/modules/notification/customAlarmCapability";
import {
    createNoLateCustomAlarmRoute,
    type NoLateCustomAlarmNavigationTarget,
} from "../src/modules/notification/customAlarmNavigation";
import {
    canCompleteNoLateCustomAlarmDeparture,
    formatNoLateAlarmTime,
    parseNoLateCustomAlarmPresentation,
} from "../src/modules/notification/customAlarmPresentation";

jest.mock("expo-crypto", () => ({
    randomUUID: jest.fn(),
}));

const mockedRandomUuid = jest.mocked(Crypto.randomUUID);
const capabilityId = "22222222-2222-4222-8222-222222222222";
const previewId = "5ef854e8-32de-4fde-98fa-280c2e9772dd";
const actionEventKey = `key:${"a".repeat(64)}`;

const actualTarget: NoLateCustomAlarmNavigationTarget = {
    kind: "customAlarm",
    alarmId: "schedule:42:member:7",
    nativeAlarmId: "schedule:42:member:7:occurrence:M0",
    notificationIdentifier: "nolate.departure.schedule-42-M0",
    scheduleId: "42",
    recipientMemberId: 7,
    alarmGeneration: 8,
    actionEventKey,
    occurrenceId: "M0",
    title: "  지금 출발하세요  ",
    body: "강남역까지 36분 · 지금 출발하면 정시에 도착해요.",
    routeSummary: "서울역 → 강남역 · 대중교통 36분",
    isPreview: false,
    requestedAction: "open",
};

function authorizedParams(target: NoLateCustomAlarmNavigationTarget = actualTarget) {
    return createNoLateCustomAlarmRoute(
        issueNoLateCustomAlarmCapability(target),
    ).params;
}

describe("NoLate custom alarm route presentation", () => {
    beforeEach(() => {
        resetNoLateCustomAlarmCapabilitiesForTests();
        mockedRandomUuid.mockReset().mockReturnValue(capabilityId);
    });

    afterEach(() => {
        resetNoLateCustomAlarmCapabilitiesForTests();
    });

    test("accepts a canonical capability-backed real alarm and enables its actions", () => {
        const presentation = parseNoLateCustomAlarmPresentation(authorizedParams());

        expect(presentation).toMatchObject({
            alarmId: "schedule:42:member:7",
            capabilityId,
            notificationIdentifier: "nolate.departure.schedule-42-M0",
            nativeAlarmId: "schedule:42:member:7:occurrence:M0",
            scheduleId: "42",
            recipientMemberId: 7,
            alarmGeneration: 8,
            actionEventKey,
            occurrenceId: "M0",
            title: "지금 출발하세요",
            body: "강남역까지 36분 · 지금 출발하면 정시에 도착해요.",
            routeSummary: "서울역 → 강남역 · 대중교통 36분",
            isPreview: false,
            hasValidAlarmIdentity: true,
            canOpenRoute: true,
            canCompleteDeparture: true,
            requestedAction: "open",
            instanceKey: capabilityId,
        });
        expect(canCompleteNoLateCustomAlarmDeparture(presentation)).toBe(true);
    });

    test.each(["open", "route", "confirmDeparture"] as const)(
        "keeps a capability-backed preview action %s UI-only",
        (requestedAction) => {
            const presentation = parseNoLateCustomAlarmPresentation(authorizedParams({
                kind: "customAlarm",
                alarmId: `preview:${previewId}`,
                notificationIdentifier: "nolate.custom-alarm.preview.current",
                previewId,
                scheduleId: "42",
                isPreview: true,
                requestedAction,
            }));

            expect(presentation).toMatchObject({
                isPreview: true,
                hasValidAlarmIdentity: true,
                canOpenRoute: true,
                canCompleteDeparture: false,
                requestedAction,
            });
            expect(canCompleteNoLateCustomAlarmDeparture(presentation)).toBe(false);
        },
    );

    test("keeps a forged query inert even when every visible identity field looks canonical", () => {
        const presentation = parseNoLateCustomAlarmPresentation({
            ...createNoLateCustomAlarmRoute(actualTarget).params,
            capabilityId: "33333333-3333-4333-8333-333333333333",
        });

        expect(presentation).toMatchObject({
            alarmId: "schedule:42:member:7",
            isPreview: false,
            hasValidAlarmIdentity: false,
            canOpenRoute: false,
            canCompleteDeparture: false,
        });
        expect(canCompleteNoLateCustomAlarmDeparture(presentation)).toBe(false);
    });

    test("requires the exact payload type even for a valid in-process capability", () => {
        const params = authorizedParams();

        expect(parseNoLateCustomAlarmPresentation({
            ...params,
            type: undefined,
        })).toMatchObject({
            hasValidAlarmIdentity: false,
            canOpenRoute: false,
            canCompleteDeparture: false,
        });
        expect(parseNoLateCustomAlarmPresentation({
            ...params,
            type: "UNRELATED_PAYLOAD",
        })).toMatchObject({
            hasValidAlarmIdentity: false,
            canOpenRoute: false,
            canCompleteDeparture: false,
        });
    });

    test.each([
        ["recipient", { recipientMemberId: "8" }],
        ["generation", { alarmGeneration: "9" }],
        ["native alarm", { nativeAlarmId: "schedule:42:member:7:occurrence:M5" }],
        ["notification request", {
            notificationIdentifier: "nolate.departure.schedule-42-M5",
        }],
        ["event key", { actionEventKey: `key:${"b".repeat(64)}` }],
        ["requested action", { requestedAction: "route" }],
    ])("invalidates a capability after %s query tampering", (_label, override) => {
        const params = authorizedParams();

        expect(parseNoLateCustomAlarmPresentation({
            ...params,
            ...override,
        })).toMatchObject({
            hasValidAlarmIdentity: false,
            canOpenRoute: false,
            canCompleteDeparture: false,
        });
    });

    test("keeps malformed or missing deep-link parameters inert and uses safe copy", () => {
        const presentation = parseNoLateCustomAlarmPresentation({
            type: "UNRELATED_PAYLOAD",
            alarmId: "../../bad alarm",
            scheduleId: "0",
            title: ["\u0000  ", "ignored"],
            body: "\n\t",
        });

        expect(presentation).toEqual({
            title: "출발 알람",
            body: "지금 출발할 시간이에요.",
            isPreview: false,
            hasValidAlarmIdentity: false,
            canOpenRoute: false,
            canCompleteDeparture: false,
            requestedAction: "open",
            instanceKey: "invalid-alarm",
        });
    });

    test("normalizes array params, whitespace, control characters, and display length", () => {
        const presentation = parseNoLateCustomAlarmPresentation({
            alarmId: ["alarm.valid-1", "ignored"],
            scheduleId: [" 17 ", "18"],
            title: `  출발\n알림 ${"가".repeat(100)}  `,
            body: `본문\u0000 ${"나".repeat(300)}`,
            routeSummary: ` 집   →   회사 ${"다".repeat(180)}`,
        });

        expect(presentation.scheduleId).toBe("17");
        expect(presentation.title).not.toContain("\n");
        expect(presentation.title).not.toContain("\u0000");
        expect(presentation.title.length).toBeLessThanOrEqual(80);
        expect(presentation.body.length).toBeLessThanOrEqual(240);
        expect(presentation.routeSummary?.length).toBeLessThanOrEqual(160);
        expect(presentation.routeSummary).toContain("집 → 회사");
        expect(presentation.hasValidAlarmIdentity).toBe(false);
    });

    test.each([
        [new Date(2026, 7, 4, 0, 5), "오전 12:05"],
        [new Date(2026, 7, 4, 9, 7), "오전 9:07"],
        [new Date(2026, 7, 4, 12, 30), "오후 12:30"],
        [new Date(2026, 7, 4, 23, 59), "오후 11:59"],
    ])("formats the current alarm time without seconds", (value, expected) => {
        expect(formatNoLateAlarmTime(value)).toBe(expected);
    });
});
