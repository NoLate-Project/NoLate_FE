import type { Place } from "../schedule/types";
import {
    compactTransitLineLabel,
    getBusLineColor,
    getSubwayLineColor,
} from "../schedule/routeInfo";
import type {
    RouteAlternativeOption,
    RoutePathCoord,
    TransitGeometrySource,
    TransitLegDetail,
} from "./routingService";
import type { TmapLatLng, TmapMarker, TmapPathOverlay } from "./TmapMapView";
import { getRouteEndpointMarkerPresentation } from "./routeMarkerPresentation";
import {
    applyTransitRouteThemeToOverlay,
    getFallbackRouteStrokePresentation,
    getTransitNativeDirectionOpacity,
    getTransitRouteLinePresentation,
    getTransitRouteThemePresentation,
    shouldRenderTransitNativeDirection,
    TRANSIT_WALK_DASH_PATTERN,
} from "./transitRoutePresentation";
import { selectTransitRouteLabelCoordinate } from "./transitRouteLabelPlacement";
import {
    getTransitEventMarkerPresentation,
    getTransitModeMarkerStyle,
    shouldShowTransitRouteIdentityLabel,
} from "./transitMarkerPresentation";
import { isRedundantEndpointTransitEvent } from "./transitMarkerHierarchy";
import {
    buildTransitLegInteractionId,
    buildTransitStopInteractionId,
} from "./transitMapInteraction";
import {
    routeCoordDistanceMeters,
    TRANSIT_CONNECTOR_POLICY,
} from "./transitRouteGeometry";
import { getTransitBoardingDirectionHint } from "./transitStopLabelPresentation";
import {
    allocateTransitStopMarkerCounts,
    getTransitStopMarkerPolicy,
    sampleTransitStopIndices,
    type TransitStopMarkerKind,
} from "./transitStopVisibility";

const WALK_GUIDE_COLOR = "#1A73E8";
const ETC_GUIDE_COLOR = "#64748B";
const WALK_CASING_COLOR = "#FFFFFF";
const TRANSIT_CASING_COLOR = "#FFFFFF";
const DIRECTION_COLOR = "#FFFFFF";
const ORIGIN_COLOR = "#12A150";
const DESTINATION_COLOR = "#F04452";

type SavedRouteMapPresentationInput = {
    route: unknown;
    origin?: Place;
    destination?: Place;
    mapZoom: number;
    isDark: boolean;
    focusedLegIndex?: number;
};

export type SavedRouteMapPresentation = {
    routeOption?: RouteAlternativeOption;
    routeLegs: TransitLegDetail[];
    pathCoords: TmapLatLng[];
    pathOverlays: TmapPathOverlay[];
    markers: TmapMarker[];
    fitCoords: TmapLatLng[];
};

type StoredPathOverlay = {
    id?: unknown;
    coords?: unknown;
    color?: unknown;
    width?: unknown;
    opacity?: unknown;
    outlineColor?: unknown;
    outlineWidth?: unknown;
    outlineOpacity?: unknown;
    dashPattern?: unknown;
    strokeStyle?: unknown;
    outlineStrokeStyle?: unknown;
    renderMode?: unknown;
    shape?: unknown;
    nativeDirection?: unknown;
    nativeDirectionColor?: unknown;
    nativeDirectionOpacity?: unknown;
    zIndex?: unknown;
    geometrySource?: unknown;
    transitLegIndex?: unknown;
};

type RestorablePathOverlay = TmapPathOverlay & {
    geometrySource?: string;
    transitLegIndex?: number;
};

type TrustedStoredWalkGeometrySource =
    | "WALK_STEPS_LINESTRING"
    | "WALK_PASS_SHAPE_LINESTRING"
    | "WALK_API_DETAIL";

export type StoredRouteOverlayGeometryProvenance = {
    geometrySource: TrustedStoredWalkGeometrySource;
    transitLegIndex: number;
};

type PersistableRouteGeometrySegment = {
    id: string;
    sequence: number;
    mode: string;
    geometrySource?: TransitGeometrySource | "START_END_ONLY" | "WALK_API_DETAIL";
};

function isTrustedStoredWalkGeometrySource(
    value: unknown
): value is TrustedStoredWalkGeometrySource {
    return value === "WALK_STEPS_LINESTRING" ||
        value === "WALK_PASS_SHAPE_LINESTRING" ||
        value === "WALK_API_DETAIL";
}

/** 상세 overlay가 실제로 존재할 때 공급자 출처를 유지하거나 별도 WALK API 출처를 부여한다. */
export function resolveDetailedWalkGeometrySource(
    legSource: TransitGeometrySource | "START_END_ONLY" | "WALK_API_DETAIL" | undefined
): TrustedStoredWalkGeometrySource {
    return isTrustedStoredWalkGeometrySource(legSource)
        ? legSource
        : "WALK_API_DETAIL";
}

/**
 * route-planner의 정규화 과정에서 `walk-leg-{index}`가 `segment-{index}`로 바뀌더라도
 * 저장본에 상세 WALK geometry의 출처와 원래 leg index를 함께 남긴다.
 */
