import { resolveJourneyBusRouteMapping } from './journeyBusRouteBinding';
import { buildJourneyRouteInput, type JourneyRouteCoordinate, type JourneyRouteInput } from './journeyRouteInput';
import { savedJourneyEntryIssue } from './savedJourneyEntry';
import {savedWalkingBaseJSON} from './serverWalkingSnapshot';

type Check = { code: string; state: 'PRESENT' | 'MISSING' | 'RECHECK_REQUIRED'; detail: string };
export type SavedJourneyProviderPreflight = { canAssess: boolean; issue: string | null; checks: Check[] };
const record = (v: unknown): Record<string, unknown> | null =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const distance = (a: JourneyRouteCoordinate, b: JourneyRouteCoordinate) => {
    const r = Math.PI / 180;
    const h = Math.sin((b.latitude - a.latitude) * r / 2) ** 2
        + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin((b.longitude - a.longitude) * r / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
};

/** Local saved claims only, not provider attestation or permission to navigate. No I/O or raw IDs in output. */
export function savedJourneyProviderPreflight(input: JourneyRouteInput | null, savedRoute: unknown, subwayTrial=false): SavedJourneyProviderPreflight {
    const issue = savedJourneyEntryIssue(input,subwayTrial);
    const subway=subwayTrial&&!!input?.legs.some(leg=>leg.kind==='SUBWAY');
    const checks: Check[] = [];
    const add = (code: string, present: boolean, good: string, missing: string) =>
        checks.push({ code, state: present ? 'PRESENT' : 'MISSING', detail: present ? good : missing });
    add('ROUTE_INPUT', !issue, subway?'도보와 지하철이 연결된 시험 입력이 있어요.':'도보와 버스가 연결된 입력이 있어요.', issue ?? '저장 경로 입력이 필요해요.');
    add('BUS_PROVIDER', input?.provider === 'odsay' && input.source === 'api',
        'ODsay 저장 경로 형식이에요. 실제 공급자 검증은 아직 필요해요.',
        '현재 버스 연결은 ODsay의 서울 버스 원본 식별자가 필요해요. TMAP·공개 정류장 자료만으로는 준비하지 않아요.');
    const walk = !!input && !issue && (!!input.walkingSnapshot || input.legs.filter(leg=>leg.kind==='WALK').every(leg => {
        return leg?.kind === 'WALK' && leg.exact && leg.geometryInputComplete && leg.coordinates.length >= 2
            && leg.geometrySource === 'WALK_STEPS_LINESTRING';
    }));
    add('WALK_GEOMETRY', walk, '첫 도보와 마지막 도보의 원본 형상 입력이 있어요.',
        '첫 도보·마지막 도보의 실제 경로가 필요해요. 정류장 연결선이나 표시용 보정은 사용할 수 없어요.');
    add('BUS_GEOMETRY', !!input && input.legs.filter(leg=>leg.kind==='BUS').every(bus=>bus.exact && bus.geometryInputComplete
        && bus.geometrySource === 'TRANSIT_PASS_SHAPE_LINESTRING' && bus.coordinates.length >= 2),
    subway?'지하철 원본 형상 입력이 있어요. 공식 역 대응과 대조해야 해요.':'버스 원본 형상 입력이 있어요. 공식 노선 형상과 대조해야 해요.', '버스 원본 이동 형상이 필요해요.');
    // Same bounded builder/context as the displayed input. An unrelated valid route must not
    // supply identifiers for this route; canonical comparison stays private and is never returned.
    let sameInput = false;
    let mappingPresent = false;
    try {
        const root = record(savedRoute);
        const nested = record(root?.routeInfo);
        const built = input && buildJourneyRouteInput(Array.isArray(root?.transitLegs) ? root : nested, {
            routeRevision: input.routeRevision, context: input.context,
            origin: input.origin && { lat: input.origin.latitude, lng: input.origin.longitude },
            destination: input.destination && { lat: input.destination.latitude, lng: input.destination.longitude },
        });
        sameInput = !!built && built.ok && savedWalkingBaseJSON({...built.input,routeRevision:input?.walkingSnapshot?1:built.input.routeRevision}) === savedWalkingBaseJSON(input!);
        if (sameInput) {
            mappingPresent = input!.legs.filter(leg=>leg.kind==='BUS').every(leg=>{
                const mapping=resolveJourneyBusRouteMapping(savedRoute,leg.index);
                return mapping.status === 'SUPPORTED' && /^[1-9][0-9]{8}$/.test(mapping.query?.providerRouteId ?? '');
            });
            if(input!.legs.some(leg=>leg.kind==='SUBWAY'))mappingPresent=mappingPresent&&subwayTrial&&input!.legs.filter(leg=>leg.kind==='SUBWAY').every(leg=>
                leg.stops.length>=2&&leg.stops.every(stop=>typeof stop.routingStationId==='string'&&/^[0-9]{1,20}$/.test(stop.routingStationId)));
        }
    } catch { /* Corrupt/malformed saved claims remain unavailable; no exception text is exposed. */ }
    add('SAVED_INPUT_MATCH', sameInput, '표시 중인 경로와 원본 저장 입력이 같아요.', '표시 중인 경로와 원본 저장 입력을 함께 확인해야 해요.');
    add('BUS_IDENTIFIERS', mappingPresent, subway?'저장 경로의 지하철 ID·역 순서 입력이 있어요. 서울 역 ID 대응의 증명은 아니에요.':'서울 버스 원본 ID·방면·정류장 순서 입력이 있어요.',
        '서울 버스 원본 ID·방면·정류장 순서를 확인할 수 없어요. 노선명·표시용 정류장으로 대체하지 않아요.');
    if(subwayTrial&&input?.legs.some(leg=>leg.kind==='SUBWAY'))checks.push({code:'SUBWAY_CATALOG',state:'RECHECK_REQUIRED',
        detail:'지하철 초기 연결 시험입니다. 공식 역 대응·정차 순서와 실시간 열차를 서버에서 다시 확인하며, 환승·하차 확정은 지원하지 않습니다.'});
    // Coarse endpoint/connection preflight only. Native/server still check every segment,
    // ambiguity, official shape occurrences and final-walk admission independently.
    const path=(i:number)=>input?.walkingSnapshot?.walks.find(w=>w.legIndex===i)?.points.map(p=>({latitude:p.lat,longitude:p.lng})) ?? input?.legs[i].coordinates ?? [];
    const connected = !issue && !!input && input.legs.every(leg =>
        distance(leg.start!, path(leg.index)[0]!) <= 75
        && distance(leg.end!, path(leg.index).at(-1)!) <= 75)
        && distance(input.origin!, input.legs[0].start!) <= 75
        && distance(input.destination!, input.legs.at(-1)!.end!) <= 75
        && input.legs.slice(0,-1).every((_,i) => distance(input.legs[i].end!, input.legs[i + 1].start!) <= 75
            && distance(path(i).at(-1)!, path(i+1)[0]!) <= 75);
    add('LEG_CONNECTIONS', connected, '도보와 승하차 지점의 연결 입력이 있어요.',
        '도보 경로의 끝과 승하차 지점 연결을 확인해야 해요. 위치를 임의로 이어 붙이지 않아요.');
    const missing = checks.find(check => check.state === 'MISSING');
    checks.push({ code: 'SERVER_NATIVE', state: 'RECHECK_REQUIRED',
        detail: '로컬 입력 확인은 안내 가능 판정이 아니에요. 서버 소유권·공식 형상 매핑·실시간 차량과 기기 검증 후에만 준비해요.' });
    return { canAssess: !missing, issue: missing?.detail ?? null, checks };
}
