import type { RouteAlternativeOption, TransitLegDetail } from "../map/tmapApi";
import type { TravelMode } from "./types";

export type RouteAlternativeTransitFilter = "ALL" | "SUBWAY" | "BUS" | "MIXED";
export type RouteAlternativeRecommendationLabel =
    | "추천"
    | "최소 환승"
    | "도보 적음"
    | "지하철 중심"
    | "버스 중심"
    | "복합 경로";

const DEFAULT_ROUTE_LIMIT_BY_MODE: Record<TravelMode, number> = {
    CAR: 4,
    ETC: 4,
    TRANSIT: 5,
    WALK: 4,
    BIKE: 4,
};

const TRANSIT_FILTER_ROUTE_LIMIT = 4;
const COMFORTABLE_WALK_MINUTES = 8;
const LONG_WALK_MINUTES = 15;
const EXCESSIVE_WALK_DISTANCE_METERS = 1_500;

function hasRenderableLegPath(leg: TransitLegDetail): boolean {
    return Array.isArray(leg.pathCoords) && leg.pathCoords.length >= 2;
}

function getTransitLegGeometryPenalty(leg: TransitLegDetail): number {
    const meaningfulWalk = leg.kind === "WALK" && (leg.distanceMeters ?? 0) > 40;
    if (leg.kind === "WALK" && !meaningfulWalk) return 0;

    if (leg.pathCoordsIsExact && hasRenderableLegPath(leg)) {
        const sparseLongRide = isRideLegKind(leg.kind) &&
            leg.pathCoords!.length < 3 &&
            (leg.distanceMeters ?? 0) >= 1_000;
        return sparseLongRide ? 45 : 0;
    }
    if (leg.pathGeometrySource === "ITINERARY_PATH_SNAP" && hasRenderableLegPath(leg)) {
        return isRideLegKind(leg.kind) ? 36 : 8;
    }
    if (leg.pathGeometrySource === "PASS_STOP_LIST" && hasRenderableLegPath(leg)) {
        return isRideLegKind(leg.kind) ? 120 : 24;
    }
    return isRideLegKind(leg.kind) ? 180 : (meaningfulWalk ? 36 : 0);
}

export function getNaverLikeTransitGeometryPenalty(option: RouteAlternativeOption): number {
    const legs = option.transitLegs ?? [];
    const rideLegs = legs.filter((leg) => isRideLegKind(leg.kind));
    if (!rideLegs.length) return 180;
    return legs.reduce((total, leg) => total + getTransitLegGeometryPenalty(leg), 0);
}

function finiteMinutes(option: RouteAlternativeOption): number {
    return typeof option.minutes === "number" && Number.isFinite(option.minutes)
        ? option.minutes
        : Number.POSITIVE_INFINITY;
}

function isRideLegKind(kind?: TransitLegDetail["kind"]): boolean {
    return kind === "SUBWAY" || kind === "BUS";
}

function normalizeRouteToken(value?: string): string {
    return (value ?? "")
        .replace(/\(.+?\)/g, "")
        .replace(/\[.+?\]/g, "")
        .replace(/\s+/g, "")
        .replace(/역$/u, "")
        .trim()
        .toLowerCase();
}

function normalizeLineToken(value?: string): string {
    return normalizeRouteToken(value)
        .replace(/^(승차|하차|환승|승|하|환|버스|지하철)/u, "")
        .replace(/(간선|지선|광역|순환|마을|공항|버스|수도권)/gu, "");
}

export function getNaverLikeTransitRouteCategory(option: RouteAlternativeOption): RouteAlternativeTransitFilter {
    const legs = option.transitLegs ?? [];
    const hasSubway = legs.some((leg) => leg.kind === "SUBWAY");
    const hasBus = legs.some((leg) => leg.kind === "BUS");
    if (hasSubway && hasBus) return "MIXED";
    if (hasSubway) return "SUBWAY";
    if (hasBus) return "BUS";
    return "ALL";
}

