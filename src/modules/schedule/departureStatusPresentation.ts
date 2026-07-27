import type {
    ScheduleDepartureStatus,
    ScheduleDepartureStatusConfidence,
    ScheduleDepartureStatusSource,
} from "../../api/schedule";

const SECOND_MS = 1_000;
const DAY_MS = 24 * 60 * 60 * SECOND_MS;
const IMMINENT_THRESHOLD_MS = 10 * 60 * SECOND_MS;
const POINT_EVENT_ACTIVE_WINDOW_MS = 60 * 60 * SECOND_MS;
const STATUS_MAX_AGE_MS = 15 * 60 * SECOND_MS;
const LIVE_MAX_AGE_MS = 10 * 60 * SECOND_MS;

export type DepartureLifecyclePhase =
    | "upcoming"
    | "imminent"
    | "past"
    | "ended"
    | "missing";

export type DepartureLifecyclePresentation = {
    phase: DepartureLifecyclePhase;
    label: string;
    value: string;
    detail: string;
};

export type DepartureStatusMetadataPresentation = {
    sourceLabel: string;
    sourceDetail: string;
    confidenceLabel: string;
    freshnessLabel: string;
    freshnessTone: "fresh" | "stale" | "unknown";
    etaLabel: string;
    evaluatedLabel?: string;
    liveFetchedLabel?: string;
    trafficChangeLabel?: string;
    failureLabel?: string;
    preparationLabel?: string;
    nextCheckLabel?: string;
};

