import {
    createPushActionFailureGate,
    type PushActionFailure,
} from "../src/modules/notification/pushActionFailureGate";

const failure = (scheduleId: string): PushActionFailure => ({
    action: "departNow",
    scheduleId,
    message: `failed ${scheduleId}`,
});

describe("push action failure foreground gate", () => {
    test("delivers immediately while the app is active", () => {
        const deliver = jest.fn();
        const gate = createPushActionFailureGate(deliver, true);

        gate.report(failure("1"));

        expect(deliver).toHaveBeenCalledWith(failure("1"));
    });

    test("defers failures while inactive and flushes them in order on foreground", () => {
        const deliver = jest.fn();
        const gate = createPushActionFailureGate(deliver, false);

        gate.report(failure("1"));
        gate.report(failure("2"));
        expect(deliver).not.toHaveBeenCalled();

        gate.onAppStateChange("active");

        expect(deliver.mock.calls.map(([value]) => value.scheduleId)).toEqual(["1", "2"]);
    });

    test("bounds the pending queue and does not deliver after disposal", () => {
        const deliver = jest.fn();
        const gate = createPushActionFailureGate(deliver, false);

        ["1", "2", "3", "4"].forEach((id) => gate.report(failure(id)));
        gate.onAppStateChange("active");
        expect(deliver.mock.calls.map(([value]) => value.scheduleId)).toEqual(["2", "3", "4"]);

        gate.onAppStateChange("inactive");
        gate.report(failure("5"));
        gate.dispose();
        gate.onAppStateChange("active");
        expect(deliver).toHaveBeenCalledTimes(3);
    });

    test("auth session cleanup drops an inactive account's queued failure", () => {
        const deliver = jest.fn();
        const gate = createPushActionFailureGate(deliver, false);

        gate.report(failure("A-private"));
        gate.clearPending();
        gate.onAppStateChange("active");

        expect(deliver).not.toHaveBeenCalled();
    });
});
