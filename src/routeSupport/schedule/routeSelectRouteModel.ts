import { serviceTimeRange } from "../../modules/schedule/intercityTimetableModel";
import { formatTransferBoardingTarget, isTransitRideKind, isIntercityRideKind, transitModeLabel, intercityRideColor } from "../../modules/map/transitModes";
import type { RouteAlternativeOption } from "../../modules/map/routingService";
import {
    formatRouteDuration,
    formatRouteClock,
    getTimetableWalkSeconds,
    roundRouteArrivalMinute,
    getTransitBusLineColor,
    getSubwayLineColor as getSharedSubwayLineColor,
} from "../../modules/schedule/routeInfo";
import {
    getNaverLikeRoutePriority,
    getNaverLikeRouteTransferCount,
    selectNaverLikeRouteAlternatives,
} from "../../modules/schedule/routeAlternativeRanking";
import {
    buildTransitRouteProgressSegments,
    formatTransitWalkingSummary,
    getTransitLegDisplayMinutes,
    getTransitRideLineLabel,
    getTransitRouteWalkingMinutes,
} from "../../modules/schedule/transitRouteProgress";
import {
    formatTransitClockWithDayContext,
    shouldShowTransitDurationOnly,
    TRANSIT_ESTIMATED_DURATION_LABEL,
} from "../../modules/schedule/routePlanner/presentation";
import type { TravelMode } from "../../modules/schedule/types";

export { formatRouteClock };
import {
    resolveSelectedRouteTiming,
    type SelectedRouteTimingInfo,
} from "../../modules/schedule/scheduleRouteTiming";
import {
    ROUTE_SEGMENT_FALLBACK_COLORS,
    type RouteDropdownSummaryItem,
    type RouteDropdownSummaryKind,
    type RouteMetricChip,
    type RouteSelectTransitLeg,
    type TransitRouteFilter,
} from "./RouteSelectAnimatedControls";

/** 미터 단위 거리를 목록에서 읽기 좋은 m 또는 km 문자열로 변환한다. */
export function formatDistance(distanceMeters?: number): string | undefined {
    if (typeof distanceMeters !== "number") return undefined;
    if (distanceMeters >= 1000) return `${(distanceMeters / 1000).toFixed(1)}km`;
    return `${Math.round(distanceMeters)}m`;
}

/** 검색 결과의 거리를 지나치게 세밀하지 않은 사용자용 문자열로 정규화한다. */
export function formatSearchResultDistance(distanceMeters?: number): string | undefined {
    const formatted = formatDistance(distanceMeters);
    return formatted ? `기준점에서 ${formatted}` : undefined;
}

/** 현재 시각 기반 경로 안내에 표시할 출발 시각 문구를 만든다. */
export function formatCurrentRouteNoticeTime(date: Date): string {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
}

/** 일정 시각 기반 경로 안내에 표시할 예정 출발 문구를 만든다. */
export function formatScheduleRouteNoticeTime(date: Date): string {
    return `${date.getMonth() + 1}월 ${date.getDate()}일 ${formatRouteClock(date)}`;
}

type RouteOptionTimingContext = { targetArrivalAt?: string; routeInfo?: SelectedRouteTimingInfo };

/** 모든 후보가 소요 시간 추정치만 제공하면 목록에서 한 번 안내한다. */
export function sharesTransitDurationEstimate(options: readonly RouteAlternativeOption[]): boolean {
    return options.length > 1 && options.every(option =>
        !option.intercityJourney && shouldShowTransitDurationOnly(option)
    );
}

/** 후보별 표시와 저장은 같은 시각 정책을 사용하고 다음 운행 검색의 출발 기준을 보존한다. */
export function resolveRouteOptionTiming(
    option: RouteAlternativeOption,
    departureAt: Date,
    timing: RouteOptionTimingContext = {},
) {
    const nextServiceDeparture = option.mode === "TRANSIT" &&
        option.transitDepartureTimeSource === "next_service_search" && option.transitDepartureAt
        ? new Date(option.transitDepartureAt)
        : undefined;
    const hasNextServiceDeparture = nextServiceDeparture && Number.isFinite(nextServiceDeparture.getTime());
    const routeInfo = timing.routeInfo ?? (option.intercityJourney ? {
        totalDurationSeconds: option.totalDurationSeconds,
        departureTime: option.intercityJourney.departureAt,
        arrivalTime: option.intercityJourney.arrivalAt,
        timeBasis: "anchored_journey" as const,
    } : {
        totalDurationMinutes: option.minutes,
        totalDurationSeconds: option.totalDurationSeconds,
        departureTime: departureAt.toISOString(),
        timeBasis: "estimated" as const,
    });
    return resolveSelectedRouteTiming({
        targetArrivalAt: hasNextServiceDeparture || option.odsayBusPreview ? undefined : timing.targetArrivalAt,
        routeInfo: hasNextServiceDeparture && routeInfo.timeBasis !== "provider_schedule"
            ? { ...routeInfo, departureTime: nextServiceDeparture.toISOString() }
            : routeInfo,
        fallbackDepartureAt: departureAt,
    });
}