export function getStoredRouteOverlayGeometryProvenance(
    overlayId: string,
    segments: readonly PersistableRouteGeometrySegment[] | undefined
): StoredRouteOverlayGeometryProvenance | undefined {
    if (!Array.isArray(segments)) return undefined;
    const segment = segments.find((item) => {
        if (overlayId === item.id) return true;
        const partPrefix = `${item.id}-part-`;
        return overlayId.startsWith(partPrefix) && /^\d+$/.test(overlayId.slice(partPrefix.length));
    });
    if (!segment || (segment.mode !== "WALK" && segment.mode !== "TRANSFER")) return undefined;
    if (!isTrustedStoredWalkGeometrySource(segment.geometrySource)) return undefined;
    if (!Number.isInteger(segment.sequence) || segment.sequence < 0) return undefined;
    return {
        geometrySource: segment.geometrySource,
        transitLegIndex: segment.sequence,
    };
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function toRouteCoord(value: unknown): RoutePathCoord | undefined {
    if (!value || typeof value !== "object") return undefined;
    const point = value as {
        lat?: unknown;
        lng?: unknown;
        latitude?: unknown;
        longitude?: unknown;
        coord?: unknown;
    };
    if (point.coord) return toRouteCoord(point.coord);
    const lat = point.lat ?? point.latitude;
    const lng = point.lng ?? point.longitude;
    if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return undefined;
    return { lat, lng };
}

function toMapCoord(value: unknown): TmapLatLng | undefined {
    const coord = toRouteCoord(value);
    return coord ? { latitude: coord.lat, longitude: coord.lng } : undefined;
}

function mapCoords(values: unknown): TmapLatLng[] {
    if (!Array.isArray(values)) return [];
    return values.flatMap((value) => {
        const coord = toMapCoord(value);
        return coord ? [coord] : [];
    });
}

function routeCoords(values: unknown): RoutePathCoord[] {
    if (!Array.isArray(values)) return [];
    return values.flatMap((value) => {
        const coord = toRouteCoord(value);
        return coord ? [coord] : [];
    });
}

function distinctMapCoords(coords: TmapLatLng[]): TmapLatLng[] {
    const seen = new Set<string>();
    return coords.filter((coord) => {
        const key = `${coord.latitude.toFixed(6)}:${coord.longitude.toFixed(6)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function getSavedRouteAlternative(route: unknown): RouteAlternativeOption | undefined {
    if (!route || typeof route !== "object") return undefined;
    const candidate = route as Partial<RouteAlternativeOption>;
    if (typeof candidate.id !== "string") return undefined;
    if (!["CAR", "TRANSIT", "WALK", "BIKE", "ETC"].includes(candidate.mode ?? "")) return undefined;
    return candidate as RouteAlternativeOption;
}

export function getSavedTransitLegCoords(leg: TransitLegDetail): TmapLatLng[] {
    const pathCoords = mapCoords(leg.pathCoords);
    if (pathCoords.length >= 2) return pathCoords;

    return distinctMapCoords([
        toMapCoord(leg.startCoord),
        ...(leg.passStops ?? []).flatMap((stop) => {
            const coord = toMapCoord(stop.coord);
            return coord ? [coord] : [];
        }),
        toMapCoord(leg.endCoord),
    ].filter((coord): coord is TmapLatLng => !!coord));
}

function getExplicitSavedRouteRootPathCoords(route: unknown): TmapLatLng[] {
    const rootPath = mapCoords((route as { pathCoords?: unknown } | undefined)?.pathCoords);
    return rootPath.length >= 2 ? rootPath : [];
}

function getSavedRoutePathCoords(route: unknown, legs: TransitLegDetail[]): TmapLatLng[] {
    const rootPath = getExplicitSavedRouteRootPathCoords(route);
    if (rootPath.length >= 2) return rootPath;
    return distinctMapCoords(legs.flatMap(getSavedTransitLegCoords));
}

/** 저장 presentation 중 실제로 채택될 geometry만 사용해 고정 bounds를 만든다. */
export function getSavedRouteFitCoords(
    route: unknown,
    origin?: Place,
    destination?: Place
): TmapLatLng[] {
    const routeOption = getSavedRouteAlternative(route);
    const legs = Array.isArray(routeOption?.transitLegs) ? routeOption.transitLegs : [];
    const storedOverlays = parseStoredPathOverlays(route);
    let activeGeometry: TmapLatLng[];

    if (routeOption?.mode === "TRANSIT" && legs.length > 0) {
        const assignments = getStoredTransitOverlayAssignments(storedOverlays, legs);
        const storedOverlayIndexByLeg = new Map(
            [...assignments].map(([overlayIndex, legIndex]) => [legIndex, overlayIndex])
        );
        const legGeometry = legs.flatMap((leg, legIndex) => {
            const overlayIndex = storedOverlayIndexByLeg.get(legIndex);
            return typeof overlayIndex === "number"
                ? storedOverlays[overlayIndex]?.coords ?? getSavedTransitLegCoords(leg)
                : getSavedTransitLegCoords(leg);
        });
        const hasMissingLegGeometry = legs.some((leg) => getSavedTransitLegCoords(leg).length < 2);
        const routeFallback = hasMissingLegGeometry
            ? getExplicitSavedRouteRootPathCoords(route)
            : [];
        activeGeometry = routeFallback.length >= 2
            ? [...routeFallback, ...legGeometry]
            : legGeometry;
    } else if (storedOverlays.length > 0) {
        activeGeometry = storedOverlays.flatMap((overlay) => overlay.coords);
    } else {
        activeGeometry = getSavedRoutePathCoords(route, legs);
    }

    return distinctMapCoords([
        ...activeGeometry,
        ...[toMapCoord(origin), toMapCoord(destination)]
            .filter((coord): coord is TmapLatLng => !!coord),
    ]);
}

function getLegLineColor(leg: TransitLegDetail): string {
    if (leg.kind === "BUS") return getBusLineColor(leg.lineName ?? leg.label, leg.lineColor);
    if (leg.kind === "SUBWAY") {
        const explicit = leg.lineColor?.trim();
        if (explicit && /^#?[0-9A-Fa-f]{6}$/.test(explicit)) {
            return explicit.startsWith("#") ? explicit : `#${explicit}`;
        }
        return getSubwayLineColor(leg.lineName ?? leg.label);
    }
    return leg.kind === "ETC" ? ETC_GUIDE_COLOR : WALK_GUIDE_COLOR;
}

function parseStoredPathOverlays(route: unknown): RestorablePathOverlay[] {
    const stored = (route as { storedPathOverlays?: unknown } | undefined)?.storedPathOverlays;
    if (!Array.isArray(stored)) return [];

    return stored.flatMap((value, index): RestorablePathOverlay[] => {
        const raw = value as StoredPathOverlay;
        // 과거 screen-space 점·화살표 레이어는 최신 native Polyline과 함께 복원하지 않는다.
        if (raw.renderMode === "screen") return [];
        const coords = mapCoords(raw.coords);
        if (coords.length < 2) return [];
        const dashPattern = Array.isArray(raw.dashPattern)
            ? raw.dashPattern.filter(isFiniteNumber)
            : undefined;

        return [{
            id: typeof raw.id === "string" ? raw.id : `saved-route-overlay-${index}`,
            coords,
            color: typeof raw.color === "string" ? raw.color : undefined,
            width: isFiniteNumber(raw.width) ? raw.width : undefined,
            opacity: isFiniteNumber(raw.opacity) ? raw.opacity : undefined,
            outlineColor: typeof raw.outlineColor === "string" ? raw.outlineColor : undefined,
            outlineWidth: isFiniteNumber(raw.outlineWidth) ? raw.outlineWidth : undefined,
            outlineOpacity: isFiniteNumber(raw.outlineOpacity) ? raw.outlineOpacity : undefined,
            dashPattern,
            strokeStyle: raw.strokeStyle === "dash" || raw.strokeStyle === "dot" ? raw.strokeStyle : "solid",
            outlineStrokeStyle: raw.outlineStrokeStyle === "dash" || raw.outlineStrokeStyle === "dot"
                ? raw.outlineStrokeStyle
                : "solid",
            renderMode: "native",
            shape: raw.shape === "dot" ? "dot" : "solid",
            nativeDirection: raw.nativeDirection === true,
            nativeDirectionColor: typeof raw.nativeDirectionColor === "string" ? raw.nativeDirectionColor : undefined,
            nativeDirectionOpacity: isFiniteNumber(raw.nativeDirectionOpacity) ? raw.nativeDirectionOpacity : undefined,
            zIndex: isFiniteNumber(raw.zIndex) ? raw.zIndex : undefined,
            geometrySource: typeof raw.geometrySource === "string" ? raw.geometrySource : undefined,
            transitLegIndex: isFiniteNumber(raw.transitLegIndex) &&
                Number.isInteger(raw.transitLegIndex) && raw.transitLegIndex >= 0
                ? raw.transitLegIndex
                : undefined,
        }];
    });
}

function isWalkOverlay(overlay: TmapPathOverlay): boolean {
    return overlay.strokeStyle === "dash" ||
        overlay.strokeStyle === "dot" ||
        !!overlay.dashPattern?.length ||
        overlay.shape === "dot" ||
        /(?:walk|connector|access-link|transfer)/i.test(overlay.id);
}

function styleStoredTransitOverlay(
    overlay: TmapPathOverlay,
    mapZoom: number,
    leg?: TransitLegDetail,
    legIndex?: number,
    focusedLegIndex?: number
): TmapPathOverlay | undefined {
    const line = getTransitRouteLinePresentation(mapZoom);
    const walk = leg ? leg.kind === "WALK" : isWalkOverlay(overlay);
    const neutral = leg?.kind === "ETC";
    const accessLink = /access-link/i.test(overlay.id);
    if (accessLink && mapZoom < 14) return undefined;
    const walkAccessLink = /walk-access-link/i.test(overlay.id);

    if (walk) {
        const width = walkAccessLink
            ? Math.max(1.8, line.rideWidth * 0.42)
            : accessLink
                ? Math.max(2.2, line.rideWidth * 0.55)
                : line.walkWidth;
        return {
            id: overlay.id,
            coords: overlay.coords,
            color: WALK_GUIDE_COLOR,
            width,
            opacity: 0.94,
            outlineColor: WALK_CASING_COLOR,
            outlineWidth: Math.max(0, (line.walkCasingWidth - line.walkWidth) / 2),
            outlineOpacity: 0.9,
            dashPattern: [...TRANSIT_WALK_DASH_PATTERN],
            strokeStyle: "dash",
            outlineStrokeStyle: "solid",
            renderMode: "native",
            showDirection: false,
            nativeDirection: false,
            zIndex: typeof legIndex === "number" ? 110 + legIndex : 100,
        };
    }

    const directionEnabled = !neutral && (
        leg
            ? shouldRenderTransitNativeDirection(leg.kind, mapZoom) && legIndex !== focusedLegIndex
            : shouldRenderTransitNativeDirection("BUS", mapZoom)
    );
    return {
        id: overlay.id,
        coords: overlay.coords,
        color: neutral ? ETC_GUIDE_COLOR : leg ? getLegLineColor(leg) : "#2979FF",
        width: line.rideWidth,
        opacity: 1,
        outlineColor: TRANSIT_CASING_COLOR,
        outlineWidth: Math.max(0, (line.rideCasingWidth - line.rideWidth) / 2),
        outlineOpacity: 0.92,
        strokeStyle: "solid",
        outlineStrokeStyle: "solid",
        renderMode: "native",
        showDirection: false,
        nativeDirection: directionEnabled,
        nativeDirectionColor: directionEnabled ? DIRECTION_COLOR : undefined,
        nativeDirectionOpacity: directionEnabled ? getTransitNativeDirectionOpacity(mapZoom) : undefined,
        zIndex: typeof legIndex === "number"
            ? (neutral ? 35 + legIndex : 40 + legIndex)
            : 40,
    };
}

function buildTransitLegOverlay(
    leg: TransitLegDetail,
    legIndex: number,
    mapZoom: number,
    focusedLegIndex?: number
): TmapPathOverlay | undefined {
    const line = getTransitRouteLinePresentation(mapZoom);
    const coords = getSavedTransitLegCoords(leg);
    if (coords.length < 2) return undefined;
    const walk = leg.kind === "WALK";
    const neutral = leg.kind === "ETC";
    const directionEnabled = !walk && !neutral && legIndex !== focusedLegIndex &&
        shouldRenderTransitNativeDirection(leg.kind, mapZoom);

    return {
        id: `saved-route-leg-${legIndex}`,
        coords,
        color: walk ? WALK_GUIDE_COLOR : neutral ? ETC_GUIDE_COLOR : getLegLineColor(leg),
        width: walk ? line.walkWidth : line.rideWidth,
        opacity: walk ? 0.94 : 1,
        outlineColor: walk ? WALK_CASING_COLOR : TRANSIT_CASING_COLOR,
        outlineWidth: walk
            ? Math.max(0, (line.walkCasingWidth - line.walkWidth) / 2)
            : Math.max(0, (line.rideCasingWidth - line.rideWidth) / 2),
        outlineOpacity: walk ? 0.9 : 0.92,
        dashPattern: walk ? [...TRANSIT_WALK_DASH_PATTERN] : undefined,
        strokeStyle: walk ? "dash" : "solid",
        outlineStrokeStyle: "solid",
        renderMode: "native",
        showDirection: false,
        nativeDirection: directionEnabled,
        nativeDirectionColor: directionEnabled ? DIRECTION_COLOR : undefined,
        nativeDirectionOpacity: directionEnabled ? getTransitNativeDirectionOpacity(mapZoom) : undefined,
        zIndex: walk ? 110 + legIndex : neutral ? 35 + legIndex : 40 + legIndex,
    };
}

function buildFocusedLegOverlay(
    legs: TransitLegDetail[],
    focusedLegIndex: number | undefined,
    mapZoom: number,
    adoptedBaseCoords?: TmapLatLng[]
): TmapPathOverlay | undefined {
    if (typeof focusedLegIndex !== "number") return undefined;
    const leg = legs[focusedLegIndex];
    if (!leg) return undefined;
    const coords = Array.isArray(adoptedBaseCoords) && adoptedBaseCoords.length >= 2
        ? adoptedBaseCoords
        : getSavedTransitLegCoords(leg);
    if (coords.length < 2) return undefined;
    const line = getTransitRouteLinePresentation(mapZoom);
    const walk = leg.kind === "WALK" || leg.kind === "ETC";
    // 저장된 도보 overlay와 raw leg geometry는 미세하게 다를 수 있다. 둘을 겹치면
    // 점 위상이 엇갈려 다시 촘촘해 보이므로 도보는 카메라만 포커스하고 선은 한 벌만 유지한다.
    if (walk) return undefined;

    return {
        id: `saved-route-focused-leg-${focusedLegIndex}`,
        coords,
        color: getLegLineColor(leg),
        width: line.rideWidth + 0.4,
        opacity: 1,
        outlineColor: "rgba(255,255,255,0.18)",
        outlineWidth: Math.max(0, (line.rideCasingWidth - line.rideWidth) / 2),
        outlineOpacity: 1,
        strokeStyle: "solid",
        outlineStrokeStyle: "solid",
        renderMode: "native",
        showDirection: false,
        nativeDirection: shouldRenderTransitNativeDirection(leg.kind, mapZoom),
        nativeDirectionColor: DIRECTION_COLOR,
        nativeDirectionOpacity: getTransitNativeDirectionOpacity(mapZoom),
        zIndex: 180,
    };
}

function styleNonTransitOverlay(
    route: RouteAlternativeOption,
    overlay: Pick<TmapPathOverlay, "id" | "coords">,
    mapZoom: number,
    isDark: boolean
): TmapPathOverlay {
    const stroke = getFallbackRouteStrokePresentation(mapZoom);
    const theme = getTransitRouteThemePresentation(mapZoom, isDark ? "dark" : "light");
    const walk = route.mode === "WALK";
    const bike = route.mode === "BIKE";
    const transitFallback = route.mode === "TRANSIT";
    const directionEnabled = !walk && (
        route.mode !== "TRANSIT" || shouldRenderTransitNativeDirection("BUS", mapZoom)
    );

    return {
        id: overlay.id,
        coords: overlay.coords,
        color: walk ? WALK_GUIDE_COLOR : bike ? "#00897B" : "#2979FF",
        width: walk ? getTransitRouteLinePresentation(mapZoom).walkWidth : stroke.mainWidth,
        opacity: walk ? 0.94 : 1,
        outlineColor: walk
            ? theme.walkCasingColor
            : transitFallback
                ? theme.rideCasingColor
                : (isDark ? "rgba(15,20,35,0.72)" : "rgba(255,255,255,0.96)"),
        outlineWidth: walk
            ? Math.max(0, (getTransitRouteLinePresentation(mapZoom).walkCasingWidth - getTransitRouteLinePresentation(mapZoom).walkWidth) / 2)
            : stroke.outlineWidth,
        outlineOpacity: walk
            ? theme.walkCasingOpacity
            : transitFallback
                ? theme.rideCasingOpacity
                : 0.94,
        dashPattern: walk ? [...TRANSIT_WALK_DASH_PATTERN] : undefined,
        strokeStyle: walk ? "dash" : "solid",
        outlineStrokeStyle: "solid",
        renderMode: "native",
        showDirection: false,
        nativeDirection: directionEnabled,
        nativeDirectionColor: directionEnabled ? DIRECTION_COLOR : undefined,
        nativeDirectionOpacity: directionEnabled ? getTransitNativeDirectionOpacity(mapZoom) : undefined,
        zIndex: 40,
    };
}

function endpointDistance(first: TmapLatLng, second: TmapLatLng): number {
    return routeCoordDistanceMeters(
        { lat: first.latitude, lng: first.longitude },
        { lat: second.latitude, lng: second.longitude }
    );
}

function samplePolyline(coords: TmapLatLng[], maxSamples = 96): TmapLatLng[] {
    if (coords.length < 2) return coords;
    const segmentLengths = coords.slice(1).map((coord, index) => (
        endpointDistance(coords[index], coord)
    ));
    const totalLength = segmentLengths.reduce((total, length) => total + length, 0);
    if (!Number.isFinite(totalLength) || totalLength <= 0) return [coords[0], coords[coords.length - 1]];

    const sampleCount = Math.max(9, Math.min(maxSamples, Math.ceil(totalLength / 25) + 1));
    const samples: TmapLatLng[] = [];
    let segmentIndex = 0;
    let traversed = 0;
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        const target = totalLength * (sampleIndex / (sampleCount - 1));
        while (
            segmentIndex < segmentLengths.length - 1 &&
            traversed + segmentLengths[segmentIndex] < target
        ) {
            traversed += segmentLengths[segmentIndex];
            segmentIndex += 1;
        }
        const from = coords[segmentIndex];
        const to = coords[segmentIndex + 1];
        const segmentLength = segmentLengths[segmentIndex];
        const ratio = segmentLength > 0 ? Math.max(0, Math.min(1, (target - traversed) / segmentLength)) : 0;
        samples.push({
            latitude: from.latitude + ((to.latitude - from.latitude) * ratio),
            longitude: from.longitude + ((to.longitude - from.longitude) * ratio),
        });
    }
    return samples;
}