function parseTime(value?: string | null): number | undefined {
    if (!value) return undefined;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

const pad2 = (value: number) => String(value).padStart(2, "0");

function formatCountdown(milliseconds: number): string {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / SECOND_MS));
    const days = Math.floor(totalSeconds / 86_400);
    const hours = Math.floor((totalSeconds % 86_400) / 3_600);
    const totalHours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;

    return days > 0
        ? `${days}일 ${pad2(hours)}:${pad2(minutes)}`
        : `${pad2(totalHours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

export function formatDepartureStatusClock(
    value?: string | null,
    timeZone?: string | null,
): string | undefined {
    const timestamp = parseTime(value);
    if (timestamp === undefined) return undefined;

    if (timeZone) {
        try {
            return new Intl.DateTimeFormat("en-GB", {
                timeZone,
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23",
            }).format(new Date(timestamp));
        } catch {
            // Invalid/unsupported IANA zones fall back to the device clock below.
        }
    }

    const date = new Date(timestamp);
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function getDepartureLifecyclePresentation(options: {
    recommendedDepartureAt?: string | null;
    scheduleStartAt: string;
    scheduleEndAt: string;
    scheduleHasEndTime: boolean;
    scheduleAllDay?: boolean;
    departedAt?: string | null;
    timeZone?: string | null;
    nowMs: number;
}): DepartureLifecyclePresentation {
    const {
        recommendedDepartureAt,
        scheduleStartAt,
        scheduleEndAt,
        scheduleHasEndTime,
        scheduleAllDay,
        departedAt,
        timeZone,
        nowMs,
    } = options;
    const scheduleStartMs = parseTime(scheduleStartAt);
    const rawScheduleEndMs = parseTime(scheduleEndAt);
    let lifecycleEndMs: number | undefined;

    if (scheduleAllDay && scheduleStartMs !== undefined) {
        if (rawScheduleEndMs !== undefined && rawScheduleEndMs > scheduleStartMs) {
            lifecycleEndMs = rawScheduleEndMs;
        } else {
            // Legacy all-day rows stored identical start/end midnights. The
            // schedule carries no IANA zone, so use the encoded midnight plus one
            // calendar-day window instead of the device zone's midnight.
            lifecycleEndMs = scheduleStartMs + DAY_MS;
        }
    } else if (scheduleHasEndTime) {
        lifecycleEndMs = rawScheduleEndMs ?? scheduleStartMs;
    } else {
        // Point-in-time events have no explicit duration. Keep the departure action
        // useful through a short attendance window, then retire it deterministically.
        lifecycleEndMs = scheduleStartMs === undefined
            ? undefined
            : scheduleStartMs + POINT_EVENT_ACTIVE_WINDOW_MS;
    }

    if (lifecycleEndMs !== undefined && nowMs >= lifecycleEndMs) {
        return {
            phase: "ended",
            label: "일정 상태",
            value: "종료",
            detail: "종료된 일정이에요",
        };
    }

    if (departedAt) {
        const departedClock = formatDepartureStatusClock(departedAt, timeZone);
        return {
            phase: "past",
            label: "출발 상태",
            value: "출발 완료",
            detail: departedClock ? `${departedClock}에 출발을 알렸어요` : "출발을 알렸어요",
        };
    }

    const departureMs = parseTime(recommendedDepartureAt);
    if (departureMs === undefined) {
        return {
            phase: "missing",
            label: "추천 출발",
            value: "ETA 없음",
            detail: "추천 출발 시각을 계산하지 못했어요",
        };
    }

    const remainingMs = departureMs - nowMs;
    if (remainingMs <= 0) {
        return {
            phase: "past",
            label: "출발 상태",
            value: "출발 시각 지남",
            detail: "추천 출발 시각이 지났어요",
        };
    }

    if (remainingMs <= IMMINENT_THRESHOLD_MS) {
        return {
            phase: "imminent",
            label: "추천 출발까지",
            value: formatCountdown(remainingMs),
            detail: "곧 출발할 시간이에요",
        };
    }

    return {
        phase: "upcoming",
        label: "추천 출발까지",
        value: formatCountdown(remainingMs),
        detail: `${formatDepartureStatusClock(recommendedDepartureAt, timeZone) ?? "계산된 시각"} 출발 권장`,
    };
}

function sourcePresentation(
    source: ScheduleDepartureStatusSource | null,
    hasLiveFetchedAt: boolean,
): {
    label: string;
    detail: string;
} {
    switch (source) {
        case "LIVE_PROVIDER":
            return hasLiveFetchedAt
                ? {
                    label: "실시간 교통 조회",
                    detail: "교통 제공자의 확인된 ETA를 반영했어요",
                }
                : {
                    label: "실시간 교통 출처",
                    detail: "실시간 확인 시각이 없어 최신 여부를 확인할 수 없어요",
                };
        case "SELECTED_ROUTE":
            return {
                label: "선택한 경로 기준",
                detail: "저장한 경로의 예상 이동 시간을 사용해요",
            };
        case "SAVED_FALLBACK":
            return {
                label: "저장된 예상값",
                detail: "실시간 조회 대신 마지막 저장값을 사용해요",
            };
        default:
            return {
                label: "출처 확인 불가",
                detail: "서버가 ETA 출처를 제공하지 않았어요",
            };
    }
}

function confidenceLabel(confidence: ScheduleDepartureStatusConfidence | null): string {
    switch (confidence) {
        case "HIGH": return "신뢰도 높음";
        case "MEDIUM": return "신뢰도 보통";
        case "LOW": return "신뢰도 낮음";
        default: return "신뢰도 정보 없음";
    }
}

function formatTrafficChange(change: number | null): string | undefined {
    if (change === null) return undefined;
    if (change > 0) return `교통 변화로 ETA가 ${change}분 늘었어요`;
    if (change < 0) return `교통 변화로 ETA가 ${Math.abs(change)}분 줄었어요`;
    return "직전 확인 이후 ETA 변화가 없어요";
}

export function getDepartureStatusMetadataPresentation(
    status: ScheduleDepartureStatus,
    options: { nowMs?: number; refreshing?: boolean } = {},
): DepartureStatusMetadataPresentation {
    const evaluatedClock = formatDepartureStatusClock(status.evaluatedAt, status.timeZone);
    const liveFetchedClock = formatDepartureStatusClock(status.liveFetchedAt, status.timeZone);
    const lastChangedClock = formatDepartureStatusClock(status.lastChangedAt, status.timeZone);
    const preparationClock = formatDepartureStatusClock(status.preparationStartAt, status.timeZone);
    const nextCheckClock = formatDepartureStatusClock(status.nextCheckAt, status.timeZone);
    const source = sourcePresentation(status.source, liveFetchedClock !== undefined);
    const evaluatedMs = parseTime(status.evaluatedAt);
    const liveFetchedMs = parseTime(status.liveFetchedAt);
    const nextCheckMs = parseTime(status.nextCheckAt);
    const ageChecked = options.nowMs !== undefined;
    const temporallyStale = ageChecked && (
        (evaluatedMs !== undefined && options.nowMs! - evaluatedMs > STATUS_MAX_AGE_MS) ||
        (nextCheckMs !== undefined && options.nowMs! >= nextCheckMs) ||
        (status.source === "LIVE_PROVIDER" &&
            liveFetchedMs !== undefined &&
            options.nowMs! - liveFetchedMs > LIVE_MAX_AGE_MS)
    );
    const freshnessUnknown =
        status.stale === null ||
        evaluatedMs === undefined ||
        (status.source === "LIVE_PROVIDER" && liveFetchedClock === undefined);
    const freshnessTone = options.refreshing || status.stale === true || temporallyStale
        ? "stale"
        : freshnessUnknown
            ? "unknown"
            : "fresh";
    const preparationParts = [
        preparationClock ? `${preparationClock} 준비 시작` : undefined,
        status.preparationMinutes !== null ? `준비 ${status.preparationMinutes}분` : undefined,
        status.safetyBufferMinutes !== null ? `여유 ${status.safetyBufferMinutes}분` : undefined,
    ].filter(Boolean);

    return {
        sourceLabel: source.label,
        sourceDetail: status.source === "LIVE_PROVIDER" && status.stale
            ? "마지막으로 확인된 교통 제공자 ETA예요"
            : source.detail,
        confidenceLabel: confidenceLabel(status.confidence),
        freshnessLabel: options.refreshing
            ? "최신 상태 확인 중"
            : freshnessTone === "stale"
            ? "오래된 정보"
            : freshnessTone === "unknown"
                ? "최신 여부 알 수 없음"
                : "최신 상태",
        freshnessTone,
        etaLabel: status.travelMinutes === null
            ? "최신 ETA 없음"
            : `${freshnessTone === "fresh" ? "최신" : freshnessTone === "stale" ? "마지막" : "확인된"} ETA ${Math.max(0, Math.round(status.travelMinutes))}분`,
        evaluatedLabel: evaluatedClock ? `상태 계산 ${evaluatedClock}` : undefined,
        liveFetchedLabel: status.source === "LIVE_PROVIDER" && liveFetchedClock
            ? `${status.stale === true ? "마지막 " : ""}실시간 확인 ${liveFetchedClock}`
            : undefined,
        trafficChangeLabel: formatTrafficChange(status.lastTrafficChangeMinutes)
            ? [
                formatTrafficChange(status.lastTrafficChangeMinutes),
                lastChangedClock ? `${lastChangedClock} 변경` : undefined,
            ].filter(Boolean).join(" · ")
            : undefined,
        failureLabel: status.failureReason
            ? `최신 교통 확인 실패: ${status.failureReason}`
            : undefined,
        preparationLabel: preparationParts.length > 0
            ? preparationParts.join(" · ")
            : undefined,
        nextCheckLabel: nextCheckClock ? `다음 확인 ${nextCheckClock}` : undefined,
    };
}

export function getLegacyDepartureStatusMetadata(
    travelMinutes?: number,
): DepartureStatusMetadataPresentation {
    return {
        sourceLabel: "저장된 일정 기준",
        sourceDetail: "최신 출발 상태 API를 사용할 수 없어 일정 저장값을 사용해요",
        confidenceLabel: "신뢰도 정보 없음",
        freshnessLabel: "실시간 아님",
        freshnessTone: "unknown",
        etaLabel: typeof travelMinutes === "number"
            ? `저장된 ETA ${Math.max(0, Math.round(travelMinutes))}분`
            : "ETA 없음",
    };
}

export function getUnavailableDepartureStatusMetadata(
    travelMinutes?: number,
): DepartureStatusMetadataPresentation {
    return {
        ...getLegacyDepartureStatusMetadata(travelMinutes),
        sourceLabel: "개인 이동 정보 비공개",
        sourceDetail: "이 공유 일정은 참여자별 이동 정보 공유가 꺼져 있어 저장된 일정 정보만 표시해요",
    };
}
