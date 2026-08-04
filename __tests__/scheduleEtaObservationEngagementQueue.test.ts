import AsyncStorage from "@react-native-async-storage/async-storage";

import { recordScheduleEtaObservationEngagement } from "../src/api/schedule";
import { ApiResponseError } from "../src/api/response";
import { getAuthMember } from "../src/modules/auth/authStorage";
import { isDepartureAlarmAccountCleanupPending } from "../src/modules/notification/departureAlarmSync";
import {
    activateScheduleEtaObservationEngagementQueueForAuthenticatedMember,
    clearScheduleEtaObservationEngagementQueueForCurrentAccount,
    recordScheduleEtaObservationEngagementDurably,
    resetScheduleEtaObservationEngagementQueueForTests,
    SCHEDULE_ETA_ENGAGEMENT_QUEUE_TEST_CONSTANTS,
} from "../src/modules/schedule/scheduleEtaObservationEngagementQueue";

jest.mock("../src/api/schedule", () => ({
    recordScheduleEtaObservationEngagement: jest.fn(),
}));

jest.mock("../src/modules/auth/authStorage", () => ({
    getAuthMember: jest.fn(),
}));

jest.mock("../src/modules/notification/departureAlarmSync", () => ({
    isDepartureAlarmAccountCleanupPending: jest.fn(),
}));

const mockedRecordEngagement = jest.mocked(recordScheduleEtaObservationEngagement);
const mockedGetAuthMember = jest.mocked(getAuthMember);
const mockedCleanupPending = jest.mocked(isDepartureAlarmAccountCleanupPending);
const constants = SCHEDULE_ETA_ENGAGEMENT_QUEUE_TEST_CONSTANTS!;

type StoredEntry = {
    scheduleId: string;
    event: "EXPOSED" | "PROMPT_OPENED";
    clientAppVersion?: string;
    clientBuildVersion?: string;
    uxVariant?: string;
    attemptCount: number;
    nextAttemptAt: number;
    enqueuedAt: number;
};

async function entries(memberId = 7): Promise<StoredEntry[]> {
    const raw = await AsyncStorage.getItem(constants.storageKeyForMember(memberId));
    return raw ? (JSON.parse(raw) as { entries: StoredEntry[] }).entries : [];
}

const exposed = {
    event: "EXPOSED" as const,
    clientAppVersion: "1.2.0",
    clientBuildVersion: "42",
    uxVariant: "arrival-card-v1",
};

