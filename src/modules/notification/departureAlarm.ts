import { Platform } from "react-native";

import {
    canonicalNativeAlarmIdsForPlan,
    isDepartureAlarmOccurrenceEligible,
    type DepartureAlarmSyncCommand,
    type DepartureAlarmSyncPlanCommand,
} from "./departureAlarmContract";
import type { NoLateAlarmSoundId } from "./customAlarmSounds";

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
    occurrenceId?: string;
};

export type NativeDepartureActionEvent = {
    eventId: string;
    alarmId: string;
    scheduleId: string;
    generation: number;
    recipientMemberId: number;
    occurrenceId?: string;
    actionEventKey: string;
    occurredAt: string;
    requiresRouteNavigation: boolean;
    routeNavigationDelivered: boolean;
    notificationLogicalEventKey?: string;
    providerMessageId?: string;
};

export type NativeDepartureActionInput = {
    alarmId?: string;
    scheduleId: string;
    generation?: number;
    recipientMemberId: number;
    occurrenceId?: string;
    actionEventKey?: string;
    requiresRouteNavigation?: boolean;
};

export type NativeAlarmNavigationEvent = {
    eventId: string;
    scheduleId: string;
    recipientMemberId: number;
    occurredAt: string;
    notificationLogicalEventKey?: string;
    providerMessageId?: string;
};

export type NativeDepartureReminderPresentationEvent = {
    eventId: string;
    notificationTag: string;
    recipientMemberId: number;
    logicalEventKey: string;
    providerMessageId?: string;
    occurredAt: string;
};

export type DepartureAlarmPlanMutationExecution = {
    command: DepartureAlarmSyncCommand;
    result: DepartureAlarmMutationResult;
    /** Reserved in native mutation order before any receipt capability/network awaits. */
    mutationSequence?: number;
    mutationOccurredAt?: string;
};

type NativeDepartureAlarmCommand = DepartureAlarmSyncCommand & {
    alarmId: string;
    logicalAlarmId: string;
};

type NativeAlarmModule = {
    getCapabilities(): Promise<DepartureAlarmCapabilities>;
    upsertAlarm(command: NativeDepartureAlarmCommand): Promise<DepartureAlarmMutationResult>;
    cancelAlarm(command: {
        alarmId: string;
        logicalAlarmId?: string;
        scheduleId: string;
        generation: number;
    }): Promise<DepartureAlarmMutationResult>;
    getScheduledAlarms(): Promise<DepartureAlarmSyncCommand[]>;
    openExactAlarmSettings(): Promise<boolean>;
    openFullScreenSettings(): Promise<boolean>;
    scheduleTestAlarm(delaySeconds: number): Promise<DepartureAlarmMutationResult>;
    scheduleCustomAlarmPreview?(
        delaySeconds: number,
        scheduleId: string | null,
    ): Promise<DepartureAlarmMutationResult>;
    getAlarmSoundPreference?(): Promise<string>;
    setAlarmSoundPreference?(soundId: string): Promise<boolean>;
    stopRinging(): Promise<boolean>;
    clearAllAlarms(): Promise<boolean>;
    getPendingAlarmFireEvents?(): Promise<unknown[]>;
    removeAlarmFireEvent?(eventId: string): Promise<boolean>;
    recordAlarmNotificationResponseFire?(event: {
        nativeAlarmId: string;
        alarmId: string;
        scheduleId: string;
        generation: number;
        recipientMemberId: number;
        occurrenceId?: "M15" | "M10" | "M5" | "M0";
        occurredAt: string;
    }): Promise<boolean>;
    recordDepartureActionEvent?(event: NativeDepartureActionEvent): Promise<boolean>;
    getPendingDepartureActionEvents?(): Promise<unknown[]>;
    markDepartureActionNavigationDelivered?(eventId: string): Promise<boolean>;
    removeDepartureActionEvent?(eventId: string): Promise<boolean>;
    getPendingAlarmNavigationEvents?(): Promise<unknown[]>;
    removeAlarmNavigationEvent?(eventId: string): Promise<boolean>;
    activateDepartureReminderAccount?(recipientMemberId: number): Promise<boolean>;
    getPendingDepartureReminderPresentationEvents?(): Promise<unknown[]>;
    markDepartureReminderPresentationDelivered?(notificationTag: string): Promise<boolean>;
    presentDepartureReminder?(command: {
        type: string;
        scheduleId: string;
        recipientMemberId: string;
        logicalEventKey: string;
        etaEventExpiresAt: string;
        nolateNotificationTitle: string;
        nolateNotificationBody: string;
        nolateNotificationTag: string;
        providerMessageId?: string;
    }): Promise<string>;
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
            alarmId: command.nativeAlarmId ?? command.alarmId,
            logicalAlarmId: command.alarmId,
            scheduleId: command.scheduleId,
            generation: command.generation,
        });
    }
    const nativeCommand = { ...command };
    delete nativeCommand.validationRevision;
    return module.upsertAlarm({
        ...nativeCommand,
        alarmId: command.nativeAlarmId ?? command.alarmId,
        logicalAlarmId: command.alarmId,
    });
}

