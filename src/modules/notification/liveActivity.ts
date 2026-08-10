import { Platform } from "react-native";

import type { LiveActivityRouteSegment } from "./liveActivityRoute";

const NATIVE_MODULE_NAME = "NoLateLiveActivity";
const MIN_TOKEN_LENGTH = 64;
const MAX_TOKEN_LENGTH = 500;

export type LiveActivityStatus =
    | "preparing"
    | "leaveNow"
    | "inTransit"
    | "arrived"
    | "delayed"
    | "cancelled";

export type LiveActivityAppearance = "light" | "dark";

export type LiveActivityCapabilities = {
    /** ActivityKit display surface exists on this OS/build. */
    supported: boolean;
    enabled: boolean;
    /** An existing Activity can be rendered and receive content updates. */
    canDisplay: boolean;
    canUpdate: boolean;
    /** Production has no foreground local-start orchestration; preview calls do not count. */
    canStartLocally: boolean;
    /** Effective remote START support: enabled ActivityKit on iOS 17.2 or newer. */
    canStartRemotely: boolean;
    pushToStartSupported: boolean;
    pushToStartToken?: string;
    reason?: string;
};

export type LiveActivityStartOrUpdateInput = {
    scheduleId: string;
    recipientMemberId: number;
    generation: number;
    scheduleTitle: string;
    destinationName: string;
    /** Canonical schedule time; the widget formats this instead of parsing title text. */
    scheduleStartAt: string;
    revision: number;
    /** Door-to-door ETA; it already includes public-transit waiting time. */
    travelMinutes: number;
    /** Display-only; native and JS must never add this to travelMinutes. */
    firstWaitMinutes?: number;
    predictedArrivalAt?: string;
    recommendedDepartureAt: string;
    updatedAt: string;
    staleAt?: string;
    status: LiveActivityStatus;
    /** Explicit device/app appearance; Lock Screen scene traits are only a legacy fallback. */
    appearance?: LiveActivityAppearance;
    actionEventKey: string;
    /** Hard fence for lock-screen departure actions, independent of UI staleness. */
    actionExpiresAt: string;
    logicalEventKey?: string;
    routeSegments: LiveActivityRouteSegment[];
};

export type LiveActivityEndInput = {
    scheduleId: string;
    recipientMemberId: number;
    status?: "arrived" | "cancelled";
    revision?: number;
    updatedAt?: string;
    dismissalPolicy?: "default" | "immediate" | "afterDate";
    dismissAt?: string;
};

export type LiveActivityMutationResult = {
    supported: boolean;
    applied: boolean;
    operation: "started" | "updated" | "ended" | "endedAll" | "ignored";
    activityId?: string;
    endedCount?: number;
    reason?: string;
    simulation?: boolean;
};

export type ActiveLiveActivity = {
    activityId: string;
    scheduleId: string;
    recipientMemberId: number;
    generation: number;
    revision: number;
    status: LiveActivityStatus;
    updateToken?: string;
};

export type LiveActivityPushTokenEvent =
    | {
        kind: "pushToStart";
        token: string;
        activityId?: never;
        scheduleId?: never;
        recipientMemberId?: never;
        generation?: never;
    }
    | {
        kind: "update";
        token: string;
        activityId: string;
        scheduleId: string;
        recipientMemberId: number;
        generation: number;
    };

export type LiveActivityState = "active" | "stale" | "ended" | "dismissed";

export type LiveActivityStateChangeEvent = {
    activityId: string;
    scheduleId: string;
    recipientMemberId: number;
    state: LiveActivityState;
};

type NativeSubscription = { remove(): void };

type NativeLiveActivityModule = {
    getCapabilities?(): Promise<unknown>;
    startOrUpdate?(input: LiveActivityStartOrUpdateInput): Promise<unknown>;
    end?(input: LiveActivityEndInput): Promise<unknown>;
    endAll?(): Promise<unknown>;
    getActiveActivities?(): Promise<unknown>;
    debugSimulate?(): Promise<unknown>;
    addListener?(
        eventName: "onLiveActivityPushToken" | "onLiveActivityStateChange",
        listener: (event: unknown) => void,
    ): NativeSubscription;
};

let cachedNativeModule: NativeLiveActivityModule | null | undefined;