function pointToSegmentDistanceMeters(
    point: TmapLatLng,
    start: TmapLatLng,
    end: TmapLatLng
): number {
    const metersPerLatitude = 111_320;
    const metersPerLongitude = Math.max(
        1,
        metersPerLatitude * Math.cos((point.latitude * Math.PI) / 180)
    );
    const startX = (start.longitude - point.longitude) * metersPerLongitude;
    const startY = (start.latitude - point.latitude) * metersPerLatitude;
    const endX = (end.longitude - point.longitude) * metersPerLongitude;
    const endY = (end.latitude - point.latitude) * metersPerLatitude;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = (deltaX * deltaX) + (deltaY * deltaY);
    const ratio = lengthSquared > 0
        ? Math.max(0, Math.min(1, -((startX * deltaX) + (startY * deltaY)) / lengthSquared))
        : 0;
    return Math.hypot(startX + (deltaX * ratio), startY + (deltaY * ratio));
}

function nearestPolylineDistanceMeters(point: TmapLatLng, polyline: TmapLatLng[]): number {
    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 1; index < polyline.length; index += 1) {
        nearest = Math.min(nearest, pointToSegmentDistanceMeters(point, polyline[index - 1], polyline[index]));
    }
    return nearest;
}

function isStoredOverlayShapeCompatible(
    storedCoords: TmapLatLng[],
    currentCoords: TmapLatLng[],
    endpointTolerance: number
): boolean {
    if (storedCoords.length < 2 || currentCoords.length < 2) return false;
    const storedSamples = samplePolyline(storedCoords);
    const currentSamples = samplePolyline(currentCoords);
    const tolerance = Math.max(10, Math.min(24, endpointTolerance * 0.65));
    const coverage = (samples: TmapLatLng[], target: TmapLatLng[]) => {
        const distances = samples.map((point) => nearestPolylineDistanceMeters(point, target));
        return {
            ratio: distances.filter((distance) => distance <= tolerance).length / distances.length,
            maxDistance: Math.max(...distances),
        };
    };
    const storedToCurrent = coverage(storedSamples, currentSamples);
    const currentToStored = coverage(currentSamples, storedSamples);
    return storedToCurrent.ratio >= 0.9 &&
        currentToStored.ratio >= 0.9 &&
        storedToCurrent.maxDistance <= tolerance * 2 &&
        currentToStored.maxDistance <= tolerance * 2;
}