/**
 * Reconciles a complete generation using deterministic per-occurrence native ids. Missing and
 * already elapsed slots are tombstoned before future slots are upserted. A crash between calls is
 * recoverable: snapshot replay repeats the same generation, while native tombstones reject older
 * payloads and equal desired UPSERTs remain idempotent.
 */
export async function applyDepartureAlarmPlanCommand(
    plan: DepartureAlarmSyncPlanCommand,
    nowMilliseconds = Date.now(),
): Promise<DepartureAlarmPlanMutationExecution[]> {
    if (plan.planSchemaVersion === 1) {
        const command = plan.operation === "CANCEL"
            ? cancelCommandForNativeId(plan, plan.alarmId)
            : plan.occurrences[0];
        if (!command) return [];
        if (plan.operation === "UPSERT") {
            // Server snooze intentionally converts a v2 plan into one legacy base alarm. Remove
            // every deterministic occurrence first or the snoozed base and original plan can ring
            // together. As with v2 reconciliation, cancellation is a success prerequisite.
            for (const nativeAlarmId of canonicalNativeAlarmIdsForPlan(plan.alarmId).slice(1)) {
                let cancelResult: DepartureAlarmMutationResult;
                try {
                    cancelResult = await applyDepartureAlarmCommand(
                        cancelCommandForNativeId(plan, nativeAlarmId),
                    );
                } catch (error) {
                    cancelResult = {
                        applied: false,
                        scheduled: false,
                        reason: error instanceof Error
                            ? `PREREQUISITE_CANCEL_ERROR:${error.message}`
                            : "PREREQUISITE_CANCEL_ERROR",
                    };
                }
                if (cancelResult.applied !== true) {
                    return [{
                        command,
                        result: {
                            applied: false,
                            scheduled: false,
                            reason: `PREREQUISITE_CANCEL_FAILED:${cancelResult.reason ?? "UNKNOWN"}`,
                            ...(cancelResult.deliveryMode
                                ? { deliveryMode: cancelResult.deliveryMode }
                                : {}),
                        },
                    }];
                }
            }
        }
        try {
            return [{ command, result: await applyDepartureAlarmCommand(command) }];
        } catch (error) {
            return [{
                command,
                result: {
                    applied: false,
                    scheduled: false,
                    reason: error instanceof Error
                        ? `PLAN_UPSERT_ERROR:${error.message}`
                        : "PLAN_UPSERT_ERROR",
                },
            }];
        }
    }

    if (plan.operation === "CANCEL") {
        const results: DepartureAlarmMutationResult[] = [];
        for (const nativeAlarmId of canonicalNativeAlarmIdsForPlan(plan.alarmId)) {
            results.push(await applyDepartureAlarmCommand(
                cancelCommandForNativeId(plan, nativeAlarmId),
            ));
        }
        const failed = results.find((result) => result.applied !== true);
        const command: DepartureAlarmSyncCommand = {
            operation: "CANCEL",
            alarmId: plan.alarmId,
            scheduleId: plan.scheduleId,
            generation: plan.generation,
            recipientMemberId: plan.recipientMemberId,
            ...(plan.logicalEventKey ? { logicalEventKey: plan.logicalEventKey } : {}),
        };
        return [{
            command,
            result: failed
                ? {
                    applied: false,
                    scheduled: false,
                    reason: failed.reason ?? "PLAN_CANCEL_INCOMPLETE",
                    ...(failed.deliveryMode ? { deliveryMode: failed.deliveryMode } : {}),
                }
                : {
                    applied: true,
                    scheduled: false,
                    deliveryMode: results.find((result) => result.deliveryMode)?.deliveryMode,
                },
        }];
    }

    const futureOccurrences = plan.occurrences.filter((occurrence) =>
        isDepartureAlarmOccurrenceEligible(occurrence, nowMilliseconds)
    );
    const desiredNativeIds = new Set(futureOccurrences.map((occurrence) => occurrence.nativeAlarmId));
    let reconciliationFailure: DepartureAlarmMutationResult | undefined;
    for (const nativeAlarmId of canonicalNativeAlarmIdsForPlan(plan.alarmId)) {
        if (desiredNativeIds.has(nativeAlarmId)) continue;
        try {
            const result = await applyDepartureAlarmCommand(
                cancelCommandForNativeId(plan, nativeAlarmId),
            );
            if (result.applied !== true) {
                reconciliationFailure = result;
                break;
            }
        } catch (error) {
            reconciliationFailure = {
                applied: false,
                scheduled: false,
                reason: error instanceof Error
                    ? `PREREQUISITE_CANCEL_ERROR:${error.message}`
                    : "PREREQUISITE_CANCEL_ERROR",
            };
            break;
        }
    }
    if (reconciliationFailure) {
        // A stale legacy/past slot can ring alongside the desired plan. Withhold every SCHEDULED
        // occurrence receipt until obsolete physical ids are proven canceled, so server replay
        // can safely retry the complete reconciliation.
        const failureCommand = futureOccurrences[0] ??
            cancelCommandForNativeId(plan, plan.alarmId);
        return [{
            command: failureCommand,
            result: {
                applied: false,
                scheduled: false,
                reason: `PREREQUISITE_CANCEL_FAILED:${reconciliationFailure.reason ?? "UNKNOWN"}`,
                ...(reconciliationFailure.deliveryMode
                    ? { deliveryMode: reconciliationFailure.deliveryMode }
                    : {}),
            },
        }];
    }

    const executions: DepartureAlarmPlanMutationExecution[] = [];
    for (const command of futureOccurrences) {
        let result: DepartureAlarmMutationResult;
        try {
            result = await applyDepartureAlarmCommand(command);
        } catch (error) {
            result = {
                applied: false,
                scheduled: false,
                reason: error instanceof Error
                    ? `PLAN_UPSERT_ERROR:${error.message}`
                    : "PLAN_UPSERT_ERROR",
            };
        }
        executions.push({ command, result });
        if (result.scheduled !== true) {
            // Prerequisite cancellation already proved there is no obsolete duplicate. Keep
            // receipts for earlier successfully scheduled slots; replay completes the remaining
            // suffix and equal-generation native upserts stay idempotent.
            return executions;
        }
    }
    return executions;
}

