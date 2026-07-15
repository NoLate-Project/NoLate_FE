import type { Place } from "../schedule/types";
import {
    compactTransitLineLabel,
    getBusLineColor,
    getSubwayLineColor,
} from "../schedule/routeInfo";
import type {
    RouteAlternativeOption,
    RoutePathCoord,
    TransitLegDetail,
} from "./routingService";
import type { TmapLatLng, TmapMarker, TmapPathOverlay } from "./TmapMapView";
import { getRouteEndpointMarkerPresentation } from "./routeMarkerPresentation";
import {
    getFallbackRouteStrokePresentation,
    getTransitNativeDirectionOpacity,
    getTransitRouteLinePresentation,
    shouldRenderTransitNativeDirection,
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
import { getTransitBoardingDirectionHint } from "./transitStopLabelPresentation";
import {
    allocateTransitStopMarkerCounts,
    getTransitStopMarkerPolicy,
    sampleTransitStopIndices,
    type TransitStopMarkerKind,
} from "./transitStopVisibility";

const WALK_GUIDE_COLOR = "#1A73E8";
const WALK_CASING_COLOR = "#0F172A";
const WALK_DASH_PATTERN = [8, 7.2];
const TRANSIT_CASING_COLOR = "#0F172A";
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
};

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

function getSavedRoutePathCoords(route: unknown, legs: TransitLegDetail[]): TmapLatLng[] {
    const rootPath = mapCoords((route as { pathCoords?: unknown } | undefined)?.pathCoords);
    if (rootPath.length >= 2) return rootPath;
    return distinctMapCoords(legs.flatMap(getSavedTransitLegCoords));
}

