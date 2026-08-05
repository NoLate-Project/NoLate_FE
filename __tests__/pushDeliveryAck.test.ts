import AsyncStorage from "@react-native-async-storage/async-storage";

import { postNotificationDeliveryAck } from "../src/api/notification";
import { getAuthMember } from "../src/modules/auth/authStorage";
import {
    acknowledgePushDelivery,
    getLogicalEventKeyFromPushData,
    resetPushDeliveryAckForTests,
} from "../src/modules/notification/pushDeliveryAck";
import { isSamePushNotificationIdentity } from "../src/modules/notification/pushNotificationIdentity";
import {
    getOrCreatePushDeviceId,
} from "../src/modules/notification/pushDeviceIdentity";

jest.mock("../src/api/notification", () => ({
    postNotificationDeliveryAck: jest.fn(),
}));

jest.mock("../src/modules/notification/pushDeviceIdentity", () => ({
    getOrCreatePushDeviceId: jest.fn(),
}));

jest.mock("../src/modules/auth/authStorage", () => ({
    getAuthMember: jest.fn(),
}));

const mockedPostAck = jest.mocked(postNotificationDeliveryAck);
const mockedGetDeviceId = jest.mocked(getOrCreatePushDeviceId);
const mockedGetAuthMember = jest.mocked(getAuthMember);

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
} {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<T>((next, fail) => {
        resolve = next;
        reject = fail;
    });
    return { promise, resolve, reject };
}

async function flushMicrotasksUntil(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        if (predicate()) return;
        await Promise.resolve();
    }
    throw new Error("Expected asynchronous ACK work did not start.");
}

