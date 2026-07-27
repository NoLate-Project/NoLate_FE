export type ScheduledInteractionHandle = {
    cancel?: () => void;
};

export function scheduleNotificationInteractionForAuthSession(options: {
    authEpoch: number;
    isAuthSessionActive: (epoch: number) => boolean;
    schedule: (callback: () => void) => ScheduledInteractionHandle;
    action: () => void;
}): ScheduledInteractionHandle | undefined {
    if (!options.isAuthSessionActive(options.authEpoch)) return undefined;
    return options.schedule(() => {
        if (!options.isAuthSessionActive(options.authEpoch)) return;
        options.action();
    });
}
