import axios from "axios";
import { Platform } from "react-native";

import { getEnv } from "../../api/env";
import type { Place } from "../schedule/types";
import type {
    RoutePathCoord,
    TransitLegDetail,
    TransitLegKind,
    TransitPassStop,
    TransitRouteOption,
    TransitServiceClass,
} from "./tmapApi";

const ODSAY_API_BASE_URL = "https://api.odsay.com/v1/api";
const ODSAY_REQUEST_TIMEOUT_MS = 25_000;
const ODSAY_ATTRIBUTION_URL = "https://lab.odsay.com/";

type OdsayPlatform = "android" | "ios";

function platformKeyName(platform: OdsayPlatform): string {
    return platform === "android"
        ? "EXPO_PUBLIC_ODSAY_ANDROID_API_KEY"
        : "EXPO_PUBLIC_ODSAY_IOS_API_KEY";
}

export function resolveOdsayApiKey(platform = Platform.OS): string | undefined {
    if (platform !== "android" && platform !== "ios") return undefined;
    return getEnv(platformKeyName(platform))?.trim() || undefined;
}

export function hasOdsayApiKey(platform = Platform.OS): boolean {
    return !!resolveOdsayApiKey(platform);
}

function safeNumber(value: unknown): number | undefined {
    const numberValue = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
}

function ensureArray<T>(value: T | T[] | null | undefined): T[] {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined) return [];
    return [value];
}

function textValue(value: unknown): string | undefined {
    if (typeof value !== "string" && typeof value !== "number") return undefined;
    const normalized = String(value).replace(/\s+/g, " ").trim();
    return normalized || undefined;
}

function routeCoord(x: unknown, y: unknown): RoutePathCoord | undefined {
    const lng = safeNumber(x);
    const lat = safeNumber(y);
    if (
        typeof lat !== "number" ||
        typeof lng !== "number" ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
    ) {
        return undefined;
    }
    return { lat, lng };
}

function sameCoord(left: RoutePathCoord, right: RoutePathCoord): boolean {
    return Math.abs(left.lat - right.lat) < 0.0000001 && Math.abs(left.lng - right.lng) < 0.0000001;
}

function appendCoords(target: RoutePathCoord[], coords: RoutePathCoord[]): void {
    coords.forEach((coord) => {
        const previous = target[target.length - 1];
        if (!previous || !sameCoord(previous, coord)) target.push(coord);
    });
}

function parseCoordinateList(raw: unknown): RoutePathCoord[] {
    return ensureArray(raw)
        .map((point: any) => routeCoord(point?.x, point?.y))
        .filter((coord): coord is RoutePathCoord => !!coord);
}

function coordinateGapScore(left: RoutePathCoord | undefined, right: RoutePathCoord | undefined): number {
    if (!left || !right) return Number.POSITIVE_INFINITY;
    const latitudeRadians = (((left.lat + right.lat) / 2) * Math.PI) / 180;
    const latitudeDelta = (right.lat - left.lat) * 111_320;
    const longitudeDelta = (right.lng - left.lng) * 111_320 * Math.cos(latitudeRadians);
    return (latitudeDelta * latitudeDelta) + (longitudeDelta * longitudeDelta);
}

function nearestEndpointGapScore(
    coordinate: RoutePathCoord | undefined,
    pathCoords: RoutePathCoord[]
): number {
    if (!coordinate || pathCoords.length === 0) return Number.POSITIVE_INFINITY;
    return Math.min(
        coordinateGapScore(coordinate, pathCoords[0]),
        coordinateGapScore(coordinate, pathCoords[pathCoords.length - 1])
    );
}

function orientInitialCoords(
    coords: RoutePathCoord[],
    startHint?: RoutePathCoord,
    followingCoords: RoutePathCoord[] = []
): RoutePathCoord[] {
    if (coords.length < 2) return coords;
    const first = coords[0];
    const last = coords[coords.length - 1];
    const forwardStartScore = startHint ? coordinateGapScore(startHint, first) : 0;
    const reverseStartScore = startHint ? coordinateGapScore(startHint, last) : 0;
    const forwardJoinScore = followingCoords.length > 0
        ? nearestEndpointGapScore(last, followingCoords)
        : 0;
    const reverseJoinScore = followingCoords.length > 0
        ? nearestEndpointGapScore(first, followingCoords)
        : 0;
    return reverseStartScore + reverseJoinScore < forwardStartScore + forwardJoinScore
        ? coords.slice().reverse()
        : coords;
}

