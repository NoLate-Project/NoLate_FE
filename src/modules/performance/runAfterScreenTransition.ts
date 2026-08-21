import { InteractionManager } from "react-native";

// Native-stack transitions are not always registered as React Native interaction
// handles. Keep network response/state work outside the configured 140–160ms
// animation even when runAfterInteractions resolves as soon as the route mounts.
export const SCREEN_TRANSITION_SETTLE_MS = 220;

export type ScreenTransitionTask = {
    cancel(): void;
};

export function runAfterScreenTransition(
    task: () => void,
    settleMs = process.env.NODE_ENV === "test" ? 0 : SCREEN_TRANSITION_SETTLE_MS,
): ScreenTransitionTask {
    let cancelled = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const interactionTask = InteractionManager.runAfterInteractions(() => {
        if (cancelled) return;
        if (settleMs <= 0) {
            task();
            return;
        }
        settleTimer = setTimeout(() => {
            settleTimer = null;
            if (!cancelled) task();
        }, settleMs);
    });

    return {
        cancel() {
            cancelled = true;
            interactionTask.cancel();
            if (settleTimer !== null) clearTimeout(settleTimer);
        },
    };
}
