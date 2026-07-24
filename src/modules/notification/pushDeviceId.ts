let deviceIdMutationTail: Promise<void> = Promise.resolve();

export function getOrCreatePushDeviceId(options: {
    read: () => Promise<string | null>;
    write: (deviceId: string) => Promise<void>;
    generate: () => string;
}): Promise<string> {
    const result = deviceIdMutationTail
        .catch(() => undefined)
        .then(async () => {
            const existing = await options.read();
            if (existing) return existing;
            const generated = options.generate();
            await options.write(generated);
            return generated;
        });
    deviceIdMutationTail = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
}
