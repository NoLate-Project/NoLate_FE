import { serviceTimeRange } from "./intercityTimetableModel";
import type { IntercityJourney } from './intercityJourney';
import type { IntercityRideService } from './importedTicket';
import { isIntercityBusKind, isIntercityRideKind, isTransitRideKind, transitModeLabel, intercityRideColor } from "../map/transitModes";
import type {
    RouteAlternativeOption,
    RouteApiProvider,
    RouteGuideStep,
    RoutePathCoord,
    TransitLegDetail,
} from "../map/tmapApi";
import { getTransitBoardingDirectionHint } from "../map/transitStopLabelPresentation";
import { validTotalDurationSeconds } from "../map/routeDuration";
import { hasTransitLegLineGeometry, isRailKind, lacksIntermediateRailGeometry } from "../map/transitRouteGeometry";
import type { Place, TravelMode } from "./types";

export type RouteStepType =
    | "ORIGIN"
    | "DESTINATION"
    | "WALK"
    | "SUBWAY"
    | "BUS"
    | "DRIVE"
    | "BIKE"
    | "TRANSFER"
    | "TRAIN"
    | "EXPRESS_BUS"
    | "INTERCITY_BUS"
    | "COACH"
    | "UNKNOWN";

export type RouteCoordinate = {
    latitude: number;
    longitude: number;
};

export type RoutePassStop = {
    name: string;
    sequence?: number;
    code?: string;
    sourceIndex?: number;
};

export interface RouteStep {
    /** Display-only timestamps from a matched server journey, never reconstructed from rounded minutes. */
    matchedTimeline?: {
        startAt: string;
        endAt: string;
        movementSeconds: number;
        firstBoardingIntervalSeconds?: number;
        transferWaitSeconds?: number;
        startsWithStationArrivalPrediction?: true;
        startsWithReportedStationArrival?: true;
        provisionalPlan?: true;
    };
    scheduledRide?: { boardingAt: string; arrivalAt: string };
    alightingName?: string;
    intercityService?: IntercityRideService;
    journeyPhase?: TransitLegDetail["journeyPhase"];
    id: string;
    type: RouteStepType;
    title: string;
    description?: string;
    durationMinutes?: number;
    /** 원본 구간 초가 있으면 타임라인 계산에서 표시용 분보다 우선한다. */
    durationSeconds?: number;
    /** 공급자 구간 시간에 포함된 승차 대기시간. 실시간 출발 ETA에서 교체하기 위해 보존한다. */
    waitingMinutes?: number;
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
    /** The rail coordinates were checked against their source transit leg. */
    railGeometryVerified?: true;
}

export function hasRenderableRouteStepGeometry(step: RouteStep, pointCount: number): boolean {
    if (pointCount < (isIntercityBusKind(step.type) ? 3 : 2)) return false;
    return !isRailKind(step.type) || (
        step.railGeometryVerified === true &&
        !lacksIntermediateRailGeometry(step.type, pointCount, step.stationCount, step.passStops?.length ?? 0)
    );
}

