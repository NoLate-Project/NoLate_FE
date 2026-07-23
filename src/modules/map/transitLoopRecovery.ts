import type {
    RoutePathCoord,
    TransitLegDetail,
    TransitPassStop,
    TransitRouteOption,
} from "./tmapApi";

type TransitEndpoint = RoutePathCoord & { name?: string };

export type TransitLoopRecoveryPlan = {
    anchor: TransitEndpoint;
    directOption: TransitRouteOption;
    lineToken: string;
    origin: TransitEndpoint;
    destination: TransitEndpoint;
};

const SEOUL_LINE_2_ANCHORS: TransitEndpoint[] = [
    { name: "성수", lat: 37.544581, lng: 127.055961 },
    { name: "을지로3가", lat: 37.566295, lng: 126.991910 },
    { name: "홍대입구", lat: 37.557192, lng: 126.925381 },
    { name: "신도림", lat: 37.508725, lng: 126.891295 },
    { name: "사당", lat: 37.476538, lng: 126.981544 },
    { name: "강남", lat: 37.497990, lng: 127.027912 },
    { name: "잠실", lat: 37.513262, lng: 127.100133 },
];

const LOOP_LINE_ANCHORS: Record<string, TransitEndpoint[]> = {
    "2호선": SEOUL_LINE_2_ANCHORS,
};

const EARTH_RADIUS_METERS = 6_371_000;
const MIN_RECOVERY_DIRECT_DISTANCE_METERS = 7_000;
const MIN_RECOVERY_EXTRA_DISTANCE_METERS = 8_000;
const MIN_RECOVERY_DETOUR_RATIO = 1.5;
const MIN_RECOVERY_TIME_SAVING_MINUTES = 6;

function toRadians(value: number): number {
    return value * Math.PI / 180;
}

function distanceMeters(from: RoutePathCoord, to: RoutePathCoord): number {
    const deltaLat = toRadians(to.lat - from.lat);
    const deltaLng = toRadians(to.lng - from.lng);
    const fromLat = toRadians(from.lat);
    const toLat = toRadians(to.lat);
    const haversine = Math.sin(deltaLat / 2) ** 2 +
        Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) ** 2;
    return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function normalizeStationToken(value?: string): string {
    return (value ?? "")
        .replace(/\([^)]*\)/g, "")
        .replace(/\s+/g, "")
        .replace(/역$/u, "")
        .trim()
        .toLowerCase();
}

function normalizeLineToken(value?: string): string {
    const normalized = (value ?? "")
        .replace(/\([^)]*\)/g, "")
        .replace(/수도권|서울|지하철|도시철도/gu, "")
        .replace(/\s+/g, "")
        .trim();
    if (normalized.includes("2호선")) return "2호선";
    return normalized.toLowerCase();
}

function getRideLegs(option: TransitRouteOption): TransitLegDetail[] {
    return (option.transitLegs ?? []).filter((leg) => leg.kind === "BUS" || leg.kind === "SUBWAY");
}

function getSingleSubwayRide(option: TransitRouteOption, lineToken?: string): TransitLegDetail | undefined {
    const rides = getRideLegs(option);
    if (rides.length !== 1 || rides[0].kind !== "SUBWAY") return undefined;
    if (lineToken && normalizeLineToken(rides[0].lineName) !== lineToken) return undefined;
    return rides[0];
}

function optionDistanceMeters(option: TransitRouteOption): number | undefined {
    if (typeof option.distanceMeters === "number" && Number.isFinite(option.distanceMeters)) {
        return option.distanceMeters;
    }
    return undefined;
}

function isAnchorOnReturnedArc(anchor: TransitEndpoint, ride: TransitLegDetail): boolean {
    const anchorToken = normalizeStationToken(anchor.name);
    return (ride.passStops ?? []).some((stop) => normalizeStationToken(stop.name) === anchorToken);
}

/**
 * 순환선에서 공급자가 긴 방향만 반환한 경우에만 복구 계획을 만든다.
 * 일반 철도 우회나 환승 경로에는 추가 API 호출을 하지 않는다.
 */
