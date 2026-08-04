import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

import { postDepartureAlarmScheduleReceipt } from "../src/api/notification";
import { ApiResponseError } from "../src/api/response";
import { getAuthMember } from "../src/modules/auth/authStorage";
import { getDepartureAlarmCapabilities } from "../src/modules/notification/departureAlarm";
import {
    activateDepartureAlarmScheduleReceiptQueueForAuthenticatedMember,
    classifyDepartureAlarmReceiptOutcome,
    clearDepartureAlarmScheduleReceiptQueueForCurrentAccount,
    DEPARTURE_ALARM_RECEIPT_QUEUE_TEST_CONSTANTS,
    recordDepartureAlarmScheduleReceiptDurably,
    reserveDepartureAlarmMutationSequence,
    resetDepartureAlarmScheduleReceiptQueueForTests,
} from "../src/modules/notification/departureAlarmScheduleReceiptQueue";
import { getOrCreatePushDeviceId } from "../src/modules/notification/pushDeviceIdentity";

jest.mock("expo-crypto", () => ({ randomUUID: jest.fn() }));
jest.mock("../src/api/notification", () => ({
    postDepartureAlarmScheduleReceipt: jest.fn(),
}));
jest.mock("../src/modules/auth/authStorage", () => ({ getAuthMember: jest.fn() }));
jest.mock("../src/modules/notification/departureAlarm", () => ({
    getDepartureAlarmCapabilities: jest.fn(),
}));
jest.mock("../src/modules/notification/pushDeviceIdentity", () => ({
    getOrCreatePushDeviceId: jest.fn(),
}));

const mockedPost = jest.mocked(postDepartureAlarmScheduleReceipt);
const mockedGetMember = jest.mocked(getAuthMember);
const mockedGetCapabilities = jest.mocked(getDepartureAlarmCapabilities);
const mockedDeviceId = jest.mocked(getOrCreatePushDeviceId);
const mockedRandomUuid = jest.mocked(Crypto.randomUUID);
const constants = DEPARTURE_ALARM_RECEIPT_QUEUE_TEST_CONSTANTS!;
const originalPlatform = Platform.OS;

const upsert = {
    operation: "UPSERT" as const,
    alarmId: "schedule:41:member:7",
    scheduleId: "41",
    generation: 3,
    recipientMemberId: 7,
    triggerAt: "2026-08-01T02:00:00.000Z",
};

async function storedEntries(memberId = 7): Promise<Array<{
    payload: Record<string, unknown>;
    attemptCount: number;
    nextAttemptAt: number;
}>> {
    const raw = await AsyncStorage.getItem(constants.storageKeyForMember(memberId));
    return raw ? (JSON.parse(raw) as { entries: [] }).entries : [];
}

