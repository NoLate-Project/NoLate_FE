export const NO_LATE_CUSTOM_ALARM_NOTIFICATION_TYPE = "NOLATE_CUSTOM_ALARM";
export const NO_LATE_CUSTOM_ALARM_CATEGORY = "nolate_custom_alarm";
export const NO_LATE_CUSTOM_ALARM_PREVIEW_CATEGORY = "nolate_custom_alarm_preview";
export const NO_LATE_CUSTOM_ALARM_OPEN_ACTION = "nolate_custom_alarm_open_action";
export const NO_LATE_CUSTOM_ALARM_CONFIRM_DEPARTURE_ACTION =
    "nolate_custom_alarm_confirm_departure_action";
export const NO_LATE_CUSTOM_ALARM_PREVIEW_ROUTE_ACTION =
    "nolate_custom_alarm_preview_route_action";
export const NO_LATE_CUSTOM_ALARM_PREVIEW_DEPARTURE_ACTION =
    "nolate_custom_alarm_preview_departure_action";

export type NoLateCustomAlarmRequestedAction = "open" | "route" | "confirmDeparture";

export type NoLateCustomAlarmNavigationTarget = {
    kind: "customAlarm";
    alarmId: string;
    isPreview: boolean;
    requestedAction: NoLateCustomAlarmRequestedAction;
    capabilityId?: string;
    notificationIdentifier?: string;
    previewId?: string;
    scheduleId?: string;
    nativeAlarmId?: string;
    recipientMemberId?: number;
    alarmGeneration?: number;
    actionEventKey?: string;
    occurrenceId?: string;
    title?: string;
    body?: string;
    routeSummary?: string;
};

export type NoLateCustomAlarmRoute = {
    pathname: "/alarm";
    params: {
        type: typeof NO_LATE_CUSTOM_ALARM_NOTIFICATION_TYPE;
        alarmId: string;
        isPreview: "0" | "1";
        requestedAction: NoLateCustomAlarmRequestedAction;
        capabilityId?: string;
        notificationIdentifier?: string;
        previewId?: string;
        scheduleId?: string;
        nativeAlarmId?: string;
        recipientMemberId?: string;
        alarmGeneration?: string;
        actionEventKey?: string;
        occurrenceId?: string;
        title?: string;
        body?: string;
        routeSummary?: string;
    };
};

/**
 * Parses only the private local-notification contract installed by the NoLate native module.
 * The returned action describes what the custom screen may offer; it never performs a mutation.
 */
export function getNoLateCustomAlarmNavigationTarget(
    data: Record<string, unknown> | undefined,
    actionIdentifier?: string,
): NoLateCustomAlarmNavigationTarget | undefined {
    if (data?.type !== NO_LATE_CUSTOM_ALARM_NOTIFICATION_TYPE) return undefined;

    const alarmId = boundedText(data.alarmId, 200);
    const isPreview = booleanValue(data.isPreview);
    const previewId = boundedText(data.previewId, 64);
    const scheduleId = boundedText(data.scheduleId, 200);
    if (!alarmId || isPreview === undefined) return undefined;
    if (scheduleId !== undefined && !/^[1-9]\d*$/.test(scheduleId)) return undefined;
    if (isPreview && (!previewId || !UUID_PATTERN.test(previewId))) return undefined;

    const nativeAlarmId = boundedText(data.nativeAlarmId, 200);
    const recipientMemberId = positiveSafeInteger(data.recipientMemberId);
    const alarmGeneration = nonNegativeSafeInteger(data.alarmGeneration);
    const actionEventKey = boundedText(data.actionEventKey, 100);
    const occurrenceId = boundedText(data.occurrenceId, 8);
    if (!isPreview) {
        if (
            !scheduleId ||
            !nativeAlarmId ||
            recipientMemberId === undefined ||
            alarmGeneration === undefined ||
            !actionEventKey ||
            !ACTION_EVENT_KEY_PATTERN.test(actionEventKey) ||
            alarmId !== `schedule:${scheduleId}:member:${recipientMemberId}` ||
            !isCanonicalNativeAlarmId(nativeAlarmId, alarmId) ||
            (occurrenceId !== undefined && !OCCURRENCE_ID_PATTERN.test(occurrenceId))
        ) return undefined;
    }

    const title = boundedText(data.title, 160);
    const body = boundedText(data.body, 500);
    const routeSummary = boundedText(data.routeSummary, 160);
    return {
        kind: "customAlarm",
        alarmId,
        isPreview,
        requestedAction: requestedAction(actionIdentifier),
        ...(previewId ? { previewId } : {}),
        ...(scheduleId ? { scheduleId } : {}),
        ...(nativeAlarmId ? { nativeAlarmId } : {}),
        ...(recipientMemberId !== undefined ? { recipientMemberId } : {}),
        ...(alarmGeneration !== undefined ? { alarmGeneration } : {}),
        ...(actionEventKey ? { actionEventKey } : {}),
        ...(occurrenceId ? { occurrenceId } : {}),
        ...(title ? { title } : {}),
        ...(body ? { body } : {}),
        ...(routeSummary ? { routeSummary } : {}),
    };
}

