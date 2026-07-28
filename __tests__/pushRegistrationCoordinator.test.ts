import {
    cancelPendingPushRegistration,
    isPushRegistrationGenerationCurrent,
    runPushRegistration,
} from "../src/modules/notification/pushRegistrationCoordinator";

function deferred(): {
    promise: Promise<void>;
    resolve: () => void;
} {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

describe("push registration coordinator", () => {
    afterEach(() => {
        cancelPendingPushRegistration();
    });

    test("deduplicates concurrent registration for the same member", async () => {
        const pending = deferred();
        const task = jest.fn(() => pending.promise);

        const first = runPushRegistration(7, task);
        const second = runPushRegistration(7, task);

        expect(second).toBe(first);
        expect(task).toHaveBeenCalledTimes(1);

        pending.resolve();
        await first;
    });

    test("invalidates old work when the account changes or signs out", async () => {
        const firstPending = deferred();
        let firstGeneration = -1;

        const first = runPushRegistration(7, async (taskGeneration) => {
            firstGeneration = taskGeneration;
            await firstPending.promise;
        });
        const second = runPushRegistration(9, async (taskGeneration) => {
            expect(isPushRegistrationGenerationCurrent(taskGeneration)).toBe(true);
        });

        expect(isPushRegistrationGenerationCurrent(firstGeneration)).toBe(false);
        await second;

        cancelPendingPushRegistration();
        firstPending.resolve();
        await first;
        expect(isPushRegistrationGenerationCurrent(firstGeneration)).toBe(false);
    });
});
