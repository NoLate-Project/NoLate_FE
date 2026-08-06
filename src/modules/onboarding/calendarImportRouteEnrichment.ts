import type { SchedulePayload } from "../../api/schedule";
import type { RouteAlternativeOption, RoutePathCoord } from "../map/routingService";
import { buildRouteInfoFromAlternative } from "../schedule/routeInfo";
import type { Place } from "../schedule/types";
import {
    buildSchedulePayloadFromCandidate,
    type CalendarImportSettings,
    type DeviceCalendarCandidate,
} from "./deviceCalendarImport";

export type CalendarRouteHintSource = "calendar_location" | "notes" | "title";

export type CalendarRouteHints = {
    originQuery?: string;
    destinationQuery?: string;
    originSource?: CalendarRouteHintSource;
    destinationSource?: CalendarRouteHintSource;
};

export type CalendarRouteEnrichmentFailure =
    | "not_eligible"
    | "missing_default_origin"
    | "missing_destination"
    | "destination_not_resolved"
    | "route_not_found";

export type CalendarRouteEnrichmentResult = {
    payload: SchedulePayload;
    routePrepared: boolean;
    hints: CalendarRouteHints;
    failure?: CalendarRouteEnrichmentFailure;
};

export type CalendarRouteEnrichmentDependencies = {
    resolvePlace: (query: string, center?: RoutePathCoord) => Promise<Place | undefined>;
    findRoutes: (
        origin: Place,
        destination: Place,
        settings: CalendarImportSettings,
        departureAt: Date
    ) => Promise<RouteAlternativeOption[]>;
};

/** Optional route enrichment is ready only after the user has a usable origin. */
export function shouldPrepareCalendarImportRoutes(
    routePreparationRequested: boolean,
    defaultOriginReady: boolean,
): boolean {
    return routePreparationRequested && defaultOriginReady;
}

const MAX_PLACE_QUERY_LENGTH = 100;
const ROUTE_ARROW_PATTERN = /\s*(?:-{1,2}>|→|➡|➜|⇒)\s*/;
const URL_PATTERN = /(?:https?:\/\/|www\.|zoom\.us|meet\.google\.com)/i;

/**
 * 캘린더의 구조화된 장소와 메모를 조합해 경로 검색용 문자열만 추출한다.
 * 일반 제목 전체를 목적지로 간주하지 않고, 라벨이나 이동 표현이 명시된 경우만 사용해
 * "팀 회의" 같은 제목이 장소 검색으로 잘못 전달되는 것을 막는다.
 */
export function extractCalendarRouteHints(candidate: DeviceCalendarCandidate): CalendarRouteHints {
    const notes = normalizeCalendarText(candidate.notes);
    const title = normalizeCalendarText(candidate.title);
    const location = cleanPlaceQuery(candidate.locationName);
    const labeledOrigin = extractLabeledPlace(notes, ["출발지", "출발 장소", "출발", "from"]);
    const labeledDestination = extractLabeledPlace(notes, ["도착지", "도착 장소", "목적지", "도착", "to"]);
    const notesRoute = extractRouteExpression(notes);
    const titleRoute = extractRouteExpression(title);

    const originQuery = labeledOrigin ?? notesRoute?.origin ?? titleRoute?.origin;
    const destinationQuery = location ?? labeledDestination ?? notesRoute?.destination ?? titleRoute?.destination;

    return {
        originQuery,
        destinationQuery,
        originSource: labeledOrigin || notesRoute?.origin
            ? "notes"
            : titleRoute?.origin ? "title" : undefined,
        destinationSource: location
            ? "calendar_location"
            : labeledDestination || notesRoute?.destination
                ? "notes"
                : titleRoute?.destination ? "title" : undefined,
    };
}

/**
 * 추출한 장소를 좌표로 확정하고 공급자 경로를 하나 선택한다.
 * 어느 단계든 실패하면 기존 일정 payload를 그대로 돌려줘 가져오기 자체는 계속된다.
 */
