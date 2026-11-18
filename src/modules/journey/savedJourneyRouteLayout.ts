import { automaticRecord, type AutomaticJourneyBinding, type AutomaticJourneySnapshot } from './automaticJourney';
import { journeyDisplayColor, journeyDisplayName, journeyDisplayNumber, type JourneyRouteInput } from './journeyRouteInput';
import { getBusLineColor, getSubwayLineColor } from '../schedule/routeInfo';
import type { TransitRouteProgressSegment } from '../schedule/transitRouteProgress';

const modeLabels: Record<string, string> = { WALK: '도보', BUS: '버스', SUBWAY: '지하철', ETC: '이동', UNKNOWN: '미확인' };
const modeColors: Record<string, string> = { WALK: '#78828F', BUS: '#2F963B', SUBWAY: '#239FD2', ETC: '#78828F', UNKNOWN: '#78828F' };
export type SavedJourneyRouteLayout = { basis: 'TIME' | 'DISTANCE' | 'EQUAL'; caption: string;
    legs: { index: number; kind: string; label: string; color: string; fraction: number; durationMinutes: number | null }[] };
export function presentPlannedJourneyRouteLayout(input: JourneyRouteInput,
    segments: readonly TransitRouteProgressSegment[]): SavedJourneyRouteLayout | null {
    if (segments.length !== input.legs.length ||
        segments.some((segment, index) => segment.kind !== input.legs[index].kind)) return null;
    return layoutFor(input.legs.map((leg, index) => ({
        index, kind: leg.kind, label: segments[index].lineLabel ?? modeLabels[leg.kind], color: segments[index].color,
        durationMinutes: journeyDisplayNumber(leg.display?.durationMinutes, 1440),
        distanceMeters: journeyDisplayNumber(leg.display?.distanceMeters, 10_000_000),
    })));
}

/** Same immutable, budgeted Activity metadata. Input claims alone cannot alter the rendered layout. */
export function presentSavedJourneyRouteLayout(snapshot: AutomaticJourneySnapshot | null, binding: AutomaticJourneyBinding | null,
    input: JourneyRouteInput): SavedJourneyRouteLayout {
    const route = automaticRecord(snapshot?.guidanceRoute), raw = route?.legs;
    const matches = route && binding && ['sessionId', 'scheduleId', 'generation', 'routeRevision', 'routeInputDigest']
        .every(key => route[key] === binding[key as keyof AutomaticJourneyBinding]) && Array.isArray(raw)
        && raw.length === input.legs.length && raw.every((leg, index) => {
            const value = automaticRecord(leg); return value?.index === index && value.kind === input.legs[index].kind;
        });
    const metadata = input.legs.map((leg, index) => {
        const value = matches ? automaticRecord(raw[index]) : null, expected = leg.display;
        const name = journeyDisplayName(value?.lineName), color = journeyDisplayColor(value?.lineColor);
        const time = journeyDisplayNumber(value?.durationMinutes, 1440), distance = journeyDisplayNumber(value?.distanceMeters, 10_000_000);
        const transit = ['BUS', 'SUBWAY'].includes(leg.kind);
        const verifiedName = transit && name === journeyDisplayName(expected?.lineName) ? name : null;
        const verifiedColor = transit && color === journeyDisplayColor(expected?.lineColor) ? color : null;
        let lineColor = verifiedColor ?? modeColors[leg.kind];
        if (verifiedName && leg.kind === 'SUBWAY') lineColor = getSubwayLineColor(verifiedName, verifiedColor ?? undefined);
        if (verifiedName && leg.kind === 'BUS') lineColor = getBusLineColor(verifiedName, verifiedColor ?? undefined);
        return { index, kind: leg.kind,
            label: verifiedName ?? modeLabels[leg.kind],
            color: lineColor,
            durationMinutes: time !== null && time === journeyDisplayNumber(expected?.durationMinutes, 1440) ? time : null,
            distanceMeters: distance !== null && distance === journeyDisplayNumber(expected?.distanceMeters, 10_000_000) ? distance : null };
    });
    return layoutFor(metadata);
}

function layoutFor(metadata: (Omit<SavedJourneyRouteLayout['legs'][number], 'fraction'> &
    { distanceMeters: number | null })[]): SavedJourneyRouteLayout {
    const basis = metadata.length && metadata.every(leg => leg.durationMinutes !== null) ? 'TIME'
        : metadata.length && metadata.every(leg => leg.distanceMeters !== null) ? 'DISTANCE' : 'EQUAL';
    const values = metadata.map(leg => basis === 'TIME' ? leg.durationMinutes! : basis === 'DISTANCE' ? leg.distanceMeters! : 1);
    const total = values.reduce((sum, value) => sum + value, 0);
    return { basis, caption: basis === 'TIME' ? '예정 시간 비례' : basis === 'DISTANCE' ? '경로 거리 비례' : '구간 동일 폭',
        legs: metadata.map((leg, index) => ({ ...leg, fraction: values[index] / total })) };
}
