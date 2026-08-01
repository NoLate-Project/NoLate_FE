import { Platform } from "react-native";

import type { DepartureAlarmSyncCommand } from "./departureAlarmContract";

const NATIVE_MODULE_NAME = "NoLateAlarm";

export type DepartureAlarmCapabilities = {
    supported: boolean;
    platform: "android" | "ios" | "other";
    exactAlarmAuthorized: boolean;
    fullScreenAuthorized: boolean;
    notificationAuthorized: boolean;
    deliveryMode?: "alarmKit" | "timeSensitive";
    alarmKitAuthorization?:
        | "notDetermined"
        | "denied"
        | "authorized"
        | "unknown"
        | "unavailable"
        | "notSupported";
    notificationAuthorization?:
        | "notDetermined"
        | "denied"
        | "authorized"
        | "provisional"
        | "ephemeral"
        | "unknown";
    timeSensitiveAuthorization?: "notSupported" | "disabled" | "enabled" | "unknown";
    soundAuthorization?: "notSupported" | "disabled" | "enabled" | "unknown";
    reason?: string;
};

export type DepartureAlarmMutationResult = {
    applied: boolean;
    scheduled: boolean;
    reason?: string;
    /** Actual native delivery selected for this mutation, when the binary can report it. */
    deliveryMode?: "androidExact" | "androidInexact" | "alarmKit" | "timeSensitive";
};

export type NativeAlarmFireEvent = {
    eventId: string;
    alarmId: string;
    scheduleId: string;
    generation: number;
    recipientMemberId: number;
    scheduledFor: string;
    sourceTriggerAt?: string;
    occurredAt: string;
    timingBasis: "EXACT_CALLBACK" | "OBSERVED_ALERTING" | "INFERRED_OS_DELIVERY";
    logicalEventKey?: string;
};

type NativeAlarmModule = {
    getCapabilities(): Promise<DepartureAlarmCapabilities>;
    upsertAlarm(command: DepartureAlarmSyncCommand): Promise<DepartureAlarmMutationResult>;
    cancelAlarm(command: {
        alarmId: string;
        scheduleId: string;
        generation: number;
    }): Promise<DepartureAlarmMutationResult>;
    getScheduledAlarms(): Promise<DepartureAlarmSyncCommand[]>;
    openExactAlarmSettings(): Promise<boolean>;
    openFullScreenSettings(): Promise<boolean>;
    scheduleTestAlarm(delaySeconds: number): Promise<DepartureAlarmMutationResult>;
    stopRinging(): Promise<boolean>;
    clearAllAlarms(): Promise<boolean>;
    getPendingAlarmFireEvents?(): Promise<unknown[]>;
    removeAlarmFireEvent?(eventId: string): Promise<boolean>;
};

let cachedNativeModule: NativeAlarmModule | null | undefined;

function getNativeAlarmModule(): NativeAlarmModule | null {
    if (cachedNativeModule !== undefined) return cachedNativeModule;
    if (Platform.OS !== "android" && Platform.OS !== "ios") {
        cachedNativeModule = null;
        return cachedNativeModule;
    }

    try {
        const { requireOptionalNativeModule } = require("expo-modules-core") as {
            requireOptionalNativeModule: (name: string) => NativeAlarmModule | null;
        };
        cachedNativeModule = requireOptionalNativeModule(NATIVE_MODULE_NAME);
    } catch {
        cachedNativeModule = null;
    }
    return cachedNativeModule;
}

export function isDepartureAlarmNativeAvailable(): boolean {
    return getNativeAlarmModule() !== null;
}

export async function getDepartureAlarmCapabilities(): Promise<DepartureAlarmCapabilities> {
    const module = getNativeAlarmModule();
    if (!module) {
        return {
            supported: false,
            platform: Platform.OS === "android" || Platform.OS === "ios" ? Platform.OS : "other",
            exactAlarmAuthorized: false,
            fullScreenAuthorized: false,
            notificationAuthorized: false,
            reason: "NATIVE_MODULE_UNAVAILABLE",
        };
    }
    return module.getCapabilities();
}

export async function applyDepartureAlarmCommand(
    command: DepartureAlarmSyncCommand,
): Promise<DepartureAlarmMutationResult> {
    const module = getNativeAlarmModule();
    if (!module) {
        return { applied: false, scheduled: false, reason: "NATIVE_MODULE_UNAVAILABLE" };
    }

    if (command.operation === "CANCEL") {
        return module.cancelAlarm({
            alarmId: command.alarmId,
            scheduleId: command.scheduleId,
            generation: command.generation,
        });
    }
    return module.upsertAlarm(command);
}

