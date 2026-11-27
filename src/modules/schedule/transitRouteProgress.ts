import { intercityRideColor, transitModeLabel } from "../map/transitModes";
import { isTransitRideKind } from "../map/transitModes";
import type { RouteAlternativeOption, TransitLegDetail } from "../map/routingService";
import {
    findTransitRideLineLabel,
    formatRouteDuration,
    getTransitBusLineColor,
    getSubwayLineColor,
    getTimetableWalkSeconds,
    type RouteStep,
} from "./routeInfo";

export const TRANSIT_PROGRESS_NEUTRAL_COLOR = "#4F5760";
export const TRANSIT_WAIT_LABEL = "대기";
const TRANSIT_DURATION_UNAVAILABLE = "시간 미확인";

export type TransitRouteProgressSegment = {
    key: string;
    label: string;
    lineLabel?: string;
    kind: TransitLegDetail["kind"] | "TRANSFER" | "WAIT";
    minutes: number;
    durationSeconds?: number;
    color: string;
    flex: number;
    isRide: boolean;
};

function getRideColor(leg: TransitLegDetail, lineLabel?: string): string {
    if (leg.kind === "SUBWAY") return getSubwayLineColor(lineLabel, leg.lineColor);
    if (leg.kind === "BUS") return getTransitBusLineColor(leg);
    return intercityRideColor(leg.kind) ?? TRANSIT_PROGRESS_NEUTRAL_COLOR;
}

export function getTransitRideLineLabel(leg: TransitLegDetail): string {
    return findTransitRideLineLabel(leg) ?? transitModeLabel(leg.kind);
}

export function getTransitLegDisplayMinutes(leg: TransitLegDetail): number | undefined {
    if (typeof leg.durationMinutes === "number" && Number.isFinite(leg.durationMinutes) && leg.durationMinutes >= 0) {
        return Math.max(1, Math.round(leg.durationMinutes));
    }
    if (typeof leg.durationSeconds === "number" && Number.isFinite(leg.durationSeconds) && leg.durationSeconds >= 0) {
        return Math.max(1, Math.round(leg.durationSeconds / 60));
    }
    return undefined;
}

export function getTransitRouteWalkingMinutes(
    legs: readonly Pick<TransitLegDetail, "kind" | "durationSeconds" | "durationMinutes">[],
    preview?: RouteAlternativeOption["odsayTimetablePreview"],
    roundUp = Boolean(preview),
): number | undefined {
    let totalSeconds = legs[0]?.kind === "SUBWAY" ? preview?.entranceWalk?.seconds ?? 0 : 0;
    let rideCount = 0;
    for (const [index, leg] of legs.entries()) {
        if (leg.kind !== "WALK") {
            if (isTransitRideKind(leg.kind)) rideCount++;
            continue;
        }
        const seconds = getTimetableWalkSeconds(legs, index, rideCount, preview) ?? leg.durationSeconds;
        if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) {
            totalSeconds += seconds;
        } else if (typeof leg.durationMinutes === "number" && Number.isFinite(leg.durationMinutes) && leg.durationMinutes >= 0) {
            totalSeconds += leg.durationMinutes * 60;
        } else {
            return undefined;
        }
    }
    return totalSeconds === 0 ? 0 : Math.max(1, (roundUp ? Math.ceil : Math.round)(totalSeconds / 60));
}

export function formatTransitWalkingSummary(minutes?: number): string | undefined {
    return typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
        ? `도보 ${formatRouteDuration(minutes)}`
        : undefined;
}