function pathOverlapCount(target: RoutePathCoord[], coords: RoutePathCoord[]): number {
    const maximum = Math.min(target.length, coords.length);
    for (let length = maximum; length > 0; length -= 1) {
        const targetStart = target.length - length;
        const matches = coords
            .slice(0, length)
            .every((coord, index) => sameCoord(target[targetStart + index], coord));
        if (matches) return length;
    }
    return 0;
}

function appendContinuousCoords(target: RoutePathCoord[], coords: RoutePathCoord[]): void {
    if (coords.length === 0) return;
    if (target.length === 0) {
        appendCoords(target, coords);
        return;
    }

    const reversedCoords = coords.slice().reverse();
    const forwardOverlap = pathOverlapCount(target, coords);
    const reverseOverlap = pathOverlapCount(target, reversedCoords);
    const previous = target[target.length - 1];
    const forwardGap = coordinateGapScore(previous, coords[0]);
    const reverseGap = coordinateGapScore(previous, reversedCoords[0]);
    const orientedCoords = reverseOverlap > forwardOverlap ||
        (reverseOverlap === forwardOverlap && reverseGap < forwardGap)
        ? reversedCoords
        : coords;
    const overlap = orientedCoords === reversedCoords ? reverseOverlap : forwardOverlap;
    appendCoords(target, orientedCoords.slice(overlap));
}

function orientPathFromTo(
    pathCoords: RoutePathCoord[],
    from?: RoutePathCoord,
    to?: RoutePathCoord
): RoutePathCoord[] {
    if (pathCoords.length < 2 || (!from && !to)) return pathCoords;
    const first = pathCoords[0];
    const last = pathCoords[pathCoords.length - 1];
    const forwardScore = (from ? coordinateGapScore(from, first) : 0) +
        (to ? coordinateGapScore(last, to) : 0);
    const reverseScore = (from ? coordinateGapScore(from, last) : 0) +
        (to ? coordinateGapScore(first, to) : 0);
    return reverseScore < forwardScore ? pathCoords.slice().reverse() : pathCoords;
}

function assembleSingleWalkRoute(
    crossCoords: RoutePathCoord[],
    linkCoords: RoutePathCoord[],
    fromHint?: RoutePathCoord,
    toHint?: RoutePathCoord
): RoutePathCoord[] {
    if (crossCoords.length === 0) return orientPathFromTo(linkCoords, fromHint, toHint);
    if (linkCoords.length === 0) return orientPathFromTo(crossCoords, fromHint, toHint);

    const crossTouchesLinkStart = nearestEndpointGapScore(linkCoords[0], crossCoords);
    const crossTouchesLinkEnd = nearestEndpointGapScore(linkCoords[linkCoords.length - 1], crossCoords);
    const crossComesFirst = crossTouchesLinkStart <= crossTouchesLinkEnd;
    const assembleParts = (
        firstPart: RoutePathCoord[],
        secondPart: RoutePathCoord[]
    ): RoutePathCoord[] => {
        const result: RoutePathCoord[] = [];
        appendCoords(result, orientInitialCoords(firstPart, fromHint, secondPart));
        appendContinuousCoords(result, secondPart);
        return orientPathFromTo(result, fromHint, toHint);
    };
    const preferred = crossComesFirst
        ? assembleParts(crossCoords, linkCoords)
        : assembleParts(linkCoords, crossCoords);
    if (!fromHint && !toHint) return preferred;

    const alternate = crossComesFirst
        ? assembleParts(linkCoords, crossCoords)
        : assembleParts(crossCoords, linkCoords);
    const endpointScore = (coords: RoutePathCoord[]) => (
        (fromHint ? coordinateGapScore(fromHint, coords[0]) : 0) +
        (toHint ? coordinateGapScore(coords[coords.length - 1], toHint) : 0)
    );
    return endpointScore(alternate) < endpointScore(preferred) ? alternate : preferred;
}

function parseGraph(raw: unknown): RoutePathCoord[] {
    if (typeof raw !== "string") return [];
    return raw
        .split("|")
        .map((pair) => pair.trim().split(/\s+/))
        .map(([x, y]) => routeCoord(x, y))
        .filter((coord): coord is RoutePathCoord => !!coord);
}

