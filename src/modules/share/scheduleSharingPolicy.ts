import { getEnv } from "../../api/env";
import type {
    ScheduleCategory,
    ScheduleItem,
    ScheduleSharePermission,
} from "../schedule/types";
import {
    getScheduleSharingSessionOwnerId,
} from "./scheduleSharingSessionOwner";

export const SCHEDULE_SHARING_ENV_KEY =
    "EXPO_PUBLIC_SCHEDULE_SHARING_ENABLED";

const SHARING_NOTIFICATION_TYPES = new Set([
    "SCHEDULE_SHARE_RECEIVED",
    "CATEGORY_SHARE_RECEIVED",
    "CALENDAR_SHARE_RECEIVED",
    "SCHEDULE_PARTICIPANT_DEPARTED",
    "SCHEDULE_DEPARTURE_NUDGE",
    "SCHEDULE_CACHE_INVALIDATED",
]);
const OWNER_SCHEDULE_NOTIFICATION_TYPES = new Set([
    "SCHEDULE_TRAFFIC",
    "SCHEDULE_DEPARTURE_REMINDER",
    "SCHEDULE_DETAIL",
    "ROUTE_SETUP_REMINDER",
]);
const PASSIVE_NOTIFICATION_TYPES = new Set([
    "PUSH_SCENARIO_TOKEN_CHECK",
]);

type NotificationData = Record<string, unknown> | undefined;

type StoredNotificationLike = {
    type: string;
    data?: Record<string, unknown>;
};

/**
 * Schedule sharing is part of the normal product surface, so a missing key
 * keeps it available. Explicit configuration remains fail-closed: only the
 * exact public value "true" enables it and every other provided value closes
 * all sharing boundaries.
 */
export function resolveScheduleSharingEnabled(rawValue: unknown): boolean {
    return rawValue === undefined || rawValue === "true";
}

export function isScheduleSharingEnabled(): boolean {
    return resolveScheduleSharingEnabled(getEnv(SCHEDULE_SHARING_ENV_KEY));
}

export class ScheduleSharingDisabledError extends Error {
    readonly code = "SCHEDULE_SHARING_DISABLED";

    constructor() {
        super("현재 버전에서는 일정 공유 기능을 사용할 수 없습니다.");
        this.name = "ScheduleSharingDisabledError";
    }
}

export function assertScheduleSharingEnabled(): void {
    if (!isScheduleSharingEnabled()) {
        throw new ScheduleSharingDisabledError();
    }
}

function isNonOwnerPermission(
    permission: ScheduleSharePermission | null | undefined,
): boolean {
    return permission === "VIEWER"
        || permission === "COMMENTER"
        || permission === "EDITOR";
}

function resolvePolicyMemberId(
    explicitMemberId?: number | null,
): number | null | undefined {
    return explicitMemberId !== undefined
        ? explicitMemberId
        : getScheduleSharingSessionOwnerId();
}

export function isScheduleCategoryAllowedBySharingPolicy(
    category: ScheduleCategory,
    currentMemberId?: number | null,
): boolean {
    if (isScheduleSharingEnabled()) return true;
    const policyMemberId = resolvePolicyMemberId(currentMemberId);
    if (isNonOwnerPermission(category.sharePermission)) return false;
    if (
        category.shared === true
        && category.sharePermission !== "OWNER"
    ) return false;
    if (
        typeof category.ownerMemberId === "number"
        && category.ownerMemberId !== policyMemberId
    ) return false;
    return true;
}

export function isScheduleItemAllowedBySharingPolicy(
    item: ScheduleItem,
    currentMemberId?: number | null,
): boolean {
    if (isScheduleSharingEnabled()) return true;
    const policyMemberId = resolvePolicyMemberId(currentMemberId);
    if (isNonOwnerPermission(item.sharePermission)) return false;
    if (
        typeof item.ownerMemberId === "number"
        && item.ownerMemberId !== policyMemberId
    ) return false;
    return isScheduleCategoryAllowedBySharingPolicy(
        item.category,
        policyMemberId,
    );
}

export function sanitizeScheduleItemForSharingPolicy(
    item: ScheduleItem,
    currentMemberId?: number | null,
): ScheduleItem | undefined {
    if (!isScheduleItemAllowedBySharingPolicy(item, currentMemberId)) {
        return undefined;
    }
    if (isScheduleSharingEnabled()) return item;

    // Owners keep their personal schedule, but dormant collaborator state must
    // not resurrect participant UI or cross-user actions from a warm cache.
    return {
        ...item,
        departureParticipants: undefined,
        travelPlanParticipants: undefined,
        canViewAllTravelPlans: false,
    };
}

export function filterScheduleItemsForSharingPolicy(
    items: readonly ScheduleItem[],
    currentMemberId?: number | null,
): ScheduleItem[] {
    if (isScheduleSharingEnabled()) return [...items];
    return items.flatMap((item) => {
        const sanitized = sanitizeScheduleItemForSharingPolicy(
            item,
            currentMemberId,
        );
        return sanitized ? [sanitized] : [];
    });
}

