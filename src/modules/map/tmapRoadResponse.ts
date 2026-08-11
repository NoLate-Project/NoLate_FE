import {
    warnMapDebug,
    safeNumber,
    isWgs84Coordinate,
    clampPathCoords,
    dedupePathCoords,
    normalizeRoadTimeToMinutes,
} from "./tmapApiCore.ts";
import type {
    RoutePathCoord,
    RouteGuideStep,
    RouteTrafficLevel,
    RouteTrafficSection,
    TransitLegDetail,
    ParsedRoadRoute,
} from "./tmapApiCore.ts";

/** 공급자 원본 값을 `parseLatLngPair` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseLatLngPair(value: unknown): RoutePathCoord | null {
    if (!Array.isArray(value) || value.length < 2) return null;
    const lng = safeNumber(value[0]);
    const lat = safeNumber(value[1]);
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    return { lat, lng };
}

/** 공급자 원본 값을 `collectPathCoords` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function collectPathCoords(raw: unknown, bucket: RoutePathCoord[]) {
    const pair = parseLatLngPair(raw);
    if (pair) {
        bucket.push(pair);
        return;
    }
    if (!Array.isArray(raw)) return;
    raw.forEach((item) => collectPathCoords(item, bucket));
}

/** 공급자 원본 값을 `parsePathFromTmapFeatureCollection` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parsePathFromTmapFeatureCollection(data: any): RoutePathCoord[] | undefined {
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

/** 공급자 원본 값을 `normalizeRoadSegmentTimeToMinutes` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function normalizeRoadSegmentTimeToMinutes(secondsRaw: unknown): number | undefined {
    const seconds = safeNumber(secondsRaw);
    if (typeof seconds !== "number" || seconds < 0) return undefined;
    return seconds / 60;
}

/** 공급자 원본 값을 `normalizeTrafficLevel` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function normalizeTrafficLevel(rawStatus: unknown): RouteTrafficLevel {
    const status = safeNumber(rawStatus);
    if (status === 1) return "smooth";
    if (status === 2) return "slow";
    if (status === 3) return "congested";
    return "unknown";
}

/** 공급자 원본 값을 `parseFeaturePathCoords` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseFeaturePathCoords(feature: any): RoutePathCoord[] | undefined {
    const coords: RoutePathCoord[] = [];
    collectPathCoords(feature?.geometry?.coordinates, coords);
    if (coords.length < 2) return undefined;
    return clampPathCoords(dedupePathCoords(coords));
}

/** 공급자 원본 값을 `parseTrafficSectionsFromFeature` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTrafficSectionsFromFeature(feature: any, pathCoords?: RoutePathCoord[]): RouteTrafficSection[] {
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

/** 공급자 원본 값을 `normalizeInstruction` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function normalizeInstruction(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized || undefined;
}

/** 공급자 원본 값을 `parseRoadRouteDetails` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseRoadRouteDetails(data: any): Pick<ParsedRoadRoute, "guideSteps" | "trafficSections"> {
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

/** 공급자 원본 값을 `parseTmapRoadRouteResponse` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
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

/** 공급자 원본 값을 `parseLineString` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
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

/** 공급자 원본 값을 `parseTransitPathCoords` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitPathCoords(raw: unknown): RoutePathCoord[] | undefined {
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

/** 공급자 원본 값을 `parseTransitStepSummary` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitStepSummary(transitLegs: TransitLegDetail[]): string | undefined {
    if (!transitLegs.length) return undefined;
    const stepLabels = transitLegs
        .map((leg) => leg.label)
        .filter((value) => typeof value === "string" && value.trim().length > 0);
    if (!stepLabels.length) return undefined;
    return stepLabels.slice(0, 4).join(" → ");
}

/** 공급자 원본 값을 `parseTransitItineraryPath` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitItineraryPath(itinerary: any): RoutePathCoord[] | undefined {
    // 구간별 정류장 목록을 전체 상세 path로 승격하면 직선 정류장 선형이 도로 형상으로 오인된다.
    // itinerary.path가 공급자에게서 직접 내려온 경우에만 구간 스냅 복구에 사용한다.
    return parseTransitPathCoords(itinerary?.path);
}

/** 정규화된 경로 데이터를 조합해 `buildTransitOptionPath` 결과를 생성합니다. */
export function buildTransitOptionPath(transitLegs: TransitLegDetail[]): RoutePathCoord[] | undefined {
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
