import { getRouteInfoFromRoute, isRouteInfo, type RouteInfo } from "./routeInfo";
import { hasRenderableSavedRouteGeometry } from "../map/savedRouteMapPresentation";
import type { Place } from "./types";

const DEFAULT_ROUTE_ESTIMATE_MINUTES = 60;
const MAX_ROUTE_ESTIMATE_MINUTES = 6 * 60;

export type ScheduleRouteDepartureContext = {
    departureAt: Date;
    targetArrivalAt?: Date;
    scheduleBased: boolean;
};

export type SelectedRouteTimingInfo = {
    totalDurationMinutes?: number;
    departureTime?: string;
    arrivalTime?: string;
    timeBasis?: "provider_schedule" | "estimated";
};

export type SelectedRouteTiming = {
    departureAt: Date;
    arrivalAt: Date;
    source: "provider_schedule" | "schedule_arrival" | "route_info" | "fallback";
};

export type ReconciledScheduleRouteTiming = {
    departAt?: string;
    route: unknown;
};

/**
 * 이동수단 기본값만 남은 일정은 실제 경로로 취급하지 않는다. 저장 가능한 경로는
 * 경로 데이터와 양수 소요시간을 함께 가져야 상세 화면에서 수단·안내선을 일관되게 표시한다.
 */
export function hasPersistableScheduleRoute(
    route: unknown,
    travelMinutes?: number,
    origin?: Place,
    destination?: Place
) {
    if (route === undefined || route === null) return false;
    const routeInfo = getRouteInfoFromRoute(route);
    const durationMinutes = normalizeSelectedTravelMinutes(travelMinutes)
        ?? normalizeSelectedTravelMinutes(routeInfo?.totalDurationMinutes);
    return durationMinutes !== undefined
        && hasRenderableSavedRouteGeometry(route, origin, destination);
}

function normalizeTravelMinutes(value?: number): number {
    if (!Number.isFinite(value) || !value || value <= 0) {
        return DEFAULT_ROUTE_ESTIMATE_MINUTES;
    }
    return Math.min(Math.round(value), MAX_ROUTE_ESTIMATE_MINUTES);
}

function parseValidDate(value?: string | Date): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value instanceof Date ? value.getTime() : value);
    return Number.isFinite(date.getTime()) ? date : undefined;
}

function normalizeSelectedTravelMinutes(value?: number): number | undefined {
    if (!Number.isFinite(value) || !value || value <= 0) return undefined;
    return Math.round(value);
}

/**
 * 일정 경로는 "지금 출발"이 아니라 일정 시작 시각에 도착하도록 조회한다.
 * 첫 조회는 60분을 가정하고, 경로 후보를 받은 뒤 실제 소요시간으로 한 번 더
 * 호출하면 도착 시각에 가까운 운행 정보를 얻을 수 있다.
 */
export function resolveScheduleRouteDepartureContext(
    targetArrivalAt?: string,
    estimatedTravelMinutes?: number,
    now = new Date()
): ScheduleRouteDepartureContext {
    const safeNow = Number.isFinite(now.getTime()) ? new Date(now) : new Date();
    safeNow.setSeconds(0, 0);

    if (!targetArrivalAt) {
        return { departureAt: safeNow, scheduleBased: false };
    }

    const arrivalAt = new Date(targetArrivalAt);
    if (!Number.isFinite(arrivalAt.getTime()) || arrivalAt.getTime() <= safeNow.getTime()) {
        return { departureAt: safeNow, scheduleBased: false };
    }

    const departureAt = new Date(
        arrivalAt.getTime() - normalizeTravelMinutes(estimatedTravelMinutes) * 60 * 1000
    );
    departureAt.setSeconds(0, 0);

    if (departureAt.getTime() <= safeNow.getTime()) {
        return { departureAt: safeNow, targetArrivalAt: arrivalAt, scheduleBased: false };
    }

    return {
        departureAt,
        targetArrivalAt: arrivalAt,
        scheduleBased: true,
    };
}

/**
 * 최종 선택 경로를 저장할 때 사용할 출·도착 시각을 한 번에 확정한다.
 *
 * 공급자 시간표가 있으면 실제 운행 시각을 보존한다. 시간표가 없는 경로는 이동수단과
 * 관계없이 선택된 경로의 실제 소요시간을 일정 도착 시각에서 빼서 출발 시각을 계산한다.
 * 이 결과를 top-level departAt과 저장 routeInfo에 함께 사용하면 두 값이 어긋나지 않는다.
 */
