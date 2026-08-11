export type { PlaceSearchItem, RoutePathCoord, PlaceSearchContext, RouteGuideStep, RouteTrafficLevel,
    RouteTrafficSection, RouteApiProvider, RouteReliability, TransitServiceState,
    TransitDepartureTimeSource, RouteProviderSearchOptions, TransitLegKind, TransitServiceClass,
    TransitPassStop, TransitGeometrySource, TransitLegDetail, TransitRouteOption,
    RouteAlternativeOption, ParsedRoadRoute } from "./tmapApiCore";
export { parseTmapRoadRouteResponse, parseLineString } from "./tmapRoadResponse";
export { parseTransitOptionsFromTmap } from "./tmapRouteProviders";

import type {
    Place,
    TravelMode,
} from "../schedule/types";

import {
    infoMapDebug,
    hasTmapAppKey,
    hasTransitRouteProvider,
    tmapApiErrorMessage,
    SEARCH_RESULT_LIMIT,
} from "./tmapApiCore.ts";
import type {
    PlaceSearchItem,
    PlaceSearchContext,
    RouteProviderSearchOptions,
    TransitRouteOption,
    RouteAlternativeOption,
    RouteEtaResult,
} from "./tmapApiCore.ts";

import {
    buildAlternativeId,
    dedupeRouteAlternatives,
    limitAlternativesByMode,
} from "./tmapTransitGeometry.ts";
import {
    dedupeSearchResults,
    searchViaTmapPoi,
    geocodeViaTmap,
    reverseViaTmap,
    searchViaNominatim,
    reverseViaNominatim,
} from "./tmapPlaceSearch.ts";
import {
    getBicycleAlternativesViaOpenStreetMap,
    getTransitRouteViaPreferredProvider,
    getDrivingAlternatives,
    getWalkingAlternatives,
} from "./tmapRouteProviders.ts";

/** 지도 공급자 호출과 대체 경로를 조율해 `searchAddressByKeyword` 결과를 반환합니다. */
export async function searchAddressByKeyword(
    query: string,
    context?: PlaceSearchContext
): Promise<PlaceSearchItem[]> {
    const normalized = query.trim();
    if (!normalized) return [];

    const merged: PlaceSearchItem[] = [];

    if (hasTmapAppKey()) {
        try {
            const poiResults = await searchViaTmapPoi(normalized, context);
            merged.push(...poiResults);
        } catch (error) {
            infoMapDebug("[주소검색] Tmap POI 실패 →", tmapApiErrorMessage(error));
        }

        try {
            const geocoded = await geocodeViaTmap(normalized, context);
            merged.push(...geocoded);
        } catch (error) {
            infoMapDebug("[주소검색] Tmap FullAddrGeo 실패 →", tmapApiErrorMessage(error));
        }

        const unique = dedupeSearchResults(merged);
        if (unique.length > 0) return unique.slice(0, SEARCH_RESULT_LIMIT);
    }

    try {
        return await searchViaNominatim(normalized, context);
    } catch (error) {
        if (!hasTmapAppKey()) {
            throw new Error("경로 찾기를 지금 사용할 수 없어요. 잠시 후 다시 시도해 주세요.");
        }
        throw error;
    }
}

// 역지오코딩은 도로명 주소 품질이 더 좋은 Tmap을 우선 사용한다.
/** 지도 공급자 호출과 대체 경로를 조율해 `reverseGeocodeToAddress` 결과를 반환합니다. */
export async function reverseGeocodeToAddress(lat: number, lng: number): Promise<string | undefined> {
    if (hasTmapAppKey()) {
        try {
            const address = await reverseViaTmap(lat, lng);
            if (address) return address;
        } catch (error) {
            infoMapDebug("[역지오코딩] Tmap 실패 →", tmapApiErrorMessage(error));
        }
    }

    try {
        return await reverseViaNominatim(lat, lng);
    } catch {
        return undefined;
    }
}

// 대중교통 전용 옵션 API.
// UI에서는 상세 leg/path가 필요하므로 단순 ETA가 아니라 TransitRouteOption 전체를 내려준다.
/** 지도 공급자 호출과 대체 경로를 조율해 `getTransitRouteOptions` 결과를 반환합니다. */
export async function getTransitRouteOptions(
    origin: Place | undefined,
    destination: Place | undefined,
    options: RouteProviderSearchOptions = {}
): Promise<TransitRouteOption[]> {
    if (
        !origin ||
        !destination ||
        typeof origin.lat !== "number" ||
        typeof origin.lng !== "number" ||
        typeof destination.lat !== "number" ||
        typeof destination.lng !== "number"
    ) {
        return [];
    }

    if (hasTransitRouteProvider()) {
        try {
            const providerOptions = await getTransitRouteViaPreferredProvider(origin, destination, options.departureAt);
            if (providerOptions.length > 0) return providerOptions;
        } catch (error) {
            infoMapDebug("[대중교통옵션] 대중교통 공급자 실패 →", tmapApiErrorMessage(error));
        }
    }

    // 자동차 도로 또는 직선거리 값은 대중교통 경로가 아니므로 대체 결과로 노출하지 않는다.
    return [];
}

