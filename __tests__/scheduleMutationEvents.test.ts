import {
    emitScheduleMutation,
    subscribeScheduleMutation,
} from "../src/modules/schedule/scheduleMutationEvents";

describe("schedule mutation events", () => {
    test("notifies current subscribers once and stops after unsubscribe", () => {
        const listener = jest.fn();
        const unsubscribe = subscribeScheduleMutation(listener);

        emitScheduleMutation();
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        emitScheduleMutation();
        expect(listener).toHaveBeenCalledTimes(1);
    });

    test("does not fail a successful mutation when a cache listener throws", () => {
        const unsubscribe = subscribeScheduleMutation(() => {
            throw new Error("cache listener failed");
        });

        expect(() => emitScheduleMutation()).not.toThrow();
        unsubscribe();
    });
});