export function getNaverLikeRouteTransferCount(option: RouteAlternativeOption): number {
    if (typeof option.transferCount === "number" && Number.isFinite(option.transferCount)) {
        return Math.max(0, Math.round(option.transferCount));
    }
    const rideLegCount = (option.transitLegs ?? []).filter((leg) => isRideLegKind(leg.kind)).length;
    return Math.max(0, rideLegCount - 1);
}

function getLegDurationMinutes(leg: TransitLegDetail): number {
    if (typeof leg.durationMinutes === "number" && Number.isFinite(leg.durationMinutes)) {
        return Math.max(1, Math.round(leg.durationMinutes));
    }
    if (typeof leg.distanceMeters === "number" && leg.distanceMeters > 0) {
        const metersPerMinute = leg.kind === "WALK" ? 67 : 350;
        return Math.max(1, Math.round(leg.distanceMeters / metersPerMinute));
    }
    return 1;
}

export function getNaverLikeRouteWalkMinutes(option: RouteAlternativeOption): number {
    if (typeof option.walkMeters === "number" && Number.isFinite(option.walkMeters)) {
        return Math.max(0, Math.round(option.walkMeters / 67));
    }
    return (option.transitLegs ?? [])
        .filter((leg) => leg.kind === "WALK")
        .reduce((total, leg) => total + getLegDurationMinutes(leg), 0);
}

function getTransitWalkBurden(option: RouteAlternativeOption): number {
    const walkMinutes = getNaverLikeRouteWalkMinutes(option);
    const totalMinutes = finiteMinutes(option);
    const walkMeters = typeof option.walkMeters === "number" && Number.isFinite(option.walkMeters)
        ? Math.max(0, option.walkMeters)
        : 0;
    const beyondComfort = Math.max(0, walkMinutes - COMFORTABLE_WALK_MINUTES);
    const beyondLong = Math.max(0, walkMinutes - LONG_WALK_MINUTES);
    const walkShare = Number.isFinite(totalMinutes) && totalMinutes > 0
        ? Math.min(1, walkMinutes / totalMinutes)
        : 0;

    // 소비자 지도처럼 몇 분 빠른 경로보다 과도한 접근·도착 도보를 먼저 억제한다.
    // 짧은 도보는 그대로 두고, 15분 이후와 여정의 절반에 가까운 도보만 강하게 벌점 처리한다.
    return (walkMinutes * 1.4) +
        (beyondComfort * 2.8) +
        (beyondLong * 5) +
        (walkMeters >= EXCESSIVE_WALK_DISTANCE_METERS ? 32 : 0) +
        (walkMinutes >= LONG_WALK_MINUTES && walkShare >= 0.35 ? 54 * walkShare : 0);
}

function getTransitRouteSignature(option: RouteAlternativeOption): string {
    const rideTokens = (option.transitLegs ?? [])
        .filter((leg) => isRideLegKind(leg.kind))
        .map((leg) => {
            const line = normalizeLineToken(leg.lineName || leg.label) || leg.kind;
            const start = normalizeRouteToken(leg.startName);
            const end = normalizeRouteToken(leg.endName);
            return [leg.kind, line, start, end].filter(Boolean).join(":");
        });

    if (rideTokens.length > 0) return rideTokens.join(">");

    const mode = option.mode;
    const minuteBucket = Number.isFinite(finiteMinutes(option)) ? Math.round(finiteMinutes(option) / 3) : "x";
    const distanceBucket = typeof option.distanceMeters === "number" ? Math.round(option.distanceMeters / 500) : "x";
    return `${mode}:${minuteBucket}:${distanceBucket}`;
}

