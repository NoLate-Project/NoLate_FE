import type {AutomaticJourneyBinding,AutomaticJourneySnapshot} from '../src/modules/journey/automaticJourney';
import type {JourneyRouteInput} from '../src/modules/journey/journeyRouteInput';
import {presentSavedJourneyGuidance} from '../src/modules/journey/savedJourneyGuidance';
import {presentSavedJourneyRoutePosition} from '../src/modules/journey/savedJourneyRoutePosition';
import {presentSavedJourneyStage,savedJourneyTimelineHighlight} from '../src/modules/journey/savedJourneyStage';
import type {RouteInfo} from '../src/modules/schedule/routeInfo';
const binding={sessionId:'s',scheduleId:'9001',generation:1,routeRevision:1,routeInputDigest:'a'.repeat(64),
    savedRouteValidated:true,guidanceEnabled:true,syncScope:'AUTHENTICATED',preparedAtEpochSeconds:1000,expiresAtEpochSeconds:1600} as AutomaticJourneyBinding;
const input={routeRevision:1,legs:['WALK','BUS','WALK','SUBWAY','WALK'].map((kind,index)=>({index,kind,
    stops:[{name:index===3?'합성 환승역':'합성 정류장'}],display:{durationMinutes:2}}))} as unknown as JourneyRouteInput;
function snapshot(patch={}) {return {enabled:true,status:'ACTIVE',sessionId:'s',routeRevision:1,
    guidanceRoute:{...binding,legs:input.legs.map(leg=>({...leg.display,index:leg.index,kind:leg.kind,walkingLengthMeters:200,
        boardingStopName:leg.stops[0].name}))},
    guidance:{...binding,schemaVersion:5,sequence:40,status:'ACTIVE',phase:'TRANSFER_WALK',quality:'GOOD',
        instruction:'환승 승차 지점으로 도보 이동 중',activeLegIndex:2,walkProgress:0.2,rideProgress:null,
        boardingConfirmed:false,arrival:null,alighting:null,observedAt:1020,validUntil:1035,...patch}} as unknown as AutomaticJourneySnapshot;}
it('uses transfer segment, next boarding name and remaining metres instead of destination or first stop',()=>{
    const s=snapshot();expect(presentSavedJourneyGuidance(s,binding,1021)).toMatchObject({phase:'TRANSFER_WALK',fresh:true,progress:0.2});
    const position=presentSavedJourneyRoutePosition(s,binding,input,1021);
    expect(position).toMatchObject({legIndex:2,legProgress:0.2,waiting:false});expect(position?.barFraction).toBeCloseTo(0.44);
    const stage=presentSavedJourneyStage(s,binding,input,1021);
    expect(stage).toEqual({title:'합성 환승역 환승',action:'환승 도보 약 160m',activeLegIndex:2});
    expect(savedJourneyTimelineHighlight(stage,input,{steps:input.legs.map(leg=>({id:`leg-${leg.index}`,type:leg.kind}))} as RouteInfo)?.stepId).toBe('leg-2');
});
it('does not infer boarding or journey arrival at progress one and does not move by clock',()=>{
    const s=snapshot({walkProgress:1});
    expect(presentSavedJourneyStage(s,binding,input,1021)).toEqual({title:'합성 환승역 환승',action:'승차 지점 근처 · 탑승 대기',activeLegIndex:2});
    expect(presentSavedJourneyGuidance(s,binding,1034)?.phase).toBe('TRANSFER_WALK');
    expect(presentSavedJourneyRoutePosition(snapshot(),binding,input,1021)).toEqual(presentSavedJourneyRoutePosition(snapshot(),binding,input,1034));
    expect(presentSavedJourneyRoutePosition(s,binding,input,1035)).toBeNull();
});
it.each([{schemaVersion:4},{activeLegIndex:1},{activeLegIndex:3},{activeLegIndex:30},{activeLegIndex:2.5},
    {boardingConfirmed:true},{rideProgress:0.2},{arrival:{}},{alighting:{kind:'NEAR_STOP',remainingMeters:0}},
    {walkProgress:NaN},{walkProgress:1.1},{walkProgress:null},{quality:'UNCERTAIN'}])('rejects contradictory transfer wire %j',patch=>{
    expect(presentSavedJourneyRoutePosition(snapshot(patch),binding,input,1021)).toBeNull();
});
it('requires matching immutable metadata and actual intermediate walking topology',()=>{
    for(const mode of ['identity','length','last-leg','next-leg']) {
        const s=snapshot();let selected=input;
        if(mode==='identity')s.guidanceRoute!.routeRevision=2;
        if(mode==='length')(s.guidanceRoute!.legs as any[])[2].walkingLengthMeters=0;
        if(mode==='last-leg')selected={...input,legs:input.legs.slice(0,3)};
        if(mode==='next-leg')selected={...input,legs:input.legs.map(leg=>leg.index===3?{...leg,kind:'WALK'}:leg)};
        expect(presentSavedJourneyRoutePosition(s,binding,selected,1021)).toBeNull();
    }
});
it('does not use an unrelated display name as a boarding-point identity',()=>{
    const s=snapshot();(s.guidanceRoute!.legs as any[])[3].boardingStopName='다른 역';
    expect(presentSavedJourneyStage(s,binding,input,1021)?.title).toBe('다음 승차 지점까지');
});
