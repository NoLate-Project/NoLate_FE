import { NativeModules, Platform } from "react-native";

import type { NoLateWidgetSnapshot } from "./widgetSnapshot";

type NativeNoLateWidget = {
    writeSnapshot(json: string): Promise<boolean | { stored?: boolean }>;
    clearSnapshot(): Promise<boolean>;
};

const nativeWidget = Platform.OS === "ios"
    ? NativeModules.NoLateWidget as NativeNoLateWidget | undefined
    : undefined;

let snapshotGeneration = 0;
let snapshotPublishingEnabled = false;
let nativeMutationQueue: Promise<void> = Promise.resolve();

function enqueueNativeMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = nativeMutationQueue.then(mutation, mutation);
    nativeMutationQueue = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
}

export function isNoLateWidgetSyncAvailable(): boolean {
    return Boolean(nativeWidget);
}

export function activateNoLateWidgetSnapshotPublishing(): number {
    snapshotPublishingEnabled = true;
    return snapshotGeneration;
}

export function getNoLateWidgetSnapshotGeneration(): number {
    return snapshotGeneration;
}

export function isNoLateWidgetSnapshotPublishingEnabled(): boolean {
    return snapshotPublishingEnabled;
}

export function invalidateNoLateWidgetSnapshotPublishing(): number {
    snapshotPublishingEnabled = false;
    snapshotGeneration += 1;
    return snapshotGeneration;
}

export async function writeNoLateWidgetSnapshot(
    snapshot: NoLateWidgetSnapshot,
    expectedGeneration = snapshotGeneration,
): Promise<boolean> {
    if (
        !nativeWidget ||
        !snapshotPublishingEnabled ||
        expectedGeneration !== snapshotGeneration
    ) return false;

    return enqueueNativeMutation(async () => {
        if (
            !snapshotPublishingEnabled ||
            expectedGeneration !== snapshotGeneration
        ) return false;

        const result = await nativeWidget.writeSnapshot(JSON.stringify(snapshot));
        if (
            !snapshotPublishingEnabled ||
            expectedGeneration !== snapshotGeneration
        ) return false;
        return typeof result === "boolean" ? result : result.stored === true;
    });
}

export async function clearNoLateWidgetSnapshot(): Promise<boolean> {
    invalidateNoLateWidgetSnapshotPublishing();
    if (!nativeWidget) return false;
    return enqueueNativeMutation(() => nativeWidget.clearSnapshot());
}
