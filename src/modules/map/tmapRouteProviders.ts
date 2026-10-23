import axios from "axios";
import { parseTmapPedestrianGeometry } from './tmapPedestrianGeometry';

import type {
    Place,
} from "../schedule/types";
import {
    getOdsayTransitRouteOptions,
} from "./odsayApi";

import {
    infoMapDebug,
    scheduleOpenStreetMapRequest,
    safeNumber,
    tmapClient,
    tmapApiErrorMessage,
    clampPathCoords,
    dedupePathCoords,
    normalizeTransitTimeToMinutes,
    normalizeTransitTotalDurationSeconds,
    OPENSTREETMAP_BIKE_ROUTING_BASE_URL,
    OPENSTREETMAP_REQUEST_TIMEOUT_MS,
} from "./tmapApiCore.ts";
import type {
    RoutePathCoord,
    TransitRouteOption,
    RouteAlternativeOption,
    ParsedRoadRoute,
} from "./tmapApiCore.ts";

import {
    parseTransitLegDetails,
    buildTransitModeSummary,
    buildAlternativeId,
    dedupeRouteAlternatives,
} from "./tmapTransitGeometry.ts";
import {
    parseLatLngPair,
    parseTmapRoadRouteResponse,
    parseTransitStepSummary,
    parseTransitItineraryPath,
    buildTransitOptionPath,
} from "./tmapRoadResponse.ts";
import {
    parseOsrmBikeGuideSteps,
} from "./tmapPlaceSearch.ts";

/** 지도 공급자 호출과 대체 경로를 조율해 `getBicycleAlternativesViaOpenStreetMap` 결과를 반환합니다. */
export async function getBicycleAlternativesViaOpenStreetMap(
    origin: Place,
    destination: Place
): Promise<RouteAlternativeOption[]> {
    return scheduleOpenStreetMapRequest(async () => {
        const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
        // routed-bike 서버는 자전거 그래프를 미리 적재하므로 OSRM URL의 profile 자리는 driving을 사용한다.
        const response = await axios.get(
            `${OPENSTREETMAP_BIKE_ROUTING_BASE_URL}/route/v1/driving/${coordinates}`,
            {
                params: {
                    alternatives: true,
                    overview: "full",
                    geometries: "geojson",
                    steps: true,
                },
                timeout: OPENSTREETMAP_REQUEST_TIMEOUT_MS,
                headers: { "User-Agent": "NoLateFE/1.0" },
            }
        );

        if (response.data?.code !== "Ok") return [];
        const routes = Array.isArray(response.data?.routes) ? response.data.routes : [];
        return routes
            .map((route: any, index: number) => {
                const durationSeconds = safeNumber(route?.duration);
                const distanceMeters = safeNumber(route?.distance);
                const pathCoords = Array.isArray(route?.geometry?.coordinates)
                    ? clampPathCoords(
                        dedupePathCoords(
                            route.geometry.coordinates
                                .map((point: unknown) => parseLatLngPair(point))
                                .filter((coord: RoutePathCoord | null): coord is RoutePathCoord => coord !== null)
                        )
                    )
                    : undefined;

                if (
                    typeof durationSeconds !== "number" ||
                    durationSeconds <= 0 ||
                    !Array.isArray(pathCoords) ||
                    pathCoords.length < 2
                ) {
                    return null;
                }

                return {
                    id: buildAlternativeId("openstreetmap-bike", index),
                    mode: "BIKE",
                    minutes: Math.max(1, Math.ceil(durationSeconds / 60)),
                    distanceMeters,
                    pathCoords,
                    guideSteps: parseOsrmBikeGuideSteps(route),
                    source: "api",
                    provider: "openstreetmap",
                    attributionText: "© OpenStreetMap contributors",
                    attributionUrl: "https://www.openstreetmap.org/fixthemap",
                } as RouteAlternativeOption;
            })
            .filter((route: RouteAlternativeOption | null): route is RouteAlternativeOption => route !== null);
    });
}

