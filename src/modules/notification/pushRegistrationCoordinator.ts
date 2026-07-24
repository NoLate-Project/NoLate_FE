type PushRegistrationTask = (generation: number) => Promise<void>;

let generation = 0;
let inFlight: {
    memberId: number;
    generation: number;
    promise: Promise<void>;
} | null = null;

/**
 * Invalidates any asynchronous push bootstrap that belongs to the previous
 * authentication state. The native work itself may not be abortable, so each
 * awaited boundary checks this generation before it can register a token.
 */
export function cancelPendingPushRegistration(): void {
    generation += 1;
    inFlight = null;
}

export function isPushRegistrationGenerationCurrent(candidate: number): boolean {
    return candidate === generation;
}

/**
 * Shares one registration promise for duplicate bootstrap calls from the same
 * member, while invalidating an older member's unfinished registration.
 */
export function runPushRegistration(
    memberId: number,
    task: PushRegistrationTask,
    options: { replaceExisting?: boolean } = {},
): Promise<void> {
    if (options.replaceExisting) {
        generation += 1;
        inFlight = null;
    }
    if (
        inFlight?.memberId === memberId &&
        inFlight.generation === generation
    ) {
        return inFlight.promise;
    }

    if (inFlight && inFlight.memberId !== memberId) {
        generation += 1;
    }

    const taskGeneration = generation;
    const promise = task(taskGeneration).finally(() => {
        if (
            inFlight?.memberId === memberId &&
            inFlight.generation === taskGeneration
        ) {
            inFlight = null;
        }
    });

    inFlight = { memberId, generation: taskGeneration, promise };
    return promise;
}