/** ODsay 도보 RP의 링크 좌표를 순서대로 합쳐 화면용 실제 보행 선형을 만든다. */
function parseWalkPath(leg: any): RoutePathCoord[] {
    const routes = ensureArray<any>(leg?.routes)
        .map((route, originalIndex) => ({
            route,
            originalIndex,
            sequence: safeNumber(route?.rseq) ?? originalIndex,
        }))
        .sort((left, right) => left.sequence - right.sequence || left.originalIndex - right.originalIndex);
    if (routes.length === 0) return [];

    const routeParts = routes.map(({ route }) => ({
        crossCoords: parseCoordinateList(route?.crossXYInfos),
        linkCoords: parseCoordinateList(route?.xyInfos),
    }));
    const explicitFrom = routeCoord(leg?.startX, leg?.startY);
    const explicitTo = routeCoord(leg?.endX, leg?.endY);

    if (routeParts.length === 1) {
        return assembleSingleWalkRoute(
            routeParts[0].crossCoords,
            routeParts[0].linkCoords,
            explicitFrom,
            explicitTo
        );
    }

    const firstCrossCoords = routeParts[0].crossCoords;
    const lastCrossCoords = routeParts[routeParts.length - 1].crossCoords;
    const fromHint = explicitFrom ?? firstCrossCoords[0];
    const toHint = explicitTo ?? lastCrossCoords[lastCrossCoords.length - 1];
    const result: RoutePathCoord[] = [];

    routeParts.forEach(({ crossCoords, linkCoords }, index) => {
        const first = index === 0;
        const last = index === routeParts.length - 1;

        if (first) {
            const followingCoords = linkCoords.length > 0
                ? linkCoords
                : (routeParts[index + 1]?.linkCoords ?? routeParts[index + 1]?.crossCoords ?? []);
            if (crossCoords.length > 0) {
                appendCoords(result, orientInitialCoords(crossCoords, fromHint, followingCoords));
            }
            if (linkCoords.length > 0) {
                if (result.length === 0) {
                    appendCoords(result, orientInitialCoords(
                        linkCoords,
                        fromHint,
                        routeParts[index + 1]?.linkCoords ?? routeParts[index + 1]?.crossCoords ?? []
                    ));
                } else {
                    appendContinuousCoords(result, linkCoords);
                }
            }
            return;
        }

        if (last) {
            appendContinuousCoords(result, linkCoords.length > 0 ? linkCoords : crossCoords);
            if (linkCoords.length > 0) appendContinuousCoords(result, crossCoords);
            return;
        }

        // crossXYInfos는 출발/도착과 링크 사이의 terminal connector다. 중간 route는
        // 링크 좌표만 사용하되, 비정상 응답에서 xyInfos가 빠졌을 때만 cross를 보존한다.
        appendContinuousCoords(result, linkCoords.length > 0 ? linkCoords : crossCoords);
    });

    return orientPathFromTo(result, fromHint, toHint);
}

function normalizeLegKind(trafficType: unknown): TransitLegKind {
    const value = safeNumber(trafficType);
    if (value === 1) return "SUBWAY";
    if (value === 2) return "BUS";
    if (value === 3) return "WALK";
    return "ETC";
}