export function getNaverLikeRoutePriority(option: RouteAlternativeOption, mode: TravelMode): number {
    const minutes = finiteMinutes(option);
    if (mode !== "TRANSIT") return minutes;

    const category = getNaverLikeTransitRouteCategory(option);
    const transferCount = getNaverLikeRouteTransferCount(option);
    const walkBurden = getTransitWalkBurden(option);
    const rideLegCount = (option.transitLegs ?? []).filter((leg) => isRideLegKind(leg.kind)).length;
    const legComplexityPenalty = Math.max(0, rideLegCount - 2) * 2;
    const categoryPenalty = category === "SUBWAY"
        ? 0
        : category === "MIXED"
            ? 3
            : category === "BUS"
                ? 6
                : 18;
    // 좌표 단절뿐 아니라 구간 상세 형상이 누락된 후보도 정밀 형상 후보 뒤로 보낸다.
    const geometryPenalty = (option.routePlausibility === "geometry_suspected" ? 1_200 : 0) +
        getNaverLikeTransitGeometryPenalty(option);

    return (minutes * 6) + (transferCount * 9) + walkBurden + categoryPenalty + legComplexityPenalty + geometryPenalty;
}

function compareNaverLikeRoutes(mode: TravelMode) {
    return (a: RouteAlternativeOption, b: RouteAlternativeOption) => {
        const scoreDiff = getNaverLikeRoutePriority(a, mode) - getNaverLikeRoutePriority(b, mode);
        if (scoreDiff !== 0) return scoreDiff;
        const minuteDiff = finiteMinutes(a) - finiteMinutes(b);
        if (minuteDiff !== 0) return minuteDiff;
        const transferDiff = getNaverLikeRouteTransferCount(a) - getNaverLikeRouteTransferCount(b);
        if (transferDiff !== 0) return transferDiff;
        return getNaverLikeRouteWalkMinutes(a) - getNaverLikeRouteWalkMinutes(b);
    };
}

function isTransitOutlier(candidate: RouteAlternativeOption, best: RouteAlternativeOption): boolean {
    const bestMinutes = finiteMinutes(best);
    const candidateMinutes = finiteMinutes(candidate);
    if (!Number.isFinite(bestMinutes) || !Number.isFinite(candidateMinutes)) return false;
    if (candidate.id === best.id) return false;

    const bestWalk = getNaverLikeRouteWalkMinutes(best);
    const candidateWalk = getNaverLikeRouteWalkMinutes(candidate);
    const bestTransfer = getNaverLikeRouteTransferCount(best);
    const candidateTransfer = getNaverLikeRouteTransferCount(candidate);
    const tooSlow = candidateMinutes > bestMinutes + 22 && candidateMinutes > bestMinutes * 1.32;
    const tooMuchWalking = candidateWalk > bestWalk + 18 && candidateMinutes > bestMinutes + 8;
    const tooManyTransfers = candidateTransfer > bestTransfer + 2 && candidateMinutes > bestMinutes + 5;
    const walkingDominatesCandidate = candidateWalk >= 25 &&
        candidateWalk / candidateMinutes >= 0.45 &&
        candidateMinutes > bestMinutes - 5;

    return tooSlow || tooMuchWalking || tooManyTransfers || walkingDominatesCandidate;
}

function pushUniqueById(target: RouteAlternativeOption[], option: RouteAlternativeOption, limit: number) {
    if (target.length >= limit) return;
    if (target.some((item) => item.id === option.id)) return;
    target.push(option);
}

function selectLeastTransferRoute(options: RouteAlternativeOption[]): RouteAlternativeOption | undefined {
    return [...options].sort((a, b) => {
        const transferDiff = getNaverLikeRouteTransferCount(a) - getNaverLikeRouteTransferCount(b);
        if (transferDiff !== 0) return transferDiff;
        return compareNaverLikeRoutes("TRANSIT")(a, b);
    })[0];
}

