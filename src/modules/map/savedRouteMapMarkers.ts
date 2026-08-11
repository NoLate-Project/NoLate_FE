import type {
    Place,
} from "../schedule/types";
import {
    compactTransitLineLabel,
} from "../schedule/routeInfo";
import type {
    RouteAlternativeOption,
    RoutePathCoord,
    TransitLegDetail,
} from "./routingService";
import type {
    TmapLatLng,
    TmapMarker,
    TmapPathOverlay,
} from "./TmapMapView";
import {
    getRouteEndpointMarkerPresentation,
} from "./routeMarkerPresentation";

import {
    selectTransitRouteLabelCoordinate,
} from "./transitRouteLabelPlacement";
import {
    getTransitEventMarkerPresentation,
    getTransitModeMarkerStyle,
    shouldShowTransitRouteIdentityLabel,
} from "./transitMarkerPresentation";
import {
    isRedundantEndpointTransitEvent,
} from "./transitMarkerHierarchy";
import {
    buildTransitLegInteractionId,
    buildTransitStopInteractionId,
} from "./transitMapInteraction";
import {
    repairLegacyOdsayWalkPath,
    routeCoordDistanceMeters,
    stitchTransitWalkPathToAnchors,
} from "./transitRouteGeometry";
import {
    getTransitBoardingDirectionHint,
} from "./transitStopLabelPresentation";
import {
    allocateTransitStopMarkerCounts,
    getTransitStopMarkerPolicy,
    sampleTransitStopIndices,
    type TransitStopMarkerKind,
} from "./transitStopVisibility";

import {
    DESTINATION_COLOR,
    ORIGIN_COLOR,
    isFiniteNumber,
    routeCoords,
    toRouteCoord,
} from "./savedRouteMapGeometry";
import {
    getLegLineColor,
    styleNonTransitOverlay,
} from "./savedRouteMapOverlays";

