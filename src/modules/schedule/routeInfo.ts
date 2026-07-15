import type {
    RouteAlternativeOption,
    RouteApiProvider,
    RouteGuideStep,
    RoutePathCoord,
    TransitLegDetail,
} from "../map/tmapApi";
import { getTransitBoardingDirectionHint } from "../map/transitStopLabelPresentation";
import type { Place, TravelMode } from "./types";

export type RouteStepType =
    | "ORIGIN"
    | "DESTINATION"
    | "WALK"
    | "SUBWAY"
    | "BUS"
    | "DRIVE"
    | "BIKE"
    | "TRANSFER";

export type RouteCoordinate = {
    latitude: number;
    longitude: number;
};

export type RoutePassStop = {
    name: string;
    sequence?: number;
    code?: string;
};

export interface RouteStep {
    id: string;
    type: RouteStepType;
    title: string;
    description?: string;
    durationMinutes?: number;
    distanceMeters?: number;
    stationCount?: number;
    lineName?: string;
    lineColor?: string;
    badgeText?: string;
    directionName?: string;
    directionCode?: "UP" | "DOWN";
    boardingPlatform?: string;
    boardingExit?: string;
    recommendedBoardingPosition?: string;
    recommendedTransferPosition?: string;
    passStops?: RoutePassStop[];
    coordinates?: RouteCoordinate[];
}

export interface RouteInfo {
    id: string;
    /** 시간표와 경로를 제공한 공급자. 기존 저장 데이터 호환을 위해 선택값으로 유지한다. */
    provider?: RouteApiProvider;
    originName: string;
    destinationName: string;
    totalDurationMinutes: number;
    departureTime: string;
    arrivalTime: string;
    fare?: number;
    tollFare?: number;
    taxiFare?: number;
    transferCount?: number;
    walkingDistanceMeters?: number;
    totalDistanceMeters?: number;
    /** 공급자 시간표가 아닌 현재 시각 + 경로 소요시간으로 계산한 경우 estimated. */
    timeBasis: "provider_schedule" | "estimated";
    steps: RouteStep[];
}

export const ROUTE_POINT_COLORS = {
    origin: "#22C55E",
    destination: "#FF4444",
    walk: "#9CA3AF",
    transfer: "#22C55E",
    activeBlue: "#2979FF",
    bike: "#00897B",
} as const;

export const SUBWAY_LINE_COLORS: Array<{ pattern: RegExp; color: string }> = [
    { pattern: /1호선/, color: "#0D47A1" },
    { pattern: /2호선/, color: "#00B140" },
    { pattern: /3호선/, color: "#FF7F00" },
    { pattern: /4호선/, color: "#00A4E3" },
    { pattern: /5호선/, color: "#7E57C2" },
    { pattern: /6호선/, color: "#A05A2C" },
    { pattern: /7호선/, color: "#6A8F2A" },
    { pattern: /8호선/, color: "#E5398E" },
    { pattern: /9호선/, color: "#B59A3A" },
    { pattern: /신분당/, color: "#D32F2F" },
    { pattern: /경의중앙/, color: "#26A69A" },
    { pattern: /공항철도|AREX/i, color: "#1E88E5" },
    { pattern: /수인분당|분당선|수인선/, color: "#F4B400" },
    { pattern: /경춘/, color: "#178C72" },
    { pattern: /경강/, color: "#0054A6" },
    { pattern: /서해/, color: "#8FC31F" },
    { pattern: /김포골드|김포도시철도/, color: "#A17800" },
    { pattern: /우이신설/, color: "#B7C452" },
    { pattern: /신림선/, color: "#6789CA" },
    { pattern: /용인경전철|에버라인/, color: "#6FB245" },
    { pattern: /의정부경전철/, color: "#FDA600" },
    { pattern: /인천1호선/, color: "#7CA8D5" },
    { pattern: /인천2호선/, color: "#ED8B00" },
];