function getStoredOverlayShapeDeviationMeters(
    storedCoords: TmapLatLng[],
    currentCoords: TmapLatLng[]
): number {
    if (storedCoords.length < 2 || currentCoords.length < 2) {
        return Number.POSITIVE_INFINITY;
    }
    const storedSamples = samplePolyline(storedCoords);
    const currentSamples = samplePolyline(currentCoords);
    const distances = [
        ...storedSamples.map((point) => nearestPolylineDistanceMeters(point, currentCoords)),
        ...currentSamples.map((point) => nearestPolylineDistanceMeters(point, storedCoords)),
    ];
    const averageDistance = distances.reduce((total, distance) => total + distance, 0) /
        Math.max(1, distances.length);
    return averageDistance + (Math.max(...distances) * 0.25);
}

function getPolylineLengthMeters(coords: TmapLatLng[]): number {
    return coords.slice(1).reduce((total, coord, index) => (
        total + endpointDistance(coords[index], coord)
    ), 0);
}

function isValidStoredTransitAccessLink(
    overlay: TmapPathOverlay,
    legs: TransitLegDetail[]
): boolean {
    if (!/access-link/i.test(overlay.id) || overlay.coords.length < 2) return false;

    const length = getPolylineLengthMeters(overlay.coords);
    if (
        !Number.isFinite(length) ||
        length <= 0 ||
        length > TRANSIT_CONNECTOR_POLICY.maxSchematicAccessLinkMeters
    ) {
        return false;
    }

    const legPolylines = legs
        .map(getSavedTransitLegCoords)
        .filter((coords) => coords.length >= 2);
    const anchorCoords = legs.flatMap((leg) => [
        toMapCoord(leg.startCoord),
        toMapCoord(leg.endCoord),
        ...(leg.passStops ?? []).map((stop) => toMapCoord(stop.coord)),
    ].filter((coord): coord is TmapLatLng => !!coord));
    if (legPolylines.length === 0 && anchorCoords.length === 0) return false;

    const distanceToKnownRoute = (coord: TmapLatLng) => Math.min(
        ...legPolylines.map((polyline) => nearestPolylineDistanceMeters(coord, polyline)),
        ...anchorCoords.map((anchor) => endpointDistance(coord, anchor))
    );
    const first = overlay.coords[0];
    const last = overlay.coords[overlay.coords.length - 1];
    const anchorTolerance = TRANSIT_CONNECTOR_POLICY.maxDirectConnectorMeters;
    return distanceToKnownRoute(first) <= anchorTolerance &&
        distanceToKnownRoute(last) <= anchorTolerance;
}

