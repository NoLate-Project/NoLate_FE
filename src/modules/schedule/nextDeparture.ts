import type { ScheduleDepartureStatus } from "../../api/schedule";
import type { ScheduleItem } from "./types";

export const NEXT_DEPARTURE_SOON_MINUTES = 15;
export const NEXT_DEPARTURE_STATUS_MAX_AGE_MS = 5 * 60_000;

export type NextDeparturePhase =
    | "BEFORE"
    | "SOON"
    | "DUE"
    | "PAST"
    | "ENDED"
    | "NO_ETA";

export type NextDepartureCandidate = {
    item: ScheduleItem;
    departureStatus?: ScheduleDepartureStatus;
    recommendationFromStatus: boolean;
    recommendedDepartureAt: Date | null;
    travelMinutes: number | null;
    destinationLabel: string;
    timeZone: string | null;
};

export type NextDepartureHeroModel = NextDepartureCandidate & {
    phase: NextDeparturePhase;
    departureClockLabel: string;
    remainingLabel: string;
    travelLabel: string;
    etaLabel: string;
    trafficChangeLabel: string | null;
    accessibilityLabel: string;
};

function parseDate(value?: string | Date | null): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

function nonNegativeMinutes(value?: number | null): number | null {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? Math.round(value)
        : null;
}

function getSavedTravelMinutes(item: ScheduleItem): number | null {
    return nonNegativeMinutes(item.myTravelPlan?.travelMinutes)
        ?? nonNegativeMinutes(item.travelMinutes);
}

function getSavedDepartureAt(item: ScheduleItem): Date | null {
    const savedDeparture = parseDate(item.myTravelPlan?.departAt)
        ?? parseDate(item.departAt);
    if (savedDeparture) return savedDeparture;

    const startAt = parseDate(item.startAt);
    const travelMinutes = getSavedTravelMinutes(item);
    if (!startAt || travelMinutes === null) return null;
    return new Date(startAt.getTime() - travelMinutes * 60_000);
}

function getDestinationLabel(item: ScheduleItem): string {
    return item.destination?.name?.trim()
        || item.locationName?.trim()
        || item.destination?.address?.trim()
        || "목적지 미지정";
}

export function hasCurrentMemberDeparted(
    item: ScheduleItem,
    currentMemberId?: number
): boolean {
    if (item.myDepartedAt) return true;
    if (!Number.isSafeInteger(currentMemberId) || (currentMemberId ?? 0) <= 0) {
        return false;
    }

    const currentParticipant = item.departureParticipants?.find(
        (participant) => participant.memberId === currentMemberId
    );
    if (currentParticipant?.departed) return true;

    return item.ownerMemberId === currentMemberId && Boolean(item.departedAt);
}

function isDepartureEligible(
    item: ScheduleItem,
    nowMs: number,
    currentMemberId?: number
): boolean {
    return (
        item.allDay !== true
        && item.travelCollaborationEnabled !== false
        && !hasCurrentMemberDeparted(item, currentMemberId)
        && Boolean(parseDate(item.startAt))
        && (parseDate(item.endAt)?.getTime() ?? Number.NEGATIVE_INFINITY) > nowMs
    );
}

function hasDepartureMeaning(candidate: NextDepartureCandidate): boolean {
    const { item } = candidate;
    return Boolean(
        candidate.recommendedDepartureAt
        || candidate.travelMinutes !== null
        || item.route
        || item.myTravelPlan?.route
        || item.myTravelPlan?.status === "READY"
        || item.myTravelPlan?.status === "STALE"
        || item.routeSetupRequired
        || item.notificationEnabled
    );
}

export function buildNextDepartureCandidate(
    item: ScheduleItem,
    departureStatus?: ScheduleDepartureStatus
): NextDepartureCandidate {
    const statusMatchesItem = departureStatus?.scheduleId === item.id;
    const matchedStatus = statusMatchesItem ? departureStatus : undefined;
    const statusRecommendation = parseDate(matchedStatus?.recommendedDepartureAt);
    const recommendedDepartureAt = statusRecommendation ?? getSavedDepartureAt(item);
    const travelMinutes = nonNegativeMinutes(matchedStatus?.travelMinutes)
        ?? getSavedTravelMinutes(item);

    return {
        item,
        departureStatus: matchedStatus,
        recommendationFromStatus: statusRecommendation !== null,
        recommendedDepartureAt,
        travelMinutes,
        destinationLabel: getDestinationLabel(item),
        timeZone: matchedStatus?.timeZone ?? null,
    };
}

