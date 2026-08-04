import { getDepartureAlarmSnapshotCommands } from "../../api/notification";
import {
    getAccessToken,
    getAuthMember,
    getRefreshToken,
} from "../auth/authStorage";
import {
    applyDepartureAlarmPlanCommand,
    clearAllDepartureAlarms,
    isDepartureAlarmNativeAvailable,
} from "./departureAlarm";
import * as SecureStore from "../storage/secureStorage";
import {
    isDepartureAlarmSyncData,
    isDepartureAlarmOccurrenceEligible,
    parseDepartureAlarmSyncPlanCommand,
} from "./departureAlarmContract";
import { acknowledgePushDelivery } from "./pushDeliveryAck";
import {
    classifyDepartureAlarmReceiptOutcome,
    recordDepartureAlarmScheduleReceiptDurably,
    reserveDepartureAlarmMutationSequence,
} from "./departureAlarmScheduleReceiptQueue";
import {
    claimDepartureAlarmValidationRevision,
    clearDepartureAlarmValidationRevisions,
    resetDepartureAlarmValidationRevisionJournalForTests,
} from "./departureAlarmValidationRevisionJournal";
import type {
    DepartureAlarmMutationResult,
    DepartureAlarmPlanMutationExecution,
} from "./departureAlarm";
import type {
    DepartureAlarmSyncCommand,
    DepartureAlarmSyncPlanCommand,
} from "./departureAlarmContract";

export type DepartureAlarmSnapshotReconcileResult = {
    fetched: boolean;
    appliedCount: number;
    droppedCount: number;
    failedCount: number;
    reason?: "INVALID_ACCOUNT" | "ACCOUNT_CHANGED" | "REQUEST_FAILED";
};

let syncGeneration = 0;
let accountCleanupBlocked = false;
let nativeMutationQueue: Promise<void> = Promise.resolve();
let snapshotInFlight: {
    memberId: number;
    generation: number;
    promise: Promise<DepartureAlarmSnapshotReconcileResult>;
} | null = null;

function logSyncDevelopment(message: string, detail?: unknown): void {
    if (!__DEV__ || process.env.NODE_ENV === "test") return;
    if (detail === undefined) {
        console.info(message);
    } else {
        console.warn(message, detail);
    }
}

function enqueueNativeMutation<T>(task: () => Promise<T>): Promise<T> {
    const result = nativeMutationQueue.then(task, task);
    nativeMutationQueue = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
}

async function isAccountCleanupBlocked(): Promise<boolean> {
    if (accountCleanupBlocked) return true;
    try {
        if (await SecureStore.getItemAsync(DEPARTURE_ALARM_CLEANUP_BLOCK_KEY) === "1") {
            accountCleanupBlocked = true;
            return true;
        }
        return false;
    } catch {
        // Account binding cannot be proven while secure storage is unavailable.
        return true;
    }
}

export async function isDepartureAlarmAccountCleanupPending(): Promise<boolean> {
    return isAccountCleanupBlocked();
}

async function getCurrentAuthenticatedMemberId(): Promise<number | undefined> {
    try {
        const [accessToken, refreshToken, member] = await Promise.all([
            getAccessToken(),
            getRefreshToken(),
            getAuthMember(),
        ]);
        const memberId = member?.id;
        if (
            !accessToken ||
            !refreshToken ||
            !Number.isSafeInteger(memberId) ||
            (memberId ?? 0) <= 0
        ) {
            return undefined;
        }
        return memberId;
    } catch {
        return undefined;
    }
}

async function isCurrentAccount(memberId: number, generation: number): Promise<boolean> {
    if (generation !== syncGeneration || await isAccountCleanupBlocked()) return false;
    return (await getCurrentAuthenticatedMemberId()) === memberId &&
        generation === syncGeneration &&
        !(await isAccountCleanupBlocked());
}

/**
 * Handles only the reserved data-only alarm command. Returning true means the
 * payload must be consumed silently even when malformed or for another account.
 */
