import axios from "axios";

import {
    getEnv,
} from "../../api/env";
import type {
    TransitRouteProxyRequest,
} from "../../api/transitRouting";
import type {
    TravelMode,
} from "../schedule/types";

import {
    hasOdsayApiKey,
} from "./odsayApi";

/** TMAP 경로 처리의 `warnMapDebug` 계산 단계를 독립적으로 수행합니다. */
export function warnMapDebug(...args: unknown[]) {
    if (typeof __DEV__ === "boolean" && __DEV__) console.warn(...args);
}

/** TMAP 경로 처리의 `infoMapDebug` 계산 단계를 독립적으로 수행합니다. */
export function infoMapDebug(...args: unknown[]) {
    if (typeof __DEV__ === "boolean" && __DEV__) console.info(...args);
}

// 지도 검색/역지오코딩/대중교통/길찾기 결과를 앱 공용 형태로 맞추는 핵심 API 래퍼.
export type PlaceSearchItem = {
    name: string;
    address: string;
    lat: number;
    lng: number;
    category?: string;
    provider?: "tmap" | "kakao" | "naver" | "nominatim";
    providerPlaceId?: string;
    /** 검색 기준점에서의 직선거리. 화면의 동명 장소 판별에만 사용한다. */
    distanceMeters?: number;
};

export type RoutePathCoord = {
    lat: number;
    lng: number;
};

export type PlaceSearchContext = {
    center?: RoutePathCoord;
    radiusKm?: number;
};

export type RouteGuideStep = {
    instruction: string;
    roadName?: string;
    durationMinutes?: number;
    distanceMeters?: number;
    turnType?: string;
    coordinate?: RoutePathCoord;
    pathCoords?: RoutePathCoord[];
};

export type RouteTrafficLevel = "smooth" | "slow" | "congested" | "unknown";

export type RouteTrafficSection = {
    pathCoords: RoutePathCoord[];
    level: RouteTrafficLevel;
    speedKph?: number;
};

export type RouteApiProvider = "tmap" | "odsay" | "kakao" | "naver" | "openstreetmap";
export type RouteReliability = "live_provider" | "provider_estimate" | "fallback_estimate";
export type TransitServiceState = "operating" | "not_operating";
export type TransitDepartureTimeSource = "requested" | "next_service_search";

export type RouteProviderSearchOptions = {
    departureAt?: Date;
};

export type TransitLegKind = "SUBWAY" | "BUS" | "WALK" | "ETC";
export type TransitServiceClass = "LOCAL" | "EXPRESS" | "UNKNOWN";

export type TransitPassStop = {
    name: string;
    coord?: RoutePathCoord;
    sequence?: number;
    code?: string;
};

export type TransitGeometrySource =
    | "WALK_STEPS_LINESTRING"
    | "WALK_PASS_SHAPE_LINESTRING"
    | "TRANSIT_PASS_SHAPE_LINESTRING"
    | "PASS_STOP_LIST"
    | "ITINERARY_PATH_SNAP"
    | "UNKNOWN";