export function createTransitLoopRecoveryPlan(
    options: TransitRouteOption[],
    origin: TransitEndpoint,
    destination: TransitEndpoint
): TransitLoopRecoveryPlan | undefined {
    const directDistance = distanceMeters(origin, destination);
    if (directDistance < MIN_RECOVERY_DIRECT_DISTANCE_METERS) return undefined;

    for (const directOption of options) {
        if ((directOption.transferCount ?? 0) !== 0) continue;
        const ride = getSingleSubwayRide(directOption);
        if (!ride) continue;

        const lineToken = normalizeLineToken(ride.lineName);
        const anchors = LOOP_LINE_ANCHORS[lineToken];
        if (!anchors?.length) continue;

        const routeDistance = optionDistanceMeters(directOption);
        if (!routeDistance) continue;
        const extraDistance = routeDistance - directDistance;
        if (
            routeDistance / directDistance < MIN_RECOVERY_DETOUR_RATIO ||
            extraDistance < MIN_RECOVERY_EXTRA_DISTANCE_METERS
        ) {
            continue;
        }

        const candidates = anchors
            .filter((anchor) => distanceMeters(origin, anchor) > 1_000)
            .filter((anchor) => distanceMeters(destination, anchor) > 1_000)
            .filter((anchor) => !isAnchorOnReturnedArc(anchor, ride))
            .map((anchor) => ({
                anchor,
                score: distanceMeters(origin, anchor) + distanceMeters(anchor, destination),
            }))
            .sort((a, b) => a.score - b.score);

        if (candidates[0]) {
            return {
                anchor: candidates[0].anchor,
                directOption,
                lineToken,
                origin,
                destination,
            };
        }
    }

    return undefined;
}

function stationMatches(value: string | undefined, expected: string | undefined): boolean {
    const valueToken = normalizeStationToken(value);
    const expectedToken = normalizeStationToken(expected);
    return !!valueToken && !!expectedToken && valueToken === expectedToken;
}

export function selectTransitLoopSubroute(
    options: TransitRouteOption[],
    lineToken: string,
    anchor: TransitEndpoint,
    position: "TO_ANCHOR" | "FROM_ANCHOR"
): TransitRouteOption | undefined {
    return options
        .filter((option) => {
            if ((option.transferCount ?? 0) !== 0) return false;
            const ride = getSingleSubwayRide(option, lineToken);
            if (!ride) return false;
            return position === "TO_ANCHOR"
                ? stationMatches(ride.endName, anchor.name)
                : stationMatches(ride.startName, anchor.name);
        })
        .sort((a, b) => a.minutes - b.minutes)[0];
}

function dedupePassStops(stops: TransitPassStop[]): TransitPassStop[] {
    const result: TransitPassStop[] = [];
    for (const stop of stops) {
        const previous = result[result.length - 1];
        if (previous && normalizeStationToken(previous.name) === normalizeStationToken(stop.name)) continue;
        result.push({ ...stop, sequence: result.length + 1 });
    }
    return result;
}

function dedupePathCoords(coords: RoutePathCoord[]): RoutePathCoord[] {
    const result: RoutePathCoord[] = [];
    for (const coord of coords) {
        const previous = result[result.length - 1];
        if (previous && distanceMeters(previous, coord) < 1) continue;
        result.push(coord);
    }
    return result;
}

function mergePaths(legs: TransitLegDetail[]): RoutePathCoord[] | undefined {
    const coords = legs.flatMap((leg) => leg.pathCoords ?? []);
    const deduped = dedupePathCoords(coords);
    return deduped.length >= 2 ? deduped : undefined;
}

function sumLegNumber(legs: TransitLegDetail[], key: "durationMinutes" | "distanceMeters"): number | undefined {
    const values = legs
        .map((leg) => leg[key])
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return values.length ? values.reduce((total, value) => total + value, 0) : undefined;
}

function omitSyntheticStationAccess(
    legs: TransitLegDetail[],
    endpoint: TransitEndpoint,
    stationName: string | undefined
): TransitLegDetail[] {
    if (!stationMatches(endpoint.name, stationName)) return legs;
    const distance = sumLegNumber(legs, "distanceMeters") ?? Number.POSITIVE_INFINITY;
    const duration = sumLegNumber(legs, "durationMinutes") ?? Number.POSITIVE_INFINITY;
    return distance <= 250 && duration <= 5 ? [] : legs;
}