function cancelCommandForNativeId(
    plan: DepartureAlarmSyncPlanCommand,
    nativeAlarmId: string,
): DepartureAlarmSyncCommand {
    return {
        operation: "CANCEL",
        alarmId: plan.alarmId,
        nativeAlarmId,
        scheduleId: plan.scheduleId,
        generation: plan.generation,
        recipientMemberId: plan.recipientMemberId,
        ...(plan.logicalEventKey ? { logicalEventKey: plan.logicalEventKey } : {}),
    };
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

export async function getNativeNoLateAlarmSoundPreference(): Promise<NoLateAlarmSoundId | undefined> {
    const value = await getNativeAlarmModule()?.getAlarmSoundPreference?.();
    return value === "CHIME" || value === "BELL" || value === "BEEP" ? value : undefined;
}

export async function setNativeNoLateAlarmSoundPreference(soundId: NoLateAlarmSoundId): Promise<boolean> {
    return getNativeAlarmModule()?.setAlarmSoundPreference?.(soundId) ?? false;
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

/**
 * Schedules an ordinary iOS notification that enters NoLate's custom alarm screen after a tap.
 * It never uses AlarmKit and deliberately has no direct departure-state mutation action.
 */
export async function scheduleNoLateCustomAlarmPreview(
    delaySeconds = 10,
    scheduleId?: string,
): Promise<DepartureAlarmMutationResult> {
    const normalizedDelay = Math.max(3, Math.min(60, Math.round(delaySeconds)));
    // Android already owns a NoLate-drawn full-screen alarm preview. Keep that native path behind
    // the shared public API while iOS uses the notification-to-custom-screen bridge below.
    if (Platform.OS === "android") {
        return scheduleDepartureTestAlarm(normalizedDelay);
    }
    if (Platform.OS !== "ios") {
        return {
            applied: false,
            scheduled: false,
            reason: "CUSTOM_ALARM_PREVIEW_IOS_ONLY",
        };
    }
    const normalizedScheduleId = scheduleId?.trim();
    if (
        scheduleId !== undefined &&
        (
            !normalizedScheduleId ||
            normalizedScheduleId.length > 200 ||
            !/^[1-9]\d*$/.test(normalizedScheduleId)
        )
    ) {
        return {
            applied: false,
            scheduled: false,
            reason: "INVALID_SCHEDULE_ID",
        };
    }
    const module = getNativeAlarmModule();
    if (!module?.scheduleCustomAlarmPreview) {
        return {
            applied: false,
            scheduled: false,
            reason: "CUSTOM_ALARM_PREVIEW_UNAVAILABLE",
        };
    }
    return module.scheduleCustomAlarmPreview(
        normalizedDelay,
        normalizedScheduleId ?? null,
    );
}

export async function stopRingingDepartureAlarm(): Promise<boolean> {
    return getNativeAlarmModule()?.stopRinging() ?? false;
}

export async function clearAllDepartureAlarms(): Promise<boolean> {
    return getNativeAlarmModule()?.clearAllAlarms() ?? false;
}

/** Binds native background reminder display to the authenticated Android account. */
export async function activateNativeDepartureReminderAccount(
    recipientMemberId: number,
): Promise<boolean> {
    if (!Number.isSafeInteger(recipientMemberId) || recipientMemberId <= 0) return false;
    if (Platform.OS !== "android") return true;
    const module = getNativeAlarmModule();
    // An older native binary has no custom service, so absence must not block snapshot recovery.
    if (!module?.activateDepartureReminderAccount) return true;
    return module.activateDepartureReminderAccount(recipientMemberId);
}

export async function getPendingNativeDepartureReminderPresentationEvents(
): Promise<NativeDepartureReminderPresentationEvent[]> {
    const rawEvents = await (
        getNativeAlarmModule()?.getPendingDepartureReminderPresentationEvents?.() ?? []
    );
    if (!Array.isArray(rawEvents)) return [];
    return rawEvents.map(parseNativeDepartureReminderPresentationEvent).filter(
        (event): event is NativeDepartureReminderPresentationEvent => event !== undefined,
    );
}

export async function markNativeDepartureReminderPresentationDelivered(
    notificationTag: string,
): Promise<boolean> {
    if (!/^nolate-visible-[0-9a-f]{64}$/.test(notificationTag)) return false;
    return getNativeAlarmModule()?.markDepartureReminderPresentationDelivered?.(
        notificationTag,
    ) ?? false;
}

export type ForegroundNativeDepartureReminderPresentationResult =
    | "presented"
    | "duplicate"
    | "failed"
    | "unsupported"
    | "rejected";

/**
 * Low-level bridge call. Callers must hold the account lifecycle mutation queue and bind the
 * verified account first; the native module independently rechecks that binding under its lock.
 */
export async function presentNativeDepartureReminderWithBoundAccount(
    data: Record<string, unknown> | undefined,
    providerMessageId?: string,
): Promise<ForegroundNativeDepartureReminderPresentationResult> {
    if (Platform.OS !== "android" || data?.type !== "SCHEDULE_DEPARTURE_REMINDER") {
        return "unsupported";
    }
    const recipientText = typeof data.recipientMemberId === "string"
        ? data.recipientMemberId
        : undefined;
    const recipientMemberId = recipientText && /^[1-9]\d*$/.test(recipientText)
        ? Number(recipientText)
        : undefined;
    // A pre-extension payload must remain eligible for the existing Expo foreground fallback.
    if (!recipientText) return "unsupported";
    if (!recipientMemberId || !Number.isSafeInteger(recipientMemberId)) return "rejected";
    const module = getNativeAlarmModule();
    if (!module?.presentDepartureReminder) return "unsupported";
    const requiredFields = [
        "scheduleId",
        "logicalEventKey",
        "etaEventExpiresAt",
        "nolateNotificationTitle",
        "nolateNotificationBody",
        "nolateNotificationTag",
    ] as const;
    if (requiredFields.some((field) => typeof data[field] !== "string")) {
        return "unsupported";
    }
    try {
        const result = await module.presentDepartureReminder({
            type: data.type,
            scheduleId: data.scheduleId as string,
            recipientMemberId: recipientText,
            logicalEventKey: data.logicalEventKey as string,
            etaEventExpiresAt: data.etaEventExpiresAt as string,
            nolateNotificationTitle: data.nolateNotificationTitle as string,
            nolateNotificationBody: data.nolateNotificationBody as string,
            nolateNotificationTag: data.nolateNotificationTag as string,
            ...(providerMessageId ? { providerMessageId } : {}),
        });
        if (
            result === "PRESENTED" || result === "DUPLICATE" || result === "FAILED" ||
            result === "UNSUPPORTED" || result === "REJECTED"
        ) return result.toLowerCase() as ForegroundNativeDepartureReminderPresentationResult;
        return "failed";
    } catch {
        return "failed";
    }
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

/**
 * Converts only native time-sensitive alarm response metadata into durable fire evidence. An
 * ordinary visible push has no nativeAlarmId and returns undefined without crossing the bridge.
 */
export function recordNativeAlarmNotificationResponseFire(
    data: Record<string, unknown> | undefined,
    occurredAtMilliseconds: number,
): Promise<boolean> | undefined {
    if (
        data?.type !== "SCHEDULE_DEPARTURE_REMINDER" &&
        data?.type !== "NOLATE_CUSTOM_ALARM"
    ) return undefined;
    const scheduleId = typeof data.scheduleId === "string" ? data.scheduleId : undefined;
    const recipientMemberIdText = typeof data.recipientMemberId === "string"
        ? data.recipientMemberId
        : undefined;
    const generationText = typeof data.alarmGeneration === "string"
        ? data.alarmGeneration
        : undefined;
    const alarmId = typeof data.alarmId === "string" ? data.alarmId : undefined;
    const nativeAlarmId = typeof data.nativeAlarmId === "string"
        ? data.nativeAlarmId
        : undefined;
    const occurrenceId = data.occurrenceId;
    if (
        !scheduleId || !/^[1-9]\d*$/.test(scheduleId) ||
        !recipientMemberIdText || !/^[1-9]\d*$/.test(recipientMemberIdText) ||
        !generationText || !/^(0|[1-9]\d*)$/.test(generationText) ||
        !alarmId || alarmId.length > 200 ||
        !nativeAlarmId || nativeAlarmId.length > 200 ||
        (occurrenceId !== undefined && !isOccurrenceId(occurrenceId)) ||
        !Number.isSafeInteger(occurredAtMilliseconds) ||
        occurredAtMilliseconds < 0 ||
        occurredAtMilliseconds > 8_640_000_000_000_000
    ) return undefined;
    const recipientMemberId = Number(recipientMemberIdText);
    const generation = Number(generationText);
    if (
        !Number.isSafeInteger(Number(scheduleId)) ||
        !Number.isSafeInteger(recipientMemberId) ||
        !Number.isSafeInteger(generation) ||
        alarmId !== `schedule:${scheduleId}:member:${recipientMemberIdText}`
    ) return undefined;
    const expectedNativeAlarmId = occurrenceId
        ? `${alarmId}:occurrence:${occurrenceId}`
        : alarmId;
    if (nativeAlarmId !== expectedNativeAlarmId) return undefined;

    const module = getNativeAlarmModule();
    if (!module?.recordAlarmNotificationResponseFire) return Promise.resolve(false);
    return module.recordAlarmNotificationResponseFire({
        nativeAlarmId,
        alarmId,
        scheduleId,
        generation,
        recipientMemberId,
        ...(occurrenceId ? { occurrenceId } : {}),
        occurredAt: new Date(occurredAtMilliseconds).toISOString(),
    });
}

export async function enqueueNativeDepartureActionEvent(
    input: NativeDepartureActionInput,
): Promise<boolean> {
    const module = getNativeAlarmModule();
    if (!module?.recordDepartureActionEvent) return false;
    const scheduleId = input.scheduleId.trim();
    if (!/^[1-9]\d*$/.test(scheduleId)) return false;
    if (!Number.isSafeInteger(input.recipientMemberId) || input.recipientMemberId <= 0) return false;
    const { randomUUID } = require("expo-crypto") as { randomUUID: () => string };
    const eventId = randomUUID();
    const actionEventKey = input.actionEventKey ?? `event:${eventId}`;
    if (!isActionEventKey(actionEventKey)) return false;
    const alarmId = input.alarmId?.trim() ||
        `schedule:${scheduleId}:member:${input.recipientMemberId}`;
    if (!alarmId || alarmId.length > 200) return false;
    const generation = input.generation ?? 0;
    if (!Number.isSafeInteger(generation) || generation < 0) return false;
    if (input.occurrenceId && !isOccurrenceId(input.occurrenceId)) return false;
    return module.recordDepartureActionEvent({
        eventId,
        alarmId,
        scheduleId,
        generation,
        recipientMemberId: input.recipientMemberId,
        ...(input.occurrenceId ? { occurrenceId: input.occurrenceId } : {}),
        actionEventKey,
        occurredAt: new Date().toISOString(),
        requiresRouteNavigation: input.requiresRouteNavigation === true,
        routeNavigationDelivered: false,
    });
}

export async function getPendingNativeDepartureActionEvents(
): Promise<NativeDepartureActionEvent[]> {
    const rawEvents = await (getNativeAlarmModule()?.getPendingDepartureActionEvents?.() ?? []);
    if (!Array.isArray(rawEvents)) return [];
    return rawEvents.map(parseNativeDepartureActionEvent).filter(
        (event): event is NativeDepartureActionEvent => event !== undefined,
    );
}

export async function markNativeDepartureActionNavigationDelivered(
    eventId: string,
): Promise<boolean> {
    if (!eventId || eventId.length > 200) return false;
    return getNativeAlarmModule()?.markDepartureActionNavigationDelivered?.(eventId) ?? false;
}

export async function removePendingNativeDepartureActionEvent(
    eventId: string,
): Promise<boolean> {
    if (!eventId || eventId.length > 200) return false;
    return getNativeAlarmModule()?.removeDepartureActionEvent?.(eventId) ?? false;
}

export async function getPendingNativeAlarmNavigationEvents(
): Promise<NativeAlarmNavigationEvent[]> {
    const rawEvents = await (getNativeAlarmModule()?.getPendingAlarmNavigationEvents?.() ?? []);
    if (!Array.isArray(rawEvents)) return [];
    return rawEvents.map(parseNativeAlarmNavigationEvent).filter(
        (event): event is NativeAlarmNavigationEvent => event !== undefined,
    );
}

export async function removePendingNativeAlarmNavigationEvent(
    eventId: string,
): Promise<boolean> {
    if (!eventId || eventId.length > 200) return false;
    return getNativeAlarmModule()?.removeAlarmNavigationEvent?.(eventId) ?? false;
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
        )) ||
        (event.occurrenceId !== undefined && (
            typeof event.occurrenceId !== "string" ||
            !["M15", "M10", "M5", "M0"].includes(event.occurrenceId)
        ))
    ) return undefined;
    return { ...(event as Omit<NativeAlarmFireEvent, "timingBasis">), timingBasis };
}