// 경로 카드의 출발-도착 시간과 요금을 한 줄로 만든다.
/** 경로의 도착 예상 시각과 요금 중 제공 가능한 정보를 한 줄 보조 문구로 조합한다. */
export function formatRouteTimeFare(
    option: RouteAlternativeOption,
    departureAt: Date,
    timing: RouteOptionTimingContext = {},
    showDurationEstimate = true,
): string | undefined {
    const chunks: string[] = [];
    if (option.intercityJourney) {
        chunks.push(`선택 편 ${option.intercityJourney.service.departureAt.slice(11, 16)} 출발 · ${formatRouteClock(new Date(option.intercityJourney.arrivalAt))} 예상 도착`);
    } else if (option.odsayTimetablePreview) {
        const departure = new Date(option.odsayTimetablePreview.departureAt);
        const arrival = roundRouteArrivalMinute(option.odsayTimetablePreview.arrivalAt);
        const arrivalClock = arrival ? formatTransitClockWithDayContext(arrival, departure) : "";
        chunks.push(`시간표 기준 · ${formatRouteClock(departure)} 출발 · ${arrivalClock} 예상 도착 (목적지)`);
    } else if (option.odsayBusPreview) {
        const departure = new Date(option.odsayBusPreview.departureAt);
        const arrival = new Date(option.odsayBusPreview.arrivalAt);
        chunks.push(`실시간 반영 · ${formatRouteClock(departure)} 출발 · ${formatTransitClockWithDayContext(arrival, departure)} 예상 도착`);
    } else if (shouldShowTransitDurationOnly(option)) {
        if (showDurationEstimate) chunks.push(TRANSIT_ESTIMATED_DURATION_LABEL);
    } else if (option.mode === "TRANSIT" && option.transitServiceState === "not_operating") {
        chunks.push("운행 종료");
    } else if (typeof option.minutes === "number") {
        // 카드와 저장이 같은 후보의 시각을 사용한다. 공통 검색 기준에 다른 후보의
        // 소요시간을 더하면 일정 마감 뒤 도착하는 것처럼 잘못 표시할 수 있다.
        const { arrivalAt } = resolveRouteOptionTiming(option, departureAt, timing);
        chunks.push(`${formatRouteClock(arrivalAt)} 예상 도착`);
    }
    if (typeof option.fareWon === "number") chunks.push(`${option.fareWon.toLocaleString()}원`);
    return chunks.length ? chunks.join(" · ") : undefined;
}

// 대중교통 필터 탭에 표시할 경로 개수를 계산한다.
/** 전체 경로 중 지정한 대중교통 구성 필터에 해당하는 대안 수를 계산한다. */
export function getTransitFilterCount(options: RouteAlternativeOption[], filter: TransitRouteFilter): number {
    return selectNaverLikeRouteAlternatives(options, "TRANSIT", filter).length;
}

/** 이동수단별 추천 정책에 따라 경로 카드의 정렬 우선순위를 계산한다. */
export function getRouteDisplayPriority(option: RouteAlternativeOption, mode: TravelMode): number {
    return getNaverLikeRoutePriority(option, mode);
}

/** 추천 우선순위와 원래 순서를 함께 사용해 경로 대안을 안정적으로 정렬한다. */
export function sortRouteAlternativesForDisplay(
    options: RouteAlternativeOption[],
    mode: TravelMode,
    filter: TransitRouteFilter = "ALL"
): RouteAlternativeOption[] {
    if (mode === "TRANSIT") return selectNaverLikeRouteAlternatives(options, mode, filter);
    return [...options].sort((a, b) => {
        const scoreDiff = getRouteDisplayPriority(a, mode) - getRouteDisplayPriority(b, mode);
        if (scoreDiff !== 0) return scoreDiff;
        return (a.minutes ?? 9999) - (b.minutes ?? 9999);
    }).slice(0, 4);
}

