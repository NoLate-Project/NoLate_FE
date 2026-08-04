export type DepartureAlarmOperation = "UPSERT" | "CANCEL";

export const DEPARTURE_ALARM_OCCURRENCE_IDS = ["M15", "M10", "M5", "M0"] as const;
export type DepartureAlarmOccurrenceId = typeof DEPARTURE_ALARM_OCCURRENCE_IDS[number];
export type DepartureAlarmDecision = "ADVANCE_NOTICE" | "DEPART_NOW";

export type DepartureAlarmSyncCommand = {
    operation: DepartureAlarmOperation;
    /** Stable server plan id used by receipts and lifecycle APIs. */
    alarmId: string;
    /** Stable native delivery id. It equals alarmId for legacy v1 M0 commands. */
    nativeAlarmId?: string;
    scheduleId: string;
    generation: number;
    /** Server revalidation nonce; used by the plan-level durable ordering fence. */
    validationRevision?: number;
    recipientMemberId: number;
    logicalEventKey?: string;
    occurrenceId?: DepartureAlarmOccurrenceId;
    triggerAt?: string;
    title?: string;
    body?: string;
    decision?: DepartureAlarmDecision;
    minutesBeforeDeparture?: 15 | 10 | 5 | 0;
    actionEventKey?: string;
    snoozeMinutes?: number;
};

export type DepartureAlarmSyncPlanCommand = {
    operation: DepartureAlarmOperation;
    alarmId: string;
    scheduleId: string;
    generation: number;
    validationRevision: number;
    recipientMemberId: number;
    logicalEventKey?: string;
    planSchemaVersion: 1 | 2;
    occurrences: DepartureAlarmSyncCommand[];
};

export const DEPARTURE_ALARM_SYNC_TYPE = "DEPARTURE_ALARM_SYNC";
export const DEPARTURE_ALARM_SCHEMA_VERSION = "1";
export const DEPARTURE_ALARM_PLAN_SCHEMA_VERSION = "2";
export const DEPARTURE_ALARM_MINIMUM_FUTURE_MILLISECONDS = 250;

const POSITIVE_INTEGER = /^[1-9]\d*$/;
const NON_NEGATIVE_INTEGER = /^(0|[1-9]\d*)$/;
const ACTION_EVENT_KEY = /^key:[a-f0-9]{64}$/;
const UTC_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const UPSERT_ONLY_FIELDS = [
    "alarmOccurrencesJson",
    "alarmTriggerAt",
    "alarmTitle",
    "snoozeMinutes",
] as const;

type ParsedOuterCommand = Omit<DepartureAlarmSyncPlanCommand, "planSchemaVersion" | "occurrences">;

/**
 * Parses either the legacy single M0 command or the v2 occurrence plan. FCM/APNs data values
 * remain strings at this boundary. Past v2 occurrences are intentionally retained here so the
 * reconciler can tombstone their deterministic native ids instead of accidentally firing them.
 */
export function parseDepartureAlarmSyncPlanCommand(
    data?: Record<string, unknown>,
    expectedRecipientMemberId?: number,
    nowMilliseconds = Date.now(),
): DepartureAlarmSyncPlanCommand | undefined {
    const outer = parseOuterCommand(data, expectedRecipientMemberId);
    if (!outer || !data) return undefined;

    const isV2 = data.alarmPlanSchemaVersion === DEPARTURE_ALARM_PLAN_SCHEMA_VERSION;
    if (
        data.alarmPlanSchemaVersion !== undefined &&
        !isV2
    ) return undefined;

    if (outer.operation === "CANCEL") {
        if (UPSERT_ONLY_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(data, field))) {
            return undefined;
        }
        return {
            ...outer,
            planSchemaVersion: isV2 ? 2 : 1,
            occurrences: [],
        };
    }

    const snoozeMinutes = parseSnoozeMinutes(data.snoozeMinutes);
    if (snoozeMinutes === undefined) return undefined;

    if (!isV2) {
        const triggerAt = exactText(data.alarmTriggerAt);
        const triggerAtMilliseconds = triggerAt
            ? parseStrictUtcInstantMilliseconds(triggerAt)
            : undefined;
        if (
            triggerAtMilliseconds === undefined ||
            !Number.isFinite(nowMilliseconds) ||
            triggerAtMilliseconds < nowMilliseconds + DEPARTURE_ALARM_MINIMUM_FUTURE_MILLISECONDS
        ) return undefined;

        const title = validText(data.alarmTitle, 100);
        if (!title) return undefined;
        return {
            ...outer,
            planSchemaVersion: 1,
            occurrences: [{
                ...outer,
                triggerAt,
                title,
                snoozeMinutes,
            }],
        };
    }

    const occurrences = parseV2Occurrences(data.alarmOccurrencesJson, outer, snoozeMinutes);
    if (!occurrences) return undefined;

    // Top-level M0 stays byte-compatible for older installed clients. Reject a split-brain plan
    // where those legacy fields disagree with the canonical M0 occurrence.
    const legacyTriggerAt = exactText(data.alarmTriggerAt);
    const legacyTitle = validText(data.alarmTitle, 100);
    const m0 = occurrences.find((occurrence) => occurrence.occurrenceId === "M0");
    if (!m0 || legacyTriggerAt !== m0.triggerAt || legacyTitle !== m0.title) return undefined;

    return {
        ...outer,
        planSchemaVersion: 2,
        occurrences,
    };
}

