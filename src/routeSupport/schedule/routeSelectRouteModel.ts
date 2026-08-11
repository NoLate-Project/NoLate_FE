import type { RouteAlternativeOption } from "../../modules/map/routingService";
import {
    compactTransitLineLabel as compactSharedTransitLineLabel,
    getBusLineColor as getSharedBusLineColor,
    getSubwayLineColor as getSharedSubwayLineColor,
} from "../../modules/schedule/routeInfo";
import {
    getNaverLikeRoutePriority,
    getNaverLikeRouteTransferCount,
    getNaverLikeRouteWalkMinutes,
    selectNaverLikeRouteAlternatives,
} from "../../modules/schedule/routeAlternativeRanking";
import type { TravelMode } from "../../modules/schedule/types";
import {
    ROUTE_SEGMENT_FALLBACK_COLORS,
    type RouteDropdownSummaryItem,
    type RouteDropdownSummaryKind,
    type RouteMetricChip,
    type RouteProgressSegment,
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

// 카드에서 쓰는 오전/오후 시간 문자열을 만든다.
/** 경로 시각을 로컬 24시간제 HH:mm 문자열로 변환한다. */
export function formatRouteClock(date: Date): string {
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const period = hours < 12 ? "오전" : "오후";
    const displayHour = hours % 12 || 12;
    return `${period} ${displayHour}:${minutes}`;
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

// 경로 카드의 출발-도착 시간과 요금을 한 줄로 만든다.
/** 경로의 도착 예상 시각과 요금 중 제공 가능한 정보를 한 줄 보조 문구로 조합한다. */
export function formatRouteTimeFare(option: RouteAlternativeOption, departureAt: Date): string | undefined {
    const chunks: string[] = [];
    if (typeof option.minutes === "number") {
        const arrivalAt = new Date(departureAt.getTime() + Math.max(0, option.minutes) * 60 * 1000);
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

// 노선명을 카드 막대 아래에 들어갈 짧은 라벨로 정리한다.
/** 버스·지하철 노선명을 카드 안에 들어가는 짧은 표기로 정규화한다. */
export function compactLineLabel(leg: RouteSelectTransitLeg): string | undefined {
    const sharedLabel = compactSharedTransitLineLabel(leg.lineName) ?? compactSharedTransitLineLabel(leg.label);
    if (sharedLabel) return sharedLabel;

    const raw = (leg.lineName || leg.label || "").trim();
    if (!raw) return undefined;
    let normalized = raw;
    const leadingTokenRegex = /^(승차|하차|환승|승|하|환|버스|지하철)\s*/i;
    for (let index = 0; index < 3; index += 1) {
        const next = normalized.replace(leadingTokenRegex, "").trim();
        if (next === normalized) break;
        normalized = next;
    }
    normalized = normalized
        .replace(/간선\s*[:：]?\s*/g, "")
        .replace(/지선\s*[:：]?\s*/g, "")
        .replace(/광역\s*[:：]?\s*/g, "")
        .replace(/순환\s*[:：]?\s*/g, "")
        .replace(/마을\s*[:：]?\s*/g, "")
        .replace(/공항\s*[:：]?\s*/g, "")
        .replace(/버스\s*/g, "")
        .replace(/수도권\s*/g, "")
        .replace(/노선$/u, "")
        .trim();

    const lineMatch = normalized.match(/\d+호선/);
    if (lineMatch?.[0]) return lineMatch[0];
    const first = normalized.split(",")[0]?.trim() ?? normalized;
    if (!first) return undefined;
    return first.length > 10 ? `${first.slice(0, 10)}…` : first;
}

// 지하철 노선명을 기준으로 실제 노선색에 가까운 색을 찾는다.
/** 지하철 노선명에 대응하는 대표 색상을 반환하고 알 수 없는 노선에는 기본색을 사용한다. */
export function getSubwayLineColor(lineName?: string): string {
    return getSharedSubwayLineColor(lineName);
}

// 대중교통 구간의 노선색을 결정한다.
/** 대중교통 구간 종류와 노선 정보를 바탕으로 진행 막대에 사용할 색상을 선택한다. */
export function getTransitLegColor(leg: RouteSelectTransitLeg): string {
    const lineLabel = compactLineLabel(leg) ?? leg.lineName ?? leg.label;
    if (leg.kind === "BUS") return getSharedBusLineColor(lineLabel, leg.lineColor);
    if (leg.kind === "SUBWAY") return getSubwayLineColor(lineLabel);
    if (leg.kind === "WALK") return ROUTE_SEGMENT_FALLBACK_COLORS.walk;
    return ROUTE_SEGMENT_FALLBACK_COLORS.etc;
}

// 구간별 소요 시간을 분 단위로 정규화한다.
/** 구간의 초·분 단위 정보를 정규화해 최소 1분 단위 화면 값으로 계산한다. */
export function getLegDurationMinutes(leg: RouteSelectTransitLeg): number {
    if (typeof leg.durationMinutes === "number" && Number.isFinite(leg.durationMinutes)) {
        return Math.max(1, Math.round(leg.durationMinutes));
    }
    if (typeof leg.distanceMeters === "number" && leg.distanceMeters > 0) {
        const metersPerMinute = leg.kind === "WALK" ? 67 : 350;
        return Math.max(1, Math.round(leg.distanceMeters / metersPerMinute));
    }
    return 1;
}

// 경로 후보를 공용 구간 막대 데이터로 변환한다.
/** 도보·승차·환승 구간을 진행 막대가 소비할 비율·색상·라벨 모델로 변환한다. */
export function buildRouteProgressSegments(option: RouteAlternativeOption): RouteProgressSegment[] {
    const legs = option.transitLegs ?? [];
    if (!legs.length) return [];

    return legs
        .map((leg, index) => {
            const minutes = getLegDurationMinutes(leg);
            const prevLeg = legs[index - 1];
            const nextLeg = legs[index + 1];
            const isTransferWalk = leg.kind === "WALK" &&
                index > 0 &&
                index < legs.length - 1 &&
                isRideLegKind(prevLeg?.kind) &&
                isRideLegKind(nextLeg?.kind);
            const lineLabel = leg.kind === "WALK" ? undefined : compactLineLabel(leg);
            const segmentKind: RouteProgressSegment["kind"] = isTransferWalk ? "TRANSFER" : leg.kind;
            const color = isTransferWalk ? ROUTE_SEGMENT_FALLBACK_COLORS.etc : getTransitLegColor(leg);
            return {
                key: `${segmentKind}:${lineLabel ?? leg.label}:${index}`,
                label: `${minutes}분`,
                lineLabel,
                minutes,
                color,
                kind: segmentKind,
                flex: Math.max(0.8, minutes),
                isRide: isRideLegKind(segmentKind),
            };
        })
        .filter((segment) => segment.minutes > 0);
}

/** 대중교통 구간 종류를 한국어 사용자 표시명으로 변환한다. */
export function getTransitKindLabel(kind: RouteSelectTransitLeg["kind"]): string {
    if (kind === "SUBWAY") return "지하철";
    if (kind === "BUS") return "버스";
    if (kind === "WALK") return "도보";
    return "이동";
}

/** 구간이 실제 차량 탑승 구간인지 판별해 도보·환승 표현과 구분한다. */
export function isRideLegKind(kind?: RouteSelectTransitLeg["kind"] | "TRANSFER"): boolean {
    return kind === "SUBWAY" || kind === "BUS";
}

/** 경로 응답의 환승 수를 공통 추천 정책과 동일한 방식으로 계산한다. */
export function getRouteTransferCount(option: RouteAlternativeOption): number {
    return getNaverLikeRouteTransferCount(option);
}

/** 경로 전체에서 도보로 이동하는 시간을 분 단위로 계산한다. */
export function getRouteWalkMinutes(option: RouteAlternativeOption): number {
    return getNaverLikeRouteWalkMinutes(option);
}

/** 환승 횟수와 도보 시간을 요약 칩 모델로 구성하고 값이 없는 항목은 제외한다. */
export function buildRouteMetricChips(option: RouteAlternativeOption): RouteMetricChip[] {
    const chips: RouteMetricChip[] = [];

    if (option.mode === "TRANSIT") {
        chips.push({ key: "transfer", label: `환승 ${getRouteTransferCount(option)}회` });
        chips.push({ key: "walk", label: `도보 ${getRouteWalkMinutes(option)}분` });
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
    if ((kind === "SUBWAY" || kind === "TRANSFER") && !normalized.endsWith("역")) {
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
        const lineLabel = compactLineLabel(leg) ?? getTransitKindLabel(leg.kind);
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
        (kind === "SUBWAY" || kind === "TRANSFER") &&
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

    return legs.map((leg, index) => {
        const minutes = getLegDurationMinutes(leg);
        const prevLeg = legs[index - 1];
        const nextLeg = legs[index + 1];
        const startName = formatDropdownPlaceName(leg.startName, leg.kind);
        const endName = formatDropdownPlaceName(leg.endName, leg.kind);
        const key = `${option.id}:${leg.kind}:${leg.label}:${index}`;

        if (leg.kind === "WALK") {
            const isTransferWalk = index > 0 &&
                index < legs.length - 1 &&
                isRideLegKind(prevLeg?.kind) &&
                isRideLegKind(nextLeg?.kind);
            if (isTransferWalk) {
                const transferName = formatDropdownPlaceName(leg.startName, "TRANSFER") ??
                    formatDropdownPlaceName(leg.endName, "TRANSFER") ??
                    formatDropdownPlaceName(prevLeg?.endName, prevLeg?.kind) ??
                    formatDropdownPlaceName(nextLeg?.startName, nextLeg?.kind) ??
                    "환승 지점";
                return {
                    key,
                    kind: "TRANSFER" as const,
                    title: `환승 ${minutes}분`,
                    subtitle: transferName,
                };
            }

            const nextStopName = endName ??
                formatDropdownPlaceName(nextLeg?.startName, nextLeg?.kind) ??
                (index === legs.length - 1 ? destinationFallback : undefined);
            return {
                key,
                kind: "WALK" as const,
                title: `도보 ${minutes}분`,
                subtitle: index === legs.length - 1
                    ? "도착지까지"
                    : `${nextStopName ?? "다음 지점"}까지`,
            };
        }

        if (isRideLegKind(leg.kind)) {
            const lineLabel = compactLineLabel(leg) ?? getTransitKindLabel(leg.kind);
            const placeName = startName ?? (index === 0 ? originFallback : undefined);
            const stopCountText = formatRideLegStopCount(leg);
            return {
                key,
                kind: leg.kind,
                color: getTransitLegColor(leg),
                title: `${lineLabel} ${minutes}분`,
                subtitle: [placeName, stopCountText].filter(Boolean).join(" · "),
            };
        }

        return {
            key,
            kind: "ETC" as const,
            title: `이동 ${minutes}분`,
            subtitle: startName ?? endName,
        };
    });
}