// 지하철 노선명을 기준으로 실제 노선색에 가까운 색을 찾는다.
/** 지하철 노선명에 대응하는 대표 색상을 반환하고 알 수 없는 노선에는 기본색을 사용한다. */
export function getSubwayLineColor(lineName?: string, lineColor?: string): string {
    return getSharedSubwayLineColor(lineName, lineColor);
}

// 대중교통 구간의 노선색을 결정한다.
/** 대중교통 구간 종류와 노선 정보를 바탕으로 진행 막대에 사용할 색상을 선택한다. */
export function getTransitLegColor(leg: RouteSelectTransitLeg): string {
    if (leg.kind === "BUS") return getTransitBusLineColor(leg);
    if (leg.kind === "SUBWAY") return getSubwayLineColor(getTransitRideLineLabel(leg), leg.lineColor);
    const intercityColor = intercityRideColor(leg.kind);
    if (intercityColor) return intercityColor;
    if (leg.kind === "WALK") return ROUTE_SEGMENT_FALLBACK_COLORS.walk;
    return ROUTE_SEGMENT_FALLBACK_COLORS.etc;
}

/** 후보와 저장한 일정에 같은 구간 요약을 사용한다. */
export function buildRouteProgressSegments(option: RouteAlternativeOption) {
    return buildTransitRouteProgressSegments(option.transitLegs);
}

/** 구간이 실제 차량 탑승 구간인지 판별해 도보·환승 표현과 구분한다. */
export function isRideLegKind(kind?: RouteSelectTransitLeg["kind"] | "TRANSFER"): boolean {
    return isTransitRideKind(kind);
}

/** 경로 응답의 환승 수를 공통 추천 정책과 동일한 방식으로 계산한다. */
export function getRouteTransferCount(option: RouteAlternativeOption): number {
    return getNaverLikeRouteTransferCount(option);
}

/** 환승 횟수와 도보 시간을 요약 칩 모델로 구성하고 값이 없는 항목은 제외한다. */
export function buildRouteMetricChips(option: RouteAlternativeOption): RouteMetricChip[] {
    const chips: RouteMetricChip[] = [];

    if (option.mode === "TRANSIT") {
        chips.push({ key: "transfer", label: `환승 ${getRouteTransferCount(option)}회` });
        const walk = formatTransitWalkingSummary(getTransitRouteWalkingMinutes(option.transitLegs ?? [], option.odsayTimetablePreview));
        if (walk) chips.push({ key: "walk", label: walk });
    } else {
        const distance = formatDistance(option.distanceMeters);
        if (distance) chips.push({ key: "distance", label: distance });
        if (typeof option.tollFareWon === "number" && option.tollFareWon > 0) {
            chips.push({ key: "toll", label: `통행료 ${option.tollFareWon.toLocaleString()}원` });
        }
        if (typeof option.taxiFareWon === "number" && option.taxiFareWon > 0) {
            chips.push({ key: "taxi", label: `택시 예상 ${option.taxiFareWon.toLocaleString()}원` });
        }
    }

    return chips;
}

/** 정류장 이름에서 중복 괄호와 불필요한 공백을 제거해 기본 표시명을 만든다. */
export function formatRouteStopName(name?: string): string | undefined {
    const normalized = name
        ?.replace(/\s+/g, " ")
        .replace(/\(.+?\)/g, "")
        .replace(/(\S)(\d+\s*번\s*출구)/g, "$1 $2")
        .trim();
    return normalized || undefined;
}

/** 경로 흐름의 출발·도착 지점 이름을 짧고 일관된 형태로 정리한다. */
export function formatRouteFlowPointName(name?: string): string | undefined {
    const normalized = formatRouteStopName(name)
        ?.replace(/\[.+?\]/g, "")
        .replace(/\s*\d+\s*번\s*출구.*$/g, "")
        .replace(/\s*출구.*$/g, "")
        .trim();
    return normalized || undefined;
}

/** 정류장 이름과 노선 맥락을 결합하되 같은 정보가 반복되지 않도록 표시명을 만든다. */
export function formatRouteFlowStopDisplayName(
    name?: string,
    kind?: RouteSelectTransitLeg["kind"] | "TRANSFER"
): string | undefined {
    const normalized = formatRouteFlowPointName(name);
    if (!normalized) return undefined;
    if ((kind === "SUBWAY" || kind === "TRAIN") && !normalized.endsWith("역")) {
        return `${normalized}역`;
    }
    return normalized;
}