function parseNativeDepartureActionEvent(value: unknown): NativeDepartureActionEvent | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const event = value as Partial<NativeDepartureActionEvent>;
    if (
        typeof event.eventId !== "string" || !event.eventId || event.eventId.length > 200 ||
        typeof event.alarmId !== "string" || !event.alarmId || event.alarmId.length > 200 ||
        typeof event.scheduleId !== "string" || !/^[1-9]\d*$/.test(event.scheduleId) ||
        !Number.isSafeInteger(event.generation) || (event.generation ?? -1) < 0 ||
        !Number.isSafeInteger(event.recipientMemberId) || (event.recipientMemberId ?? 0) <= 0 ||
        (event.occurrenceId !== undefined && !isOccurrenceId(event.occurrenceId)) ||
        typeof event.actionEventKey !== "string" || !isActionEventKey(event.actionEventKey) ||
        typeof event.occurredAt !== "string" || !Number.isFinite(Date.parse(event.occurredAt)) ||
        typeof event.requiresRouteNavigation !== "boolean" ||
        typeof event.routeNavigationDelivered !== "boolean" ||
        (event.notificationLogicalEventKey !== undefined && (
            typeof event.notificationLogicalEventKey !== "string" ||
            !isActionEventKey(event.notificationLogicalEventKey)
        )) ||
        (event.providerMessageId !== undefined && (
            typeof event.providerMessageId !== "string" ||
            !event.providerMessageId || event.providerMessageId.length > 300
        ))
    ) return undefined;
    return event as NativeDepartureActionEvent;
}

