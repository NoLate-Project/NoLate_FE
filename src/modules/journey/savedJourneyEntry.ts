import type { JourneyRouteCoordinate, JourneyRouteInput } from './journeyRouteInput';
import {composeServerWalkingInput} from './serverWalkingSnapshot';

/** Product-entry preflight only, never provider or boarding authority. */
export function savedJourneyEntryIssue(input: JourneyRouteInput | null, subwayTrial=false): string | null {
    if (!input) return '저장된 대중교통 경로를 확인할 수 없어 위치 안내를 준비할 수 없어요.';
    if (input.legs.length < 3 || input.legs.length > 31 || input.legs.length % 2 !== 1 || input.legs.some((leg, index) => leg.index !== index
        || (index % 2 === 0 ? leg.kind !== 'WALK' : leg.kind !== 'BUS' && !(subwayTrial && input.legs.length===3 && leg.kind==='SUBWAY')))) {
        return subwayTrial
            ? '현재 위치 안내 시험은 도보·대중교통이 이어진 경로 중 버스 또는 지하철 단일 구간만 지원해요. 지하철 환승 경로는 아직 지원하지 않아요.'
            : '현재 위치 안내 시험은 도보와 버스가 번갈아 이어지는 경로만 지원해요. 지하철 탑승 안내는 아직 지원하지 않아요.';
    }
    const valid = (point: JourneyRouteCoordinate | null) => !!point && Number.isFinite(point.latitude)
        && Number.isFinite(point.longitude) && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
    if (!valid(input.origin) || !valid(input.destination)) return '출발지와 도착지 좌표가 필요해요. 경로를 다시 저장해 주세요.';
    // ODsay can provide an exact saved path without a verified departure. Admit
    // only a single bus/subway leg to assessment; server official data and native
    // runtime evidence still decide whether navigation can actually prepare.
    const officialTransitRecheck = input.provider === 'odsay' && input.serviceState === 'UNKNOWN'
        && input.legs.length === 3 && (input.legs[1].kind === 'BUS' || subwayTrial && input.legs[1].kind === 'SUBWAY');
    if (input.source !== 'api' || !['tmap', 'odsay'].includes(input.provider)
        || input.plausibility !== 'normal' || input.serviceState !== 'operating' && !officialTransitRecheck) {
        return '공급자 경로와 운행 상태를 확인할 수 없어 위치 안내를 준비할 수 없어요.';
    }
    if(input.walkingSnapshot){try{composeServerWalkingInput(input,input.walkingSnapshot);}catch{return '서버 도보 경로가 만료되었거나 저장 경로와 달라요. 다시 연결해 주세요.';}}
    if (input.legs.some(leg => (!input.walkingSnapshot||leg.kind!=='WALK') && (!leg.exact || !leg.geometryInputComplete || leg.coordinates.length < 2
        || leg.coordinates.some(point => !valid(point)) || !valid(leg.start) || !valid(leg.end)
        || leg.geometrySource !== (leg.kind === 'WALK' ? 'WALK_STEPS_LINESTRING' : 'TRANSIT_PASS_SHAPE_LINESTRING')))) {
        return '도보·대중교통의 실제 이동 경로가 부족해요. 지도 표시용 연결선만으로는 안내하지 않아요.';
    }
    return null;
}