/** 승차 구간의 노선, 탑승 지점, 정류장 수를 한 줄 요약으로 조합한다. */
export function buildRouteBoardingSummary(
    option: RouteAlternativeOption,
    originName?: string
): string | undefined {
    const rideLegs = (option.transitLegs ?? []).filter((leg) => isRideLegKind(leg.kind));
    if (!rideLegs.length) return undefined;

    return rideLegs.map((leg, index) => {
        const lineLabel = getTransitRideLineLabel(leg);
        const startName = formatRouteFlowStopDisplayName(leg.startName, leg.kind) ??
            formatRouteFlowPointName(originName);
        const action = index === 0 ? "승차" : "환승";
        return [lineLabel, startName ? `${startName} ${action}` : action]
            .filter(Boolean)
            .join(" ");
    }).join("  →  ");
}

/** 경로 상세 드롭다운에서 사용할 지점명을 항목 종류에 맞게 정리한다. */
export function formatDropdownPlaceName(
    name?: string,
    kind?: RouteDropdownSummaryKind
): string | undefined {
    const normalized = formatRouteStopName(name);
    if (!normalized) return undefined;
    if (
        (kind === "SUBWAY" || kind === "TRAIN") &&
        !normalized.endsWith("역") &&
        normalized !== "출발지" &&
        normalized !== "도착지"
    ) {
        return `${normalized}역`;
    }
    return normalized;
}