/** 줌에 따른 레이어 교체와 무관한 고정 bounds를 만들어 사용자의 줌 동작을 보존한다. */
export function getSavedRouteFitCoords(
    route: unknown,
    origin?: Place,
    destination?: Place
): TmapLatLng[] {
    const routeOption = getSavedRouteAlternative(route);
    const legs = Array.isArray(routeOption?.transitLegs) ? routeOption.transitLegs : [];
    const storedOverlayCoords = parseStoredPathOverlays(route).flatMap((overlay) => overlay.coords);
    return distinctMapCoords([
        ...storedOverlayCoords,
        ...getSavedRoutePathCoords(route, legs),
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
    return WALK_GUIDE_COLOR;
}

function parseStoredPathOverlays(route: unknown): TmapPathOverlay[] {
    const stored = (route as { storedPathOverlays?: unknown } | undefined)?.storedPathOverlays;
    if (!Array.isArray(stored)) return [];

    return stored.flatMap((value, index): TmapPathOverlay[] => {
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

function styleStoredTransitOverlay(overlay: TmapPathOverlay, mapZoom: number): TmapPathOverlay | undefined {
    const line = getTransitRouteLinePresentation(mapZoom);
    const walk = isWalkOverlay(overlay);
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
            outlineOpacity: 0.72,
            dashPattern: [...WALK_DASH_PATTERN],
            strokeStyle: "dash",
            outlineStrokeStyle: "solid",
            renderMode: "native",
            showDirection: false,
            nativeDirection: false,
            zIndex: overlay.zIndex,
        };
    }

    return {
        id: overlay.id,
        coords: overlay.coords,
        color: overlay.color ?? "#2979FF",
        width: line.rideWidth,
        opacity: 1,
        outlineColor: TRANSIT_CASING_COLOR,
        outlineWidth: Math.max(0, (line.rideCasingWidth - line.rideWidth) / 2),
        outlineOpacity: 0.76,
        strokeStyle: "solid",
        outlineStrokeStyle: "solid",
        renderMode: "native",
        showDirection: false,
        nativeDirection: shouldRenderTransitNativeDirection("BUS", mapZoom),
        nativeDirectionColor: DIRECTION_COLOR,
        nativeDirectionOpacity: getTransitNativeDirectionOpacity(mapZoom),
        zIndex: overlay.zIndex,
    };
}

function buildTransitLegOverlays(legs: TransitLegDetail[], mapZoom: number): TmapPathOverlay[] {
    const line = getTransitRouteLinePresentation(mapZoom);

    return legs.flatMap((leg, index): TmapPathOverlay[] => {
        const coords = getSavedTransitLegCoords(leg);
        if (coords.length < 2) return [];
        const walk = leg.kind === "WALK" || leg.kind === "ETC";

        return [{
            id: `saved-route-leg-${index}`,
            coords,
            color: walk ? WALK_GUIDE_COLOR : getLegLineColor(leg),
            width: walk ? line.walkWidth : line.rideWidth,
            opacity: walk ? 0.94 : 1,
            outlineColor: walk ? WALK_CASING_COLOR : TRANSIT_CASING_COLOR,
            outlineWidth: walk
                ? Math.max(0, (line.walkCasingWidth - line.walkWidth) / 2)
                : Math.max(0, (line.rideCasingWidth - line.rideWidth) / 2),
            outlineOpacity: walk ? 0.72 : 0.76,
            dashPattern: walk ? [...WALK_DASH_PATTERN] : undefined,
            strokeStyle: walk ? "dash" : "solid",
            outlineStrokeStyle: "solid",
            renderMode: "native",
            showDirection: false,
            nativeDirection: !walk && shouldRenderTransitNativeDirection(leg.kind, mapZoom),
            nativeDirectionColor: !walk ? DIRECTION_COLOR : undefined,
            nativeDirectionOpacity: !walk ? getTransitNativeDirectionOpacity(mapZoom) : undefined,
            zIndex: walk ? 110 + index : 40 + index,
        }];
    });
}

function buildFocusedLegOverlay(
    legs: TransitLegDetail[],
    focusedLegIndex: number | undefined,
    mapZoom: number
): TmapPathOverlay | undefined {
    if (typeof focusedLegIndex !== "number") return undefined;
    const leg = legs[focusedLegIndex];
    if (!leg) return undefined;
    const coords = getSavedTransitLegCoords(leg);
    if (coords.length < 2) return undefined;
    const line = getTransitRouteLinePresentation(mapZoom);
    const walk = leg.kind === "WALK" || leg.kind === "ETC";

    return {
        id: `saved-route-focused-leg-${focusedLegIndex}`,
        coords,
        color: walk ? WALK_GUIDE_COLOR : getLegLineColor(leg),
        width: (walk ? line.walkWidth : line.rideWidth) + 0.4,
        opacity: 1,
        outlineColor: walk ? WALK_CASING_COLOR : "rgba(255,255,255,0.18)",
        outlineWidth: walk
            ? Math.max(0, (line.walkCasingWidth - line.walkWidth) / 2)
            : Math.max(0, (line.rideCasingWidth - line.rideWidth) / 2),
        outlineOpacity: walk ? 0.72 : 1,
        dashPattern: walk ? [...WALK_DASH_PATTERN] : undefined,
        strokeStyle: walk ? "dash" : "solid",
        outlineStrokeStyle: "solid",
        renderMode: "native",
        showDirection: false,
        nativeDirection: false,
        zIndex: 180,
    };
}

function buildNonTransitOverlays(
    route: RouteAlternativeOption | undefined,
    pathCoords: TmapLatLng[],
    mapZoom: number,
    isDark: boolean
): TmapPathOverlay[] {
    if (!route || pathCoords.length < 2) return [];
    const stroke = getFallbackRouteStrokePresentation(mapZoom);
    const walk = route.mode === "WALK";
    const bike = route.mode === "BIKE";

    return [{
        id: `saved-route-${route.mode.toLowerCase()}`,
        coords: pathCoords,
        color: walk ? WALK_GUIDE_COLOR : bike ? "#00897B" : "#2979FF",
        width: walk ? getTransitRouteLinePresentation(mapZoom).walkWidth : stroke.mainWidth,
        opacity: walk ? 0.94 : 1,
        outlineColor: walk
            ? WALK_CASING_COLOR
            : (isDark ? "rgba(15,20,35,0.72)" : "rgba(255,255,255,0.96)"),
        outlineWidth: walk
            ? Math.max(0, (getTransitRouteLinePresentation(mapZoom).walkCasingWidth - getTransitRouteLinePresentation(mapZoom).walkWidth) / 2)
            : stroke.outlineWidth,
        outlineOpacity: walk ? 0.72 : 0.94,
        dashPattern: walk ? [...WALK_DASH_PATTERN] : undefined,
        strokeStyle: walk ? "dash" : "solid",
        outlineStrokeStyle: "solid",
        renderMode: "native",
        showDirection: false,
        nativeDirection: !walk,
        nativeDirectionColor: !walk ? DIRECTION_COLOR : undefined,
        nativeDirectionOpacity: !walk ? getTransitNativeDirectionOpacity(mapZoom) : undefined,
        zIndex: 40,
    }];
}

function placeCoord(place: Place | undefined): RoutePathCoord | undefined {
    if (!isFiniteNumber(place?.lat) || !isFiniteNumber(place?.lng)) return undefined;
    return { lat: place.lat, lng: place.lng };
}

function getLegBoardCoord(legs: TransitLegDetail[], legIndex: number): RoutePathCoord | undefined {
    const previousWalk = legs[legIndex - 1];
    if (previousWalk?.kind === "WALK") {
        const walkPath = routeCoords(previousWalk.pathCoords);
        return toRouteCoord(previousWalk.endCoord) ?? walkPath[walkPath.length - 1];
    }
    const leg = legs[legIndex];
    return toRouteCoord(leg.startCoord) ?? routeCoords(leg.pathCoords)[0];
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
        const restored = storedOverlays
            .map((overlay) => styleStoredTransitOverlay(overlay, mapZoom))
            .filter((overlay): overlay is TmapPathOverlay => !!overlay);
        pathOverlays = restored.length > 0
            ? restored
            : buildTransitLegOverlays(routeLegs, mapZoom);
        const focused = buildFocusedLegOverlay(routeLegs, focusedLegIndex, mapZoom);
        if (focused) pathOverlays = [...pathOverlays, focused];
    } else if (storedOverlays.length) {
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
