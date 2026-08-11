import { Platform } from "react-native";

import type {
    NativeAlarmFireEvent,
    NativeAlarmNavigationEvent,
    NativeDepartureActionEvent,
    NativeDepartureReminderPresentationEvent,
} from "./departureAlarm";

/** 네이티브 발생 저널 값을 검증하고, 구버전 앱의 누락된 timingBasis를 플랫폼별 기본값으로 보완합니다. */
export function parseNativeAlarmFireEvent(value: unknown): NativeAlarmFireEvent | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const event = value as Partial<NativeAlarmFireEvent>;
    const timingBasis = event.timingBasis === "EXACT_CALLBACK" ||
        event.timingBasis === "OBSERVED_ALERTING" ||
        event.timingBasis === "INFERRED_OS_DELIVERY"
        ? event.timingBasis
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
            typeof event.logicalEventKey !== "string" || !event.logicalEventKey || event.logicalEventKey.length > 100
        )) ||
        (event.occurrenceId !== undefined && (
            typeof event.occurrenceId !== "string" || !["M15", "M10", "M5", "M0"].includes(event.occurrenceId)
        ))
    ) return undefined;
    return { ...(event as Omit<NativeAlarmFireEvent, "timingBasis">), timingBasis };
}

/** 출발 완료·미루기 액션 저널의 식별자, 세대, 수신자, 라우팅 상태를 모두 검증합니다. */
export function parseNativeDepartureActionEvent(value: unknown): NativeDepartureActionEvent | undefined {
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
            typeof event.notificationLogicalEventKey !== "string" || !isActionEventKey(event.notificationLogicalEventKey)
        )) ||
        (event.providerMessageId !== undefined && (
            typeof event.providerMessageId !== "string" || !event.providerMessageId || event.providerMessageId.length > 300
        ))
    ) return undefined;
    return event as NativeDepartureActionEvent;
}

/** 알림 탭으로 생성된 일정 이동 이벤트가 허용된 서버 식별자와 메시지 형식을 따르는지 검증합니다. */
export function parseNativeAlarmNavigationEvent(value: unknown): NativeAlarmNavigationEvent | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const event = value as Partial<NativeAlarmNavigationEvent>;
    if (
        typeof event.eventId !== "string" || !event.eventId || event.eventId.length > 200 ||
        typeof event.scheduleId !== "string" || !/^[1-9]\d*$/.test(event.scheduleId) ||
        !Number.isSafeInteger(event.recipientMemberId) || (event.recipientMemberId ?? 0) <= 0 ||
        typeof event.occurredAt !== "string" || !Number.isFinite(Date.parse(event.occurredAt)) ||
        (event.notificationLogicalEventKey !== undefined && (
            typeof event.notificationLogicalEventKey !== "string" || !isActionEventKey(event.notificationLogicalEventKey)
        )) ||
        (event.providerMessageId !== undefined && (
            typeof event.providerMessageId !== "string" || !event.providerMessageId || event.providerMessageId.length > 300
        ))
    ) return undefined;
    return event as NativeAlarmNavigationEvent;
}

/** 네이티브 표시 저널이 NoLate가 발급한 해시 태그와 유효한 수신자 정보를 갖는지 검증합니다. */
export function parseNativeDepartureReminderPresentationEvent(
    value: unknown,
): NativeDepartureReminderPresentationEvent | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const event = value as Partial<NativeDepartureReminderPresentationEvent>;
    if (
        typeof event.eventId !== "string" || !/^nolate-visible-[0-9a-f]{64}$/.test(event.eventId) ||
        event.notificationTag !== event.eventId ||
        !Number.isSafeInteger(event.recipientMemberId) || (event.recipientMemberId ?? 0) <= 0 ||
        typeof event.logicalEventKey !== "string" || !isActionEventKey(event.logicalEventKey) ||
        (event.providerMessageId !== undefined && (
            typeof event.providerMessageId !== "string" || !event.providerMessageId || event.providerMessageId.length > 300
        )) ||
        typeof event.occurredAt !== "string" || !Number.isFinite(Date.parse(event.occurredAt))
    ) return undefined;
    return event as NativeDepartureReminderPresentationEvent;
}

/** 알람 발생 시점을 서버 계약에서 허용하는 네 가지 occurrence 코드로 제한합니다. */
export function isOccurrenceId(value: unknown): value is "M15" | "M10" | "M5" | "M0" {
    return value === "M15" || value === "M10" || value === "M5" || value === "M0";
}

/** 액션 중복 제거 키가 SHA-256 키 또는 UUID 기반 이벤트 키 형식인지 확인합니다. */
export function isActionEventKey(value: string): boolean {
    return /^key:[a-f0-9]{64}$/.test(value) ||
        /^event:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