function getNativeModule(): NativeLiveActivityModule | null {
    if (cachedNativeModule !== undefined) return cachedNativeModule;
    if (Platform.OS !== "ios") {
        cachedNativeModule = null;
        return cachedNativeModule;
    }
    try {
        const { requireOptionalNativeModule } = require("expo-modules-core") as {
            requireOptionalNativeModule: (name: string) => NativeLiveActivityModule | null;
        };
        cachedNativeModule = requireOptionalNativeModule(NATIVE_MODULE_NAME);
    } catch {
        cachedNativeModule = null;
    }
    return cachedNativeModule;
}

function boundedText(value: unknown, maximum: number): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    return normalized && normalized.length <= maximum ? normalized : undefined;
}

function token(value: unknown): string | undefined {
    const normalized = boundedText(value, MAX_TOKEN_LENGTH);
    return normalized &&
        normalized.length >= MIN_TOKEN_LENGTH &&
        normalized.length % 2 === 0 &&
        /^[0-9a-f]+$/.test(normalized)
        ? normalized
        : undefined;
}

function positiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function liveActivityStatus(value: unknown): value is LiveActivityStatus {
    return value === "preparing" || value === "leaveNow" || value === "inTransit" ||
        value === "arrived" || value === "delayed" || value === "cancelled";
}

function liveActivityState(value: unknown): value is LiveActivityState {
    return value === "active" || value === "stale" || value === "ended" || value === "dismissed";
}

function parseMutationResult(
    value: unknown,
    fallbackOperation: LiveActivityMutationResult["operation"],
): LiveActivityMutationResult {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {
            supported: true,
            applied: false,
            operation: "ignored",
            reason: "INVALID_NATIVE_RESULT",
        };
    }
    const result = value as Partial<LiveActivityMutationResult>;
    const operation = result.operation === "started" || result.operation === "updated" ||
        result.operation === "ended" || result.operation === "endedAll" ||
        result.operation === "ignored"
        ? result.operation
        : fallbackOperation;
    return {
        supported: result.supported !== false,
        applied: result.applied === true,
        operation,
        ...(boundedText(result.activityId, 200) ? { activityId: result.activityId } : {}),
        ...(nonNegativeInteger(result.endedCount) ? { endedCount: result.endedCount } : {}),
        ...(boundedText(result.reason, 300) ? { reason: result.reason } : {}),
        ...(result.simulation === true ? { simulation: true } : {}),
    };
}

function unsupportedMutation(reason = "NATIVE_MODULE_UNAVAILABLE"): LiveActivityMutationResult {
    return {
        supported: false,
        applied: false,
        operation: "ignored",
        reason,
    };
}

export async function getLiveActivityCapabilities(): Promise<LiveActivityCapabilities> {
    const module = getNativeModule();
    if (!module?.getCapabilities) {
        return {
            supported: false,
            enabled: false,
            canDisplay: false,
            canUpdate: false,
            canStartLocally: false,
            canStartRemotely: false,
            pushToStartSupported: false,
            reason: "NATIVE_MODULE_UNAVAILABLE",
        };
    }
    const raw = await module.getCapabilities();
    const value = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Partial<LiveActivityCapabilities>
        : undefined;
    return {
        supported: value?.supported === true,
        enabled: value?.enabled === true,
        canDisplay: value?.canDisplay === true,
        canUpdate: value?.canUpdate === true,
        canStartLocally: value?.canStartLocally === true,
        canStartRemotely: value?.canStartRemotely === true,
        pushToStartSupported: value?.pushToStartSupported === true,
        ...(token(value?.pushToStartToken)
            ? { pushToStartToken: token(value?.pushToStartToken) }
            : {}),
        ...(boundedText(value?.reason, 300) ? { reason: value?.reason } : {}),
    };
}

export async function startOrUpdateLiveActivity(
    input: LiveActivityStartOrUpdateInput,
): Promise<LiveActivityMutationResult> {
    const module = getNativeModule();
    if (!module?.startOrUpdate) return unsupportedMutation();
    return parseMutationResult(await module.startOrUpdate(input), "updated");
}

export async function endLiveActivity(
    input: LiveActivityEndInput,
): Promise<LiveActivityMutationResult> {
    const module = getNativeModule();
    if (!module?.end) return unsupportedMutation();
    return parseMutationResult(await module.end(input), "ended");
}

