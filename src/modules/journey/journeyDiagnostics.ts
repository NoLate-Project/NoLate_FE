import { Platform } from "react-native";

export type JourneyProbeSpeechMode = "RESPECT_SILENT" | "LOCK_SCREEN";
export type JourneyDiagnosticsSnapshot = {
    enabled: boolean;
    reason: string | null;
    iosVersion: string;
    applicationState: string;
    location: {
        servicesEnabled: boolean;
        authorization: string;
        accuracyAuthorization: string;
        backgroundModeConfigured: boolean;
        state: string;
        totalSamples: number;
        foregroundSamples: number;
        backgroundSamples: number;
        lastAccuracyMeters: number | null;
        lastSampleAtEpochMs: number | null;
        lastErrorCode: string | null;
    };
    speech: {
        state: string;
        mode: string;
        startedCount: number;
        completedCount: number;
        cancelledCount: number;
        lastErrorCode: string | null;
        outputMuteSupported: boolean;
        outputMuted: boolean | null;
        hardwareSilentState: "UNAVAILABLE";
    };
    liveActivity: { activitiesEnabled: boolean; pushToStartSupported: boolean };
};

type ProbeModule = {
    getJourneyDiagnostics(): Promise<unknown>;
    startJourneyLocationProbe(): Promise<unknown>;
    stopJourneyLocationProbe(): Promise<unknown>;
    speakJourneyProbe(mode: JourneyProbeSpeechMode): Promise<unknown>;
};
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" ? value as RecordValue : {};
const label = (value: unknown, fallback = "UNKNOWN"): string => typeof value === "string" ? value : fallback;
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const count = (value: unknown) => Math.max(0, Math.trunc(number(value) ?? 0));
const nullableLabel = (value: unknown) => typeof value === "string" ? value : null;

// Whitelist fields: native coordinates, device identifiers and push tokens never reach this screen.
export function normalizeJourneyDiagnostics(value: unknown): JourneyDiagnosticsSnapshot {
    const root = record(value);
    const location = record(root.location);
    const speech = record(root.speech);
    const activity = record(root.liveActivity);
    return {
        enabled: root.enabled === true,
        reason: nullableLabel(root.reason),
        iosVersion: label(root.iosVersion),
        applicationState: label(root.applicationState),
        location: {
            servicesEnabled: location.servicesEnabled === true,
            authorization: label(location.authorization),
            accuracyAuthorization: label(location.accuracyAuthorization),
            backgroundModeConfigured: location.backgroundModeConfigured === true,
            state: label(location.state),
            totalSamples: count(location.totalSamples),
            foregroundSamples: count(location.foregroundSamples),
            backgroundSamples: count(location.backgroundSamples),
            lastAccuracyMeters: number(location.lastAccuracyMeters),
            lastSampleAtEpochMs: number(location.lastSampleAtEpochMs),
            lastErrorCode: nullableLabel(location.lastErrorCode),
        },
        speech: {
            state: label(speech.state),
            mode: label(speech.mode),
            startedCount: count(speech.startedCount),
            completedCount: count(speech.completedCount),
            cancelledCount: count(speech.cancelledCount),
            lastErrorCode: nullableLabel(speech.lastErrorCode),
            outputMuteSupported: speech.outputMuteSupported === true,
            outputMuted: typeof speech.outputMuted === "boolean" ? speech.outputMuted : null,
            hardwareSilentState: "UNAVAILABLE",
        },
        liveActivity: {
            activitiesEnabled: activity.activitiesEnabled === true,
            pushToStartSupported: activity.pushToStartSupported === true,
        },
    };
}

async function invoke(method: keyof ProbeModule, mode?: JourneyProbeSpeechMode): Promise<JourneyDiagnosticsSnapshot> {
    if (!__DEV__ || Platform.OS !== "ios") return normalizeJourneyDiagnostics({ reason: "DEVELOPMENT_IOS_ONLY" });
    try {
        const { requireOptionalNativeModule } = require("expo-modules-core");
        const native = requireOptionalNativeModule("NoLateLiveActivity") as ProbeModule | null;
        if (!native || typeof native[method] !== "function") return normalizeJourneyDiagnostics({ reason: "NATIVE_REBUILD_REQUIRED" });
        const value = method === "speakJourneyProbe"
            ? await native.speakJourneyProbe(mode ?? "RESPECT_SILENT")
            : await native[method]();
        return normalizeJourneyDiagnostics(value);
    } catch {
        // Do not display/log native errors that could contain configuration or location data.
        return normalizeJourneyDiagnostics({ reason: "PROBE_UNAVAILABLE" });
    }
}

export const getJourneyDiagnostics = () => invoke("getJourneyDiagnostics");
export const startJourneyLocationProbe = () => invoke("startJourneyLocationProbe");
export const stopJourneyLocationProbe = () => invoke("stopJourneyLocationProbe");
export const speakJourneyProbe = (mode: JourneyProbeSpeechMode) => invoke("speakJourneyProbe", mode);