function normalizeHexColor(value: unknown): string | undefined {
    const raw = textValue(value);
    if (!raw) return undefined;
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toUpperCase();
    if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toUpperCase()}`;
    return undefined;
}

function normalizeExit(value: unknown): string | undefined {
    const raw = textValue(value);
    if (!raw) return undefined;
    return /^\d+$/u.test(raw) ? `${raw}번 출구` : raw;
}

function parseBoardingPlatform(stationName?: string): string | undefined {
    const value = stationName?.match(/\(([^()]*(?:승강장|플랫폼|홈)[^()]*)\)/u)?.[1];
    return value?.replace(/(\d+)\s*번\s*(승강장|플랫폼|홈)/u, "$1번 $2").trim() || undefined;
}

function parseStopCode(station: any): string | undefined {
    const arsId = textValue(station?.arsID ?? station?.arsId)?.replace(/\D/g, "");
    if (arsId && /^\d{5}$/.test(arsId)) return `ARS:${arsId}`;

    const cityCode = textValue(station?.stationCityCode ?? station?.cityCode);
    const localId = textValue(
        station?.localStationID ?? station?.stationID ?? station?.stationId
    );
    if (!localId) return undefined;
    return cityCode ? `${cityCode}:${localId}` : localId;
}

function parsePassStops(leg: any): TransitPassStop[] {
    const seen = new Set<string>();
    return ensureArray<any>(leg?.passStopList?.stations)
        .map((station, originalIndex) => ({
            station,
            originalIndex,
            sequence: safeNumber(station?.index) ?? originalIndex,
        }))
        .sort((left, right) => left.sequence - right.sequence || left.originalIndex - right.originalIndex)
        .map<TransitPassStop | undefined>(({ station }, index) => {
            const name = textValue(station?.stationName);
            if (!name) return undefined;
            const coord = routeCoord(station?.x, station?.y);
            const code = parseStopCode(station);
            const key = `${name}|${code ?? ""}|${coord?.lat ?? ""}|${coord?.lng ?? ""}`;
            if (seen.has(key)) return undefined;
            seen.add(key);
            return {
                name,
                sequence: index + 1,
                code,
                coord,
            };
        })
        .filter((stop): stop is TransitPassStop => !!stop);
}

function parseOdsayDateTime(value: unknown): string | undefined {
    const raw = textValue(value);
    const match = raw?.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
    if (!match) return undefined;
    const [, year, month, day, hour, minute] = match;
    const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+09:00`);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function formatOdsaySearchTime(date: Date): string {
    const koreaTime = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return [
        koreaTime.getUTCFullYear(),
        String(koreaTime.getUTCMonth() + 1).padStart(2, "0"),
        String(koreaTime.getUTCDate()).padStart(2, "0"),
        String(koreaTime.getUTCHours()).padStart(2, "0"),
        String(koreaTime.getUTCMinutes()).padStart(2, "0"),
    ].join("");
}

function lineNameForLeg(leg: any): string | undefined {
    const lane = ensureArray<any>(leg?.lane)[0];
    return textValue(lane?.name ?? lane?.busNo);
}

function subwayServiceClass(lineName: string | undefined): TransitServiceClass {
    if (!lineName) return "UNKNOWN";
    const hasExpressEvidence = /(급행|특급|ITX|EXPRESS)/i.test(lineName);
    const hasLocalEvidence = /(일반열차|\(일반\)|완행|LOCAL)/i.test(lineName);
    if (hasExpressEvidence && hasLocalEvidence) return "UNKNOWN";
    return hasExpressEvidence ? "EXPRESS" : "LOCAL";
}

function providerRouteIdForLeg(kind: TransitLegKind, lane: any): string | undefined {
    if (kind === "BUS") return textValue(lane?.busID ?? lane?.busId);
    if (kind !== "SUBWAY") return undefined;
    const routeParts = [
        textValue(lane?.subwayCityCode),
        textValue(lane?.subwayCode),
    ].filter((value): value is string => !!value);
    return routeParts.length > 0 ? routeParts.join(":") : undefined;
}

function buildLegLabel(leg: Pick<TransitLegDetail, "kind" | "lineName" | "durationMinutes" | "distanceMeters">): string {
    if (leg.kind === "WALK") {
        const distance = typeof leg.distanceMeters === "number" ? `${Math.round(leg.distanceMeters)}m` : undefined;
        const time = typeof leg.durationMinutes === "number" ? `${leg.durationMinutes}분` : undefined;
        return ["도보", distance, time].filter(Boolean).join(" · ");
    }
    const mode = leg.kind === "BUS" ? "버스" : leg.kind === "SUBWAY" ? "지하철" : "이동";
    return [mode, leg.lineName, leg.durationMinutes ? `${leg.durationMinutes}분` : undefined]
        .filter(Boolean)
        .join(" · ");
}