export type TransitLegDetail = {
    kind: TransitLegKind;
    label: string;
    durationMinutes?: number;
    /** 공급자 경로의 구간 소요시간에 이미 포함된 승차 대기시간. 실시간 ETA 보정 시 교체한다. */
    waitingMinutes?: number;
    /** 공급자가 식별하는 노선 ID. ODsay 버스는 busID, 지하철은 도시-노선 코드다. */
    providerRouteId?: string;
    /** 지역 BIS가 식별하는 버스 노선 ID. */
    localRouteId?: string;
    /** 노선이 속한 도시 코드와 BIS 공급자 코드. */
    routeCityCode?: string;
    routeProviderCode?: string;
    /** 공급자 시간표가 명시한 이 구간의 출발·도착 시각(ISO-8601). */
    startDateTime?: string;
    endDateTime?: string;
    /** ODsay가 구간에 직접 제공한 승차 정류장/역 식별자. */
    startID?: string;
    startLocalStationID?: string;
    startStationCityCode?: string;
    startStationProviderCode?: string;
    startArsID?: string;
    /** ODsay가 구간에 직접 제공한 하차 정류장/역 식별자. */
    endID?: string;
    endLocalStationID?: string;
    endStationCityCode?: string;
    endStationProviderCode?: string;
    endArsID?: string;
    distanceMeters?: number;
    stationCount?: number;
    lineName?: string;
    /** 공급자 계약과 노선 표기가 증명한 일반/급행 종별. 증거가 부족하면 UNKNOWN이다. */
    serviceClass?: TransitServiceClass;
    /**
     * Tmap 원본이 직접 내려 준 노선 색상.
     * 버스 routeColor / lane.color 같은 "실제 운영 노선색"을 우선 보존해서
     * 화면 쪽에서 추정 규칙보다 정확한 색을 쓸 수 있게 한다.
     */
    lineColor?: string;
    /** 공급자가 직접 제공한 행선지/상하행/내외선 정보. 없으면 정류장 순서로 화면 방면을 계산한다. */
    directionName?: string;
    /** 공급자의 상·하행 코드. 실시간 도착정보에서 반대 방향 열차를 제외할 때 사용한다. */
    directionCode?: "UP" | "DOWN";
    /** 정류장명 또는 공급자 확장 필드에서 확인된 실제 승강장 정보. */
    boardingPlatform?: string;
    /** 공급자가 명시한 승차 접근 출구. 값이 없으면 추정하지 않는다. */
    boardingExit?: string;
    /** 빠른 환승 등을 위한 공급자 추천 탑승 위치. */
    recommendedBoardingPosition?: string;
    /** 현재 열차에서 다음 교통수단으로 빠르게 환승하기 위한 객차-문 위치. */
    recommendedTransferPosition?: string;
    startName?: string;
    endName?: string;
    startCoord?: RoutePathCoord;
    endCoord?: RoutePathCoord;
    passStops?: TransitPassStop[];
    pathCoords?: RoutePathCoord[];
    /** steps[].linestring 또는 passShape.linestring에서 직접 파싱된 경우 true. itinerary snap fallback이면 false. */
    pathCoordsIsExact?: boolean;
    pathGeometrySource?: TransitGeometrySource;
    rawPathPointCount?: number;
    /** TMAP service=0인 레그는 현재 검색 시각에 운행하지 않는 구간이다. */
    serviceAvailable?: boolean;
};

export type TransitRouteOption = {
    id: string;
    minutes: number;
    distanceMeters?: number;
    transferCount?: number;
    walkMeters?: number;
    fareWon?: number;
    stepSummary?: string;
    transitModeSummary?: string;
    transitLegs?: TransitLegDetail[];
    pathCoords?: RoutePathCoord[];
    source: "api" | "fallback";
    provider?: RouteApiProvider;
    fallbackKind?: "road" | "straight";
    providerDepartureAt?: string;
    providerArrivalAt?: string;
    attributionText?: string;
    attributionUrl?: string;
};

export type RouteAlternativeOption = {
    id: string;
    mode: TravelMode;
    minutes?: number;
    distanceMeters?: number;
    source: "api" | "fallback";
    fallbackKind?: "road" | "straight";
    pathCoords?: RoutePathCoord[];
    transferCount?: number;
    walkMeters?: number;
    fareWon?: number;
    tollFareWon?: number;
    taxiFareWon?: number;
    stepSummary?: string;
    guideSteps?: RouteGuideStep[];
    trafficSections?: RouteTrafficSection[];
    providerRouteOption?: string;
    transitModeSummary?: string;
    transitLegs?: TransitLegDetail[];
    provider?: RouteApiProvider;
    /**
     * routingService에서 붙이는 품질 메타데이터.
     * provider가 실제 경로를 줬는지, 도로 보정/직선 추정 fallback인지 화면과 저장 계층이
     * 같은 기준으로 판단하게 해 준다.
     */
    routeReliability?: RouteReliability;
    routeQualityLabel?: string;
    routeQualityNotice?: string;
    routePlausibility?: "normal" | "geometry_suspected";
    routeDetourRatio?: number;
    /** 공급자 조회 시각 기준의 실제 운행 여부와 출발 기준 시각. */
    transitServiceState?: TransitServiceState;
    transitDepartureAt?: string;
    transitDepartureTimeSource?: TransitDepartureTimeSource;
    /** 공급자 시간표가 명시한 실제 후보 출발·도착 시각. */
    providerDepartureAt?: string;
    providerArrivalAt?: string;
    attributionText?: string;
    attributionUrl?: string;
};

