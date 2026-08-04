import { reconcileDepartureAlarmSnapshotForCurrentAccount } from "./departureAlarmSync";

function logRecoveryDevelopment(message: string, detail?: unknown): void {
    if (!__DEV__ || process.env.NODE_ENV === "test") return;
    if (detail === undefined) {
        console.warn(message);
    } else {
        console.warn(message, detail);
    }
}

/**
 * Runs force-fresh alarm recovery after a successful business mutation.
 *
 * The mutation has already committed when this function is called, so snapshot
 * availability must never change the mutation's success or return value.
 */
export async function recoverDepartureAlarmsAfterMutation(): Promise<void> {
    try {
        const result = await reconcileDepartureAlarmSnapshotForCurrentAccount();
        if (!result.fetched && result.reason === "REQUEST_FAILED") {
            logRecoveryDevelopment("[alarm-sync] post-mutation recovery request failed");
        }
    } catch (error) {
        logRecoveryDevelopment("[alarm-sync] post-mutation recovery failed", error);
    }
}

/**
 * Coalesces a completed mutation batch into one force-fresh snapshot request.
 */
export async function recoverDepartureAlarmsAfterMutationBatch(
    successfulMutationCount: number,
): Promise<void> {
    if (!Number.isFinite(successfulMutationCount) || successfulMutationCount <= 0) {
        return;
    }
    await recoverDepartureAlarmsAfterMutation();
}
