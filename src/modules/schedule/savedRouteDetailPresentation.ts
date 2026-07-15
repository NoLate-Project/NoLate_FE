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
