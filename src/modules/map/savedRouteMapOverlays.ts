import type {
    TravelMode,
} from "../schedule/types";
import {
    getBusLineColor,
    getRouteStepColor,
    getSubwayLineColor,
    type RouteInfo,
    type RouteStep,
} from "../schedule/routeInfo";
import type {
    RouteAlternativeOption,
    TransitLegDetail,
} from "./routingService";
import type {
    TmapLatLng,
    TmapPathOverlay,
} from "./TmapMapView";

import {
    getFallbackRouteStrokePresentation,
    getTransitNativeDirectionOpacity,
    getTransitRouteLinePresentation,
    getTransitRouteThemePresentation,
    getTransitWalkGuidePresentation,
    shouldRenderTransitNativeDirection,
    shouldRenderTransitStopAccessLinks,
} from "./transitRoutePresentation";




import {
    routeCoordDistanceMeters,
    TRANSIT_CONNECTOR_POLICY,
} from "./transitRouteGeometry";



import {
    DIRECTION_COLOR,
    ETC_GUIDE_COLOR,
    TRANSIT_CASING_COLOR,
    WALK_CASING_COLOR,
    WALK_GUIDE_COLOR,
    compactConsecutiveMapCoords,
    getSavedTransitLegCoords,
    isFiniteNumber,
    isTrustedStoredWalkGeometrySource,
    mapCoords,
    toMapCoord,
    type RestorablePathOverlay,
    type StoredPathOverlay,
} from "./savedRouteMapGeometry";

