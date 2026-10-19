import { automaticRecord, type AutomaticJourneyBinding, type AutomaticJourneySnapshot } from './automaticJourney';
import { journeyDisplayName, journeyRouteUTF8Bytes, type JourneyRouteInput } from './journeyRouteInput';
import { presentSavedJourneyGuidance } from './savedJourneyGuidance';
import { presentSavedJourneyRoutePosition } from './savedJourneyRoutePosition';
import type { RouteInfo } from '../schedule/routeInfo';

export type SavedJourneyStage = { title: string; action: string; activeLegIndex: number | null };
/** Static evidence comes from the native normalizer, not display geometry/elapsed time. */
export function presentSavedJourneyStage(snapshot: AutomaticJourneySnapshot | null, binding: AutomaticJourneyBinding | null,
    input: JourneyRouteInput, now: number): SavedJourneyStage | null {
    const view = presentSavedJourneyGuidance(snapshot, binding, now);
    if (!view) return null;
    const position = presentSavedJourneyRoutePosition(snapshot, binding, input, now);
    if (!position) {
        if (view.phase === 'READY') return { title: '출발 대기', action: '이동하면 출발을 감지합니다', activeLegIndex: null };
        const last = view.lastConfirmedSubway;
        const leg = input.legs[1];
        if (last && leg?.kind === 'SUBWAY' && leg.stops.length === last.totalStops
            && journeyDisplayName(leg.stops[last.stopIndex]?.name) === last.stopName)
            return { title: `마지막 확인 · ${last.stopName}`,
                action: `현재 위치 재확인 중 · ${now - last.confirmedAt < 60 ? '방금 확인' : `${Math.floor((now-last.confirmedAt)/60)}분 전 확인`}`,
                activeLegIndex: null };
        return { title: '위치 확인 중', action: '현재 경로와 위치를 확인해 주세요', activeLegIndex: null };
    }
    const route = automaticRecord(snapshot?.guidanceRoute);
    const rawLegs = route?.legs;
    const metadataMatches = route && binding
        && ['sessionId', 'scheduleId', 'generation', 'routeRevision', 'routeInputDigest'].every(key => route[key] === binding[key as keyof AutomaticJourneyBinding])
        && Array.isArray(rawLegs) && rawLegs.length === input.legs.length
        && rawLegs.every((raw, index) => { const leg = automaticRecord(raw); return leg?.index === index && leg.kind === input.legs[index].kind; });
    const i = position.legIndex;
    const busIndex = view.phase === 'RIDING' ? i : i + 1;
    const first = metadataMatches ? automaticRecord(rawLegs[i]) : null;
    const bus = metadataMatches ? automaticRecord(rawLegs[busIndex]) : null;
    if (view.phase === 'TRANSFER_WALK') {
        const i=position.legIndex, walk=metadataMatches ? automaticRecord(rawLegs[i]) : null;
        const next=metadataMatches ? automaticRecord(rawLegs[i+1]) : null;
        const name=journeyDisplayName(next?.boardingStopName);
        const verified=name && name === journeyDisplayName(input.legs[i+1]?.stops?.[0]?.name) ? name : null;
        const length=walk?.walkingLengthMeters;
        const remaining=typeof length === 'number' && Number.isFinite(length) && length >= 1 && length <= 10_000
            ? Math.ceil(Math.max(0,length*(1-position.legProgress)-0.000001)/10)*10 : null;
        return {title:verified ? `${verified} 환승` : '다음 승차 지점까지',action:remaining === null ? '환승 도보 이동 중'
            : remaining > 0 ? `환승 도보 약 ${remaining}m` : '승차 지점 근처 · 탑승 대기',activeLegIndex:i};
    }
    if (view.phase === 'FINAL_WALK') {
        const length = metadataMatches ? automaticRecord(rawLegs[i])?.walkingLengthMeters : null;
        const remaining = typeof length === 'number' && Number.isFinite(length) && length >= 70 && length <= 10_000
            ? Math.ceil(Math.max(0, length * (1 - position.legProgress) - 0.000001) / 10) * 10 : null;
        return { title: '목적지까지', action: remaining === null ? '도보로 이동 중'
            : remaining > 0 ? `도보 약 ${remaining}m` : '목적지 근처 · 위치 확인', activeLegIndex: i };
    }
    if (view.phase === 'RIDING') {
        if (view.subway) return {title:view.subway.currentStopName,action:view.subway.remainingStops === 0
            ? '하차역 도착 · 하차 확인 중' : view.subway.remainingStops === 1 ? '다음 역 하차 · 하차 준비'
            : `다음 ${view.subway.nextStopName} · ${view.subway.remainingStops}개 역 남음`,activeLegIndex:busIndex};
        if (view.alighting) {
            const name = journeyDisplayName(bus?.alightingStopName);
            const stops = input.legs[busIndex]?.stops;
            const verified = name && name === journeyDisplayName(stops?.[stops.length - 1]?.name) ? name : null;
            return { title: verified ?? '하차 정류장', action: view.alighting.action, activeLegIndex: busIndex };
        }
        const line = journeyDisplayName(bus?.lineName);
        const verifiedName = line && line === journeyDisplayName(input.legs[busIndex]?.display?.lineName) ? line : null;
        return { title: verifiedName ?? '버스 이동 중', action: '버스로 이동 중', activeLegIndex: busIndex };
    }
    const rawName = bus?.boardingStopName;
    const name = typeof rawName === 'string' && rawName.trim().length > 0 && journeyRouteUTF8Bytes(rawName) <= 256
        && !Array.from(rawName).some(character => { const code = character.codePointAt(0)!; return code <= 31 || code >= 127 && code <= 159; })
        && rawName === input.legs[busIndex]?.stops?.[0]?.name ? rawName.trim() : null;
    if (position.waiting) return { title: name ?? (input.legs[busIndex]?.kind === 'SUBWAY' ? '승차역' : '승차 정류장'),
        action: input.legs[busIndex]?.kind === 'SUBWAY' ? '열차 대기 · 탑승 확인 전' : '버스 대기 · 도착하면 탑승 준비', activeLegIndex: busIndex };
    const length = first?.walkingLengthMeters;
    const remaining = typeof length === 'number' && Number.isFinite(length) && length >= 1 && length <= 100_000
        ? Math.ceil(length * (1 - position.legProgress) / 10) * 10 : null;
    return { title: name ? `${name}까지` : '승차 지점까지', action: remaining === null ? '도보로 이동 중'
        : remaining > 0 ? `도보 약 ${remaining}m` : '승차 지점 근처', activeLegIndex: i };
}