function selectLeastWalkRoute(options: RouteAlternativeOption[]): RouteAlternativeOption | undefined {
    return [...options].sort((a, b) => {
        const walkDiff = getNaverLikeRouteWalkMinutes(a) - getNaverLikeRouteWalkMinutes(b);
        if (walkDiff !== 0) return walkDiff;
        return compareNaverLikeRoutes("TRANSIT")(a, b);
    })[0];
}

export function selectNaverLikeRouteAlternatives(
    options: RouteAlternativeOption[],
    mode: TravelMode,
    filter: RouteAlternativeTransitFilter = "ALL",
    maxRoutes?: number
): RouteAlternativeOption[] {
    const filterLimit = mode === "TRANSIT" && filter !== "ALL"
        ? TRANSIT_FILTER_ROUTE_LIMIT
        : DEFAULT_ROUTE_LIMIT_BY_MODE[mode] ?? 4;
    const limit = Math.max(1, maxRoutes ?? filterLimit);

    const filtered = mode === "TRANSIT" && filter !== "ALL"
        ? options.filter((option) => getNaverLikeTransitRouteCategory(option) === filter)
        : options;
    const sorted = [...filtered].sort(compareNaverLikeRoutes(mode));
    if (mode !== "TRANSIT") return sorted.slice(0, limit);
    if (!sorted.length) return [];

    const best = sorted[0];
    const signatureBest = new Map<string, RouteAlternativeOption>();
    sorted.forEach((option) => {
        if (isTransitOutlier(option, best)) return;
        const signature = getTransitRouteSignature(option) || option.id;
        const current = signatureBest.get(signature);
        if (!current || compareNaverLikeRoutes(mode)(option, current) < 0) {
            signatureBest.set(signature, option);
        }
    });

    const uniqueSorted = Array.from(signatureBest.values()).sort(compareNaverLikeRoutes(mode));
    const picked: RouteAlternativeOption[] = [];
    pushUniqueById(picked, uniqueSorted[0] ?? best, limit);

    const leastTransfer = selectLeastTransferRoute(uniqueSorted);
    if (leastTransfer) pushUniqueById(picked, leastTransfer, limit);
    const leastWalk = selectLeastWalkRoute(uniqueSorted);
    if (leastWalk) pushUniqueById(picked, leastWalk, limit);

    (["SUBWAY", "MIXED", "BUS"] as RouteAlternativeTransitFilter[]).forEach((category) => {
        if (filter !== "ALL" && filter !== category) return;
        const candidate = uniqueSorted.find((option) => getNaverLikeTransitRouteCategory(option) === category);
        if (candidate) pushUniqueById(picked, candidate, limit);
    });

    uniqueSorted.forEach((option) => pushUniqueById(picked, option, limit));

    return picked;
}

export function getNaverLikeRouteRecommendationLabel(
    option: RouteAlternativeOption,
    displayedOptions: RouteAlternativeOption[],
    displayIndex: number
): RouteAlternativeRecommendationLabel {
    const recommended = displayedOptions[0];
    if (displayIndex <= 0 || !recommended || option.id === recommended.id) return "추천";

    const minimumTransferCount = Math.min(
        ...displayedOptions.map((item) => getNaverLikeRouteTransferCount(item))
    );
    if (
        getNaverLikeRouteTransferCount(option) === minimumTransferCount &&
        minimumTransferCount < getNaverLikeRouteTransferCount(recommended)
    ) {
        return "최소 환승";
    }
    const minimumWalkMinutes = Math.min(
        ...displayedOptions.map((item) => getNaverLikeRouteWalkMinutes(item))
    );
    if (
        getNaverLikeRouteWalkMinutes(option) === minimumWalkMinutes &&
        minimumWalkMinutes < getNaverLikeRouteWalkMinutes(recommended)
    ) {
        return "도보 적음";
    }

    const category = getNaverLikeTransitRouteCategory(option);
    if (category === "SUBWAY") return "지하철 중심";
    if (category === "BUS") return "버스 중심";
    return "복합 경로";
}
