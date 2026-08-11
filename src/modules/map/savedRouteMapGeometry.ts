import type {
    Place,
} from "../schedule/types";
import {
    getRouteInfoFromRoute,
} from "../schedule/routeInfo";
import type {
    RouteAlternativeOption,
    RoutePathCoord,
    TransitGeometrySource,
    TransitLegDetail,
} from "./routingService";
import type {
    TmapLatLng,
    TmapMarker,
    TmapPathOverlay,
} from "./TmapMapView";










export const WALK_GUIDE_COLOR = "#1A73E8";
export const ETC_GUIDE_COLOR = "#64748B";
export const WALK_CASING_COLOR = "#FFFFFF";
export const TRANSIT_CASING_COLOR = "#FFFFFF";
export const DIRECTION_COLOR = "#FFFFFF";
export const ORIGIN_COLOR = "#12A150";
export const DESTINATION_COLOR = "#F04452";

export type SavedRouteMapPresentationInput = {
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

export type StoredPathOverlay = {
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

export type RestorablePathOverlay = TmapPathOverlay & {
    geometrySource?: string;
    transitLegIndex?: number;
};

export type TrustedStoredWalkGeometrySource =
    | "WALK_STEPS_LINESTRING"
    | "WALK_PASS_SHAPE_LINESTRING"
    | "WALK_API_DETAIL";

export type StoredRouteOverlayGeometryProvenance = {
    geometrySource: TrustedStoredWalkGeometrySource;
    transitLegIndex: number;
};

export type PersistableRouteGeometrySegment = {
    id: string;
    sequence: number;
    mode: string;
    geometrySource?: TransitGeometrySource | "START_END_ONLY" | "WALK_API_DETAIL";
};

/** 저장 경로 데이터가 `isTrustedStoredWalkGeometrySource` 조건을 만족하는지 검증하며 잘못된 값은 안전하게 제외합니다. */
export function isTrustedStoredWalkGeometrySource(
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

/** 저장 경로 데이터가 `isFiniteNumber` 조건을 만족하는지 검증하며 잘못된 값은 안전하게 제외합니다. */
export function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

/** 저장된 좌표 값을 `toRouteCoord` 표현으로 변환하고 유효하지 않은 좌표는 제거합니다. */
export function toRouteCoord(value: unknown): RoutePathCoord | undefined {
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

/** 저장된 좌표 값을 `toMapCoord` 표현으로 변환하고 유효하지 않은 좌표는 제거합니다. */
export function toMapCoord(value: unknown): TmapLatLng | undefined {
    const coord = toRouteCoord(value);
    return coord ? { latitude: coord.lat, longitude: coord.lng } : undefined;
}

/** 저장된 좌표 값을 `mapCoords` 표현으로 변환하고 유효하지 않은 좌표는 제거합니다. */
export function mapCoords(values: unknown): TmapLatLng[] {
    if (!Array.isArray(values)) return [];
    return values.flatMap((value) => {
        const coord = toMapCoord(value);
        return coord ? [coord] : [];
    });
}

/** 저장된 좌표 값을 `routeCoords` 표현으로 변환하고 유효하지 않은 좌표는 제거합니다. */
export function routeCoords(values: unknown): RoutePathCoord[] {
    if (!Array.isArray(values)) return [];
    return values.flatMap((value) => {
        const coord = toRouteCoord(value);
        return coord ? [coord] : [];
    });
}

/** 저장 경로 지도 표현의 `distinctMapCoords` 계산 단계를 한 가지 책임으로 수행합니다. */
export function distinctMapCoords(coords: TmapLatLng[]): TmapLatLng[] {
    const seen = new Set<string>();
    return coords.filter((coord) => {
        const key = `${coord.latitude.toFixed(6)}:${coord.longitude.toFixed(6)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** 구버전 또는 중복 경로 데이터를 `compactConsecutiveMapCoords` 규칙으로 정규화합니다. */
export function compactConsecutiveMapCoords(coords: TmapLatLng[]): TmapLatLng[] {
    return coords.filter((coord, index) => {
        const previous = coords[index - 1];
        return !previous ||
            Math.abs(previous.latitude - coord.latitude) > 1e-8 ||
            Math.abs(previous.longitude - coord.longitude) > 1e-8;
    });
}

/** 저장 경로에서 `getSavedRouteInfoStepCoordGroups`에 필요한 값을 계산하며 사용 가능한 최선의 대체값을 선택합니다. */
export function getSavedRouteInfoStepCoordGroups(route: unknown): TmapLatLng[][] {
    const routeInfo = getRouteInfoFromRoute(route);
    if (!routeInfo) return [];
    return routeInfo.steps.flatMap((step) => {
        const coords = compactConsecutiveMapCoords(mapCoords(step.coordinates));
        return coords.length ? [coords] : [];
    });
}

/** 저장 경로에서 `getSavedRouteInfoPathCoords`에 필요한 값을 계산하며 사용 가능한 최선의 대체값을 선택합니다. */
export function getSavedRouteInfoPathCoords(route: unknown): TmapLatLng[] {
    return compactConsecutiveMapCoords(getSavedRouteInfoStepCoordGroups(route).flat());
}

/** 저장 경로에서 `getSavedRouteAlternative`에 필요한 값을 계산하며 사용 가능한 최선의 대체값을 선택합니다. */
export function getSavedRouteAlternative(route: unknown): RouteAlternativeOption | undefined {
    if (!route || typeof route !== "object") return undefined;
    const candidate = route as Partial<RouteAlternativeOption>;
    if (typeof candidate.id !== "string") return undefined;
    if (!["CAR", "TRANSIT", "WALK", "BIKE", "ETC"].includes(candidate.mode ?? "")) return undefined;
    return candidate as RouteAlternativeOption;
}

/** 저장 경로에서 `getSavedTransitLegCoords`에 필요한 값을 계산하며 사용 가능한 최선의 대체값을 선택합니다. */
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

/** 저장 경로에서 `getExplicitSavedRouteRootPathCoords`에 필요한 값을 계산하며 사용 가능한 최선의 대체값을 선택합니다. */
export function getExplicitSavedRouteRootPathCoords(route: unknown): TmapLatLng[] {
    const rootPath = mapCoords((route as { pathCoords?: unknown } | undefined)?.pathCoords);
    return rootPath.length >= 2 ? rootPath : [];
}

/** 저장 경로에서 `getSavedRoutePathCoords`에 필요한 값을 계산하며 사용 가능한 최선의 대체값을 선택합니다. */
export function getSavedRoutePathCoords(route: unknown, legs: TransitLegDetail[]): TmapLatLng[] {
    const rootPath = getExplicitSavedRouteRootPathCoords(route);
    if (rootPath.length >= 2) return rootPath;
    const legPath = distinctMapCoords(legs.flatMap(getSavedTransitLegCoords));
    if (legPath.length >= 2) return legPath;
    return getSavedRouteInfoPathCoords(route);
}

export type SavedRouteOverviewPadding = {
    top: number;
    right: number;
    bottom: number;
    left: number;
};

/**
 * 동일한 경로가 API 재조회로 새 객체가 되어도 상세 지도의 overview camera를 다시 움직이지 않는다.
 * 카메라 결과에 영향을 주는 bounds와 padding만 identity에 포함한다.
 */
export function getSavedRouteOverviewFitKey(
    coords: readonly TmapLatLng[],
    padding: SavedRouteOverviewPadding
): string | undefined {
    const finiteCoords = coords.filter((coord) => (
        Number.isFinite(coord.latitude) && Number.isFinite(coord.longitude)
    ));
    if (finiteCoords.length < 2) return undefined;

    let minLatitude = finiteCoords[0].latitude;
    let maxLatitude = finiteCoords[0].latitude;
    let minLongitude = finiteCoords[0].longitude;
    let maxLongitude = finiteCoords[0].longitude;
    for (const coord of finiteCoords.slice(1)) {
        minLatitude = Math.min(minLatitude, coord.latitude);
        maxLatitude = Math.max(maxLatitude, coord.latitude);
        minLongitude = Math.min(minLongitude, coord.longitude);
        maxLongitude = Math.max(maxLongitude, coord.longitude);
    }

    return [
        "saved-route-overview-v1",
        minLatitude.toFixed(6),
        maxLatitude.toFixed(6),
        minLongitude.toFixed(6),
        maxLongitude.toFixed(6),
        Math.round(padding.top),
        Math.round(padding.right),
        Math.round(padding.bottom),
        Math.round(padding.left),
    ].join(":");
}
