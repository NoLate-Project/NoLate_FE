import type { RouteAlternativeOption } from "../map/routingService";
import type { Place } from "./types";
import {
    buildRouteInfoFromAlternative,
    getRouteInfoFromRoute,
    type RouteInfo,
    type RouteStep,
} from "./routeInfo";

type Input = {
    route: unknown;
    routeAlternative?: RouteAlternativeOption;
    origin?: Place;
    destination?: Place;
    departureAt?: Date;
};

export type SavedRouteSummaryKind = "detailed" | "duration_only" | "none";
export type SavedRouteEntryPath = "/schedule/route-planner" | "/schedule/route-select";
export type ScheduleDetailLayout = "route" | "plain";
export type ScheduleDetailLayoutInput = {
    routeSummaryKind: SavedRouteSummaryKind;
    routeSetupRequired?: boolean;
};

function hasFiniteCoordinatePair(place?: Place): boolean {
    return typeof place?.lat === "number" &&
        Number.isFinite(place.lat) &&
        place.lat >= -90 &&
        place.lat <= 90 &&
        typeof place.lng === "number" &&
        Number.isFinite(place.lng) &&
        place.lng >= -180 &&
        place.lng <= 180;
}

/** 상세 경로와 단순 이동 시간 추정치를 같은 상태로 표시하지 않는다. */
export function getSavedRouteSummaryKind(
    hasDetailedRoute: boolean,
    travelMinutes?: number
): SavedRouteSummaryKind {
    if (hasDetailedRoute) return "detailed";
    if (typeof travelMinutes === "number" && Number.isFinite(travelMinutes) && travelMinutes > 0) {
        return "duration_only";
    }
    return "none";
}

/**
 * 경로 설정 필요 여부는 최초 자동 진입만 결정한다.
 * 사용자가 설정 화면을 닫았을 때 실제 저장된 경로가 없으면 일반 일정 상세를 보여준다.
 */
export function getScheduleDetailLayout(
    { routeSummaryKind }: ScheduleDetailLayoutInput
): ScheduleDetailLayout {
    return routeSummaryKind === "none" ? "plain" : "route";
}

/** 저장된 상세 경로와 화면에 맞출 실제 좌표가 모두 있을 때만 지도 SDK를 띄운다. */
export function shouldRenderScheduleDetailMap(
    hasDetailedRoute: boolean,
    mapCoordinateCount: number
): boolean {
    return hasDetailedRoute && Number.isFinite(mapCoordinateCount) && mapCoordinateCount >= 2;
}

/**
 * 저장된 상세 경로와 유효한 양 끝점이 있으면 바로 지도 상세를 연다.
 * 그 외에는 검색·후보 선택 화면에서 누락된 지점을 채우고 경로를 새로 고르게 한다.
 */
export function getSavedRouteEntryPath(
    hasDetailedRoute: boolean,
    origin?: Place,
    destination?: Place
): SavedRouteEntryPath {
    return hasDetailedRoute && hasFiniteCoordinatePair(origin) && hasFiniteCoordinatePair(destination)
        ? "/schedule/route-planner"
        : "/schedule/route-select";
}

function isEndpointStep(step: RouteStep): boolean {
    return step.type === "ORIGIN" || step.type === "DESTINATION";
}

function hasItems<T>(items?: T[]): items is T[] {
    return Array.isArray(items) && items.length > 0;
}

function validDate(value?: Date | string): Date | undefined {
    if (!value) return undefined;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : undefined;
}

function applyDepartureTime(routeInfo: RouteInfo, departureAt: Date): RouteInfo {
    return {
        ...routeInfo,
        departureTime: departureAt.toISOString(),
        arrivalTime: new Date(
            departureAt.getTime() + (Math.max(0, routeInfo.totalDurationMinutes) * 60 * 1000)
        ).toISOString(),
    };
}

function mergeStep(generated: RouteStep, stored?: RouteStep): RouteStep {
    if (!stored) return generated;
    return {
        ...generated,
        ...stored,
        coordinates: hasItems(stored.coordinates) ? stored.coordinates : generated.coordinates,
        passStops: hasItems(stored.passStops) ? stored.passStops : generated.passStops,
    };
}

function mergeStoredSteps(generated: RouteStep[], stored: RouteStep[]): RouteStep[] {
    const generatedTravelSteps = generated.filter((step) => !isEndpointStep(step));
    const storedTravelSteps = stored.filter((step) => !isEndpointStep(step));

    // 저장된 정규화 경로의 단계 수가 다르면 공급자 상세를 임의로 재정렬하지 않는다.
    if (generatedTravelSteps.length !== storedTravelSteps.length) return stored;

    let travelIndex = 0;
    return generated.map((step) => {
        if (step.type === "ORIGIN") {
            return mergeStep(step, stored.find((candidate) => candidate.type === "ORIGIN"));
        }
        if (step.type === "DESTINATION") {
            return mergeStep(step, stored.find((candidate) => candidate.type === "DESTINATION"));
        }
        const storedStep = storedTravelSteps[travelIndex];
        travelIndex += 1;
        return mergeStep(step, storedStep);
    });
}

/** 저장 당시 공급자 상세와 현재 타임라인 모델을 결합해 일정 상세의 낡은 표현을 제거한다. */
export function buildSavedRouteDetailInfo({
    route,
    routeAlternative,
    origin,
    destination,
    departureAt,
}: Input): RouteInfo | undefined {
    const stored = getRouteInfoFromRoute(route);
    const requestedDepartureAt = validDate(departureAt);
    if (!routeAlternative) {
        return stored && requestedDepartureAt
            ? applyDepartureTime(stored, requestedDepartureAt)
            : stored;
    }

    const effectiveDepartureAt = requestedDepartureAt
        ?? validDate(stored?.departureTime)
        ?? new Date();
    const generated = buildRouteInfoFromAlternative(
        routeAlternative,
        origin,
        destination,
        effectiveDepartureAt
    );
    if (!stored) return generated;

    const totalDurationMinutes = Number.isFinite(stored.totalDurationMinutes)
        ? stored.totalDurationMinutes
        : generated.totalDurationMinutes;
    const arrivalAt = new Date(
        effectiveDepartureAt.getTime() + (Math.max(0, totalDurationMinutes) * 60 * 1000)
    );

    return {
        ...generated,
        ...stored,
        originName: generated.originName,
        destinationName: generated.destinationName,
        totalDurationMinutes,
        departureTime: effectiveDepartureAt.toISOString(),
        arrivalTime: arrivalAt.toISOString(),
        steps: mergeStoredSteps(generated.steps, stored.steps),
    };
}
