import AsyncStorage from "@react-native-async-storage/async-storage";

import {
    postNotificationDeliveryAck,
    type NotificationDeliveryAckPayload,
} from "../src/api/notification";
import { getAuthMember } from "../src/modules/auth/authStorage";
import {
    activatePushDeliveryAckQueueForAuthenticatedMember,
    clearPushDeliveryAckQueueForCurrentAccount,
    deliverPushDeliveryAckDurably,
    drainPushDeliveryAckQueue,
    PUSH_DELIVERY_ACK_QUEUE_TEST_CONSTANTS,
    resetPushDeliveryAckQueueForTests,
} from "../src/modules/notification/pushDeliveryAckQueue";

jest.mock("../src/api/notification", () => ({
    postNotificationDeliveryAck: jest.fn(),
}));

jest.mock("../src/modules/auth/authStorage", () => ({
    getAuthMember: jest.fn(),
}));

const mockedPostAck = jest.mocked(postNotificationDeliveryAck);
const mockedGetAuthMember = jest.mocked(getAuthMember);
const queueConstants = PUSH_DELIVERY_ACK_QUEUE_TEST_CONSTANTS!;

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
} {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

function payload(
    logicalEventKey: string,
    occurredAt = "2026-07-31T01:02:03.000Z",
    stage: NotificationDeliveryAckPayload["stage"] = "RECEIVED",
): NotificationDeliveryAckPayload {
    return {
        logicalEventKey,
        deviceId: "ios-installation-7",
        stage,
        occurredAt,
    };
}

async function readStoredEntries(memberId: number): Promise<Array<{
    key: string;
    payload: NotificationDeliveryAckPayload;
    attemptCount: number;
    nextAttemptAt: number;
    enqueuedAt: number;
}>> {
    const raw = await AsyncStorage.getItem(queueConstants.storageKeyForMember(memberId));
    if (!raw) return [];
    return JSON.parse(raw).entries;
}

describe("durable push delivery ACK queue", () => {
    beforeEach(async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-07-31T01:02:03.000Z"));
        jest.clearAllMocks();
        resetPushDeliveryAckQueueForTests();
        await AsyncStorage.clear();
        mockedGetAuthMember.mockResolvedValue({ id: 7 });
        mockedPostAck.mockResolvedValue(undefined);
    });

    afterEach(() => {
        resetPushDeliveryAckQueueForTests();
        jest.useRealTimers();
    });

    it("retries automatically when the next durable ACK becomes due", async () => {
        mockedPostAck
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce(undefined);

        await expect(deliverPushDeliveryAckDurably(7, payload("event:auto-retry")))
            .resolves.toBe(false);
        expect(mockedPostAck).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(queueConstants.retryDelaysMs[0]);

        expect(mockedPostAck).toHaveBeenCalledTimes(2);
        expect(await readStoredEntries(7)).toEqual([]);
    });

    it("keeps a failed ACK across a process reset and removes it after a due retry succeeds", async () => {
        mockedPostAck
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce(undefined);

        await expect(deliverPushDeliveryAckDurably(7, payload("event:durable-1")))
            .resolves.toBe(false);

        const [failedEntry] = await readStoredEntries(7);
        expect(failedEntry).toMatchObject({
            attemptCount: 1,
            nextAttemptAt: Date.now() + queueConstants.retryDelaysMs[0],
            payload: {
                logicalEventKey: "event:durable-1",
                occurredAt: "2026-07-31T01:02:03.000Z",
            },
        });

        resetPushDeliveryAckQueueForTests();
        jest.setSystemTime(new Date(Date.now() + queueConstants.retryDelaysMs[0] - 1));
        await expect(drainPushDeliveryAckQueue(7)).resolves.toBe(0);
        expect(mockedPostAck).toHaveBeenCalledTimes(1);

        jest.setSystemTime(new Date(Date.now() + 1));
        await expect(activatePushDeliveryAckQueueForAuthenticatedMember()).resolves.toBe(1);
        expect(mockedPostAck).toHaveBeenCalledTimes(2);
        expect(await readStoredEntries(7)).toEqual([]);
    });

    it("coalesces a repeated callback without replacing its original occurredAt or bypassing backoff", async () => {
        mockedPostAck.mockRejectedValue(new Error("offline"));

        await deliverPushDeliveryAckDurably(7, payload(
            "event:durable-original-time",
            "2026-07-31T01:02:03.000Z",
        ));
        jest.setSystemTime(new Date("2026-07-31T01:02:05.000Z"));
        await expect(deliverPushDeliveryAckDurably(7, payload(
            "event:durable-original-time",
            "2026-07-31T01:02:05.000Z",
        ))).resolves.toBe(false);

        expect(mockedPostAck).toHaveBeenCalledTimes(1);
        const [storedEntry] = await readStoredEntries(7);
        expect(storedEntry.attemptCount).toBe(1);
        expect(storedEntry.payload.occurredAt).toBe("2026-07-31T01:02:03.000Z");
    });

    it("uses a new ACK as a recovery point for older due entries", async () => {
        mockedPostAck.mockRejectedValueOnce(new Error("offline"));
        await deliverPushDeliveryAckDurably(7, payload("event:older"));

        jest.setSystemTime(new Date(Date.now() + queueConstants.retryDelaysMs[0]));
        mockedPostAck.mockResolvedValue(undefined);
        await expect(deliverPushDeliveryAckDurably(7, payload("event:new"))).resolves.toBe(true);
        await drainPushDeliveryAckQueue(7);

        expect(mockedPostAck.mock.calls.map(([sent]) => sent.logicalEventKey)).toEqual(
            expect.arrayContaining(["event:older", "event:new"]),
        );
        expect(await readStoredEntries(7)).toEqual([]);
    });

    it("bounds each account queue and evicts the oldest ACK when it is full", async () => {
        const storageKey = queueConstants.storageKeyForMember(7);
        const baseTime = Date.now();
        const seededEntries = Array.from(
            { length: queueConstants.maximumSize },
            (_, index) => {
                const seededPayload = payload(`event:seeded-${index}`);
                return {
                    key: `${seededPayload.logicalEventKey}\u0000${seededPayload.stage}`,
                    payload: seededPayload,
                    attemptCount: 1,
                    nextAttemptAt: baseTime + 60_000,
                    enqueuedAt: baseTime + index,
                };
            },
        );
        await AsyncStorage.setItem(storageKey, JSON.stringify({
            version: 1,
            entries: seededEntries,
        }));
        mockedPostAck.mockRejectedValue(new Error("offline"));

        await deliverPushDeliveryAckDurably(7, payload("event:newest"));

        const entries = await readStoredEntries(7);
        expect(entries).toHaveLength(queueConstants.maximumSize);
        expect(entries.some((entry) => entry.payload.logicalEventKey === "event:seeded-0"))
            .toBe(false);
        expect(entries.some((entry) => entry.payload.logicalEventKey === "event:newest"))
            .toBe(true);
    });

    it("preserves received and alarm evidence ahead of presentation or action ACKs", async () => {
        const storageKey = queueConstants.storageKeyForMember(7);
        const baseTime = Date.now();
        const alarmFired = payload(
            "event:alarm-fired",
            "2026-07-31T01:00:00.000Z",
            "ALARM_FIRED",
        );
        const seededEntries = [
            {
                key: `${alarmFired.logicalEventKey}\u0000${alarmFired.stage}`,
                payload: alarmFired,
                attemptCount: 1,
                nextAttemptAt: baseTime + 60_000,
                enqueuedAt: baseTime,
            },
            ...Array.from({ length: queueConstants.maximumSize - 1 }, (_, index) => {
                const lowValue = payload(
                    `event:presented-${index}`,
                    "2026-07-31T01:00:00.000Z",
                    "PRESENTED",
                );
                return {
                    key: `${lowValue.logicalEventKey}\u0000${lowValue.stage}`,
                    payload: lowValue,
                    attemptCount: 1,
                    nextAttemptAt: baseTime + 60_000,
                    enqueuedAt: baseTime + index + 1,
                };
            }),
        ];
        await AsyncStorage.setItem(storageKey, JSON.stringify({
            version: 1,
            entries: seededEntries,
        }));
        mockedPostAck.mockRejectedValue(new Error("offline"));

        await deliverPushDeliveryAckDurably(7, payload("event:received-new"));

        const entries = await readStoredEntries(7);
        expect(entries).toHaveLength(queueConstants.maximumSize);
        expect(entries.some((entry) => entry.payload.logicalEventKey === "event:alarm-fired"))
            .toBe(true);
        expect(entries.some((entry) => entry.payload.logicalEventKey === "event:received-new"))
            .toBe(true);
        expect(entries.filter((entry) => entry.payload.stage === "PRESENTED"))
            .toHaveLength(queueConstants.maximumSize - 2);
    });

    it("clears and blocks the signing-out account without touching another account", async () => {
        mockedPostAck.mockRejectedValue(new Error("offline"));
        await deliverPushDeliveryAckDurably(7, payload("event:member-7"));
        await AsyncStorage.setItem(
            queueConstants.storageKeyForMember(8),
            JSON.stringify({ version: 1, entries: [] }),
        );

        await clearPushDeliveryAckQueueForCurrentAccount();

        expect(await AsyncStorage.getItem(queueConstants.storageKeyForMember(7))).toBeNull();
        expect(await AsyncStorage.getItem(queueConstants.storageKeyForMember(8))).not.toBeNull();
        mockedPostAck.mockClear();
        await expect(deliverPushDeliveryAckDurably(7, payload("event:after-logout")))
            .resolves.toBe(false);
        expect(mockedPostAck).not.toHaveBeenCalled();
    });

    it("does not let an older bootstrap activation undo a concurrent logout block", async () => {
        const pendingBootstrapMember = deferred<{ id: number }>();
        mockedGetAuthMember
            .mockReturnValueOnce(pendingBootstrapMember.promise)
            .mockResolvedValueOnce({ id: 7 });

        const bootstrap = activatePushDeliveryAckQueueForAuthenticatedMember();
        await clearPushDeliveryAckQueueForCurrentAccount();
        pendingBootstrapMember.resolve({ id: 7 });

        await expect(bootstrap).resolves.toBe(0);
        mockedPostAck.mockClear();
        await expect(deliverPushDeliveryAckDurably(7, payload("event:logout-race")))
            .resolves.toBe(false);
        expect(mockedPostAck).not.toHaveBeenCalled();
    });

    it("recovers from corrupt storage and still sends the current ACK", async () => {
        await AsyncStorage.setItem(queueConstants.storageKeyForMember(7), "not-json");

        await expect(deliverPushDeliveryAckDurably(7, payload("event:after-corruption")))
            .resolves.toBe(true);

        expect(mockedPostAck).toHaveBeenCalledWith(payload("event:after-corruption"));
        expect(await readStoredEntries(7)).toEqual([]);
    });
});