/** 경로 설명에서 HTML 흔적과 반복 공백을 제거해 안전한 일반 텍스트로 만든다. */
export function sanitizeRouteFlowText(text: string): string {
    return text
        .replace(/\s*(승차|하차|환승)\s*/g, " ")
        .replace(/\s*→\s*/g, " → ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

/** 승차 구간의 정류장 수를 응답 필드 또는 정류장 배열에서 계산한다. */
export function getRideLegStopCount(leg: RouteSelectTransitLeg): number | undefined {
    if (typeof leg.stationCount === "number" && Number.isFinite(leg.stationCount) && leg.stationCount > 0) {
        return Math.round(leg.stationCount);
    }
    if (Array.isArray(leg.passStops) && leg.passStops.length > 1) {
        return Math.max(1, leg.passStops.length - 1);
    }
    return undefined;
}

/** 승차 구간 정류장 수가 있을 때만 사용자용 개수 문구를 반환한다. */
export function formatRideLegStopCount(leg: RouteSelectTransitLeg): string | undefined {
    const count = getRideLegStopCount(leg);
    if (!count) return undefined;
    return leg.kind === "BUS" ? `${count}개 정류장` : `${count}정거장`;
}

// 선택된 경로는 구간 순서를 유지한 채 도보·승차·환승 정보를 세로로 펼친다.
/** 전체 대중교통 경로를 승차·환승 순서의 상세 요약 항목으로 변환한다. */
export function buildRouteDropdownSummaryItems(
    option: RouteAlternativeOption,
    originName?: string,
    destinationName?: string
): RouteDropdownSummaryItem[] {
    const legs = option.transitLegs ?? [];
    if (!legs.length) {
        const summary = option.stepSummary ? sanitizeRouteFlowText(option.stepSummary) : "";
        return summary
            ? [{
                key: `${option.id}:summary`,
                kind: "ETC",
                title: "경로 요약",
                subtitle: summary.replace(/→/g, " "),
            }]
            : [];
    }

    const originFallback = formatDropdownPlaceName(originName) ?? "출발지";
    const destinationFallback = formatDropdownPlaceName(destinationName) ?? "도착지";
    const bus = option.odsayBusPreview;
    const busIndex = bus ? legs.findIndex(leg => leg.kind === "BUS") : -1;
    const lastBusIndex = bus?.transfer ? legs.findIndex((leg, index) => index > busIndex && leg.kind === "BUS") : busIndex;
    let rideIndex = 0;

    const items = legs.map((leg, index): RouteDropdownSummaryItem => {
        const ridePosition = isRideLegKind(leg.kind) ? rideIndex++ : -1;
        const busRide = bus && (index === busIndex
            ? { boardingAt: bus.boardingAt, arrivalAt: bus.transfer?.firstAlightingAt ?? bus.alightingAt }
            : bus.transfer && index === lastBusIndex
                ? { boardingAt: bus.transfer.secondBoardingAt, arrivalAt: bus.alightingAt } : undefined);
        const ride = busRide || option.odsayTimetablePreview?.rides?.[ridePosition];
        const walkingSeconds = bus && index === 0 && busIndex === 1 ? bus.accessSeconds
            : bus && index === legs.length - 1 && lastBusIndex === legs.length - 2 ? bus.egressSeconds
                : bus?.transfer && lastBusIndex === busIndex + 2 && index === busIndex + 1
                    ? bus.transfer.walkingSeconds : getTimetableWalkSeconds(legs, index, rideIndex, option.odsayTimetablePreview);
        const minutes = ride ? Math.ceil((Date.parse(ride.arrivalAt) - Date.parse(ride.boardingAt)) / 60_000)
            : walkingSeconds !== undefined ? Math.ceil(walkingSeconds / 60) : getTransitLegDisplayMinutes(leg);
        const duration = minutes === undefined ? undefined : formatRouteDuration(minutes);
        const timeSuffix = duration ? ` ${duration}` : "";
        const prevLeg = legs[index - 1];
        const nextLeg = legs[index + 1];
        const startName = formatDropdownPlaceName(leg.startName, leg.kind);
        const endName = formatDropdownPlaceName(leg.endName, leg.kind);
        const key = `${option.id}:${leg.kind}:${leg.label}:${index}`;

        if (leg.journeyPhase === "BUFFER") {
            return { key, kind: "WAIT", title: "" };
        }
        if (leg.kind === "WALK") {
            if (isRideLegKind(prevLeg?.kind) && nextLeg && isTransitRideKind(nextLeg.kind)) {
                const transfer = option.odsayTimetablePreview?.transferTimings?.[rideIndex - 1];
                const busTransfer = bus?.transfer;
                const waiting = busTransfer && index === busIndex + 1 ? Math.ceil(
                    (Date.parse(busTransfer.secondBoardingAt) - Date.parse(busTransfer.firstAlightingAt) -
                        busTransfer.walkingSeconds * 1000) / 60_000,
                ) : transfer ? Math.ceil(
                    (Date.parse(transfer.boardingAt) - Date.parse(transfer.previousArrivalAt) - transfer.walkingSeconds * 1000) / 60_000,
                ) : 0;
                return {
                    key,
                    kind: "TRANSFER" as const,
                    title: duration ? `환승 도보 ${duration}` : "환승 도보",
                    subtitle: [formatTransferBoardingTarget(nextLeg.kind, getTransitRideLineLabel(nextLeg)),
                        waiting > 0 ? `예상 대기 ${formatRouteDuration(waiting)}` : undefined].filter(Boolean).join(" · "),
                };
            }

            const nextStopName = endName ??
                formatDropdownPlaceName(nextLeg?.startName, nextLeg?.kind) ??
                (index === legs.length - 1 ? destinationFallback : undefined);
            return {
                key,
                kind: "WALK" as const,
                title: `도보${timeSuffix}`,
                subtitle: index === legs.length - 1
                    ? "도착지까지"
                    : `${nextStopName ?? "다음 지점"}까지`,
            };
        }

        if (isRideLegKind(leg.kind)) {
            const lineLabel = getTransitRideLineLabel(leg);
            const placeName = startName ?? (index === 0 ? originFallback : undefined);
            const stopCountText = formatRideLegStopCount(leg);
            const modeLabel = transitModeLabel(leg.kind);
            const prefix = isIntercityRideKind(leg.kind) && lineLabel !== modeLabel ? `${modeLabel} · ` : "";
            const rideClock = ride
                ? `${formatCurrentRouteNoticeTime(new Date(ride.boardingAt))} 승차 → ${formatCurrentRouteNoticeTime(new Date(ride.arrivalAt))} ${busRide ? "하차 예측" : "하차 예정"}`
                : undefined;
            return {
                key,
                kind: leg.kind,
                color: getTransitLegColor(leg),
                title: `${prefix}${lineLabel}${timeSuffix}`,
                subtitle: [placeName, stopCountText, rideClock, leg.intercityService && serviceTimeRange(leg.intercityService)].filter(Boolean).join(" · "),
            };
        }

        return {
            key,
            kind: "ETC" as const,
            title: `이동${timeSuffix}`,
            subtitle: startName ?? endName,
        };
    });
    const entrance = option.odsayTimetablePreview?.entranceWalk;
    if (entrance && legs[0]?.kind === "SUBWAY") {
        items.unshift({ key: `${option.id}:entrance`, kind: "WALK",
            title: `역 출구까지 도보 ${formatRouteDuration(Math.ceil(entrance.seconds / 60))}` });
    }
    return items.filter(item => item.kind !== "WAIT");
}