function parseLegs(rawLegs: unknown): TransitLegDetail[] {
    const legs = ensureArray<any>(rawLegs);
    return legs.map((leg, index) => {
        const kind = normalizeLegKind(leg?.trafficType);
        const lane = ensureArray<any>(leg?.lane)[0];
        const passStops = parsePassStops(leg);
        const graphPath = kind === "WALK" ? parseWalkPath(leg) : parseGraph(leg?.graph);
        const fallbackPath = passStops
            .map((stop) => stop.coord)
            .filter((coord): coord is RoutePathCoord => !!coord);
        const pathCoords = graphPath.length >= 2 ? graphPath : fallbackPath;
        const startCoord = routeCoord(leg?.startX, leg?.startY) ?? pathCoords[0];
        const endCoord = routeCoord(leg?.endX, leg?.endY) ?? pathCoords[pathCoords.length - 1];
        const startName = textValue(leg?.startName);
        const endName = textValue(leg?.endName);
        const lineName = lineNameForLeg(leg);
        // ODsay door는 별도의 승차칸/환승칸 값이 아니라, 다음 환승이나 하차를
        // 빠르게 할 수 있도록 현재 열차에서 타야 할 칸-문 위치를 뜻한다.
        const recommendation = textValue(leg?.door);
        const hasFollowingRide = legs
            .slice(index + 1)
            .some((nextLeg) => [1, 2].includes(safeNumber(nextLeg?.trafficType) ?? -1));
        const directionCode = safeNumber(leg?.wayCode) === 1
            ? "UP" as const
            : safeNumber(leg?.wayCode) === 2
                ? "DOWN" as const
                : undefined;
        const rawWaitingMinutes = safeNumber(leg?.waitingTime);
        const routeCityCode = kind === "BUS"
            ? textValue(lane?.busCityCode)
            : kind === "SUBWAY"
                ? textValue(lane?.subwayCityCode)
                : undefined;
        const detail: Omit<TransitLegDetail, "label"> = {
            kind,
            durationMinutes: safeNumber(leg?.duration),
            waitingMinutes: typeof rawWaitingMinutes === "number" && rawWaitingMinutes >= 0
                ? rawWaitingMinutes
                : undefined,
            providerRouteId: providerRouteIdForLeg(kind, lane),
            localRouteId: kind === "BUS" ? textValue(lane?.busLocalBlID) : undefined,
            routeCityCode,
            routeProviderCode: kind === "BUS" ? textValue(lane?.busProviderCode) : undefined,
            startDateTime: parseOdsayDateTime(leg?.startDateTime),
            endDateTime: parseOdsayDateTime(leg?.endDateTime),
            startID: textValue(leg?.startID ?? leg?.startId),
            startLocalStationID: textValue(leg?.startLocalStationID ?? leg?.startLocalStationId),
            startStationCityCode: textValue(leg?.startStationCityCode),
            startStationProviderCode: textValue(leg?.startStationProviderCode),
            startArsID: textValue(leg?.startArsID ?? leg?.startArsId),
            endID: textValue(leg?.endID ?? leg?.endId),
            endLocalStationID: textValue(leg?.endLocalStationID ?? leg?.endLocalStationId),
            endStationCityCode: textValue(leg?.endStationCityCode),
            endStationProviderCode: textValue(leg?.endStationProviderCode),
            endArsID: textValue(leg?.endArsID ?? leg?.endArsId),
            distanceMeters: safeNumber(leg?.distance),
            stationCount: safeNumber(leg?.stationCount) ?? (passStops.length > 1 ? passStops.length - 1 : undefined),
            lineName,
            serviceClass: kind === "SUBWAY" ? subwayServiceClass(lineName) : undefined,
            lineColor: normalizeHexColor(lane?.busLaneColor ?? lane?.color),
            directionName: textValue(leg?.way),
            directionCode,
            boardingPlatform: parseBoardingPlatform(startName),
            boardingExit: normalizeExit(leg?.startExitNo),
            recommendedBoardingPosition: recommendation,
            recommendedTransferPosition: hasFollowingRide ? recommendation : undefined,
            startName,
            endName,
            startCoord,
            endCoord,
            passStops: passStops.length ? passStops : undefined,
            pathCoords: pathCoords.length >= 2 ? pathCoords : undefined,
            pathCoordsIsExact: graphPath.length >= 2,
            pathGeometrySource: graphPath.length >= 2
                ? kind === "WALK" ? "WALK_STEPS_LINESTRING" : "TRANSIT_PASS_SHAPE_LINESTRING"
                : fallbackPath.length >= 2 ? "PASS_STOP_LIST" : "UNKNOWN",
            rawPathPointCount: pathCoords.length || undefined,
            serviceAvailable: kind === "BUS" || kind === "SUBWAY" ? true : undefined,
        };
        return { ...detail, label: buildLegLabel(detail) };
    });
}

