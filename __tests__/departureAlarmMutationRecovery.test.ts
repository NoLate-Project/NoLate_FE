const mockReconcileDepartureAlarmSnapshotForCurrentAccount = jest.fn();

jest.mock("../src/modules/notification/departureAlarmSync", () => ({
    reconcileDepartureAlarmSnapshotForCurrentAccount: () =>
        mockReconcileDepartureAlarmSnapshotForCurrentAccount(),
}));

import {
    recoverDepartureAlarmsAfterMutation,
    recoverDepartureAlarmsAfterMutationBatch,
} from "../src/modules/notification/departureAlarmMutationRecovery";

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

describe("post-mutation departure alarm recovery", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("awaits a force-fresh current-account reconciliation", async () => {
        const pending = deferred<{
            fetched: boolean;
            appliedCount: number;
            droppedCount: number;
        }>();
        mockReconcileDepartureAlarmSnapshotForCurrentAccount.mockReturnValue(
            pending.promise,
        );
        let completed = false;

        const recovery = recoverDepartureAlarmsAfterMutation().then(() => {
            completed = true;
        });
        await Promise.resolve();

        expect(completed).toBe(false);
        expect(mockReconcileDepartureAlarmSnapshotForCurrentAccount).toHaveBeenCalledTimes(1);

        pending.resolve({ fetched: true, appliedCount: 1, droppedCount: 0 });
        await recovery;

        expect(completed).toBe(true);
    });

    it("absorbs request failures and unexpected rejections", async () => {
        mockReconcileDepartureAlarmSnapshotForCurrentAccount
            .mockResolvedValueOnce({
                fetched: false,
                appliedCount: 0,
                droppedCount: 0,
                reason: "REQUEST_FAILED",
            })
            .mockRejectedValueOnce(new Error("unexpected recovery failure"));

        await expect(recoverDepartureAlarmsAfterMutation()).resolves.toBeUndefined();
        await expect(recoverDepartureAlarmsAfterMutation()).resolves.toBeUndefined();
    });

    it("does not add its own single-flight state to simultaneous recoveries", async () => {
        const first = deferred<{
            fetched: boolean;
            appliedCount: number;
            droppedCount: number;
        }>();
        const second = deferred<{
            fetched: boolean;
            appliedCount: number;
            droppedCount: number;
        }>();
        mockReconcileDepartureAlarmSnapshotForCurrentAccount
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);

        const recoveries = [
            recoverDepartureAlarmsAfterMutation(),
            recoverDepartureAlarmsAfterMutation(),
        ];

        expect(mockReconcileDepartureAlarmSnapshotForCurrentAccount).toHaveBeenCalledTimes(2);

        first.resolve({ fetched: true, appliedCount: 1, droppedCount: 0 });
        second.resolve({ fetched: true, appliedCount: 1, droppedCount: 0 });
        await expect(Promise.all(recoveries)).resolves.toEqual([undefined, undefined]);
    });

    it("coalesces a successful import batch into one recovery", async () => {
        mockReconcileDepartureAlarmSnapshotForCurrentAccount.mockResolvedValue({
            fetched: true,
            appliedCount: 3,
            droppedCount: 0,
        });

        await recoverDepartureAlarmsAfterMutationBatch(3);

        expect(mockReconcileDepartureAlarmSnapshotForCurrentAccount).toHaveBeenCalledTimes(1);
    });

    it("skips recovery for a batch without a successful mutation", async () => {
        await recoverDepartureAlarmsAfterMutationBatch(0);
        await recoverDepartureAlarmsAfterMutationBatch(Number.NaN);

        expect(mockReconcileDepartureAlarmSnapshotForCurrentAccount).not.toHaveBeenCalled();
    });
});
