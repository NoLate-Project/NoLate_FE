import type { Place, TravelMode } from "../schedule/types";
import {
    getRouteAlternativeOptions as getLegacyRouteAlternativeOptions,
    reverseGeocodeToAddress,
    searchAddressByKeyword,
    type PlaceSearchItem,
    type RouteAlternativeOption,
    type RouteApiProvider,
    type RoutePathCoord,
    type TransitGeometrySource,
    type TransitLegDetail,
    type TransitPassStop,
} from "./tmapApi";
import { assessRoutePlausibility } from "./routePlausibility";

export type {
    PlaceSearchItem,
    RouteAlternativeOption,
    RouteApiProvider,
    RoutePathCoord,
    TransitGeometrySource,
    TransitLegDetail,
    TransitPassStop,
};

export { reverseGeocodeToAddress, searchAddressByKeyword };

export type RouteReliability = "live_provider" | "provider_estimate" | "fallback_estimate";

export type RouteSearchErrorCode =
    | "INVALID_ENDPOINTS"
    | "SAME_ENDPOINT"
    | "PROVIDER_UNAVAILABLE"
    | "NO_PROVIDER_ROUTE";

export class RouteSearchError extends Error {
    readonly code: RouteSearchErrorCode;

    constructor(code: RouteSearchErrorCode, message: string) {
        super(message);
        this.name = "RouteSearchError";
        this.code = code;
    }
}

export type RouteSearchOptions = {
    forceRefresh?: boolean;
    departureAt?: Date;
    searchFutureService?: boolean;
};

export type RouteQuality = {
    reliability: RouteReliability;
    label: string;
    notice?: string;
};

const ROUTE_CACHE_TTL_MS = 1000 * 60 * 2;
const SAME_ENDPOINT_THRESHOLD_METERS = 10;
const TRANSIT_FUTURE_SEARCH_INTERVAL_MS = 30 * 60 * 1000;
const TRANSIT_FUTURE_SEARCH_WINDOW_MS = 3 * 60 * 60 * 1000;

type RouteCacheEntry = {
    expiresAt: number;
    options: RouteAlternativeOption[];
};

const routeCache = new Map<string, RouteCacheEntry>();
const pendingRouteSearches = new Map<string, Promise<RouteAlternativeOption[]>>();

function hasRouteCoordinate(place: Place | undefined): place is Place & { lat: number; lng: number } {
    return !!place &&
        typeof place.lat === "number" &&
        Number.isFinite(place.lat) &&
        place.lat >= -90 &&
        place.lat <= 90 &&
        typeof place.lng === "number" &&
        Number.isFinite(place.lng) &&
        place.lng >= -180 &&
        place.lng <= 180;
}

function toRadians(value: number): number {
    return value * Math.PI / 180;
}

function distanceMeters(from: Place & { lat: number; lng: number }, to: Place & { lat: number; lng: number }): number {
    const earthRadiusMeters = 6_371_000;
    const deltaLat = toRadians(to.lat - from.lat);
    const deltaLng = toRadians(to.lng - from.lng);
    const fromLat = toRadians(from.lat);
    const toLat = toRadians(to.lat);
    const haversine = Math.sin(deltaLat / 2) ** 2 +
        Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) ** 2;
    return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function buildRouteCacheKey(
    origin: Place & { lat: number; lng: number },
    destination: Place & { lat: number; lng: number },
    mode: TravelMode,
    departureAt?: Date
): string {
    return [
        mode,
        origin.lat.toFixed(6),
        origin.lng.toFixed(6),
        destination.lat.toFixed(6),
        destination.lng.toFixed(6),
        departureAt && Number.isFinite(departureAt.getTime())
            ? departureAt.toISOString().slice(0, 16)
            : "now",
    ].join(":");
}

function cloneRouteOptions(options: RouteAlternativeOption[]): RouteAlternativeOption[] {
    return options.map((option) => ({ ...option }));
}

function isRenderableProviderRoute(option: RouteAlternativeOption): boolean {
    if (option.source !== "api") return false;
    if (typeof option.minutes !== "number" || !Number.isFinite(option.minutes) || option.minutes <= 0) return false;
    if (!Array.isArray(option.pathCoords) || option.pathCoords.length < 2) return false;
    return option.pathCoords.every((coord) =>
        Number.isFinite(coord.lat) &&
        coord.lat >= -90 &&
        coord.lat <= 90 &&
        Number.isFinite(coord.lng) &&
        coord.lng >= -180 &&
        coord.lng <= 180
    );
}

function getModeLabel(mode: TravelMode): string {
    if (mode === "CAR") return "자동차";
    if (mode === "TRANSIT") return "대중교통";
    if (mode === "WALK") return "도보";
    if (mode === "BIKE") return "자전거";
    return "이동";
}