export async function getScheduledDepartureAlarms(): Promise<DepartureAlarmSyncCommand[]> {
    return getNativeAlarmModule()?.getScheduledAlarms() ?? [];
}

export async function openExactAlarmSettings(): Promise<boolean> {
    return getNativeAlarmModule()?.openExactAlarmSettings() ?? false;
}

export async function openFullScreenAlarmSettings(): Promise<boolean> {
    return getNativeAlarmModule()?.openFullScreenSettings() ?? false;
}

export async function scheduleDepartureTestAlarm(
    delaySeconds = 10,
): Promise<DepartureAlarmMutationResult> {
    const normalizedDelay = Math.max(3, Math.min(60, Math.round(delaySeconds)));
    return getNativeAlarmModule()?.scheduleTestAlarm(normalizedDelay) ?? {
        applied: false,
        scheduled: false,
        reason: "NATIVE_MODULE_UNAVAILABLE",
    };
}

export async function stopRingingDepartureAlarm(): Promise<boolean> {
    return getNativeAlarmModule()?.stopRinging() ?? false;
}

export async function clearAllDepartureAlarms(): Promise<boolean> {
    return getNativeAlarmModule()?.clearAllAlarms() ?? false;
}

export async function getPendingNativeAlarmFireEvents(): Promise<NativeAlarmFireEvent[]> {
    const rawEvents = await (getNativeAlarmModule()?.getPendingAlarmFireEvents?.() ?? []);
    if (!Array.isArray(rawEvents)) return [];
    return rawEvents.map(parseNativeAlarmFireEvent).filter(
        (event): event is NativeAlarmFireEvent => event !== undefined,
    );
}

export async function removePendingNativeAlarmFireEvent(eventId: string): Promise<boolean> {
    if (!eventId || eventId.length > 200) return false;
    return getNativeAlarmModule()?.removeAlarmFireEvent?.(eventId) ?? false;
}

function parseNativeAlarmFireEvent(value: unknown): NativeAlarmFireEvent | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const event = value as Partial<NativeAlarmFireEvent>;
    const timingBasis = event.timingBasis === "EXACT_CALLBACK" ||
        event.timingBasis === "OBSERVED_ALERTING" ||
        event.timingBasis === "INFERRED_OS_DELIVERY"
        ? event.timingBasis
        // OTA compatibility: Android's legacy journal was written only by its
        // exact receiver; iOS legacy evidence came from delivered/alerting observation.
        : event.timingBasis === undefined
            ? Platform.OS === "android" ? "EXACT_CALLBACK" : "OBSERVED_ALERTING"
            : undefined;
    if (
        typeof event.eventId !== "string" || !event.eventId || event.eventId.length > 200 ||
        typeof event.alarmId !== "string" || !event.alarmId || event.alarmId.length > 200 ||
        typeof event.scheduleId !== "string" || !event.scheduleId || event.scheduleId.length > 200 ||
        !Number.isSafeInteger(event.generation) || (event.generation ?? -1) < 0 ||
        !Number.isSafeInteger(event.recipientMemberId) || (event.recipientMemberId ?? 0) <= 0 ||
        typeof event.scheduledFor !== "string" || !Number.isFinite(Date.parse(event.scheduledFor)) ||
        (event.sourceTriggerAt !== undefined && (
            typeof event.sourceTriggerAt !== "string" || !Number.isFinite(Date.parse(event.sourceTriggerAt))
        )) ||
        typeof event.occurredAt !== "string" || !Number.isFinite(Date.parse(event.occurredAt)) ||
        !timingBasis ||
        (event.logicalEventKey !== undefined && (
            typeof event.logicalEventKey !== "string" ||
            !event.logicalEventKey ||
            event.logicalEventKey.length > 100
        ))
    ) return undefined;
    return { ...(event as Omit<NativeAlarmFireEvent, "timingBasis">), timingBasis };
}

/** Test-only reset so Platform/native-module cases don't leak between Jest modules. */
export function resetDepartureAlarmNativeModuleForTests(): void {
    if (process.env.NODE_ENV === "test") cachedNativeModule = undefined;
}