export async function enrichCalendarCandidateWithRoute(
    candidate: DeviceCalendarCandidate,
    settings: CalendarImportSettings,
    defaultOrigin: Place | undefined,
    dependencies: CalendarRouteEnrichmentDependencies
): Promise<CalendarRouteEnrichmentResult> {
    const fallbackPayload = buildSchedulePayloadFromCandidate(candidate, settings);
    const hints = extractCalendarRouteHints(candidate);
    const startDate = new Date(candidate.startAt);
    const eligible = settings.prepareDepartureAlert &&
        !candidate.allDay &&
        settings.travelMinutes > 0 &&
        Number.isFinite(startDate.getTime()) &&
        startDate.getTime() > Date.now();

    if (!eligible) {
        return { payload: fallbackPayload, routePrepared: false, hints, failure: "not_eligible" };
    }
    if (!hasCoordinates(defaultOrigin)) {
        return { payload: fallbackPayload, routePrepared: false, hints, failure: "missing_default_origin" };
    }
    if (!hints.destinationQuery) {
        return { payload: fallbackPayload, routePrepared: false, hints, failure: "missing_destination" };
    }

    const defaultCenter = { lat: defaultOrigin.lat, lng: defaultOrigin.lng };
    let origin = defaultOrigin;
    if (hints.originQuery && !placeMatchesQuery(defaultOrigin, hints.originQuery)) {
        try {
            const resolvedOrigin = await dependencies.resolvePlace(hints.originQuery, defaultCenter);
            if (hasCoordinates(resolvedOrigin)) origin = resolvedOrigin;
        } catch {
            // 메모 속 출발지 해석이 실패하면 사용자가 지정한 공통 출발지를 안전하게 사용한다.
        }
    }

    let destination: Place | undefined;
    try {
        destination = await dependencies.resolvePlace(hints.destinationQuery, {
            lat: origin.lat,
            lng: origin.lng,
        });
    } catch {
        return { payload: fallbackPayload, routePrepared: false, hints, failure: "destination_not_resolved" };
    }
    if (!hasCoordinates(destination)) {
        return { payload: fallbackPayload, routePrepared: false, hints, failure: "destination_not_resolved" };
    }

    const estimatedDepartureAt = new Date(startDate.getTime() - settings.travelMinutes * 60_000);
    let routes: RouteAlternativeOption[];
    try {
        routes = await dependencies.findRoutes(origin, destination, settings, estimatedDepartureAt);
    } catch {
        return { payload: fallbackPayload, routePrepared: false, hints, failure: "route_not_found" };
    }

    const selectedRoute = selectFastestUsableRoute(routes);
    if (!selectedRoute || typeof selectedRoute.minutes !== "number") {
        return { payload: fallbackPayload, routePrepared: false, hints, failure: "route_not_found" };
    }

    const travelMinutes = Math.max(1, Math.ceil(selectedRoute.minutes));
    const departAt = new Date(startDate.getTime() - travelMinutes * 60_000);
    const routeInfo = buildRouteInfoFromAlternative(selectedRoute, origin, destination, departAt);

    return {
        payload: {
            ...fallbackPayload,
            travelMinutes,
            departAt: departAt.toISOString(),
            travelMode: settings.travelMode,
            origin,
            destination,
            locationName: `${displayPlace(origin, "출발지")} → ${displayPlace(destination, "도착지")}`,
            // 다른 경로 선택 흐름과 같은 저장 형식을 사용해 상세 지도에서 provider geometry를
            // 그대로 복원할 수 있게 한다. routeInfo는 타임라인/알림 표시용으로 함께 보존한다.
            route: {
                ...selectedRoute,
                routeInfo,
            },
            // 구독 잔여량을 확인한 뒤 호출 화면에서 켠다. 경로 생성과 알림 quota 소비를 분리한다.
            notificationEnabled: false,
            notificationLeadMinutes: undefined,
            notificationIntervalMinutes: undefined,
        },
        routePrepared: true,
        hints,
    };
}

