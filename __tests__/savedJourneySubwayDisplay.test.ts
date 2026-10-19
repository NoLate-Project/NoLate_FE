import {presentSavedJourneyGuidance} from '../src/modules/journey/savedJourneyGuidance';
import {presentSavedJourneyRoutePosition} from '../src/modules/journey/savedJourneyRoutePosition';
import {presentSavedJourneyStage} from '../src/modules/journey/savedJourneyStage';
import type {AutomaticJourneyBinding,AutomaticJourneySnapshot} from '../src/modules/journey/automaticJourney';
import type {JourneyRouteInput} from '../src/modules/journey/journeyRouteInput';

const binding:AutomaticJourneyBinding={sessionId:'11111111-1111-4111-8111-111111111111',scheduleId:'9001',generation:1,routeRevision:1,
    clientOwnerId:'22222222-2222-4222-8222-222222222222',routeInputDigest:'a'.repeat(64),execution:'SIMULATOR',syncScope:'AUTHENTICATED',
    savedRouteValidated:true,guidanceEnabled:true,preparedAtEpochSeconds:1000,expiresAtEpochSeconds:1600};
const input={routeRevision:1,legs:['WALK','SUBWAY','WALK'].map((kind,index)=>({kind,index,
    stops:index===1?['승차역','현재역','하차역'].map(name=>({name})):[]}))} as JourneyRouteInput;
const snapshot=(patch={})=>({enabled:true,status:'ACTIVE',sessionId:binding.sessionId,routeRevision:1,
    guidanceRoute:{...binding,legs:input.legs.map(leg=>({index:leg.index,kind:leg.kind,boardingStopName:'승차역',alightingStopName:'하차역'}))},
    guidance:{...binding,schemaVersion:8,sequence:4,status:'ACTIVE',phase:'RIDING',quality:'GOOD',instruction:'untrusted',
        activeLegIndex:1,boardingConfirmed:true,walkProgress:null,rideProgress:0.5,observedAt:1020,validUntil:1035,
        subway:{currentStopIndex:1,totalStops:3,currentStopName:'현재역',nextStopName:'하차역'},...patch}}) as unknown as AutomaticJourneySnapshot;
it('uses one station-correlated state for detail, route bar and next-station instruction',()=>{
    expect(presentSavedJourneyGuidance(snapshot(),binding,1021)?.subway).toMatchObject({currentStopName:'현재역',remainingStops:1});
    expect(presentSavedJourneyRoutePosition(snapshot(),binding,input,1021)).toMatchObject({legIndex:1,legProgress:0.5,barFraction:0.5});
    expect(presentSavedJourneyStage(snapshot(),binding,input,1021)).toEqual({title:'현재역',action:'다음 역 하차 · 하차 준비',activeLegIndex:1});
});
it('does not move on a clock and hides expired station evidence',()=>{
    expect(presentSavedJourneyRoutePosition(snapshot(),binding,input,1034)).toEqual(presentSavedJourneyRoutePosition(snapshot(),binding,input,1021));
    expect(presentSavedJourneyRoutePosition(snapshot(),binding,input,1035)).toBeNull();
    expect(presentSavedJourneyGuidance(snapshot(),binding,1035)?.subway).toBeUndefined();
});
it('labels the last verified station without displaying it as a live position or repeating an alert',()=>{
    const stale=snapshot({schemaVersion:1,phase:'UNAVAILABLE',quality:'UNCERTAIN',activeLegIndex:0,
        boardingConfirmed:false,rideProgress:null,subway:null,
        lastConfirmedSubway:{stopIndex:1,totalStops:3,stopName:'현재역',confirmedAt:1020}});
    expect(presentSavedJourneyGuidance(stale,binding,1035)?.lastConfirmedSubway?.stopName).toBe('현재역');
    expect(presentSavedJourneyRoutePosition(stale,binding,input,1035)).toBeNull();
    expect(presentSavedJourneyStage(stale,binding,input,1035)).toEqual({title:'마지막 확인 · 현재역',
        action:'현재 위치 재확인 중 · 방금 확인',activeLegIndex:null});
    expect(presentSavedJourneyStage(stale,binding,input,1080)?.action).toContain('1분 전 확인');
    expect(presentSavedJourneyStage(stale,binding,input,1110)?.title).toBe('위치 확인 중');
    const changed={...input,legs:input.legs.map(leg=>leg.index===1?{...leg,stops:leg.stops.map(s=>({...s,name:'다른 역'}))}:leg)};
    expect(presentSavedJourneyStage(stale,binding,changed,1035)?.title).toBe('위치 확인 중');
});
it.each([{schemaVersion:7},{boardingConfirmed:false},{rideProgress:0.9},{activeLegIndex:0},{generation:2},
    {subway:{currentStopIndex:1,totalStops:3,currentStopName:'bad\nname',nextStopName:'하차역'}}])('rejects mismatched or fabricated subway display %j',patch=>{
    expect(presentSavedJourneyGuidance(snapshot(patch),binding,1021)).toBeNull();
});
it('does not attach a station position to a different saved route stop',()=>{
    const changed={...input,legs:input.legs.map(leg=>leg.index===1?{...leg,stops:leg.stops.map(s=>({...s,name:'다른 역'}))}:leg)};
    expect(presentSavedJourneyRoutePosition(snapshot(),binding,changed,1021)).toBeNull();
});
