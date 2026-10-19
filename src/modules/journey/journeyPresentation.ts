import { findNextRideLegIndex, getJourneyLeg } from "./journeyRoute";
import type { JourneyPhase, JourneyProgress, NormalizedJourneyLeg, NormalizedJourneyRoute } from "./types";

function clean(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}

function rideName(leg: NormalizedJourneyLeg): string {
    return clean(leg.detail.lineName)
        ?? clean(leg.detail.label)
        ?? (leg.detail.kind === "SUBWAY" ? "지하철" : "버스");
}

function rideDirection(leg: NormalizedJourneyLeg): string {
    const direction = clean(leg.detail.directionName);
    return direction ? ` ${direction}` : "";
}

function followingRide(
    route: NormalizedJourneyRoute,
    activeLegIndex: number,
): NormalizedJourneyLeg | undefined {
    const nextRideIndex = findNextRideLegIndex(route, activeLegIndex - 1);
    return nextRideIndex === null ? undefined : getJourneyLeg(route, nextRideIndex);
}

export function buildJourneyNextInstruction(
    phase: JourneyPhase,
    route: NormalizedJourneyRoute,
    activeLegIndex: number,
): string {
    const activeLeg = getJourneyLeg(route, activeLegIndex);
    if (!activeLeg) return "경로 정보를 다시 확인해 주세요.";

    switch (phase) {
        case "READY":
            return "길안내를 시작하세요.";
        case "WALKING_TO_STOP": {
            const nextRide = followingRide(route, activeLegIndex);
            const destination = clean(activeLeg.detail.endName)
                ?? clean(nextRide?.detail.startName)
                ?? "승차 지점";
            return `${destination}까지 이동하세요.`;
        }
        case "WAITING": {
            const start = clean(activeLeg.detail.startName) ?? "승차 지점";
            const platform = clean(activeLeg.detail.boardingPlatform)
                ?? clean(activeLeg.detail.recommendedBoardingPosition);
            const platformText = platform ? ` ${platform}에서` : "에서";
            return `${start}${platformText} ${rideName(activeLeg)}${rideDirection(activeLeg)} 탑승을 기다리세요.`;
        }
        case "RIDING": {
            const destination = clean(activeLeg.detail.endName) ?? "하차 지점";
            return `${destination}에서 하차할 준비를 하세요.`;
        }
        case "ALIGHTING": {
            const destination = clean(activeLeg.detail.endName) ?? "다음 하차 지점";
            const transferPosition = clean(activeLeg.detail.recommendedTransferPosition);
            const positionText = transferPosition ? ` ${transferPosition} 위치에서` : "에서";
            return `${destination}${positionText} 하차하세요.`;
        }
        case "TRANSFERRING": {
            if (activeLeg.isRide) {
                const start = clean(activeLeg.detail.startName) ?? "환승 승차 지점";
                return `${start}에서 ${rideName(activeLeg)}${rideDirection(activeLeg)} 환승을 준비하세요.`;
            }
            const nextRide = followingRide(route, activeLegIndex);
            const destination = clean(nextRide?.detail.startName)
                ?? clean(activeLeg.detail.endName)
                ?? "환승 승차 지점";
            return `${destination}까지 환승 이동하세요.`;
        }
        case "FINAL_WALK": {
            const destination = clean(activeLeg.detail.endName) ?? "목적지";
            return `${destination}까지 걸어가세요.`;
        }
        case "ARRIVED":
            return "목적지에 도착했습니다.";
        case "STOPPED":
            return "길안내를 종료했습니다.";
    }
}

export function calculateJourneyOverallProgress(
    phase: JourneyPhase,
    activeLegIndex: number,
    legCount: number,
): number {
    if (phase === "ARRIVED") return 1;
    if (legCount <= 0) return 0;
    return Math.max(0, Math.min(1, activeLegIndex / legCount));
}

/** Label for the single manual forward action shown by the preview/controller. */
export function getNextManualActionLabel(
    progress: JourneyProgress,
    route: NormalizedJourneyRoute,
): string | null {
    const activeLeg = getJourneyLeg(route, progress.activeLegIndex);
    const nextLeg = getJourneyLeg(route, progress.activeLegIndex + 1);

    switch (progress.phase) {
        case "READY":
            return "길안내 시작";
        case "WALKING_TO_STOP":
            return nextLeg && !nextLeg.isRide ? "다음 도보 구간" : "승차 지점 도착";
        case "WAITING":
            return "탑승했어요";
        case "RIDING":
            return "하차 준비";
        case "ALIGHTING":
            return "하차했어요";
        case "TRANSFERRING":
            if (activeLeg?.isRide || nextLeg?.isRide) return "환승 지점 도착";
            return "다음 환승 구간";
        case "FINAL_WALK":
            return nextLeg ? "다음 도보 구간" : "목적지 도착";
        case "ARRIVED":
        case "STOPPED":
            return null;
    }
}
