import axios from "axios";

import { getEnv } from "../../api/env";
import { estimateTravelMinutesByStraightDistance, TRAVEL_MODE_META } from "../schedule/travelMode";
import type { Place, TravelMode } from "../schedule/types";

export type PlaceSearchItem = {
    name: string;
    address: string;
    lat: number;
    lng: number;
    category?: string;
};

export type RoutePathCoord = {
    lat: number;
    lng: number;
};

export type TransitLegKind = "SUBWAY" | "BUS" | "WALK" | "ETC";

export type TransitLegDetail = {
    kind: TransitLegKind;
    label: string;
    durationMinutes?: number;
    distanceMeters?: number;
    stationCount?: number;
    lineName?: string;
    startName?: string;
    endName?: string;
    startCoord?: RoutePathCoord;
    endCoord?: RoutePathCoord;
    pathCoords?: RoutePathCoord[];
    /** steps[].linestring 또는 passShape.linestring에서 직접 파싱된 경우 true. itinerary snap fallback이면 false. */
    pathCoordsIsExact?: boolean;
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
    fallbackKind?: "road" | "straight";
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
    stepSummary?: string;
    transitModeSummary?: string;
    transitLegs?: TransitLegDetail[];
};

type RouteEtaResult = {
    minutes?: number;
    distanceMeters?: number;
    source: "api" | "fallback";
    fallbackKind?: "road" | "straight";
    pathCoords?: RoutePathCoord[];
};

const TMAP_API_BASE_URL = "https://apis.openapi.sk.com";
const TMAP_REQUEST_TIMEOUT_MS = 12000;
const STRAIGHT_LINE_ALTERNATIVE_LIMIT = 3;
const TMAP_TRANSIT_REQUEST_COUNT = 12;
const SEARCH_RESULT_LIMIT = 12;
const MAX_PATH_POINTS = 1200;
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

function safeNumber(value: unknown): number | undefined {
    const n = typeof value === "string" ? Number(value) : (value as number);
    return Number.isFinite(n) ? n : undefined;
}

function isWgs84Coordinate(lat: number, lng: number): boolean {
    return Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180;
}

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

function ensureArray<T>(value: T | T[] | null | undefined): T[] {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined) return [];
    return [value];
}

function resolveTmapAppKey(): string | undefined {
    return getEnv("EXPO_PUBLIC_TMAP_APP_KEY") ?? getEnv("EXPO_PUBLIC_TMAP_API_KEY");
}

function hasTmapAppKey(): boolean {
    return !!resolveTmapAppKey();
}

function getTmapHeaders() {
    const appKey = resolveTmapAppKey();
    if (!appKey) {
        throw new Error("Tmap API 키가 없습니다. EXPO_PUBLIC_TMAP_APP_KEY를 설정해 주세요.");
    }

    return {
        appKey,
    };
}

function tmapClient() {
    return axios.create({
        baseURL: TMAP_API_BASE_URL,
        timeout: TMAP_REQUEST_TIMEOUT_MS,
        headers: getTmapHeaders(),
    });
}

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

function clampPathCoords(coords: RoutePathCoord[], maxPoints = MAX_PATH_POINTS): RoutePathCoord[] {
    if (coords.length <= maxPoints) return coords;
    const step = Math.ceil(coords.length / maxPoints);
    const sampled = coords.filter((_, index) => index % step === 0);
    const last = coords[coords.length - 1];
    const tail = sampled[sampled.length - 1];
    if (!tail || tail.lat !== last.lat || tail.lng !== last.lng) sampled.push(last);
    return sampled;
}

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

function estimateMinutesByDistanceMeters(distanceMeters: number, mode: TravelMode): number | undefined {
    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return undefined;
    const speedKmh = TRAVEL_MODE_META[mode]?.speedKmh;
    if (!Number.isFinite(speedKmh) || speedKmh <= 0) return undefined;
    const minutes = (distanceMeters / 1000) / speedKmh * 60;
    return Math.max(1, Math.ceil(minutes));
}

function normalizeRoadTimeToMinutes(secondsRaw: unknown): number | undefined {
    const seconds = safeNumber(secondsRaw);
    if (typeof seconds !== "number") return undefined;
    return Math.max(1, Math.ceil(seconds / 60));
}