/** 지도 공급자 호출과 대체 경로를 조율해 `getDrivingRouteViaTmap` 결과를 반환합니다. */
export async function getDrivingRouteViaTmap(
    origin: Place,
    destination: Place,
    searchOption: string
): Promise<ParsedRoadRoute> {
    const client = tmapClient();
    const payload = new URLSearchParams({
        startX: String(origin.lng),
        startY: String(origin.lat),
        endX: String(destination.lng),
        endY: String(destination.lat),
        reqCoordType: "WGS84GEO",
        resCoordType: "WGS84GEO",
        searchOption,
        trafficInfo: "Y",
    });
    const response = await client.post(
        "/tmap/routes",
        payload.toString(),
        {
            params: { version: 1, format: "json" },
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
    );

    return parseTmapRoadRouteResponse(response.data);
}

/** 지도 공급자 호출과 대체 경로를 조율해 `getWalkingRouteViaTmap` 결과를 반환합니다. */
export async function getWalkingRouteViaTmap(
    origin: Place,
    destination: Place,
    searchOption = "0"
): Promise<ParsedRoadRoute> {
    // Bind the response to the actual request, not caller objects mutated during the await.
    const requestedOrigin = { lat: origin.lat, lng: origin.lng };
    const requestedDestination = { lat: destination.lat, lng: destination.lng };
    const client = tmapClient();
    const payload = new URLSearchParams({
        startX: String(requestedOrigin.lng),
        startY: String(requestedOrigin.lat),
        endX: String(requestedDestination.lng),
        endY: String(requestedDestination.lat),
        startName: origin.name ?? "출발",
        endName: destination.name ?? "도착",
        reqCoordType: "WGS84GEO",
        resCoordType: "WGS84GEO",
        sort: "index",
        searchOption,
    });
    const response = await client.post(
        "/tmap/routes/pedestrian",
        payload.toString(),
        {
            params: { version: 1, format: "json" },
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
    );

    return { ...parseTmapRoadRouteResponse(response.data),
        pedestrianGeometry: parseTmapPedestrianGeometry(response.data, requestedOrigin, requestedDestination) };
}

/** 공급자 원본 값을 `parseTransitOptionsFromTmap` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitOptionsFromTmap(data: any): TransitRouteOption[] {
    const itineraries = Array.isArray(data?.metaData?.plan?.itineraries) ? data.metaData.plan.itineraries : [];
    const parsed: TransitRouteOption[] = itineraries
        .map((itinerary: any, index: number) => {
            const minutes = normalizeTransitTimeToMinutes(itinerary?.totalTime);
            if (typeof minutes !== "number") return null;

            const distanceMeters = safeNumber(itinerary?.totalDistance);
            const transferCount = safeNumber(itinerary?.transferCount);
            const walkMeters = safeNumber(itinerary?.totalWalkDistance);
            const fareWon = safeNumber(
                itinerary?.fare?.regular?.totalFare ?? itinerary?.fare?.totalFare ?? itinerary?.totalFare
            );
            const itineraryPath = parseTransitItineraryPath(itinerary);
            const transitLegs = parseTransitLegDetails(itinerary?.legs ?? itinerary?.path, itineraryPath);
            // option path는 화면 맞춤과 응답 유효성 검사용이다. 각 leg의 geometry 출처는 그대로 유지한다.
            const pathCoords = itineraryPath ?? buildTransitOptionPath(transitLegs);
            const transitModeSummary = buildTransitModeSummary(transitLegs);
            const stepSummary = parseTransitStepSummary(transitLegs);

            return {
                id: `transit-${index}-${minutes}-${transferCount ?? 0}`,
                minutes,
                totalDurationSeconds: normalizeTransitTotalDurationSeconds(itinerary?.totalTime),
                distanceMeters,
                transferCount,
                walkMeters,
                fareWon,
                stepSummary,
                transitModeSummary,
                transitLegs,
                pathCoords,
                source: "api",
                provider: "tmap",
                providerTimeBasis: "route_estimate",
            } as TransitRouteOption;
        })
        .filter((value: TransitRouteOption | null): value is TransitRouteOption => value !== null);

    return parsed.sort((a: TransitRouteOption, b: TransitRouteOption) => a.minutes - b.minutes);
}

/**
 * 저장·ETA 재조회·길안내가 같은 ODsay 원본 경로를 사용한다.
 * 키 누락·외부 오류·빈 결과를 TMAP 경로로 대체하지 않는다.
 */
export async function getTransitRouteViaPreferredProvider(
    origin: Place,
    destination: Place,
    departureAt = new Date()
): Promise<TransitRouteOption[]> {
    infoMapDebug("[대중교통옵션] 선택한 공급자", "odsay");
    return getOdsayTransitRouteOptions(origin, destination, departureAt);
}

/** 지도 공급자 호출과 대체 경로를 조율해 `getDrivingAlternatives` 결과를 반환합니다. */
export async function getDrivingAlternatives(origin: Place, destination: Place, mode: "CAR" | "ETC"): Promise<RouteAlternativeOption[]> {
    const searchOptions = mode === "CAR" ? ["0", "1", "2"] : ["0", "1"];
    let failedRequestCount = 0;
    const results = await Promise.all(searchOptions.map(async (searchOption, index) => {
        try {
            const parsed = await getDrivingRouteViaTmap(origin, destination, searchOption);
            if (
                typeof parsed.minutes !== "number" &&
                typeof parsed.distanceMeters !== "number" &&
                (!Array.isArray(parsed.pathCoords) || parsed.pathCoords.length < 2)
            ) {
                return null;
            }

            return {
                id: buildAlternativeId(`${mode.toLowerCase()}-api`, index),
                mode,
                minutes: parsed.minutes,
                distanceMeters: parsed.distanceMeters,
                tollFareWon: parsed.tollFareWon,
                taxiFareWon: parsed.taxiFareWon,
                pathCoords: parsed.pathCoords,
                guideSteps: parsed.guideSteps,
                trafficSections: parsed.trafficSections,
                providerRouteOption: searchOption,
                source: "api",
                provider: "tmap",
            } as RouteAlternativeOption;
        } catch (error) {
            failedRequestCount += 1;
            infoMapDebug(`[대안경로] Tmap driving(${searchOption}) 실패 →`, tmapApiErrorMessage(error));
            return null;
        }
    }));
    const options = results.filter((item): item is RouteAlternativeOption => item !== null);
    if (options.length === 0 && failedRequestCount === searchOptions.length) {
        throw new Error("자동차 경로를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }

    return dedupeRouteAlternatives(options);
}

/** 지도 공급자 호출과 대체 경로를 조율해 `getWalkingAlternatives` 결과를 반환합니다. */
export async function getWalkingAlternatives(origin: Place, destination: Place): Promise<RouteAlternativeOption[]> {
    const searchOptions = ["0", "4"];
    let failedRequestCount = 0;
    const results = await Promise.all(searchOptions.map(async (searchOption, index) => {
        try {
            const parsed = await getWalkingRouteViaTmap(origin, destination, searchOption);
            if (
                typeof parsed.minutes !== "number" &&
                typeof parsed.distanceMeters !== "number" &&
                (!Array.isArray(parsed.pathCoords) || parsed.pathCoords.length < 2)
            ) {
                return null;
            }

            return {
                id: buildAlternativeId("walk-api", index),
                pedestrianGeometry: parsed.pedestrianGeometry,
                mode: "WALK",
                minutes: parsed.minutes,
                distanceMeters: parsed.distanceMeters,
                pathCoords: parsed.pathCoords,
                guideSteps: parsed.guideSteps,
                providerRouteOption: searchOption,
                source: "api",
                provider: "tmap",
            } as RouteAlternativeOption;
        } catch (error) {
            failedRequestCount += 1;
            infoMapDebug(`[대안경로] Tmap pedestrian(${searchOption}) 실패 →`, tmapApiErrorMessage(error));
            return null;
        }
    }));
    const options = results.filter((item): item is RouteAlternativeOption => item !== null);
    if (options.length === 0 && failedRequestCount === searchOptions.length) {
        throw new Error("도보 경로를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }

    return dedupeRouteAlternatives(options);
}

// 주소 검색은 Tmap POI + 주소 지오코딩을 우선 합치고,
// 키가 없거나 실패한 경우에만 Nominatim으로 fallback 한다.