/**
 * 홈의 다음 출발은 완료·종료 일정을 제외한다. 추천 출발 시각이 지난 일정도
 * 아직 끝나지 않았다면 가장 급한 항목이므로 이후 일정보다 먼저 유지한다.
 */
export function rankNextDepartures(
    items: ScheduleItem[],
    statusesByScheduleId: Readonly<Record<string, ScheduleDepartureStatus | undefined>>,
    now: Date,
    currentMemberId?: number
): NextDepartureCandidate[] {
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) return [];

    const candidates = items
        .filter((item) => isDepartureEligible(item, nowMs, currentMemberId))
        .map((item) => buildNextDepartureCandidate(item, statusesByScheduleId[item.id]))
        .filter(hasDepartureMeaning);

    candidates.sort((left, right) => {
        const leftStart = parseDate(left.item.startAt)?.getTime() ?? Number.POSITIVE_INFINITY;
        const rightStart = parseDate(right.item.startAt)?.getTime() ?? Number.POSITIVE_INFINITY;
        const leftAnchor = left.recommendedDepartureAt?.getTime() ?? leftStart;
        const rightAnchor = right.recommendedDepartureAt?.getTime() ?? rightStart;

        return leftAnchor - rightAnchor
            || leftStart - rightStart
            || left.item.id.localeCompare(right.item.id);
    });

    return candidates;
}

export function selectNextDeparture(
    items: ScheduleItem[],
    statusesByScheduleId: Readonly<Record<string, ScheduleDepartureStatus | undefined>>,
    now: Date,
    currentMemberId?: number
): NextDepartureCandidate | null {
    return rankNextDepartures(
        items,
        statusesByScheduleId,
        now,
        currentMemberId
    )[0] ?? null;
}

export function getDepartureVerificationItems(
    items: ScheduleItem[],
    now: Date,
    currentMemberId?: number
): ScheduleItem[] {
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) return [];
    return items.filter((item) => isDepartureEligible(item, nowMs, currentMemberId));
}

function formatKoreanClock(date: Date, timeZone: string | null): string {
    try {
        return new Intl.DateTimeFormat("ko-KR", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
            ...(timeZone ? { timeZone } : {}),
        }).format(date);
    } catch {
        return new Intl.DateTimeFormat("ko-KR", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        }).format(date);
    }
}

function formatDuration(minutes: number): string {
    const absoluteMinutes = Math.max(0, Math.round(minutes));
    const hours = Math.floor(absoluteMinutes / 60);
    const remainder = absoluteMinutes % 60;
    if (hours === 0) return `${remainder}분`;
    if (remainder === 0) return `${hours}시간`;
    return `${hours}시간 ${remainder}분`;
}

function getPhase(candidate: NextDepartureCandidate, now: Date): NextDeparturePhase {
    const endAt = parseDate(candidate.item.endAt);
    if (endAt && endAt.getTime() <= now.getTime()) return "ENDED";
    if (!candidate.recommendedDepartureAt) return "NO_ETA";

    const differenceMinutes = (
        candidate.recommendedDepartureAt.getTime() - now.getTime()
    ) / 60_000;
    if (differenceMinutes < -1) return "PAST";
    if (differenceMinutes <= 1) return "DUE";
    if (differenceMinutes <= NEXT_DEPARTURE_SOON_MINUTES) return "SOON";
    return "BEFORE";
}

function getRemainingLabel(
    phase: NextDeparturePhase,
    candidate: NextDepartureCandidate,
    now: Date
): string {
    if (phase === "ENDED") return "일정이 종료됐어요";
    if (phase === "NO_ETA") return "추천 출발 시각을 확인할 수 없어요";
    if (phase === "DUE") return "지금 출발할 시간이에요";

    const departureAt = candidate.recommendedDepartureAt;
    if (!departureAt) return "추천 출발 시각을 확인할 수 없어요";
    const differenceMinutes = (departureAt.getTime() - now.getTime()) / 60_000;

    if (phase === "PAST") {
        return `추천 출발 시각이 ${formatDuration(Math.ceil(Math.abs(differenceMinutes)))} 지났어요`;
    }

    const remaining = formatDuration(Math.max(1, Math.ceil(differenceMinutes)));
    return phase === "SOON"
        ? `곧 출발 · ${remaining} 남음`
        : `출발까지 ${remaining}`;
}