/**
 * Compatibility helper for call sites that still expect one command. A v2 plan exposes its M0
 * occurrence, while synchronization code must use parseDepartureAlarmSyncPlanCommand so it does
 * not silently discard M15/M10/M5.
 */
export function parseDepartureAlarmSyncCommand(
    data?: Record<string, unknown>,
    expectedRecipientMemberId?: number,
    nowMilliseconds = Date.now(),
): DepartureAlarmSyncCommand | undefined {
    const plan = parseDepartureAlarmSyncPlanCommand(
        data,
        expectedRecipientMemberId,
        nowMilliseconds,
    );
    if (!plan) return undefined;
    if (plan.operation === "CANCEL") {
        return {
            operation: "CANCEL",
            alarmId: plan.alarmId,
            scheduleId: plan.scheduleId,
            generation: plan.generation,
            validationRevision: plan.validationRevision,
            recipientMemberId: plan.recipientMemberId,
            ...(plan.logicalEventKey ? { logicalEventKey: plan.logicalEventKey } : {}),
        };
    }
    return plan.occurrences.find((occurrence) => occurrence.occurrenceId === "M0") ??
        plan.occurrences[0];
}

export function nativeAlarmIdForOccurrence(
    planAlarmId: string,
    occurrenceId: DepartureAlarmOccurrenceId,
): string {
    return `${planAlarmId}:occurrence:${occurrenceId}`;
}

export function canonicalNativeAlarmIdsForPlan(planAlarmId: string): string[] {
    return [
        planAlarmId,
        ...DEPARTURE_ALARM_OCCURRENCE_IDS.map((occurrenceId) =>
            nativeAlarmIdForOccurrence(planAlarmId, occurrenceId)
        ),
    ];
}

export function isDepartureAlarmOccurrenceEligible(
    command: DepartureAlarmSyncCommand,
    nowMilliseconds: number,
): boolean {
    const triggerAt = command.triggerAt ? Date.parse(command.triggerAt) : Number.NaN;
    return Number.isFinite(triggerAt) &&
        triggerAt >= nowMilliseconds + DEPARTURE_ALARM_MINIMUM_FUTURE_MILLISECONDS;
}

function parseOuterCommand(
    data?: Record<string, unknown>,
    expectedRecipientMemberId?: number,
): ParsedOuterCommand | undefined {
    if (
        data?.type !== DEPARTURE_ALARM_SYNC_TYPE ||
        data.alarmSchemaVersion !== DEPARTURE_ALARM_SCHEMA_VERSION ||
        !Number.isSafeInteger(expectedRecipientMemberId) ||
        (expectedRecipientMemberId ?? 0) <= 0
    ) return undefined;

    const recipientMemberId = exactText(data.recipientMemberId);
    if (recipientMemberId !== String(expectedRecipientMemberId)) return undefined;

    const operation = data.alarmOperation;
    if (operation !== "UPSERT" && operation !== "CANCEL") return undefined;

    const alarmId = exactText(data.alarmId);
    const scheduleId = exactText(data.scheduleId);
    const generationText = exactText(data.alarmGeneration);
    // Rolling-deploy compatibility: frozen commands created before validation revisions existed
    // are revision 0. Once a higher revision is claimed, the durable ordering fence rejects a
    // delayed missing/zero command in the same generation.
    const validationRevisionText = data.alarmValidationRevision === undefined
        ? "0"
        : exactText(data.alarmValidationRevision);
    if (!alarmId || !scheduleId || !generationText || !validationRevisionText) return undefined;
    if (
        !POSITIVE_INTEGER.test(scheduleId) ||
        !NON_NEGATIVE_INTEGER.test(generationText) ||
        !NON_NEGATIVE_INTEGER.test(validationRevisionText)
    ) {
        return undefined;
    }

    const scheduleNumber = Number(scheduleId);
    const generation = Number(generationText);
    const validationRevision = Number(validationRevisionText);
    const recipientMemberNumber = Number(recipientMemberId);
    if (
        !Number.isSafeInteger(scheduleNumber) ||
        !Number.isSafeInteger(generation) ||
        !Number.isSafeInteger(validationRevision) ||
        !Number.isSafeInteger(recipientMemberNumber) ||
        recipientMemberNumber <= 0 ||
        alarmId !== `schedule:${scheduleId}:member:${recipientMemberId}`
    ) return undefined;

    return {
        operation,
        alarmId,
        scheduleId,
        generation,
        validationRevision,
        recipientMemberId: recipientMemberNumber,
        ...optionalLogicalEventKey(data.logicalEventKey),
    };
}

