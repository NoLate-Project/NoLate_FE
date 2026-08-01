import AsyncStorage from "@react-native-async-storage/async-storage";

import { recordScheduleArrivalObservation } from "../src/api/schedule";
import { ApiResponseError } from "../src/api/response";
import { getAuthMember } from "../src/modules/auth/authStorage";
import { isDepartureAlarmAccountCleanupPending } from "../src/modules/notification/departureAlarmSync";
import {
    activateScheduleArrivalObservationQueueForAuthenticatedMember,
    clearScheduleArrivalObservationQueueForCurrentAccount,
    recordScheduleArrivalDurably,
    resetScheduleArrivalObservationQueueForTests,
    SCHEDULE_ARRIVAL_QUEUE_TEST_CONSTANTS,
} from "../src/modules/schedule/scheduleArrivalObservationQueue";

jest.mock("../src/api/schedule", () => ({
    recordScheduleArrivalObservation: jest.fn(),
}));

jest.mock("../src/modules/auth/authStorage", () => ({
    getAuthMember: jest.fn(),
}));

jest.mock("../src/modules/notification/departureAlarmSync", () => ({
    isDepartureAlarmAccountCleanupPending: jest.fn(),
}));

const mockedRecordArrival = jest.mocked(recordScheduleArrivalObservation);
const mockedGetAuthMember = jest.mocked(getAuthMember);
const mockedCleanupPending = jest.mocked(isDepartureAlarmAccountCleanupPending);
const constants = SCHEDULE_ARRIVAL_QUEUE_TEST_CONSTANTS!;

type StoredEntry = {
    scheduleId: string;
    arrivedAt: string;
    observationSource: "USER_NOW" | "USER_ADJUSTED" | "GEOFENCE";
    precisionSeconds: number;
    adjustmentSeconds?: number;
    clientAppVersion?: string;
    clientBuildVersion?: string;
    attemptCount: number;
    nextAttemptAt: number;
    enqueuedAt: number;
};

async function entries(memberId = 7): Promise<StoredEntry[]> {
    const raw = await AsyncStorage.getItem(constants.storageKeyForMember(memberId));
    if (!raw) return [];
    return (JSON.parse(raw) as { entries: StoredEntry[] }).entries;
}

function userNow(arrivedAt: string) {
    return {
        arrivedAt,
        observationSource: "USER_NOW" as const,
        precisionSeconds: 30,
    };
}

