import type { FirebaseMessagingTypes } from "@react-native-firebase/messaging";

import { markScheduleDeparted, snoozeScheduleDepartureReminder } from "../../api/schedule";
import { ApiResponseError } from "../../api/response";
import { getAuthMember } from "../auth/authStorage";
import { recoverDepartureAlarmsAfterMutation } from "./departureAlarmMutationRecovery";

/** 잘못된 계정·식별자처럼 재시도해도 성공할 수 없는 알림 액션을 구분하는 오류입니다. */
class PermanentNotificationInteractionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PermanentNotificationInteractionError";
    }
}

/** 알림 액션 실패가 네트워크·인증 회복 뒤 다시 처리할 수 있는 종류인지 판별합니다. */
export function isRetryableNotificationInteractionError(error: unknown): boolean {
    if (error instanceof PermanentNotificationInteractionError) return false;
    if (!(error instanceof ApiResponseError)) return true;
    const status = error.status;
    if (status === 401 || status === 408 || status === 429) return true;
    return status === undefined || status < 400 || status >= 500;
}

/** 알림의 출발 완료 액션을 서버에 반영하고 관련 네이티브 알람을 복구 동기화합니다. */
export async function completeDepartureFromNotificationAction(scheduleId: string): Promise<void> {
    await markScheduleDeparted(scheduleId);
    await recoverDepartureAlarmsAfterMutation();
}

/** 알림 데이터를 계정·세대·중복 제거 키까지 검증한 뒤 네이티브 영속 저널에 기록합니다. */
export async function queueDepartureFromNotificationAction(
    scheduleId: string,
    data?: Record<string, unknown> | FirebaseMessagingTypes.RemoteMessage["data"],
): Promise<string> {
    const memberId = (await getAuthMember())?.id;
    if (!Number.isSafeInteger(memberId) || (memberId ?? 0) <= 0) {
        throw new Error("Authenticated member is unavailable.");
    }
    const recipientMemberIdText = typeof data?.recipientMemberId === "string" ? data.recipientMemberId : undefined;
    if (!recipientMemberIdText || !/^[1-9]\d*$/.test(recipientMemberIdText)) {
        throw new PermanentNotificationInteractionError("Notification recipient identity is unavailable.");
    }
    const recipientMemberId = Number(recipientMemberIdText);
    if (!Number.isSafeInteger(recipientMemberId) || recipientMemberId !== memberId) {
        throw new PermanentNotificationInteractionError("Notification belongs to another account.");
    }
    const generationText = typeof data?.alarmGeneration === "string" ? data.alarmGeneration : undefined;
    const generation = generationText && /^(0|[1-9]\d*)$/.test(generationText) ? Number(generationText) : 0;
    const rawActionEventKey = typeof data?.actionEventKey === "string"
        ? data.actionEventKey
        : typeof data?.logicalEventKey === "string" ? data.logicalEventKey : undefined;
    const actionEventKey = rawActionEventKey && (
        /^key:[a-f0-9]{64}$/.test(rawActionEventKey) ||
        /^event:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawActionEventKey)
    ) ? rawActionEventKey : undefined;
    if (!actionEventKey) {
        throw new PermanentNotificationInteractionError("Notification action identity is invalid.");
    }
    const { enqueueStandardDepartureAction } = require(
        "./nativeDepartureActionJournal"
    ) as typeof import("./nativeDepartureActionJournal");
    const queued = await enqueueStandardDepartureAction({
        scheduleId,
        recipientMemberId,
        generation: Number.isSafeInteger(generation) ? generation : 0,
        ...(typeof data?.alarmId === "string" ? { alarmId: data.alarmId } : {}),
        ...(typeof data?.occurrenceId === "string" ? { occurrenceId: data.occurrenceId } : {}),
        actionEventKey,
        requiresRouteNavigation: false,
    });
    if (!queued) throw new Error("Native departure action journal is unavailable.");
    const { activateNativeDepartureActionJournalForAuthenticatedMember } = require(
        "./nativeDepartureActionJournal"
    ) as typeof import("./nativeDepartureActionJournal");
    activateNativeDepartureActionJournalForAuthenticatedMember().catch(() => undefined);
    return actionEventKey;
}

/** 알림의 다시 알림 액션을 서버에 반영하고 변경된 출발 알람 계획을 복구 동기화합니다. */
export async function snoozeDepartureFromNotificationAction(scheduleId: string): Promise<void> {
    await snoozeScheduleDepartureReminder(scheduleId);
    await recoverDepartureAlarmsAfterMutation();
}