export interface RouteInfo {
    /** Only the schedule detail presentation sets this on an in-memory copy. */
    matchedTimeline?: true;
    matchedTimelineBasis?: "PLANNED" | "TIMETABLE";
    intercityJourney?: IntercityJourney;
    id: string;
    /** 시간표와 경로를 제공한 공급자. 기존 저장 데이터 호환을 위해 선택값으로 유지한다. */
    provider?: RouteApiProvider;
    originName: string;
    destinationName: string;
    totalDurationMinutes: number;
    /** 원본 전체 초. 구간 합계와 임의로 맞추지 않는다. */
    totalDurationSeconds?: number;
    departureTime: string;
    arrivalTime: string;
    fare?: number;
    tollFare?: number;
    taxiFare?: number;
    transferCount?: number;
    walkingDistanceMeters?: number;
    totalDistanceMeters?: number;
    /** 실제 시간표 근거가 명시된 경우만 provider_schedule. 공급자가 계산한 예상시각도 estimated. */
    timeBasis: "provider_schedule" | "estimated" | "anchored_journey";
    /** 이전 ODsay 예상시각과 실제 시간표 연동 데이터를 구분하는 명시적 근거. */
    providerTimeBasis?: "route_estimate" | "timetable";
    /** Keeps an observed bus estimate tied to the selected appointment when it is reopened. */
    busPreviewObservation?: { sourceUpdatedAt: string; targetArrivalAt?: string };
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
    { pattern: /인천\s*1\s*호선/, color: "#7CA8D5" },
    { pattern: /인천\s*2\s*호선/, color: "#ED8B00" },
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

function validDurationSeconds(value: unknown): number | undefined {
    return isFiniteNumber(value) && value >= 0 ? value : undefined;
}

/** A timetable walk can be assigned only when a single leg represents the whole interval. */
export function getTimetableWalkSeconds(
    legs: readonly Pick<TransitLegDetail, "kind">[],
    index: number,
    ridesBeforeWalk: number,
    preview: RouteAlternativeOption["odsayTimetablePreview"],
): number | undefined {
    if (legs[index]?.kind !== "WALK") return undefined;
    if (index === 0 && legs[1]?.kind === "SUBWAY") return validDurationSeconds(preview?.entranceWalk?.seconds);
    if (!isTransitRideKind(legs[index - 1]?.kind)) return undefined;
    if (isTransitRideKind(legs[index + 1]?.kind)) {
        return validDurationSeconds(preview?.transferTimings?.[ridesBeforeWalk - 1]?.walkingSeconds);
    }
    if (index !== legs.length - 1) return undefined;
    const lastRide = preview?.rides?.[preview.rides.length - 1];
    return preview && lastRide
        ? validDurationSeconds((Date.parse(preview.arrivalAt) - Date.parse(lastRide.arrivalAt)) / 1000)
        : undefined;
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

export function formatRouteDurationSeconds(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    if (!minutes) return `${remainder}초`;
    return remainder ? `${minutes}분 ${remainder}초` : `${minutes}분`;
}

export function rideMovementDurationLabel(minutes?: number, matchedSeconds?: number): string | undefined {
    if (typeof matchedSeconds === "number" && Number.isSafeInteger(matchedSeconds) && matchedSeconds > 0) {
        return formatRouteDurationSeconds(matchedSeconds);
    }
    return typeof minutes === "number" ? `${minutes}분` : undefined;
}

export function firstBoardingIntervalLabel(seconds: number | undefined, stationArrival = false): string | undefined {
    if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds <= 0) return undefined;
    return `첫 승차 대기 약 ${formatRouteDurationSeconds(seconds)} (열차 ${stationArrival ? "도착" : "출발"} 기준)`;
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

/** Minute-only arrival labels round the displayed clock without changing the route timestamp. */
export function roundRouteArrivalMinute(value: string | Date | undefined): Date | undefined {
    const time = value instanceof Date ? value.getTime() : value ? Date.parse(value) : NaN;
    return Number.isFinite(time) ? new Date(Math.round(time / 60_000) * 60_000) : undefined;
}

export function isOdsayTimetableRouteInfo(route?: RouteInfo): boolean {
    return route?.provider === "odsay" && route.timeBasis === "provider_schedule" && route.providerTimeBasis === "timetable";
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
        .replace(/공항(?!철도)\s*[:：]?\s*/g, "")
        .replace(/버스\s*/g, "")
        .replace(/수도권\s*/g, "")
        .replace(/노선$/u, "")
        .trim();

    if (!normalized) return undefined;
    const lineMatch = normalized.match(/(?:인천|부산|대구|대전|광주)?\s*\d+\s*호선/);
    if (lineMatch?.[0]) return lineMatch[0].replace(/\s+/gu, "");
    const busNumberMatch = normalized.match(/^[A-Z]?\d{1,5}[A-Z]?/i);
    if (busNumberMatch?.[0]) return busNumberMatch[0];
    const first = normalized.split(",")[0]?.trim() ?? normalized;
    return first.length > 10 ? `${first.slice(0, 10)}...` : first;
}

const TRANSIT_GUIDANCE_LABEL_PATTERN = /정류장|승차|하차|환승|출발|도착|도보|에서|까지|방면/u;
const TRANSIT_METRIC_ONLY_PATTERN = /^\d+(?:\.\d+)?\s*(?:분|시간|정거장|m|km)$/iu;
const TRANSIT_TRAILING_METRIC_PATTERN = /\s+\d+(?:\.\d+)?\s*(?:분|시간|정거장|m|km)$/iu;
const TRANSIT_GENERIC_MODE_PATTERN = /^(?:버스|지하철|이동)$/u;

function compactTransitRideIdentity(rawValue?: string): string | undefined {
    const raw = typeof rawValue === "string" ? rawValue.trim() : undefined;
    if (
        !raw ||
        TRANSIT_GUIDANCE_LABEL_PATTERN.test(raw) ||
        TRANSIT_METRIC_ONLY_PATTERN.test(raw)
    ) return undefined;

    const withoutTrailingMetric = raw.replace(TRANSIT_TRAILING_METRIC_PATTERN, "").trim();
    if (!withoutTrailingMetric || TRANSIT_GENERIC_MODE_PATTERN.test(withoutTrailingMetric)) {
        return undefined;
    }

    const compact = compactTransitLineLabel(withoutTrailingMetric);
    if (compact && !TRANSIT_METRIC_ONLY_PATTERN.test(compact)) return compact;

    return withoutTrailingMetric.length > 10
        ? `${withoutTrailingMetric.slice(0, 10)}...`
        : withoutTrailingMetric;
}

export function findTransitRideLineLabel(leg: { lineName?: string; label?: string }): string | undefined {
    // Saved JSON/provider previews can omit the display label. Its absence is not
    // navigation evidence and must not crash the route detail's presentation.
    const candidates = [leg.lineName, ...(typeof leg.label === "string" ? leg.label.split(/[·|]/u) : [])];
    for (const candidate of candidates) {
        const identity = compactTransitRideIdentity(candidate);
        if (identity) return identity;
    }

    return undefined;
}

export function getSubwayLineColor(lineName?: string, explicitColor?: string): string {
    const normalized = lineName?.replace(/\s+/gu, "") ?? "";
    const regionalNumber = /(?:부산|대구|대전|광주)\d+호선/u.test(normalized);
    const matched = regionalNumber ? undefined : SUBWAY_LINE_COLORS.find(item => item.pattern.test(normalized));
    return matched?.color ?? normalizeHexColor(explicitColor) ?? "#64748B";
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

export function getTransitBusLineColor(leg: { lineName?: string; label?: string; lineColor?: string }): string {
    return getBusLineColor(leg.lineName?.trim() || leg.label, leg.lineColor);
}

export function getRouteStepColor(step: Pick<RouteStep, "type" | "lineName" | "lineColor">): string {
    if (step.type === "ORIGIN") return ROUTE_POINT_COLORS.origin;
    if (step.type === "DESTINATION") return ROUTE_POINT_COLORS.destination;
    if (step.type === "WALK") return ROUTE_POINT_COLORS.walk;
    if (step.type === "TRANSFER") return ROUTE_POINT_COLORS.transfer;
    if (step.type === "DRIVE") return ROUTE_POINT_COLORS.activeBlue;
    if (step.type === "BIKE") return ROUTE_POINT_COLORS.bike;
    if (step.type === "SUBWAY") return getSubwayLineColor(step.lineName, step.lineColor);
    if (step.type === "BUS") return getBusLineColor(step.lineName, step.lineColor);
    if (intercityRideColor(step.type)) return normalizeHexColor(step.lineColor) ?? intercityRideColor(step.type)!;
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

export function normalizeStopName(name?: string): string | undefined {
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
    if (!isTransitRideKind(step.type)) return undefined;

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
    const seconds = validDurationSeconds(leg.durationSeconds);
    if (seconds !== undefined) return Math.max(1, Math.round(seconds / 60));
    if (isFiniteNumber(leg.distanceMeters) && leg.distanceMeters > 0) {
        return Math.max(1, Math.round(leg.distanceMeters / (leg.kind === "WALK" ? 67 : 350)));
    }
    return undefined;
}

function buildWalkStep(leg: TransitLegDetail, index: number, timetableSeconds?: number): RouteStep {
    const durationMinutes = timetableSeconds === undefined ? legDuration(leg) : Math.ceil(timetableSeconds / 60);
    const distanceText = formatRouteDistance(leg.distanceMeters);
    const durationText = isFiniteNumber(durationMinutes) ? `${durationMinutes}분` : undefined;
    const description = [distanceText, durationText].filter(Boolean).join(" · ") || undefined;
    return {
        id: `leg-${index}`,
        type: "WALK",
        title: "도보",
        description,
        durationMinutes,
        durationSeconds: timetableSeconds ?? validDurationSeconds(leg.durationSeconds),
        distanceMeters: leg.distanceMeters,
        coordinates: pathToRouteCoordinates(leg.pathCoords),
    };
}

function buildRideStep(leg: TransitLegDetail, index: number, scheduledRide?: RouteStep["scheduledRide"]): RouteStep {
    const type = isTransitRideKind(leg.kind) ? leg.kind : "UNKNOWN";
    const hasLineGeometry = hasTransitLegLineGeometry(leg);
    const lineName = type === "SUBWAY"
        ? findTransitRideLineLabel(leg)
        : compactTransitLineLabel(leg.lineName) ?? compactTransitLineLabel(leg.label) ?? leg.lineName ?? leg.label;
    const lineColor = type === "BUS"
        ? getTransitBusLineColor(leg)
        : type === "SUBWAY"
            ? getSubwayLineColor(lineName, leg.lineColor)
            : normalizeHexColor(leg.lineColor) ?? intercityRideColor(type);
    const startName = normalizeStopName(leg.startName);
    const endName = normalizeStopName(leg.endName);
    const fallbackKind = transitModeLabel(type);
    const timetableSeconds = scheduledRide && validDurationSeconds(
        (Date.parse(scheduledRide.arrivalAt) - Date.parse(scheduledRide.boardingAt)) / 1000,
    );
    const durationMinutes = timetableSeconds === undefined ? legDuration(leg) : Math.ceil(timetableSeconds / 60);
    const stationText = isFiniteNumber(leg.stationCount) ? `${leg.stationCount}정거장` : undefined;
    const durationText = isFiniteNumber(durationMinutes) ? `${durationMinutes}분` : undefined;
    const passStops = leg.passStops
        ?.map((stop, sourceIndex) => ({
            name: normalizeStopName(stop.name) ?? stop.name,
            sequence: stop.sequence,
            code: stop.code,
            sourceIndex,
        }))
        .filter((stop) => !!stop.name);
    return {
        id: `leg-${index}`,
        type,
        title: startName ?? lineName ?? fallbackKind,
        alightingName: endName,
        description: [destinationHint(endName), stationText, durationText, leg.intercityService && `${leg.intercityService.timingBasis === 'TICKET' ? '승차권 입력' : '시간표'} ${serviceTimeRange(leg.intercityService)} · ${leg.intercityService.timingBasis === 'TICKET' ? '예매 상태 미검증' : '예매 미확인'}`].filter(Boolean).join(" · ") || undefined,
        durationMinutes,
        intercityService: leg.intercityService,
        waitingMinutes: leg.waitingMinutes,
        durationSeconds: timetableSeconds ?? validDurationSeconds(leg.durationSeconds),
        ...(scheduledRide && { scheduledRide }),
        distanceMeters: leg.distanceMeters,
        stationCount: leg.stationCount,
        lineName,
        lineColor,
        badgeText: isIntercityRideKind(type) ? [transitModeLabel(type), lineName].filter(Boolean).join(" · ") : lineName,
        directionName: leg.directionName,
        directionCode: leg.directionCode,
        boardingPlatform: leg.boardingPlatform,
        boardingExit: leg.boardingExit,
        recommendedBoardingPosition: leg.recommendedBoardingPosition,
        recommendedTransferPosition: leg.recommendedTransferPosition,
        passStops,
        coordinates: hasLineGeometry
            ? pathToRouteCoordinates(leg.pathCoords)
            : undefined,
        railGeometryVerified: isRailKind(leg.kind) && hasLineGeometry ? true : undefined,
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

function buildRouteSteps(
    option: RouteAlternativeOption,
    origin?: Place,
    destination?: Place,
    useTimetable = false,
): RouteStep[] {
    const originName = placeName(origin, "출발지");
    const destinationName = placeName(destination, "도착지");
    const steps: RouteStep[] = [{
        id: "origin",
        type: "ORIGIN",
        title: originName,
        coordinates: placeToRouteCoordinates(origin),
    }];

    const legs = Array.isArray(option.transitLegs) ? option.transitLegs : [];
    const timetable = useTimetable ? option.odsayTimetablePreview : undefined;
    const bus = option.odsayBusPreview;
    const busIndex = bus ? legs.findIndex(leg => leg.kind === "BUS") : -1;
    const lastBusIndex = bus?.transfer ? legs.findIndex((leg, index) => index > busIndex && leg.kind === "BUS") : busIndex;
    const accessIndex = bus && busIndex > 0 ? 0 : -1;
    const egressIndex = bus && lastBusIndex < legs.length - 1 ? legs.length - 1 : -1;
    const entrance = timetable?.entranceWalk;
    if (entrance && legs[0]?.kind === "SUBWAY") {
        steps.push({
            id: "odsay-entrance-walk",
            type: "WALK",
            title: "역 출구까지 도보",
            durationMinutes: Math.ceil(entrance.seconds / 60),
            durationSeconds: entrance.seconds,
            distanceMeters: entrance.distanceMeters,
        });
    }
    let rideIndex = 0;
    if (legs.length > 0) {
        legs.forEach((leg, index) => {
            if (leg.kind === "WALK") {
                const boundary = index === 0 && legs[1]?.kind === "SUBWAY" ? timetable?.entranceWalk
                    : index === legs.length - 1 && legs[index - 1]?.kind === "SUBWAY" ? timetable?.exitWalk : undefined;
                const walk = boundary && boundary.distanceMeters !== leg.distanceMeters
                    ? { ...leg, pathCoords: undefined, distanceMeters: boundary.distanceMeters } : leg;
                const busWalkSeconds = index === accessIndex && busIndex === 1 ? bus?.accessSeconds
                    : index === egressIndex && lastBusIndex === legs.length - 2 ? bus?.egressSeconds
                        : bus?.transfer && lastBusIndex === busIndex + 2 && index === busIndex + 1
                            ? bus.transfer.walkingSeconds : undefined;
                steps.push(buildWalkStep(walk, index, busWalkSeconds ??
                    getTimetableWalkSeconds(legs, index, rideIndex, timetable)));
            } else if (isTransitRideKind(leg.kind)) {
                if (bus && index === busIndex) {
                    const wait = (Date.parse(bus.boardingAt) - Date.parse(bus.departureAt)) / 1000 - bus.accessSeconds;
                    const seconds = (Date.parse(bus.transfer?.firstAlightingAt ?? bus.alightingAt) - Date.parse(bus.boardingAt)) / 1000 + wait;
                    steps.push(buildRideStep({ ...leg, durationSeconds: seconds, durationMinutes: Math.ceil(seconds / 60),
                        waitingMinutes: Math.ceil(wait / 60) }, index));
                } else if (bus?.transfer && index === lastBusIndex) {
                    const ready = Date.parse(bus.transfer.firstAlightingAt) + bus.transfer.walkingSeconds * 1000;
                    const wait = (Date.parse(bus.transfer.secondBoardingAt) - ready) / 1000;
                    const seconds = (Date.parse(bus.alightingAt) - ready) / 1000;
                    steps.push(buildRideStep({ ...leg, durationSeconds: seconds, durationMinutes: Math.ceil(seconds / 60),
                        waitingMinutes: Math.ceil(wait / 60) }, index));
                } else steps.push(buildRideStep(leg, index, timetable?.rides?.[rideIndex]));
                rideIndex++;
            } else {
                steps.push({
                    id: `leg-${index}`,
                    type: leg.journeyPhase === "BUFFER" ? "TRANSFER" : "UNKNOWN",
                    ...(leg.journeyPhase && { journeyPhase: leg.journeyPhase }),
                    title: leg.label || "이동 수단 확인",
                    description: buildWalkStep(leg, index).description,
                    durationMinutes: legDuration(leg),
                    durationSeconds: validDurationSeconds(leg.durationSeconds),
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
            durationSeconds: validTotalDurationSeconds(option.totalDurationSeconds),
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
    const timetablePreview = option.odsayTimetablePreview;
    const bus = option.odsayBusPreview;
    const providerDeparture = timetablePreview?.departureAt ?? bus?.departureAt ?? option.providerDepartureAt;
    const providerArrival = timetablePreview?.arrivalAt ?? bus?.arrivalAt ?? option.providerArrivalAt;
    const providerDepartureAt = providerDeparture ? new Date(providerDeparture) : undefined;
    const providerArrivalAt = providerArrival ? new Date(providerArrival) : undefined;
    const hasProviderTimes = !!providerDepartureAt &&
        !!providerArrivalAt &&
        Number.isFinite(providerDepartureAt.getTime()) &&
        Number.isFinite(providerArrivalAt.getTime()) &&
        providerArrivalAt.getTime() >= providerDepartureAt.getTime();
    // maasRP의 start/endDateTime은 시간표가 아니라 SearchTime + 구간 시간이다.
    // 시각 필드 존재만으로 시간표로 승격하면 심야에도 운행이 확정된 것처럼 저장된다.
    const hasProviderSchedule = hasProviderTimes && (timetablePreview !== undefined || option.providerTimeBasis === "timetable");
    const effectiveDepartureAt = hasProviderTimes ? providerDepartureAt : departureAt;
    const plannedSeconds = hasProviderTimes && (timetablePreview || bus)
        ? (providerArrivalAt.getTime() - providerDepartureAt.getTime()) / 1000
        : undefined;
    const totalDurationSeconds = validTotalDurationSeconds(plannedSeconds ?? option.totalDurationSeconds, effectiveDepartureAt.getTime());
    const totalDurationMinutes = plannedSeconds !== undefined
        ? Math.ceil(plannedSeconds / 60)
        : Math.max(0, Math.round(option.minutes ?? 0));
    // maasRP endDateTime is minute-granular. An exact route estimate from validated walk links
    // must carry its own destination time so saving can verify the elapsed seconds.
    const usesOdsayEstimateSeconds = option.provider === "odsay" && option.providerTimeBasis === "route_estimate" &&
        !hasProviderSchedule && totalDurationSeconds !== undefined;
    const arrivalAt = hasProviderTimes && (bus || !usesOdsayEstimateSeconds)
        ? providerArrivalAt
        : new Date(effectiveDepartureAt.getTime() + (totalDurationSeconds ?? totalDurationMinutes * 60) * 1000);
    // Incomplete saved/provider previews are still renderable, but a missing
    // duration must not become a fabricated "depart/arrive now" timetable.
    const timingKnown = hasProviderTimes || (isFiniteNumber(option.minutes) && option.minutes >= 0);
    const legs = option.transitLegs ?? [];
    const first = legs[0], last = legs[legs.length - 1];
    const accessDelta = timetablePreview?.entranceWalk && (first?.kind === "SUBWAY" || isFiniteNumber(first?.distanceMeters))
        ? timetablePreview.entranceWalk.distanceMeters - (first?.kind === "WALK" ? first.distanceMeters ?? 0 : 0) : 0;
    const exitDelta = timetablePreview?.exitWalk && last?.kind === "WALK" && isFiniteNumber(last.distanceMeters)
        ? timetablePreview.exitWalk.distanceMeters - last.distanceMeters : 0;
    const walkingDelta = accessDelta + exitDelta;
    return {
        id: option.id || `route-${routeIndex}`,
        provider: option.provider,
        originName: placeName(origin, "출발지"),
        destinationName: placeName(destination, "도착지"),
        totalDurationMinutes,
        totalDurationSeconds,
        departureTime: timingKnown ? effectiveDepartureAt.toISOString() : "",
        arrivalTime: timingKnown ? arrivalAt.toISOString() : "",
        fare: option.fareWon,
        tollFare: option.tollFareWon,
        taxiFare: option.taxiFareWon,
        transferCount: option.transferCount,
        walkingDistanceMeters: isFiniteNumber(option.walkMeters) ? option.walkMeters + walkingDelta : undefined,
        totalDistanceMeters: isFiniteNumber(option.distanceMeters) ? option.distanceMeters + walkingDelta : undefined,
        timeBasis: option.intercityJourney ? "anchored_journey" : hasProviderSchedule ? "provider_schedule" : "estimated",
        intercityJourney: option.intercityJourney,
        providerTimeBasis: hasProviderSchedule && timetablePreview ? "timetable"
            : bus ? "route_estimate" : option.providerTimeBasis,
        ...(bus && { busPreviewObservation: { sourceUpdatedAt: bus.sourceUpdatedAt, targetArrivalAt: bus.targetArrivalAt } }),
        steps: buildRouteSteps(option, origin, destination, hasProviderSchedule),
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
        (route.timeBasis === undefined || route.timeBasis === "provider_schedule" || route.timeBasis === "estimated" || route.timeBasis === "anchored_journey") &&
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
    if (isRouteInfo(route)) return normalizeStoredRoute(route);
    const routeObject = route as Record<string, unknown> | undefined;
    if (isRouteInfo(routeObject?.routeInfo)) return normalizeStoredRoute(routeObject.routeInfo);

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

/** Compares the route shown in a draft, independent of the candidate's ranking ID. */
export function isSameScheduleDraftRoute(current: RouteInfo | undefined, next: RouteInfo | undefined): boolean {
    return !!current && !!next &&
        current.originName === next.originName &&
        current.destinationName === next.destinationName &&
        current.totalDurationMinutes === next.totalDurationMinutes &&
        current.fare === next.fare &&
        current.departureTime === next.departureTime &&
        JSON.stringify(current.steps) === JSON.stringify(next.steps);
}

function normalizeStoredRoute(route: RouteInfo): RouteInfo {
    const steps = route.steps.map(step => {
        if (step.type !== "SUBWAY") return step;
        const lineName = findTransitRideLineLabel({ lineName: step.lineName, label: step.badgeText });
        if (!lineName) return step;
        const lineColor = getSubwayLineColor(lineName, step.lineColor);
        if (step.lineName === lineName && step.badgeText === lineName && step.lineColor === lineColor) return step;
        return { ...step, lineName, lineColor, badgeText: lineName };
    });
    if (steps.some((step, index) => step !== route.steps[index])) route = { ...route, steps };
    // DB를 덮어쓰지 않고 읽기 경계에서 구버전 maasRP의 과도한 시간표 표기를 바로잡는다.
    if (route.provider === "odsay" && route.timeBasis === "provider_schedule" && route.providerTimeBasis !== "timetable") {
        return { ...route, timeBasis: "estimated", providerTimeBasis: "route_estimate" };
    }
    return route;
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
        .filter((step) => step.type === "WALK" || isTransitRideKind(step.type))
        .map((step) => ({
            id: step.id,
            label: step.type === "WALK" ? "도보" : (step.badgeText ?? step.lineName ?? transitModeLabel(step.type)),
            color: getRouteStepColor(step),
            type: step.type,
        }));
}
