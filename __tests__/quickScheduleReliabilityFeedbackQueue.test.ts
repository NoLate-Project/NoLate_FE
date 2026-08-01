import AsyncStorage from "@react-native-async-storage/async-storage";

import { recordQuickScheduleReliabilityFeedback } from "../src/api/schedule";
import { ApiResponseError } from "../src/api/response";
import { getAuthMember } from "../src/modules/auth/authStorage";
import {
    activateQuickScheduleReliabilityFeedbackQueueForAuthenticatedMember,
    clearQuickScheduleReliabilityFeedbackQueueForCurrentAccount,
    QUICK_SCHEDULE_FEEDBACK_QUEUE_TEST_CONSTANTS,
    recordQuickScheduleReliabilityFeedbackDurably,
    resetQuickScheduleReliabilityFeedbackQueueForTests,
} from "../src/modules/schedule/quickScheduleReliabilityFeedbackQueue";
import type { QuickScheduleReliabilityFeedback } from "../src/modules/schedule/types";

jest.mock("../src/api/schedule", () => ({
    recordQuickScheduleReliabilityFeedback: jest.fn(),
}));
jest.mock("../src/modules/auth/authStorage", () => ({
    getAuthMember: jest.fn(),
}));

const mockedRecordFeedback = jest.mocked(recordQuickScheduleReliabilityFeedback);
const mockedGetAuthMember = jest.mocked(getAuthMember);
const constants = QUICK_SCHEDULE_FEEDBACK_QUEUE_TEST_CONSTANTS!;

const analysisId = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const feedback: QuickScheduleReliabilityFeedback = {
    analysisId,
    outcome: "CANCELLED",
    date: "USER_CORRECTED",
    time: "USER_CONFIRMED",
    destination: "UNTOUCHED",
    globalConfirmed: false,
};

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((next, fail) => {
        resolve = next;
        reject = fail;
    });
    return { promise, resolve, reject };
}

async function storedEntries(memberId = 7) {
    const raw = await AsyncStorage.getItem(constants.storageKeyForMember(memberId));
    return raw ? (JSON.parse(raw) as { entries: unknown[] }).entries : [];
}

describe("durable quick-schedule reliability feedback queue", () => {
    beforeEach(async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-08-01T01:00:00Z"));
        resetQuickScheduleReliabilityFeedbackQueueForTests();
        await AsyncStorage.clear();
        mockedGetAuthMember.mockResolvedValue({ id: 7 });
        mockedRecordFeedback.mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    it("persists content-free feedback before sending and removes it after success", async () => {
        mockedRecordFeedback.mockImplementationOnce(async () => {
            expect(await storedEntries()).toEqual([
                expect.objectContaining({ analysisId, outcome: "CANCELLED" }),
            ]);
        });

        await expect(recordQuickScheduleReliabilityFeedbackDurably(feedback)).resolves.toBe("sent");

        expect(mockedRecordFeedback).toHaveBeenCalledWith(feedback);
        expect(await storedEntries()).toEqual([]);
    });

    it("retains a transient failure and retries it without reopening the modal", async () => {
        mockedRecordFeedback
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce(undefined);

        await expect(recordQuickScheduleReliabilityFeedbackDurably(feedback)).resolves.toBe("queued");
        expect(await storedEntries()).toEqual([
            expect.objectContaining({ analysisId, attemptCount: 1 }),
        ]);

        resetQuickScheduleReliabilityFeedbackQueueForTests();
        jest.setSystemTime(new Date(Date.now() + constants.retryDelaysMs[0]));
        await expect(activateQuickScheduleReliabilityFeedbackQueueForAuthenticatedMember())
            .resolves.toBe(1);

        expect(mockedRecordFeedback).toHaveBeenCalledTimes(2);
        expect(await storedEntries()).toEqual([]);
    });

    it("upgrades a queued cancellation to the stronger saved signal", async () => {
        mockedRecordFeedback.mockRejectedValue(new Error("offline"));
        await recordQuickScheduleReliabilityFeedbackDurably(feedback);

        const saved: QuickScheduleReliabilityFeedback = {
            ...feedback,
            outcome: "SAVED",
            globalConfirmed: true,
        };
        jest.setSystemTime(new Date(Date.now() + constants.retryDelaysMs[0]));
        await recordQuickScheduleReliabilityFeedbackDurably(saved);

        expect(await storedEntries()).toEqual([
            expect.objectContaining({ analysisId, outcome: "SAVED", globalConfirmed: true }),
        ]);
    });

    it("does not lose a saved upgrade while cancellation delivery is in flight", async () => {
        const request = deferred<void>();
        const started = deferred<void>();
        mockedRecordFeedback
            .mockImplementationOnce(() => {
                started.resolve();
                return request.promise;
            })
            .mockResolvedValueOnce(undefined);

        const cancelledDelivery = recordQuickScheduleReliabilityFeedbackDurably(feedback);
        await started.promise;
        const saved = { ...feedback, outcome: "SAVED" as const, globalConfirmed: true };
        const savedDelivery = recordQuickScheduleReliabilityFeedbackDurably(saved);
        await Promise.resolve();
        request.resolve();

        await expect(cancelledDelivery).resolves.toBe("queued");
        await expect(savedDelivery).resolves.toBe("queued");
        expect(await storedEntries()).toEqual([
            expect.objectContaining({ analysisId, outcome: "SAVED", globalConfirmed: true }),
        ]);

        await expect(activateQuickScheduleReliabilityFeedbackQueueForAuthenticatedMember())
            .resolves.toBe(1);
        expect(mockedRecordFeedback).toHaveBeenLastCalledWith(saved);
        expect(await storedEntries()).toEqual([]);
    });

    it("drops permanent invalid feedback", async () => {
        mockedRecordFeedback.mockRejectedValueOnce(
            new ApiResponseError("invalid", { status: 400, errorCode: "C001" }),
        );
        await expect(recordQuickScheduleReliabilityFeedbackDurably(feedback))
            .resolves.toBe("rejected");
        expect(await storedEntries()).toEqual([]);
    });

    it("isolates queues by account and clears only the signing-out member", async () => {
        mockedRecordFeedback.mockRejectedValue(new Error("offline"));
        await recordQuickScheduleReliabilityFeedbackDurably(feedback);
        await AsyncStorage.setItem(
            constants.storageKeyForMember(8),
            JSON.stringify({ version: 1, entries: [] }),
        );

        await clearQuickScheduleReliabilityFeedbackQueueForCurrentAccount();

        expect(await AsyncStorage.getItem(constants.storageKeyForMember(7))).toBeNull();
        expect(await AsyncStorage.getItem(constants.storageKeyForMember(8))).not.toBeNull();
        await expect(recordQuickScheduleReliabilityFeedbackDurably(feedback))
            .resolves.toBe("rejected");
    });

    it("rejects malformed IDs without writing or sending", async () => {
        await expect(recordQuickScheduleReliabilityFeedbackDurably({
            ...feedback,
            analysisId: "not-a-uuid",
        })).resolves.toBe("rejected");
        expect(mockedRecordFeedback).not.toHaveBeenCalled();
        expect(await storedEntries()).toEqual([]);
    });
});