export type RouteEtaResult = {
    minutes?: number;
    distanceMeters?: number;
    source: "api" | "fallback";
    fallbackKind?: "road" | "straight";
    pathCoords?: RoutePathCoord[];
};

export type ParsedRoadRoute = {
    minutes?: number;
    distanceMeters?: number;
    tollFareWon?: number;
    taxiFareWon?: number;
    pathCoords?: RoutePathCoord[];
    guideSteps?: RouteGuideStep[];
    trafficSections?: RouteTrafficSection[];
};

export const TMAP_API_BASE_URL = "https://apis.openapi.sk.com";
export const OPENSTREETMAP_BIKE_ROUTING_BASE_URL = "https://routing.openstreetmap.de/routed-bike";
export const TMAP_REQUEST_TIMEOUT_MS = 12000;
export const OPENSTREETMAP_REQUEST_TIMEOUT_MS = 15000;
export const OPENSTREETMAP_MIN_REQUEST_INTERVAL_MS = 1000;
// TMAP 공식 스펙의 최대값은 10이다. 범위를 넘기면 공급자별로 요청이 거절되거나 잘릴 수 있다.
export const TMAP_TRANSIT_REQUEST_COUNT = 10;
export const SEARCH_RESULT_LIMIT = 12;
// 경로 렌더링 시 메모리/성능 보호를 위한 최대 path point 수.
export const MAX_PATH_POINTS = 1200;
// 모드별로 UI에 노출할 경로 대안 최대 개수.
export const ROUTE_ALTERNATIVE_LIMIT_BY_MODE: Record<TravelMode, number> = {
    CAR: 6,
    ETC: 5,
    TRANSIT: 10,
    WALK: 5,
    BIKE: 5,
};

/** 공개 Nominatim 검색과 역지오코딩이 공유하는 제한 시간·헤더가 설정된 HTTP 클라이언트입니다. */
export const nominatimClient = axios.create({
    baseURL: "https://nominatim.openstreetmap.org",
    timeout: 10000,
    headers: {
        "User-Agent": "NoLateFE/1.0",
        "Accept-Language": "ko,en",
    },
});

let openStreetMapRequestQueue: Promise<void> = Promise.resolve();
let lastOpenStreetMapRequestAt = 0;

// FOSSGIS 공개 라우팅 서버의 초당 1회 제한을 앱 안에서도 직렬화해 지킨다.
/** 지도 공급자 호출과 대체 경로를 조율해 `scheduleOpenStreetMapRequest` 결과를 반환합니다. */
export function scheduleOpenStreetMapRequest<T>(request: () => Promise<T>): Promise<T> {
    const scheduled = openStreetMapRequestQueue.then(async () => {
        const waitMs = Math.max(
            0,
            OPENSTREETMAP_MIN_REQUEST_INTERVAL_MS - (Date.now() - lastOpenStreetMapRequestAt)
        );
        if (waitMs > 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
        }
        lastOpenStreetMapRequestAt = Date.now();
        return request();
    });
    openStreetMapRequestQueue = scheduled.then(() => undefined, () => undefined);
    return scheduled;
}

// 아래 유틸리티 블록은 외부 응답값을 숫자/좌표/path로 안전하게 정규화하는 역할을 한다.
/** 공급자 원본 값을 `safeNumber` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function safeNumber(value: unknown): number | undefined {
    const n = typeof value === "string" ? Number(value) : (value as number);
    return Number.isFinite(n) ? n : undefined;
}

// WGS84 범위 좌표인지 검증한다.
/** 현재 설정이나 좌표가 `isWgs84Coordinate` 조건을 만족하는지 확인합니다. */
export function isWgs84Coordinate(lat: number, lng: number): boolean {
    return Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180;
}