function normalizeTransitTimeToMinutes(rawValue: unknown): number | undefined {
    const raw = safeNumber(rawValue);
    if (typeof raw !== "number") return undefined;

    // 공급자마다 분/초 단위가 다를 수 있어 휴리스틱으로 정규화
    if (raw > 1000) return Math.max(1, Math.ceil(raw / 60));
    return Math.max(1, Math.ceil(raw));
}

function normalizeTransitLegDurationToMinutes(
    rawValue: unknown,
    kind: TransitLegKind,
    distanceMeters?: number
): number | undefined {
    const raw = safeNumber(rawValue);
    if (typeof raw !== "number") return undefined;

    const asMinutes = Math.max(1, Math.ceil(raw));
    const asSeconds = Math.max(1, Math.ceil(raw / 60));
    const distance = typeof distanceMeters === "number" && Number.isFinite(distanceMeters) ? distanceMeters : undefined;
    const normalizeWalkByDistance = (minutes: number): number => {
        if (kind !== "WALK" || typeof distance !== "number" || distance <= 0) return minutes;
        const expected = Math.max(1, Math.round(distance / 68));
        const minPlausible = Math.max(1, Math.floor(distance / 170));
        const maxPlausible = Math.max(2, Math.ceil(distance / 22));
        if (minutes < minPlausible || minutes > maxPlausible) {
            return Math.max(minPlausible, Math.min(maxPlausible, expected));
        }
        return minutes;
    };

    // 명확히 큰 값은 초로 본다.
    if (raw >= 1000) return normalizeWalkByDistance(asSeconds);

    if (!distance || distance <= 0) {
        if (kind === "WALK" && raw >= 120) return normalizeWalkByDistance(asSeconds);
        return asMinutes;
    }

    const speedIfMinutes = distance / (asMinutes / 60); // m/h
    const speedIfSeconds = distance / (asSeconds / 60); // m/h

    if (kind === "WALK") {
        const walkMin = 1500;
        const walkMax = 7500;
        const minutesPlausible = speedIfMinutes >= walkMin && speedIfMinutes <= walkMax;
        const secondsPlausible = speedIfSeconds >= walkMin && speedIfSeconds <= walkMax;

        if (secondsPlausible && !minutesPlausible) return normalizeWalkByDistance(asSeconds);
        if (minutesPlausible && !secondsPlausible) return normalizeWalkByDistance(asMinutes);

        const walkTarget = 4200;
        const normalized = Math.abs(speedIfSeconds - walkTarget) < Math.abs(speedIfMinutes - walkTarget)
            ? asSeconds
            : asMinutes;
        return normalizeWalkByDistance(normalized);
    }

    const transitMin = 2500;
    const transitMax = 120000;
    const minutesPlausible = speedIfMinutes >= transitMin && speedIfMinutes <= transitMax;
    const secondsPlausible = speedIfSeconds >= transitMin && speedIfSeconds <= transitMax;

    if (secondsPlausible && !minutesPlausible && raw >= 180) return asSeconds;
    if (minutesPlausible) return asMinutes;
    if (secondsPlausible) return asSeconds;
    return asMinutes;
}

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
    const firstLane = Array.isArray(leg?.lane) ? leg.lane[0] : undefined;
    const raw = firstLane?.name ?? firstLane?.busNo ?? firstLane?.no ?? leg?.route ?? leg?.routeNm ?? leg?.lineName;
    if (typeof raw !== "string") return undefined;
    const normalized = raw.trim();
    return normalized.length > 0 ? normalized : undefined;
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

function parseTransitLegStations(leg: any): any[] {
    return ensureArray(
        leg?.passStopList?.stationList ??
        leg?.passStopList?.stations ??
        leg?.stations ??
        leg?.stopList ??
        leg?.stopPoints
    );
}

