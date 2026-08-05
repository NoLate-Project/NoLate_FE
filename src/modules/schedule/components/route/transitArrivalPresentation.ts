import type { TransitArrivalInfo } from "../../../../api/transitArrivals";

export type TransitArrivalLoadState = "loading" | "ready" | "empty" | "error";

export type TransitArrivalPresentation = {
    statusLabel: string;
    freshnessLabel?: string;
    inlineMessage?: string;
    showArrivalCard: boolean;
    showLoadingIcon: boolean;
};

const STALE_ARRIVAL_AGE_MS = 90_000;

export function getTransitArrivalAttributeLabels(
    arrival: Pick<TransitArrivalInfo, "express" | "lowFloor" | "lastTrain">
): string[] {
    return [
        arrival.express ? "급행" : undefined,
        arrival.lowFloor ? "저상" : undefined,
        arrival.lastTrain ? "막차" : undefined,
    ].filter((label): label is string => !!label);
}

export function getTransitArrivalInlineMessage(
    presentation: TransitArrivalPresentation,
    scheduledClock?: string,
    scheduleSourceLabel = "시간표"
): string | undefined {
    if (!scheduledClock || presentation.showArrivalCard || presentation.showLoadingIcon) {
        return presentation.inlineMessage;
    }
    return `${scheduleSourceLabel} 기준 · ${scheduledClock} 승차 예정`;
}

export function getTransitArrivalStatusLabel(
    presentation: TransitArrivalPresentation,
    scheduledClock?: string
): string {
    if (
        scheduledClock &&
        !presentation.showArrivalCard &&
        !presentation.showLoadingIcon
    ) {
        return `${scheduledClock} 예정`;
    }
    return presentation.statusLabel;
}

export function getTransitArrivalFreshness(
    updatedAt?: string,
    nowMs = Date.now()
): { label?: string; stale: boolean } {
    if (!updatedAt) return { stale: false };
    const updatedMs = new Date(updatedAt).getTime();
    if (!Number.isFinite(updatedMs)) return { stale: false };

    const ageMs = Math.max(0, nowMs - updatedMs);
    if (ageMs < 60_000) return { label: "방금 갱신", stale: false };
    const minutes = Math.max(1, Math.floor(ageMs / 60_000));
    return {
        label: `${minutes}분 전 갱신`,
        stale: ageMs > STALE_ARRIVAL_AGE_MS,
    };
}

export function getTransitArrivalPresentation({
    hasRequest,
    loadState,
    arrivalCount,
    updatedAt,
    nowMs,
}: {
    hasRequest: boolean;
    loadState?: TransitArrivalLoadState;
    arrivalCount: number;
    updatedAt?: string;
    nowMs?: number;
}): TransitArrivalPresentation {
    const freshness = getTransitArrivalFreshness(updatedAt, nowMs);
    if (arrivalCount > 0) {
        return {
            statusLabel: loadState === "error" || freshness.stale ? "갱신 지연" : "실시간",
            ...(freshness.label ? { freshnessLabel: freshness.label } : {}),
            showArrivalCard: true,
            showLoadingIcon: false,
        };
    }

    if (!hasRequest) {
        return {
            statusLabel: "미지원",
            inlineMessage: "이 승차 지점에서는 실시간 도착 정보를 확인할 수 없어요.",
            showArrivalCard: false,
            showLoadingIcon: false,
        };
    }

    if (!loadState || loadState === "loading") {
        return {
            statusLabel: "확인 중",
            inlineMessage: "실시간 도착 정보를 확인하고 있어요.",
            showArrivalCard: false,
            showLoadingIcon: true,
        };
    }

    if (loadState === "error") {
        return {
            statusLabel: "일시 오류",
            inlineMessage: "실시간 도착 정보를 불러오지 못했어요.",
            showArrivalCard: false,
            showLoadingIcon: false,
        };
    }

    return {
        statusLabel: "정보 없음",
        inlineMessage: "지금 확인할 수 있는 도착 예정이 없어요.",
        showArrivalCard: false,
        showLoadingIcon: false,
    };
}