/** 검증된 경로 조각을 조합해 `buildNonTransitOverlays` 지도 표현을 생성합니다. */
export function buildNonTransitOverlays(
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

/** 저장 경로 지도 표현의 `placeCoord` 계산 단계를 한 가지 책임으로 수행합니다. */
export function placeCoord(place: Place | undefined): RoutePathCoord | undefined {
    if (!isFiniteNumber(place?.lat) || !isFiniteNumber(place?.lng)) return undefined;
    return { lat: place.lat, lng: place.lng };
}

/** 저장 경로 데이터가 `isTransitRideLeg` 조건을 만족하는지 검증하며 잘못된 값은 안전하게 제외합니다. */
export function isTransitRideLeg(leg: TransitLegDetail | undefined): boolean {
    return leg?.kind === "BUS" || leg?.kind === "SUBWAY";
}

/** 저장 경로에서 `getRideBoundaryCoord`에 필요한 값을 계산하며 사용 가능한 최선의 대체값을 선택합니다. */
export function getRideBoundaryCoord(
    leg: TransitLegDetail | undefined,
    position: "start" | "end"
): RoutePathCoord | undefined {
    if (!leg) return undefined;
    const path = routeCoords(leg.pathCoords);
    return position === "start"
        ? toRouteCoord(leg.startCoord) ?? path[0]
        : toRouteCoord(leg.endCoord) ?? path[path.length - 1];
}

/** 저장 경로에서 `getSavedWalkDisplayAnchors`에 필요한 값을 계산하며 사용 가능한 최선의 대체값을 선택합니다. */
export function getSavedWalkDisplayAnchors(
    legs: TransitLegDetail[],
    legIndex: number,
    origin: RoutePathCoord | undefined,
    destination: RoutePathCoord | undefined
): { from?: RoutePathCoord; to?: RoutePathCoord } {
    const leg = legs[legIndex];
    const previous = legs[legIndex - 1];
    const next = legs[legIndex + 1];
    const path = routeCoords(leg?.pathCoords);
    const from = legIndex === 0
        ? origin ?? toRouteCoord(leg?.startCoord) ?? path[0]
        : isTransitRideLeg(previous)
            ? getRideBoundaryCoord(previous, "end") ?? toRouteCoord(leg?.startCoord) ?? path[0]
            : toRouteCoord(leg?.startCoord) ?? path[0];
    const to = legIndex === legs.length - 1
        ? destination ?? toRouteCoord(leg?.endCoord) ?? path[path.length - 1]
        : isTransitRideLeg(next)
            ? getRideBoundaryCoord(next, "start") ?? toRouteCoord(leg?.endCoord) ?? path[path.length - 1]
            : toRouteCoord(leg?.endCoord) ?? path[path.length - 1];
    return { from, to };
}

/** 저장 경로 데이터가 `sameRoutePath` 조건을 만족하는지 검증하며 잘못된 값은 안전하게 제외합니다. */
export function sameRoutePath(
    first: readonly RoutePathCoord[] | undefined,
    second: readonly RoutePathCoord[] | undefined
): boolean {
    if (first === second) return true;
    if (!first || !second || first.length !== second.length) return false;
    return first.every((coordinate, index) => (
        Math.abs(coordinate.lat - second[index].lat) <= 1e-9 &&
        Math.abs(coordinate.lng - second[index].lng) <= 1e-9
    ));
}

/**
 * Parser v1 ODsay WALK tails are repaired only in the saved-route presentation.
 * This keeps backend history immutable while old schedules render with the same
 * geometry assembly now used by fresh route searches.
 */
export function normalizeLegacySavedTransitLegs(
    route: unknown,
    legs: TransitLegDetail[],
    origin: RoutePathCoord | undefined,
    destination: RoutePathCoord | undefined
): TransitLegDetail[] {
    const metadata = route as { provider?: unknown; geometryRevision?: unknown } | undefined;
    const revision = isFiniteNumber(metadata?.geometryRevision)
        ? metadata.geometryRevision
        : undefined;
    if (metadata?.provider !== "odsay" || (revision !== undefined && revision >= 2)) {
        return legs;
    }

    let changed = false;
    const normalized = legs.map((leg, legIndex) => {
        if (leg.kind !== "WALK" || !Array.isArray(leg.pathCoords) || leg.pathCoords.length < 2) {
            return leg;
        }
        const { from, to } = getSavedWalkDisplayAnchors(
            legs,
            legIndex,
            origin,
            destination
        );
        if (leg.pathGeometrySource !== "WALK_STEPS_LINESTRING") return leg;
        const repairedPath = repairLegacyOdsayWalkPath({
            pathCoords: leg.pathCoords,
            expectedFrom: from,
            expectedTo: to,
            reportedDistanceMeters: leg.distanceMeters,
        });
        // geometryRevision was not persisted by older clients. Require the exact
        // legacy parser signature before stitching so a healthy current ODsay
        // entrance path is never changed merely because the revision is absent.
        if (sameRoutePath(repairedPath, leg.pathCoords)) return leg;
        const pathCoords = stitchTransitWalkPathToAnchors(repairedPath, from, to, {
            terminalStart: legIndex === 0 && !!origin,
            terminalEnd: legIndex === legs.length - 1 && !!destination,
        });
        changed = true;
        return {
            ...leg,
            pathCoords,
            startCoord: pathCoords[0] ?? leg.startCoord,
            endCoord: pathCoords[pathCoords.length - 1] ?? leg.endCoord,
        };
    });
    return changed ? normalized : legs;
}

/** 검증된 경로 조각을 조합해 `buildTransitOptionPath` 지도 표현을 생성합니다. */
export function buildTransitOptionPath(legs: TransitLegDetail[]): RoutePathCoord[] | undefined {
    const pathCoords: RoutePathCoord[] = [];
    legs.forEach((leg) => {
        routeCoords(leg.pathCoords).forEach((coordinate) => {
            const previous = pathCoords[pathCoords.length - 1];
            if (!previous || routeCoordDistanceMeters(previous, coordinate) > 0.5) {
                pathCoords.push(coordinate);
            }
        });
    });
    return pathCoords.length >= 2 ? pathCoords : undefined;
}

/** 저장 경로에서 `getLegBoardCoord`에 필요한 값을 계산하며 사용 가능한 최선의 대체값을 선택합니다. */
export function getLegBoardCoord(legs: TransitLegDetail[], legIndex: number): RoutePathCoord | undefined {
    const leg = legs[legIndex];
    if (!leg) return undefined;

    const previousWalk = legs[legIndex - 1];
    const isRideLeg = leg.kind === "BUS" || leg.kind === "SUBWAY";
    if (isRideLeg && previousWalk?.kind === "WALK") {
        const walkPath = routeCoords(previousWalk.pathCoords);
        const walkEndCoord = walkPath[walkPath.length - 1] ?? toRouteCoord(previousWalk.endCoord);
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

/** 저장 경로에서 `getLegAlightCoord`에 필요한 값을 계산하며 사용 가능한 최선의 대체값을 선택합니다. */
export function getLegAlightCoord(legs: TransitLegDetail[], legIndex: number): RoutePathCoord | undefined {
    const nextWalk = legs[legIndex + 1];
    if (nextWalk?.kind === "WALK") {
        const walkPath = routeCoords(nextWalk.pathCoords);
        return walkPath[0] ?? toRouteCoord(nextWalk.startCoord);
    }
    const leg = legs[legIndex];
    const path = routeCoords(leg.pathCoords);
    return toRouteCoord(leg.endCoord) ?? path[path.length - 1];
}

/** 저장 경로 지도 표현의 `markerBadgeSide` 계산 단계를 한 가지 책임으로 수행합니다. */
export function markerBadgeSide(leg: TransitLegDetail, endpoint: "start" | "end"): "left" | "right" {
    const path = routeCoords(leg.pathCoords);
    if (path.length < 2) return endpoint === "start" ? "right" : "left";
    const first = endpoint === "start" ? path[0] : path[path.length - 2];
    const second = endpoint === "start" ? path[1] : path[path.length - 1];
    return second.lng >= first.lng
        ? (endpoint === "start" ? "left" : "right")
        : (endpoint === "start" ? "right" : "left");
}

/** 구버전 또는 중복 경로 데이터를 `compactStopLabel` 규칙으로 정규화합니다. */
export function compactStopLabel(value?: string, maxLength = 14): string | undefined {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized) return undefined;
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

/** 검증된 경로 조각을 조합해 `buildTransitEventMarkers` 지도 표현을 생성합니다. */
export function buildTransitEventMarkers(
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

/** 저장 경로에서 `nearestPathCoordinate`에 필요한 값을 계산하며 사용 가능한 최선의 대체값을 선택합니다. */
export function nearestPathCoordinate(stop: RoutePathCoord, path: RoutePathCoord[]): RoutePathCoord {
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

/** 검증된 경로 조각을 조합해 `buildTransitPassStopMarkers` 지도 표현을 생성합니다. */
export function buildTransitPassStopMarkers(
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

/** 검증된 경로 조각을 조합해 `buildTransitRouteIdentityMarkers` 지도 표현을 생성합니다. */
export function buildTransitRouteIdentityMarkers(
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

/** 검증된 경로 조각을 조합해 `buildRouteMarkers` 지도 표현을 생성합니다. */
export function buildRouteMarkers(
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
