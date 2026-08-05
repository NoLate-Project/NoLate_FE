import { hasNoLateCustomAlarmCapability } from "./customAlarmCapability";

export type NoLateAlarmSearchParam = string | string[] | undefined;

export type NoLateCustomAlarmSearchParams = {
    type?: NoLateAlarmSearchParam;
    alarmId?: NoLateAlarmSearchParam;
    previewId?: NoLateAlarmSearchParam;
    scheduleId?: NoLateAlarmSearchParam;
    title?: NoLateAlarmSearchParam;
    body?: NoLateAlarmSearchParam;
    routeSummary?: NoLateAlarmSearchParam;
    isPreview?: NoLateAlarmSearchParam;
    requestedAction?: NoLateAlarmSearchParam;
    capabilityId?: NoLateAlarmSearchParam;
    notificationIdentifier?: NoLateAlarmSearchParam;
    nativeAlarmId?: NoLateAlarmSearchParam;
    recipientMemberId?: NoLateAlarmSearchParam;
    alarmGeneration?: NoLateAlarmSearchParam;
    actionEventKey?: NoLateAlarmSearchParam;
    occurrenceId?: NoLateAlarmSearchParam;
};

export type NoLateCustomAlarmRequestedAction = "open" | "route" | "confirmDeparture";

export type NoLateCustomAlarmPresentation = {
    alarmId?: string;
    capabilityId?: string;
    notificationIdentifier?: string;
    previewId?: string;
    scheduleId?: string;
    nativeAlarmId?: string;
    recipientMemberId?: number;
    alarmGeneration?: number;
    actionEventKey?: string;
    occurrenceId?: string;
    title: string;
    body: string;
    routeSummary?: string;
    isPreview: boolean;
    hasValidAlarmIdentity: boolean;
    canOpenRoute: boolean;
    canCompleteDeparture: boolean;
    requestedAction: NoLateCustomAlarmRequestedAction;
    instanceKey: string;
};

const CUSTOM_ALARM_PAYLOAD_TYPE = "NOLATE_CUSTOM_ALARM";
const ALARM_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const PREVIEW_IDENTIFIER_PATTERN = /^(?:preview|test)(?=$|[:._-])/i;
const POSITIVE_SCHEDULE_IDENTIFIER_PATTERN = /^[1-9]\d*$/;

export function parseNoLateCustomAlarmPresentation(
    params: NoLateCustomAlarmSearchParams,
): NoLateCustomAlarmPresentation {
    const payloadType = firstValue(params.type)?.trim();
    const payloadTypeValid = payloadType === CUSTOM_ALARM_PAYLOAD_TYPE;
    const alarmId = normalizeIdentifier(firstValue(params.alarmId));
    const capabilityId = normalizeUUID(firstValue(params.capabilityId));
    const notificationIdentifier = normalizeIdentifier(firstValue(params.notificationIdentifier));
    const previewId = normalizeIdentifier(firstValue(params.previewId));
    const scheduleId = normalizeScheduleId(firstValue(params.scheduleId));
    const nativeAlarmId = normalizeIdentifier(firstValue(params.nativeAlarmId));
    const recipientMemberId = normalizePositiveSafeInteger(firstValue(params.recipientMemberId));
    const alarmGeneration = normalizeNonNegativeSafeInteger(firstValue(params.alarmGeneration));
    const actionEventKey = normalizeActionEventKey(firstValue(params.actionEventKey));
    const occurrenceId = normalizeOccurrenceId(firstValue(params.occurrenceId));
    const explicitPreview = parseBoolean(firstValue(params.isPreview));
    const previewIdentity = previewId ?? alarmId;
    const isPreview =
        explicitPreview ||
        previewId !== undefined ||
        (previewIdentity !== undefined && PREVIEW_IDENTIFIER_PATTERN.test(previewIdentity));
    const requestedAction = normalizeRequestedAction(firstValue(params.requestedAction));
    const hasValidAlarmIdentity =
        payloadTypeValid &&
        alarmId !== undefined &&
        notificationIdentifier !== undefined &&
        hasNoLateCustomAlarmCapability({
            capabilityId,
            alarmId,
            isPreview,
            requestedAction,
            previewId,
            scheduleId,
            notificationIdentifier,
            nativeAlarmId,
            recipientMemberId,
            alarmGeneration,
            actionEventKey,
            occurrenceId,
        });
    const canOpenRoute = hasValidAlarmIdentity && scheduleId !== undefined;
    const canCompleteDeparture =
        hasValidAlarmIdentity &&
        !isPreview &&
        scheduleId !== undefined &&
        nativeAlarmId !== undefined &&
        recipientMemberId !== undefined &&
        alarmGeneration !== undefined &&
        actionEventKey !== undefined;
    const title = normalizeVisibleText(firstValue(params.title), 80) ?? "출발 알람";
    const body = normalizeVisibleText(firstValue(params.body), 240) ?? "지금 출발할 시간이에요.";
    const routeSummary = normalizeVisibleText(firstValue(params.routeSummary), 160);

    return {
        ...(alarmId ? { alarmId } : {}),
        ...(capabilityId ? { capabilityId } : {}),
        ...(notificationIdentifier ? { notificationIdentifier } : {}),
        ...(previewId ? { previewId } : {}),
        ...(scheduleId ? { scheduleId } : {}),
        ...(nativeAlarmId ? { nativeAlarmId } : {}),
        ...(recipientMemberId !== undefined ? { recipientMemberId } : {}),
        ...(alarmGeneration !== undefined ? { alarmGeneration } : {}),
        ...(actionEventKey ? { actionEventKey } : {}),
        ...(occurrenceId ? { occurrenceId } : {}),
        title,
        body,
        ...(routeSummary ? { routeSummary } : {}),
        isPreview,
        hasValidAlarmIdentity,
        canOpenRoute,
        canCompleteDeparture,
        requestedAction,
        instanceKey: capabilityId ?? previewId ?? alarmId ?? "invalid-alarm",
    };
}

