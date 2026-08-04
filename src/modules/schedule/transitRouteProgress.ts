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

const TRANSIT_GUIDANCE_LABEL_PATTERN = /정류장|승차|하차|환승|출발|도착|도보|에서|까지|방면/u;
const TRANSIT_METRIC_ONLY_PATTERN = /^\d+(?:\.\d+)?\s*(?:분|시간|정거장|m|km)$/iu;
const TRANSIT_TRAILING_METRIC_PATTERN = /\s+\d+(?:\.\d+)?\s*(?:분|시간|정거장|m|km)$/iu;
const TRANSIT_GENERIC_MODE_PATTERN = /^(?:버스|지하철|이동)$/u;

function compactProgressIdentity(rawValue?: string): string | undefined {
    const raw = rawValue?.trim();
    if (
        !raw ||
        TRANSIT_GUIDANCE_LABEL_PATTERN.test(raw) ||
        TRANSIT_METRIC_ONLY_PATTERN.test(raw)
    ) return undefined;

    const withoutTrailingMetric = raw.replace(TRANSIT_TRAILING_METRIC_PATTERN, "").trim();
    if (!withoutTrailingMetric || TRANSIT_GENERIC_MODE_PATTERN.test(withoutTrailingMetric)) {
        return undefined;
    }

    const compact = compactTransitLineLabel(withoutTrailingMetric);
    if (compact && !TRANSIT_METRIC_ONLY_PATTERN.test(compact)) return compact;

    return withoutTrailingMetric.length > 10
        ? `${withoutTrailingMetric.slice(0, 10)}...`
        : withoutTrailingMetric;
}

function getRideLineLabel(leg: TransitLegDetail): string {
    const candidates = [leg.lineName, ...leg.label.split(/[·|]/u)];
    for (const candidate of candidates) {
        const identity = compactProgressIdentity(candidate);
        if (identity) return identity;
    }

    return leg.kind === "BUS" ? "버스" : "지하철";
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
            lineLabel: isRide ? getRideLineLabel(leg) : undefined,
            kind: leg.kind,
            minutes,
            color: isRide ? getRideColor(leg) : TRANSIT_PROGRESS_NEUTRAL_COLOR,
            flex: Math.max(0.8, minutes),
            isRide,
        };
    });
}
