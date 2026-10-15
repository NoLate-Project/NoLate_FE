import { InteractionManager } from "react-native";

// Screen navigation is intentionally animation-free for the 50ms first-paint
// budget. InteractionManager still keeps synchronous work out of an active
// gesture, but an additional timer would only delay background revalidation.
export const SCREEN_TRANSITION_SETTLE_MS = 0;

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