function getEtaLabel(
    candidate: NextDepartureCandidate,
    phase: NextDeparturePhase,
    connectionIssue: "offline" | "error" | null,
    now: Date
): string {
    if (connectionIssue === "offline") return "오프라인 · 저장된 정보";
    if (connectionIssue === "error") return "업데이트 실패 · 저장된 정보";
    if (phase === "NO_ETA") return "ETA 없음";

    const status = candidate.departureStatus;
    if (!candidate.recommendationFromStatus) return "저장된 ETA";
    if (!status || !isDepartureStatusFresh(status, now)) {
        return "업데이트 지연";
    }
    if (status.source === "LIVE_PROVIDER") return "실시간 ETA";
    if (status.source === "SELECTED_ROUTE") return "선택 경로 ETA";
    return "저장된 ETA";
}

export function getDepartureStatusRefreshAt(
    status: ScheduleDepartureStatus,
    now: Date
): number {
    const nowMs = now.getTime();
    const nextCheckAt = parseDate(status.nextCheckAt)?.getTime();
    const freshnessReference = (
        parseDate(status.liveFetchedAt)
        ?? parseDate(status.evaluatedAt)
    )?.getTime();
    const refreshTargets = [
        nextCheckAt,
        freshnessReference === undefined
            ? undefined
            : freshnessReference + NEXT_DEPARTURE_STATUS_MAX_AGE_MS,
    ].filter((value): value is number => (
        typeof value === "number" && Number.isFinite(value)
    ));

    return refreshTargets.length > 0
        ? Math.min(...refreshTargets)
        : nowMs + NEXT_DEPARTURE_STATUS_MAX_AGE_MS;
}

export function isDepartureStatusFresh(
    status: ScheduleDepartureStatus,
    now: Date
): boolean {
    if (status.stale) return false;
    if (status.source === "LIVE_PROVIDER" && status.failureReason) return false;
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) return false;

    const nextCheckAt = parseDate(status.nextCheckAt);
    if (nextCheckAt && nextCheckAt.getTime() <= nowMs) return false;

    const freshnessReference = parseDate(status.liveFetchedAt)
        ?? parseDate(status.evaluatedAt);
    if (!freshnessReference) return status.source !== "LIVE_PROVIDER";
    return nowMs - freshnessReference.getTime() <= NEXT_DEPARTURE_STATUS_MAX_AGE_MS;
}

function getTrafficChangeLabel(candidate: NextDepartureCandidate): string | null {
    const change = candidate.departureStatus?.lastTrafficChangeMinutes;
    if (typeof change !== "number" || !Number.isFinite(change) || change === 0) return null;
    return change > 0
        ? `교통 반영 +${Math.round(change)}분`
        : `교통 반영 ${Math.round(change)}분`;
}

export function buildNextDepartureHeroModel(
    candidate: NextDepartureCandidate,
    now: Date,
    connectionIssue: "offline" | "error" | null = null
): NextDepartureHeroModel {
    const phase = getPhase(candidate, now);
    const departureClockLabel = candidate.recommendedDepartureAt
        ? formatKoreanClock(candidate.recommendedDepartureAt, candidate.timeZone)
        : "ETA 없음";
    const remainingLabel = getRemainingLabel(phase, candidate, now);
    const travelLabel = candidate.travelMinutes === null
        ? "이동시간 없음"
        : `이동 ${formatDuration(candidate.travelMinutes)}`;
    const etaLabel = getEtaLabel(candidate, phase, connectionIssue, now);
    const trafficChangeLabel = getTrafficChangeLabel(candidate);
    const confidenceLabel = candidate.departureStatus?.confidence === "LOW"
        ? "참고용"
        : null;
    const accessibilityLabel = [
        "다음 출발",
        candidate.item.title,
        candidate.destinationLabel,
        candidate.recommendedDepartureAt
            ? `추천 출발 ${departureClockLabel}`
            : "추천 출발 시각 없음",
        remainingLabel,
        travelLabel,
        etaLabel,
        trafficChangeLabel,
        confidenceLabel,
    ].filter(Boolean).join(", ");

    return {
        ...candidate,
        phase,
        departureClockLabel,
        remainingLabel,
        travelLabel,
        etaLabel,
        trafficChangeLabel,
        accessibilityLabel,
    };
}