export function resolveSelectedRouteTiming({
    targetArrivalAt,
    routeInfo,
    fallbackDepartureAt,
    now = new Date(),
}: {
    targetArrivalAt?: string;
    routeInfo?: SelectedRouteTimingInfo;
    fallbackDepartureAt?: string | Date;
    now?: Date;
}): SelectedRouteTiming {
    const routeDepartureAt = parseValidDate(routeInfo?.departureTime);
    const routeArrivalAt = parseValidDate(routeInfo?.arrivalTime);
    if (
        routeInfo?.timeBasis === "provider_schedule" &&
        routeDepartureAt &&
        routeArrivalAt &&
        routeArrivalAt.getTime() >= routeDepartureAt.getTime()
    ) {
        return {
            departureAt: routeDepartureAt,
            arrivalAt: routeArrivalAt,
            source: "provider_schedule",
        };
    }

    const safeNow = Number.isFinite(now.getTime()) ? new Date(now) : new Date();
    safeNow.setSeconds(0, 0);
    const arrivalTarget = parseValidDate(targetArrivalAt);
    const travelMinutes = normalizeSelectedTravelMinutes(routeInfo?.totalDurationMinutes);
    if (arrivalTarget && arrivalTarget.getTime() > safeNow.getTime() && travelMinutes) {
        const calculatedDepartureAt = new Date(
            arrivalTarget.getTime() - travelMinutes * 60 * 1000
        );
        calculatedDepartureAt.setSeconds(0, 0);
        const departureAt = calculatedDepartureAt.getTime() > safeNow.getTime()
            ? calculatedDepartureAt
            : safeNow;
        return {
            departureAt,
            arrivalAt: new Date(departureAt.getTime() + travelMinutes * 60 * 1000),
            source: "schedule_arrival",
        };
    }

    if (routeDepartureAt) {
        const arrivalAt = travelMinutes
            ? new Date(routeDepartureAt.getTime() + travelMinutes * 60 * 1000)
            : routeArrivalAt ?? routeDepartureAt;
        return {
            departureAt: routeDepartureAt,
            arrivalAt,
            source: "route_info",
        };
    }

    const fallback = parseValidDate(fallbackDepartureAt) ?? safeNow;
    const arrivalAt = travelMinutes
        ? new Date(fallback.getTime() + travelMinutes * 60 * 1000)
        : fallback;
    return {
        departureAt: fallback,
        arrivalAt,
        source: "fallback",
    };
}

/**
 * 경로를 선택한 뒤 일정 시작 시각이 바뀐 경우 저장 시각을 새 도착 기준에 맞춘다.
 * 공간 geometry는 유지하되, 더 이상 유효하지 않은 공급자 시간표 표시는 estimated로
 * 내린다. 시작 시각이 그대로라면 공급자가 준 실제 시간표와 객체 참조를 보존한다.
 */
export function reconcileScheduleRouteTiming({
    departAt,
    route,
    travelMinutes,
    plannedArrivalAt,
    nextArrivalAt,
}: {
    departAt?: string;
    route: unknown;
    travelMinutes?: number;
    plannedArrivalAt?: string | Date;
    nextArrivalAt: string | Date;
}): ReconciledScheduleRouteTiming {
    const plannedArrival = parseValidDate(plannedArrivalAt);
    const nextArrival = parseValidDate(nextArrivalAt);
    if (
        !plannedArrival ||
        !nextArrival ||
        plannedArrival.getTime() === nextArrival.getTime()
    ) {
        return { departAt, route };
    }

    const routeInfo = getRouteInfoFromRoute(route);
    const durationMinutes = normalizeSelectedTravelMinutes(routeInfo?.totalDurationMinutes)
        ?? normalizeSelectedTravelMinutes(travelMinutes);
    if (!durationMinutes) {
        // 계산 근거가 없으면 과거 시각을 새 일정에 잘못 붙이는 것보다 비우는 편이 안전하다.
        return { departAt: undefined, route };
    }

    const nextDeparture = new Date(nextArrival.getTime() - durationMinutes * 60 * 1000);
    const nextDepartureAt = nextDeparture.toISOString();
    if (!routeInfo) return { departAt: nextDepartureAt, route };

    const nextRouteInfo: RouteInfo = {
        ...routeInfo,
        departureTime: nextDepartureAt,
        arrivalTime: nextArrival.toISOString(),
        timeBasis: "estimated",
    };
    if (isRouteInfo(route)) {
        return { departAt: nextDepartureAt, route: nextRouteInfo };
    }

    if (route && typeof route === "object" && !Array.isArray(route)) {
        return {
            departAt: nextDepartureAt,
            route: {
                ...(route as Record<string, unknown>),
                providerDepartureAt: undefined,
                providerArrivalAt: undefined,
                routeInfo: nextRouteInfo,
            },
        };
    }

    return { departAt: nextDepartureAt, route };
}
