import { isTransitRideKind } from "./transitModes";
import {
    safeNumber,
    pickFirstValidCoordinatePair,
    ensureArray,
    clampPathCoords,
    dedupePathCoords,
} from "./tmapApiCore.ts";
import type {
    RoutePathCoord,
    TransitLegKind,
    TransitPassStop,
    TransitServiceClass,
} from "./tmapApiCore.ts";

// BE TmapTransitJourneyMapper와 같은 명시적 /transit/routes 지하철 종별 코드다.
// 노선명에 급행 표기가 없다는 이유로 일반 열차라고 추정하지 않는다.
const TMAP_EXPRESS_SUBWAY_TYPES = new Set(Array.from({ length: 8 }, (_, index) => 117 + index));
const TMAP_LOCAL_SUBWAY_TYPES = new Set([
    ...Array.from({ length: 11 }, (_, index) => index + 1),
    21, 22, 31, 41, 42, 43, 44, 51, 71, 72, 73, 74, 78, 79,
    100, 101, 104, 107, 108, 109, 110, 112, 113, 114, 115, 116, 125,
]);

function parseTmapNonnegativeInteger(value: unknown): number | undefined {
    if (typeof value === "string" && !/^\d+$/.test(value.trim())) return undefined;
    if (typeof value !== "number" && typeof value !== "string") return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseTmapIdentifier(value: unknown): string | undefined {
    if (typeof value === "number") return Number.isSafeInteger(value) ? String(value) : undefined;
    return typeof value === "string" ? value.trim() || undefined : undefined;
}

/** 재조회 시 다른 Lane 대체노선과 혼동하지 않도록 본 노선 ID만 보존한다. */
export function parseTransitLegProviderRouteId(leg: any): string | undefined {
    return parseTmapIdentifier(leg?.routeId);
}

export function parseTransitLegServiceClass(leg: any): TransitServiceClass {
    if (normalizeTransitLegKind(leg) !== "SUBWAY") return "UNKNOWN";
    const type = parseTmapNonnegativeInteger(leg?.type);
    if (type !== undefined && TMAP_EXPRESS_SUBWAY_TYPES.has(type)) return "EXPRESS";
    if (type !== undefined && TMAP_LOCAL_SUBWAY_TYPES.has(type)) return "LOCAL";
    return "UNKNOWN";
}

/** 공급자 원본 값을 `normalizeTransitLegKind` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function normalizeTransitLegKind(leg: any): TransitLegKind {
    const trafficType = safeNumber(leg?.trafficType);
    if (trafficType === 1) return "SUBWAY";
    if (trafficType === 2) return "BUS";
    if (trafficType === 3) return "WALK";

    const modeRaw = String(leg?.mode ?? leg?.type ?? leg?.travelType ?? "").toUpperCase();
    if (modeRaw === "TRAIN") return "TRAIN";
    if (modeRaw === "EXPRESSBUS") {
        const type = parseTmapNonnegativeInteger(leg?.type);
        if (type === 16 || type === 22) return "INTERCITY_BUS";
        if (type === 23) return "EXPRESS_BUS";
        return "COACH";
    }
    if (modeRaw.includes("SUBWAY") || modeRaw.includes("METRO") || modeRaw.includes("RAIL")) return "SUBWAY";
    if (modeRaw.includes("BUS")) return "BUS";
    if (modeRaw.includes("WALK") || modeRaw.includes("FOOT")) return "WALK";
    return "ETC";
}

/** 공급자 원본 값을 `parseTransitLegLineName` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitLegLineName(leg: any): string | undefined {
    const firstLane = Array.isArray(leg?.lane)
        ? leg.lane[0]
        : Array.isArray(leg?.Lane)
            ? leg.Lane[0]
            : undefined;
    // Lane은 대체노선 목록이다. 본 노선 route를 우선하고 Lane-only 구형 응답의 표시만 호환한다.
    const raw = [leg?.route, leg?.routeNm, leg?.lineName, firstLane?.name, firstLane?.route, firstLane?.busNo, firstLane?.no]
        .find((value) => typeof value === "string" && value.trim().length > 0);
    return typeof raw === "string" ? raw.trim() : undefined;
}

/** 공급자 원본 값을 `normalizeTransitColorCandidate` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function normalizeTransitColorCandidate(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    if (!normalized) return undefined;

    // Tmap 원본 응답은 "53B332"처럼 # 없이 내려 주는 경우가 있어
    // 화면 레이어에서 바로 쓸 수 있는 CSS hex 형태로 맞춘다.
    if (/^[0-9A-Fa-f]{6}$/.test(normalized)) return `#${normalized.toUpperCase()}`;
    if (/^#[0-9A-Fa-f]{6}$/.test(normalized)) return normalized.toUpperCase();
    return undefined;
}

/** 공급자 원본 값을 `parseTransitLegLineColor` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitLegLineColor(leg: any): string | undefined {
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

/** 공급자 원본 값을 `parseTransitLegServiceAvailable` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitLegServiceAvailable(leg: any): boolean | undefined {
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

/** 공급자 원본 값을 `parseTransitLegStationCount` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitLegStationCount(leg: any): number | undefined {
    const byField = safeNumber(leg?.stationCount ?? leg?.passStopCount);
    if (typeof byField === "number") return Math.max(0, Math.round(byField));

    const stations = ensureArray(leg?.passStopList?.stationList ?? leg?.passStopList?.stations ?? leg?.stations);
    if (stations.length > 1) return Math.max(0, stations.length - 1);
    return undefined;
}

/** 공급자 원본 값을 `parseTransitLegStartName` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitLegStartName(leg: any): string | undefined {
    const kind = normalizeTransitLegKind(leg);
    if (isTransitRideKind(kind)) {
        const stationStart = parseTransitLegStationName(leg, "first");
        if (stationStart) return stationStart;
    }
    const raw = leg?.start?.name ?? leg?.startName ?? leg?.startStationName ?? leg?.departure ?? leg?.from;
    if (typeof raw !== "string") return undefined;
    const normalized = raw.trim();
    return normalized.length > 0 ? normalized : undefined;
}

/** 공급자 원본 값을 `parseTransitLegEndName` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitLegEndName(leg: any): string | undefined {
    const kind = normalizeTransitLegKind(leg);
    if (isTransitRideKind(kind)) {
        const stationEnd = parseTransitLegStationName(leg, "last");
        if (stationEnd) return stationEnd;
    }
    const raw = leg?.end?.name ?? leg?.endName ?? leg?.endStationName ?? leg?.arrival ?? leg?.to;
    if (typeof raw !== "string") return undefined;
    const normalized = raw.trim();
    return normalized.length > 0 ? normalized : undefined;
}

/** 공급자 원본 값을 `parseTransitLegDirectionName` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitLegDirectionName(leg: any): string | undefined {
    // 대체노선의 행선지를 본 노선 방향으로 저장하면 BE의 동일 경로 검증이 어긋난다.
    const candidates = [
        leg?.directionName,
        leg?.direction,
        leg?.routeDirection,
        leg?.headsign,
        leg?.destinationName,
    ];
    const raw = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
    return typeof raw === "string" ? raw.trim() : undefined;
}

/** 공급자가 직접 제공한 본 노선 상·하행만 보존한다. */
export function parseTransitLegDirectionCode(leg: any): "UP" | "DOWN" | undefined {
    const code = typeof leg?.directionCode === "string" ? leg.directionCode.trim().toUpperCase() : undefined;
    return code === "UP" || code === "DOWN" ? code : undefined;
}

/** TMAP 경로 처리의 `firstTransitGuideText` 계산 단계를 독립적으로 수행합니다. */
export function firstTransitGuideText(...candidates: unknown[]): string | undefined {
    const raw = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
    return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : undefined;
}

/** 공급자 원본 값을 `parsePlatformFromStationName` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parsePlatformFromStationName(name?: string): string | undefined {
    const rawPlatform = name?.match(/\(([^()]*(?:승강장|플랫폼|홈)[^()]*)\)/u)?.[1];
    return rawPlatform
        ?.replace(/(\d+)\s*번\s*(승강장|플랫폼|홈)/u, "$1번 $2")
        .replace(/\s+/g, " ")
        .trim() || undefined;
}

/** 공급자 원본 값을 `parseTransitLegBoardingPlatform` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitLegBoardingPlatform(leg: any, startName?: string): string | undefined {
    return firstTransitGuideText(
        leg?.boardingPlatform,
        leg?.platformName,
        leg?.platform,
        leg?.start?.boardingPlatform,
        leg?.start?.platformName,
        leg?.start?.platform
    ) ?? parsePlatformFromStationName(startName);
}

/** 공급자 원본 값을 `normalizeTransitExitName` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function normalizeTransitExitName(value: unknown): string | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return `${Math.round(value)}번 출구`;
    const raw = firstTransitGuideText(value);
    if (!raw) return undefined;
    return /^\d+$/u.test(raw) ? `${raw}번 출구` : raw;
}

/** 공급자 원본 값을 `parseTransitLegBoardingExit` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitLegBoardingExit(leg: any): string | undefined {
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

/** 공급자 원본 값을 `parseTransitLegRecommendedBoardingPosition` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitLegRecommendedBoardingPosition(leg: any): string | undefined {
    return firstTransitGuideText(
        leg?.recommendedBoardingPosition,
        leg?.recommendedCar,
        leg?.fastTransferCar,
        leg?.boardingPosition,
        leg?.start?.recommendedBoardingPosition,
        leg?.start?.recommendedCar
    );
}

/** 공급자 원본 값을 `parseTransitStationSequence` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitStationSequence(station: any): number | undefined {
    return parseTmapNonnegativeInteger(station?.index);
}

/** 공급자 원본 값을 `parseTransitLegStations` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitLegStations(leg: any): any[] {
    const stations = ensureArray(
        leg?.passStopList?.stationList ??
        leg?.passStopList?.stations ??
        leg?.stations ??
        leg?.stopList ??
        leg?.stopPoints
    );

    // BE와 동일하게 index가 전부 없으면 원본 순서, 있으면 유효하고 유일한 index만 허용한다.
    // 일부 누락/중복 index를 임의로 정렬해 승하차 정류장 ID를 만들어 내지 않는다.
    if (!stations.some((station) => station && Object.prototype.hasOwnProperty.call(station, "index"))) return stations;
    const indexed = stations.map((station, originalIndex) => ({
        station,
        originalIndex,
        sequence: parseTransitStationSequence(station),
    }));
    if (indexed.some(({ sequence }) => sequence === undefined)) return [];
    if (new Set(indexed.map(({ sequence }) => sequence)).size !== indexed.length) return [];

    return indexed
        .sort((a, b) => (a.sequence! - b.sequence!) || (a.originalIndex - b.originalIndex))
        .map(({ station }) => station);
}

/** 표시용 code와 별도로 원본 공급자 정류장 ID와 명시적 ARS를 보존한다. */
export function parseTransitLegEndpointIdentifiers(leg: any): {
    startID?: string;
    endID?: string;
    startArsID?: string;
    endArsID?: string;
} {
    const stations = parseTransitLegStations(leg);
    if (stations.length < 2) return {};
    const first = stations[0];
    const last = stations[stations.length - 1];
    const explicitArs = (station: any): string | undefined => {
        const raw = station?.arsId ?? station?.arsID;
        const value = typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0
            ? String(raw).padStart(5, "0")
            : typeof raw === "string" ? raw.trim() : undefined;
        return value && /^\d{5}$/.test(value) ? value : undefined;
    };
    return {
        startID: parseTmapIdentifier(first?.stationID),
        endID: parseTmapIdentifier(last?.stationID),
        startArsID: explicitArs(first),
        endArsID: explicitArs(last),
    };
}

/** 공급자 원본 값을 `parseStationName` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseStationName(station: any): string | undefined {
    if (!station || typeof station !== "object") return undefined;
    const raw = station?.name ?? station?.stationName ?? station?.poiName ?? station?.arsId;
    if (typeof raw !== "string") return undefined;
    const normalized = raw.trim();
    return normalized.length > 0 ? normalized : undefined;
}

/** 공급자 원본 값을 `parseStationCode` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseStationCode(station: any): string | undefined {
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

/** 공급자 원본 값을 `parseTransitLegPassStops` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitLegPassStops(leg: any): TransitPassStop[] {
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

/** 공급자 원본 값을 `parseTransitLegStationName` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitLegStationName(leg: any, position: "first" | "last"): string | undefined {
    const stations = parseTransitLegStations(leg);
    if (!stations.length) return undefined;
    const station = position === "first" ? stations[0] : stations[stations.length - 1];
    return parseStationName(station);
}

/** 공급자 원본 값을 `parseStationCoord` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseStationCoord(station: any): RoutePathCoord | undefined {
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

/** 공급자 원본 값을 `parseTransitLegStationCoord` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitLegStationCoord(leg: any, position: "first" | "last"): RoutePathCoord | undefined {
    const stations = parseTransitLegStations(leg);
    if (!stations.length) return undefined;
    const station = position === "first" ? stations[0] : stations[stations.length - 1];
    return parseStationCoord(station);
}

/** 공급자 원본 값을 `parseTransitLegStationPath` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitLegStationPath(leg: any): RoutePathCoord[] | undefined {
    const stations = parseTransitLegStations(leg);
    if (stations.length < 2) return undefined;
    const coords = stations
        .map((station) => parseStationCoord(station))
        .filter((coord): coord is RoutePathCoord => !!coord);
    if (coords.length < 2) return undefined;
    return clampPathCoords(dedupePathCoords(coords));
}

/** 공급자 원본 값을 `parseTransitLegStartCoord` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitLegStartCoord(leg: any): RoutePathCoord | undefined {
    const kind = normalizeTransitLegKind(leg);
    if (isTransitRideKind(kind)) {
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

/** 공급자 원본 값을 `parseTransitLegEndCoord` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitLegEndCoord(leg: any): RoutePathCoord | undefined {
    const kind = normalizeTransitLegKind(leg);
    if (isTransitRideKind(kind)) {
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