function buildMergedRide(
    leftRide: TransitLegDetail,
    rightRide: TransitLegDetail
): TransitLegDetail {
    const passStops = dedupePassStops([
        ...(leftRide.passStops ?? []),
        ...(rightRide.passStops ?? []),
    ]);
    const pathCoords = mergePaths([leftRide, rightRide]);
    const durationMinutes = sumLegNumber([leftRide, rightRide], "durationMinutes");
    const distance = sumLegNumber([leftRide, rightRide], "distanceMeters");
    const stationCount = passStops.length >= 2
        ? passStops.length - 1
        : (leftRide.stationCount ?? 0) + (rightRide.stationCount ?? 0);
    const lineName = leftRide.lineName ?? rightRide.lineName;

    return {
        kind: "SUBWAY",
        label: [
            "지하철",
            lineName,
            stationCount > 0 ? `${stationCount}정거장` : undefined,
            typeof durationMinutes === "number" ? `${Math.round(durationMinutes)}분` : undefined,
        ].filter(Boolean).join(" "),
        durationMinutes,
        distanceMeters: distance,
        stationCount: stationCount || undefined,
        lineName,
        lineColor: leftRide.lineColor ?? rightRide.lineColor,
        startName: leftRide.startName,
        endName: rightRide.endName,
        startCoord: leftRide.startCoord ?? pathCoords?.[0],
        endCoord: rightRide.endCoord ?? pathCoords?.[pathCoords.length - 1],
        passStops,
        pathCoords,
        pathCoordsIsExact: leftRide.pathCoordsIsExact === true && rightRide.pathCoordsIsExact === true,
        pathGeometrySource: leftRide.pathCoordsIsExact === true && rightRide.pathCoordsIsExact === true
            ? "TRANSIT_PASS_SHAPE_LINESTRING"
            : "ITINERARY_PATH_SNAP",
        rawPathPointCount: pathCoords?.length,
        serviceAvailable: leftRide.serviceAvailable !== false && rightRide.serviceAvailable !== false,
    };
}

/** 같은 순환선의 두 정밀 shape를 하나의 무환승 경로로 결합한다. */
export function buildRecoveredLoopTransitOption(
    plan: TransitLoopRecoveryPlan,
    leftOption: TransitRouteOption,
    rightOption: TransitRouteOption
): TransitRouteOption | undefined {
    const directLegs = plan.directOption.transitLegs ?? [];
    const directRideIndex = directLegs.findIndex((leg) => leg.kind === "SUBWAY" || leg.kind === "BUS");
    const leftRide = getSingleSubwayRide(leftOption, plan.lineToken);
    const rightRide = getSingleSubwayRide(rightOption, plan.lineToken);
    if (directRideIndex < 0 || !leftRide || !rightRide) return undefined;

    const prefix = omitSyntheticStationAccess(
        directLegs.slice(0, directRideIndex).filter((leg) => leg.kind === "WALK"),
        plan.origin,
        leftRide.startName
    );
    const suffix = omitSyntheticStationAccess(
        directLegs.slice(directRideIndex + 1).filter((leg) => leg.kind === "WALK"),
        plan.destination,
        rightRide.endName
    );
    const mergedRide = buildMergedRide(leftRide, rightRide);
    if (!mergedRide.pathCoordsIsExact || !mergedRide.pathCoords?.length) return undefined;

    const transitLegs = [...prefix, mergedRide, ...suffix];
    const minutes = Math.max(1, Math.round(sumLegNumber(transitLegs, "durationMinutes") ?? 0));
    const distance = sumLegNumber(transitLegs, "distanceMeters");
    const pathCoords = mergePaths(transitLegs);
    if (!pathCoords || minutes > plan.directOption.minutes - MIN_RECOVERY_TIME_SAVING_MINUTES) return undefined;
    if (distance && plan.directOption.distanceMeters && distance >= plan.directOption.distanceMeters * 0.9) return undefined;

    const walkMeters = sumLegNumber([...prefix, ...suffix], "distanceMeters");
    return {
        ...plan.directOption,
        id: `loop-recovered-${plan.directOption.id}`,
        minutes,
        distanceMeters: distance,
        transferCount: 0,
        walkMeters,
        transitLegs,
        pathCoords,
        stepSummary: transitLegs.map((leg) => leg.label).slice(0, 4).join(" → "),
        transitModeSummary: prefix.length || suffix.length ? "지하철 · 도보" : "지하철",
    };
}