/** TMAP 경로 처리의 `distanceBetweenCoordsMeters` 계산 단계를 독립적으로 수행합니다. */
export function distanceBetweenCoordsMeters(a: RoutePathCoord, b: RoutePathCoord): number {
    const earthRadiusMeters = 6_371_000;
    const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
    const latDelta = toRadians(b.lat - a.lat);
    const lngDelta = toRadians(b.lng - a.lng);
    const aLat = toRadians(a.lat);
    const bLat = toRadians(b.lat);
    const haversine = (
        Math.sin(latDelta / 2) ** 2 +
        Math.cos(aLat) * Math.cos(bLat) * Math.sin(lngDelta / 2) ** 2
    );
    return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

// 여러 후보 좌표쌍 중 첫 번째 유효 좌표를 선택한다.
/** 공급자 원본 값을 `pickFirstValidCoordinatePair` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function pickFirstValidCoordinatePair(pairs: Array<[unknown, unknown]>): RoutePathCoord | undefined {
    for (let index = 0; index < pairs.length; index += 1) {
        const [rawLat, rawLng] = pairs[index];
        const lat = safeNumber(rawLat);
        const lng = safeNumber(rawLng);
        if (typeof lat === "number" && typeof lng === "number" && isWgs84Coordinate(lat, lng)) {
            return { lat, lng };
        }
    }
    return undefined;
}

// null/단일값/배열 입력을 배열로 통일한다.
/** 공급자 원본 값을 `ensureArray` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function ensureArray<T>(value: T | T[] | null | undefined): T[] {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined) return [];
    return [value];
}

// 앱에서 사용하는 Tmap API 키를 환경변수에서 읽는다.
/** TMAP 경로 처리의 `resolveTmapAppKey` 계산 단계를 독립적으로 수행합니다. */
export function resolveTmapAppKey(): string | undefined {
    return getEnv("EXPO_PUBLIC_TMAP_APP_KEY") ?? getEnv("EXPO_PUBLIC_TMAP_API_KEY");
}

/** 현재 설정이나 좌표가 `hasTmapAppKey` 조건을 만족하는지 확인합니다. */
export function hasTmapAppKey(): boolean {
    return !!resolveTmapAppKey();
}

/** 현재 설정이나 좌표가 `hasTmapTransitRouteProvider` 조건을 만족하는지 확인합니다. */
export function hasTmapTransitRouteProvider(): boolean {
    return getEnv("EXPO_PUBLIC_ROUTE_API_PROXY_ENABLED") === "true" || hasTmapAppKey();
}

/** 현재 설정이나 좌표가 `hasTransitRouteProvider` 조건을 만족하는지 확인합니다. */
export function hasTransitRouteProvider(): boolean {
    return hasOdsayApiKey() || hasTmapTransitRouteProvider();
}

/** 지도 공급자 호출과 대체 경로를 조율해 `requestTransitRouteProxy` 결과를 반환합니다. */
export async function requestTransitRouteProxy<T>(payload: TransitRouteProxyRequest): Promise<T> {
    // 인증 저장소를 사용하는 API 모듈은 실제 프록시 요청 시점에만 로드한다.
    const proxy = require("../../api/transitRouting") as typeof import("../../api/transitRouting");
    return proxy.getTransitRouteViaProxy<T>(payload);
}

// Tmap API 요청 공통 헤더를 구성한다.
/** 지도 공급자 호출과 대체 경로를 조율해 `getTmapHeaders` 결과를 반환합니다. */
export function getTmapHeaders() {
    const appKey = resolveTmapAppKey();
    if (!appKey) {
        throw new Error("경로 찾기를 지금 사용할 수 없어요. 잠시 후 다시 시도해 주세요.");
    }

    return {
        appKey,
    };
}

// Tmap 호출 전용 axios 인스턴스.
/** TMAP 경로 처리의 `tmapClient` 계산 단계를 독립적으로 수행합니다. */
export function tmapClient() {
    return axios.create({
        baseURL: TMAP_API_BASE_URL,
        timeout: TMAP_REQUEST_TIMEOUT_MS,
        headers: getTmapHeaders(),
    });
}

// Axios 에러를 사용자 메시지로 정규화한다.
/** TMAP 경로 처리의 `tmapApiErrorMessage` 계산 단계를 독립적으로 수행합니다. */
export function tmapApiErrorMessage(error: unknown): string {
    if (!axios.isAxiosError(error)) {
        return error instanceof Error ? error.message : "알 수 없는 오류";
    }

    const status = error.response?.status;
    const data = error.response?.data;
    const raw = data?.errorMessage ?? data?.message ?? data?.error?.message ?? data?.error;
    const message = raw === undefined
        ? JSON.stringify(data)
        : typeof raw === "string"
            ? raw
            : JSON.stringify(raw);
    return `HTTP ${status ?? "??"} → ${message ?? error.message}`;
}

// 과도하게 긴 path는 샘플링해 점 개수를 제한한다.
/** 공급자 원본 값을 `clampPathCoords` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function clampPathCoords(coords: RoutePathCoord[], maxPoints = MAX_PATH_POINTS): RoutePathCoord[] {
    if (coords.length <= maxPoints) return coords;
    const step = Math.ceil(coords.length / maxPoints);
    const sampled = coords.filter((_, index) => index % step === 0);
    const last = coords[coords.length - 1];
    const tail = sampled[sampled.length - 1];
    if (!tail || tail.lat !== last.lat || tail.lng !== last.lng) sampled.push(last);
    return sampled;
}

// 인접한 중복 좌표를 제거한다.
/** 공급자 원본 값을 `dedupePathCoords` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function dedupePathCoords(coords: RoutePathCoord[]): RoutePathCoord[] {
    if (coords.length < 2) return coords;
    const result: RoutePathCoord[] = [];
    coords.forEach((coord) => {
        const prev = result[result.length - 1];
        if (!prev || prev.lat !== coord.lat || prev.lng !== coord.lng) {
            result.push(coord);
        }
    });
    return result;
}

/** 공급자 원본 값을 `normalizeRoadTimeToMinutes` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function normalizeRoadTimeToMinutes(secondsRaw: unknown): number | undefined {
    const seconds = safeNumber(secondsRaw);
    if (typeof seconds !== "number") return undefined;
    return Math.max(1, Math.ceil(seconds / 60));
}

/** 공급자 원본 값을 `normalizeTransitTimeToMinutes` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function normalizeTransitTimeToMinutes(rawValue: unknown): number | undefined {
    const seconds = safeNumber(rawValue);
    if (typeof seconds !== "number") return undefined;

    // TMAP 대중교통 totalTime은 짧은 경로도 예외 없이 초 단위다.
    return Math.max(1, Math.ceil(seconds / 60));
}

/** 공급자 원본 값을 `normalizeTransitLegDurationToMinutes` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function normalizeTransitLegDurationToMinutes(rawValue: unknown): number | undefined {
    const seconds = safeNumber(rawValue);
    if (typeof seconds !== "number") return undefined;
    return Math.max(1, Math.ceil(seconds / 60));
}

// 대중교통 itinerary 파싱 블록.
// 공급자별 필드 차이를 흡수해 leg 종류/역 이름/정류장 좌표/path를 앱 기준으로 뽑아낸다.
/** 정규화된 경로 데이터를 조합해 `formatDistanceMetersCompact` 결과를 생성합니다. */
export function formatDistanceMetersCompact(distanceMeters?: number): string | undefined {
    if (typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters)) return undefined;
    if (distanceMeters >= 1000) return `${(distanceMeters / 1000).toFixed(1)}km`;
    return `${Math.round(distanceMeters)}m`;
}
