import {
    type NotificationDeliveryAckPayload,
    type NotificationDeliveryAckStage,
} from "../../api/notification";
import { getAuthMember } from "../auth/authStorage";
import {
    deliverPushDeliveryAckDurably,
    resetPushDeliveryAckQueueForTests,
} from "./pushDeliveryAckQueue";
import { getOrCreatePushDeviceId } from "./pushDeviceIdentity";
import { getLogicalEventKeyFromPushData } from "./pushNotificationIdentity";

export { getLogicalEventKeyFromPushData } from "./pushNotificationIdentity";

const MAX_COMPLETED_ACK_KEYS = 500;
const MAX_PROVIDER_MESSAGE_ID_LENGTH = 300;
const MAX_ALARM_ID_LENGTH = 100;
const MAX_ACTION_IDENTIFIER_LENGTH = 100;

type PushDeliveryAckMetadata = {
    providerMessageId?: unknown;
    alarmId?: unknown;
    actionIdentifier?: unknown;
    occurredAt?: string;
};

const completedAckKeys = new Set<string>();
const inFlightAcks = new Map<string, Promise<boolean>>();

function normalizedText(value: unknown, maximumLength: number): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    if (!normalized || normalized.length > maximumLength) return undefined;
    return normalized;
}

function normalizedMemberId(value: unknown): number | undefined {
    const parsed = typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : value;
    return typeof parsed === "number" && Number.isSafeInteger(parsed) && parsed > 0
        ? parsed
        : undefined;
}

function rememberCompletedAck(key: string): void {
    completedAckKeys.add(key);
    while (completedAckKeys.size > MAX_COMPLETED_ACK_KEYS) {
        const oldest = completedAckKeys.values().next().value;
        if (typeof oldest !== "string") return;
        completedAckKeys.delete(oldest);
    }
}

/**
 * Sends an authenticated device ACK without allowing telemetry failure to
 * break notification presentation, navigation, actions, or native scheduling.
 *
 * The logical event key is injected by the server into current push payloads.
 * Legacy payloads without it are deliberately ignored because provider message
 * ids alone cannot be matched to the frozen per-device delivery safely.
 */
export function acknowledgePushDelivery(
    data: Record<string, unknown> | undefined,
    stage: NotificationDeliveryAckStage,
    metadata: PushDeliveryAckMetadata = {},
): Promise<boolean> {
    const logicalEventKey = getLogicalEventKeyFromPushData(data);
    if (!logicalEventKey) return Promise.resolve(false);
    // Capture the callback time before SecureStore/network work so delivery latency
    // reflects when the OS handed the event to JavaScript, not when the POST began.
    const occurredAt = metadata.occurredAt ?? new Date().toISOString();

    const recipientMemberId = normalizedMemberId(data?.recipientMemberId);
    const ackKey = `${recipientMemberId ?? "current"}\u0000${logicalEventKey}\u0000${stage}`;
    if (completedAckKeys.has(ackKey)) return Promise.resolve(true);

    const existing = inFlightAcks.get(ackKey);
    if (existing) return existing;

    const request = (async () => {
        try {
            const currentMemberId = normalizedMemberId((await getAuthMember())?.id);
            if (!currentMemberId) return false;
            // Canonical pushes are recipient-bound. Never persist or send one
            // using another account's access token after an account switch.
            if (recipientMemberId && recipientMemberId !== currentMemberId) return false;

            const payload: NotificationDeliveryAckPayload = {
                logicalEventKey,
                deviceId: await getOrCreatePushDeviceId(),
                stage,
                occurredAt,
            };
            const providerMessageId = normalizedText(
                metadata.providerMessageId,
                MAX_PROVIDER_MESSAGE_ID_LENGTH,
            );
            const alarmId = normalizedText(metadata.alarmId, MAX_ALARM_ID_LENGTH);
            const actionIdentifier = normalizedText(
                metadata.actionIdentifier,
                MAX_ACTION_IDENTIFIER_LENGTH,
            );
            if (providerMessageId) payload.providerMessageId = providerMessageId;
            if (alarmId) payload.alarmId = alarmId;
            if (actionIdentifier) payload.actionIdentifier = actionIdentifier;

            const delivered = await deliverPushDeliveryAckDurably(currentMemberId, payload);
            if (!delivered) return false;
            rememberCompletedAck(ackKey);
            return true;
        } catch (error) {
            if (__DEV__ && process.env.NODE_ENV !== "test") {
                console.warn("[push-ack] delivery acknowledgement failed", error);
            }
            return false;
        }
    })().finally(() => {
        if (inFlightAcks.get(ackKey) === request) inFlightAcks.delete(ackKey);
    });

    inFlightAcks.set(ackKey, request);
    return request;
}

/** Test-only reset for deterministic duplicate and retry coverage. */
export function resetPushDeliveryAckForTests(): void {
    if (process.env.NODE_ENV !== "test") return;
    completedAckKeys.clear();
    inFlightAcks.clear();
    resetPushDeliveryAckQueueForTests();
}
