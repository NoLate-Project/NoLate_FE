import axios from "axios";

import { getEnv } from "../../api/env";
import type { TransitRouteProxyRequest } from "../../api/transitRouting";
import type { Place, TravelMode } from "../schedule/types";
import {
    buildRecoveredLoopTransitOption,
    createTransitLoopRecoveryPlan,
    selectTransitLoopSubroute,
} from "./transitLoopRecovery";
import {
    getOdsayTransitRouteOptions,
    hasOdsayApiKey,
    odsayApiErrorMessage,
} from "./odsayApi";

function warnMapDebug(...args: unknown[]) {
    if (typeof __DEV__ === "boolean" && __DEV__) console.warn(...args);
}

function infoMapDebug(...args: unknown[]) {
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

type RouteEtaResult = {
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

const TMAP_API_BASE_URL = "https://apis.openapi.sk.com";
const OPENSTREETMAP_BIKE_ROUTING_BASE_URL = "https://routing.openstreetmap.de/routed-bike";
const TMAP_REQUEST_TIMEOUT_MS = 12000;
const OPENSTREETMAP_REQUEST_TIMEOUT_MS = 15000;
const OPENSTREETMAP_MIN_REQUEST_INTERVAL_MS = 1000;
// TMAP 공식 스펙의 최대값은 10이다. 범위를 넘기면 공급자별로 요청이 거절되거나 잘릴 수 있다.
const TMAP_TRANSIT_REQUEST_COUNT = 10;
const SEARCH_RESULT_LIMIT = 12;
// 경로 렌더링 시 메모리/성능 보호를 위한 최대 path point 수.
const MAX_PATH_POINTS = 1200;
// 모드별로 UI에 노출할 경로 대안 최대 개수.
const ROUTE_ALTERNATIVE_LIMIT_BY_MODE: Record<TravelMode, number> = {
    CAR: 6,
    ETC: 5,
    TRANSIT: 10,
    WALK: 5,
    BIKE: 5,
};

const nominatimClient = axios.create({
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
function scheduleOpenStreetMapRequest<T>(request: () => Promise<T>): Promise<T> {
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
function safeNumber(value: unknown): number | undefined {
    const n = typeof value === "string" ? Number(value) : (value as number);
    return Number.isFinite(n) ? n : undefined;
}

// WGS84 범위 좌표인지 검증한다.
function isWgs84Coordinate(lat: number, lng: number): boolean {
    return Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180;
}

function distanceBetweenCoordsMeters(a: RoutePathCoord, b: RoutePathCoord): number {
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
function pickFirstValidCoordinatePair(pairs: Array<[unknown, unknown]>): RoutePathCoord | undefined {
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
function ensureArray<T>(value: T | T[] | null | undefined): T[] {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined) return [];
    return [value];
}

// 앱에서 사용하는 Tmap API 키를 환경변수에서 읽는다.
function resolveTmapAppKey(): string | undefined {
    return getEnv("EXPO_PUBLIC_TMAP_APP_KEY") ?? getEnv("EXPO_PUBLIC_TMAP_API_KEY");
}

function hasTmapAppKey(): boolean {
    return !!resolveTmapAppKey();
}

function hasTmapTransitRouteProvider(): boolean {
    return getEnv("EXPO_PUBLIC_ROUTE_API_PROXY_ENABLED") === "true" || hasTmapAppKey();
}

function hasTransitRouteProvider(): boolean {
    return hasOdsayApiKey() || hasTmapTransitRouteProvider();
}

async function requestTransitRouteProxy<T>(payload: TransitRouteProxyRequest): Promise<T> {
    // 인증 저장소를 사용하는 API 모듈은 실제 프록시 요청 시점에만 로드한다.
    const proxy = require("../../api/transitRouting") as typeof import("../../api/transitRouting");
    return proxy.getTransitRouteViaProxy<T>(payload);
}

// Tmap API 요청 공통 헤더를 구성한다.
function getTmapHeaders() {
    const appKey = resolveTmapAppKey();
    if (!appKey) {
        throw new Error("경로 찾기를 지금 사용할 수 없어요. 잠시 후 다시 시도해 주세요.");
    }

    return {
        appKey,
    };
}

// Tmap 호출 전용 axios 인스턴스.
function tmapClient() {
    return axios.create({
        baseURL: TMAP_API_BASE_URL,
        timeout: TMAP_REQUEST_TIMEOUT_MS,
        headers: getTmapHeaders(),
    });
}

// Axios 에러를 사용자 메시지로 정규화한다.
function tmapApiErrorMessage(error: unknown): string {
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
function clampPathCoords(coords: RoutePathCoord[], maxPoints = MAX_PATH_POINTS): RoutePathCoord[] {
    if (coords.length <= maxPoints) return coords;
    const step = Math.ceil(coords.length / maxPoints);
    const sampled = coords.filter((_, index) => index % step === 0);
    const last = coords[coords.length - 1];
    const tail = sampled[sampled.length - 1];
    if (!tail || tail.lat !== last.lat || tail.lng !== last.lng) sampled.push(last);
    return sampled;
}

// 인접한 중복 좌표를 제거한다.
function dedupePathCoords(coords: RoutePathCoord[]): RoutePathCoord[] {
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

function normalizeRoadTimeToMinutes(secondsRaw: unknown): number | undefined {
    const seconds = safeNumber(secondsRaw);
    if (typeof seconds !== "number") return undefined;
    return Math.max(1, Math.ceil(seconds / 60));
}

function normalizeTransitTimeToMinutes(rawValue: unknown): number | undefined {
    const seconds = safeNumber(rawValue);
    if (typeof seconds !== "number") return undefined;

    // TMAP 대중교통 totalTime은 짧은 경로도 예외 없이 초 단위다.
    return Math.max(1, Math.ceil(seconds / 60));
}

function normalizeTransitLegDurationToMinutes(rawValue: unknown): number | undefined {
    const seconds = safeNumber(rawValue);
    if (typeof seconds !== "number") return undefined;
    return Math.max(1, Math.ceil(seconds / 60));
}

// 대중교통 itinerary 파싱 블록.
// 공급자별 필드 차이를 흡수해 leg 종류/역 이름/정류장 좌표/path를 앱 기준으로 뽑아낸다.
function formatDistanceMetersCompact(distanceMeters?: number): string | undefined {
    if (typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters)) return undefined;
    if (distanceMeters >= 1000) return `${(distanceMeters / 1000).toFixed(1)}km`;
    return `${Math.round(distanceMeters)}m`;
}

function normalizeTransitLegKind(leg: any): TransitLegKind {
    const trafficType = safeNumber(leg?.trafficType);
    if (trafficType === 1) return "SUBWAY";
    if (trafficType === 2) return "BUS";
    if (trafficType === 3) return "WALK";

    const modeRaw = String(leg?.mode ?? leg?.type ?? leg?.travelType ?? "").toUpperCase();
    if (modeRaw.includes("SUBWAY") || modeRaw.includes("METRO") || modeRaw.includes("RAIL")) return "SUBWAY";
    if (modeRaw.includes("BUS")) return "BUS";
    if (modeRaw.includes("WALK") || modeRaw.includes("FOOT")) return "WALK";
    return "ETC";
}

function parseTransitLegLineName(leg: any): string | undefined {
    const firstLane = Array.isArray(leg?.lane)
        ? leg.lane[0]
        : Array.isArray(leg?.Lane)
            ? leg.Lane[0]
            : undefined;
    const raw = firstLane?.name ?? firstLane?.route ?? firstLane?.busNo ?? firstLane?.no ?? leg?.route ?? leg?.routeNm ?? leg?.lineName;
    if (typeof raw !== "string") return undefined;
    const normalized = raw.trim();
    return normalized.length > 0 ? normalized : undefined;
}

function normalizeTransitColorCandidate(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    if (!normalized) return undefined;

    // Tmap 원본 응답은 "53B332"처럼 # 없이 내려 주는 경우가 있어
    // 화면 레이어에서 바로 쓸 수 있는 CSS hex 형태로 맞춘다.
    if (/^[0-9A-Fa-f]{6}$/.test(normalized)) return `#${normalized.toUpperCase()}`;
    if (/^#[0-9A-Fa-f]{6}$/.test(normalized)) return normalized.toUpperCase();
    return undefined;
}

function parseTransitLegLineColor(leg: any): string | undefined {
    const firstLane = Array.isArray(leg?.lane)
        ? leg.lane[0]
        : Array.isArray(leg?.Lane)
            ? leg.Lane[0]
            : undefined;
    return normalizeTransitColorCandidate(
        leg?.routeColor ??
        leg?.lineColor ??
        firstLane?.routeColor ??
        firstLane?.color ??
        firstLane?.lineColor ??
        firstLane?.hexColor
    );
}

function parseTransitLegServiceAvailable(leg: any): boolean | undefined {
    const direct = safeNumber(leg?.service);
    if (direct === 0) return false;
    if (direct === 1) return true;

    const lanes = ensureArray(leg?.lane ?? leg?.Lane);
    const laneServices = lanes
        .map((lane) => safeNumber(lane?.service))
        .filter((value): value is number => typeof value === "number");
    if (!laneServices.length) return undefined;
    if (laneServices.some((value) => value === 1)) return true;
    if (laneServices.every((value) => value === 0)) return false;
    return undefined;
}

function parseTransitLegStationCount(leg: any): number | undefined {
    const byField = safeNumber(leg?.stationCount ?? leg?.passStopCount);
    if (typeof byField === "number") return Math.max(0, Math.round(byField));

    const stations = ensureArray(leg?.passStopList?.stationList ?? leg?.passStopList?.stations ?? leg?.stations);
    if (stations.length > 1) return Math.max(0, stations.length - 1);
    return undefined;
}

function parseTransitLegStartName(leg: any): string | undefined {
    const kind = normalizeTransitLegKind(leg);
    if (kind === "BUS" || kind === "SUBWAY") {
        const stationStart = parseTransitLegStationName(leg, "first");
        if (stationStart) return stationStart;
    }
    const raw = leg?.start?.name ?? leg?.startName ?? leg?.startStationName ?? leg?.departure ?? leg?.from;
    if (typeof raw !== "string") return undefined;
    const normalized = raw.trim();
    return normalized.length > 0 ? normalized : undefined;
}

function parseTransitLegEndName(leg: any): string | undefined {
    const kind = normalizeTransitLegKind(leg);
    if (kind === "BUS" || kind === "SUBWAY") {
        const stationEnd = parseTransitLegStationName(leg, "last");
        if (stationEnd) return stationEnd;
    }
    const raw = leg?.end?.name ?? leg?.endName ?? leg?.endStationName ?? leg?.arrival ?? leg?.to;
    if (typeof raw !== "string") return undefined;
    const normalized = raw.trim();
    return normalized.length > 0 ? normalized : undefined;
}

function parseTransitLegDirectionName(leg: any): string | undefined {
    const lane = ensureArray(leg?.Lane ?? leg?.lane)[0];
    const candidates = [
        leg?.directionName,
        leg?.direction,
        leg?.routeDirection,
        leg?.headsign,
        leg?.destinationName,
        lane?.directionName,
        lane?.direction,
        lane?.headsign,
    ];
    const raw = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
    return typeof raw === "string" ? raw.trim() : undefined;
}

function firstTransitGuideText(...candidates: unknown[]): string | undefined {
    const raw = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
    return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : undefined;
}

function parsePlatformFromStationName(name?: string): string | undefined {
    const rawPlatform = name?.match(/\(([^()]*(?:승강장|플랫폼|홈)[^()]*)\)/u)?.[1];
    return rawPlatform
        ?.replace(/(\d+)\s*번\s*(승강장|플랫폼|홈)/u, "$1번 $2")
        .replace(/\s+/g, " ")
        .trim() || undefined;
}

function parseTransitLegBoardingPlatform(leg: any, startName?: string): string | undefined {
    return firstTransitGuideText(
        leg?.boardingPlatform,
        leg?.platformName,
        leg?.platform,
        leg?.start?.boardingPlatform,
        leg?.start?.platformName,
        leg?.start?.platform
    ) ?? parsePlatformFromStationName(startName);
}

function normalizeTransitExitName(value: unknown): string | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return `${Math.round(value)}번 출구`;
    const raw = firstTransitGuideText(value);
    if (!raw) return undefined;
    return /^\d+$/u.test(raw) ? `${raw}번 출구` : raw;
}

function parseTransitLegBoardingExit(leg: any): string | undefined {
    return normalizeTransitExitName(
        leg?.boardingExit ??
        leg?.entranceName ??
        leg?.exitName ??
        leg?.start?.boardingExit ??
        leg?.start?.entranceName ??
        leg?.start?.exitName ??
        leg?.start?.exitNo
    );
}

function parseTransitLegRecommendedBoardingPosition(leg: any): string | undefined {
    return firstTransitGuideText(
        leg?.recommendedBoardingPosition,
        leg?.recommendedCar,
        leg?.fastTransferCar,
        leg?.boardingPosition,
        leg?.start?.recommendedBoardingPosition,
        leg?.start?.recommendedCar
    );
}

function parseTransitStationSequence(station: any): number | undefined {
    const sequence = safeNumber(
        station?.index ??
        station?.sequence ??
        station?.seq ??
        station?.stationSeq ??
        station?.stopSequence
    );
    return typeof sequence === "number" && Number.isFinite(sequence)
        ? sequence
        : undefined;
}

function parseTransitLegStations(leg: any): any[] {
    const stations = ensureArray(
        leg?.passStopList?.stationList ??
        leg?.passStopList?.stations ??
        leg?.stations ??
        leg?.stopList ??
        leg?.stopPoints
    );

    // TMAP의 index가 모두 제공되면 응답 배열 순서보다 공식 통과 순서를 우선한다.
    const indexed = stations.map((station, originalIndex) => ({
        station,
        originalIndex,
        sequence: parseTransitStationSequence(station),
    }));
    if (indexed.length < 2 || indexed.some(({ sequence }) => sequence === undefined)) {
        return stations;
    }

    return indexed
        .sort((a, b) => (a.sequence! - b.sequence!) || (a.originalIndex - b.originalIndex))
        .map(({ station }) => station);
}

function parseStationName(station: any): string | undefined {
    if (!station || typeof station !== "object") return undefined;
    const raw = station?.name ?? station?.stationName ?? station?.poiName ?? station?.arsId;
    if (typeof raw !== "string") return undefined;
    const normalized = raw.trim();
    return normalized.length > 0 ? normalized : undefined;
}

function parseStationCode(station: any): string | undefined {
    if (!station || typeof station !== "object") return undefined;
    const arsIdRaw = station?.arsId ?? station?.arsID;
    const arsId = typeof arsIdRaw === "number" && Number.isFinite(arsIdRaw)
        ? String(arsIdRaw).padStart(5, "0")
        : typeof arsIdRaw === "string"
            ? arsIdRaw.replace(/\D/g, "")
            : undefined;
    if (arsId && /^\d{5}$/.test(arsId)) return `ARS:${arsId}`;

    const raw = station?.stationID ?? station?.stationId ?? station?.stationCode ?? station?.id;
    const cityCodeRaw = station?.cityCode ?? station?.citycode;
    const cityCode = typeof cityCodeRaw === "number" && Number.isFinite(cityCodeRaw)
        ? String(cityCodeRaw)
        : typeof cityCodeRaw === "string"
            ? cityCodeRaw.trim()
            : undefined;
    const normalized = typeof raw === "number" && Number.isFinite(raw)
        ? String(raw)
        : typeof raw === "string"
            ? raw.trim()
            : undefined;
    if (!normalized) return undefined;
    return cityCode ? `${cityCode}:${normalized}` : normalized;
}

function parseTransitLegPassStops(leg: any): TransitPassStop[] {
    const seen = new Set<string>();

    return parseTransitLegStations(leg)
        .map((station, index) => {
            const name = parseStationName(station);
            if (!name) return undefined;

            const coord = parseStationCoord(station);
            const code = parseStationCode(station);
            const key = [
                name,
                code ?? "",
                coord ? coord.lat.toFixed(6) : "",
                coord ? coord.lng.toFixed(6) : "",
            ].join("|");
            if (seen.has(key)) return undefined;
            seen.add(key);

            const stop: TransitPassStop = {
                name,
                sequence: index + 1,
            };
            if (coord) stop.coord = coord;
            if (code) stop.code = code;
            return stop;
        })
        .filter((stop): stop is TransitPassStop => !!stop);
}

function parseTransitLegStationName(leg: any, position: "first" | "last"): string | undefined {
    const stations = parseTransitLegStations(leg);
    if (!stations.length) return undefined;
    const station = position === "first" ? stations[0] : stations[stations.length - 1];
    return parseStationName(station);
}

function parseStationCoord(station: any): RoutePathCoord | undefined {
    if (!station || typeof station !== "object") return undefined;
    return pickFirstValidCoordinatePair([
        [station?.lat, station?.lng],
        [station?.lat, station?.lon],
        [station?.latitude, station?.longitude],
        [station?.y, station?.x],
        [station?.newLat, station?.newLon],
        [station?.gpsY, station?.gpsX],
        [station?.stationY, station?.stationX],
        [station?.noorLat, station?.noorLon],
        [station?.noorY, station?.noorX],
    ]);
}

function parseTransitLegStationCoord(leg: any, position: "first" | "last"): RoutePathCoord | undefined {
    const stations = parseTransitLegStations(leg);
    if (!stations.length) return undefined;
    const station = position === "first" ? stations[0] : stations[stations.length - 1];
    return parseStationCoord(station);
}

function parseTransitLegStationPath(leg: any): RoutePathCoord[] | undefined {
    const stations = parseTransitLegStations(leg);
    if (stations.length < 2) return undefined;
    const coords = stations
        .map((station) => parseStationCoord(station))
        .filter((coord): coord is RoutePathCoord => !!coord);
    if (coords.length < 2) return undefined;
    return clampPathCoords(dedupePathCoords(coords));
}

function parseTransitLegStartCoord(leg: any): RoutePathCoord | undefined {
    const kind = normalizeTransitLegKind(leg);
    if (kind === "BUS" || kind === "SUBWAY") {
        const stationStart = parseTransitLegStationCoord(leg, "first");
        if (stationStart) return stationStart;
    }
    const coord = pickFirstValidCoordinatePair([
        [leg?.start?.lat, leg?.start?.lng ?? leg?.start?.lon ?? leg?.start?.longitude ?? leg?.start?.x],
        [leg?.startLat, leg?.startLng ?? leg?.startLon ?? leg?.startX],
        [leg?.startY, leg?.startX],
        [leg?.from?.lat, leg?.from?.lng ?? leg?.from?.lon ?? leg?.from?.longitude ?? leg?.from?.x],
        [leg?.fromLat, leg?.fromLng ?? leg?.fromLon ?? leg?.fromX],
        [leg?.fromY, leg?.fromX],
    ]);
    if (coord) return coord;
    const stationStart = parseTransitLegStationCoord(leg, "first");
    if (stationStart) return stationStart;
    return undefined;
}

function parseTransitLegEndCoord(leg: any): RoutePathCoord | undefined {
    const kind = normalizeTransitLegKind(leg);
    if (kind === "BUS" || kind === "SUBWAY") {
        const stationEnd = parseTransitLegStationCoord(leg, "last");
        if (stationEnd) return stationEnd;
    }
    const coord = pickFirstValidCoordinatePair([
        [leg?.end?.lat, leg?.end?.lng ?? leg?.end?.lon ?? leg?.end?.longitude ?? leg?.end?.x],
        [leg?.endLat, leg?.endLng ?? leg?.endLon ?? leg?.endX],
        [leg?.endY, leg?.endX],
        [leg?.to?.lat, leg?.to?.lng ?? leg?.to?.lon ?? leg?.to?.longitude ?? leg?.to?.x],
        [leg?.toLat, leg?.toLng ?? leg?.toLon ?? leg?.toX],
        [leg?.toY, leg?.toX],
    ]);
    if (coord) return coord;
    const stationEnd = parseTransitLegStationCoord(leg, "last");
    if (stationEnd) return stationEnd;
    return undefined;
}

function squaredDistance(a: RoutePathCoord, b: RoutePathCoord): number {
    const dLat = a.lat - b.lat;
    const dLng = a.lng - b.lng;
    return (dLat * dLat) + (dLng * dLng);
}

function findNearestPathIndex(
    path: RoutePathCoord[],
    target: RoutePathCoord,
    startIndex = 0,
    endIndex = path.length - 1
): number {
    if (!Array.isArray(path) || path.length === 0) return 0;
    const from = Math.max(0, Math.min(path.length - 1, startIndex));
    const to = Math.max(from, Math.min(path.length - 1, endIndex));

    let nearestIndex = from;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let index = from; index <= to; index += 1) {
        const distance = squaredDistance(path[index], target);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = index;
        }
    }

    return nearestIndex;
}

function snapTransitLegPathFromItinerary(
    itineraryPath: RoutePathCoord[],
    startCoord: RoutePathCoord | undefined,
    endCoord: RoutePathCoord | undefined,
    startHintIndex = 0,
    nextStartCoordHint?: RoutePathCoord,
    forceEndToTail = false
): { pathCoords?: RoutePathCoord[]; nextStartIndex: number } {
    if (!Array.isArray(itineraryPath) || itineraryPath.length < 2) {
        return { nextStartIndex: 0 };
    }

    const maxIndex = itineraryPath.length - 1;
    const safeStartHint = Math.max(0, Math.min(maxIndex - 1, startHintIndex));

    const startIndex = startCoord
        ? findNearestPathIndex(itineraryPath, startCoord, safeStartHint, maxIndex)
        : safeStartHint;
    let endIndex = endCoord
        ? findNearestPathIndex(itineraryPath, endCoord, startIndex, maxIndex)
        : -1;
    if (endIndex < 0 && nextStartCoordHint) {
        endIndex = findNearestPathIndex(itineraryPath, nextStartCoordHint, startIndex, maxIndex);
    }
    if (endIndex < 0 && forceEndToTail) {
        endIndex = maxIndex;
    }
    if (endIndex < 0) {
        endIndex = Math.min(maxIndex, startIndex + 6);
    }

    const from = Math.max(0, Math.min(startIndex, endIndex));
    const to = Math.max(startIndex, endIndex);
    const segment = clampPathCoords(dedupePathCoords(itineraryPath.slice(from, to + 1)));

    if (segment.length < 2) {
        return { nextStartIndex: Math.max(0, Math.min(maxIndex - 1, to)) };
    }

    return {
        pathCoords: segment,
        nextStartIndex: Math.max(0, Math.min(maxIndex - 1, to)),
    };
}

function parseTransitStepsLinestring(leg: any): RoutePathCoord[] | undefined {
    const steps = Array.isArray(leg?.steps) ? leg.steps as any[] : [];
    if (steps.length === 0) return undefined;
    const coords: RoutePathCoord[] = [];
    for (const step of steps) {
        const stepPath = parseTransitPathCoords(step?.linestring ?? step?.path);
        if (Array.isArray(stepPath) && stepPath.length > 0) {
            coords.push(...stepPath);
        }
    }
    if (coords.length < 2) return undefined;
    return clampPathCoords(dedupePathCoords(coords));
}

function parseTransitDirectPathCoords(leg: any): RoutePathCoord[] | undefined {
    return parseTransitPathCoords(
        leg?.passShape?.linestring ??
        leg?.passShape?.coordinates ??
        leg?.shape ??
        leg?.path ??
        leg?.geometry
    );
}

function parseTransitLegPathGeometry(
    leg: any,
    kind = normalizeTransitLegKind(leg)
): { pathCoords?: RoutePathCoord[]; source: TransitGeometrySource; rawPointCount?: number } {
    if (kind === "WALK") {
        const stepsPath = parseTransitStepsLinestring(leg);
        if (stepsPath) {
            return {
                pathCoords: stepsPath,
                source: "WALK_STEPS_LINESTRING",
                rawPointCount: stepsPath.length,
            };
        }

        // TMAP은 역사 내부 환승처럼 steps가 없는 WALK 레그를 passShape로 내려준다.
        // 이 형상을 버리면 실제 환승 동선 대신 정류장 두 점을 잇는 임의 경로가 표시된다.
        const passShapePath = parseTransitDirectPathCoords(leg);
        if (passShapePath) {
            return {
                pathCoords: passShapePath,
                source: "WALK_PASS_SHAPE_LINESTRING",
                rawPointCount: passShapePath.length,
            };
        }
    }

    if (kind === "BUS" || kind === "SUBWAY") {
        const direct = parseTransitDirectPathCoords(leg);
        if (direct) {
            return {
                pathCoords: direct,
                source: "TRANSIT_PASS_SHAPE_LINESTRING",
                rawPointCount: direct.length,
            };
        }
    }

    if (kind !== "WALK") {
        const stepsPath = parseTransitStepsLinestring(leg);
        if (stepsPath) {
            return {
                pathCoords: stepsPath,
                source: "WALK_STEPS_LINESTRING",
                rawPointCount: stepsPath.length,
            };
        }
    }

    const stationPath = parseTransitLegStationPath(leg);
    if (stationPath) {
        return {
            pathCoords: stationPath,
            source: "PASS_STOP_LIST",
            rawPointCount: stationPath.length,
        };
    }

    return { source: "UNKNOWN" };
}

function buildTransitLegLabel(detail: Omit<TransitLegDetail, "label">): string {
    if (detail.kind === "WALK") {
        const chunks: string[] = [];
        const distance = formatDistanceMetersCompact(detail.distanceMeters);
        if (distance) chunks.push(distance);
        if (typeof detail.durationMinutes === "number") chunks.push(`${detail.durationMinutes}분`);
        if (!chunks.length) return "도보";
        return `도보 ${chunks.join(" · ")}`;
    }

    if (detail.kind === "SUBWAY") {
        const chunks: string[] = [];
        if (detail.lineName) chunks.push(detail.lineName);
        if (typeof detail.stationCount === "number") chunks.push(`${detail.stationCount}정거장`);
        if (typeof detail.durationMinutes === "number") chunks.push(`${detail.durationMinutes}분`);
        return `지하철 ${chunks.join(" · ")}`.trim();
    }

    if (detail.kind === "BUS") {
        const chunks: string[] = [];
        if (detail.lineName) chunks.push(detail.lineName);
        if (typeof detail.stationCount === "number") chunks.push(`${detail.stationCount}정거장`);
        if (typeof detail.durationMinutes === "number") chunks.push(`${detail.durationMinutes}분`);
        return `버스 ${chunks.join(" · ")}`.trim();
    }

    const etcChunks: string[] = [];
    if (detail.lineName) etcChunks.push(detail.lineName);
    if (typeof detail.durationMinutes === "number") etcChunks.push(`${detail.durationMinutes}분`);
    return etcChunks.length ? etcChunks.join(" · ") : "이동";
}

function parseTransitLegDetails(legs: unknown, itineraryPath?: RoutePathCoord[]): TransitLegDetail[] {
    if (!Array.isArray(legs)) return [];
    const legArray = legs as any[];
    let itineraryPathCursor = 0;

    return legArray
        .map((leg: any, legIndex: number) => {
            const kind = normalizeTransitLegKind(leg);
            const distanceMeters = safeNumber(leg?.distance ?? leg?.walkDistance ?? leg?.length);
            const durationMinutes = normalizeTransitLegDurationToMinutes(
                leg?.sectionTime ?? leg?.time ?? leg?.duration ?? leg?.moveTime
            );
            const stationCount = parseTransitLegStationCount(leg);
            const lineName = parseTransitLegLineName(leg);
            const lineColor = parseTransitLegLineColor(leg);
            const serviceAvailable = parseTransitLegServiceAvailable(leg);
            const directionName = parseTransitLegDirectionName(leg);
            const startName = parseTransitLegStartName(leg);
            const endName = parseTransitLegEndName(leg);
            const boardingPlatform = parseTransitLegBoardingPlatform(leg, startName);
            const boardingExit = parseTransitLegBoardingExit(leg);
            const recommendedBoardingPosition = parseTransitLegRecommendedBoardingPosition(leg);
            const passStops = parseTransitLegPassStops(leg);
            const startCoord = parseTransitLegStartCoord(leg);
            const endCoord = parseTransitLegEndCoord(leg);
            const nextStartCoordHint = legIndex < legArray.length - 1
                ? parseTransitLegStartCoord(legArray[legIndex + 1])
                : undefined;
            const forceEndToTail = kind === "WALK" && legIndex === legArray.length - 1;
            const pathGeometry = parseTransitLegPathGeometry(leg, kind);
            let pathCoords = pathGeometry.pathCoords;
            // steps[].linestring 또는 passShape.linestring에서 직접 파싱된 경우만 exact로 표시
            let pathCoordsIsExact = (
                pathGeometry.source === "WALK_STEPS_LINESTRING" ||
                pathGeometry.source === "WALK_PASS_SHAPE_LINESTRING" ||
                pathGeometry.source === "TRANSIT_PASS_SHAPE_LINESTRING"
            ) && Array.isArray(pathCoords) && pathCoords.length >= 2;
            let pathGeometrySource: TransitGeometrySource | undefined = Array.isArray(pathCoords) && pathCoords.length >= 2
                ? pathGeometry.source
                : undefined;
            let rawPathPointCount = pathGeometry.rawPointCount;

            if (!pathCoordsIsExact && Array.isArray(itineraryPath) && itineraryPath.length >= 2) {
                const snapped = snapTransitLegPathFromItinerary(
                    itineraryPath,
                    startCoord,
                    endCoord,
                    itineraryPathCursor,
                    nextStartCoordHint,
                    forceEndToTail
                );
                if (Array.isArray(snapped.pathCoords) && snapped.pathCoords.length >= 2) {
                    pathCoords = snapped.pathCoords;
                    pathGeometrySource = "ITINERARY_PATH_SNAP";
                    rawPathPointCount = snapped.pathCoords.length;
                    // itinerary snap은 도로 중앙 경로 — exact 아님
                }
                itineraryPathCursor = snapped.nextStartIndex;
            } else if (Array.isArray(pathCoords) && pathCoords.length >= 2 && Array.isArray(itineraryPath) && itineraryPath.length >= 2) {
                const pathEnd = endCoord ?? pathCoords[pathCoords.length - 1];
                itineraryPathCursor = findNearestPathIndex(
                    itineraryPath,
                    pathEnd,
                    itineraryPathCursor,
                    itineraryPath.length - 1
                );
            }
            let normalizedStartCoord = startCoord ?? (Array.isArray(pathCoords) && pathCoords.length > 0 ? pathCoords[0] : undefined);
            let normalizedEndCoord = endCoord ?? (Array.isArray(pathCoords) && pathCoords.length > 0 ? pathCoords[pathCoords.length - 1] : undefined);

            if (!normalizedStartCoord && kind === "WALK" && legIndex === 0 && Array.isArray(itineraryPath) && itineraryPath.length > 0) {
                normalizedStartCoord = itineraryPath[0];
            }
            if (!normalizedEndCoord && kind === "WALK" && legIndex === legArray.length - 1 && Array.isArray(itineraryPath) && itineraryPath.length > 0) {
                normalizedEndCoord = itineraryPath[itineraryPath.length - 1];
            }

            const base: Omit<TransitLegDetail, "label"> = {
                kind,
                durationMinutes,
                distanceMeters,
                stationCount,
                lineName,
                lineColor,
                directionName,
                boardingPlatform,
                boardingExit,
                recommendedBoardingPosition,
                startName,
                endName,
                passStops,
                startCoord: normalizedStartCoord,
                endCoord: normalizedEndCoord,
                pathCoords,
                pathCoordsIsExact,
                pathGeometrySource,
                rawPathPointCount,
                serviceAvailable,
            };

            const label = buildTransitLegLabel(base);
            if (!label.trim()) return null;

            return {
                ...base,
                label,
            } as TransitLegDetail;
        })
        .filter((value: TransitLegDetail | null): value is TransitLegDetail => value !== null);
}

function buildTransitModeSummary(transitLegs: TransitLegDetail[]): string | undefined {
    if (!transitLegs.length) return undefined;

    const labelsByKind: Record<TransitLegKind, string> = {
        SUBWAY: "지하철",
        BUS: "버스",
        WALK: "도보",
        ETC: "기타",
    };

    const orderedKinds: TransitLegKind[] = ["SUBWAY", "BUS", "WALK", "ETC"];
    const used = new Set<TransitLegKind>(transitLegs.map((leg) => leg.kind));
    const summaryLabels = orderedKinds
        .filter((kind) => used.has(kind))
        .map((kind) => labelsByKind[kind]);

    if (!summaryLabels.length) return undefined;
    return summaryLabels.join(" · ");
}

function buildAlternativeId(prefix: string, index: number): string {
    return `${prefix}-${index}`;
}

function buildRoutePathSignature(pathCoords?: RoutePathCoord[]): string | undefined {
    if (!Array.isArray(pathCoords) || pathCoords.length < 2) return undefined;
    const sampleCount = Math.min(12, pathCoords.length);
    const samples: string[] = [];
    for (let index = 0; index < sampleCount; index += 1) {
        const pathIndex = Math.round((index * (pathCoords.length - 1)) / Math.max(1, sampleCount - 1));
        const point = pathCoords[pathIndex];
        samples.push(`${point.lat.toFixed(5)},${point.lng.toFixed(5)}`);
    }
    return samples.join(";");
}

function dedupeRouteAlternatives(items: RouteAlternativeOption[]): RouteAlternativeOption[] {
    const used = new Set<string>();
    const result: RouteAlternativeOption[] = [];

    for (const item of items) {
        const pathSignature = buildRoutePathSignature(item.pathCoords);
        const minuteBucket = typeof item.minutes === "number" ? Math.round(item.minutes) : -1;
        const distanceBucket = typeof item.distanceMeters === "number" ? Math.round(item.distanceMeters / 50) : -1;
        const key = pathSignature
            ? `${item.mode}|path:${pathSignature}`
            : `${item.mode}|summary:${minuteBucket}|${distanceBucket}`;
        if (used.has(key)) continue;
        used.add(key);
        result.push(item);
    }

    return result;
}

function limitAlternativesByMode(mode: TravelMode, items: RouteAlternativeOption[]): RouteAlternativeOption[] {
    const limit = ROUTE_ALTERNATIVE_LIMIT_BY_MODE[mode] ?? 5;
    return items.slice(0, limit);
}

function parseLatLngPair(value: unknown): RoutePathCoord | null {
    if (!Array.isArray(value) || value.length < 2) return null;
    const lng = safeNumber(value[0]);
    const lat = safeNumber(value[1]);
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    return { lat, lng };
}

function collectPathCoords(raw: unknown, bucket: RoutePathCoord[]) {
    const pair = parseLatLngPair(raw);
    if (pair) {
        bucket.push(pair);
        return;
    }
    if (!Array.isArray(raw)) return;
    raw.forEach((item) => collectPathCoords(item, bucket));
}

function parsePathFromTmapFeatureCollection(data: any): RoutePathCoord[] | undefined {
    const features = Array.isArray(data?.features) ? data.features : [];
    const coords: RoutePathCoord[] = [];

    features.forEach((feature: any) => {
        const geometry = feature?.geometry;
        const type = geometry?.type;
        if (type !== "LineString" && type !== "MultiLineString") return;
        collectPathCoords(geometry?.coordinates, coords);
    });

    if (coords.length < 2) return undefined;
    return clampPathCoords(dedupePathCoords(coords));
}

function normalizeRoadSegmentTimeToMinutes(secondsRaw: unknown): number | undefined {
    const seconds = safeNumber(secondsRaw);
    if (typeof seconds !== "number" || seconds < 0) return undefined;
    return seconds / 60;
}

function normalizeTrafficLevel(rawStatus: unknown): RouteTrafficLevel {
    const status = safeNumber(rawStatus);
    if (status === 1) return "smooth";
    if (status === 2) return "slow";
    if (status === 3) return "congested";
    return "unknown";
}

function parseFeaturePathCoords(feature: any): RoutePathCoord[] | undefined {
    const coords: RoutePathCoord[] = [];
    collectPathCoords(feature?.geometry?.coordinates, coords);
    if (coords.length < 2) return undefined;
    return clampPathCoords(dedupePathCoords(coords));
}

function parseTrafficSectionsFromFeature(feature: any, pathCoords?: RoutePathCoord[]): RouteTrafficSection[] {
    if (!Array.isArray(pathCoords) || pathCoords.length < 2) return [];
    const rawTraffic = feature?.geometry?.traffic ?? feature?.properties?.traffic;
    if (!Array.isArray(rawTraffic)) return [];

    return rawTraffic.flatMap((rawSection: unknown) => {
        if (!Array.isArray(rawSection) || rawSection.length < 3) return [];
        const rawStart = safeNumber(rawSection[0]);
        const rawEnd = safeNumber(rawSection[1]);
        if (typeof rawStart !== "number" || typeof rawEnd !== "number") return [];
        const start = Math.max(0, Math.min(pathCoords.length - 1, Math.round(rawStart)));
        const end = Math.max(start + 1, Math.min(pathCoords.length - 1, Math.round(rawEnd)));
        const sectionPath = pathCoords.slice(start, end + 1);
        if (sectionPath.length < 2) return [];
        const speedKph = safeNumber(rawSection[3]);
        return [{
            pathCoords: sectionPath,
            level: normalizeTrafficLevel(rawSection[2]),
            speedKph,
        } as RouteTrafficSection];
    });
}

function normalizeInstruction(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized || undefined;
}

function parseRoadRouteDetails(data: any): Pick<ParsedRoadRoute, "guideSteps" | "trafficSections"> {
    const features = Array.isArray(data?.features) ? data.features : [];
    const guideSteps: RouteGuideStep[] = [];
    const trafficSections: RouteTrafficSection[] = [];

    features.forEach((feature: any) => {
        const geometryType = feature?.geometry?.type;
        const properties = feature?.properties ?? {};

        if (geometryType === "Point") {
            const coordinate = parseLatLngPair(feature?.geometry?.coordinates) ?? undefined;
            const instruction = normalizeInstruction(properties?.description);
            if (!instruction || /^(출발지|도착지)$/u.test(instruction)) return;
            guideSteps.push({
                instruction,
                roadName: normalizeInstruction(properties?.nextRoadName ?? properties?.name),
                turnType: properties?.turnType === undefined ? undefined : String(properties.turnType),
                coordinate,
            });
            return;
        }

        if (geometryType !== "LineString" && geometryType !== "MultiLineString") return;
        const pathCoords = parseFeaturePathCoords(feature);
        if (!pathCoords) return;
        trafficSections.push(...parseTrafficSectionsFromFeature(feature, pathCoords));

        const roadName = normalizeInstruction(properties?.name ?? properties?.roadName);
        const instruction = normalizeInstruction(properties?.description) ?? roadName;
        const segmentData = {
            roadName,
            durationMinutes: normalizeRoadSegmentTimeToMinutes(properties?.time),
            distanceMeters: safeNumber(properties?.distance),
            pathCoords,
            coordinate: pathCoords[0],
        };
        const previousGuide = guideSteps[guideSteps.length - 1];
        if (previousGuide && !previousGuide.pathCoords) {
            Object.assign(previousGuide, {
                roadName: previousGuide.roadName ?? segmentData.roadName,
                durationMinutes: segmentData.durationMinutes,
                distanceMeters: segmentData.distanceMeters,
                pathCoords: segmentData.pathCoords,
                coordinate: previousGuide.coordinate ?? segmentData.coordinate,
            });
        } else if (instruction) {
            guideSteps.push({ instruction, ...segmentData });
        }
    });

    return {
        guideSteps: guideSteps.length > 0 ? guideSteps : undefined,
        trafficSections: trafficSections.length > 0 ? trafficSections : undefined,
    };
}

export function parseTmapRoadRouteResponse(data: any): ParsedRoadRoute {
    const features = Array.isArray(data?.features) ? data.features : [];
    let distanceMeters: number | undefined;
    let minutes: number | undefined;
    let tollFareWon: number | undefined;
    let taxiFareWon: number | undefined;

    for (const feature of features) {
        const properties = feature?.properties;
        const totalDistance = safeNumber(properties?.totalDistance ?? properties?.distance);
        const totalTimeSeconds = safeNumber(properties?.totalTime ?? properties?.time);
        if (typeof totalDistance === "number" || typeof totalTimeSeconds === "number") {
            distanceMeters = totalDistance;
            minutes = normalizeRoadTimeToMinutes(totalTimeSeconds);
            tollFareWon = safeNumber(properties?.totalFare ?? properties?.tollFare);
            taxiFareWon = safeNumber(properties?.taxiFare);
            break;
        }
    }

    if (typeof distanceMeters !== "number") {
        distanceMeters = safeNumber(data?.distance ?? data?.totalDistance);
    }
    if (typeof minutes !== "number") {
        minutes = normalizeRoadTimeToMinutes(data?.time ?? data?.totalTime);
    }

    const pathCoords = parsePathFromTmapFeatureCollection(data);
    const details = parseRoadRouteDetails(data);
    return { minutes, distanceMeters, tollFareWon, taxiFareWon, pathCoords, ...details };
}

export function parseLineString(lineString?: string): RoutePathCoord[] {
    if (typeof lineString !== "string") return [];

    const tokens = lineString
        .replace(/^\s*LINESTRING\s*\(/i, "")
        .replace(/\)\s*$/i, "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    const coords: RoutePathCoord[] = [];
    tokens.forEach((token) => {
        const [lonRaw, latRaw] = token.split(",");
        const longitude = safeNumber(lonRaw);
        const latitude = safeNumber(latRaw);

        if (
            typeof latitude !== "number" ||
            typeof longitude !== "number" ||
            !isWgs84Coordinate(latitude, longitude)
        ) {
            warnMapDebug("[geometry] invalid linestring token", token);
            return;
        }

        coords.push({ lat: latitude, lng: longitude });
    });

    return coords;
}

function parseTransitPathCoords(raw: unknown): RoutePathCoord[] | undefined {
    if (!raw) return undefined;

    if (Array.isArray(raw)) {
        const parsed = raw
            .map((point: unknown) => {
                if (Array.isArray(point) && point.length >= 2) {
                    const lng = safeNumber(point[0]);
                    const lat = safeNumber(point[1]);
                    if (
                        typeof lat === "number" &&
                        typeof lng === "number" &&
                        isWgs84Coordinate(lat, lng)
                    ) {
                        return { lat, lng } as RoutePathCoord;
                    }
                }
                if (typeof point === "object" && point !== null) {
                    const lat = safeNumber((point as any).lat ?? (point as any).latitude ?? (point as any).y);
                    const lng = safeNumber((point as any).lng ?? (point as any).longitude ?? (point as any).x);
                    if (
                        typeof lat === "number" &&
                        typeof lng === "number" &&
                        isWgs84Coordinate(lat, lng)
                    ) {
                        return { lat, lng } as RoutePathCoord;
                    }
                }
                return null;
            })
            .filter((value: RoutePathCoord | null): value is RoutePathCoord => value !== null);
        if (parsed.length >= 2) return clampPathCoords(dedupePathCoords(parsed));
    }

    if (typeof raw === "string") {
        const lineStringPairs = parseLineString(raw);
        if (lineStringPairs.length >= 2) return clampPathCoords(dedupePathCoords(lineStringPairs));

        const matchPairs: RoutePathCoord[] = [];
        const pairRegex = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g;
        let match = pairRegex.exec(raw);
        while (match) {
            const lng = safeNumber(match[1]);
            const lat = safeNumber(match[2]);
            if (
                typeof lat === "number" &&
                typeof lng === "number" &&
                isWgs84Coordinate(lat, lng)
            ) {
                matchPairs.push({ lat, lng });
            }
            match = pairRegex.exec(raw);
        }
        if (matchPairs.length >= 2) return clampPathCoords(dedupePathCoords(matchPairs));
    }

    return undefined;
}

function parseTransitStepSummary(transitLegs: TransitLegDetail[]): string | undefined {
    if (!transitLegs.length) return undefined;
    const stepLabels = transitLegs
        .map((leg) => leg.label)
        .filter((value) => typeof value === "string" && value.trim().length > 0);
    if (!stepLabels.length) return undefined;
    return stepLabels.slice(0, 4).join(" → ");
}

function parseTransitItineraryPath(itinerary: any): RoutePathCoord[] | undefined {
    // 구간별 정류장 목록을 전체 상세 path로 승격하면 직선 정류장 선형이 도로 형상으로 오인된다.
    // itinerary.path가 공급자에게서 직접 내려온 경우에만 구간 스냅 복구에 사용한다.
    return parseTransitPathCoords(itinerary?.path);
}

function buildTransitOptionPath(transitLegs: TransitLegDetail[]): RoutePathCoord[] | undefined {
    const coords = transitLegs
        .flatMap((leg) => Array.isArray(leg.pathCoords) ? leg.pathCoords : [])
        .filter((coord) => (
            typeof coord?.lat === "number" &&
            Number.isFinite(coord.lat) &&
            typeof coord?.lng === "number" &&
            Number.isFinite(coord.lng)
        ));
    if (coords.length < 2) return undefined;
    return clampPathCoords(dedupePathCoords(coords));
}

function composeTmapAddress(poi: any): string {
    const newAddress = ensureArray(poi?.newAddressList?.newAddress)[0];
    const roadAddress = typeof newAddress?.fullAddressRoad === "string" ? newAddress.fullAddressRoad.trim() : "";
    if (roadAddress) return roadAddress;

    const jibunAddress = [
        poi?.upperAddrName,
        poi?.middleAddrName,
        poi?.lowerAddrName,
        poi?.detailAddrName,
        [poi?.firstNo, poi?.secondNo].filter(Boolean).join("-"),
    ]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .map((value) => (value as string).trim())
        .join(" ");

    return jibunAddress;
}

function pickPoiSearchCoord(poi: any): RoutePathCoord | undefined {
    // 길찾기 입력에는 건물 중심점보다 실제로 접근 가능한 보행자/정문 좌표를 우선한다.
    return pickFirstValidCoordinatePair([
        [poi?.pnsLat, poi?.pnsLon],
        [poi?.frontLat, poi?.frontLon],
        [poi?.noorLat, poi?.noorLon],
        [poi?.newLat, poi?.newLon],
        [poi?.lat, poi?.lon],
    ]);
}

function applySearchDistance(
    item: PlaceSearchItem,
    context?: PlaceSearchContext
): PlaceSearchItem {
    if (!context?.center) return item;
    return {
        ...item,
        distanceMeters: Math.round(distanceBetweenCoordsMeters(context.center, { lat: item.lat, lng: item.lng })),
    };
}

function parsePoiResults(data: any, context?: PlaceSearchContext): PlaceSearchItem[] {
    const rawPoi = data?.searchPoiInfo?.pois?.poi;
    const poiList = ensureArray(rawPoi);

    return poiList
        .map((poi: any) => {
            const coord = pickPoiSearchCoord(poi);
            if (!coord) return null;

            const name = typeof poi?.name === "string" && poi.name.trim()
                ? poi.name.trim()
                : composeTmapAddress(poi);
            if (!name) return null;

            const address = composeTmapAddress(poi);
            const category = [
                poi?.upperBizName,
                poi?.middleBizName,
                poi?.lowerBizName,
                poi?.detailBizName,
            ]
                .filter((value) => typeof value === "string" && value.trim().length > 0)
                .map((value) => (value as string).trim())
                .join(" > ")
                || undefined;

            return applySearchDistance({
                name,
                address: address || name,
                lat: coord.lat,
                lng: coord.lng,
                category,
                provider: "tmap",
                providerPlaceId: poi?.id === undefined || poi?.id === null ? undefined : String(poi.id),
            } as PlaceSearchItem, context);
        })
        .filter((value: PlaceSearchItem | null): value is PlaceSearchItem => value !== null);
}

function parseFullAddressGeoResults(data: any, query: string, context?: PlaceSearchContext): PlaceSearchItem[] {
    const coordinates = ensureArray(data?.coordinateInfo?.coordinate);

    return coordinates
        .map((item: any, index: number) => {
            const lat = safeNumber(item?.newLat ?? item?.lat);
            const lng = safeNumber(item?.newLon ?? item?.lon);
            if (typeof lat !== "number" || typeof lng !== "number") return null;

            const address = (
                item?.newAddressList?.newAddress?.fullAddressRoad ??
                item?.fullAddress ??
                item?.newAddress ??
                item?.oldAddress
            ) as string | undefined;

            const name = (address && address.trim())
                ? address.trim().split(" ").slice(0, 3).join(" ")
                : `${query} ${index + 1}`;

            return applySearchDistance({
                name,
                address: address?.trim() || query,
                lat,
                lng,
                category: "주소",
                provider: "tmap",
            } as PlaceSearchItem, context);
        })
        .filter((value: PlaceSearchItem | null): value is PlaceSearchItem => value !== null);
}

function dedupeSearchResults(items: PlaceSearchItem[]): PlaceSearchItem[] {
    const seen = new Set<string>();
    const result: PlaceSearchItem[] = [];

    items.forEach((item) => {
        const key = `${item.name}|${item.lat.toFixed(6)}|${item.lng.toFixed(6)}`;
        if (seen.has(key)) return;
        seen.add(key);
        result.push(item);
    });
    return result;
}

async function searchViaTmapPoi(query: string, context?: PlaceSearchContext): Promise<PlaceSearchItem[]> {
    const client = tmapClient();
    const centerParams = context?.center
        ? {
            centerLat: String(context.center.lat),
            centerLon: String(context.center.lng),
            radius: String(Math.max(1, Math.min(33, context.radiusKm ?? 20))),
        }
        : {};
    const response = await client.get("/tmap/pois", {
        params: {
            version: 1,
            format: "json",
            count: 10,
            searchKeyword: query,
            reqCoordType: "WGS84GEO",
            resCoordType: "WGS84GEO",
            ...centerParams,
        },
    });
    return parsePoiResults(response.data, context);
}

async function geocodeViaTmap(query: string, context?: PlaceSearchContext): Promise<PlaceSearchItem[]> {
    const client = tmapClient();
    const response = await client.get("/tmap/geo/fullAddrGeo", {
        params: {
            version: 1,
            format: "json",
            coordType: "WGS84GEO",
            fullAddr: query,
        },
    });
    return parseFullAddressGeoResults(response.data, query, context);
}

async function reverseViaTmap(lat: number, lng: number): Promise<string | undefined> {
    const client = tmapClient();
    const response = await client.get("/tmap/geo/reversegeocoding", {
        params: {
            version: 1,
            format: "json",
            coordType: "WGS84GEO",
            addressType: "A10",
            lat: String(lat),
            lon: String(lng),
        },
    });

    const addressInfo = response.data?.addressInfo;
    if (!addressInfo) return undefined;

    const fullAddress = [
        addressInfo.fullAddressRoad,
        addressInfo.fullAddress,
    ]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .map((value) => (value as string).trim())[0];
    if (fullAddress) return fullAddress;

    const road = [
        addressInfo.city_do,
        addressInfo.gu_gun,
        addressInfo.eup_myun,
        addressInfo.legalDong,
        addressInfo.roadName,
        addressInfo.buildingIndex,
    ]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .join(" ");
    if (road) return road;

    const jibun = [
        addressInfo.city_do,
        addressInfo.gu_gun,
        addressInfo.eup_myun,
        addressInfo.legalDong,
        addressInfo.ri,
        addressInfo.bunji,
    ]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .join(" ");
    if (jibun) return jibun;

    return undefined;
}

async function searchViaNominatim(query: string, context?: PlaceSearchContext): Promise<PlaceSearchItem[]> {
    const center = context?.center;
    const latitudeSpan = center ? Math.max(0.05, Math.min(0.4, (context?.radiusKm ?? 20) / 111)) : undefined;
    const longitudeSpan = center
        ? latitudeSpan! / Math.max(0.2, Math.cos((center.lat * Math.PI) / 180))
        : undefined;
    const response = await nominatimClient.get("/search", {
        params: {
            q: query,
            format: "json",
            countrycodes: "kr",
            limit: 10,
            addressdetails: 1,
            ...(center && latitudeSpan && longitudeSpan
                ? {
                    viewbox: `${center.lng - longitudeSpan},${center.lat + latitudeSpan},${center.lng + longitudeSpan},${center.lat - latitudeSpan}`,
                    bounded: 0,
                }
                : {}),
        },
    });

    const items = Array.isArray(response.data) ? response.data : [];
    return items
        .map((item: any) => {
            const lat = safeNumber(item.lat);
            const lng = safeNumber(item.lon);
            if (typeof lat !== "number" || typeof lng !== "number") return null;

            const addr = item.address ?? {};
            const name: string =
                addr.railway ?? addr.subway ?? addr.station ??
                addr.amenity ?? addr.building ?? addr.tourism ??
                addr.shop ?? addr.office ?? addr.leisure ??
                ((item.display_name as string)?.split(",")[0]?.trim() ?? query);

            const road = addr.road ?? "";
            const houseNum = addr.house_number ?? "";
            const suburb = addr.suburb ?? addr.neighbourhood ?? addr.quarter ?? "";
            const district = addr.city_district ?? addr.county ?? "";
            const city = addr.city ?? addr.town ?? addr.village ?? "";

            const roadPart = [road, houseNum].filter(Boolean).join(" ");
            const address = [roadPart, suburb, district, city].filter(Boolean).join(", ")
                || ((item.display_name as string) ?? "");

            return applySearchDistance({
                name,
                address,
                lat,
                lng,
                provider: "nominatim",
                providerPlaceId: item?.place_id === undefined || item?.place_id === null
                    ? undefined
                    : String(item.place_id),
            } as PlaceSearchItem, context);
        })
        .filter((value: PlaceSearchItem | null): value is PlaceSearchItem => value !== null);
}

async function reverseViaNominatim(lat: number, lng: number): Promise<string | undefined> {
    const response = await nominatimClient.get("/reverse", {
        params: { lat, lon: lng, format: "json", addressdetails: 1 },
    });
    const addr = response.data?.address;
    if (!addr) return response.data?.display_name as string | undefined;

    const road = addr.road ?? "";
    const houseNum = addr.house_number ?? "";
    const suburb = addr.suburb ?? addr.neighbourhood ?? "";
    const district = addr.city_district ?? addr.county ?? "";
    const city = addr.city ?? addr.town ?? addr.village ?? "";

    const roadPart = [road, houseNum].filter(Boolean).join(" ");
    return [roadPart, suburb, district, city].filter(Boolean).join(", ")
        || (response.data?.display_name as string);
}

function buildOsrmGuideInstruction(step: any): string | undefined {
    const type = String(step?.maneuver?.type ?? "").toLowerCase();
    const modifier = String(step?.maneuver?.modifier ?? "").toLowerCase();
    const roadName = normalizeInstruction(step?.name);
    const direction = modifier.includes("left")
        ? "좌회전"
        : modifier.includes("right")
            ? "우회전"
            : modifier === "uturn"
                ? "유턴"
                : "직진";

    if (type === "depart" || type === "arrive") return undefined;
    if (type === "roundabout" || type === "rotary") {
        return roadName ? `회전교차로에서 ${roadName} 방면` : "회전교차로 진입";
    }
    if (type === "merge") return roadName ? `${roadName} 방면으로 합류` : "도로에 합류";
    if (type === "fork") return roadName ? `${roadName} 방면으로 ${direction}` : `갈림길에서 ${direction}`;
    if (type === "new name" || type === "continue") return roadName ? `${roadName} 따라 계속 이동` : "계속 이동";
    return roadName ? `${roadName} 방면으로 ${direction}` : direction;
}

function parseOsrmBikeGuideSteps(route: any): RouteGuideStep[] | undefined {
    const legs = Array.isArray(route?.legs) ? route.legs : [];
    const steps = legs.flatMap((leg: any) => Array.isArray(leg?.steps) ? leg.steps : []);
    const guides = steps.flatMap((step: any) => {
        const instruction = buildOsrmGuideInstruction(step);
        if (!instruction) return [];
        const pathCoords = Array.isArray(step?.geometry?.coordinates)
            ? dedupePathCoords(
                step.geometry.coordinates
                    .map((point: unknown) => parseLatLngPair(point))
                    .filter((coord: RoutePathCoord | null): coord is RoutePathCoord => coord !== null)
            )
            : undefined;
        const coordinate = pickFirstValidCoordinatePair([
            [step?.maneuver?.location?.[1], step?.maneuver?.location?.[0]],
            [pathCoords?.[0]?.lat, pathCoords?.[0]?.lng],
        ]);
        return [{
            instruction,
            roadName: normalizeInstruction(step?.name),
            durationMinutes: normalizeRoadSegmentTimeToMinutes(step?.duration),
            distanceMeters: safeNumber(step?.distance),
            turnType: normalizeInstruction(step?.maneuver?.type),
            coordinate,
            pathCoords: pathCoords && pathCoords.length >= 2 ? pathCoords : undefined,
        } as RouteGuideStep];
    });
    return guides.length > 0 ? guides : undefined;
}

async function getBicycleAlternativesViaOpenStreetMap(
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

async function getDrivingRouteViaTmap(
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

async function getWalkingRouteViaTmap(
    origin: Place,
    destination: Place,
    searchOption = "0"
): Promise<ParsedRoadRoute> {
    const client = tmapClient();
    const payload = new URLSearchParams({
        startX: String(origin.lng),
        startY: String(origin.lat),
        endX: String(destination.lng),
        endY: String(destination.lat),
        startName: origin.name ?? "출발",
        endName: destination.name ?? "도착",
        reqCoordType: "WGS84GEO",
        resCoordType: "WGS84GEO",
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

    return parseTmapRoadRouteResponse(response.data);
}

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
            } as TransitRouteOption;
        })
        .filter((value: TransitRouteOption | null): value is TransitRouteOption => value !== null);

    return parsed.sort((a: TransitRouteOption, b: TransitRouteOption) => a.minutes - b.minutes);
}

function formatTransitSearchDateTime(date = new Date()): string {
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${year}${month}${day}${hour}${minute}`;
}

// Tmap 원본 API 호출 블록.
// 실제 네트워크 요청은 여기서만 하고, 화면 쪽은 아래 exported helper만 사용한다.
async function requestTransitRouteViaTmap(
    origin: Place,
    destination: Place,
    departureAt = new Date()
): Promise<TransitRouteOption[]> {
    const payload: TransitRouteProxyRequest = {
        startX: String(origin.lng),
        startY: String(origin.lat),
        endX: String(destination.lng),
        endY: String(destination.lat),
        count: TMAP_TRANSIT_REQUEST_COUNT,
        lang: 0,
        format: "json",
        searchDttm: formatTransitSearchDateTime(departureAt),
    };

    if (getEnv("EXPO_PUBLIC_ROUTE_API_PROXY_ENABLED") === "true") {
        try {
            const data = await requestTransitRouteProxy<any>(payload);
            return parseTransitOptionsFromTmap(data);
        } catch (error) {
            if (!hasTmapAppKey()) throw error;
            infoMapDebug("[대중교통옵션] 서버 프록시 실패, direct fallback →", tmapApiErrorMessage(error));
        }
    }

    const client = tmapClient();
    const response = await client.post("/transit/routes", payload, {
        headers: { "Content-Type": "application/json" },
    });
    return parseTransitOptionsFromTmap(response.data);
}

async function getTransitRouteViaTmap(
    origin: Place,
    destination: Place,
    departureAt = new Date()
): Promise<TransitRouteOption[]> {
    const directOptions = await requestTransitRouteViaTmap(origin, destination, departureAt);
    if (
        typeof origin.lat !== "number" ||
        typeof origin.lng !== "number" ||
        typeof destination.lat !== "number" ||
        typeof destination.lng !== "number"
    ) {
        return directOptions;
    }
    const recoveryPlan = createTransitLoopRecoveryPlan(
        directOptions,
        { name: origin.name, lat: origin.lat, lng: origin.lng },
        { name: destination.name, lat: destination.lat, lng: destination.lng }
    );
    if (!recoveryPlan) return directOptions;

    try {
        const anchorPlace: Place = {
            name: recoveryPlan.anchor.name ?? "순환선 중간역",
            address: recoveryPlan.anchor.name ?? "순환선 중간역",
            lat: recoveryPlan.anchor.lat,
            lng: recoveryPlan.anchor.lng,
        };
        const leftOptions = await requestTransitRouteViaTmap(origin, anchorPlace, departureAt);
        const leftOption = selectTransitLoopSubroute(
            leftOptions,
            recoveryPlan.lineToken,
            recoveryPlan.anchor,
            "TO_ANCHOR"
        );
        if (!leftOption) return directOptions;

        const rightDepartureAt = new Date(departureAt.getTime() + leftOption.minutes * 60_000);
        const rightOptions = await requestTransitRouteViaTmap(anchorPlace, destination, rightDepartureAt);
        const rightOption = selectTransitLoopSubroute(
            rightOptions,
            recoveryPlan.lineToken,
            recoveryPlan.anchor,
            "FROM_ANCHOR"
        );
        if (!rightOption) return directOptions;

        const recovered = buildRecoveredLoopTransitOption(recoveryPlan, leftOption, rightOption);
        if (!recovered) return directOptions;

        infoMapDebug("[대중교통옵션] 순환선 반대 방향 후보 복구", {
            line: recoveryPlan.lineToken,
            anchor: recoveryPlan.anchor.name,
            directMinutes: recoveryPlan.directOption.minutes,
            recoveredMinutes: recovered.minutes,
        });
        return [recovered, ...directOptions];
    } catch (error) {
        infoMapDebug("[대중교통옵션] 순환선 후보 복구 실패, 원본 유지 →", tmapApiErrorMessage(error));
        return directOptions;
    }
}

/**
 * 대중교통은 정밀 보행 링크와 빠른 환승 위치를 함께 주는 ODsay를 우선한다.
 * 모바일 키가 없거나 ODsay가 일시 실패하면 기존 TMAP 경로를 그대로 예비 공급자로 사용한다.
 */
async function getTransitRouteViaPreferredProvider(
    origin: Place,
    destination: Place,
    departureAt = new Date()
): Promise<TransitRouteOption[]> {
    let odsayFailure: unknown;
    if (hasOdsayApiKey()) {
        try {
            const odsayOptions = await getOdsayTransitRouteOptions(origin, destination, departureAt);
            if (odsayOptions.length > 0) return odsayOptions;
        } catch (error) {
            odsayFailure = error;
            infoMapDebug("[대중교통옵션] ODsay 실패, TMAP 예비 경로 확인 →", odsayApiErrorMessage(error));
        }
    }

    if (hasTmapTransitRouteProvider()) {
        return getTransitRouteViaTmap(origin, destination, departureAt);
    }
    if (odsayFailure) throw odsayFailure;
    return [];
}

async function getDrivingAlternatives(origin: Place, destination: Place, mode: "CAR" | "ETC"): Promise<RouteAlternativeOption[]> {
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

async function getWalkingAlternatives(origin: Place, destination: Place): Promise<RouteAlternativeOption[]> {
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