export function createNoLateCustomAlarmRoute(
    target: NoLateCustomAlarmNavigationTarget,
): NoLateCustomAlarmRoute {
    return {
        pathname: "/alarm",
        params: {
            type: NO_LATE_CUSTOM_ALARM_NOTIFICATION_TYPE,
            alarmId: target.alarmId,
            isPreview: target.isPreview ? "1" : "0",
            requestedAction: target.requestedAction,
            ...(target.capabilityId ? { capabilityId: target.capabilityId } : {}),
            ...(target.notificationIdentifier
                ? { notificationIdentifier: target.notificationIdentifier }
                : {}),
            ...(target.previewId ? { previewId: target.previewId } : {}),
            ...(target.scheduleId ? { scheduleId: target.scheduleId } : {}),
            ...(target.nativeAlarmId ? { nativeAlarmId: target.nativeAlarmId } : {}),
            ...(target.recipientMemberId !== undefined
                ? { recipientMemberId: String(target.recipientMemberId) }
                : {}),
            ...(target.alarmGeneration !== undefined
                ? { alarmGeneration: String(target.alarmGeneration) }
                : {}),
            ...(target.actionEventKey ? { actionEventKey: target.actionEventKey } : {}),
            ...(target.occurrenceId ? { occurrenceId: target.occurrenceId } : {}),
            ...(target.title ? { title: target.title } : {}),
            ...(target.body ? { body: target.body } : {}),
            ...(target.routeSummary ? { routeSummary: target.routeSummary } : {}),
        },
    };
}

export function getNoLateCustomAlarmRouteFromNotificationData(
    data: Record<string, unknown> | undefined,
    actionIdentifier?: string,
): NoLateCustomAlarmRoute | undefined {
    const target = getNoLateCustomAlarmNavigationTarget(data, actionIdentifier);
    return target ? createNoLateCustomAlarmRoute(target) : undefined;
}

function requestedAction(actionIdentifier?: string): NoLateCustomAlarmRequestedAction {
    if (actionIdentifier === NO_LATE_CUSTOM_ALARM_CONFIRM_DEPARTURE_ACTION ||
        actionIdentifier === NO_LATE_CUSTOM_ALARM_PREVIEW_DEPARTURE_ACTION) {
        return "confirmDeparture";
    }
    if (actionIdentifier === NO_LATE_CUSTOM_ALARM_PREVIEW_ROUTE_ACTION) return "route";
    return "open";
}

function boundedText(value: unknown, maximumLength: number): string | undefined {
    if (typeof value !== "string") return undefined;
    if (
        value !== value.trim() ||
        value.length === 0 ||
        value.length > maximumLength ||
        Array.from(value).some((character) => {
            const code = character.charCodeAt(0);
            return code <= 0x1f || code === 0x7f;
        })
    ) return undefined;
    return value;
}

function booleanValue(value: unknown): boolean | undefined {
    if (value === true || value === "true" || value === "1") return true;
    if (value === false || value === "false" || value === "0") return false;
    return undefined;
}

function positiveSafeInteger(value: unknown): number | undefined {
    const text = typeof value === "number" ? String(value) : boundedText(value, 16);
    if (!text || !/^[1-9]\d*$/.test(text)) return undefined;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function nonNegativeSafeInteger(value: unknown): number | undefined {
    const text = typeof value === "number" ? String(value) : boundedText(value, 16);
    if (!text || !/^(?:0|[1-9]\d*)$/.test(text)) return undefined;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isCanonicalNativeAlarmId(nativeAlarmId: string, alarmId: string): boolean {
    return nativeAlarmId === alarmId || nativeAlarmId.startsWith(`${alarmId}:occurrence:`);
}

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION_EVENT_KEY_PATTERN =
    /^(?:key:[a-f0-9]{64}|event:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const OCCURRENCE_ID_PATTERN = /^M(?:15|10|5|0)$/;