function isTrustedStoredWalkDetailOverlay(
    overlay: RestorablePathOverlay,
    leg: TransitLegDetail,
    legIndex: number
): boolean {
    if (leg.kind !== "WALK" || !isWalkOverlay(overlay) || overlay.coords.length < 3) return false;
    const hasExplicitProvenance = overlay.geometrySource !== undefined ||
        overlay.transitLegIndex !== undefined;
    const explicitProvenanceMatches = overlay.transitLegIndex === legIndex &&
        isTrustedStoredWalkGeometrySource(overlay.geometrySource);
    // 이전 저장본은 provenance 필드가 없으므로 과거 walk-leg id와 현재 정규화 segment id를
    // leg index, 선 종류, 끝점 허용 오차, 길이 상한을 함께 검사하는 경우에만 신뢰한다.
    const legacyIdMatches = new RegExp(`(?:^|-)walk-leg-${legIndex}(?:-|$)`, "i").test(overlay.id) ||
        new RegExp(`(?:^|-)segment-${legIndex}(?:-part-\\d+)?$`, "i").test(overlay.id);
    if (hasExplicitProvenance ? !explicitProvenanceMatches : !legacyIdMatches) return false;
    const storedLength = getPolylineLengthMeters(overlay.coords);
    const directLength = endpointDistance(overlay.coords[0], overlay.coords[overlay.coords.length - 1]);
    const reportedLength = typeof leg.distanceMeters === "number" && Number.isFinite(leg.distanceMeters)
        ? Math.max(0, leg.distanceMeters)
        : 0;
    const plausibleUpperBound = Math.max(250, directLength * 6, reportedLength * 2.5);
    return Number.isFinite(storedLength) && storedLength > 0 && storedLength <= plausibleUpperBound;
}

function getStoredTransitOverlayAssignments(
    overlays: RestorablePathOverlay[],
    legs: TransitLegDetail[]
): Map<number, number> {
    const requiredLegs = legs.flatMap((leg, legIndex) => {
        const coords = getSavedTransitLegCoords(leg);
        if (coords.length < 2) return [];
        return [{
            legIndex,
            kind: leg.kind,
            coords,
            start: coords[0],
            end: coords[coords.length - 1],
        }];
    });
    if (requiredLegs.length === 0) return new Map();

    const candidateEntries = overlays.flatMap((overlay, overlayIndex) => (
        /access-link/i.test(overlay.id) ? [] : [{ overlay, overlayIndex }]
    ));

    const candidates = requiredLegs.map((leg) => candidateEntries
        .flatMap(({ overlay, overlayIndex }) => {
            const walk = leg.kind === "WALK";
            if (leg.kind !== "ETC" && isWalkOverlay(overlay) !== walk) return [];
            if (overlay.coords.length < 2) return [];
            const hasExplicitProvenance = overlay.geometrySource !== undefined ||
                overlay.transitLegIndex !== undefined;
            if (hasExplicitProvenance && (
                !walk ||
                overlay.transitLegIndex !== leg.legIndex ||
                !isTrustedStoredWalkGeometrySource(overlay.geometrySource)
            )) return [];
            const overlayStart = overlay.coords[0];
            const overlayEnd = overlay.coords[overlay.coords.length - 1];
            const forwardError = Math.max(
                endpointDistance(leg.start, overlayStart),
                endpointDistance(leg.end, overlayEnd)
            );
            const reverseError = leg.kind === "WALK" || leg.kind === "ETC"
                ? Math.max(
                    endpointDistance(leg.start, overlayEnd),
                    endpointDistance(leg.end, overlayStart)
                )
                : Number.POSITIVE_INFINITY;
            const error = Math.min(forwardError, reverseError);
            const terminalWalk = walk && (
                leg.legIndex === 0 || leg.legIndex === legs.length - 1
            );
            const tolerance = terminalWalk
                ? TRANSIT_CONNECTOR_POLICY.maxTerminalConnectorMeters
                : TRANSIT_CONNECTOR_POLICY.maxDirectConnectorMeters;
            const trustedWalkDetail = isTrustedStoredWalkDetailOverlay(
                overlay,
                legs[leg.legIndex],
                leg.legIndex
            );
            const shapeCompatible = isStoredOverlayShapeCompatible(overlay.coords, leg.coords, tolerance);
            return error <= tolerance && (trustedWalkDetail || shapeCompatible)
                ? [{
                    overlayIndex,
                    error,
                    preference: trustedWalkDetail ? 0 : 1,
                    shapeDeviation: getStoredOverlayShapeDeviationMeters(overlay.coords, leg.coords),
                }]
                : [];
        })
        .sort((first, second) => {
            const preferenceDifference = first.preference - second.preference;
            if (preferenceDifference !== 0) return preferenceDifference;
            const shapeDifference = first.shapeDeviation - second.shapeDeviation;
            if (Math.abs(shapeDifference) > 0.5) return shapeDifference;
            const endpointDifference = first.error - second.error;
            if (Math.abs(endpointDifference) > 0.5) return endpointDifference;
            return first.overlayIndex - second.overlayIndex;
        })
        .map(({ overlayIndex }) => overlayIndex));

    const overlayAssignments = new Map<number, number>();
    const assignLeg = (legIndex: number, visited: Set<number>): boolean => {
        for (const overlayIndex of candidates[legIndex]) {
            if (visited.has(overlayIndex)) continue;
            visited.add(overlayIndex);
            const previousLegIndex = overlayAssignments.get(overlayIndex);
            if (previousLegIndex === undefined || assignLeg(previousLegIndex, visited)) {
                overlayAssignments.set(overlayIndex, legIndex);
                return true;
            }
        }
        return false;
    };
    const legOrder = requiredLegs
        .map((_, legIndex) => legIndex)
        .sort((first, second) => candidates[first].length - candidates[second].length);
    legOrder.forEach((legIndex) => {
        if (candidates[legIndex].length > 0) assignLeg(legIndex, new Set());
    });
    return new Map([...overlayAssignments].map(([overlayIndex, requiredLegIndex]) => (
        [overlayIndex, requiredLegs[requiredLegIndex].legIndex]
    )));
}