function parseStationName(station: any): string | undefined {
    if (!station || typeof station !== "object") return undefined;
    const raw = station?.name ?? station?.stationName ?? station?.poiName ?? station?.arsId;
    if (typeof raw !== "string") return undefined;
    const normalized = raw.trim();
    return normalized.length > 0 ? normalized : undefined;
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

function parseTransitLegPathCoords(leg: any): RoutePathCoord[] | undefined {
    const direct = parseTransitPathCoords(
        leg?.passShape?.linestring ??
        leg?.passShape?.coordinates ??
        leg?.shape ??
        leg?.path ??
        leg?.geometry
    );
    if (direct) return direct;
    // WALK 레그는 passShape.linestring 대신 steps[].linestring에 보행자 경로가 담겨 있음
    const stepsPath = parseTransitStepsLinestring(leg);
    if (stepsPath) return stepsPath;
    const stationPath = parseTransitLegStationPath(leg);
    if (stationPath) return stationPath;
    // 구간 세부 path가 없는 경우 직선 보간을 그리면 화면에 부정확한 장거리 직선이 생긴다.
    // 정밀도를 위해 "실제 path가 존재하는 구간"만 색상 구간선으로 노출한다.
    return undefined;
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
                leg?.sectionTime ?? leg?.time ?? leg?.duration ?? leg?.moveTime,
                kind,
                distanceMeters
            );
            const stationCount = parseTransitLegStationCount(leg);
            const lineName = parseTransitLegLineName(leg);
            const startName = parseTransitLegStartName(leg);
            const endName = parseTransitLegEndName(leg);
            const startCoord = parseTransitLegStartCoord(leg);
            const endCoord = parseTransitLegEndCoord(leg);
            const nextStartCoordHint = legIndex < legArray.length - 1
                ? parseTransitLegStartCoord(legArray[legIndex + 1])
                : undefined;
            const forceEndToTail = kind === "WALK" && legIndex === legArray.length - 1;
            let pathCoords = parseTransitLegPathCoords(leg);
            // steps[].linestring 또는 passShape.linestring에서 직접 파싱된 경우만 exact로 표시
            let pathCoordsIsExact = Array.isArray(pathCoords) && pathCoords.length >= 2;

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
                startName,
                endName,
                startCoord: normalizedStartCoord,
                endCoord: normalizedEndCoord,
                pathCoords,
                pathCoordsIsExact,
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

function dedupeRouteAlternatives(items: RouteAlternativeOption[]): RouteAlternativeOption[] {
    const used = new Set<string>();
    const result: RouteAlternativeOption[] = [];

    for (const item of items) {
        const minuteBucket = typeof item.minutes === "number" ? Math.round(item.minutes) : -1;
        const distanceBucket = typeof item.distanceMeters === "number" ? Math.round(item.distanceMeters / 100) : -1;
        const pathBucket = Array.isArray(item.pathCoords) ? item.pathCoords.length : 0;
        const key = `${item.mode}|${minuteBucket}|${distanceBucket}|${pathBucket}`;
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

function parseRouteSummaryFromFeatureCollection(data: any): { minutes?: number; distanceMeters?: number; pathCoords?: RoutePathCoord[] } {
    const features = Array.isArray(data?.features) ? data.features : [];
    let distanceMeters: number | undefined;
    let minutes: number | undefined;

    for (const feature of features) {
        const properties = feature?.properties;
        const totalDistance = safeNumber(properties?.totalDistance ?? properties?.distance);
        const totalTimeSeconds = safeNumber(properties?.totalTime ?? properties?.time);
        if (typeof totalDistance === "number" || typeof totalTimeSeconds === "number") {
            distanceMeters = totalDistance;
            minutes = normalizeRoadTimeToMinutes(totalTimeSeconds);
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
    return { minutes, distanceMeters, pathCoords };
}

function parseTransitPathCoords(raw: unknown): RoutePathCoord[] | undefined {
    if (!raw) return undefined;

    if (Array.isArray(raw)) {
        const parsed = raw
            .map((point: unknown) => {
                if (Array.isArray(point) && point.length >= 2) {
                    const lng = safeNumber(point[0]);
                    const lat = safeNumber(point[1]);
                    if (typeof lat === "number" && typeof lng === "number") return { lat, lng } as RoutePathCoord;
                }
                if (typeof point === "object" && point !== null) {
                    const lat = safeNumber((point as any).lat ?? (point as any).latitude ?? (point as any).y);
                    const lng = safeNumber((point as any).lng ?? (point as any).longitude ?? (point as any).x);
                    if (typeof lat === "number" && typeof lng === "number") return { lat, lng } as RoutePathCoord;
                }
                return null;
            })
            .filter((value: RoutePathCoord | null): value is RoutePathCoord => value !== null);
        if (parsed.length >= 2) return clampPathCoords(dedupePathCoords(parsed));
    }

    if (typeof raw === "string") {
        const matchPairs: RoutePathCoord[] = [];
        const pairRegex = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g;
        let match = pairRegex.exec(raw);
        while (match) {
            const lng = safeNumber(match[1]);
            const lat = safeNumber(match[2]);
            if (typeof lat === "number" && typeof lng === "number") {
                matchPairs.push({ lat, lng });
            }
            match = pairRegex.exec(raw);
        }
        if (matchPairs.length >= 2) return clampPathCoords(dedupePathCoords(matchPairs));

        const parsed = raw
            .split(/\s+/)
            .map((token) => token.trim())
            .filter(Boolean)
            .map((token) => token.split(","))
            .map((coords) => {
                if (coords.length < 2) return null;
                const lng = safeNumber(coords[0]);
                const lat = safeNumber(coords[1]);
                if (typeof lat !== "number" || typeof lng !== "number") return null;
                return { lat, lng } as RoutePathCoord;
            })
            .filter((value: RoutePathCoord | null): value is RoutePathCoord => value !== null);
        if (parsed.length >= 2) return clampPathCoords(dedupePathCoords(parsed));
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
    const directPath = parseTransitPathCoords(itinerary?.path);
    if (directPath) return directPath;

    const legs = Array.isArray(itinerary?.legs) ? itinerary.legs : [];
    const legCoords = legs
        .map((leg: any) => parseTransitLegPathCoords(leg))
        .filter((value: RoutePathCoord[] | undefined): value is RoutePathCoord[] => Array.isArray(value) && value.length >= 2)
        .flat();

    if (legCoords.length < 2) return undefined;
    return clampPathCoords(dedupePathCoords(legCoords));
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
    // Prefer the parcel/building center so named POIs stay aligned with the building footprint.
    // Entrance(front) coordinates tend to bias the marker toward the road and looked off for places like 아울타워.
    return pickFirstValidCoordinatePair([
        [poi?.noorLat, poi?.noorLon],
        [poi?.newLat, poi?.newLon],
        [poi?.lat, poi?.lon],
        [poi?.frontLat, poi?.frontLon],
    ]);
}

function parsePoiResults(data: any): PlaceSearchItem[] {
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

            return {
                name,
                address: address || name,
                lat: coord.lat,
                lng: coord.lng,
                category,
            } as PlaceSearchItem;
        })
        .filter((value: PlaceSearchItem | null): value is PlaceSearchItem => value !== null);
}

function parseFullAddressGeoResults(data: any, query: string): PlaceSearchItem[] {
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

            return {
                name,
                address: address?.trim() || query,
                lat,
                lng,
                category: "주소",
            } as PlaceSearchItem;
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

async function searchViaTmapPoi(query: string): Promise<PlaceSearchItem[]> {
    const client = tmapClient();
    const response = await client.get("/tmap/pois", {
        params: {
            version: 1,
            format: "json",
            count: 10,
            searchKeyword: query,
            reqCoordType: "WGS84GEO",
            resCoordType: "WGS84GEO",
        },
    });
    return parsePoiResults(response.data);
}

async function geocodeViaTmap(query: string): Promise<PlaceSearchItem[]> {
    const client = tmapClient();
    const response = await client.get("/tmap/geo/fullAddrGeo", {
        params: {
            version: 1,
            format: "json",
            coordType: "WGS84GEO",
            fullAddr: query,
        },
    });
    return parseFullAddressGeoResults(response.data, query);
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

async function searchViaNominatim(query: string): Promise<PlaceSearchItem[]> {
    const response = await nominatimClient.get("/search", {
        params: {
            q: query,
            format: "json",
            countrycodes: "kr",
            limit: 10,
            addressdetails: 1,
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

            return { name, address, lat, lng } as PlaceSearchItem;
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

async function getRouteViaOSRM(
    origin: Place,
    destination: Place,
    profile: "driving" | "walking" | "cycling"
): Promise<{ minutes?: number; distanceMeters?: number; pathCoords?: RoutePathCoord[] }> {
    const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
    const response = await axios.get(
        `https://router.project-osrm.org/route/v1/${profile}/${coords}`,
        {
            params: {
                alternatives: true,
                overview: "full",
                geometries: "geojson",
            },
            timeout: 10000,
            headers: { "User-Agent": "NoLateFE/1.0" },
        }
    );

    if (response.data?.code !== "Ok") return {};
    const route = response.data?.routes?.[0];
    if (!route) return {};

    const distanceMeters = safeNumber(route.distance);
    const durationSec = safeNumber(route.duration);
    const minutes = typeof durationSec === "number" ? Math.max(1, Math.ceil(durationSec / 60)) : undefined;

    const pathCoords = Array.isArray(route.geometry?.coordinates)
        ? clampPathCoords(
              dedupePathCoords(
                  route.geometry.coordinates
                      .map((point: unknown) => parseLatLngPair(point))
                      .filter((value: RoutePathCoord | null): value is RoutePathCoord => value !== null)
              )
          )
        : undefined;

    return { minutes, distanceMeters, pathCoords };
}

async function getRouteAlternativesViaOSRM(
    origin: Place,
    destination: Place,
    profile: "driving" | "walking" | "cycling",
    mode: TravelMode,
    source: "api" | "fallback",
    fallbackKind?: "road" | "straight"
): Promise<RouteAlternativeOption[]> {
    const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
    const response = await axios.get(
        `https://router.project-osrm.org/route/v1/${profile}/${coords}`,
        {
            params: {
                alternatives: true,
                overview: "full",
                geometries: "geojson",
            },
            timeout: 10000,
            headers: { "User-Agent": "NoLateFE/1.0" },
        }
    );
    if (response.data?.code !== "Ok") return [];

    const routes = Array.isArray(response.data?.routes) ? response.data.routes : [];
    const parsed = routes
        .map((route: any, index: number) => {
            const distanceMeters = safeNumber(route?.distance);
            const durationSec = safeNumber(route?.duration);
            const minutes = typeof durationSec === "number" ? Math.max(1, Math.ceil(durationSec / 60)) : undefined;

            const pathCoords = Array.isArray(route?.geometry?.coordinates)
                ? clampPathCoords(
                      dedupePathCoords(
                          route.geometry.coordinates
                              .map((point: unknown) => parseLatLngPair(point))
                              .filter((value: RoutePathCoord | null): value is RoutePathCoord => value !== null)
                      )
                  )
                : undefined;

            if (
                typeof minutes !== "number" &&
                typeof distanceMeters !== "number" &&
                (!Array.isArray(pathCoords) || pathCoords.length < 2)
            ) {
                return null;
            }

            return {
                id: buildAlternativeId(`osrm-${profile}`, index),
                mode,
                minutes,
                distanceMeters,
                source,
                fallbackKind,
                pathCoords,
            } as RouteAlternativeOption;
        })
        .filter((value: RouteAlternativeOption | null): value is RouteAlternativeOption => value !== null);

    return parsed;
}

async function getDrivingRouteViaTmap(
    origin: Place,
    destination: Place,
    searchOption: string
): Promise<{ minutes?: number; distanceMeters?: number; pathCoords?: RoutePathCoord[] }> {
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

    return parseRouteSummaryFromFeatureCollection(response.data);
}

async function getWalkingRouteViaTmap(
    origin: Place,
    destination: Place,
    searchOption = "0"
): Promise<{ minutes?: number; distanceMeters?: number; pathCoords?: RoutePathCoord[] }> {
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

    return parseRouteSummaryFromFeatureCollection(response.data);
}

function parseTransitOptionsFromTmap(data: any): TransitRouteOption[] {
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
            const pathCoords = parseTransitItineraryPath(itinerary);
            const transitLegs = parseTransitLegDetails(itinerary?.legs ?? itinerary?.path, pathCoords);
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
            } as TransitRouteOption;
        })
        .filter((value: TransitRouteOption | null): value is TransitRouteOption => value !== null);

    return parsed.sort((a: TransitRouteOption, b: TransitRouteOption) => a.minutes - b.minutes);
}

async function getTransitRouteViaTmap(origin: Place, destination: Place): Promise<TransitRouteOption[]> {
    const client = tmapClient();
    const response = await client.post(
        "/transit/routes",
        {
            startX: String(origin.lng),
            startY: String(origin.lat),
            endX: String(destination.lng),
            endY: String(destination.lat),
            count: TMAP_TRANSIT_REQUEST_COUNT,
            lang: 0,
            format: "json",
        },
        {
            headers: {
                "Content-Type": "application/json",
            },
        }
    );
    return parseTransitOptionsFromTmap(response.data);
}

function convertRoadAlternativesToMode(
    roadAlternatives: RouteAlternativeOption[],
    mode: TravelMode,
    idPrefix: string
): RouteAlternativeOption[] {
    return roadAlternatives
        .map((item, index) => {
            const byDistance = typeof item.distanceMeters === "number"
                ? estimateMinutesByDistanceMeters(item.distanceMeters, mode)
                : undefined;
            const normalized = byDistance ?? item.minutes;
            if (typeof normalized !== "number" && typeof item.distanceMeters !== "number") return null;

            return {
                ...item,
                id: buildAlternativeId(idPrefix, index),
                mode,
                minutes: normalized,
                source: "fallback",
                fallbackKind: "road",
            } as RouteAlternativeOption;
        })
        .filter((value: RouteAlternativeOption | null): value is RouteAlternativeOption => value !== null);
}

function makeStraightLineAlternatives(
    origin: Place,
    destination: Place,
    mode: TravelMode,
    baseLabel: string
): RouteAlternativeOption[] {
    const baseMinutes = estimateTravelMinutesByStraightDistance(origin, destination, mode);
    const base = typeof baseMinutes === "number" ? Math.max(1, Math.ceil(baseMinutes)) : 1;
    const straightPath: RoutePathCoord[] = [
        { lat: origin.lat!, lng: origin.lng! },
        { lat: destination.lat!, lng: destination.lng! },
    ];
    const factors = [1, 1.15, 1.3];

    return factors.slice(0, STRAIGHT_LINE_ALTERNATIVE_LIMIT).map((factor, index) => ({
        id: buildAlternativeId(`${baseLabel}-straight`, index),
        mode,
        minutes: Math.max(1, Math.ceil(base * factor)),
        source: "fallback",
        fallbackKind: "straight",
        pathCoords: straightPath,
    }));
}

async function getDrivingAlternatives(origin: Place, destination: Place, mode: "CAR" | "ETC"): Promise<RouteAlternativeOption[]> {
    const searchOptions = mode === "CAR" ? ["0", "1", "2"] : ["0", "1"];
    const options: RouteAlternativeOption[] = [];

    for (let index = 0; index < searchOptions.length; index += 1) {
        const searchOption = searchOptions[index];
        try {
            const parsed = await getDrivingRouteViaTmap(origin, destination, searchOption);
            if (
                typeof parsed.minutes !== "number" &&
                typeof parsed.distanceMeters !== "number" &&
                (!Array.isArray(parsed.pathCoords) || parsed.pathCoords.length < 2)
            ) {
                continue;
            }

            options.push({
                id: buildAlternativeId(`${mode.toLowerCase()}-api`, index),
                mode,
                minutes: parsed.minutes,
                distanceMeters: parsed.distanceMeters,
                pathCoords: parsed.pathCoords,
                source: "api",
            });
        } catch (error) {
            console.warn(`[대안경로] Tmap driving(${searchOption}) 실패 →`, tmapApiErrorMessage(error));
        }
    }

    return dedupeRouteAlternatives(options);
}

async function getWalkingAlternatives(origin: Place, destination: Place): Promise<RouteAlternativeOption[]> {
    const searchOptions = ["0", "4"];
    const options: RouteAlternativeOption[] = [];

    for (let index = 0; index < searchOptions.length; index += 1) {
        const searchOption = searchOptions[index];
        try {
            const parsed = await getWalkingRouteViaTmap(origin, destination, searchOption);
            if (
                typeof parsed.minutes !== "number" &&
                typeof parsed.distanceMeters !== "number" &&
                (!Array.isArray(parsed.pathCoords) || parsed.pathCoords.length < 2)
            ) {
                continue;
            }

            options.push({
                id: buildAlternativeId("walk-api", index),
                mode: "WALK",
                minutes: parsed.minutes,
                distanceMeters: parsed.distanceMeters,
                pathCoords: parsed.pathCoords,
                source: "api",
            });
        } catch (error) {
            console.warn(`[대안경로] Tmap pedestrian(${searchOption}) 실패 →`, tmapApiErrorMessage(error));
        }
    }

    return dedupeRouteAlternatives(options);
}

export async function searchAddressByKeyword(query: string): Promise<PlaceSearchItem[]> {
    const normalized = query.trim();
    if (!normalized) return [];

    const merged: PlaceSearchItem[] = [];

    if (hasTmapAppKey()) {
        try {
            const poiResults = await searchViaTmapPoi(normalized);
            merged.push(...poiResults);
        } catch (error) {
            console.warn("[주소검색] Tmap POI 실패 →", tmapApiErrorMessage(error));
        }

        try {
            const geocoded = await geocodeViaTmap(normalized);
            merged.push(...geocoded);
        } catch (error) {
            console.warn("[주소검색] Tmap FullAddrGeo 실패 →", tmapApiErrorMessage(error));
        }

        const unique = dedupeSearchResults(merged);
        if (unique.length > 0) return unique.slice(0, SEARCH_RESULT_LIMIT);
    }

    try {
        return await searchViaNominatim(normalized);
    } catch (error) {
        if (!hasTmapAppKey()) {
            throw new Error("Tmap API 키가 없습니다. EXPO_PUBLIC_TMAP_APP_KEY를 설정해 주세요.");
        }
        throw error;
    }
}

export async function reverseGeocodeToAddress(lat: number, lng: number): Promise<string | undefined> {
    if (hasTmapAppKey()) {
        try {
            const address = await reverseViaTmap(lat, lng);
            if (address) return address;
        } catch (error) {
            console.warn("[역지오코딩] Tmap 실패 →", tmapApiErrorMessage(error));
        }
    }

    try {
        return await reverseViaNominatim(lat, lng);
    } catch {
        return undefined;
    }
}

export async function getTransitRouteOptions(
    origin: Place | undefined,
    destination: Place | undefined
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

    if (hasTmapAppKey()) {
        try {
            const tmapOptions = await getTransitRouteViaTmap(origin, destination);
            if (tmapOptions.length > 0) return tmapOptions;
        } catch (error) {
            console.warn("[대중교통옵션] Tmap transit 실패 →", tmapApiErrorMessage(error));
        }
    }

    try {
        const driving = await getRouteViaOSRM(origin, destination, "driving");
        if (typeof driving.minutes === "number") {
            return [{
                id: "fallback-road",
                minutes: Math.max(1, Math.ceil(driving.minutes * 1.4)),
                distanceMeters: driving.distanceMeters,
                stepSummary: "대중교통 API 미연결: 도로 경로 기반 보정",
                source: "fallback",
                fallbackKind: "road",
            }];
        }
    } catch {
        // ignore
    }

    const straightMinutes = estimateTravelMinutesByStraightDistance(origin, destination, "TRANSIT") ?? 1;
    return [{
        id: "fallback-straight",
        minutes: Math.max(1, Math.ceil(straightMinutes)),
        stepSummary: "대중교통 API 미연결: 직선거리 기반 추정",
        source: "fallback",
        fallbackKind: "straight",
    }];
}

export async function getRouteAlternativeOptions(
    origin: Place | undefined,
    destination: Place | undefined,
    mode: TravelMode
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
        if (hasTmapAppKey()) {
            try {
                const options = await getTransitRouteViaTmap(origin, destination);
                const transitAlternatives = options.map((item, index) => ({
                    ...item,
                    id: item.id || buildAlternativeId("transit", index),
                    mode: "TRANSIT" as const,
                }));
                if (transitAlternatives.length > 0) {
                    return limitAlternativesByMode("TRANSIT", dedupeRouteAlternatives(transitAlternatives));
                }
            } catch (error) {
                console.warn("[대안경로] Tmap transit 실패 →", tmapApiErrorMessage(error));
            }
        }

        try {
            const roadAlternatives = await getRouteAlternativesViaOSRM(
                origin,
                destination,
                "driving",
                "TRANSIT",
                "fallback",
                "road"
            );
            const converted = dedupeRouteAlternatives(
                roadAlternatives.map((item, index) => ({
                    ...item,
                    id: buildAlternativeId("transit-road", index),
                    mode: "TRANSIT" as const,
                    minutes: typeof item.minutes === "number" ? Math.max(1, Math.ceil(item.minutes * 1.4)) : item.minutes,
                    source: "fallback" as const,
                    fallbackKind: "road" as const,
                    stepSummary: "대중교통 API 미연결: 도로 경로 기반 보정",
                }))
            );
            if (converted.length > 0) return limitAlternativesByMode("TRANSIT", converted);
        } catch {
            // ignore
        }

        return makeStraightLineAlternatives(origin, destination, "TRANSIT", "transit");
    }

    if (mode === "CAR" || mode === "ETC") {
        if (hasTmapAppKey()) {
            try {
                const alternatives = await getDrivingAlternatives(origin, destination, mode);
                if (alternatives.length > 0) return limitAlternativesByMode(mode, alternatives);
            } catch (error) {
                console.warn("[대안경로] Tmap driving 실패 →", tmapApiErrorMessage(error));
            }
        }

        try {
            const roadAlternatives = await getRouteAlternativesViaOSRM(
                origin,
                destination,
                "driving",
                mode,
                "fallback",
                "road"
            );
            const converted = dedupeRouteAlternatives(roadAlternatives.map((item, index) => ({
                ...item,
                id: buildAlternativeId(`${mode.toLowerCase()}-road`, index),
                mode,
                source: "fallback" as const,
                fallbackKind: "road" as const,
            })));
            if (converted.length > 0) return limitAlternativesByMode(mode, converted);
        } catch {
            // ignore
        }

        return makeStraightLineAlternatives(origin, destination, mode, mode.toLowerCase());
    }

    if (mode === "WALK") {
        if (hasTmapAppKey()) {
            try {
                const walkAlternatives = await getWalkingAlternatives(origin, destination);
                if (walkAlternatives.length > 1) return limitAlternativesByMode("WALK", walkAlternatives);
                if (walkAlternatives.length === 1) {
                    const roadFallback = await getRouteAlternativesViaOSRM(
                        origin,
                        destination,
                        "driving",
                        "WALK",
                        "fallback",
                        "road"
                    );
                    const converted = convertRoadAlternativesToMode(roadFallback, "WALK", "walk-road");
                    const merged = dedupeRouteAlternatives([...walkAlternatives, ...converted]);
                    if (merged.length > 0) return limitAlternativesByMode("WALK", merged);
                }
            } catch (error) {
                console.warn("[대안경로] Tmap pedestrian 실패 →", tmapApiErrorMessage(error));
            }
        }

        try {
            const osrmWalk = await getRouteAlternativesViaOSRM(origin, destination, "walking", "WALK", "fallback", "road");
            if (osrmWalk.length > 0) return limitAlternativesByMode("WALK", dedupeRouteAlternatives(osrmWalk));
        } catch {
            // ignore
        }

        return makeStraightLineAlternatives(origin, destination, "WALK", "walk");
    }

    if (mode === "BIKE") {
        if (hasTmapAppKey()) {
            try {
                const drivingAlternatives = await getDrivingAlternatives(origin, destination, "CAR");
                const converted = convertRoadAlternativesToMode(drivingAlternatives, "BIKE", "bike-road");
                if (converted.length > 0) return limitAlternativesByMode("BIKE", dedupeRouteAlternatives(converted));
            } catch (error) {
                console.warn("[대안경로] Tmap bike-convert 실패 →", tmapApiErrorMessage(error));
            }
        }

        try {
            const osrmBike = await getRouteAlternativesViaOSRM(origin, destination, "cycling", "BIKE", "fallback", "road");
            if (osrmBike.length > 0) return limitAlternativesByMode("BIKE", dedupeRouteAlternatives(osrmBike));
        } catch {
            // ignore
        }

        return makeStraightLineAlternatives(origin, destination, "BIKE", "bike");
    }

    return [];
}

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

    if (
        !origin ||
        !destination ||
        typeof origin.lat !== "number" ||
        typeof origin.lng !== "number" ||
        typeof destination.lat !== "number" ||
        typeof destination.lng !== "number"
    ) {
        return { source: "fallback" };
    }

    const fallbackMinutes = estimateTravelMinutesByStraightDistance(origin, destination, mode);
    return {
        minutes: typeof fallbackMinutes === "number" ? Math.max(1, Math.ceil(fallbackMinutes)) : undefined,
        source: "fallback",
        fallbackKind: "straight",
        pathCoords: [
            { lat: origin.lat, lng: origin.lng },
            { lat: destination.lat, lng: destination.lng },
        ],
    };
}
