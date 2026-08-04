import AsyncStorage from "@react-native-async-storage/async-storage";

import type { DepartureAlarmSyncPlanCommand } from "./departureAlarmContract";

const STORAGE_KEY_PREFIX = "nolate_departure_alarm_validation_revisions_v1:";
const SCHEMA_VERSION = 1;

type ValidationRevisionEntry = {
    alarmId: string;
    generation: number;
    validationRevision: number;
};

type ValidationRevisionEnvelope = {
    version: typeof SCHEMA_VERSION;
    entries: ValidationRevisionEntry[];
};

export type DepartureAlarmRevisionClaim = "ACCEPTED" | "STALE";

const touchedMemberIds = new Set<number>();

function storageKey(memberId: number): string {
    return `${STORAGE_KEY_PREFIX}${memberId}`;
}

function parseEntry(value: unknown, memberId: number): ValidationRevisionEntry | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const candidate = value as Partial<ValidationRevisionEntry>;
    if (
        typeof candidate.alarmId !== "string" ||
        !candidate.alarmId.startsWith("schedule:") ||
        !candidate.alarmId.endsWith(`:member:${memberId}`) ||
        !Number.isSafeInteger(candidate.generation) ||
        (candidate.generation ?? -1) < 0 ||
        !Number.isSafeInteger(candidate.validationRevision) ||
        (candidate.validationRevision ?? -1) < 0
    ) return undefined;
    return candidate as ValidationRevisionEntry;
}

function parseEnvelope(
    raw: string | null,
    memberId: number,
): ValidationRevisionEntry[] | undefined {
    if (!raw) return [];
    try {
        const envelope = JSON.parse(raw) as Partial<ValidationRevisionEnvelope>;
        if (envelope.version !== SCHEMA_VERSION || !Array.isArray(envelope.entries)) {
            return undefined;
        }
        const entries = new Map<string, ValidationRevisionEntry>();
        for (const candidate of envelope.entries) {
            const entry = parseEntry(candidate, memberId);
            if (!entry) return undefined;
            const current = entries.get(entry.alarmId);
            if (
                !current ||
                entry.generation > current.generation ||
                (
                    entry.generation === current.generation &&
                    entry.validationRevision > current.validationRevision
                )
            ) {
                entries.set(entry.alarmId, entry);
            }
        }
        return Array.from(entries.values());
    } catch {
        return undefined;
    }
}

/**
 * Durably claims a server control revision before crossing the native mutation boundary. A crash
 * after this write is recoverable because an equal generation/revision is accepted and replayed;
 * an older control can never undo a newer UPSERT/CANCEL after process restart.
 */
export async function claimDepartureAlarmValidationRevision(
    plan: DepartureAlarmSyncPlanCommand,
): Promise<DepartureAlarmRevisionClaim> {
    const memberId = plan.recipientMemberId;
    touchedMemberIds.add(memberId);
    const key = storageKey(memberId);
    const entries = parseEnvelope(await AsyncStorage.getItem(key), memberId);
    if (!entries) throw new Error("Departure alarm validation revision journal is corrupt.");
    const current = entries.find((entry) => entry.alarmId === plan.alarmId);
    if (current) {
        if (plan.generation < current.generation) return "STALE";
        if (
            plan.generation === current.generation &&
            plan.validationRevision < current.validationRevision
        ) return "STALE";
        if (
            plan.generation === current.generation &&
            plan.validationRevision === current.validationRevision
        ) return "ACCEPTED";
    }

    const nextEntry: ValidationRevisionEntry = {
        alarmId: plan.alarmId,
        generation: plan.generation,
        validationRevision: plan.validationRevision,
    };
    const nextEntries = entries.filter((entry) => entry.alarmId !== plan.alarmId);
    nextEntries.push(nextEntry);
    const envelope: ValidationRevisionEnvelope = {
        version: SCHEMA_VERSION,
        entries: nextEntries,
    };
    // Await durability before native work. If this write fails, callers fail closed and emit no
    // misleading receipt because freshness cannot be proven.
    await AsyncStorage.setItem(key, JSON.stringify(envelope));
    return "ACCEPTED";
}

export async function clearDepartureAlarmValidationRevisions(memberId: number): Promise<void> {
    if (!Number.isSafeInteger(memberId) || memberId <= 0) return;
    touchedMemberIds.delete(memberId);
    await AsyncStorage.removeItem(storageKey(memberId));
}

export async function resetDepartureAlarmValidationRevisionJournalForTests(): Promise<void> {
    if (process.env.NODE_ENV !== "test") return;
    const memberIds = Array.from(touchedMemberIds);
    touchedMemberIds.clear();
    await Promise.all(memberIds.map((memberId) => AsyncStorage.removeItem(storageKey(memberId))));
}