function buildNonTransitOverlays(
    route: RouteAlternativeOption | undefined,
    pathCoords: TmapLatLng[],
    mapZoom: number,
    isDark: boolean
): TmapPathOverlay[] {
    if (!route || pathCoords.length < 2) return [];
    return [styleNonTransitOverlay(route, {
        id: `saved-route-${route.mode.toLowerCase()}`,
        coords: pathCoords,
    }, mapZoom, isDark)];
}

function placeCoord(place: Place | undefined): RoutePathCoord | undefined {
    if (!isFiniteNumber(place?.lat) || !isFiniteNumber(place?.lng)) return undefined;
    return { lat: place.lat, lng: place.lng };
}

function getLegBoardCoord(legs: TransitLegDetail[], legIndex: number): RoutePathCoord | undefined {
    const leg = legs[legIndex];
    if (!leg) return undefined;

    const previousWalk = legs[legIndex - 1];
    const isRideLeg = leg.kind === "BUS" || leg.kind === "SUBWAY";
    if (isRideLeg && previousWalk?.kind === "WALK") {
        const walkPath = routeCoords(previousWalk.pathCoords);
        const walkEndCoord = toRouteCoord(previousWalk.endCoord) ?? walkPath[walkPath.length - 1];
        if (walkEndCoord) return walkEndCoord;
    }

    return toRouteCoord(leg.startCoord)
        ?? routeCoords(leg.pathCoords)[0]
        ?? toRouteCoord(leg.passStops?.[0]?.coord);
}

/** 상세 경로를 선택했을 때 카메라가 이동할 승차·이동 시작 지점을 반환한다. */
export function getSavedTransitLegBoardCoord(
    legs: TransitLegDetail[],
    legIndex: number
): TmapLatLng | undefined {
    const coord = getLegBoardCoord(legs, legIndex);
    return coord ? { latitude: coord.lat, longitude: coord.lng } : undefined;
}

function getLegAlightCoord(legs: TransitLegDetail[], legIndex: number): RoutePathCoord | undefined {
    const nextWalk = legs[legIndex + 1];
    if (nextWalk?.kind === "WALK") {
        const walkPath = routeCoords(nextWalk.pathCoords);
        return toRouteCoord(nextWalk.startCoord) ?? walkPath[0];
    }
    const leg = legs[legIndex];
    const path = routeCoords(leg.pathCoords);
    return toRouteCoord(leg.endCoord) ?? path[path.length - 1];
}

function markerBadgeSide(leg: TransitLegDetail, endpoint: "start" | "end"): "left" | "right" {
    const path = routeCoords(leg.pathCoords);
    if (path.length < 2) return endpoint === "start" ? "right" : "left";
    const first = endpoint === "start" ? path[0] : path[path.length - 2];
    const second = endpoint === "start" ? path[1] : path[path.length - 1];
    return second.lng >= first.lng
        ? (endpoint === "start" ? "left" : "right")
        : (endpoint === "start" ? "right" : "left");
}

function compactStopLabel(value?: string, maxLength = 14): string | undefined {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized) return undefined;
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function buildTransitEventMarkers(
    routeId: string,
    legs: TransitLegDetail[],
    mapZoom: number,
    origin: RoutePathCoord | undefined,
    destination: RoutePathCoord | undefined
): TmapMarker[] {
    const rideLegIndexes = legs
        .map((leg, index) => (leg.kind === "BUS" || leg.kind === "SUBWAY" ? index : -1))
        .filter((index) => index >= 0);
    if (!rideLegIndexes.length) return [];

    return rideLegIndexes.flatMap((legIndex, rideIndex): TmapMarker[] => {
        const leg = legs[legIndex];
        const lineLabel = compactTransitLineLabel(leg.lineName) ?? compactTransitLineLabel(leg.label);
        const color = getLegLineColor(leg);
        const markerStyle = getTransitModeMarkerStyle(leg.kind);
        const boardCoord = getLegBoardCoord(legs, legIndex);
        const alightCoord = getLegAlightCoord(legs, legIndex);
        const markers: TmapMarker[] = [];

        if (boardCoord) {
            const eventIntent = rideIndex === 0 ? "board" : "transfer";
            const presentation = getTransitEventMarkerPresentation(eventIntent, mapZoom);
            const hiddenByEndpoint = isRedundantEndpointTransitEvent(
                eventIntent,
                boardCoord,
                { origin, destination },
                mapZoom
            );
            if (presentation.visible && !hiddenByEndpoint) {
                const markerId = `saved-transit-event-${routeId}-${legIndex}-${eventIntent}`;
                const interactionId = buildTransitLegInteractionId(legIndex);
                markers.push({
                    id: `${markerId}-node`,
                    interactionId,
                    latitude: boardCoord.lat,
                    longitude: boardCoord.lng,
                    tintColor: color,
                    markerStyle,
                    caption: leg.startName ?? lineLabel ?? "승차 지점",
                    displayType: "station",
                    eventIntent,
                    dotSize: presentation.nodeSize,
                    zIndex: 3700 + (legIndex * 4),
                });
                if (presentation.showRouteLabel) {
                    const primary = [lineLabel, compactStopLabel(leg.startName)]
                        .filter((value): value is string => !!value)
                        .join(" · ");
                    markers.push({
                        id: `${markerId}-label`,
                        interactionId,
                        latitude: boardCoord.lat,
                        longitude: boardCoord.lng,
                        tintColor: color,
                        markerStyle,
                        caption: leg.startName ?? lineLabel,
                        displayType: "routeLabel",
                        badgeVariant: "context",
                        badgeLabel: primary || lineLabel || (eventIntent === "transfer" ? "환승" : "승차"),
                        badgeSubLabel: getTransitBoardingDirectionHint(leg),
                        badgeSide: markerBadgeSide(leg, "start"),
                        eventIntent,
                        zIndex: 3701 + (legIndex * 4),
                    });
                }
            }
        }

        if (alightCoord) {
            const presentation = getTransitEventMarkerPresentation("alight", mapZoom, legs[legIndex + 1]?.kind === "WALK");
            const hiddenByEndpoint = isRedundantEndpointTransitEvent(
                "alight",
                alightCoord,
                { origin, destination },
                mapZoom
            );
            if (presentation.visible && !hiddenByEndpoint) {
                const markerId = `saved-transit-event-${routeId}-${legIndex}-alight`;
                const interactionId = buildTransitLegInteractionId(legIndex);
                markers.push({
                    id: `${markerId}-node`,
                    interactionId,
                    latitude: alightCoord.lat,
                    longitude: alightCoord.lng,
                    tintColor: color,
                    markerStyle: legs[legIndex + 1]?.kind === "WALK" ? "walk" : markerStyle,
                    caption: leg.endName ?? "하차 지점",
                    displayType: "station",
                    stationVariant: presentation.stationVariant,
                    eventIntent: "alight",
                    dotSize: presentation.nodeSize,
                    zIndex: 3702 + (legIndex * 4),
                });
            }
        }

        return markers;
    });
}