/** 좌표와 경로가 준비된 payload에만 구독 정책 범위 안의 알림 값을 적용한다. */
export function enableCalendarImportNotification(
    payload: SchedulePayload,
    intervalMinutes: number
): SchedulePayload {
    if (
        !hasCoordinates(payload.origin) ||
        !hasCoordinates(payload.destination) ||
        !payload.travelMode ||
        !payload.route
    ) {
        return { ...payload, notificationEnabled: false };
    }

    return {
        ...payload,
        notificationEnabled: true,
        notificationLeadMinutes: 15,
        notificationIntervalMinutes: Math.max(1, Math.ceil(intervalMinutes)),
    };
}

function normalizeCalendarText(value: string | undefined): string {
    return (value ?? "")
        .replace(/<br\s*\/?\s*>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&(?:gt|rarr);/gi, "→")
        .replace(/&nbsp;/gi, " ")
        .replace(/\r\n?/g, "\n")
        .trim();
}

function extractLabeledPlace(text: string, labels: string[]): string | undefined {
    if (!text) return undefined;
    const escapedLabels = labels.map(escapeRegExp).join("|");
    const boundaryLabels = [
        "출발지", "출발 장소", "출발", "from",
        "도착지", "도착 장소", "목적지", "도착", "to",
    ].map(escapeRegExp).join("|");
    const pattern = new RegExp(
        `(?:^|\\s|[\\n,;|])(?:${escapedLabels})\\s*[:：]\\s*(.+?)(?=\\s+(?:${boundaryLabels})\\s*[:：]|[\\n,;|]|$)`,
        "i"
    );
    return cleanPlaceQuery(pattern.exec(text)?.[1]);
}

function extractRouteExpression(text: string): { origin: string; destination: string } | undefined {
    if (!text) return undefined;

    for (const line of text.split("\n").map((item) => item.trim()).filter(Boolean)) {
        const arrowParts = line.split(ROUTE_ARROW_PATTERN);
        if (arrowParts.length >= 2) {
            const origin = cleanPlaceQuery(arrowParts[arrowParts.length - 2]);
            const destination = cleanPlaceQuery(arrowParts[arrowParts.length - 1]);
            if (origin && destination) return { origin, destination };
        }

        const koreanRoute = /(.{1,80}?)에서\s+(.{1,80}?)(?:까지|로|으로)(?:\s|$)/.exec(line);
        const origin = cleanPlaceQuery(koreanRoute?.[1]);
        const destination = cleanPlaceQuery(koreanRoute?.[2]);
        if (origin && destination) return { origin, destination };
    }

    return undefined;
}

function cleanPlaceQuery(value: string | null | undefined): string | undefined {
    const normalized = value
        ?.replace(/^(?:장소|위치|경로|이동)\s*[:：]\s*/i, "")
        .replace(/^[\s\-–—•·]+|[\s\-–—•·.,]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!normalized || URL_PATTERN.test(normalized)) return undefined;
    if (normalized.length > MAX_PLACE_QUERY_LENGTH) return undefined;
    return normalized;
}

function hasCoordinates(place: Place | undefined): place is Place & { lat: number; lng: number } {
    return !!place &&
        typeof place.lat === "number" && Number.isFinite(place.lat) &&
        typeof place.lng === "number" && Number.isFinite(place.lng);
}

function normalizeForMatch(value: string | undefined): string {
    return (value ?? "").replace(/\s+/g, "").toLocaleLowerCase();
}

function placeMatchesQuery(place: Place, query: string): boolean {
    const normalizedQuery = normalizeForMatch(query);
    if (!normalizedQuery) return false;
    return [place.name, place.address].some((value) => {
        const normalizedValue = normalizeForMatch(value);
        return normalizedValue === normalizedQuery || normalizedValue.includes(normalizedQuery);
    });
}

function selectFastestUsableRoute(routes: RouteAlternativeOption[]): RouteAlternativeOption | undefined {
    return routes
        .filter((route) => typeof route.minutes === "number" && Number.isFinite(route.minutes) && route.minutes > 0)
        .sort((a, b) => (a.minutes ?? Number.POSITIVE_INFINITY) - (b.minutes ?? Number.POSITIVE_INFINITY))[0];
}

function displayPlace(place: Place, fallback: string): string {
    return place.name?.trim() || place.address?.trim() || fallback;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