export function canCompleteNoLateCustomAlarmDeparture(
    presentation: NoLateCustomAlarmPresentation,
): presentation is NoLateCustomAlarmPresentation & {
    alarmId: string;
    capabilityId: string;
    notificationIdentifier: string;
    scheduleId: string;
    nativeAlarmId: string;
    recipientMemberId: number;
    alarmGeneration: number;
    actionEventKey: string;
} {
    return (
        presentation.canCompleteDeparture &&
        presentation.alarmId !== undefined &&
        presentation.capabilityId !== undefined &&
        presentation.notificationIdentifier !== undefined &&
        presentation.scheduleId !== undefined &&
        presentation.nativeAlarmId !== undefined &&
        presentation.recipientMemberId !== undefined &&
        presentation.alarmGeneration !== undefined &&
        presentation.actionEventKey !== undefined
    );
}

export function formatNoLateAlarmTime(value: Date): string {
    const timestamp = value.getTime();
    if (!Number.isFinite(timestamp)) return "--:--";

    const hours = value.getHours();
    const minutes = String(value.getMinutes()).padStart(2, "0");
    const period = hours < 12 ? "오전" : "오후";
    const hour = hours % 12 || 12;
    return `${period} ${hour}:${minutes}`;
}

function firstValue(value: NoLateAlarmSearchParam): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

function normalizeIdentifier(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    if (!normalized || !ALARM_IDENTIFIER_PATTERN.test(normalized)) return undefined;
    return normalized;
}

function normalizeScheduleId(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    if (!normalized || !POSITIVE_SCHEDULE_IDENTIFIER_PATTERN.test(normalized)) return undefined;
    return normalized;
}

function normalizeUUID(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized && UUID_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizePositiveSafeInteger(value: string | undefined): number | undefined {
    const normalized = value?.trim();
    if (!normalized || !/^[1-9]\d*$/.test(normalized)) return undefined;
    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function normalizeNonNegativeSafeInteger(value: string | undefined): number | undefined {
    const normalized = value?.trim();
    if (!normalized || !/^(?:0|[1-9]\d*)$/.test(normalized)) return undefined;
    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function normalizeActionEventKey(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized && ACTION_EVENT_KEY_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeOccurrenceId(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized && OCCURRENCE_ID_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeVisibleText(value: string | undefined, maximumLength: number): string | undefined {
    const normalized = value
        ?.split("")
        .map(character => (isControlCharacter(character) ? " " : character))
        .join("")
        .replace(/\s+/g, " ")
        .trim();
    if (!normalized) return undefined;
    return normalized.slice(0, maximumLength);
}

function isControlCharacter(value: string): boolean {
    const code = value.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
}

function parseBoolean(value: string | undefined): boolean {
    if (!value) return false;
    return value === "1" || value.toLowerCase() === "true";
}

function normalizeRequestedAction(value: string | undefined): NoLateCustomAlarmRequestedAction {
    if (value === "route" || value === "confirmDeparture") return value;
    return "open";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION_EVENT_KEY_PATTERN =
    /^(?:key:[a-f0-9]{64}|event:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const OCCURRENCE_ID_PATTERN = /^M(?:15|10|5|0)$/;
