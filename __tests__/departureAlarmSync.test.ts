import { getDepartureAlarmSnapshotCommands } from "../src/api/notification";
import {
    getAccessToken,
    getAuthMember,
    getRefreshToken,
} from "../src/modules/auth/authStorage";
import {
    applyDepartureAlarmCommand,
    applyDepartureAlarmPlanCommand,
    clearAllDepartureAlarms,
    isDepartureAlarmNativeAvailable,
} from "../src/modules/notification/departureAlarm";
import {
    activateDepartureAlarmSyncForAuthenticatedAccount,
    clearDepartureAlarmsForAccountCleanup,
    handleDepartureAlarmSyncData,
    reconcileDepartureAlarmSnapshot,
    reconcileDepartureAlarmSnapshotForCurrentAccount,
    resetDepartureAlarmSyncForTests,
    runWithDepartureAlarmWithdrawalGuard,
} from "../src/modules/notification/departureAlarmSync";
import * as SecureStore from "../src/modules/storage/secureStorage";
import { acknowledgePushDelivery } from "../src/modules/notification/pushDeliveryAck";
import {
    recordDepartureAlarmScheduleReceiptDurably,
} from "../src/modules/notification/departureAlarmScheduleReceiptQueue";

jest.mock("../src/api/notification", () => ({
    getDepartureAlarmSnapshotCommands: jest.fn(),
}));

jest.mock("../src/modules/auth/authStorage", () => ({
    getAccessToken: jest.fn(),
    getAuthMember: jest.fn(),
    getRefreshToken: jest.fn(),
}));

jest.mock("../src/modules/notification/departureAlarm", () => ({
    applyDepartureAlarmCommand: jest.fn(),
    applyDepartureAlarmPlanCommand: jest.fn(),
    clearAllDepartureAlarms: jest.fn(),
    isDepartureAlarmNativeAvailable: jest.fn(),
}));

jest.mock("../src/modules/notification/pushDeliveryAck", () => ({
    acknowledgePushDelivery: jest.fn(),
}));

jest.mock("../src/modules/notification/departureAlarmScheduleReceiptQueue", () => ({
    classifyDepartureAlarmReceiptOutcome: jest.fn((command, result) => {
        if (command.operation === "UPSERT" && result.scheduled === true) return "SCHEDULED";
        if (command.operation === "CANCEL" && result.applied === true) return "CANCELED";
        return "FAILED";
    }),
    recordDepartureAlarmScheduleReceiptDurably: jest.fn(),
    reserveDepartureAlarmMutationSequence: jest.fn()
        .mockImplementation((() => {
            let sequence = 0;
            return async () => { sequence += 1; return sequence; };
        })()),
}));

jest.mock("../src/modules/storage/secureStorage", () => ({
    deleteItemAsync: jest.fn(),
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
}));

const mockedGetSnapshot = jest.mocked(getDepartureAlarmSnapshotCommands);
const mockedGetAccessToken = jest.mocked(getAccessToken);
const mockedGetAuthMember = jest.mocked(getAuthMember);
const mockedGetRefreshToken = jest.mocked(getRefreshToken);
const mockedApplyCommand = jest.mocked(applyDepartureAlarmCommand);
const mockedApplyPlan = jest.mocked(applyDepartureAlarmPlanCommand);
const mockedClearAll = jest.mocked(clearAllDepartureAlarms);
const mockedNativeAvailable = jest.mocked(isDepartureAlarmNativeAvailable);
const mockedCleanupMarkerGet = jest.mocked(SecureStore.getItemAsync);
const mockedCleanupMarkerSet = jest.mocked(SecureStore.setItemAsync);
const mockedCleanupMarkerDelete = jest.mocked(SecureStore.deleteItemAsync);
const mockedAcknowledgePushDelivery = jest.mocked(acknowledgePushDelivery);
const mockedRecordReceipt = jest.mocked(recordDepartureAlarmScheduleReceiptDurably);