function nearestPathCoordinate(stop: RoutePathCoord, path: RoutePathCoord[]): RoutePathCoord {
    if (path.length < 2) return stop;
    const latitudeMeters = 111_320;
    const longitudeMeters = Math.max(1, latitudeMeters * Math.cos((stop.lat * Math.PI) / 180));
    let nearest: { coord: RoutePathCoord; distance: number } | undefined;

    for (let index = 0; index < path.length - 1; index += 1) {
        const start = path[index];
        const end = path[index + 1];
        const startX = (start.lng - stop.lng) * longitudeMeters;
        const startY = (start.lat - stop.lat) * latitudeMeters;
        const endX = (end.lng - stop.lng) * longitudeMeters;
        const endY = (end.lat - stop.lat) * latitudeMeters;
        const dx = endX - startX;
        const dy = endY - startY;
        const lengthSquared = (dx * dx) + (dy * dy);
        const ratio = lengthSquared > 0
            ? Math.max(0, Math.min(1, -((startX * dx) + (startY * dy)) / lengthSquared))
            : 0;
        const projectedX = startX + (dx * ratio);
        const projectedY = startY + (dy * ratio);
        const distance = Math.hypot(projectedX, projectedY);
        const coord = {
            lat: start.lat + ((end.lat - start.lat) * ratio),
            lng: start.lng + ((end.lng - start.lng) * ratio),
        };
        if (!nearest || distance < nearest.distance) nearest = { coord, distance };
    }

    // 공급자 정류장 좌표가 본선에서 크게 벗어나면 실제 POI를 보존한다.
    return nearest && nearest.distance <= 80 ? nearest.coord : stop;
}

function buildTransitPassStopMarkers(
    routeId: string,
    legs: TransitLegDetail[],
    mapZoom: number
): TmapMarker[] {
    type Group = {
        kind: TransitStopMarkerKind;
        policy: ReturnType<typeof getTransitStopMarkerPolicy>;
        markers: TmapMarker[];
    };
    const groups: Group[] = [];
    const seen = new Set<string>();

    legs.forEach((leg, legIndex) => {
        if ((leg.kind !== "BUS" && leg.kind !== "SUBWAY") || !Array.isArray(leg.passStops)) return;
        const policy = getTransitStopMarkerPolicy(leg.kind, mapZoom);
        if (!policy.visible) return;
        const path = routeCoords(leg.pathCoords);
        const color = getLegLineColor(leg);
        const lineLabel = compactTransitLineLabel(leg.lineName) ?? compactTransitLineLabel(leg.label);
        const candidates = leg.passStops.flatMap((stop, stopIndex): TmapMarker[] => {
            if (stopIndex === 0 || stopIndex === leg.passStops!.length - 1) return [];
            const rawCoord = toRouteCoord(stop.coord);
            if (!rawCoord) return [];
            const coord = nearestPathCoordinate(rawCoord, path);
            const key = `${coord.lat.toFixed(5)}:${coord.lng.toFixed(5)}`;
            if (seen.has(key)) return [];
            seen.add(key);
            return [{
                id: `saved-transit-stop-${routeId}-${legIndex}-${stopIndex}`,
                interactionId: buildTransitStopInteractionId(legIndex, stopIndex),
                latitude: coord.lat,
                longitude: coord.lng,
                tintColor: color,
                markerStyle: leg.kind === "BUS" ? "bus" : "subway",
                caption: stop.name,
                displayType: "station",
                stationVariant: "compact",
                dotSize: policy.markerSize,
                badgeLabel: lineLabel,
                badgeSide: stopIndex % 2 === 0 ? "left" : "right",
                zIndex: 3520 + stopIndex,
            }];
        });
        if (candidates.length) groups.push({ kind: leg.kind, policy, markers: candidates });
    });

    const result: TmapMarker[] = [];
    (["BUS", "SUBWAY"] as const).forEach((kind) => {
        const kindGroups = groups.filter((group) => group.kind === kind);
        if (!kindGroups.length) return;
        const policy = getTransitStopMarkerPolicy(kind, mapZoom);
        const allocations = allocateTransitStopMarkerCounts(
            kindGroups.map((group) => Math.min(group.markers.length, group.policy.maxPerLeg)),
            policy.maxTotal
        );
        const selectedMarkersByGroup: TmapMarker[][] = [];

        kindGroups.forEach((group, groupIndex) => {
            const sampled = sampleTransitStopIndices(group.markers.length, allocations[groupIndex] ?? 0)
                .map((index) => group.markers[index]);
            selectedMarkersByGroup.push(sampled);
            result.push(...sampled);
        });

        if (!policy.showLabels) return;
        // 여러 환승 구간의 라벨을 노선별로 늘리지 않고 화면 전체 예산 안에서 나눈다.
        const labelAllocations = allocateTransitStopMarkerCounts(
            selectedMarkersByGroup.map((markers) => (
                Math.min(markers.length, policy.maxLabelsPerLeg)
            )),
            policy.maxLabelsTotal
        );
        selectedMarkersByGroup.forEach((markers, groupIndex) => {
            sampleTransitStopIndices(
                markers.length,
                labelAllocations[groupIndex] ?? 0
            ).forEach((markerIndex) => {
                const marker = markers[markerIndex];
                const label = compactStopLabel(marker.caption, mapZoom >= 17.5 ? 18 : 14);
                if (!label) return;
                result.push({
                    ...marker,
                    id: `${marker.id}-label`,
                    displayType: "routeLabel",
                    badgeVariant: "stop",
                    badgeLabel: label,
                    dotSize: undefined,
                    stationVariant: undefined,
                    zIndex: (marker.zIndex ?? 3520) + 1,
                });
            });
        });
    });

    return result;
}

