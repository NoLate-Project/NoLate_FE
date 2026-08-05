import * as Crypto from "expo-crypto";

import {
    claimNoLateCustomAlarmCapability,
    consumeNoLateCustomAlarmCapability,
    hasNoLateCustomAlarmCapability,
    issueNoLateCustomAlarmCapability,
    releaseNoLateCustomAlarmCapability,
    resetNoLateCustomAlarmCapabilitiesForTests,
} from "../src/modules/notification/customAlarmCapability";
import type {
    NoLateCustomAlarmNavigationTarget,
} from "../src/modules/notification/customAlarmNavigation";

jest.mock("expo-crypto", () => ({
    randomUUID: jest.fn(),
}));

const mockedRandomUuid = jest.mocked(Crypto.randomUUID);
const capabilityId = "11111111-1111-4111-8111-111111111111";
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
    isPreview: false,
    requestedAction: "confirmDeparture",
};

describe("NoLate custom alarm in-process capability", () => {
    beforeEach(() => {
        resetNoLateCustomAlarmCapabilitiesForTests();
        mockedRandomUuid.mockReset().mockReturnValue(capabilityId);
    });

    afterEach(() => {
        resetNoLateCustomAlarmCapabilitiesForTests();
    });

    it("authorizes the exact native notification identity that issued it", () => {
        const authorized = issueNoLateCustomAlarmCapability(actualTarget);

        expect(authorized).toEqual({ ...actualTarget, capabilityId });
        expect(hasNoLateCustomAlarmCapability(authorized)).toBe(true);
    });

    it.each([
        ["alarm id", { alarmId: "schedule:43:member:7" }],
        ["preview fence", { isPreview: true }],
        ["requested action", { requestedAction: "open" as const }],
        ["schedule", { scheduleId: "43" }],
        ["notification request", {
            notificationIdentifier: "nolate.departure.schedule-42-M5",
        }],
        ["native alarm", { nativeAlarmId: "schedule:42:member:7:occurrence:M5" }],
        ["recipient", { recipientMemberId: 8 }],
        ["generation", { alarmGeneration: 9 }],
        ["action event key", { actionEventKey: `key:${"b".repeat(64)}` }],
        ["occurrence", { occurrenceId: "M5" }],
    ])("rejects a capability whose %s was tampered", (_label, override) => {
        const authorized = issueNoLateCustomAlarmCapability(actualTarget);

        expect(hasNoLateCustomAlarmCapability({
            ...authorized,
            ...override,
        })).toBe(false);
    });

    it("claims atomically, can be released for a retry, and is inert after consumption", () => {
        const authorized = issueNoLateCustomAlarmCapability(actualTarget);

        expect(claimNoLateCustomAlarmCapability(authorized)).toEqual(authorized);
        expect(claimNoLateCustomAlarmCapability(authorized)).toBeUndefined();

        releaseNoLateCustomAlarmCapability(capabilityId);
        expect(claimNoLateCustomAlarmCapability(authorized)).toEqual(authorized);

        consumeNoLateCustomAlarmCapability(capabilityId);
        expect(hasNoLateCustomAlarmCapability(authorized)).toBe(false);
        expect(claimNoLateCustomAlarmCapability(authorized)).toBeUndefined();
    });

    it("does not authorize a copied route without a capability id", () => {
        issueNoLateCustomAlarmCapability(actualTarget);

        expect(hasNoLateCustomAlarmCapability(actualTarget)).toBe(false);
    });
});