describe("durable ETA observation engagement queue", () => {
    beforeEach(async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-08-01T01:00:00.000Z"));
        await AsyncStorage.clear();
        resetScheduleEtaObservationEngagementQueueForTests();
        jest.clearAllMocks();
        mockedGetAuthMember.mockResolvedValue({ id: 7 } as Awaited<ReturnType<typeof getAuthMember>>);
        mockedCleanupPending.mockResolvedValue(false);
        mockedRecordEngagement.mockResolvedValue({} as never);
    });

    afterEach(() => {
        resetScheduleEtaObservationEngagementQueueForTests();
        jest.useRealTimers();
    });

    it("persists the immutable cohort before a transient request and replays it", async () => {
        mockedRecordEngagement.mockRejectedValueOnce(new Error("offline"));

        await expect(recordScheduleEtaObservationEngagementDurably("41", exposed))
            .resolves.toBe("queued");
        expect(await entries()).toEqual([
            expect.objectContaining({ scheduleId: "41", ...exposed, attemptCount: 1 }),
        ]);

        resetScheduleEtaObservationEngagementQueueForTests();
        jest.setSystemTime(new Date(Date.now() + constants.retryDelaysMs[0]));
        mockedRecordEngagement.mockResolvedValueOnce({} as never);
        await expect(activateScheduleEtaObservationEngagementQueueForAuthenticatedMember())
            .resolves.toBe(1);
        expect(mockedRecordEngagement).toHaveBeenLastCalledWith("41", exposed);
        expect(await entries()).toEqual([]);
    });

    it("deduplicates by schedule and event without replacing the first cohort", async () => {
        mockedRecordEngagement.mockRejectedValue(new Error("offline"));
        await recordScheduleEtaObservationEngagementDurably("41", exposed);
        await recordScheduleEtaObservationEngagementDurably("41", {
            event: "EXPOSED",
            clientAppVersion: "9.9.9",
            clientBuildVersion: "999",
            uxVariant: "replacement-must-not-win",
        });

        expect(await entries()).toEqual([
            expect.objectContaining({ scheduleId: "41", ...exposed }),
        ]);
        expect(mockedRecordEngagement).toHaveBeenCalledTimes(1);
    });

    it("queues and replays exposure before prompt when the first send is offline", async () => {
        mockedRecordEngagement.mockRejectedValueOnce(new Error("offline"));
        await expect(recordScheduleEtaObservationEngagementDurably("41", {
            ...exposed,
            event: "PROMPT_OPENED",
        })).resolves.toBe("queued");
        expect((await entries()).map((entry) => entry.event)).toEqual([
            "EXPOSED",
            "PROMPT_OPENED",
        ]);

        resetScheduleEtaObservationEngagementQueueForTests();
        jest.setSystemTime(new Date(Date.now() + constants.retryDelaysMs[0]));
        mockedRecordEngagement.mockResolvedValue({} as never);
        await expect(activateScheduleEtaObservationEngagementQueueForAuthenticatedMember())
            .resolves.toBe(2);
        expect(mockedRecordEngagement.mock.calls.slice(-2).map((call) => call[1].event))
            .toEqual(["EXPOSED", "PROMPT_OPENED"]);
        expect(await entries()).toEqual([]);
    });

    it("physically purges events after the 24-hour retention bound", async () => {
        const expiredAt = Date.now() - constants.entryTtlMs;
        await AsyncStorage.setItem(
            constants.storageKeyForMember(7),
            JSON.stringify({
                version: constants.schemaVersion,
                entries: [{
                    scheduleId: "41",
                    ...exposed,
                    attemptCount: 1,
                    nextAttemptAt: expiredAt,
                    enqueuedAt: expiredAt,
                }],
            }),
        );

        await expect(activateScheduleEtaObservationEngagementQueueForAuthenticatedMember())
            .resolves.toBe(0);
        expect(await AsyncStorage.getItem(constants.storageKeyForMember(7))).toBeNull();
        expect(mockedRecordEngagement).not.toHaveBeenCalled();
    });

    it("drops permanent rejections and malformed optional cohort values", async () => {
        mockedRecordEngagement.mockRejectedValueOnce(
            new ApiResponseError("gone", { status: 410, errorCode: "C001" }),
        );
        await expect(recordScheduleEtaObservationEngagementDurably("41", {
            event: "EXPOSED",
            clientAppVersion: "x".repeat(65),
            clientBuildVersion: "bad value",
            uxVariant: "bad value",
        })).resolves.toBe("rejected");
        expect(mockedRecordEngagement).toHaveBeenCalledWith("41", { event: "EXPOSED" });
        expect(await entries()).toEqual([]);
    });

    it("clears only the signing-out account and blocks post-logout writes", async () => {
        mockedRecordEngagement.mockRejectedValue(new Error("offline"));
        await recordScheduleEtaObservationEngagementDurably("41", exposed);
        await AsyncStorage.setItem(
            constants.storageKeyForMember(8),
            JSON.stringify({ version: constants.schemaVersion, entries: [] }),
        );

        await clearScheduleEtaObservationEngagementQueueForCurrentAccount();

        expect(await AsyncStorage.getItem(constants.storageKeyForMember(7))).toBeNull();
        expect(await AsyncStorage.getItem(constants.storageKeyForMember(8))).not.toBeNull();
        mockedRecordEngagement.mockClear();
        await expect(recordScheduleEtaObservationEngagementDurably("42", exposed))
            .resolves.toBe("rejected");
        expect(mockedRecordEngagement).not.toHaveBeenCalled();
    });

    it("falls back to the active account binding when auth cache cleanup reads fail", async () => {
        mockedRecordEngagement.mockRejectedValueOnce(new Error("offline"));
        await recordScheduleEtaObservationEngagementDurably("41", exposed);
        mockedGetAuthMember.mockRejectedValueOnce(new Error("secure cache unavailable"));

        await expect(clearScheduleEtaObservationEngagementQueueForCurrentAccount())
            .resolves.toBeUndefined();
        expect(await AsyncStorage.getItem(constants.storageKeyForMember(7))).toBeNull();
    });
});
