let presentationMutationTail: Promise<void> = Promise.resolve();

/**
 * Serializes tray cleanup and local presentation. A new account's foreground
 * notification is therefore presented only after an already-started logout
 * cleanup has finished, rather than being removed by that cleanup.
 */
export function runNotificationPresentationMutation<T>(
    task: () => Promise<T>,
): Promise<T> {
    const result = presentationMutationTail
        .catch(() => undefined)
        .then(task);
    presentationMutationTail = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
}
