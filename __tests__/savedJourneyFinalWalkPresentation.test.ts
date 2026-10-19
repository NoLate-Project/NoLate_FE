import { normalizeAutomaticJourneySnapshot, type AutomaticJourneyBinding, type AutomaticJourneySnapshot } from '../src/modules/journey/automaticJourney';
import { presentSavedJourneyGuidance } from '../src/modules/journey/savedJourneyGuidance';
import { presentSavedJourneyRoutePosition } from '../src/modules/journey/savedJourneyRoutePosition';
import { presentSavedJourneyStage, savedJourneyTimelineHighlight } from '../src/modules/journey/savedJourneyStage';
import { presentSavedJourneyPosition } from '../src/modules/journey/useSavedJourneyPosition';
import type { JourneyRouteInput } from '../src/modules/journey/journeyRouteInput';
import type { RouteInfo } from '../src/modules/schedule/routeInfo';
jest.mock('../src/modules/journey/automaticJourneyTrial', () => ({getAutomaticJourneyTrialBinding:jest.fn(),subscribeAutomaticJourneySync:jest.fn()}));
const binding = { sessionId:'s',scheduleId:'9001',generation:1,routeRevision:1,routeInputDigest:'a'.repeat(64),
    savedRouteValidated:true,guidanceEnabled:true,syncScope:'AUTHENTICATED',preparedAtEpochSeconds:1000,expiresAtEpochSeconds:1600 } as AutomaticJourneyBinding;
const input = {routeRevision:1,legs:['WALK','BUS','WALK'].map((kind,index)=>({index,kind,stops:[],display:{durationMinutes:index===1?5:2}}))} as unknown as JourneyRouteInput;
function snapshot(patch = {}) {return {enabled:true,status:'ACTIVE',sessionId:'s',routeRevision:1,
    guidanceRoute:{...binding,legs:input.legs.map(leg=>({...leg.display,index:leg.index,kind:leg.kind,walkingLengthMeters:leg.index===2?200:130}))},
    guidancePosition:{latitude:37.5,longitude:127,accuracyMeters:2,observedAt:1020,validUntil:1035},
    guidance:{...binding,schemaVersion:4,sequence:30,status:'ACTIVE',phase:'FINAL_WALK',quality:'GOOD',instruction:'목적지로 도보 이동 중',
        activeLegIndex:2,walkProgress:0.2,rideProgress:null,boardingConfirmed:false,alighting:null,arrival:null,observedAt:1020,validUntil:1035,...patch}} as unknown as AutomaticJourneySnapshot;}
it('uses the final walking bar segment, remaining distance, current row and same fresh map position',()=>{
    const s=snapshot();
    expect(presentSavedJourneyGuidance(s,binding,1021)).toMatchObject({phase:'FINAL_WALK',fresh:true,progress:0.2});
    expect(presentSavedJourneyRoutePosition(s,binding,input,1021)).toMatchObject({legIndex:2,legProgress:0.2,waiting:false});
    const stage=presentSavedJourneyStage(s,binding,input,1021);
    expect(stage).toEqual({title:'목적지까지',action:'도보 약 160m',activeLegIndex:2});
    expect(savedJourneyTimelineHighlight(stage,input,{steps:input.legs.map(leg=>({id:`leg-${leg.index}`,type:leg.kind}))} as RouteInfo)?.stepId).toBe('leg-2');
    expect(presentSavedJourneyPosition(s,binding,1021)).toEqual({latitude:37.5,longitude:127});
});
it.each([{schemaVersion:1},{schemaVersion:3},{activeLegIndex:1},{boardingConfirmed:true},{rideProgress:0.5},
    {alighting:{kind:'NEAR_STOP',remainingMeters:0}},{arrival:{}},{walkProgress:NaN},{walkProgress:1.1},{walkProgress:null},
    {quality:'UNCERTAIN'},{phase:'ARRIVED'}])('rejects contradictory or unsupported final walking content %j',patch=>{
    expect(presentSavedJourneyRoutePosition(snapshot(patch),binding,input,1021)).toBeNull();
});
it('never advances by clock or invents destination arrival at progress one',()=>{
    expect(presentSavedJourneyRoutePosition(snapshot(),binding,input,1021)).toEqual(presentSavedJourneyRoutePosition(snapshot(),binding,input,1034));
    expect(presentSavedJourneyStage(snapshot({walkProgress:1}),binding,input,1021)).toEqual({title:'목적지까지',action:'목적지 근처 · 위치 확인',activeLegIndex:2});
    expect(presentSavedJourneyRoutePosition(snapshot(),binding,input,1035)).toBeNull();
    expect(presentSavedJourneyPosition(snapshot(),binding,1035)).toBeNull();
    expect(presentSavedJourneyGuidance({...snapshot(),status:'STOPPED'},binding,1021)).toBeNull();
});
it('requires immutable final walk display length and exact topology, not a foreign route or transfer',()=>{
    for(const variant of ['binding','length','topology']) {
        const s=snapshot();
        if(variant==='binding') s.guidanceRoute!.routeRevision=2;
        if(variant==='length') (s.guidanceRoute!.legs as any[])[2].walkingLengthMeters=0;
        const route=variant==='topology'?{...input,legs:[...input.legs,{...input.legs[2],index:3}]}:input;
        expect(presentSavedJourneyRoutePosition(s,binding,route,1021)).toBeNull();
    }
});
it('diagnostics are bounded read-only values, never admission or persisted vehicle identity',()=>{
    const s=normalizeAutomaticJourneySnapshot({enabled:true,status:'ACTIVE',finalWalkPhase:'FINAL_WALK',finalWalkReason:'CONFIRMED',finalWalkEvidenceCount:3,vehicleId:'private'});
    expect(s.finalWalkPhase).toBe('FINAL_WALK');expect(s.finalWalkEvidenceCount).toBe(3);expect(s.guidance).toBeUndefined();
    expect(s).not.toHaveProperty('vehicleId');
    const bad=normalizeAutomaticJourneySnapshot({finalWalkPhase:'ARRIVED',finalWalkReason:'bad code',finalWalkEvidenceCount:Infinity});
    expect(bad.finalWalkPhase).toBe('UNAVAILABLE');expect(bad.finalWalkEvidenceCount).toBe(0);
});
