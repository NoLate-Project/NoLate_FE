import { createSingleFlightRunner } from "../src/api/singleFlight";

describe("createSingleFlightRunner", () => {
    it("shares one operation while concurrent calls are pending", async () => {
        const runSingleFlight = createSingleFlightRunner<string>();
        let invocationCount = 0;
        let resolveOperation: ((value: string) => void) | undefined;
        const operation = jest.fn(
            () =>
                new Promise<string>((resolve) => {
                    invocationCount += 1;
                    resolveOperation = resolve;
                })
        );

        const first = runSingleFlight(operation);
        const second = runSingleFlight(operation);

        await Promise.resolve();
        expect(invocationCount).toBe(1);
        resolveOperation?.("new-token");

        await expect(Promise.all([first, second])).resolves.toEqual(["new-token", "new-token"]);
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it("allows a new operation after the previous one settles", async () => {
        const runSingleFlight = createSingleFlightRunner<number>();
        const operation = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

        await expect(runSingleFlight(operation)).resolves.toBe(1);
        await expect(runSingleFlight(operation)).resolves.toBe(2);

        expect(operation).toHaveBeenCalledTimes(2);
    });
});