// 화면에서 쓰는 "대안 경로"의 메인 진입점.
// 실제 공급자 경로가 없으면 빈 배열을 반환해 화면이 명확한 실패 상태를 표시하게 한다.
/** 지도 공급자 호출과 대체 경로를 조율해 `getRouteAlternativeOptions` 결과를 반환합니다. */
export async function getRouteAlternativeOptions(
    origin: Place | undefined,
    destination: Place | undefined,
    mode: TravelMode,
    options: RouteProviderSearchOptions = {}
): Promise<RouteAlternativeOption[]> {
    if (
        !origin ||
        !destination ||
        typeof origin.lat !== "number" ||
        typeof origin.lng !== "number" ||
        typeof destination.lat !== "number" ||
        typeof destination.lng !== "number"
    ) {
        return [];
    }

    if (mode === "TRANSIT") {
        if (hasTransitRouteProvider()) {
            try {
                const providerOptions = await getTransitRouteViaPreferredProvider(origin, destination, options.departureAt);
                const transitAlternatives = providerOptions.map((item, index) => ({
                    ...item,
                    id: item.id || buildAlternativeId("transit", index),
                    mode: "TRANSIT" as const,
                }));
                if (transitAlternatives.length > 0) {
                    return limitAlternativesByMode("TRANSIT", dedupeRouteAlternatives(transitAlternatives));
                }
            } catch (error) {
                infoMapDebug("[대안경로] 대중교통 공급자 실패 →", tmapApiErrorMessage(error));
                throw error;
            }
        }

        return [];
    }

    if (mode === "CAR" || mode === "ETC") {
        if (hasTmapAppKey()) {
            try {
                const alternatives = await getDrivingAlternatives(origin, destination, mode);
                if (alternatives.length > 0) return limitAlternativesByMode(mode, alternatives);
            } catch (error) {
                infoMapDebug("[대안경로] Tmap driving 실패 →", tmapApiErrorMessage(error));
                throw error;
            }
        }

        return [];
    }

    if (mode === "WALK") {
        if (hasTmapAppKey()) {
            try {
                const walkAlternatives = await getWalkingAlternatives(origin, destination);
                if (walkAlternatives.length > 0) return limitAlternativesByMode("WALK", walkAlternatives);
            } catch (error) {
                infoMapDebug("[대안경로] Tmap pedestrian 실패 →", tmapApiErrorMessage(error));
                throw error;
            }
        }

        return [];
    }

    if (mode === "BIKE") {
        try {
            const bicycleAlternatives = await getBicycleAlternativesViaOpenStreetMap(origin, destination);
            return limitAlternativesByMode("BIKE", dedupeRouteAlternatives(bicycleAlternatives));
        } catch (error) {
            infoMapDebug("[대안경로] OpenStreetMap bicycle 실패 →", tmapApiErrorMessage(error));
            throw error;
        }
    }

    return [];
}

// ETA는 대안 경로 목록 중 가장 빠른 옵션을 골라 단일 요약값만 돌려준다.
/** 지도 공급자 호출과 대체 경로를 조율해 `getRouteEta` 결과를 반환합니다. */
export async function getRouteEta(
    origin: Place | undefined,
    destination: Place | undefined,
    mode: TravelMode
): Promise<RouteEtaResult> {
    const alternatives = await getRouteAlternativeOptions(origin, destination, mode);
    if (alternatives.length > 0) {
        const best = [...alternatives].sort((a, b) => {
            const aMinutes = typeof a.minutes === "number" ? a.minutes : Number.POSITIVE_INFINITY;
            const bMinutes = typeof b.minutes === "number" ? b.minutes : Number.POSITIVE_INFINITY;
            return aMinutes - bMinutes;
        })[0];
        return {
            minutes: best.minutes,
            distanceMeters: best.distanceMeters,
            source: best.source,
            fallbackKind: best.fallbackKind,
            pathCoords: best.pathCoords,
        };
    }

    // ETA 호출자도 실제 경로가 없을 때 추정 선을 경로로 오해하지 않도록 빈 결과만 받는다.
    return { source: "fallback" };
}