function validateRouteRequest(
    origin: Place | undefined,
    destination: Place | undefined
): asserts origin is Place & { lat: number; lng: number } {
    if (!hasRouteCoordinate(origin) || !hasRouteCoordinate(destination)) {
        throw new RouteSearchError("INVALID_ENDPOINTS", "출발지와 도착지를 정확히 선택해 주세요.");
    }
    if (distanceMeters(origin, destination) < SAME_ENDPOINT_THRESHOLD_METERS) {
        throw new RouteSearchError("SAME_ENDPOINT", "출발지와 도착지가 같습니다. 다른 위치를 선택해 주세요.");
    }
}

export function getRouteQuality(option: RouteAlternativeOption): RouteQuality {
    if (option.routePlausibility === "geometry_suspected") {
        return {
            reliability: "provider_estimate",
            label: "경로 확인 필요",
            notice: "경로가 실제 도로와 다르게 표시될 수 있습니다. 다른 경로도 확인해 주세요.",
        };
    }
    if (option.transitServiceState === "not_operating") {
        return {
            reliability: "provider_estimate",
            label: "현재 운행 종료",
            notice: "현재 운행하지 않는 경로입니다. 출발 시각을 변경해 다시 검색해 주세요.",
        };
    }
    if (option.source === "api") {
        const reliability = option.routeReliability ?? (
            option.provider === "openstreetmap" ? "provider_estimate" : "live_provider"
        );
        return {
            reliability,
            label: option.provider === "openstreetmap" ? "자전거 경로" : "경로 안내",
        };
    }

    if (option.fallbackKind === "road") {
        return {
            reliability: "provider_estimate",
            label: "예상 경로",
            notice: "도로 상황에 따라 실제 이동 시간과 다를 수 있습니다.",
        };
    }

    return {
        reliability: "fallback_estimate",
        label: "예상 경로",
        notice: "실제 이동 시간과 다를 수 있습니다. 다른 경로도 확인해 주세요.",
    };
}

export function getRouteQualityLabel(option: RouteAlternativeOption): string {
    return getRouteQuality(option).label;
}

export function getRouteQualityNotice(option: RouteAlternativeOption): string | undefined {
    return getRouteQuality(option).notice;
}

/**
 * 일반 경로 공급자명은 제품 화면에 노출하지 않는다. 지도 데이터 라이선스상
 * 표시가 필요한 OpenStreetMap 저작자 링크만 예외로 유지한다.
 */
export function shouldShowRequiredMapAttribution(option?: RouteAlternativeOption): boolean {
    return option?.provider === "openstreetmap" &&
        !!option.attributionText?.trim() &&
        !!option.attributionUrl?.trim();
}

function attachRouteQuality(
    option: RouteAlternativeOption,
    origin: Place,
    destination: Place
): RouteAlternativeOption {
    // 현재 legacy API에서 source=api인 응답은 TMAP 호출 결과다.
    const normalizedOption = option.source === "api" && !option.provider
        ? { ...option, provider: "tmap" as const }
        : option;
    const quality = getRouteQuality(normalizedOption);
    const plausibility = assessRoutePlausibility(normalizedOption, origin, destination);
    if (plausibility?.status === "geometry_suspected") {
        return {
            ...normalizedOption,
            routeReliability: "provider_estimate",
            routeQualityLabel: "경로 확인 필요",
            routeQualityNotice: "경로가 실제 도로와 다르게 표시될 수 있습니다. 다른 경로도 확인해 주세요.",
            routePlausibility: plausibility.status,
            routeDetourRatio: plausibility.detourRatio,
        };
    }
    return {
        ...normalizedOption,
        routeReliability: quality.reliability,
        routeQualityLabel: quality.label,
        routeQualityNotice: quality.notice,
        routePlausibility: plausibility?.status,
        routeDetourRatio: plausibility?.detourRatio,
    };
}

export function isOperatingTransitRoute(option: RouteAlternativeOption): boolean {
    if (option.mode !== "TRANSIT") return true;
    return !(option.transitLegs ?? []).some((leg) =>
        (leg.kind === "BUS" || leg.kind === "SUBWAY") && leg.serviceAvailable === false
    );
}

function withTransitDepartureState(
    option: RouteAlternativeOption,
    departureAt: Date,
    source: "requested" | "next_service_search",
    state: "operating" | "not_operating"
): RouteAlternativeOption {
    return {
        ...option,
        transitServiceState: state,
        transitDepartureAt: departureAt.toISOString(),
        transitDepartureTimeSource: source,
    };
}

function markTransitRouteAsNotOperating(option: RouteAlternativeOption): RouteAlternativeOption {
    return {
        ...option,
        routeReliability: "provider_estimate",
        routeQualityLabel: "현재 운행 종료",
        routeQualityNotice: "현재 운행하지 않는 경로입니다. 출발 시각을 변경해 다시 검색해 주세요.",
    };
}