describe("push delivery ACK orchestration", () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        resetPushDeliveryAckForTests();
        await AsyncStorage.clear();
        mockedGetAuthMember.mockResolvedValue({ id: 7 });
        mockedGetDeviceId.mockResolvedValue("ios-installation-7");
        mockedPostAck.mockResolvedValue(undefined);
    });

    it("skips legacy payloads without the canonical logical event key", async () => {
        await expect(acknowledgePushDelivery({
            type: "SCHEDULE_TRAFFIC",
            notificationId: "legacy-12",
        }, "RECEIVED")).resolves.toBe(false);

        expect(mockedGetDeviceId).not.toHaveBeenCalled();
        expect(mockedPostAck).not.toHaveBeenCalled();
    });

    it("rejects empty, non-string, and oversized logical event keys", () => {
        expect(getLogicalEventKeyFromPushData({ logicalEventKey: "  " })).toBeUndefined();
        expect(getLogicalEventKeyFromPushData({ logicalEventKey: 17 })).toBeUndefined();
        expect(getLogicalEventKeyFromPushData({ logicalEventKey: "x".repeat(101) }))
            .toBeUndefined();
    });

    it("matches canonical SDK identities only with the same action, recipient, and schedule", () => {
        const base = {
            scheduleId: "41",
            recipientMemberId: "7",
            actionEventKey: `key:${"a".repeat(64)}`,
        };
        expect(isSamePushNotificationIdentity({ data: base }, { data: { ...base } })).toBe(true);
        expect(isSamePushNotificationIdentity(
            { data: base, providerMessageId: "same-provider" },
            { data: { ...base, scheduleId: "42" }, providerMessageId: "same-provider" },
        )).toBe(false);
        expect(isSamePushNotificationIdentity(
            { data: base, providerMessageId: "same-provider" },
            { data: { ...base, recipientMemberId: "8" }, providerMessageId: "same-provider" },
        )).toBe(false);
        expect(isSamePushNotificationIdentity(
            { data: base, providerMessageId: "same-provider" },
            { data: {}, providerMessageId: "same-provider" },
        )).toBe(false);
        expect(isSamePushNotificationIdentity(
            { data: { ...base, actionEventKey: "malformed" }, providerMessageId: "same-provider" },
            { data: {}, providerMessageId: "same-provider" },
        )).toBe(false);
    });

    it("uses exact provider message identity only when both payloads are legacy", () => {
        expect(isSamePushNotificationIdentity(
            { data: { type: "LEGACY" }, providerMessageId: " provider-41 " },
            { data: {}, providerMessageId: "provider-41" },
        )).toBe(true);
        expect(isSamePushNotificationIdentity(
            { data: {}, providerMessageId: "provider-41" },
            { data: {}, providerMessageId: "provider-42" },
        )).toBe(false);
    });

    it("sends the exact ACK contract and trims optional metadata", async () => {
        await expect(acknowledgePushDelivery(
            { logicalEventKey: " event:push-1 " },
            "ACTIONED",
            {
                occurredAt: "2026-07-31T01:02:03.000Z",
                providerMessageId: " provider-1 ",
                alarmId: " schedule:41:member:7 ",
                actionIdentifier: " schedule_depart_now_action ",
            },
        )).resolves.toBe(true);

        expect(mockedPostAck).toHaveBeenCalledWith({
            logicalEventKey: "event:push-1",
            deviceId: "ios-installation-7",
            stage: "ACTIONED",
            occurredAt: "2026-07-31T01:02:03.000Z",
            providerMessageId: "provider-1",
            alarmId: "schedule:41:member:7",
            actionIdentifier: "schedule_depart_now_action",
        });
    });

    it("captures callback time before secure device identity lookup", async () => {
        jest.useFakeTimers();
        try {
            jest.setSystemTime(new Date("2026-07-31T01:02:03.000Z"));
            const pendingDevice = deferred<string>();
            mockedGetDeviceId.mockReturnValueOnce(pendingDevice.promise);

            const request = acknowledgePushDelivery(
                { logicalEventKey: "event:push-callback-time" },
                "RECEIVED",
            );
            jest.setSystemTime(new Date("2026-07-31T01:02:13.000Z"));
            pendingDevice.resolve("ios-installation-7");

            await expect(request).resolves.toBe(true);
            expect(mockedPostAck).toHaveBeenCalledWith(expect.objectContaining({
                occurredAt: "2026-07-31T01:02:03.000Z",
            }));
        } finally {
            jest.useRealTimers();
        }
    });

    it("coalesces concurrent duplicates and suppresses completed duplicates", async () => {
        const pending = deferred<void>();
        mockedPostAck.mockReturnValueOnce(pending.promise);
        const data = { logicalEventKey: "event:push-2" };

        const first = acknowledgePushDelivery(data, "PRESENTED");
        const duplicate = acknowledgePushDelivery(data, "PRESENTED");

        expect(duplicate).toBe(first);
        await flushMicrotasksUntil(() => mockedPostAck.mock.calls.length === 1);
        expect(mockedPostAck).toHaveBeenCalledTimes(1);

        pending.resolve(undefined);
        await expect(first).resolves.toBe(true);
        await expect(acknowledgePushDelivery(data, "PRESENTED")).resolves.toBe(true);
        expect(mockedPostAck).toHaveBeenCalledTimes(1);
    });

    it("persists a failure and honors backoff before a later hook retries it", async () => {
        jest.useFakeTimers();
        try {
            jest.setSystemTime(new Date("2026-07-31T01:02:03.000Z"));
            mockedPostAck
                .mockRejectedValueOnce(new Error("offline"))
                .mockResolvedValueOnce(undefined);
            const data = { logicalEventKey: "event:push-3" };

            await expect(acknowledgePushDelivery(data, "RECEIVED")).resolves.toBe(false);
            await expect(acknowledgePushDelivery(data, "RECEIVED")).resolves.toBe(false);
            expect(mockedPostAck).toHaveBeenCalledTimes(1);

            jest.setSystemTime(new Date("2026-07-31T01:02:18.000Z"));
            await expect(acknowledgePushDelivery(data, "RECEIVED")).resolves.toBe(true);
            expect(mockedPostAck).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });

    it("does not ACK a push bound to another signed-in member", async () => {
        await expect(acknowledgePushDelivery({
            logicalEventKey: "event:push-member-8",
            recipientMemberId: "8",
        }, "RECEIVED")).resolves.toBe(false);

        expect(mockedGetDeviceId).not.toHaveBeenCalled();
        expect(mockedPostAck).not.toHaveBeenCalled();
    });

    it("does not persist or send without a current authenticated member", async () => {
        mockedGetAuthMember.mockResolvedValue(null);

        await expect(acknowledgePushDelivery({
            logicalEventKey: "event:push-no-session",
            recipientMemberId: "7",
        }, "RECEIVED")).resolves.toBe(false);

        expect(mockedGetDeviceId).not.toHaveBeenCalled();
        expect(mockedPostAck).not.toHaveBeenCalled();
    });

    it("deduplicates independently for each lifecycle stage", async () => {
        const data = { logicalEventKey: "event:push-4" };

        await acknowledgePushDelivery(data, "RECEIVED");
        await acknowledgePushDelivery(data, "PRESENTED");
        await acknowledgePushDelivery(data, "ACTIONED");

        expect(mockedPostAck.mock.calls.map(([payload]) => payload.stage)).toEqual([
            "RECEIVED",
            "PRESENTED",
            "ACTIONED",
        ]);
    });
});
