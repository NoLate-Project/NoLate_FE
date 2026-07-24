import {
    getAuthSessionEpoch,
    subscribeAuthSessionEpoch,
} from "./authStorage";

export function createAuthEpochAbortController(expectedEpoch: number) {
    const controller = new AbortController();
    const unsubscribe = subscribeAuthSessionEpoch((epoch) => {
        if (epoch !== expectedEpoch) controller.abort();
    });
    if (getAuthSessionEpoch() !== expectedEpoch) controller.abort();

    return {
        signal: controller.signal,
        abort(): void {
            controller.abort();
            unsubscribe();
        },
        dispose(): void {
            unsubscribe();
        },
    };
}