/** 저장 경로에서 `getLegLineColor`에 필요한 값을 계산하며 사용 가능한 최선의 대체값을 선택합니다. */
export function getLegLineColor(leg: TransitLegDetail): string {
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

/** 영속화된 지도 데이터를 `parseStoredPathOverlays` 규칙으로 검증해 현재 오버레이 형식으로 복원합니다. */
export function parseStoredPathOverlays(route: unknown): RestorablePathOverlay[] {
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

/** 저장 경로 데이터가 `isWalkOverlay` 조건을 만족하는지 검증하며 잘못된 값은 안전하게 제외합니다. */
export function isWalkOverlay(overlay: TmapPathOverlay): boolean {
    return overlay.strokeStyle === "dash" ||
        overlay.strokeStyle === "dot" ||
        !!overlay.dashPattern?.length ||
        overlay.shape === "dot" ||
        /(?:walk|connector|access-link|transfer)/i.test(overlay.id);
}

/** 현재 이동 수단·줌·테마 정책에 맞춰 `styleStoredTransitOverlay` 선 표현을 적용합니다. */
export function styleStoredTransitOverlay(
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
    if (accessLink && !shouldRenderTransitStopAccessLinks(mapZoom)) return undefined;
    const walkAccessLink = /walk-access-link/i.test(overlay.id);

    if (walk) {
        const walkGuide = getTransitWalkGuidePresentation(mapZoom);
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
            dashPattern: [...walkGuide.dashPattern],
            strokeStyle: walkGuide.strokeStyle,
            outlineStrokeStyle: walkGuide.outlineStrokeStyle,
            renderMode: "native",
            showDirection: false,
            nativeDirection: false,
            // 승차 본선(40+)이 접합부에서 도보 점을 덮도록 planner와 같은 계층을 쓴다.
            zIndex: (accessLink ? 34 : 30) + (
                typeof legIndex === "number" ? Math.min(legIndex, 9) * 0.1 : 0
            ),
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

/** 검증된 경로 조각을 조합해 `buildTransitLegOverlay` 지도 표현을 생성합니다. */
export function buildTransitLegOverlay(
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
    const walkGuide = getTransitWalkGuidePresentation(mapZoom);
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
        dashPattern: walk ? [...walkGuide.dashPattern] : undefined,
        strokeStyle: walk ? walkGuide.strokeStyle : "solid",
        outlineStrokeStyle: walk ? walkGuide.outlineStrokeStyle : "solid",
        renderMode: "native",
        showDirection: false,
        nativeDirection: directionEnabled,
        nativeDirectionColor: directionEnabled ? DIRECTION_COLOR : undefined,
        nativeDirectionOpacity: directionEnabled ? getTransitNativeDirectionOpacity(mapZoom) : undefined,
        zIndex: walk
            ? 30 + Math.min(legIndex, 9) * 0.1
            : neutral
                ? 35 + Math.min(legIndex, 9) * 0.1
                : 40 + Math.min(legIndex, 9) * 0.1,
    };
}

/** 검증된 경로 조각을 조합해 `buildFocusedLegOverlay` 지도 표현을 생성합니다. */
export function buildFocusedLegOverlay(
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

/** 현재 이동 수단·줌·테마 정책에 맞춰 `styleNonTransitOverlay` 선 표현을 적용합니다. */
export function styleNonTransitOverlay(
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
    const walkGuide = getTransitWalkGuidePresentation(mapZoom);

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
        dashPattern: walk ? [...walkGuide.dashPattern] : undefined,
        strokeStyle: walk ? walkGuide.strokeStyle : "solid",
        outlineStrokeStyle: walk ? walkGuide.outlineStrokeStyle : "solid",
        renderMode: "native",
        showDirection: false,
        nativeDirection: directionEnabled,
        nativeDirectionColor: directionEnabled ? DIRECTION_COLOR : undefined,
        nativeDirectionOpacity: directionEnabled ? getTransitNativeDirectionOpacity(mapZoom) : undefined,
        zIndex: 40,
    };
}

/** 저장된 좌표 값을 `routeInfoStepMode` 표현으로 변환하고 유효하지 않은 좌표는 제거합니다. */
export function routeInfoStepMode(step: RouteStep): TravelMode {
    if (step.type === "BUS" || step.type === "SUBWAY") return "TRANSIT";
    if (step.type === "WALK" || step.type === "TRANSFER") return "WALK";
    if (step.type === "BIKE") return "BIKE";
    return "CAR";
}

/** 저장 경로 지도 표현의 `inferRouteInfoMode` 계산 단계를 한 가지 책임으로 수행합니다. */
export function inferRouteInfoMode(routeInfo: RouteInfo): TravelMode {
    const movementSteps = routeInfo.steps.filter(
        (step) => step.type !== "ORIGIN" && step.type !== "DESTINATION"
    );
    if (movementSteps.some((step) => step.type === "BUS" || step.type === "SUBWAY")) return "TRANSIT";
    if (movementSteps.some((step) => step.type === "BIKE")) return "BIKE";
    if (movementSteps.some((step) => step.type === "DRIVE")) return "CAR";
    if (movementSteps.some((step) => step.type === "WALK" || step.type === "TRANSFER")) return "WALK";
    return "ETC";
}

/** RouteInfo만 저장한 구버전 일정에서도 단계별 geometry를 서로 임의로 잇지 않고 복원한다. */
export function buildRouteInfoPathOverlays(
    routeInfo: RouteInfo,
    mapZoom: number,
    isDark: boolean
): TmapPathOverlay[] {
    const movementSteps = routeInfo.steps.filter(
        (step) => step.type !== "ORIGIN" && step.type !== "DESTINATION"
    );
    const overlays = movementSteps.flatMap((step, index): TmapPathOverlay[] => {
        const coords = compactConsecutiveMapCoords(mapCoords(step.coordinates));
        if (coords.length < 2) return [];

        const mode = routeInfoStepMode(step);
        const overlay = styleNonTransitOverlay({
            id: `${routeInfo.id}-${step.id}`,
            mode,
            minutes: step.durationMinutes,
            source: "fallback",
        }, {
            id: `saved-route-info-${step.id}-${index}`,
            coords,
        }, mapZoom, isDark);

        if (step.type !== "BUS" && step.type !== "SUBWAY") return [overlay];

        const line = getTransitRouteLinePresentation(mapZoom);
        return [{
            ...overlay,
            color: getRouteStepColor(step),
            width: line.rideWidth,
            outlineWidth: Math.max(0, (line.rideCasingWidth - line.rideWidth) / 2),
        }];
    });
    if (overlays.length > 0) return overlays;

    // 일부 오래된 비대중교통 안내는 이동 단계마다 한 점만 남아 있다. 이때에만 실제 이동
    // 단계의 점을 안내 순서대로 잇는다. 출·도착 마커 좌표나 대중교통 승하차점만 이어서
    // 실제 경로처럼 보이는 직선을 만들지는 않는다.
    const mode = inferRouteInfoMode(routeInfo);
    if (mode === "TRANSIT" || mode === "ETC") return [];
    const summaryCoords = compactConsecutiveMapCoords(
        movementSteps.flatMap((step) => mapCoords(step.coordinates))
    );
    if (summaryCoords.length < 2) return [];
    return [styleNonTransitOverlay({
        id: routeInfo.id,
        mode,
        minutes: routeInfo.totalDurationMinutes,
        source: "fallback",
    }, {
        id: "saved-route-info-summary",
        coords: summaryCoords,
    }, mapZoom, isDark)];
}

/** 저장 경로 지도 표현의 `endpointDistance` 계산 단계를 한 가지 책임으로 수행합니다. */
export function endpointDistance(first: TmapLatLng, second: TmapLatLng): number {
    return routeCoordDistanceMeters(
        { lat: first.latitude, lng: first.longitude },
        { lat: second.latitude, lng: second.longitude }
    );
}

/** 저장 경로 지도 표현의 `samplePolyline` 계산 단계를 한 가지 책임으로 수행합니다. */
export function samplePolyline(coords: TmapLatLng[], maxSamples = 96): TmapLatLng[] {
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

/** 저장 경로 지도 표현의 `pointToSegmentDistanceMeters` 계산 단계를 한 가지 책임으로 수행합니다. */
export function pointToSegmentDistanceMeters(
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

/** 저장 경로에서 `nearestPolylineDistanceMeters`에 필요한 값을 계산하며 사용 가능한 최선의 대체값을 선택합니다. */
export function nearestPolylineDistanceMeters(point: TmapLatLng, polyline: TmapLatLng[]): number {
    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 1; index < polyline.length; index += 1) {
        nearest = Math.min(nearest, pointToSegmentDistanceMeters(point, polyline[index - 1], polyline[index]));
    }
    return nearest;
}

/** 저장 경로 데이터가 `isStoredOverlayShapeCompatible` 조건을 만족하는지 검증하며 잘못된 값은 안전하게 제외합니다. */
export function isStoredOverlayShapeCompatible(
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

/** 저장 경로에서 `getStoredOverlayShapeDeviationMeters`에 필요한 값을 계산하며 사용 가능한 최선의 대체값을 선택합니다. */
export function getStoredOverlayShapeDeviationMeters(
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

/** 저장 경로에서 `getPolylineLengthMeters`에 필요한 값을 계산하며 사용 가능한 최선의 대체값을 선택합니다. */
export function getPolylineLengthMeters(coords: TmapLatLng[]): number {
    return coords.slice(1).reduce((total, coord, index) => (
        total + endpointDistance(coords[index], coord)
    ), 0);
}

/** 저장 경로 데이터가 `isValidStoredTransitAccessLink` 조건을 만족하는지 검증하며 잘못된 값은 안전하게 제외합니다. */
export function isValidStoredTransitAccessLink(
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

/** 저장 경로 데이터가 `isTrustedStoredWalkDetailOverlay` 조건을 만족하는지 검증하며 잘못된 값은 안전하게 제외합니다. */
export function isTrustedStoredWalkDetailOverlay(
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

/** 저장 경로에서 `getStoredTransitOverlayAssignments`에 필요한 값을 계산하며 사용 가능한 최선의 대체값을 선택합니다. */
export function getStoredTransitOverlayAssignments(
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