function buildFutureTransitSearchTimes(departureAt: Date): Date[] {
    const firstBoundary = (Math.floor(departureAt.getTime() / TRANSIT_FUTURE_SEARCH_INTERVAL_MS) + 1) *
        TRANSIT_FUTURE_SEARCH_INTERVAL_MS;
    const endAt = departureAt.getTime() + TRANSIT_FUTURE_SEARCH_WINDOW_MS;
    const times: Date[] = [];
    for (let value = firstBoundary; value <= endAt; value += TRANSIT_FUTURE_SEARCH_INTERVAL_MS) {
        times.push(new Date(value));
    }
    return times;
}

/**
 * 화면이 직접 provider API를 호출하지 않게 하는 라우팅 경계.
 * 현재 내부 구현은 기존 Tmap 중심 래퍼를 사용하지만, 이후 백엔드 프록시나
 * Kakao/Naver provider를 추가할 때 화면 코드는 이 함수만 유지하면 된다.
 */
export async function getRouteAlternativeOptions(
    origin: Place | undefined,
    destination: Place | undefined,
    mode: TravelMode,
    options: RouteSearchOptions = {}
): Promise<RouteAlternativeOption[]> {
    validateRouteRequest(origin, destination);
    if (!hasRouteCoordinate(destination)) {
        throw new RouteSearchError("INVALID_ENDPOINTS", "출발지와 도착지를 정확히 선택해 주세요.");
    }

    const requestedDepartureAt = options.departureAt && Number.isFinite(options.departureAt.getTime())
        ? new Date(options.departureAt)
        : new Date();
    const cacheKey = buildRouteCacheKey(origin, destination, mode, options.departureAt);
    const now = Date.now();
    const cached = routeCache.get(cacheKey);
    if (!options.forceRefresh && cached && cached.expiresAt > now) {
        return cloneRouteOptions(cached.options);
    }
    if (cached) routeCache.delete(cacheKey);

    const pending = pendingRouteSearches.get(cacheKey);
    if (pending) return pending.then(cloneRouteOptions);

    const fetchProviderOptionsAt = (departureAt: Date) => getLegacyRouteAlternativeOptions(
        origin,
        destination,
        mode,
        { departureAt }
    ).then((legacyOptions) => legacyOptions
        .filter(isRenderableProviderRoute)
        .map((option) => attachRouteQuality(option, origin, destination)));

    const resolveTransitServiceState = async (
        providerOptions: RouteAlternativeOption[]
    ): Promise<RouteAlternativeOption[]> => {
        if (mode !== "TRANSIT") return providerOptions;
        const operating = providerOptions.filter(isOperatingTransitRoute);
        if (operating.length > 0) {
            return operating.map((option) => withTransitDepartureState(
                option,
                requestedDepartureAt,
                "requested",
                "operating"
            ));
        }

        if (options.searchFutureService !== false) {
            for (const futureDepartureAt of buildFutureTransitSearchTimes(requestedDepartureAt)) {
                try {
                    const futureOptions = await fetchProviderOptionsAt(futureDepartureAt);
                    const futureOperating = futureOptions.filter(isOperatingTransitRoute);
                    if (futureOperating.length > 0) {
                        return futureOperating.map((option) => withTransitDepartureState(
                            option,
                            futureDepartureAt,
                            "next_service_search",
                            "operating"
                        ));
                    }
                } catch {
                    // 다음 시간대 조회가 실패해도 현재 조회 결과의 종료 상태는 보존한다.
                }
            }
        }

        return providerOptions.map((option) => withTransitDepartureState(
            markTransitRouteAsNotOperating(option),
            requestedDepartureAt,
            "requested",
            "not_operating"
        ));
    };

    const request = fetchProviderOptionsAt(requestedDepartureAt)
        .then(resolveTransitServiceState)
        .then((providerOptions) => {
            if (!providerOptions.length) {
                throw new RouteSearchError(
                    "NO_PROVIDER_ROUTE",
                    `${getModeLabel(mode)} 경로를 찾지 못했습니다. 잠시 후 다시 검색해 주세요.`
                );
            }
            routeCache.set(cacheKey, {
                expiresAt: Date.now() + ROUTE_CACHE_TTL_MS,
                options: providerOptions,
            });
            return cloneRouteOptions(providerOptions);
        })
        .catch((error: unknown) => {
            if (error instanceof RouteSearchError) throw error;
            throw new RouteSearchError(
                "PROVIDER_UNAVAILABLE",
                "경로 서비스에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 검색해 주세요."
            );
        })
        .finally(() => {
            pendingRouteSearches.delete(cacheKey);
        });

    pendingRouteSearches.set(cacheKey, request);
    return request;
}

export function invalidateRouteSearch(
    origin: Place | undefined,
    destination: Place | undefined,
    mode: TravelMode
): void {
    if (!hasRouteCoordinate(origin) || !hasRouteCoordinate(destination)) return;
    const prefix = buildRouteCacheKey(origin, destination, mode).replace(/:now$/, ":");
    for (const key of routeCache.keys()) {
        if (key.startsWith(prefix)) routeCache.delete(key);
    }
}