function parseNativeAlarmNavigationEvent(value: unknown): NativeAlarmNavigationEvent | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const event = value as Partial<NativeAlarmNavigationEvent>;
    if (
        typeof event.eventId !== "string" || !event.eventId || event.eventId.length > 200 ||
        typeof event.scheduleId !== "string" || !/^[1-9]\d*$/.test(event.scheduleId) ||
        !Number.isSafeInteger(event.recipientMemberId) || (event.recipientMemberId ?? 0) <= 0 ||
        typeof event.occurredAt !== "string" || !Number.isFinite(Date.parse(event.occurredAt)) ||
        (event.notificationLogicalEventKey !== undefined && (
            typeof event.notificationLogicalEventKey !== "string" ||
            !isActionEventKey(event.notificationLogicalEventKey)
        )) ||
        (event.providerMessageId !== undefined && (
            typeof event.providerMessageId !== "string" ||
            !event.providerMessageId || event.providerMessageId.length > 300
        ))
    ) return undefined;
    return event as NativeAlarmNavigationEvent;
}

function parseNativeDepartureReminderPresentationEvent(
    value: unknown,
): NativeDepartureReminderPresentationEvent | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const event = value as Partial<NativeDepartureReminderPresentationEvent>;
    if (
        typeof event.eventId !== "string" ||
        !/^nolate-visible-[0-9a-f]{64}$/.test(event.eventId) ||
        event.notificationTag !== event.eventId ||
        !Number.isSafeInteger(event.recipientMemberId) || (event.recipientMemberId ?? 0) <= 0 ||
        typeof event.logicalEventKey !== "string" || !isActionEventKey(event.logicalEventKey) ||
        (event.providerMessageId !== undefined && (
            typeof event.providerMessageId !== "string" ||
            !event.providerMessageId || event.providerMessageId.length > 300
        )) ||
        typeof event.occurredAt !== "string" || !Number.isFinite(Date.parse(event.occurredAt))
    ) return undefined;
    return event as NativeDepartureReminderPresentationEvent;
}

function isOccurrenceId(value: unknown): value is "M15" | "M10" | "M5" | "M0" {
    return value === "M15" || value === "M10" || value === "M5" || value === "M0";
}

function isActionEventKey(value: string): boolean {
    return /^key:[a-f0-9]{64}$/.test(value) ||
        /^event:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Test-only reset so Platform/native-module cases don't leak between Jest modules. */
export function resetDepartureAlarmNativeModuleForTests(): void {
    if (process.env.NODE_ENV === "test") cachedNativeModule = undefined;
}
