import { Platform } from "react-native";

export type JourneyEngineInputMode = "SIMULATOR_LOCATION" | "TIMED_REPLAY";
export type JourneyEngineStatus = "IDLE" | "ARMED" | "ACTIVE" | "STOPPED" | "EXPIRED";
export type JourneyEngineSnapshot = {
    enabled: boolean;
    reason: string | null;
    inputMode: "NONE" | JourneyEngineInputMode;
    locationState: string;
    authorization: string;
    applicationState: string;
    status: JourneyEngineStatus;
    quality: string;
    qualityReason: string;
    sequence: number;
    evidenceCount: number;
    alongRouteMeters: number | null;
    crossTrackMeters: number | null;
    departureCount: number;
    checkpointAvailable: boolean;
    restored: boolean;
    remainingSeconds: number;
    traceFinished: boolean;
    lastErrorCode: string | null;
};

type NativeSubscription = { remove(): void };
type NativeEngine = {
    getJourneyEngineSnapshot(): Promise<unknown>;
    armJourneyEngine(mode: JourneyEngineInputMode): Promise<unknown>;
    stopJourneyEngine(): Promise<unknown>;
    restoreJourneyEngine(): Promise<unknown>;
    addListener(name: "onJourneyEngineStateChange", listener: (value: unknown) => void): NativeSubscription;
};
type EngineMethod = Exclude<keyof NativeEngine, "addListener">;
const statuses: readonly string[] = ["IDLE", "ARMED", "ACTIVE", "STOPPED", "EXPIRED"];
const modes: readonly string[] = ["NONE", "SIMULATOR_LOCATION", "TIMED_REPLAY"];
const code = (value: unknown): string | null => typeof value === "string" && /^[A-Z][A-Z0-9_]{0,95}$/.test(value) ? value : null;
const nonnegative = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const count = (value: unknown): number => {
    const valid = nonnegative(value);
    return valid !== null && Number.isSafeInteger(Math.trunc(valid)) ? Math.trunc(valid) : 0;
};

/** Only bounded state/metrics cross the bridge; never expose coordinates, identities, or tokens. */
export function normalizeJourneyEngineSnapshot(value: unknown): JourneyEngineSnapshot {
    const root = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const validStatus = typeof root.status === "string" && statuses.includes(root.status);
    return {
        enabled: root.enabled === true && validStatus,
        reason: code(root.reason),
        inputMode: typeof root.inputMode === "string" && modes.includes(root.inputMode)
            ? root.inputMode as JourneyEngineSnapshot["inputMode"] : "NONE",
        locationState: code(root.locationState) ?? "UNKNOWN",
        authorization: code(root.authorization) ?? "UNKNOWN",
        applicationState: code(root.applicationState) ?? "UNKNOWN",
        status: validStatus ? root.status as JourneyEngineStatus : "IDLE",
        quality: code(root.quality) ?? "UNKNOWN",
        qualityReason: code(root.qualityReason) ?? "UNKNOWN",
        sequence: count(root.sequence),
        evidenceCount: count(root.evidenceCount),
        alongRouteMeters: nonnegative(root.alongRouteMeters),
        crossTrackMeters: nonnegative(root.crossTrackMeters),
        departureCount: count(root.departureCount),
        checkpointAvailable: root.checkpointAvailable === true,
        restored: root.restored === true,
        remainingSeconds: count(root.remainingSeconds),
        traceFinished: root.traceFinished === true,
        lastErrorCode: code(root.lastErrorCode),
    };
}

function nativeModule(): NativeEngine | null {
    const { requireOptionalNativeModule } = require("expo-modules-core");
    return requireOptionalNativeModule("NoLateLiveActivity") as NativeEngine | null;
}

async function invoke(method: EngineMethod, mode?: JourneyEngineInputMode): Promise<JourneyEngineSnapshot> {
    if (!__DEV__ || Platform.OS !== "ios") return normalizeJourneyEngineSnapshot({ reason: "DEVELOPMENT_IOS_ONLY" });
    if (method === "armJourneyEngine" && mode !== "SIMULATOR_LOCATION" && mode !== "TIMED_REPLAY") {
        return normalizeJourneyEngineSnapshot({ reason: "INVALID_INPUT_MODE" });
    }
    try {
        const native = nativeModule();
        if (!native || typeof native[method] !== "function") return normalizeJourneyEngineSnapshot({ reason: "NATIVE_REBUILD_REQUIRED" });
        const value = method === "armJourneyEngine" ? await native.armJourneyEngine(mode!) : await native[method]();
        return normalizeJourneyEngineSnapshot(value);
    } catch {
        // Native exceptions can contain configuration or sensitive data. Never forward their text.
        return normalizeJourneyEngineSnapshot({ reason: "ENGINE_UNAVAILABLE" });
    }
}

export const getJourneyEngineSnapshot = () => invoke("getJourneyEngineSnapshot");
export const armJourneyEngine = (mode: JourneyEngineInputMode) => invoke("armJourneyEngine", mode);
export const stopJourneyEngine = () => invoke("stopJourneyEngine");
export const restoreJourneyEngine = () => invoke("restoreJourneyEngine");

/** Detaching this view subscription never stops the native runtime. */
export function subscribeJourneyEngine(listener: (snapshot: JourneyEngineSnapshot) => void): () => void {
    if (!__DEV__ || Platform.OS !== "ios") return () => undefined;
    let active = true;
    let subscription: NativeSubscription | undefined;
    try {
        const native = nativeModule();
        if (typeof native?.addListener !== "function") return () => undefined;
        subscription = native.addListener("onJourneyEngineStateChange", value => {
            if (active) listener(normalizeJourneyEngineSnapshot(value));
        });
    } catch {
        // A missing/older native build is reported by the snapshot read; no raw error is exposed.
    }
    return () => {
        if (!active) return;
        active = false;
        try { subscription?.remove(); } catch { /* Detach is best effort and must not stop the engine. */ }
    };
}
