import type {
    TravelMode,
} from "../schedule/types";

import {
    safeNumber,
    clampPathCoords,
    dedupePathCoords,
    normalizeTransitLegDurationToMinutes,
    formatDistanceMetersCompact,
    ROUTE_ALTERNATIVE_LIMIT_BY_MODE,
} from "./tmapApiCore.ts";
import { parseTransitPathCoords } from "./tmapRoadResponse";
import type {
    RoutePathCoord,
    TransitLegKind,
    TransitGeometrySource,
    TransitLegDetail,
    RouteAlternativeOption,
} from "./tmapApiCore.ts";
import {
    normalizeTransitLegKind,
    parseTransitLegLineName,
    parseTransitLegLineColor,
    parseTransitLegServiceAvailable,
    parseTransitLegStationCount,
    parseTransitLegStartName,
    parseTransitLegEndName,
    parseTransitLegDirectionName,
    parseTransitLegBoardingPlatform,
    parseTransitLegBoardingExit,
    parseTransitLegRecommendedBoardingPosition,
    parseTransitLegPassStops,
    parseTransitLegStationPath,
    parseTransitLegStartCoord,
    parseTransitLegEndCoord,
} from "./tmapTransitFields.ts";

/** TMAP 경로 처리의 `squaredDistance` 계산 단계를 독립적으로 수행합니다. */
export function squaredDistance(a: RoutePathCoord, b: RoutePathCoord): number {
    const dLat = a.lat - b.lat;
    const dLng = a.lng - b.lng;
    return (dLat * dLat) + (dLng * dLng);
}

/** TMAP 경로 처리의 `findNearestPathIndex` 계산 단계를 독립적으로 수행합니다. */
export function findNearestPathIndex(
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

/** TMAP 경로 처리의 `snapTransitLegPathFromItinerary` 계산 단계를 독립적으로 수행합니다. */
export function snapTransitLegPathFromItinerary(
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

/** 공급자 원본 값을 `parseTransitStepsLinestring` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitStepsLinestring(leg: any): RoutePathCoord[] | undefined {
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

/** 공급자 원본 값을 `parseTransitDirectPathCoords` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitDirectPathCoords(leg: any): RoutePathCoord[] | undefined {
    return parseTransitPathCoords(
        leg?.passShape?.linestring ??
        leg?.passShape?.coordinates ??
        leg?.shape ??
        leg?.path ??
        leg?.geometry
    );
}

/** 공급자 원본 값을 `parseTransitLegPathGeometry` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitLegPathGeometry(
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

/** 정규화된 경로 데이터를 조합해 `buildTransitLegLabel` 결과를 생성합니다. */
export function buildTransitLegLabel(detail: Omit<TransitLegDetail, "label">): string {
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

/** 공급자 원본 값을 `parseTransitLegDetails` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function parseTransitLegDetails(legs: unknown, itineraryPath?: RoutePathCoord[]): TransitLegDetail[] {
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

/** 정규화된 경로 데이터를 조합해 `buildTransitModeSummary` 결과를 생성합니다. */
export function buildTransitModeSummary(transitLegs: TransitLegDetail[]): string | undefined {
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

/** 정규화된 경로 데이터를 조합해 `buildAlternativeId` 결과를 생성합니다. */
export function buildAlternativeId(prefix: string, index: number): string {
    return `${prefix}-${index}`;
}

/** 정규화된 경로 데이터를 조합해 `buildRoutePathSignature` 결과를 생성합니다. */
export function buildRoutePathSignature(pathCoords?: RoutePathCoord[]): string | undefined {
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

/** 공급자 원본 값을 `dedupeRouteAlternatives` 규칙으로 검증·정규화하고 잘못된 항목은 안전하게 제외합니다. */
export function dedupeRouteAlternatives(items: RouteAlternativeOption[]): RouteAlternativeOption[] {
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

/** TMAP 경로 처리의 `limitAlternativesByMode` 계산 단계를 독립적으로 수행합니다. */
export function limitAlternativesByMode(mode: TravelMode, items: RouteAlternativeOption[]): RouteAlternativeOption[] {
    const limit = ROUTE_ALTERNATIVE_LIMIT_BY_MODE[mode] ?? 5;
    return items.slice(0, limit);
}
