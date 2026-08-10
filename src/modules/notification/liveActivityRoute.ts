import {
    compactTransitLineLabel,
    getRouteInfoFromRoute,
    getRouteStepColor,
    type RouteStep,
} from "../schedule/routeInfo";

/** Five movement slots plus the native/backend-owned destination slot. */
export const LIVE_ACTIVITY_MAX_ROUTE_SEGMENTS = 5;

export type LiveActivityRouteSegmentKind = "WALK" | "BUS" | "SUBWAY" | "TRANSFER";

export type LiveActivityRouteSegment = {
    kind: LiveActivityRouteSegmentKind;
    label: string;
    colorHex: string;
};

type WeightedLiveActivityRouteSegment = LiveActivityRouteSegment & {
    minutes: number;
    sourceIndex: number;
};

export type LiveActivityTravelSnapshot = {
    /** Total door-to-door ETA. Transit waiting time is already included. */
    travelMinutes: number;
    /** Display-only explanation of the first boarding wait; never add to travelMinutes. */
    firstWaitMinutes?: number;
    routeSegments: LiveActivityRouteSegment[];
};

function normalizeMinutes(value: unknown, minimum: number): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    return Math.max(minimum, Math.round(value));
}

function segmentKind(step: RouteStep): LiveActivityRouteSegmentKind | undefined {
    if (step.type === "WALK" || step.type === "TRANSFER") return step.type;
    if (step.type === "BUS" || step.type === "SUBWAY") return step.type;
    return undefined;
}

function segmentLabel(step: RouteStep, kind: LiveActivityRouteSegmentKind): string {
    if (kind === "WALK") return "도보";
    if (kind === "TRANSFER") return "환승";
    return compactTransitLineLabel(step.badgeText) ??
        compactTransitLineLabel(step.lineName) ??
        (kind === "BUS" ? "버스" : "지하철");
}

function mergeConsecutiveSegments(
    segments: WeightedLiveActivityRouteSegment[],
): WeightedLiveActivityRouteSegment[] {
    const merged: WeightedLiveActivityRouteSegment[] = [];
    for (const segment of segments) {
        const previous = merged.at(-1);
        if (
            !previous ||
            previous.kind !== segment.kind ||
            previous.label !== segment.label ||
            previous.colorHex !== segment.colorHex
        ) {
            merged.push({ ...segment });
            continue;
        }
        previous.minutes += segment.minutes;
    }
    return merged;
}

/**
 * Keeps a chronological prefix and suffix. The omitted legs therefore form
 * exactly one contiguous middle range represented by one explicit marker;
 * scattered duration-based selection would create additional invisible gaps.
 */
function limitSegments(
    segments: WeightedLiveActivityRouteSegment[],
    maximum: number,
): WeightedLiveActivityRouteSegment[] {
    if (segments.length <= maximum) return segments;
    if (maximum <= 1) return segments.slice(0, 1);

    const retainedMovementCount = maximum - 1;
    const prefixCount = Math.ceil(retainedMovementCount / 2);
    const suffixCount = retainedMovementCount - prefixCount;
    const prefix = segments.slice(0, prefixCount);
    const suffix = suffixCount > 0 ? segments.slice(-suffixCount) : [];
    const omitted = segments.slice(prefixCount, segments.length - suffixCount);
    const omissionMarker: WeightedLiveActivityRouteSegment = {
        kind: "TRANSFER",
        label: `${omitted.length}구간 생략`,
        colorHex: "#94A3B8",
        minutes: omitted.reduce((total, segment) => total + segment.minutes, 0),
        sourceIndex: omitted[0]?.sourceIndex ?? prefix.at(-1)?.sourceIndex ?? 0,
    };

    return [...prefix, omissionMarker, ...suffix];
}

export function buildLiveActivityRouteSegments(
    route: unknown,
    maximum = LIVE_ACTIVITY_MAX_ROUTE_SEGMENTS,
): LiveActivityRouteSegment[] {
    const routeInfo = getRouteInfoFromRoute(route);
    if (!routeInfo) return [];
    const normalizedMaximum = Number.isFinite(maximum)
        ? Math.floor(maximum)
        : LIVE_ACTIVITY_MAX_ROUTE_SEGMENTS;
    const safeMaximum = Math.max(
        1,
        Math.min(LIVE_ACTIVITY_MAX_ROUTE_SEGMENTS, normalizedMaximum),
    );
    const weighted = routeInfo.steps.flatMap<WeightedLiveActivityRouteSegment>((step, index) => {
        const kind = segmentKind(step);
        if (!kind) return [];
        return [{
            kind,
            label: segmentLabel(step, kind),
            colorHex: getRouteStepColor(step),
            minutes: normalizeMinutes(step.durationMinutes, 1) ?? 1,
            sourceIndex: index,
        }];
    });

    return limitSegments(mergeConsecutiveSegments(weighted), safeMaximum).map((segment) => ({
        kind: segment.kind,
        label: segment.label,
        colorHex: segment.colorHex,
    }));
}

function firstTransitWaitMinutes(route: unknown): number | undefined {
    const routeInfo = getRouteInfoFromRoute(route);
    const firstTransit = routeInfo?.steps.find(
        (step) => step.type === "BUS" || step.type === "SUBWAY",
    );
    return normalizeMinutes(firstTransit?.waitingMinutes, 0);
}

/**
 * Builds compact Live Activity state without changing the canonical ETA.
 * ODsay's total already includes its boarding wait, so a 60-minute route with
 * a 20-minute first wait remains 60 minutes, not 80.
 */
export function buildLiveActivityTravelSnapshot({
    route,
    travelMinutes,
}: {
    route: unknown;
    travelMinutes?: number | null;
}): LiveActivityTravelSnapshot | undefined {
    const routeInfo = getRouteInfoFromRoute(route);
    const total = normalizeMinutes(travelMinutes, 1) ??
        normalizeMinutes(routeInfo?.totalDurationMinutes, 1);
    if (!total) return undefined;

    const firstWaitMinutes = firstTransitWaitMinutes(route);
    return {
        travelMinutes: total,
        ...(firstWaitMinutes !== undefined ? { firstWaitMinutes } : {}),
        routeSegments: buildLiveActivityRouteSegments(route),
    };
}
