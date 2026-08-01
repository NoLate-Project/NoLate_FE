import { recoverDepartureAlarmsAfterMutationBatch } from "../notification/departureAlarmMutationRecovery";

type CalendarImportMutationResult = {
    created: boolean;
};

type RecoverMutationBatch = (successfulMutationCount: number) => Promise<void>;

export type CalendarImportAlarmRecoveryBatch = {
    run<T extends CalendarImportMutationResult>(
        mutation: () => Promise<T>,
    ): Promise<T>;
    finish(): Promise<void>;
};

/**
 * Counts only imports that actually created a schedule and reconciles once
 * after the whole sequential import batch has settled.
 */
export function createCalendarImportAlarmRecoveryBatch(
    recoverMutationBatch: RecoverMutationBatch =
        recoverDepartureAlarmsAfterMutationBatch,
): CalendarImportAlarmRecoveryBatch {
    let successfulMutationCount = 0;
    let finished = false;

    return {
        async run<T extends CalendarImportMutationResult>(
            mutation: () => Promise<T>,
        ): Promise<T> {
            const result = await mutation();
            if (result.created) successfulMutationCount += 1;
            return result;
        },
        async finish(): Promise<void> {
            if (finished) return;
            finished = true;
            if (successfulMutationCount <= 0) return;
            await recoverMutationBatch(successfulMutationCount);
        },
    };
}