function syncCommand(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        type: "DEPARTURE_ALARM_SYNC",
        alarmSchemaVersion: "1",
        recipientMemberId: "7",
        alarmOperation: "UPSERT",
        alarmId: "schedule:41:member:7",
        scheduleId: "41",
        alarmGeneration: "3",
        alarmValidationRevision: "0",
        alarmTriggerAt: "2099-07-29T03:00:00Z",
        alarmTitle: "회의 출발 시간",
        snoozeMinutes: "5",
        ...overrides,
    };
}

function cancelCommand(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        type: "DEPARTURE_ALARM_SYNC",
        alarmSchemaVersion: "1",
        recipientMemberId: "7",
        alarmOperation: "CANCEL",
        alarmId: "schedule:41:member:7",
        scheduleId: "41",
        alarmGeneration: "4",
        alarmValidationRevision: "0",
        ...overrides,
    };
}

function v2SyncCommand(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const occurrences = [
        ["M15", "2099-07-29T02:45:00Z", 15, "ADVANCE_NOTICE", "a"],
        ["M10", "2099-07-29T02:50:00Z", 10, "ADVANCE_NOTICE", "b"],
        ["M5", "2099-07-29T02:55:00Z", 5, "ADVANCE_NOTICE", "c"],
        ["M0", "2099-07-29T03:00:00Z", 0, "DEPART_NOW", "d"],
    ].map(([occurrenceId, triggerAt, minutesBeforeDeparture, decision, key]) => ({
        occurrenceId,
        triggerAt,
        title: occurrenceId === "M0" ? "회의 출발 시간" : `회의 출발 ${minutesBeforeDeparture}분 전`,
        body: occurrenceId === "M0" ? "지금 출발하세요." : `${minutesBeforeDeparture}분 뒤 출발하세요.`,
        decision,
        minutesBeforeDeparture,
        actionEventKey: `key:${String(key).repeat(64)}`,
    }));
    return syncCommand({
        alarmPlanSchemaVersion: "2",
        alarmOccurrencesJson: JSON.stringify(occurrences),
        ...overrides,
    });
}

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

async function flushMicrotasksUntil(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (predicate()) return;
        await Promise.resolve();
    }
    throw new Error("Expected asynchronous work did not start.");
}

