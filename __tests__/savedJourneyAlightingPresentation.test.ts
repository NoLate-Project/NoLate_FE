import { presentSavedJourneyGuidance } from '../src/modules/journey/savedJourneyGuidance';
import { presentSavedJourneyStage, savedJourneyTimelineHighlight } from '../src/modules/journey/savedJourneyStage';
import { presentSavedJourneyRoutePosition } from '../src/modules/journey/savedJourneyRoutePosition';
import type { AutomaticJourneyBinding, AutomaticJourneySnapshot } from '../src/modules/journey/automaticJourney';
import type { JourneyRouteInput } from '../src/modules/journey/journeyRouteInput';
import type { RouteInfo } from '../src/modules/schedule/routeInfo';
const binding = { sessionId:'s',scheduleId:'9001',generation:1,routeRevision:1,routeInputDigest:'a'.repeat(64),
    savedRouteValidated:true,guidanceEnabled:true,syncScope:'AUTHENTICATED',preparedAtEpochSeconds:1000,expiresAtEpochSeconds:1600 } as AutomaticJourneyBinding;
const input = { routeRevision:1,legs:['WALK','BUS','WALK'].map((kind,index)=>({index,kind,
    stops:index===1?[{name:'합성 승차'},{name:'합성 중간'},{name:'합성 하차'}]:[],display:{durationMinutes:index===1?5:2,lineName:index===1?'합성 버스':null}})) } as JourneyRouteInput;
function snapshot(patch = {}) { return {enabled:true,status:'ACTIVE',sessionId:'s',routeRevision:1,
    guidanceRoute:{...binding,legs:input.legs.map(leg=>({...leg.display,index:leg.index,kind:leg.kind,alightingStopName:leg.index===1?'합성 하차':null}))},
    guidance:{...binding,schemaVersion:3,sequence:30,status:'ACTIVE',phase:'RIDING',quality:'GOOD',activeLegIndex:1,
        instruction:'버스로 이동 중',walkProgress:null,rideProgress:0.8,boardingConfirmed:true,observedAt:1020,validUntil:1025,
        alighting:{kind:'ONE_STOP_BEFORE',remainingMeters:180},...patch}} as unknown as AutomaticJourneySnapshot; }
it('shows one-stop-before distance on the bus segment, never final walking or arrival',()=>{
    const s=snapshot(),view=presentSavedJourneyGuidance(s,binding,1021),stage=presentSavedJourneyStage(s,binding,input,1021);
    expect(view?.alighting?.action).toBe('다음 정류장 · 약 180m 앞 · 하차 준비');
    expect(stage).toEqual({title:'합성 하차',action:'다음 정류장 · 약 180m 앞 · 하차 준비',activeLegIndex:1});
    expect(presentSavedJourneyRoutePosition(s,binding,input,1021)?.legIndex).toBe(1);
    const route={steps:input.legs.map(leg=>({id:`leg-${leg.index}`,type:leg.kind}))} as RouteInfo;
    expect(savedJourneyTimelineHighlight(stage,input,route)?.stepId).toBe('leg-1');
    expect(JSON.stringify(stage)).not.toMatch(/하차 완료|도착 완료|도보|%|분 남음/);
});
it('near-stop notice still means riding and never confirms alighting',()=>{
    const s=snapshot({alighting:{kind:'NEAR_STOP',remainingMeters:20}});
    expect(presentSavedJourneyStage(s,binding,input,1021)?.action).toBe('정류장 근처 · 하차 준비');
    expect(s.guidance?.boardingConfirmed).toBe(true);
    expect(presentSavedJourneyRoutePosition(s,binding,input,1021)?.legIndex).toBe(1);
});
it.each([{schemaVersion:2},{schemaVersion:1},{boardingConfirmed:false},{activeLegIndex:2},
    {alighting:null},{alighting:{kind:'ARRIVED',remainingMeters:0}},{alighting:{kind:'NEAR_STOP',remainingMeters:60}},
    {alighting:{kind:'ONE_STOP_BEFORE',remainingMeters:NaN}},{alighting:{kind:'ONE_STOP_BEFORE',remainingMeters:11}},
    {alighting:{kind:'ONE_STOP_BEFORE',remainingMeters:180,latitude:37.5}}, {quality:'UNCERTAIN'}])('hides invalid or contradictory alighting notice %j',patch=>{
    expect(presentSavedJourneyRoutePosition(snapshot(patch),binding,input,1021)).toBeNull();
});
it('time alone cannot advance a marker or keep an expired notice',()=>{
    expect(presentSavedJourneyRoutePosition(snapshot(),binding,input,1021)).toEqual(presentSavedJourneyRoutePosition(snapshot(),binding,input,1024));
    expect(presentSavedJourneyGuidance(snapshot(),binding,1025)?.alighting).toBeUndefined();
    expect(presentSavedJourneyStage(snapshot(),binding,input,1025)?.activeLegIndex).toBeNull();
    expect(presentSavedJourneyGuidance({...snapshot(),status:'STOPPED'},binding,1021)).toBeNull();
});
it('does not use a foreign stop display name as the target',()=>{
    const s=snapshot(); (s.guidanceRoute as any).legs[1].alightingStopName='잘못된 정류장';
    expect(presentSavedJourneyStage(s,binding,input,1021)?.title).toBe('하차 정류장');
});