describe("durable departure alarm schedule receipt queue", () => {
    beforeEach(async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-08-01T01:00:00.000Z"));
        resetDepartureAlarmScheduleReceiptQueueForTests();
        await AsyncStorage.clear();
        jest.clearAllMocks();
        mockedGetMember.mockResolvedValue({ id: 7 });
        mockedGetCapabilities.mockResolvedValue({
            supported: true,
            platform: "ios",
            exactAlarmAuthorized: true,
            fullScreenAuthorized: true,
            notificationAuthorized: true,
            deliveryMode: "alarmKit",
        });
        mockedDeviceId.mockResolvedValue("device-stable-7");
        mockedRandomUuid.mockReturnValue("a7360f46-4f44-48b6-ae93-28f11c3f667d");
        mockedPost.mockResolvedValue(undefined);
    });

    afterEach(() => {
        resetDepartureAlarmScheduleReceiptQueueForTests();
        Object.defineProperty(Platform, "OS", { value: originalPlatform });
        jest.useRealTimers();
    });

    it("classifies only actual scheduled upserts and applied cancels as success", () => {
        expect(classifyDepartureAlarmReceiptOutcome(
            upsert,
            { applied: false, scheduled: true, reason: "ALREADY_APPLIED" },
        )).toBe("SCHEDULED");
        expect(classifyDepartureAlarmReceiptOutcome(
            upsert,
            { applied: true, scheduled: false, reason: "PERMISSION_REQUIRED" },
        )).toBe("FAILED");
        expect(classifyDepartureAlarmReceiptOutcome(
            { ...upsert, operation: "CANCEL", triggerAt: undefined },
            { applied: true, scheduled: false },
        )).toBe("CANCELED");
        expect(classifyDepartureAlarmReceiptOutcome(
            { ...upsert, operation: "CANCEL", triggerAt: undefined },
            { applied: false, scheduled: false, reason: "STALE_GENERATION" },
        )).toBe("FAILED");
    });

    it("persists the immutable receipt before its first request", async () => {
        mockedPost.mockImplementationOnce(async (payload) => {
            expect(await storedEntries()).toEqual([
                expect.objectContaining({ payload }),
            ]);
        });

        await expect(recordDepartureAlarmScheduleReceiptDurably(
            upsert,
            { applied: true, scheduled: true },
            "PUSH",
            "2026-08-01T01:00:01.000Z",
        )).resolves.toBe("sent");

        expect(mockedPost).toHaveBeenCalledWith(expect.objectContaining({
            receiptId: "a7360f46-4f44-48b6-ae93-28f11c3f667d",
            scheduleId: 41,
            outcome: "SCHEDULED",
            source: "PUSH",
            platform: "IOS",
            deliveryMode: "IOS_ALARM_KIT",
            deviceId: "device-stable-7",
        }));
        expect(await storedEntries()).toEqual([]);
    });

    it("reserves monotonic occurrence order before receipt capability awaits", async () => {
        const occurrence = { ...upsert, occurrenceId: "M0" as const };
        const capabilityGate: {
            resolve?: (value: Awaited<ReturnType<typeof getDepartureAlarmCapabilities>>) => void;
        } = {};
        mockedGetCapabilities.mockReturnValueOnce(new Promise((resolve) => {
            capabilityGate.resolve = resolve;
        }));
        const firstSequence = await reserveDepartureAlarmMutationSequence(7);
        const first = recordDepartureAlarmScheduleReceiptDurably(
            occurrence,
            { applied: true, scheduled: true },
            "PUSH",
            "2026-08-01T01:00:01.000Z",
            firstSequence,
        );
        for (let attempt = 0; attempt < 10 && mockedGetCapabilities.mock.calls.length === 0; attempt += 1) {
            await Promise.resolve();
        }

        const secondSequence = await reserveDepartureAlarmMutationSequence(7);
        const second = recordDepartureAlarmScheduleReceiptDurably(
            occurrence,
            { applied: false, scheduled: false, deliveryMode: "alarmKit" },
            "PUSH",
            "2026-08-01T01:00:02.000Z",
            secondSequence,
        );
        await second;
        capabilityGate.resolve?.({
            supported: true,
            platform: "ios",
            exactAlarmAuthorized: true,
            fullScreenAuthorized: true,
            notificationAuthorized: true,
            deliveryMode: "alarmKit",
        });
        await first;

        expect([firstSequence, secondSequence]).toEqual([1, 2]);
        expect(mockedPost.mock.calls.map(([payload]) => payload.mutationSequence))
            .toEqual([2, 1]);
        expect(mockedPost.mock.calls.map(([payload]) => payload.outcome))
            .toEqual(["FAILED", "SCHEDULED"]);
    });

    it("rejects an occurrence receipt without its mutation-time sequence", async () => {
        await expect(recordDepartureAlarmScheduleReceiptDurably(
            { ...upsert, occurrenceId: "M5" },
            { applied: true, scheduled: true },
            "PUSH",
        )).resolves.toBe("rejected");
        expect(mockedPost).not.toHaveBeenCalled();
    });

    it("queues an idempotent native replay as SCHEDULED even when applied is false", async () => {
        mockedPost.mockRejectedValueOnce(new Error("offline"));

        await expect(recordDepartureAlarmScheduleReceiptDurably(
            upsert,
            {
                applied: false,
                scheduled: true,
                reason: "ALREADY_APPLIED",
                deliveryMode: "timeSensitive",
            },
            "SNAPSHOT",
        )).resolves.toBe("queued");

        expect(await storedEntries()).toEqual([
            expect.objectContaining({
                payload: expect.objectContaining({
                    outcome: "SCHEDULED",
                    applied: false,
                    scheduled: true,
                    reason: "ALREADY_APPLIED",
                    deliveryMode: "IOS_TIME_SENSITIVE",
                }),
            }),
        ]);
        expect(mockedGetCapabilities).not.toHaveBeenCalled();
    });

    it("records the iOS time-sensitive fallback as a bounded delivery mode", async () => {
        mockedGetCapabilities.mockResolvedValueOnce({
            supported: true,
            platform: "ios",
            exactAlarmAuthorized: false,
            fullScreenAuthorized: false,
            notificationAuthorized: true,
            deliveryMode: "timeSensitive",
        });

        await recordDepartureAlarmScheduleReceiptDurably(
            upsert,
            { applied: true, scheduled: true },
            "PUSH",
        );

        expect(mockedPost).toHaveBeenCalledWith(expect.objectContaining({
            deliveryMode: "IOS_TIME_SENSITIVE",
        }));
    });

    it.each([
        [true, "ANDROID_EXACT"],
        [false, "ANDROID_INEXACT"],
    ] as const)("bounds Android exact=%s to %s", async (exactAlarmAuthorized, expectedMode) => {
        Object.defineProperty(Platform, "OS", { value: "android" });
        mockedGetCapabilities.mockResolvedValueOnce({
            supported: true,
            platform: "android",
            exactAlarmAuthorized,
            fullScreenAuthorized: true,
            notificationAuthorized: true,
        });

        await recordDepartureAlarmScheduleReceiptDurably(
            upsert,
            { applied: true, scheduled: true },
            "PUSH",
        );

        expect(mockedPost).toHaveBeenCalledWith(expect.objectContaining({
            platform: "ANDROID",
            deliveryMode: expectedMode,
        }));
    });

    it("falls back to UNKNOWN without losing the receipt when capabilities fail", async () => {
        mockedGetCapabilities.mockRejectedValueOnce(new Error("native bridge offline"));

        await expect(recordDepartureAlarmScheduleReceiptDurably(
            upsert,
            { applied: true, scheduled: true },
            "PUSH",
        )).resolves.toBe("sent");

        expect(mockedPost).toHaveBeenCalledWith(expect.objectContaining({
            deliveryMode: "UNKNOWN",
        }));
    });

    it("keeps the same receiptId offline and retries after process restart", async () => {
        mockedPost.mockRejectedValueOnce(new Error("offline"));

        await expect(recordDepartureAlarmScheduleReceiptDurably(
            upsert,
            { applied: true, scheduled: true },
            "SNAPSHOT",
        )).resolves.toBe("queued");
        expect(await storedEntries()).toEqual([
            expect.objectContaining({
                payload: expect.objectContaining({
                    receiptId: "a7360f46-4f44-48b6-ae93-28f11c3f667d",
                }),
                attemptCount: 1,
            }),
        ]);

        resetDepartureAlarmScheduleReceiptQueueForTests();
        jest.setSystemTime(new Date(Date.now() + constants.retryDelaysMs[0]));
        await expect(activateDepartureAlarmScheduleReceiptQueueForAuthenticatedMember())
            .resolves.toBe(1);

        expect(mockedPost).toHaveBeenCalledTimes(2);
        expect(mockedPost.mock.calls[1][0].receiptId)
            .toBe("a7360f46-4f44-48b6-ae93-28f11c3f667d");
        expect(await storedEntries()).toEqual([]);
    });

    it("executes persisted backoff while the app remains active", async () => {
        mockedPost.mockRejectedValueOnce(new Error("offline"));

        await expect(recordDepartureAlarmScheduleReceiptDurably(
            upsert,
            { applied: true, scheduled: true },
            "PUSH",
        )).resolves.toBe("queued");
        expect(mockedPost).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(constants.retryDelaysMs[0] - 1);
        expect(mockedPost).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        expect(mockedPost).toHaveBeenCalledTimes(2);
        expect(await storedEntries()).toEqual([]);
    });

    it("uses a new receipt as a recovery point for older due entries", async () => {
        mockedPost.mockRejectedValueOnce(new Error("offline"));
        await recordDepartureAlarmScheduleReceiptDurably(
            upsert,
            { applied: true, scheduled: true },
            "PUSH",
        );
        await Promise.resolve();
        jest.setSystemTime(new Date(Date.now() + constants.retryDelaysMs[0]));
        mockedRandomUuid.mockReturnValue("c4b091a9-d487-443c-aea7-e0a91dbcf19f");

        await recordDepartureAlarmScheduleReceiptDurably(
            { ...upsert, generation: 4 },
            { applied: true, scheduled: true },
            "PUSH",
        );
        await activateDepartureAlarmScheduleReceiptQueueForAuthenticatedMember();

        expect(mockedPost).toHaveBeenCalledTimes(3);
        expect(new Set(mockedPost.mock.calls.map(([payload]) => payload.receiptId))).toEqual(
            new Set([
                "a7360f46-4f44-48b6-ae93-28f11c3f667d",
                "c4b091a9-d487-443c-aea7-e0a91dbcf19f",
            ]),
        );
        expect(await storedEntries()).toEqual([]);
    });

    it("deduplicates duplicate persisted receipt IDs during recovery", async () => {
        const payload = {
            receiptId: "a7360f46-4f44-48b6-ae93-28f11c3f667d",
            alarmId: upsert.alarmId,
            scheduleId: 41,
            generation: 3,
            recipientMemberId: 7,
            operation: "UPSERT",
            triggerAt: upsert.triggerAt,
            outcome: "SCHEDULED",
            applied: true,
            scheduled: true,
            platform: "IOS",
            deliveryMode: "IOS_ALARM_KIT",
            source: "SNAPSHOT",
            occurredAt: "2026-08-01T01:00:00.000Z",
            deviceId: "device-stable-7",
        };
        const entry = { payload, attemptCount: 0, nextAttemptAt: Date.now(), enqueuedAt: Date.now() };
        await AsyncStorage.setItem(constants.storageKeyForMember(7), JSON.stringify({
            version: 1,
            entries: [entry, { ...entry, enqueuedAt: Date.now() + 1 }],
        }));

        await expect(activateDepartureAlarmScheduleReceiptQueueForAuthenticatedMember())
            .resolves.toBe(1);
        expect(mockedPost).toHaveBeenCalledTimes(1);
    });

    it("drops permanent validation rejections but retries authentication and outages", async () => {
        mockedPost.mockRejectedValueOnce(
            new ApiResponseError("invalid", { status: 422 }),
        );
        await expect(recordDepartureAlarmScheduleReceiptDurably(
            upsert,
            { applied: false, scheduled: false },
            "PUSH",
        )).resolves.toBe("rejected");
        expect(await storedEntries()).toEqual([]);

        mockedRandomUuid.mockReturnValue("c4b091a9-d487-443c-aea7-e0a91dbcf19f");
        mockedPost.mockRejectedValueOnce(new ApiResponseError("expired", { status: 401 }));
        await expect(recordDepartureAlarmScheduleReceiptDurably(
            upsert,
            { applied: false, scheduled: false },
            "PUSH",
        )).resolves.toBe("queued");
        expect(await storedEntries()).toHaveLength(1);
    });

    it("clears and blocks only the signing-out account queue", async () => {
        mockedPost.mockRejectedValue(new Error("offline"));
        await recordDepartureAlarmScheduleReceiptDurably(
            upsert,
            { applied: true, scheduled: true },
            "PUSH",
        );
        await AsyncStorage.setItem(
            constants.storageKeyForMember(8),
            JSON.stringify({ version: 1, entries: [] }),
        );

        await clearDepartureAlarmScheduleReceiptQueueForCurrentAccount();

        expect(await AsyncStorage.getItem(constants.storageKeyForMember(7))).toBeNull();
        expect(await AsyncStorage.getItem(constants.storageKeyForMember(8))).not.toBeNull();
        expect(await recordDepartureAlarmScheduleReceiptDurably(
            upsert,
            { applied: true, scheduled: true },
            "PUSH",
        )).toBe("rejected");
        await jest.advanceTimersByTimeAsync(
            constants.retryDelaysMs[constants.retryDelaysMs.length - 1]
        );
        expect(mockedPost).toHaveBeenCalledTimes(1);
    });
});
