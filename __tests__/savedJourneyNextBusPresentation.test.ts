import type {AutomaticJourneyBinding,AutomaticJourneySnapshot} from '../src/modules/journey/automaticJourney';
import type {JourneyRouteInput} from '../src/modules/journey/journeyRouteInput';
import {presentSavedJourneyRoutePosition} from '../src/modules/journey/savedJourneyRoutePosition';
import {presentSavedJourneyStage} from '../src/modules/journey/savedJourneyStage';
import {presentSavedJourneyGuidance} from '../src/modules/journey/savedJourneyGuidance';
const binding={sessionId:'s',scheduleId:'9001',generation:1,routeRevision:1,routeInputDigest:'a'.repeat(64),
    savedRouteValidated:true,guidanceEnabled:true,syncScope:'AUTHENTICATED',preparedAtEpochSeconds:1000,expiresAtEpochSeconds:1600} as AutomaticJourneyBinding;
const input={routeRevision:1,legs:['WALK','BUS','WALK','BUS','WALK'].map((kind,index)=>({index,kind,
    stops:[{name:`승차 ${index}`},{name:`하차 ${index}`}],display:{lineName:`버스 ${index}`,durationMinutes:2}}))} as unknown as JourneyRouteInput;
function snapshot(phase='RIDING',index=3,patch={}) { return {enabled:true,status:'ACTIVE',sessionId:'s',routeRevision:1,
    guidanceRoute:{...binding,legs:input.legs.map(leg=>({...leg.display,index:leg.index,kind:leg.kind,walkingLengthMeters:200,
        boardingStopName:leg.stops[0].name,alightingStopName:leg.stops[1].name}))},
    guidance:{...binding,schemaVersion:6,sequence:60,status:'ACTIVE',phase,quality:'GOOD',instruction:'unused',activeLegIndex:index,
        walkProgress:phase==='RIDING'?null:phase==='WAITING'?1:0.5,rideProgress:phase==='RIDING'?0.5:null,
        boardingConfirmed:phase==='RIDING',arrival:null,alighting:null,observedAt:1200,validUntil:1215,...patch}} as unknown as AutomaticJourneySnapshot; }
it('v7 shows only the fresh next-occurrence ETA with the matching route marker',()=>{
    const arrival={busLegIndex:3,providerRouteId:'999999997',directionLabel:'합성 동쪽 방면',sourceUpdatedAt:1200,expectedAt:1320,validUntil:1320};
    const s=snapshot('WAITING',3,{schemaVersion:7,arrivalStatus:'WAITING_INFORMATION',arrival});
    expect(presentSavedJourneyRoutePosition(s,binding,input,1201)?.legIndex).toBe(2);
    expect(presentSavedJourneyGuidance(s,binding,1201)?.arrival).toEqual({directionLabel:'합성 동쪽 방면',remainingSeconds:119});
    for(const patch of [{schemaVersion:6},{arrival:{...arrival,busLegIndex:1}},{activeLegIndex:2},{phase:'RIDING'},
        {arrival:null},{arrivalStatus:'UNAVAILABLE'}])expect(presentSavedJourneyRoutePosition(snapshot('WAITING',3,
            {schemaVersion:7,arrivalStatus:'WAITING_INFORMATION',arrival,...patch}),binding,input,1201)).toBeNull();
    expect(presentSavedJourneyGuidance(s,binding,1320)?.arrival).toBeUndefined();
});
it.each([
    ['RIDING',3,3,0.7,'버스 3','버스로 이동 중'],
    ['WAITING',3,2,0.6,'승차 3','버스 대기 · 도착하면 탑승 준비'],
    ['APPROACHING_STOP',2,2,0.5,'승차 3까지','도보 약 100m'],
    ['WALKING_TO_STOP',2,2,0.5,'승차 3까지','도보 약 100m'],
    ['FINAL_WALK',4,4,0.9,'목적지까지','도보 약 100m'],
] as const)('renders indexed %s on its own segment without the first stop', (phase,index,positionIndex,fraction,title,action)=>{
    const s=snapshot(phase,index);const position=presentSavedJourneyRoutePosition(s,binding,input,1201);
    expect(position?.legIndex).toBe(positionIndex);expect(position?.barFraction).toBeCloseTo(fraction);
    expect(presentSavedJourneyStage(s,binding,input,1201)).toEqual({title,action,activeLegIndex:index});
    expect(presentSavedJourneyRoutePosition(s,binding,input,1215)).toBeNull();
});
it('uses the next occurrence alighting name, never the previous ride',()=>{
    const s=snapshot('RIDING',3,{alighting:{kind:'NEAR_STOP',remainingMeters:20}});
    expect(presentSavedJourneyStage(s,binding,input,1201)?.title).toBe('하차 3');
});
it.each([{schemaVersion:2},{activeLegIndex:1},{activeLegIndex:2},{activeLegIndex:31},{activeLegIndex:3.5},
    {boardingConfirmed:false},{walkProgress:1},{rideProgress:1.1},{arrival:{}},{alighting:{kind:'NEAR_STOP',remainingMeters:60}}])('rejects mismatched next ride %j',patch=>{
    expect(presentSavedJourneyRoutePosition(snapshot('RIDING',3,patch),binding,input,1201)).toBeNull();
});
it('rejects a plausible index on foreign immutable metadata or wrong topology',()=>{
    const s=snapshot();s.guidanceRoute!.routeRevision=2;
    expect(presentSavedJourneyRoutePosition(s,binding,input,1201)).toBeNull();
    const wrong:JourneyRouteInput={...input,legs:input.legs.map(leg=>leg.index===3?{...leg,kind:'SUBWAY'}:leg)};
    expect(presentSavedJourneyRoutePosition(snapshot(),binding,wrong,1201)).toBeNull();
    expect(presentSavedJourneyRoutePosition(snapshot('FINAL_WALK',2),binding,input,1201)).toBeNull();
});