function parseV2Occurrences(
    rawValue: unknown,
    outer: ParsedOuterCommand,
    snoozeMinutes: number,
): DepartureAlarmSyncCommand[] | undefined {
    const raw = exactText(rawValue);
    if (!raw) return undefined;

    let values: unknown;
    try {
        values = JSON.parse(raw);
    } catch {
        return undefined;
    }
    if (!Array.isArray(values) || values.length !== DEPARTURE_ALARM_OCCURRENCE_IDS.length) {
        return undefined;
    }

    const seen = new Set<DepartureAlarmOccurrenceId>();
    const occurrences: DepartureAlarmSyncCommand[] = [];
    let previousTrigger = Number.NEGATIVE_INFINITY;
    for (const value of values) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
        const occurrence = value as Record<string, unknown>;
        const occurrenceId = exactText(occurrence.occurrenceId) as DepartureAlarmOccurrenceId | undefined;
        if (!occurrenceId || !DEPARTURE_ALARM_OCCURRENCE_IDS.includes(occurrenceId)) return undefined;
        if (seen.has(occurrenceId)) return undefined;

        const expectedMinutes = occurrenceId === "M15"
            ? 15
            : occurrenceId === "M10"
                ? 10
                : occurrenceId === "M5"
                    ? 5
                    : 0;
        const minutesBeforeDeparture = occurrence.minutesBeforeDeparture;
        const decision = exactText(occurrence.decision);
        if (
            minutesBeforeDeparture !== expectedMinutes ||
            (occurrenceId === "M0" ? decision !== "DEPART_NOW" : decision !== "ADVANCE_NOTICE")
        ) return undefined;

        const triggerAt = exactText(occurrence.triggerAt);
        const triggerMilliseconds = triggerAt
            ? parseStrictUtcInstantMilliseconds(triggerAt)
            : undefined;
        const title = validText(occurrence.title, 100);
        const body = validText(occurrence.body, 500);
        const actionEventKey = exactText(occurrence.actionEventKey);
        if (
            triggerMilliseconds === undefined ||
            triggerMilliseconds <= previousTrigger ||
            !title ||
            !body ||
            !actionEventKey ||
            !ACTION_EVENT_KEY.test(actionEventKey)
        ) return undefined;

        seen.add(occurrenceId);
        previousTrigger = triggerMilliseconds;
        occurrences.push({
            ...outer,
            nativeAlarmId: nativeAlarmIdForOccurrence(outer.alarmId, occurrenceId),
            occurrenceId,
            triggerAt,
            title,
            body,
            decision: decision as DepartureAlarmDecision,
            minutesBeforeDeparture: expectedMinutes,
            actionEventKey,
            snoozeMinutes,
        });
    }
    if (!DEPARTURE_ALARM_OCCURRENCE_IDS.every(
        (occurrenceId, index) => occurrences[index]?.occurrenceId === occurrenceId,
    )) return undefined;

    const m0Trigger = occurrences.find((occurrence) => occurrence.occurrenceId === "M0")?.triggerAt;
    const m0Milliseconds = m0Trigger
        ? parseStrictUtcInstantMilliseconds(m0Trigger)
        : undefined;
    if (m0Milliseconds === undefined || occurrences.some((occurrence) => {
        const trigger = occurrence.triggerAt
            ? parseStrictUtcInstantMilliseconds(occurrence.triggerAt)
            : undefined;
        return trigger === undefined ||
            trigger !== m0Milliseconds - (occurrence.minutesBeforeDeparture ?? 0) * 60_000;
    })) return undefined;
    return occurrences;
}

function parseSnoozeMinutes(value: unknown): number | undefined {
    const text = exactText(value);
    if (!text || !POSITIVE_INTEGER.test(text)) return undefined;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 60
        ? parsed
        : undefined;
}

function validText(value: unknown, maximumLength: number): string | undefined {
    const text = exactText(value);
    return text && Array.from(text).length <= maximumLength ? text : undefined;
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
    ) return undefined;
    return parsed;
}

function exactText(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    if (!value || value !== value.trim()) return undefined;
    return value;
}