export async function handleDepartureAlarmSyncData(
    data?: Record<string, unknown>,
): Promise<boolean> {
    if (!isDepartureAlarmSyncData(data)) return false;
    if (await isAccountCleanupBlocked()) return true;

    const generation = syncGeneration;
    const execution = await enqueueNativeMutation(async (): Promise<{
        plan: DepartureAlarmSyncPlanCommand;
        executions: DepartureAlarmPlanMutationExecution[];
    } | undefined> => {
        if (await isAccountCleanupBlocked()) return;
        const memberId = await getCurrentAuthenticatedMemberId();
        if (!memberId || generation !== syncGeneration) return;

        const plan = parseDepartureAlarmSyncPlanCommand(data, memberId);
        if (!plan || !(await isCurrentAccount(memberId, generation))) return;

        try {
            if (await claimDepartureAlarmValidationRevision(plan) === "STALE") return;
        } catch (error) {
            // Without the durable revision fence, an older equal-generation command could undo a
            // newer control after restart. Consume it silently and let snapshot recovery retry.
            logSyncDevelopment("[alarm-sync] validation revision claim failed", error);
            return;
        }

        try {
            const executions = await reserveReceiptOrderForExecutions(
                await applyDepartureAlarmPlanCommand(plan),
            );
            return { plan, executions };
        } catch (error) {
            logSyncDevelopment("[alarm-sync] native command failed", error);
            return {
                plan,
                executions: await reserveReceiptOrderForExecutions(
                    failureExecutionsForPlan(plan),
                ),
            };
        }
    });
    if (execution) {
        const receipts = execution.executions.map((item) =>
            recordReceiptForExecution(item, "PUSH")
        );
        // Keep the network ACK outside the serialized native mutation queue so
        // an unavailable server cannot delay newer UPSERT/CANCEL commands.
        const scheduledAck = execution.plan.planSchemaVersion === 1 &&
            execution.plan.operation === "UPSERT" &&
            execution.executions.some(({ result }) => result.scheduled === true)
            ? acknowledgePushDelivery(data, "ALARM_SCHEDULED", {
                alarmId: execution.plan.alarmId,
            })
            : Promise.resolve(false);
        await Promise.all([...receipts, scheduledAck]);
    }
    return true;
}

/**
 * Replays the server's explicit desired-state commands. Missing snapshot items
 * are never interpreted as cancellation because a partial response must not
 * erase valid local alarms.
 */
export function reconcileDepartureAlarmSnapshot(
    expectedMemberId: number,
): Promise<DepartureAlarmSnapshotReconcileResult> {
    if (!Number.isSafeInteger(expectedMemberId) || expectedMemberId <= 0) {
        return Promise.resolve({
            fetched: false,
            appliedCount: 0,
            droppedCount: 0,
            failedCount: 0,
            reason: "INVALID_ACCOUNT",
        });
    }

    const generation = syncGeneration;
    if (
        snapshotInFlight?.memberId === expectedMemberId &&
        snapshotInFlight.generation === generation
    ) {
        return snapshotInFlight.promise;
    }

    const promise = (async (): Promise<DepartureAlarmSnapshotReconcileResult> => {
        if (await isAccountCleanupBlocked()) {
            return {
                fetched: false,
                appliedCount: 0,
                droppedCount: 0,
                failedCount: 0,
                reason: "ACCOUNT_CHANGED",
            };
        }
        if (!(await isCurrentAccount(expectedMemberId, generation))) {
            return {
                fetched: false,
                appliedCount: 0,
                droppedCount: 0,
                failedCount: 0,
                reason: "ACCOUNT_CHANGED",
            };
        }

        let rawCommands: unknown[];
        try {
            rawCommands = await getDepartureAlarmSnapshotCommands();
        } catch (error) {
            logSyncDevelopment("[alarm-sync] snapshot request failed", error);
            return {
                fetched: false,
                appliedCount: 0,
                droppedCount: 0,
                failedCount: 0,
                reason: "REQUEST_FAILED",
            };
        }

        const mutation = await enqueueNativeMutation(async () => {
            if (await isAccountCleanupBlocked()) {
                return {
                    summary: {
                        fetched: true,
                        appliedCount: 0,
                        droppedCount: rawCommands.length,
                        failedCount: 0,
                        reason: "ACCOUNT_CHANGED" as const,
                    },
                    executions: [],
                };
            }
            if (!(await isCurrentAccount(expectedMemberId, generation))) {
                return {
                    summary: {
                        fetched: true,
                        appliedCount: 0,
                        droppedCount: rawCommands.length,
                        failedCount: 0,
                        reason: "ACCOUNT_CHANGED" as const,
                    },
                    executions: [],
                };
            }

            let appliedCount = 0;
            let droppedCount = 0;
            let failedCount = 0;
            const executions: DepartureAlarmPlanMutationExecution[] = [];
            const parsedAtMilliseconds = Date.now();

            for (const rawCommand of rawCommands) {
                if (!(await isCurrentAccount(expectedMemberId, generation))) {
                    return {
                        summary: {
                            fetched: true,
                            appliedCount,
                            droppedCount: droppedCount +
                                rawCommands.length - appliedCount - droppedCount - failedCount,
                            failedCount,
                            reason: "ACCOUNT_CHANGED" as const,
                        },
                        executions,
                    };
                }

                const plan = parseDepartureAlarmSyncPlanCommand(
                    asDataMap(rawCommand),
                    expectedMemberId,
                    parsedAtMilliseconds,
                );
                if (!plan) {
                    droppedCount += 1;
                    continue;
                }

                try {
                    if (await claimDepartureAlarmValidationRevision(plan) === "STALE") {
                        droppedCount += 1;
                        continue;
                    }
                } catch (error) {
                    failedCount += 1;
                    logSyncDevelopment("[alarm-sync] validation revision claim failed", error);
                    continue;
                }

                try {
                    const planExecutions = await reserveReceiptOrderForExecutions(
                        await applyDepartureAlarmPlanCommand(
                            plan,
                            parsedAtMilliseconds,
                        ),
                    );
                    executions.push(...planExecutions);
                    const planFailed = planExecutions.some(({ command, result }) =>
                        classifyDepartureAlarmReceiptOutcome(command, result) === "FAILED"
                    );
                    if (planFailed) failedCount += 1;
                    else appliedCount += 1;
                } catch (error) {
                    const failures = await reserveReceiptOrderForExecutions(
                        failureExecutionsForPlan(plan, parsedAtMilliseconds),
                    );
                    executions.push(...failures);
                    failedCount += 1;
                    logSyncDevelopment("[alarm-sync] snapshot command failed", error);
                }
            }
            return {
                summary: { fetched: true, appliedCount, droppedCount, failedCount },
                executions,
            };
        });
        await Promise.all(mutation.executions.map((item) =>
            recordReceiptForExecution(item, "SNAPSHOT")
        ));
        return mutation.summary;
    })().finally(() => {
        if (
            snapshotInFlight?.memberId === expectedMemberId &&
            snapshotInFlight.generation === generation
        ) {
            snapshotInFlight = null;
        }
    });

    snapshotInFlight = { memberId: expectedMemberId, generation, promise };
    return promise;
}

