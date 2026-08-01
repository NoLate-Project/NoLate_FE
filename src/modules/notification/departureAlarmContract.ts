export type DepartureAlarmOperation = "UPSERT" | "CANCEL";

export type DepartureAlarmSyncCommand = {
    operation: DepartureAlarmOperation;
    alarmId: string;
    scheduleId: string;
    generation: number;
    recipientMemberId: number;
    logicalEventKey?: string;
    triggerAt?: string;
    title?: string;
    snoozeMinutes?: number;
};

export const DEPARTURE_ALARM_SYNC_TYPE = "DEPARTURE_ALARM_SYNC";
export const DEPARTURE_ALARM_SCHEMA_VERSION = "1";
export const DEPARTURE_ALARM_MINIMUM_FUTURE_MILLISECONDS = 250;

const POSITIVE_INTEGER = /^[1-9]\d*$/;
const NON_NEGATIVE_INTEGER = /^(0|[1-9]\d*)$/;
const UTC_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const UPSERT_ONLY_FIELDS = [
    "alarmTriggerAt",
    "alarmTitle",
    "snoozeMinutes",
] as const;

/**
 * FCM/APNs data는 모두 문자열 map으로 도착한다. 오래되거나 일부만 채워진 payload가
 * 기기 알람을 생성·취소하지 못하도록 한 경계에서 엄격히 검증한다.
 */
export function parseDepartureAlarmSyncCommand(
    data?: Record<string, unknown>,
    expectedRecipientMemberId?: number,
    nowMilliseconds = Date.now(),
): DepartureAlarmSyncCommand | undefined {
    if (
        data?.type !== DEPARTURE_ALARM_SYNC_TYPE ||
        data.alarmSchemaVersion !== DEPARTURE_ALARM_SCHEMA_VERSION ||
        !Number.isSafeInteger(expectedRecipientMemberId) ||
        (expectedRecipientMemberId ?? 0) <= 0
    ) {
        return undefined;
    }

    const recipientMemberId = exactText(data.recipientMemberId);
    if (recipientMemberId !== String(expectedRecipientMemberId)) return undefined;

    const operation = data?.alarmOperation;
    if (operation !== "UPSERT" && operation !== "CANCEL") return undefined;

    const alarmId = exactText(data.alarmId);
    const scheduleId = exactText(data.scheduleId);
    const generationText = exactText(data.alarmGeneration);
    if (!alarmId || !scheduleId || !generationText) return undefined;
    if (!POSITIVE_INTEGER.test(scheduleId) || !NON_NEGATIVE_INTEGER.test(generationText)) {
        return undefined;
    }

    const scheduleNumber = Number(scheduleId);
    const generation = Number(generationText);
    const recipientMemberNumber = Number(recipientMemberId);
    if (
        !Number.isSafeInteger(scheduleNumber) ||
        !Number.isSafeInteger(generation) ||
        !Number.isSafeInteger(recipientMemberNumber) ||
        recipientMemberNumber <= 0 ||
        alarmId !== `schedule:${scheduleId}:member:${recipientMemberId}`
    ) {
        return undefined;
    }

    if (operation === "CANCEL") {
        if (UPSERT_ONLY_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(data, field))) {
            return undefined;
        }
        return {
            operation,
            alarmId,
            scheduleId,
            generation,
            recipientMemberId: recipientMemberNumber,
            ...optionalLogicalEventKey(data.logicalEventKey),
        };
    }

    const triggerAt = exactText(data.alarmTriggerAt);
    const triggerAtMilliseconds = triggerAt
        ? parseStrictUtcInstantMilliseconds(triggerAt)
        : undefined;
    if (
        triggerAtMilliseconds === undefined ||
        !Number.isFinite(nowMilliseconds) ||
        triggerAtMilliseconds < nowMilliseconds + DEPARTURE_ALARM_MINIMUM_FUTURE_MILLISECONDS
    ) {
        return undefined;
    }

    const title = exactText(data.alarmTitle);
    const snoozeText = exactText(data.snoozeMinutes);
    if (!title || Array.from(title).length > 100 || !snoozeText || !POSITIVE_INTEGER.test(snoozeText)) {
        return undefined;
    }
    const snoozeMinutes = Number(snoozeText);
    if (!Number.isSafeInteger(snoozeMinutes) || snoozeMinutes < 1 || snoozeMinutes > 60) {
        return undefined;
    }

    return {
        operation,
        alarmId,
        scheduleId,
        generation,
        recipientMemberId: recipientMemberNumber,
        ...optionalLogicalEventKey(data.logicalEventKey),
        triggerAt,
        title,
        snoozeMinutes,
    };
}

function optionalLogicalEventKey(value: unknown): { logicalEventKey?: string } {
    const logicalEventKey = exactText(value);
    return logicalEventKey && logicalEventKey.length <= 100 ? { logicalEventKey } : {};
}

export function isDepartureAlarmSyncData(
    data?: Record<string, unknown>,
): boolean {
    return data?.type === DEPARTURE_ALARM_SYNC_TYPE;
}

export function parseStrictUtcInstantMilliseconds(value: string): number | undefined {
    const match = UTC_INSTANT.exec(value);
    if (!match) return undefined;

    const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ""] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const milliseconds = Number(fraction.padEnd(3, "0").slice(0, 3) || "0");
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isSafeInteger(parsed)) {
        return undefined;
    }

    const date = new Date(parsed);
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() + 1 !== month ||
        date.getUTCDate() !== day ||
        date.getUTCHours() !== hour ||
        date.getUTCMinutes() !== minute ||
        date.getUTCSeconds() !== second ||
        date.getUTCMilliseconds() !== milliseconds
    ) {
        return undefined;
    }
    return parsed;
}

function exactText(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    if (!value || value !== value.trim()) return undefined;
    return value;
}