function buildOptionPath(legs: TransitLegDetail[]): RoutePathCoord[] | undefined {
    const result: RoutePathCoord[] = [];
    legs.forEach((leg) => appendCoords(result, leg.pathCoords ?? []));
    return result.length >= 2 ? result : undefined;
}

function buildModeSummary(legs: TransitLegDetail[]): string | undefined {
    const values = legs
        .filter((leg) => leg.kind === "BUS" || leg.kind === "SUBWAY")
        .map((leg) => leg.lineName ?? (leg.kind === "BUS" ? "버스" : "지하철"));
    return values.length ? values.join(" → ") : undefined;
}

function buildStepSummary(legs: TransitLegDetail[]): string | undefined {
    const values = legs.map((leg) => leg.label).filter(Boolean);
    return values.length ? values.join(" → ") : undefined;
}

export function parseTransitOptionsFromOdsay(data: any): TransitRouteOption[] {
    const paths = ensureArray<any>(data?.result?.paths).filter((path) => safeNumber(path?.pathType) === 2);
    return paths
        .map((path, index) => {
            const minutes = safeNumber(path?.totalTime);
            if (typeof minutes !== "number" || minutes <= 0) return undefined;

            const transitLegs = parseLegs(path?.rps);
            const rideCount = transitLegs.filter((leg) => leg.kind === "BUS" || leg.kind === "SUBWAY").length;
            const walkMeters = transitLegs
                .filter((leg) => leg.kind === "WALK")
                .reduce((sum, leg) => sum + (leg.distanceMeters ?? 0), 0);
            const pathCoords = buildOptionPath(transitLegs);
            const option: TransitRouteOption = {
                id: `odsay-transit-${index}-${Math.round(minutes)}-${rideCount}`,
                minutes: Math.max(1, Math.round(minutes)),
                distanceMeters: safeNumber(path?.totalDistance),
                transferCount: Math.max(0, rideCount - 1),
                walkMeters: Math.round(walkMeters),
                fareWon: safeNumber(path?.totalPayment),
                stepSummary: buildStepSummary(transitLegs),
                transitModeSummary: buildModeSummary(transitLegs),
                transitLegs,
                pathCoords,
                source: "api",
                provider: "odsay",
                providerDepartureAt: parseOdsayDateTime(path?.startDateTime),
                providerArrivalAt: parseOdsayDateTime(path?.endDateTime),
                attributionText: "ODsay",
                attributionUrl: ODSAY_ATTRIBUTION_URL,
            };
            return option;
        })
        .filter((option): option is TransitRouteOption => !!option)
        .sort((left, right) => left.minutes - right.minutes);
}

function responseError(data: any): Error | undefined {
    const error = data?.result?.error ?? data?.error;
    if (!error) return undefined;
    const code = textValue(error?.code);
    const message = textValue(error?.msg ?? error?.message) ?? "대중교통 경로를 찾지 못했어요.";
    return new Error(code ? `${message} (${code})` : message);
}

export function odsayApiErrorMessage(error: unknown): string {
    if (!axios.isAxiosError(error)) {
        return error instanceof Error ? error.message : "알 수 없는 오류";
    }
    const apiError = responseError(error.response?.data);
    if (apiError) return apiError.message;
    return error.message || "대중교통 경로를 불러오지 못했어요.";
}

/** 플랫폼에 등록된 모바일 키로 시간표 기반 정밀 대중교통 경로를 조회한다. */
export async function getOdsayTransitRouteOptions(
    origin: Place,
    destination: Place,
    departureAt = new Date()
): Promise<TransitRouteOption[]> {
    const apiKey = resolveOdsayApiKey();
    if (!apiKey) throw new Error("대중교통 경로를 지금 사용할 수 없어요. 잠시 후 다시 시도해 주세요.");

    const response = await axios.get(`${ODSAY_API_BASE_URL}/maasRP`, {
        timeout: ODSAY_REQUEST_TIMEOUT_MS,
        params: {
            apiKey,
            SX: origin.lng,
            SY: origin.lat,
            EX: destination.lng,
            EY: destination.lat,
            SearchTime: formatOdsaySearchTime(departureAt),
            SearchMethod: 2,
            lang: 0,
            output: "json",
        },
    });
    const apiError = responseError(response.data);
    if (apiError) throw apiError;
    return parseTransitOptionsFromOdsay(response.data);
}