export const BUS_TYPE_COLORS = {
    trunk: "#2979FF",
    branch: "#22C55E",
    metro: "#FF4444",
    circular: "#FF950B",
    village: "#26A69A",
    airport: "#7E57C2",
} as const;

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function normalizeHexColor(value?: string): string | undefined {
    const raw = value?.trim();
    if (!raw) return undefined;
    if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return raw.toUpperCase();
    if (/^[0-9A-Fa-f]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
    return undefined;
}

export function formatRouteDuration(minutes?: number): string {
    if (!isFiniteNumber(minutes)) return "-";
    const totalMinutes = Math.max(0, Math.round(minutes));
    const hours = Math.floor(totalMinutes / 60);
    const remainMinutes = totalMinutes % 60;
    if (hours === 0) return `${remainMinutes}분`;
    if (remainMinutes === 0) return `${hours}시간`;
    return `${hours}시간 ${remainMinutes}분`;
}

export function formatRouteDistance(distanceMeters?: number): string | undefined {
    if (!isFiniteNumber(distanceMeters)) return undefined;
    if (distanceMeters >= 1000) return `${(distanceMeters / 1000).toFixed(1)}km`;
    return `${Math.round(distanceMeters)}m`;
}

export function formatRouteClock(value: string | Date | undefined): string {
    const date = value instanceof Date ? value : value ? new Date(value) : undefined;
    if (!date || Number.isNaN(date.getTime())) return "";
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const period = hours < 12 ? "오전" : "오후";
    const displayHour = hours % 12 || 12;
    return `${period} ${displayHour}:${minutes}`;
}

export function compactTransitLineLabel(lineName?: string): string | undefined {
    if (!lineName) return undefined;
    let normalized = lineName.trim();
    const leadingTokenRegex = /^(승차|하차|환승|승|하|환|버스|지하철)\s*/i;
    for (let index = 0; index < 3; index += 1) {
        const next = normalized.replace(leadingTokenRegex, "").trim();
        if (next === normalized) break;
        normalized = next;
    }
    normalized = normalized
        .replace(/직행좌석\s*[:：]?\s*/g, "")
        .replace(/일반좌석\s*[:：]?\s*/g, "")
        .replace(/좌석\s*[:：]?\s*/g, "")
        .replace(/일반\s*[:：]?\s*/g, "")
        .replace(/급행\s*[:：]?\s*/g, "")
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

    if (!normalized) return undefined;
    const lineMatch = normalized.match(/\d+호선/);
    if (lineMatch?.[0]) return lineMatch[0];
    const busNumberMatch = normalized.match(/^[A-Z]?\d{1,5}[A-Z]?/i);
    if (busNumberMatch?.[0]) return busNumberMatch[0];
    const first = normalized.split(",")[0]?.trim() ?? normalized;
    return first.length > 10 ? `${first.slice(0, 10)}...` : first;
}

export function getSubwayLineColor(lineName?: string): string {
    const normalized = lineName?.trim();
    if (!normalized) return "#00B140";
    const matched = SUBWAY_LINE_COLORS.find((item) => item.pattern.test(normalized));
    return matched?.color ?? "#00B140";
}

export type BusBadgeType = keyof typeof BUS_TYPE_COLORS;

export function getBusBadgeType(lineName?: string): BusBadgeType {
    const normalized = lineName?.trim().toUpperCase() ?? "";
    if (/공항|AIRPORT|^6\d{3}$/.test(normalized)) return "airport";
    if (/마을|VILLAGE|강남|서초|종로|마포|용산|성동|송파|강북|노원|도봉/.test(normalized)) return "village";
    if (/순환|CIRCULAR/.test(normalized)) return "circular";
    if (/광역|M\d+|^9\d+/.test(normalized)) return "metro";
    if (/지선/.test(normalized)) return "branch";
    if (/간선/.test(normalized)) return "trunk";

    const numberToken = normalized.match(/\d+/)?.[0];
    if (!numberToken) return "trunk";
    if (numberToken.startsWith("6") && numberToken.length === 4) return "airport";
    if (numberToken.startsWith("9")) return "metro";
    if (numberToken.length === 2) return "circular";
    if (numberToken.length === 4 || numberToken.length >= 5) return "branch";
    return "trunk";
}

export function getBusLineColor(lineName?: string, explicitColor?: string): string {
    const normalized = normalizeHexColor(explicitColor);
    if (normalized) return normalized;
    return BUS_TYPE_COLORS[getBusBadgeType(lineName)];
}

export function getRouteStepColor(step: Pick<RouteStep, "type" | "lineName" | "lineColor">): string {
    if (step.type === "ORIGIN") return ROUTE_POINT_COLORS.origin;
    if (step.type === "DESTINATION") return ROUTE_POINT_COLORS.destination;
    if (step.type === "WALK") return ROUTE_POINT_COLORS.walk;
    if (step.type === "TRANSFER") return ROUTE_POINT_COLORS.transfer;
    if (step.type === "DRIVE") return ROUTE_POINT_COLORS.activeBlue;
    if (step.type === "BIKE") return ROUTE_POINT_COLORS.bike;
    if (step.type === "SUBWAY") return normalizeHexColor(step.lineColor) ?? getSubwayLineColor(step.lineName);
    if (step.type === "BUS") return getBusLineColor(step.lineName, step.lineColor);
    return ROUTE_POINT_COLORS.activeBlue;
}

export function getRouteStepStrokeWidth(step: Pick<RouteStep, "type">): number {
    if (step.type === "WALK" || step.type === "TRANSFER") return 5.5;
    return 6.5;
}

function placeName(place: Place | undefined, fallback: string): string {
    return place?.name?.trim() || place?.address?.trim() || fallback;
}

function pointToRouteCoordinate(point?: RoutePathCoord): RouteCoordinate | undefined {
    if (!point || !isFiniteNumber(point.lat) || !isFiniteNumber(point.lng)) return undefined;
    return { latitude: point.lat, longitude: point.lng };
}

function pathToRouteCoordinates(pathCoords?: RoutePathCoord[]): RouteCoordinate[] | undefined {
    if (!Array.isArray(pathCoords) || pathCoords.length < 2) return undefined;
    const coords = pathCoords
        .map(pointToRouteCoordinate)
        .filter((point): point is RouteCoordinate => !!point);
    return coords.length >= 2 ? coords : undefined;
}

function placeToRouteCoordinates(place?: Place): RouteCoordinate[] | undefined {
    if (!isFiniteNumber(place?.lat) || !isFiniteNumber(place?.lng)) return undefined;
    return [{ latitude: place.lat, longitude: place.lng }];
}

function normalizeStopName(name?: string): string | undefined {
    const normalized = name
        ?.replace(/\s+/g, " ")
        .replace(/\(.+?\)/g, "")
        .trim();
    return normalized || undefined;
}

function destinationHint(name?: string): string | undefined {
    const normalized = normalizeStopName(name);
    return normalized ? `${normalized}까지` : undefined;
}

export function getRouteStepDirectionHint(
    step: RouteStep,
    description?: string
): string | undefined {
    if (step.type !== "BUS" && step.type !== "SUBWAY") return undefined;

    const directionHint = getTransitBoardingDirectionHint({
        directionName: step.directionName,
        startName: step.title,
        passStops: step.passStops,
    });
    if (directionHint) return directionHint;

    // endName is the end of this itinerary leg, not a train headsign. Keep the
    // provider-safe "까지" wording when pass-stop geometry cannot reveal direction.
    return description?.split("·")[0]?.trim() || undefined;
}

function legDuration(leg: TransitLegDetail): number | undefined {
    if (isFiniteNumber(leg.durationMinutes)) return Math.max(1, Math.round(leg.durationMinutes));
    if (isFiniteNumber(leg.distanceMeters) && leg.distanceMeters > 0) {
        return Math.max(1, Math.round(leg.distanceMeters / (leg.kind === "WALK" ? 67 : 350)));
    }
    return undefined;
}

function buildWalkStep(leg: TransitLegDetail, index: number): RouteStep {
    const durationMinutes = legDuration(leg);
    const distanceText = formatRouteDistance(leg.distanceMeters);
    const durationText = isFiniteNumber(durationMinutes) ? `${durationMinutes}분` : undefined;
    const description = [distanceText, durationText].filter(Boolean).join(" · ") || undefined;
    return {
        id: `leg-${index}`,
        type: "WALK",
        title: "도보",
        description,
        durationMinutes,
        distanceMeters: leg.distanceMeters,
        coordinates: pathToRouteCoordinates(leg.pathCoords),
    };
}

function buildRideStep(leg: TransitLegDetail, index: number): RouteStep {
    const type = leg.kind === "BUS" ? "BUS" : "SUBWAY";
    const lineName = compactTransitLineLabel(leg.lineName) ?? compactTransitLineLabel(leg.label) ?? leg.lineName ?? leg.label;
    const lineColor = type === "BUS"
        ? getBusLineColor(lineName, leg.lineColor)
        : normalizeHexColor(leg.lineColor) ?? getSubwayLineColor(lineName);
    const startName = normalizeStopName(leg.startName);
    const endName = normalizeStopName(leg.endName);
    const fallbackKind = type === "BUS" ? "버스" : "지하철";
    const durationMinutes = legDuration(leg);
    const stationText = isFiniteNumber(leg.stationCount) ? `${leg.stationCount}정거장` : undefined;
    const durationText = isFiniteNumber(durationMinutes) ? `${durationMinutes}분` : undefined;
    const passStops = leg.passStops
        ?.map((stop) => ({
            name: normalizeStopName(stop.name) ?? stop.name,
            sequence: stop.sequence,
            code: stop.code,
        }))
        .filter((stop) => !!stop.name);
    return {
        id: `leg-${index}`,
        type,
        title: startName ?? lineName ?? fallbackKind,
        description: [destinationHint(endName), stationText, durationText].filter(Boolean).join(" · ") || undefined,
        durationMinutes,
        distanceMeters: leg.distanceMeters,
        stationCount: leg.stationCount,
        lineName,
        lineColor,
        badgeText: lineName,
        directionName: leg.directionName,
        directionCode: leg.directionCode,
        boardingPlatform: leg.boardingPlatform,
        boardingExit: leg.boardingExit,
        recommendedBoardingPosition: leg.recommendedBoardingPosition,
        recommendedTransferPosition: leg.recommendedTransferPosition,
        passStops,
        coordinates: pathToRouteCoordinates(leg.pathCoords),
    };
}

function routeStepTypeForMode(mode: TravelMode): RouteStepType {
    if (mode === "WALK") return "WALK";
    if (mode === "BIKE") return "BIKE";
    if (mode === "CAR" || mode === "ETC") return "DRIVE";
    return "TRANSFER";
}

function buildGuideRouteStep(
    guide: RouteGuideStep,
    mode: TravelMode,
    index: number
): RouteStep {
    const type = routeStepTypeForMode(mode);
    const roadName = guide.roadName && !guide.instruction.includes(guide.roadName)
        ? guide.roadName
        : undefined;
    const durationText = isFiniteNumber(guide.durationMinutes) && guide.durationMinutes >= 0.5
        ? formatRouteDuration(guide.durationMinutes)
        : undefined;
    const description = [
        roadName,
        formatRouteDistance(guide.distanceMeters),
        durationText,
    ].filter(Boolean).join(" · ") || undefined;
    const pointCoordinate = pointToRouteCoordinate(guide.coordinate);
    return {
        id: `guide-${index}`,
        type,
        title: guide.instruction,
        description,
        durationMinutes: guide.durationMinutes,
        distanceMeters: guide.distanceMeters,
        coordinates: pathToRouteCoordinates(guide.pathCoords) ?? (pointCoordinate ? [pointCoordinate] : undefined),
    };
}

function buildRouteSteps(option: RouteAlternativeOption, origin?: Place, destination?: Place): RouteStep[] {
    const originName = placeName(origin, "출발지");
    const destinationName = placeName(destination, "도착지");
    const steps: RouteStep[] = [{
        id: "origin",
        type: "ORIGIN",
        title: originName,
        coordinates: placeToRouteCoordinates(origin),
    }];

    const legs = Array.isArray(option.transitLegs) ? option.transitLegs : [];
    if (legs.length > 0) {
        legs.forEach((leg, index) => {
            if (leg.kind === "WALK") {
                steps.push(buildWalkStep(leg, index));
            } else if (leg.kind === "BUS" || leg.kind === "SUBWAY") {
                steps.push(buildRideStep(leg, index));
            } else {
                steps.push({
                    id: `leg-${index}`,
                    type: "TRANSFER",
                    title: leg.label || "환승",
                    description: buildWalkStep(leg, index).description,
                    durationMinutes: legDuration(leg),
                    distanceMeters: leg.distanceMeters,
                    coordinates: pathToRouteCoordinates(leg.pathCoords),
                });
            }
        });
    } else if (Array.isArray(option.guideSteps) && option.guideSteps.length > 0) {
        option.guideSteps.forEach((guide, index) => {
            steps.push(buildGuideRouteStep(guide, option.mode, index));
        });
    } else if (Array.isArray(option.pathCoords) && option.pathCoords.length >= 2) {
        const stepType = routeStepTypeForMode(option.mode);
        const title = option.mode === "WALK"
            ? "도보"
            : option.mode === "BIKE"
                ? "자전거 이동"
                : option.mode === "CAR" || option.mode === "ETC"
                    ? "차량 이동"
                    : "이동";
        steps.push({
            id: "leg-0",
            type: stepType,
            title,
            description: [formatRouteDistance(option.distanceMeters), formatRouteDuration(option.minutes)].filter(Boolean).join(" · "),
            durationMinutes: option.minutes,
            distanceMeters: option.distanceMeters,
            coordinates: pathToRouteCoordinates(option.pathCoords),
        });
    }

    steps.push({
        id: "destination",
        type: "DESTINATION",
        title: destinationName,
        coordinates: placeToRouteCoordinates(destination),
    });

    return steps;
}

export function buildRouteInfoFromAlternative(
    option: RouteAlternativeOption,
    origin?: Place,
    destination?: Place,
    departureAt: Date = new Date(),
    routeIndex = 0
): RouteInfo {
    const totalDurationMinutes = Math.max(0, Math.round(option.minutes ?? 0));
    const providerDepartureAt = option.providerDepartureAt ? new Date(option.providerDepartureAt) : undefined;
    const providerArrivalAt = option.providerArrivalAt ? new Date(option.providerArrivalAt) : undefined;
    const hasProviderSchedule = !!providerDepartureAt &&
        !!providerArrivalAt &&
        Number.isFinite(providerDepartureAt.getTime()) &&
        Number.isFinite(providerArrivalAt.getTime()) &&
        providerArrivalAt.getTime() >= providerDepartureAt.getTime();
    const effectiveDepartureAt = hasProviderSchedule ? providerDepartureAt : departureAt;
    const arrivalAt = hasProviderSchedule
        ? providerArrivalAt
        : new Date(effectiveDepartureAt.getTime() + totalDurationMinutes * 60 * 1000);
    return {
        id: option.id || `route-${routeIndex}`,
        provider: option.provider,
        originName: placeName(origin, "출발지"),
        destinationName: placeName(destination, "도착지"),
        totalDurationMinutes,
        departureTime: effectiveDepartureAt.toISOString(),
        arrivalTime: arrivalAt.toISOString(),
        fare: option.fareWon,
        tollFare: option.tollFareWon,
        taxiFare: option.taxiFareWon,
        transferCount: option.transferCount,
        walkingDistanceMeters: option.walkMeters,
        totalDistanceMeters: option.distanceMeters,
        timeBasis: hasProviderSchedule ? "provider_schedule" : "estimated",
        steps: buildRouteSteps(option, origin, destination),
    };
}

function isRouteStep(value: unknown): value is RouteStep {
    const item = value as Partial<RouteStep> | undefined;
    return !!item && typeof item.id === "string" && typeof item.type === "string" && typeof item.title === "string";
}

export function isRouteInfo(value: unknown): value is RouteInfo {
    const route = value as Partial<RouteInfo> | undefined;
    return !!route &&
        typeof route.id === "string" &&
        typeof route.originName === "string" &&
        typeof route.destinationName === "string" &&
        isFiniteNumber(route.totalDurationMinutes) &&
        typeof route.departureTime === "string" &&
        typeof route.arrivalTime === "string" &&
        (route.provider === undefined || ["tmap", "odsay", "kakao", "naver", "openstreetmap"].includes(route.provider)) &&
        (route.timeBasis === undefined || route.timeBasis === "provider_schedule" || route.timeBasis === "estimated") &&
        Array.isArray(route.steps) &&
        route.steps.every(isRouteStep);
}

export function getRouteInfoFromRoute(
    route: unknown,
    fallback?: {
        origin?: Place;
        destination?: Place;
        travelMode?: TravelMode;
        travelMinutes?: number;
    }
): RouteInfo | undefined {
    if (isRouteInfo(route)) return route;
    const routeObject = route as Record<string, unknown> | undefined;
    if (isRouteInfo(routeObject?.routeInfo)) return routeObject.routeInfo;

    if (
        routeObject &&
        typeof routeObject.id === "string" &&
        (routeObject.mode === "TRANSIT" || routeObject.mode === "CAR" || routeObject.mode === "WALK" || routeObject.mode === "BIKE" || routeObject.mode === "ETC")
    ) {
        return buildRouteInfoFromAlternative(
            routeObject as RouteAlternativeOption,
            fallback?.origin,
            fallback?.destination
        );
    }

    if (fallback?.origin && fallback.destination && isFiniteNumber(fallback.travelMinutes)) {
        const departureAt = new Date();
        const arrivalAt = new Date(departureAt.getTime() + fallback.travelMinutes * 60 * 1000);
        return {
            id: `manual-${fallback.origin.name ?? "origin"}-${fallback.destination.name ?? "destination"}`,
            originName: placeName(fallback.origin, "출발지"),
            destinationName: placeName(fallback.destination, "도착지"),
            totalDurationMinutes: fallback.travelMinutes,
            departureTime: departureAt.toISOString(),
            arrivalTime: arrivalAt.toISOString(),
            timeBasis: "estimated",
            steps: buildRouteSteps(
                {
                    id: "manual-route",
                    mode: fallback.travelMode ?? "ETC",
                    minutes: fallback.travelMinutes,
                    source: "fallback",
                },
                fallback.origin,
                fallback.destination
            ),
        };
    }

    return undefined;
}

export function buildRouteSummaryMetrics(routeInfo: RouteInfo): Array<{ key: string; label: string }> {
    const metrics: Array<{ key: string; label: string }> = [];
    if (isFiniteNumber(routeInfo.fare)) metrics.push({ key: "fare", label: `${routeInfo.fare.toLocaleString()}원` });
    if (isFiniteNumber(routeInfo.tollFare) && routeInfo.tollFare > 0) {
        metrics.push({ key: "toll", label: `통행료 ${routeInfo.tollFare.toLocaleString()}원` });
    }
    if (isFiniteNumber(routeInfo.taxiFare) && routeInfo.taxiFare > 0) {
        metrics.push({ key: "taxi", label: `택시 예상 ${routeInfo.taxiFare.toLocaleString()}원` });
    }
    if (isFiniteNumber(routeInfo.transferCount)) metrics.push({ key: "transfer", label: `환승 ${routeInfo.transferCount}회` });
    const walkText = formatRouteDistance(routeInfo.walkingDistanceMeters);
    if (walkText) metrics.push({ key: "walk", label: `도보 ${walkText}` });
    const totalText = formatRouteDistance(routeInfo.totalDistanceMeters);
    if (totalText) metrics.push({ key: "distance", label: `총 ${totalText}` });
    return metrics;
}

export function getRouteStepBadges(routeInfo: RouteInfo): Array<{ id: string; label: string; color: string; type: RouteStepType }> {
    return routeInfo.steps
        .filter((step) => step.type === "WALK" || step.type === "SUBWAY" || step.type === "BUS")
        .map((step) => ({
            id: step.id,
            label: step.type === "WALK" ? "도보" : (step.badgeText ?? step.lineName ?? (step.type === "BUS" ? "버스" : "지하철")),
            color: getRouteStepColor(step),
            type: step.type,
        }));
}
