import type { TransitLegDetail } from "../map/routingService";
import {
    compactTransitLineLabel,
    getBusLineColor,
    getSubwayLineColor,
} from "./routeInfo";

export const TRANSIT_PROGRESS_NEUTRAL_COLOR = "#4F5760";

export type TransitRouteProgressSegment = {
    key: string;
    label: string;
    lineLabel?: string;
    kind: TransitLegDetail["kind"];
    minutes: number;
    color: string;
    flex: number;
    isRide: boolean;
};

function formatProgressDuration(minutes: number): string {
    const totalMinutes = Math.max(0, Math.round(minutes));
    const hours = Math.floor(totalMinutes / 60);
    const remainMinutes = totalMinutes % 60;
    if (hours === 0) return `${remainMinutes}분`;
    if (remainMinutes === 0) return `${hours}시간`;
    return `${hours}시간 ${remainMinutes}분`;
}

function getRideColor(leg: TransitLegDetail): string {
    const lineLabel = compactTransitLineLabel(leg.lineName) ?? compactTransitLineLabel(leg.label);
    if (leg.kind === "SUBWAY") return getSubwayLineColor(lineLabel);
    if (leg.kind === "BUS") return getBusLineColor(lineLabel, leg.lineColor);
    return TRANSIT_PROGRESS_NEUTRAL_COLOR;
}

/** 최신 길찾기와 저장 일정이 같은 구간 비율·노선색·라벨 규칙을 사용한다. */
export function buildTransitRouteProgressSegments(
    legs?: TransitLegDetail[]
): TransitRouteProgressSegment[] {
    if (!Array.isArray(legs)) return [];

    return legs.map((leg, index) => {
        const minutes = typeof leg.durationMinutes === "number" && Number.isFinite(leg.durationMinutes)
            ? Math.max(1, Math.round(leg.durationMinutes))
            : 1;
        const isRide = leg.kind === "BUS" || leg.kind === "SUBWAY";
        return {
            key: `${leg.kind}-${index}`,
            label: formatProgressDuration(minutes),
            lineLabel: isRide
                ? (compactTransitLineLabel(leg.lineName) ?? compactTransitLineLabel(leg.label))
                : undefined,
            kind: leg.kind,
            minutes,
            color: isRide ? getRideColor(leg) : TRANSIT_PROGRESS_NEUTRAL_COLOR,
            flex: Math.max(0.8, minutes),
            isRide,
        };
    });
}