export function filterScheduleCategoriesForSharingPolicy<
    T extends ScheduleCategory,
>(
    categories: readonly T[],
    currentMemberId?: number | null,
): T[] {
    if (isScheduleSharingEnabled()) return [...categories];
    return categories.filter((category) =>
        isScheduleCategoryAllowedBySharingPolicy(
            category,
            currentMemberId,
        )
    );
}

function normalizedNotificationType(data: NotificationData): string | undefined {
    const rawType = data?.type;
    if (typeof rawType !== "string") return undefined;
    const normalized = rawType.trim();
    return normalized || undefined;
}

function normalizedNotificationTypeValue(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    return normalized || undefined;
}

function positiveInteger(value: unknown): number | undefined {
    const normalized = typeof value === "number"
        ? value
        : typeof value === "string" && /^\d+$/.test(value.trim())
            ? Number(value.trim())
            : Number.NaN;
    return Number.isSafeInteger(normalized) && normalized > 0
        ? normalized
        : undefined;
}

export function isScheduleSharingNotificationData(
    data: NotificationData,
): boolean {
    const type = normalizedNotificationType(data);
    if (type && SHARING_NOTIFICATION_TYPES.has(type)) return true;

    const resourceType = typeof data?.resourceType === "string"
        ? data.resourceType.trim()
        : undefined;
    if (
        resourceType === "CATEGORY"
        || resourceType === "CALENDAR"
    ) return true;

    if (
        data?.sharingRelated === true
        || data?.sharingRelated === "true"
        || data?.shared === true
        || data?.shared === "true"
        || isNonOwnerPermission(
            typeof data?.sharePermission === "string"
                ? data.sharePermission as ScheduleSharePermission
                : undefined,
        )
    ) return true;

    const ownerMemberId = positiveInteger(data?.ownerMemberId);
    const recipientMemberId = positiveInteger(data?.recipientMemberId);
    return ownerMemberId !== undefined
        && recipientMemberId !== undefined
        && ownerMemberId !== recipientMemberId;
}

export function isScheduleNotificationAllowedBySharingPolicy(
    data: NotificationData,
): boolean {
    if (isScheduleSharingEnabled()) return true;
    if (isScheduleSharingNotificationData(data)) return false;

    const type = normalizedNotificationType(data);
    if (!type) return false;
    if (PASSIVE_NOTIFICATION_TYPES.has(type)) return true;
    if (!OWNER_SCHEDULE_NOTIFICATION_TYPES.has(type)) return false;

    // Old OS notifications can outlive the rollout. A schedule type alone
    // cannot distinguish an owner's row from a received row, so new owner
    // payloads must prove owner == recipient before presentation or mutation.
    const ownerMemberId = positiveInteger(data?.ownerMemberId);
    const recipientMemberId = positiveInteger(data?.recipientMemberId);
    return ownerMemberId !== undefined
        && ownerMemberId === recipientMemberId;
}

export function isStoredNotificationAllowedBySharingPolicy(
    notification: StoredNotificationLike,
): boolean {
    if (isScheduleSharingEnabled()) return true;
    const topLevelType = normalizedNotificationTypeValue(notification.type);
    if (!topLevelType) return false;

    const rawDataType = notification.data?.type;
    if (rawDataType !== undefined) {
        const dataType = normalizedNotificationTypeValue(rawDataType);
        // A stale or malformed inner type must not disguise a sharing row.
        if (!dataType || dataType !== topLevelType) return false;
    }

    return isScheduleNotificationAllowedBySharingPolicy({
        ...notification.data,
        type: topLevelType,
    });
}

export function filterStoredNotificationsForSharingPolicy<
    T extends StoredNotificationLike,
>(notifications: readonly T[]): T[] {
    if (isScheduleSharingEnabled()) return [...notifications];
    return notifications.filter(isStoredNotificationAllowedBySharingPolicy);
}

export function isScheduleSharingRouteSegments(
    segments: readonly string[],
): boolean {
    return segments[0] === "share"
        || (segments[0] === "schedule" && segments[1] === "calendars");
}

export type ScheduleSharingRouteRedirect =
    | "/auth/login"
    | "/onboarding/calendar-import"
    | "/schedule";

export function getScheduleSharingRouteRedirect(options: {
    segments: readonly string[];
    isAuthenticated: boolean;
    isCurationCompleted: boolean;
}): ScheduleSharingRouteRedirect | undefined {
    if (
        isScheduleSharingEnabled()
        || !isScheduleSharingRouteSegments(options.segments)
    ) return undefined;
    if (!options.isAuthenticated) return "/auth/login";
    return options.isCurationCompleted
        ? "/schedule"
        : "/onboarding/calendar-import";
}

export function retainScheduleShareTokenForEnabledPolicy(
    token: string | null,
): string | null {
    return isScheduleSharingEnabled() ? token : null;
}