describe("durable schedule arrival observation queue", () => {
    beforeEach(async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-08-01T01:00:00Z"));
        resetScheduleArrivalObservationQueueForTests();
        await AsyncStorage.clear();
        mockedGetAuthMember.mockResolvedValue({ id: 7 });
        mockedCleanupPending.mockResolvedValue(false);
        mockedRecordArrival.mockResolvedValue({} as never);
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    it("persists the callback timestamp before the first API attempt and removes it on success", async () => {
        const arrivedAt = "2026-08-01T00:59:58.123Z";
        mockedRecordArrival.mockImplementationOnce(async () => {
            expect(await entries()).toEqual([
                expect.objectContaining({ scheduleId: "41", arrivedAt }),
            ]);
            return {} as never;
        });

        await expect(recordScheduleArrivalDurably("41", userNow(arrivedAt))).resolves.toBe("sent");

        expect(mockedRecordArrival).toHaveBeenCalledWith("41", userNow(arrivedAt));
        expect(await entries()).toEqual([]);
    });

    it("keeps one immutable arrivedAt offline and retries it after process restart", async () => {
        const firstArrivedAt = "2026-08-01T00:59:58.000Z";
        mockedRecordArrival.mockRejectedValueOnce(new Error("offline"));

        await expect(recordScheduleArrivalDurably("41", userNow(firstArrivedAt)))
            .resolves.toBe("queued");
        expect(await entries()).toEqual([
            expect.objectContaining({
                scheduleId: "41",
                arrivedAt: firstArrivedAt,
                attemptCount: 1,
            }),
        ]);

        resetScheduleArrivalObservationQueueForTests();
        jest.setSystemTime(new Date(Date.now() + constants.retryDelaysMs[0]));
        mockedRecordArrival.mockResolvedValueOnce({} as never);

        await expect(activateScheduleArrivalObservationQueueForAuthenticatedMember())
            .resolves.toBe(1);
        expect(mockedRecordArrival).toHaveBeenLastCalledWith("41", userNow(firstArrivedAt));
        expect(await entries()).toEqual([]);
    });

    it("automatically retries the earliest queued observation while the app remains active", async () => {
        mockedRecordArrival
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce({} as never);

        await expect(recordScheduleArrivalDurably(
            "41",
            userNow("2026-08-01T00:59:58.000Z"),
        )).resolves.toBe("queued");
        expect(jest.getTimerCount()).toBe(1);

        await jest.advanceTimersByTimeAsync(constants.retryDelaysMs[0]);

        expect(mockedRecordArrival).toHaveBeenCalledTimes(2);
        expect(await entries()).toEqual([]);
        expect(jest.getTimerCount()).toBe(0);
    });

    it("cancels the foreground retry timer during account cleanup", async () => {
        mockedRecordArrival.mockRejectedValueOnce(new Error("offline"));
        await recordScheduleArrivalDurably(
            "41",
            userNow("2026-08-01T00:59:58.000Z"),
        );
        expect(jest.getTimerCount()).toBe(1);

        await clearScheduleArrivalObservationQueueForCurrentAccount();
        await jest.advanceTimersByTimeAsync(constants.retryDelaysMs[0]);

        expect(mockedRecordArrival).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it("keeps one earliest retry timer for multiple queued observations", async () => {
        mockedRecordArrival.mockRejectedValue(new Error("offline"));

        await recordScheduleArrivalDurably(
            "41",
            userNow("2026-08-01T00:59:58.000Z"),
        );
        await recordScheduleArrivalDurably(
            "42",
            userNow("2026-08-01T00:59:59.000Z"),
        );

        expect(await entries()).toHaveLength(2);
        expect(jest.getTimerCount()).toBe(1);
    });

    it("deduplicates a repeated schedule and never replaces the first callback time", async () => {
        mockedRecordArrival.mockRejectedValue(new Error("offline"));
        const firstArrivedAt = "2026-08-01T00:59:58.000Z";

        await recordScheduleArrivalDurably("41", userNow(firstArrivedAt));
        await recordScheduleArrivalDurably("41", {
            arrivedAt: "2026-08-01T01:05:00.000Z",
            observationSource: "USER_ADJUSTED",
            precisionSeconds: 60,
            adjustmentSeconds: 300,
        });

        expect(await entries()).toEqual([
            expect.objectContaining({ scheduleId: "41", arrivedAt: firstArrivedAt }),
        ]);
        expect(mockedRecordArrival).toHaveBeenCalledTimes(1);
    });

    it("drops a permanent server rejection instead of retrying an immutable invalid sample forever", async () => {
        mockedRecordArrival.mockRejectedValueOnce(
            new ApiResponseError("invalid arrival", { status: 400, errorCode: "C001" }),
        );

        await expect(recordScheduleArrivalDurably("41", userNow("2026-08-01T00:59:58.000Z")))
            .resolves.toBe("rejected");

        expect(await entries()).toEqual([]);
        jest.setSystemTime(new Date(Date.now() + constants.retryDelaysMs[0]));
        await expect(activateScheduleArrivalObservationQueueForAuthenticatedMember())
            .resolves.toBe(0);
        expect(mockedRecordArrival).toHaveBeenCalledTimes(1);
    });

    it("keeps queues account-scoped and clears only the signing-out account", async () => {
        mockedRecordArrival.mockRejectedValue(new Error("offline"));
        await recordScheduleArrivalDurably("41", userNow("2026-08-01T00:59:58.000Z"));
        await AsyncStorage.setItem(
            constants.storageKeyForMember(8),
            JSON.stringify({ version: 1, entries: [] }),
        );

        await clearScheduleArrivalObservationQueueForCurrentAccount();

        expect(await AsyncStorage.getItem(constants.storageKeyForMember(7))).toBeNull();
        expect(await AsyncStorage.getItem(constants.storageKeyForMember(8))).not.toBeNull();
        mockedRecordArrival.mockClear();
        await expect(recordScheduleArrivalDurably("42", userNow("2026-08-01T01:00:00Z")))
            .resolves.toBe("rejected");
        expect(mockedRecordArrival).not.toHaveBeenCalled();
    });

    it("uses the active account binding to purge exact arrival time if auth cache read fails", async () => {
        mockedRecordArrival.mockRejectedValueOnce(new Error("offline"));
        await recordScheduleArrivalDurably("41", userNow("2026-08-01T00:59:58.000Z"));
        mockedGetAuthMember.mockRejectedValueOnce(new Error("secure cache unavailable"));

        await expect(clearScheduleArrivalObservationQueueForCurrentAccount())
            .resolves.toBeUndefined();
        expect(await AsyncStorage.getItem(constants.storageKeyForMember(7))).toBeNull();
    });

    it("does not reactivate or write while durable account cleanup is pending", async () => {
        mockedCleanupPending.mockResolvedValue(true);

        await expect(recordScheduleArrivalDurably("41", userNow("2026-08-01T00:59:58.000Z")))
            .resolves.toBe("rejected");
        await expect(activateScheduleArrivalObservationQueueForAuthenticatedMember())
            .resolves.toBe(0);

        expect(mockedRecordArrival).not.toHaveBeenCalled();
        expect(await entries()).toEqual([]);
    });

    it("rejects unauthenticated or malformed observations without writing", async () => {
        mockedGetAuthMember.mockResolvedValueOnce(null);
        await expect(recordScheduleArrivalDurably("41", userNow("2026-08-01T01:00:00Z")))
            .resolves.toBe("rejected");
        await expect(recordScheduleArrivalDurably("not-an-id", {
            arrivedAt: "not-an-instant",
            observationSource: "USER_NOW",
            precisionSeconds: 30,
        }))
            .resolves.toBe("rejected");

        expect(mockedRecordArrival).not.toHaveBeenCalled();
        expect(await entries()).toEqual([]);
    });

    it("bounds a corrupt or oversized account queue", async () => {
        const base = Date.now();
        const seeded = Array.from({ length: constants.maximumSize + 5 }, (_, index) => ({
            scheduleId: String(index + 1),
            arrivedAt: "2026-08-01T00:59:58.000Z",
            attemptCount: 1,
            nextAttemptAt: base + 60_000,
            enqueuedAt: base + index,
        }));
        await AsyncStorage.setItem(
            constants.storageKeyForMember(7),
            JSON.stringify({ version: 1, entries: seeded }),
        );
        mockedRecordArrival.mockRejectedValue(new Error("offline"));

        await recordScheduleArrivalDurably("999", userNow("2026-08-01T01:00:00Z"));

        const stored = await entries();
        expect(stored).toHaveLength(constants.maximumSize);
        expect(stored.some((entry) => entry.scheduleId === "1")).toBe(false);
        expect(stored.some((entry) => entry.scheduleId === "999")).toBe(true);
    });

    it("persists USER_ADJUSTED quality provenance and replays the same bounded correction", async () => {
        const adjusted = {
            arrivedAt: "2026-08-01T00:55:00.000Z",
            observationSource: "USER_ADJUSTED" as const,
            precisionSeconds: 60,
            adjustmentSeconds: 300,
        };
        mockedRecordArrival.mockRejectedValueOnce(new Error("offline"));

        await expect(recordScheduleArrivalDurably("41", adjusted)).resolves.toBe("queued");
        expect(await entries()).toEqual([
            expect.objectContaining({ scheduleId: "41", ...adjusted }),
        ]);

        resetScheduleArrivalObservationQueueForTests();
        jest.setSystemTime(new Date(Date.now() + constants.retryDelaysMs[0]));
        mockedRecordArrival.mockResolvedValueOnce({} as never);
        await activateScheduleArrivalObservationQueueForAuthenticatedMember();

        expect(mockedRecordArrival).toHaveBeenLastCalledWith("41", adjusted);
        expect(await entries()).toEqual([]);
    });

    it("persists bounded app and build cohort provenance across offline replay", async () => {
        const captured = {
            ...userNow("2026-08-01T00:59:58.000Z"),
            clientAppVersion: "1.2.0",
            clientBuildVersion: "42",
        };
        mockedRecordArrival.mockRejectedValueOnce(new Error("offline"));

        await expect(recordScheduleArrivalDurably("41", captured)).resolves.toBe("queued");
        expect(await entries()).toEqual([
            expect.objectContaining({ scheduleId: "41", ...captured }),
        ]);

        resetScheduleArrivalObservationQueueForTests();
        jest.setSystemTime(new Date(Date.now() + constants.retryDelaysMs[0]));
        mockedRecordArrival.mockResolvedValueOnce({} as never);
        await activateScheduleArrivalObservationQueueForAuthenticatedMember();

        expect(mockedRecordArrival).toHaveBeenLastCalledWith("41", captured);
    });

    it("drops malformed optional cohort values instead of persisting unbounded tags", async () => {
        const captured = {
            ...userNow("2026-08-01T00:59:58.000Z"),
            clientAppVersion: "x".repeat(65),
            clientBuildVersion: "bad value",
        };

        await expect(recordScheduleArrivalDurably("41", captured)).resolves.toBe("sent");
        expect(mockedRecordArrival).toHaveBeenCalledWith(
            "41",
            userNow("2026-08-01T00:59:58.000Z"),
        );
    });

    it("rejects malformed source precision and adjustment combinations before durable write", async () => {
        const invalid = [
            { arrivedAt: "2026-08-01T01:00:00Z", observationSource: "USER_NOW", precisionSeconds: 0 },
            { arrivedAt: "2026-08-01T01:00:00Z", observationSource: "USER_NOW", precisionSeconds: 30, adjustmentSeconds: 60 },
            { arrivedAt: "2026-08-01T00:55:00Z", observationSource: "USER_ADJUSTED", precisionSeconds: 60 },
            { arrivedAt: "2026-08-01T00:55:00Z", observationSource: "USER_ADJUSTED", precisionSeconds: 59, adjustmentSeconds: 300 },
            { arrivedAt: "2026-08-01T00:55:00Z", observationSource: "USER_ADJUSTED", precisionSeconds: 60, adjustmentSeconds: 301 },
        ];

        for (const capture of invalid) {
            await expect(recordScheduleArrivalDurably("41", capture as never))
                .resolves.toBe("rejected");
        }
        expect(mockedRecordArrival).not.toHaveBeenCalled();
        expect(await entries()).toEqual([]);
    });

    it("migrates legacy v1 record-now entries with conservative quality provenance", async () => {
        const legacyArrivedAt = "2026-08-01T00:59:58.000Z";
        await AsyncStorage.setItem(
            constants.storageKeyForMember(7),
            JSON.stringify({
                version: constants.legacySchemaVersion,
                entries: [{
                    scheduleId: "41",
                    arrivedAt: legacyArrivedAt,
                    attemptCount: 0,
                    nextAttemptAt: Date.now(),
                    enqueuedAt: Date.now(),
                }],
            }),
        );

        await expect(activateScheduleArrivalObservationQueueForAuthenticatedMember())
            .resolves.toBe(1);
        expect(mockedRecordArrival).toHaveBeenCalledWith("41", userNow(legacyArrivedAt));
    });

    it("purges plaintext arrival time at the 24-hour local retention boundary", async () => {
        const expiredAt = Date.now() - constants.entryTtlMs;
        await AsyncStorage.setItem(
            constants.storageKeyForMember(7),
            JSON.stringify({
                version: constants.schemaVersion,
                entries: [{
                    scheduleId: "41",
                    ...userNow("2026-07-31T01:00:00.000Z"),
                    attemptCount: 1,
                    nextAttemptAt: expiredAt,
                    enqueuedAt: expiredAt,
                }],
            }),
        );

        await expect(activateScheduleArrivalObservationQueueForAuthenticatedMember())
            .resolves.toBe(0);
        expect(await AsyncStorage.getItem(constants.storageKeyForMember(7))).toBeNull();
        expect(mockedRecordArrival).not.toHaveBeenCalled();
    });
});