export async function endAllLiveActivities(): Promise<LiveActivityMutationResult> {
    const module = getNativeModule();
    if (!module?.endAll) return unsupportedMutation();
    return parseMutationResult(await module.endAll(), "endedAll");
}

export async function debugSimulateLiveActivity(): Promise<LiveActivityMutationResult> {
    if (!__DEV__) return unsupportedMutation("DEVELOPMENT_BUILD_REQUIRED");
    const module = getNativeModule();
    if (!module?.debugSimulate) return unsupportedMutation();
    return parseMutationResult(await module.debugSimulate(), "updated");
}

function parseActiveLiveActivity(value: unknown): ActiveLiveActivity | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const item = value as Partial<ActiveLiveActivity>;
    const activityId = boundedText(item.activityId, 200);
    const scheduleId = boundedText(item.scheduleId, 100);
    if (
        !activityId || !scheduleId || !/^[1-9]\d*$/.test(scheduleId) ||
        !positiveInteger(item.recipientMemberId) || !nonNegativeInteger(item.generation) ||
        !nonNegativeInteger(item.revision) || !liveActivityStatus(item.status)
    ) return undefined;
    return {
        activityId,
        scheduleId,
        recipientMemberId: item.recipientMemberId,
        generation: item.generation,
        revision: item.revision,
        status: item.status,
        ...(token(item.updateToken) ? { updateToken: token(item.updateToken) } : {}),
    };
}

export async function getActiveLiveActivities(): Promise<ActiveLiveActivity[]> {
    const raw = await (getNativeModule()?.getActiveActivities?.() ?? []);
    if (!Array.isArray(raw)) return [];
    return raw.map(parseActiveLiveActivity).filter(
        (activity): activity is ActiveLiveActivity => activity !== undefined,
    );
}

function parsePushTokenEvent(value: unknown): LiveActivityPushTokenEvent | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const event = value as Partial<LiveActivityPushTokenEvent>;
    const normalizedToken = token(event.token);
    if (!normalizedToken || (event.kind !== "update" && event.kind !== "pushToStart")) {
        return undefined;
    }
    if (event.kind === "pushToStart") return { kind: event.kind, token: normalizedToken };

    const activityId = boundedText(event.activityId, 200);
    const scheduleId = boundedText(event.scheduleId, 100);
    if (
        !activityId || !scheduleId || !/^[1-9]\d*$/.test(scheduleId) ||
        !positiveInteger(event.recipientMemberId) || !nonNegativeInteger(event.generation)
    ) return undefined;
    return {
        kind: event.kind,
        token: normalizedToken,
        activityId,
        scheduleId,
        recipientMemberId: event.recipientMemberId,
        generation: event.generation,
    };
}

function parseStateChangeEvent(value: unknown): LiveActivityStateChangeEvent | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const event = value as Partial<LiveActivityStateChangeEvent>;
    const activityId = boundedText(event.activityId, 200);
    const scheduleId = boundedText(event.scheduleId, 100);
    if (
        !activityId || !scheduleId || !/^[1-9]\d*$/.test(scheduleId) ||
        !positiveInteger(event.recipientMemberId) || !liveActivityState(event.state)
    ) return undefined;
    return {
        activityId,
        scheduleId,
        recipientMemberId: event.recipientMemberId,
        state: event.state,
    };
}

export function subscribeLiveActivityEvents({
    onPushToken,
    onStateChange,
}: {
    onPushToken: (event: LiveActivityPushTokenEvent) => void;
    onStateChange: (event: LiveActivityStateChangeEvent) => void;
}): () => void {
    const module = getNativeModule();
    if (!module?.addListener) return () => undefined;
    const subscriptions: NativeSubscription[] = [];
    subscriptions.push(module.addListener("onLiveActivityPushToken", (value) => {
        const event = parsePushTokenEvent(value);
        if (event) onPushToken(event);
    }));
    subscriptions.push(module.addListener("onLiveActivityStateChange", (value) => {
        const event = parseStateChangeEvent(value);
        if (event) onStateChange(event);
    }));
    return () => subscriptions.forEach((subscription) => subscription.remove());
}

/** Test-only reset so platform/native module mocks never leak across cases. */
export function resetLiveActivityNativeModuleForTests(): void {
    if (process.env.NODE_ENV === "test") cachedNativeModule = undefined;
}