describe("departure alarm data-only synchronization", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedGetAccessToken.mockResolvedValue("access");
        mockedGetRefreshToken.mockResolvedValue("refresh");
        mockedGetAuthMember.mockResolvedValue({ id: 7 });
        mockedApplyCommand.mockResolvedValue({ applied: true, scheduled: true });
        mockedApplyPlan.mockImplementation(async (plan) => {
            const command = plan.operation === "CANCEL"
                ? {
                    operation: "CANCEL" as const,
                    alarmId: plan.alarmId,
                    scheduleId: plan.scheduleId,
                    generation: plan.generation,
                    recipientMemberId: plan.recipientMemberId,
                    ...(plan.logicalEventKey ? { logicalEventKey: plan.logicalEventKey } : {}),
                }
                : plan.occurrences[0];
            if (!command) return [];
            return [{ command, result: await mockedApplyCommand(command) }];
        });
        mockedClearAll.mockResolvedValue(true);
        mockedNativeAvailable.mockReturnValue(true);
        mockedCleanupMarkerGet.mockResolvedValue(null);
        mockedCleanupMarkerSet.mockResolvedValue(undefined);
        mockedCleanupMarkerDelete.mockResolvedValue(undefined);
        mockedAcknowledgePushDelivery.mockResolvedValue(true);
        mockedRecordReceipt.mockResolvedValue("sent");
    });

    afterEach(async () => {
        await resetDepartureAlarmSyncForTests();
    });

    it("leaves standard push payloads to the existing presentation path", async () => {
        await expect(handleDepartureAlarmSyncData({
            type: "SCHEDULE_DEPARTURE_REMINDER",
        })).resolves.toBe(false);
        expect(mockedApplyCommand).not.toHaveBeenCalled();
        expect(mockedRecordReceipt).not.toHaveBeenCalled();
    });

    it("silently consumes malformed sync without crossing the native bridge", async () => {
        await expect(handleDepartureAlarmSyncData({
            type: "DEPARTURE_ALARM_SYNC",
            alarmSchemaVersion: "1",
            recipientMemberId: "7",
        })).resolves.toBe(true);
        expect(mockedApplyCommand).not.toHaveBeenCalled();
        expect(mockedRecordReceipt).not.toHaveBeenCalled();
    });

    it("applies a valid command only for the persisted authenticated account", async () => {
        await expect(handleDepartureAlarmSyncData(syncCommand())).resolves.toBe(true);
        expect(mockedApplyCommand).toHaveBeenCalledWith({
            operation: "UPSERT",
            alarmId: "schedule:41:member:7",
            scheduleId: "41",
            generation: 3,
            validationRevision: 0,
            recipientMemberId: 7,
            triggerAt: "2099-07-29T03:00:00Z",
            title: "회의 출발 시간",
            snoozeMinutes: 5,
        });
        expect(mockedRecordReceipt).toHaveBeenCalledWith(
            expect.objectContaining({ alarmId: "schedule:41:member:7" }),
            { applied: true, scheduled: true },
            "PUSH",
        );

        mockedApplyCommand.mockClear();
        await handleDepartureAlarmSyncData(syncCommand({
            recipientMemberId: "8",
            alarmId: "schedule:41:member:8",
        }));
        expect(mockedApplyCommand).not.toHaveBeenCalled();
    });

    it("ACKs ALARM_SCHEDULED only after a current UPSERT is scheduled natively", async () => {
        const data = syncCommand({ logicalEventKey: "event:alarm-sync-41" });

        await expect(handleDepartureAlarmSyncData(data)).resolves.toBe(true);

        expect(mockedAcknowledgePushDelivery).toHaveBeenCalledWith(
            data,
            "ALARM_SCHEDULED",
            { alarmId: "schedule:41:member:7" },
        );

        mockedAcknowledgePushDelivery.mockClear();
        mockedApplyCommand.mockResolvedValueOnce({ applied: false, scheduled: false });
        await handleDepartureAlarmSyncData(syncCommand({
            logicalEventKey: "event:alarm-sync-not-scheduled",
        }));
        expect(mockedAcknowledgePushDelivery).not.toHaveBeenCalled();
        expect(mockedRecordReceipt).toHaveBeenLastCalledWith(
            expect.objectContaining({ operation: "UPSERT" }),
            { applied: false, scheduled: false },
            "PUSH",
        );
    });

    it("records each successful v2 occurrence and does not emit the legacy aggregate ACK", async () => {
        mockedApplyPlan.mockImplementationOnce(async (plan) => plan.occurrences.map((command) => ({
            command,
            result: { applied: true, scheduled: true },
        })));
        const data = v2SyncCommand({ logicalEventKey: "event:alarm-plan-41" });

        await expect(handleDepartureAlarmSyncData(data)).resolves.toBe(true);

        expect(mockedRecordReceipt).toHaveBeenCalledTimes(4);
        expect(mockedRecordReceipt.mock.calls.map(([command]) => command.occurrenceId))
            .toEqual(["M15", "M10", "M5", "M0"]);
        expect(mockedRecordReceipt).toHaveBeenLastCalledWith(
            expect.objectContaining({
                alarmId: "schedule:41:member:7",
                occurrenceId: "M0",
                triggerAt: "2099-07-29T03:00:00Z",
            }),
            { applied: true, scheduled: true },
            "PUSH",
            expect.any(String),
            expect.any(Number),
        );
        expect(mockedAcknowledgePushDelivery).not.toHaveBeenCalled();
    });

    it("reconciles a higher validation revision and emits fresh occurrence sequences", async () => {
        mockedApplyPlan.mockImplementation(async (plan) => plan.occurrences.map((command) => ({
            command,
            result: { applied: true, scheduled: true },
        })));

        await handleDepartureAlarmSyncData(v2SyncCommand({ alarmValidationRevision: "4" }));
        await handleDepartureAlarmSyncData(v2SyncCommand({ alarmValidationRevision: "5" }));

        expect(mockedApplyPlan).toHaveBeenCalledTimes(2);
        expect(mockedRecordReceipt).toHaveBeenCalledTimes(8);
        const sequences = mockedRecordReceipt.mock.calls.map((call) => call[4] as number);
        expect(sequences.every((sequence) => Number.isSafeInteger(sequence) && sequence > 0))
            .toBe(true);
        expect(Math.min(...sequences.slice(4))).toBeGreaterThan(Math.max(...sequences.slice(0, 4)));
    });

    it("silently ignores a lower validation revision in the same generation", async () => {
        await handleDepartureAlarmSyncData(syncCommand({ alarmValidationRevision: "5" }));
        mockedApplyPlan.mockClear();
        mockedApplyCommand.mockClear();
        mockedRecordReceipt.mockClear();
        mockedAcknowledgePushDelivery.mockClear();

        await expect(handleDepartureAlarmSyncData(syncCommand({
            alarmValidationRevision: "4",
        }))).resolves.toBe(true);

        expect(mockedApplyPlan).not.toHaveBeenCalled();
        expect(mockedApplyCommand).not.toHaveBeenCalled();
        expect(mockedRecordReceipt).not.toHaveBeenCalled();
        expect(mockedAcknowledgePushDelivery).not.toHaveBeenCalled();
    });

    it("treats a delayed revision-less command as stale after a newer revision", async () => {
        await handleDepartureAlarmSyncData(syncCommand({ alarmValidationRevision: "5" }));
        mockedApplyPlan.mockClear();
        mockedApplyCommand.mockClear();
        mockedRecordReceipt.mockClear();
        const legacyCommand = syncCommand();
        delete legacyCommand.alarmValidationRevision;

        await handleDepartureAlarmSyncData(legacyCommand);

        expect(mockedApplyPlan).not.toHaveBeenCalled();
        expect(mockedApplyCommand).not.toHaveBeenCalled();
        expect(mockedRecordReceipt).not.toHaveBeenCalled();
    });

    it("accepts a higher generation even when its validation revision restarts lower", async () => {
        await handleDepartureAlarmSyncData(syncCommand({ alarmValidationRevision: "5" }));
        mockedApplyPlan.mockClear();
        mockedApplyCommand.mockClear();

        await handleDepartureAlarmSyncData(syncCommand({
            alarmGeneration: "4",
            alarmValidationRevision: "0",
        }));

        expect(mockedApplyPlan).toHaveBeenCalledTimes(1);
        expect(mockedApplyCommand).toHaveBeenCalledWith(expect.objectContaining({
            generation: 4,
            validationRevision: 0,
        }));
    });

    it("records applied cancel and thrown native outcomes without a scheduled ACK", async () => {
        mockedApplyCommand.mockResolvedValueOnce({ applied: true, scheduled: false });
        await handleDepartureAlarmSyncData(cancelCommand());

        expect(mockedRecordReceipt).toHaveBeenLastCalledWith(
            expect.objectContaining({ operation: "CANCEL" }),
            { applied: true, scheduled: false },
            "PUSH",
        );
        expect(mockedAcknowledgePushDelivery).not.toHaveBeenCalled();

        mockedApplyCommand.mockRejectedValueOnce(new Error("native crashed"));
        await handleDepartureAlarmSyncData(syncCommand({ alarmGeneration: "5" }));
        expect(mockedRecordReceipt).toHaveBeenLastCalledWith(
            expect.objectContaining({ operation: "UPSERT" }),
            {
                applied: false,
                scheduled: false,
                reason: "NATIVE_BRIDGE_ERROR",
            },
            "PUSH",
        );
    });

    it("drops sync when credentials or the current account are unavailable", async () => {
        mockedGetAccessToken.mockResolvedValue(null);
        await handleDepartureAlarmSyncData(syncCommand());
        expect(mockedApplyCommand).not.toHaveBeenCalled();

        mockedGetAccessToken.mockResolvedValue("access");
        mockedGetAuthMember.mockResolvedValue(null);
        await handleDepartureAlarmSyncData(syncCommand());
        expect(mockedApplyCommand).not.toHaveBeenCalled();
    });

    it("replays valid snapshot commands, skips malformed entries, and never infers deletes", async () => {
        mockedGetSnapshot.mockResolvedValue([
            syncCommand(),
            syncCommand({ alarmId: "wrong" }),
            null,
        ]);

        await expect(reconcileDepartureAlarmSnapshot(7)).resolves.toEqual({
            fetched: true,
            appliedCount: 1,
            droppedCount: 2,
            failedCount: 0,
        });
        expect(mockedApplyCommand).toHaveBeenCalledTimes(1);
        expect(mockedClearAll).not.toHaveBeenCalled();
    });

    it("reapplies equal snapshot generations at each recovery point", async () => {
        mockedGetSnapshot.mockResolvedValue([syncCommand()]);

        await reconcileDepartureAlarmSnapshot(7);
        await reconcileDepartureAlarmSnapshot(7);

        expect(mockedGetSnapshot).toHaveBeenCalledTimes(2);
        expect(mockedApplyCommand).toHaveBeenCalledTimes(2);
        expect(mockedRecordReceipt).toHaveBeenCalledTimes(2);
        expect(mockedRecordReceipt).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ generation: 3 }),
            { applied: true, scheduled: true },
            "SNAPSHOT",
        );
    });

    it("counts parsed native failures separately from malformed snapshot drops", async () => {
        mockedGetSnapshot.mockResolvedValue([
            syncCommand(),
            cancelCommand(),
            syncCommand({ alarmId: "wrong" }),
        ]);
        mockedApplyCommand
            .mockResolvedValueOnce({ applied: true, scheduled: false, reason: "PERMISSION_REQUIRED" })
            .mockResolvedValueOnce({ applied: true, scheduled: false });

        await expect(reconcileDepartureAlarmSnapshot(7)).resolves.toEqual({
            fetched: true,
            appliedCount: 1,
            droppedCount: 1,
            failedCount: 1,
        });
        expect(mockedRecordReceipt).toHaveBeenCalledTimes(2);
        expect(mockedRecordReceipt).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ operation: "UPSERT" }),
            expect.objectContaining({ scheduled: false }),
            "SNAPSHOT",
        );
    });

    it("reconciles the persisted current account immediately after a schedule mutation", async () => {
        mockedGetSnapshot.mockResolvedValue([syncCommand()]);

        await expect(reconcileDepartureAlarmSnapshotForCurrentAccount()).resolves.toEqual({
            fetched: true,
            appliedCount: 1,
            droppedCount: 0,
            failedCount: 0,
        });

        expect(mockedGetSnapshot).toHaveBeenCalledTimes(1);
        expect(mockedApplyCommand).toHaveBeenCalledTimes(1);
    });

    it("does not fetch a post-mutation snapshot without a complete authenticated account", async () => {
        mockedGetRefreshToken.mockResolvedValue(null);

        await expect(reconcileDepartureAlarmSnapshotForCurrentAccount()).resolves.toEqual({
            fetched: false,
            appliedCount: 0,
            droppedCount: 0,
            failedCount: 0,
            reason: "INVALID_ACCOUNT",
        });

        expect(mockedGetSnapshot).not.toHaveBeenCalled();
        expect(mockedApplyCommand).not.toHaveBeenCalled();
    });

    it("drains a pre-mutation in-flight snapshot and then fetches fresh state", async () => {
        const staleSnapshot = deferred<unknown[]>();
        mockedGetSnapshot
            .mockReturnValueOnce(staleSnapshot.promise)
            .mockResolvedValueOnce([syncCommand({ alarmGeneration: "4" })]);

        const preMutationReconciliation = reconcileDepartureAlarmSnapshot(7);
        await flushMicrotasksUntil(() => mockedGetSnapshot.mock.calls.length === 1);
        const postMutationReconciliation =
            reconcileDepartureAlarmSnapshotForCurrentAccount();

        staleSnapshot.resolve([syncCommand()]);

        await expect(preMutationReconciliation).resolves.toMatchObject({
            fetched: true,
            appliedCount: 1,
        });
        await expect(postMutationReconciliation).resolves.toMatchObject({
            fetched: true,
            appliedCount: 1,
        });

        expect(mockedGetSnapshot).toHaveBeenCalledTimes(2);
        expect(mockedApplyCommand).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ generation: 3 }),
        );
        expect(mockedApplyCommand).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ generation: 4 }),
        );
    });

    it("does not start a fresh post-mutation snapshot after an account transition", async () => {
        const staleSnapshot = deferred<unknown[]>();
        mockedGetSnapshot.mockReturnValueOnce(staleSnapshot.promise);

        const preMutationReconciliation = reconcileDepartureAlarmSnapshot(7);
        await flushMicrotasksUntil(() => mockedGetSnapshot.mock.calls.length === 1);
        const postMutationReconciliation =
            reconcileDepartureAlarmSnapshotForCurrentAccount();
        const cleanup = clearDepartureAlarmsForAccountCleanup();

        staleSnapshot.resolve([syncCommand()]);

        await expect(cleanup).resolves.toBe(true);
        await expect(preMutationReconciliation).resolves.toMatchObject({
            reason: "ACCOUNT_CHANGED",
        });
        await expect(postMutationReconciliation).resolves.toEqual({
            fetched: false,
            appliedCount: 0,
            droppedCount: 0,
            failedCount: 0,
            reason: "ACCOUNT_CHANGED",
        });

        expect(mockedGetSnapshot).toHaveBeenCalledTimes(1);
        expect(mockedApplyCommand).not.toHaveBeenCalled();
    });

    it("does not mutate native alarms when snapshot loading fails", async () => {
        mockedGetSnapshot.mockRejectedValue(new Error("offline"));

        await expect(reconcileDepartureAlarmSnapshot(7)).resolves.toMatchObject({
            fetched: false,
            reason: "REQUEST_FAILED",
        });
        expect(mockedApplyCommand).not.toHaveBeenCalled();
        expect(mockedClearAll).not.toHaveBeenCalled();
    });

    it("absorbs auth-storage failures so recovery cannot reject token registration", async () => {
        mockedGetAccessToken.mockRejectedValue(new Error("keychain unavailable"));

        await expect(reconcileDepartureAlarmSnapshot(7)).resolves.toMatchObject({
            fetched: false,
            reason: "ACCOUNT_CHANGED",
        });
        expect(mockedGetSnapshot).not.toHaveBeenCalled();
    });

    it("invalidates an in-flight old-account snapshot before serialized cleanup", async () => {
        const pending = deferred<unknown[]>();
        mockedGetSnapshot.mockReturnValue(pending.promise);

        const reconciliation = reconcileDepartureAlarmSnapshot(7);
        await Promise.resolve();
        const cleanup = clearDepartureAlarmsForAccountCleanup();
        pending.resolve([syncCommand()]);

        await expect(cleanup).resolves.toBe(true);
        await expect(reconciliation).resolves.toMatchObject({
            appliedCount: 0,
            reason: "ACCOUNT_CHANGED",
        });
        expect(mockedApplyCommand).not.toHaveBeenCalled();
        expect(mockedClearAll).toHaveBeenCalledTimes(1);
    });

    it("allows the same generation to replay after logout and same-account login", async () => {
        await handleDepartureAlarmSyncData(syncCommand());
        await clearDepartureAlarmsForAccountCleanup();
        await activateDepartureAlarmSyncForAuthenticatedAccount(7);
        await handleDepartureAlarmSyncData(syncCommand());

        expect(mockedClearAll).toHaveBeenCalledTimes(2);
        expect(mockedApplyCommand).toHaveBeenCalledTimes(2);
        expect(mockedApplyCommand).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ generation: 3 }),
        );
    });

    it("drops a command that arrives while native account cleanup is in progress", async () => {
        const pendingClear = deferred<boolean>();
        mockedClearAll.mockReturnValue(pendingClear.promise);

        const cleanup = clearDepartureAlarmsForAccountCleanup();
        await expect(handleDepartureAlarmSyncData(syncCommand())).resolves.toBe(true);
        expect(mockedApplyCommand).not.toHaveBeenCalled();

        pendingClear.resolve(true);
        await expect(cleanup).resolves.toBe(true);
        expect(mockedApplyCommand).not.toHaveBeenCalled();
    });

    it("fails closed before native purge when the crash marker cannot be persisted", async () => {
        mockedCleanupMarkerSet.mockRejectedValue(new Error("keychain unavailable"));

        await expect(clearDepartureAlarmsForAccountCleanup())
            .rejects.toThrow("keychain unavailable");

        expect(mockedClearAll).not.toHaveBeenCalled();
        expect(mockedCleanupMarkerDelete).not.toHaveBeenCalled();
    });

    it("keeps credentials recoverable when the required native cleanup module is unavailable", async () => {
        mockedNativeAvailable.mockReturnValue(false);

        await expect(clearDepartureAlarmsForAccountCleanup())
            .rejects.toThrow("native module is unavailable");

        expect(mockedCleanupMarkerSet).toHaveBeenCalled();
        expect(mockedClearAll).not.toHaveBeenCalled();
        expect(mockedCleanupMarkerDelete).not.toHaveBeenCalled();
    });

    it("purges before withdrawal and rebuilds the current account when the API fails", async () => {
        const withdrawalError = new Error("password mismatch");
        const withdraw = jest.fn().mockRejectedValue(withdrawalError);
        mockedGetSnapshot.mockResolvedValue([syncCommand()]);

        await expect(runWithDepartureAlarmWithdrawalGuard(withdraw))
            .rejects.toBe(withdrawalError);

        expect(mockedClearAll.mock.invocationCallOrder[0])
            .toBeLessThan(withdraw.mock.invocationCallOrder[0]);
        expect(mockedCleanupMarkerSet).toHaveBeenCalled();
        expect(mockedCleanupMarkerDelete).toHaveBeenCalled();
        expect(mockedApplyCommand).toHaveBeenCalledTimes(1);
    });

    it("re-purges a crash-marked native state before opening a fresh login epoch", async () => {
        mockedCleanupMarkerGet.mockResolvedValue("1");

        await expect(activateDepartureAlarmSyncForAuthenticatedAccount(7))
            .resolves.toBe(true);

        expect(mockedClearAll).toHaveBeenCalledTimes(1);
        expect(mockedClearAll.mock.invocationCallOrder[0])
            .toBeLessThan(mockedCleanupMarkerDelete.mock.invocationCallOrder[0]);
    });

    it("purges unmarked account A native state before activating explicit account B login", async () => {
        mockedCleanupMarkerGet.mockResolvedValue(null);
        mockedGetAuthMember.mockResolvedValue({ id: 8 });

        await expect(activateDepartureAlarmSyncForAuthenticatedAccount(8))
            .resolves.toBe(true);

        expect(mockedClearAll).toHaveBeenCalledTimes(1);
        expect(mockedClearAll.mock.invocationCallOrder[0])
            .toBeLessThan(mockedCleanupMarkerDelete.mock.invocationCallOrder[0]);
    });

    it("purges native state for each explicit same-account re-login", async () => {
        await expect(activateDepartureAlarmSyncForAuthenticatedAccount(7))
            .resolves.toBe(true);
        await expect(activateDepartureAlarmSyncForAuthenticatedAccount(7))
            .resolves.toBe(true);

        expect(mockedClearAll).toHaveBeenCalledTimes(2);
        expect(mockedCleanupMarkerDelete).toHaveBeenCalledTimes(2);
    });

    it("keeps the crash marker when a required activation purge is unavailable", async () => {
        mockedCleanupMarkerGet.mockResolvedValue("1");
        mockedNativeAvailable.mockReturnValue(false);

        await expect(activateDepartureAlarmSyncForAuthenticatedAccount(7))
            .resolves.toBe(false);

        expect(mockedClearAll).not.toHaveBeenCalled();
        expect(mockedCleanupMarkerDelete).not.toHaveBeenCalled();
    });

    it("does not remove a crash marker for an unverified or rejected session", async () => {
        mockedCleanupMarkerGet.mockResolvedValue("1");
        mockedGetAccessToken.mockResolvedValue(null);

        await expect(activateDepartureAlarmSyncForAuthenticatedAccount(7))
            .resolves.toBe(false);

        expect(mockedClearAll).not.toHaveBeenCalled();
        expect(mockedCleanupMarkerDelete).not.toHaveBeenCalled();
    });
});