/** Map original indices, never a name match or the user's manually selected/map-inspected row. */
export function savedJourneyTimelineHighlight(stage: SavedJourneyStage | null, input: JourneyRouteInput | null, route: RouteInfo) {
    if (stage?.activeLegIndex == null || !input) return undefined;
    const movements = route.steps.filter(step => !['ORIGIN', 'DESTINATION'].includes(step.type));
    if (movements.length !== input.legs.length || movements.some((step, index) => step.id !== `leg-${index}` || step.type !== input.legs[index].kind)) return undefined;
    return { stepId: `leg-${stage.activeLegIndex}`, label: `${stage.title} · ${stage.action}` };
}

/** Full display names only; never a name-based route match or boarding evidence. */
export function savedJourneyTimelineNames(input: JourneyRouteInput | null, route: RouteInfo): Record<string, string> {
    if (!input) return {};
    const movements = route.steps.filter(step => !['ORIGIN', 'DESTINATION'].includes(step.type));
    if (movements.length !== input.legs.length || movements.some((step, index) => step.id !== `leg-${index}` || step.type !== input.legs[index].kind)) return {};
    const names: Record<string, string> = {};
    input.legs.forEach(leg => {
        const name = journeyDisplayName(leg.display?.lineName);
        if (name && ['BUS', 'SUBWAY'].includes(leg.kind)) names[`leg-${leg.index}`] = name;
    });
    return names;
}
