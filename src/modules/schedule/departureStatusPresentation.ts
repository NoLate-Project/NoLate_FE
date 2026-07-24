import type {
    ScheduleDepartureStatus,
    ScheduleDepartureStatusConfidence,
    ScheduleDepartureStatusSource,
} from "../../api/schedule";

const SECOND_MS = 1_000;
const IMMINENT_THRESHOLD_MS = 10 * 60 * SECOND_MS;

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

function formatClock(value?: string | null): string | undefined {
    const timestamp = parseTime(value);
    if (timestamp === undefined) return undefined;
    const date = new Date(timestamp);
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function getDepartureLifecyclePresentation(options: {
    recommendedDepartureAt?: string | null;
    scheduleEndAt: string;
    scheduleHasEndTime: boolean;
    scheduleAllDay?: boolean;
    departedAt?: string | null;
    nowMs: number;
}): DepartureLifecyclePresentation {
    const {
        recommendedDepartureAt,
        scheduleEndAt,
        scheduleHasEndTime,
        scheduleAllDay,
        departedAt,
        nowMs,
    } = options;
    const scheduleEndMs = parseTime(scheduleEndAt);
    const hasReliableEnd = scheduleAllDay || scheduleHasEndTime;

    if (hasReliableEnd && scheduleEndMs !== undefined && nowMs >= scheduleEndMs) {
        return {
            phase: "ended",
            label: "일정 상태",
            value: "종료",
            detail: "종료된 일정이에요",
        };
    }

    if (departedAt) {
        const departedClock = formatClock(departedAt);
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
        detail: `${formatClock(recommendedDepartureAt) ?? "계산된 시각"} 출발 권장`,
    };
}

function sourcePresentation(source: ScheduleDepartureStatusSource | null): {
    label: string;
    detail: string;
} {
    switch (source) {
        case "LIVE_PROVIDER":
            return {
                label: "실시간 교통 조회",
                detail: "교통 제공자의 최신 ETA를 반영했어요",
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
): DepartureStatusMetadataPresentation {
    const source = sourcePresentation(status.source);
    const evaluatedClock = formatClock(status.evaluatedAt);
    const liveFetchedClock = formatClock(status.liveFetchedAt);
    const lastChangedClock = formatClock(status.lastChangedAt);
    const preparationClock = formatClock(status.preparationStartAt);
    const nextCheckClock = formatClock(status.nextCheckAt);
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
        freshnessLabel: status.stale ? "오래된 정보" : "최신 상태",
        etaLabel: status.travelMinutes === null
            ? "최신 ETA 없음"
            : `최신 ETA ${Math.max(0, Math.round(status.travelMinutes))}분`,
        evaluatedLabel: evaluatedClock ? `상태 계산 ${evaluatedClock}` : undefined,
        liveFetchedLabel: status.source === "LIVE_PROVIDER" && liveFetchedClock
            ? `${status.stale ? "마지막 " : ""}실시간 확인 ${liveFetchedClock}`
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
        etaLabel: typeof travelMinutes === "number"
            ? `저장된 ETA ${Math.max(0, Math.round(travelMinutes))}분`
            : "ETA 없음",
    };
}