/**
 * Recovery entry point for successful schedule mutations. It resolves the
 * persisted authenticated account at call time so feature screens never pass
 * a stale member id across an account switch.
 */
export async function reconcileDepartureAlarmSnapshotForCurrentAccount(
): Promise<DepartureAlarmSnapshotReconcileResult> {
    const recoveryGeneration = syncGeneration;
    const snapshotAtInvocation = snapshotInFlight;
    const memberId = await getCurrentAuthenticatedMemberId();
    if (!memberId) {
        return {
            fetched: false,
            appliedCount: 0,
            droppedCount: 0,
            failedCount: 0,
            reason: "INVALID_ACCOUNT",
        };
    }

    if (
        snapshotAtInvocation?.memberId === memberId &&
        snapshotAtInvocation.generation === recoveryGeneration
    ) {
        // A request already running when the schedule mutation completed may
        // contain the pre-mutation state. Let it drain, then force a later
        // request instead of treating its result as post-mutation recovery.
        await snapshotAtInvocation.promise.catch((error) => {
            logSyncDevelopment("[alarm-sync] pre-mutation snapshot drain failed", error);
        });
    }

    if (!(await isCurrentAccount(memberId, recoveryGeneration))) {
        return {
            fetched: false,
            appliedCount: 0,
            droppedCount: 0,
            failedCount: 0,
            reason: "ACCOUNT_CHANGED",
        };
    }
    return reconcileDepartureAlarmSnapshot(memberId);
}

/**
 * Invalidates fetched/queued work before the native purge is serialized behind
 * any mutation that already crossed the account boundary.
 */
export async function clearDepartureAlarmsForAccountCleanup(): Promise<boolean> {
    accountCleanupBlocked = true;
    syncGeneration += 1;
    snapshotInFlight = null;
    try {
        await SecureStore.setItemAsync(DEPARTURE_ALARM_CLEANUP_BLOCK_KEY, "1");
    } catch (error) {
        logSyncDevelopment("[alarm-sync] cleanup fence persistence failed", error);
        throw error;
    }
    const memberId = await getCurrentAuthenticatedMemberId();
    if (!isDepartureAlarmNativeAvailable()) {
        throw new Error("Departure alarm native module is unavailable during account cleanup.");
    }
    return enqueueNativeMutation(async () => {
        const cleared = await clearAllDepartureAlarms();
        if (cleared && memberId) await clearDepartureAlarmValidationRevisions(memberId);
        return cleared;
    });
}

/**
 * Opens a new synchronization epoch only after a login/signup response has
 * been persisted and still matches the authenticated account.
 */
