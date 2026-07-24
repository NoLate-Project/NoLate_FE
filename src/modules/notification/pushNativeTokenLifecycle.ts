type NativeSessionFence = {
    isCurrent: () => boolean;
};

let nativeMutationTail: Promise<void> = Promise.resolve();

function runNativeMutation<T>(task: () => Promise<T>): Promise<T> {
    const result = nativeMutationTail
        .catch(() => undefined)
        .then(task);
    nativeMutationTail = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
}

export async function getPushTokenForNativeContext(options: {
    nativeContext: string;
    fence: NativeSessionFence;
    readContext: () => Promise<string | null>;
    deleteToken: () => Promise<void>;
    getToken: () => Promise<string>;
    onDeleteError?: (error: unknown) => void;
}): Promise<string | undefined> {
    if (!options.fence.isCurrent()) return undefined;
    const previousContext = await options.readContext();
    if (!options.fence.isCurrent()) return undefined;

    return runNativeMutation(async () => {
        if (!options.fence.isCurrent()) return undefined;

        if (previousContext !== options.nativeContext) {
            if (!options.fence.isCurrent()) return undefined;
            try {
                await options.deleteToken();
            } catch (error) {
                if (!options.fence.isCurrent()) return undefined;
                options.onDeleteError?.(error);
            }
            if (!options.fence.isCurrent()) return undefined;
        }

        if (!options.fence.isCurrent()) return undefined;
        const token = await options.getToken();
        if (!options.fence.isCurrent()) return undefined;
        return token;
    });
}

export async function writePushNativeContext(options: {
    nativeContext: string;
    fence: NativeSessionFence;
    writeContext: (nativeContext: string) => Promise<void>;
}): Promise<boolean> {
    if (!options.fence.isCurrent()) return false;
    return runNativeMutation(async () => {
        if (!options.fence.isCurrent()) return false;
        await options.writeContext(options.nativeContext);
        return options.fence.isCurrent();
    });
}

export async function clearPushNativeTokenState(options: {
    deleteContext: () => Promise<void>;
    deleteToken?: () => Promise<void>;
    onDeleteTokenError?: (error: unknown) => void;
}): Promise<void> {
    await runNativeMutation(async () => {
        await options.deleteContext();
        if (!options.deleteToken) return;
        try {
            await options.deleteToken();
        } catch (error) {
            options.onDeleteTokenError?.(error);
        }
    });
}