function buildTransitRouteIdentityMarkers(
    routeId: string,
    legs: TransitLegDetail[],
    mapZoom: number
): TmapMarker[] {
    if (!shouldShowTransitRouteIdentityLabel(mapZoom)) return [];

    return legs.flatMap((leg, legIndex): TmapMarker[] => {
        if (leg.kind !== "BUS" && leg.kind !== "SUBWAY") return [];
        const lineLabel = compactTransitLineLabel(leg.lineName) ?? compactTransitLineLabel(leg.label);
        if (!lineLabel) return [];
        const coord = selectTransitRouteLabelCoordinate(routeCoords(leg.pathCoords));
        if (!coord) return [];

        return [{
            id: `saved-transit-route-label-${routeId}-${legIndex}`,
            interactionId: buildTransitLegInteractionId(legIndex),
            latitude: coord.lat,
            longitude: coord.lng,
            tintColor: getLegLineColor(leg),
            markerStyle: getTransitModeMarkerStyle(leg.kind),
            caption: lineLabel,
            displayType: "routeLabel",
            badgeVariant: "route",
            badgeLabel: lineLabel,
            badgeSide: legIndex % 2 === 0 ? "right" : "left",
            zIndex: 3600 + legIndex,
        }];
    });
}

function buildRouteMarkers(
    route: RouteAlternativeOption | undefined,
    legs: TransitLegDetail[],
    originPlace: Place | undefined,
    destinationPlace: Place | undefined,
    mapZoom: number
): TmapMarker[] {
    const origin = placeCoord(originPlace);
    const destination = placeCoord(destinationPlace);
    const endpoint = getRouteEndpointMarkerPresentation(origin, destination, mapZoom);
    const markers: TmapMarker[] = [];

    if (origin) {
        markers.push({
            id: "origin",
            latitude: origin.lat,
            longitude: origin.lng,
            tintColor: ORIGIN_COLOR,
            markerStyle: "origin",
            displayType: "pin",
            pinLabel: endpoint.showLabels ? "출발" : undefined,
            markerScale: endpoint.markerScale,
            caption: originPlace?.name ?? "출발",
            zIndex: 4000,
        });
    }
    if (destination) {
        markers.push({
            id: "destination",
            latitude: destination.lat,
            longitude: destination.lng,
            tintColor: DESTINATION_COLOR,
            markerStyle: "destination",
            displayType: "pin",
            pinLabel: endpoint.showLabels ? "도착" : undefined,
            markerScale: endpoint.markerScale,
            caption: destinationPlace?.name ?? "도착",
            zIndex: 3990,
        });
    }

    if (route?.mode === "TRANSIT" && legs.length) {
        markers.push(...buildTransitPassStopMarkers(route.id, legs, mapZoom));
        markers.push(...buildTransitRouteIdentityMarkers(route.id, legs, mapZoom));
        markers.push(...buildTransitEventMarkers(route.id, legs, mapZoom, origin, destination));
    }
    return markers;
}

export function buildSavedRouteMapPresentation({
    route,
    origin,
    destination,
    mapZoom,
    isDark,
    focusedLegIndex,
}: SavedRouteMapPresentationInput): SavedRouteMapPresentation {
    const routeOption = getSavedRouteAlternative(route);
    const routeLegs = Array.isArray(routeOption?.transitLegs) ? routeOption.transitLegs : [];
    const pathCoords = getSavedRoutePathCoords(route, routeLegs);
    const storedOverlays = parseStoredPathOverlays(route);
    let pathOverlays: TmapPathOverlay[];

    if (routeOption?.mode === "TRANSIT" && routeLegs.length) {
        const assignments = getStoredTransitOverlayAssignments(storedOverlays, routeLegs);
        const storedOverlayIndexByLeg = new Map(
            [...assignments].map(([overlayIndex, legIndex]) => [legIndex, overlayIndex])
        );
        const adoptedBaseCoordsByLeg = new Map<number, TmapLatLng[]>();
        const baseOverlays = routeLegs.flatMap((leg, legIndex): TmapPathOverlay[] => {
            const storedOverlayIndex = storedOverlayIndexByLeg.get(legIndex);
            const storedOverlay = typeof storedOverlayIndex === "number"
                ? storedOverlays[storedOverlayIndex]
                : undefined;
            const overlay = storedOverlay
                ? styleStoredTransitOverlay(
                    storedOverlay,
                    mapZoom,
                    leg,
                    legIndex,
                    focusedLegIndex
                )
                : buildTransitLegOverlay(leg, legIndex, mapZoom, focusedLegIndex);
            if (!overlay) return [];
            adoptedBaseCoordsByLeg.set(legIndex, overlay.coords);
            return [overlay];
        });
        const accessLinks = assignments.size > 0
            ? storedOverlays.flatMap((overlay): TmapPathOverlay[] => {
                if (!isValidStoredTransitAccessLink(overlay, routeLegs)) return [];
                const styled = styleStoredTransitOverlay(overlay, mapZoom);
                return styled ? [styled] : [];
            })
            : [];
        const hasMissingLegGeometry = routeLegs.some(
            (leg) => getSavedTransitLegCoords(leg).length < 2
        );
        const explicitRootPath = hasMissingLegGeometry
            ? getExplicitSavedRouteRootPathCoords(route)
            : [];
        const fallbackOverlay = explicitRootPath.length >= 2
            ? {
                ...styleNonTransitOverlay(routeOption, {
                    id: "saved-route-transit-fallback",
                    coords: explicitRootPath,
                }, mapZoom, false),
                opacity: 0.7,
                nativeDirection: false,
                nativeDirectionColor: undefined,
                nativeDirectionOpacity: undefined,
                zIndex: 20,
            }
            : undefined;
        pathOverlays = [
            ...(fallbackOverlay ? [fallbackOverlay] : []),
            ...baseOverlays,
            ...accessLinks,
        ];
        const focused = buildFocusedLegOverlay(
            routeLegs,
            focusedLegIndex,
            mapZoom,
            typeof focusedLegIndex === "number"
                ? adoptedBaseCoordsByLeg.get(focusedLegIndex)
                : undefined
        );
        if (focused) pathOverlays = [...pathOverlays, focused];
        if (isDark) {
            pathOverlays = pathOverlays.map((overlay) => (
                applyTransitRouteThemeToOverlay(overlay, mapZoom, "dark")
            ));
        }
    } else if (storedOverlays.length && routeOption) {
        // 저장본에서는 경로 geometry와 안정적인 id만 복원한다. 선 색상·폭·점선·casing·
        // 방향 표시는 현재 줌/모드/테마 정책으로 다시 계산해 구형 presentation이 살아나지 않게 한다.
        pathOverlays = storedOverlays.map((overlay) => (
            styleNonTransitOverlay(routeOption, overlay, mapZoom, isDark)
        ));
    } else if (storedOverlays.length) {
        // 모드를 판별할 수 없는 비정상 구형 데이터는 geometry 유실을 피하기 위해 기존 fallback을 유지한다.
        pathOverlays = storedOverlays;
    } else {
        pathOverlays = buildNonTransitOverlays(routeOption, pathCoords, mapZoom, isDark);
    }

    const markers = buildRouteMarkers(routeOption, routeLegs, origin, destination, mapZoom);
    const fitCoords = getSavedRouteFitCoords(route, origin, destination);

    return {
        routeOption,
        routeLegs,
        pathCoords,
        pathOverlays,
        markers,
        fitCoords,
    };
}