export async function activateDepartureAlarmSyncForAuthenticatedAccount(
    memberId: number,
): Promise<boolean> {
    if (!Number.isSafeInteger(memberId) || memberId <= 0) return false;
    const activationGeneration = syncGeneration;

    return enqueueNativeMutation(async () => {
        if (
            activationGeneration !== syncGeneration ||
            (await getCurrentAuthenticatedMemberId()) !== memberId
        ) {
            return false;
        }
        if (!isDepartureAlarmNativeAvailable()) return false;
        try {
            // A public auth route can replace stored account A with account B
            // without first creating a cleanup marker. Always purge native
            // state at an explicit login/signup boundary, then rebuild only
            // the confirmed account from its authoritative snapshot.
            await clearAllDepartureAlarms();
            await clearDepartureAlarmValidationRevisions(memberId);
        } catch (error) {
            logSyncDevelopment("[alarm-sync] activation purge failed", error);
            return false;
        }
        try {
            await SecureStore.deleteItemAsync(DEPARTURE_ALARM_CLEANUP_BLOCK_KEY);
        } catch (error) {
            logSyncDevelopment("[alarm-sync] cleanup fence removal failed", error);
            return false;
        }
        if (activationGeneration !== syncGeneration) return false;

        syncGeneration += 1;
        snapshotInFlight = null;
        accountCleanupBlocked = false;
        return true;
    });
}

/**
 * Purges alarms before irreversible account withdrawal. If the server rejects
 * the withdrawal, the still-valid session is reopened and rebuilt from the
 * explicit snapshot without delaying the original error.
 */
export async function runWithDepartureAlarmWithdrawalGuard<T>(
    operation: () => Promise<T>,
): Promise<T> {
    const memberId = await getCurrentAuthenticatedMemberId();
    await clearDepartureAlarmsForAccountCleanup();
    try {
        return await operation();
    } catch (error) {
        if (memberId) {
            const activated = await activateDepartureAlarmSyncForAuthenticatedAccount(memberId);
            if (activated) {
                await reconcileDepartureAlarmSnapshot(memberId);
            }
        }
        throw error;
    }
}

function asDataMap(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
}

function nativeBridgeFailureResult(): DepartureAlarmMutationResult {
    return {
        applied: false,
        scheduled: false,
        reason: "NATIVE_BRIDGE_ERROR",
    };
}

function failureExecutionsForPlan(
    plan: DepartureAlarmSyncPlanCommand,
    nowMilliseconds = Date.now(),
): DepartureAlarmPlanMutationExecution[] {
    if (plan.operation === "CANCEL") {
        const command: DepartureAlarmSyncCommand = {
            operation: "CANCEL",
            alarmId: plan.alarmId,
            scheduleId: plan.scheduleId,
            generation: plan.generation,
            recipientMemberId: plan.recipientMemberId,
            ...(plan.logicalEventKey ? { logicalEventKey: plan.logicalEventKey } : {}),
        };
        return [{ command, result: nativeBridgeFailureResult() }];
    }
    return plan.occurrences
        .filter((command) => isDepartureAlarmOccurrenceEligible(command, nowMilliseconds))
        .map((command) => ({ command, result: nativeBridgeFailureResult() }));
}

async function reserveReceiptOrderForExecutions(
    executions: DepartureAlarmPlanMutationExecution[],
): Promise<DepartureAlarmPlanMutationExecution[]> {
    const ordered: DepartureAlarmPlanMutationExecution[] = [];
    for (const execution of executions) {
        const mutationOccurredAt = new Date().toISOString();
        const mutationSequence = execution.command.occurrenceId
            ? await reserveDepartureAlarmMutationSequence(execution.command.recipientMemberId)
            : undefined;
        ordered.push({
            ...execution,
            mutationOccurredAt,
            ...(mutationSequence ? { mutationSequence } : {}),
        });
    }
    return ordered;
}

function recordReceiptForExecution(
    execution: DepartureAlarmPlanMutationExecution,
    source: "PUSH" | "SNAPSHOT",
): Promise<"sent" | "queued" | "rejected"> {
    if (!execution.command.occurrenceId) {
        return recordDepartureAlarmScheduleReceiptDurably(
            execution.command,
            execution.result,
            source,
        );
    }
    return recordDepartureAlarmScheduleReceiptDurably(
        execution.command,
        execution.result,
        source,
        execution.mutationOccurredAt,
        execution.mutationSequence,
    );
}

/** Test-only reset for module-level sequencing state. */
export async function resetDepartureAlarmSyncForTests(): Promise<void> {
    if (process.env.NODE_ENV !== "test") return;
    syncGeneration += 1;
    snapshotInFlight = null;
    await nativeMutationQueue;
    await SecureStore.deleteItemAsync(DEPARTURE_ALARM_CLEANUP_BLOCK_KEY).catch(() => undefined);
    await resetDepartureAlarmValidationRevisionJournalForTests();
    accountCleanupBlocked = false;
    nativeMutationQueue = Promise.resolve();
}

const DEPARTURE_ALARM_CLEANUP_BLOCK_KEY = "nolate_departure_alarm_cleanup_block_v1";