/** 최신 길찾기와 저장 일정이 같은 구간 비율·노선색·라벨 규칙을 사용한다. */
export function buildTransitRouteProgressSegments(
    legs?: TransitLegDetail[]
): TransitRouteProgressSegment[] {
    if (!Array.isArray(legs)) return [];

    return legs.map((leg, index) => {
        const duration = getTransitLegDisplayMinutes(leg);
        const { durationSeconds } = leg;
        const minutes = duration ?? 1;
        const kind = leg.journeyPhase === "BUFFER" ? "WAIT" : leg.kind;
        const isRide = isTransitRideKind(kind);
        const lineLabel = isRide ? getTransitRideLineLabel(leg) : undefined;
        return {
            key: `${kind}-${index}`,
            // Neutral layout weight is not an observed one-minute travel time.
            label: duration === undefined ? TRANSIT_DURATION_UNAVAILABLE : formatRouteDuration(duration),
            lineLabel,
            kind,
            minutes,
            ...(typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds >= 0
                ? { durationSeconds }
                : {}),
            color: isRide ? getRideColor(leg, lineLabel) : TRANSIT_PROGRESS_NEUTRAL_COLOR,
            flex: Math.max(0.8, minutes),
            isRide,
        };
    });
}

export function groupTransitRouteSummary(
    segments: readonly TransitRouteProgressSegment[],
    focusedIndex?: number,
): { segments: TransitRouteProgressSegment[]; focusedIndex?: number } {
    const grouped: TransitRouteProgressSegment[] = [];
    let groupedFocus: number | undefined;
    for (const [index, segment] of segments.entries()) {
        const previous = grouped.at(-1);
        if (segment.kind === "WALK" && previous?.kind === "WALK"
            && segment.label !== TRANSIT_DURATION_UNAVAILABLE && previous.label !== TRANSIT_DURATION_UNAVAILABLE) {
            const durationSeconds = (previous.durationSeconds ?? previous.minutes * 60)
                + (segment.durationSeconds ?? segment.minutes * 60);
            const minutes = Math.max(1, Math.round(durationSeconds / 60));
            grouped[grouped.length - 1] = {
                ...previous,
                label: formatRouteDuration(minutes),
                minutes,
                durationSeconds,
                flex: minutes,
            };
        } else {
            grouped.push(segment);
        }
        if (index === focusedIndex) groupedFocus = grouped.length - 1;
    }
    return { segments: grouped, focusedIndex: groupedFocus };
}

/** Older saved routes can carry a timeline without the original provider legs. */
export function buildSavedTransitProgressFromSteps(
    steps: readonly RouteStep[] = [],
): TransitRouteProgressSegment[] {
    return buildTransitRouteProgressSegments(steps.flatMap(step => {
        const kind = step.type === "TRANSFER" ? "WALK" : step.type;
        if (kind !== "WALK" && !isTransitRideKind(kind)) return [];
        return [{
            kind,
            label: step.title,
            lineName: step.lineName ?? step.badgeText,
            lineColor: step.lineColor,
            durationMinutes: step.durationMinutes,
            durationSeconds: step.durationSeconds,
        }];
    }));
}

export function isRouteTransferWalk(segments: readonly TransitRouteProgressSegment[], index: number): boolean {
    const kind = segments[index]?.kind;
    return kind === "TRANSFER" || (
        kind === "WALK" &&
        segments.slice(0, index).some(segment => segment.isRide) &&
        segments.slice(index + 1).some(segment => segment.isRide)
    );
}

export function getTransitRouteSegmentAccessibilityLabel(segments: TransitRouteProgressSegment[], index: number): string {
    const segment = segments[index];
    if (segment.isRide) {
        return `${segment.lineLabel ?? transitModeLabel(segment.kind)} ${segment.label}`;
    }

    if (segment.kind === "WALK" || segment.kind === "TRANSFER") {
        return `${isRouteTransferWalk(segments, index) ? "환승 도보" : "도보"} ${segment.label}`;
    }

    if (segment.kind === "WAIT") return `${TRANSIT_WAIT_LABEL} ${segment.label}`;

    return `${transitModeLabel(segment.kind)} ${segment.label}`;
}

export function getTransitRouteSummaryAccessibilityLabel(
    segments: TransitRouteProgressSegment[]
) {
    const grouped = groupTransitRouteSummary(segments.filter(segment => segment.kind !== "WAIT")).segments;
    const itinerary = grouped.map((_, index) => (
        getTransitRouteSegmentAccessibilityLabel(grouped, index)
    )).join(", ");

    return itinerary ? `이동 경로, ${itinerary}` : "이동 경로";
}
