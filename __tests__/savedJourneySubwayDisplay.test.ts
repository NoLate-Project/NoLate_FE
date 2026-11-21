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

const transferInput = {
    ...input, legs: ['WALK', 'SUBWAY', 'WALK', 'SUBWAY', 'WALK'].map((kind, index) => ({
        index, kind, stops: (index === 1 ? ['서울역', '명동', '충무로'] : index === 3 ? ['충무로', '안국', '경복궁'] : []).map(name => ({ name })),
        display: { lineName: index === 1 ? '4호선' : index === 3 ? '3호선' : null },
    })),
} as JourneyRouteInput;
function transferSnapshot(patch: Record<string, unknown>) {
    const s = snapshot(patch);
    s.guidanceRoute = { ...binding, legs: transferInput.legs.map(leg => ({ index: leg.index, kind: leg.kind,
        walkingLengthMeters: 100, lineName: leg.display?.lineName, boardingStopName: leg.stops[0]?.name })) };
    return s;
}

it('shows the upcoming transfer on line 4, then projects the platform, train and final walk onto line 3', () => {
    const stage = (patch: Record<string, unknown>) => presentSavedJourneyStage(transferSnapshot(patch), binding, transferInput, 1021);
    const walking = { boardingConfirmed: false, subway: null, rideProgress: null, walkProgress: 0.5 };
    expect(stage({ subway: { currentStopIndex: 1, totalStops: 3, currentStopName: '명동', nextStopName: '충무로' } }))
        .toEqual({ title: '명동', action: '다음 충무로 하차 · 3호선 환승', activeLegIndex: 1 });
    expect(stage({ ...walking, phase: 'TRANSFER_WALK', schemaVersion: 5, activeLegIndex: 2 }))
        .toEqual({ title: '충무로 환승', action: '3호선 승차 · 환승 도보 약 50m', activeLegIndex: 2 });
    const waiting = transferSnapshot({ ...walking, phase: 'WAITING', schemaVersion: 7, activeLegIndex: 3,
        walkProgress: 1, arrivalStatus: 'WAITING_INFORMATION', arrival: { kind: 'SUBWAY', busLegIndex: 3,
            providerRouteId: '1000:3', directionLabel: '대화 방면', sourceUpdatedAt: 1020, expectedAt: 1140, validUntil: 1140 } });
    expect(presentSavedJourneyStage(waiting, binding, transferInput, 1021)).toMatchObject({ title: '충무로', action: expect.stringContaining('열차 대기'), activeLegIndex: 3 });
    expect(presentSavedJourneyRoutePosition(waiting, binding, transferInput, 1021)).toMatchObject({ legIndex: 2, waiting: true });
    expect(presentSavedJourneyGuidance(waiting, binding, 1021)?.arrival?.remainingSeconds).toBe(119);
    expect(stage({ activeLegIndex: 3, subway: { currentStopIndex: 1, totalStops: 3, currentStopName: '안국', nextStopName: '경복궁' } }))
        .toMatchObject({ title: '안국', activeLegIndex: 3 });
    expect(stage({ ...walking, phase: 'FINAL_WALK', schemaVersion: 6, activeLegIndex: 4 }))
        .toMatchObject({ title: '목적지까지', activeLegIndex: 4 });
});

it('keeps a stale second-line station as history without a marker and rejects a mismatched occurrence', () => {
    const history = { schemaVersion: 1, phase: 'UNAVAILABLE', quality: 'UNCERTAIN', boardingConfirmed: false,
        rideProgress: null, subway: null, lastConfirmedSubway: { stopIndex: 1, totalStops: 3, stopName: '안국', confirmedAt: 1020 } };
    const second = transferSnapshot({ ...history, activeLegIndex: 3 });
    expect(presentSavedJourneyStage(second, binding, transferInput, 1036)?.title).toBe('마지막 확인 · 안국');
    expect(presentSavedJourneyRoutePosition(second, binding, transferInput, 1036)).toBeNull();
    for (const index of [0, 2, 5]) {
        expect(presentSavedJourneyStage(transferSnapshot({ ...history, activeLegIndex: index }), binding, transferInput, 1036)?.title)
            .toBe('위치 확인 중');
    }
});

const betweenStations = {
    schemaVersion:9, phase:'RIDING_SEGMENT', activeLegIndex:1, quality:'GOOD', subway:null,
    rideProgress:0.7, subwaySegment:{fromStopIndex:1,totalStops:3,fromStopName:'명동',toStopName:'충무로',
        progress:0.4,confirmedAt:1014}, observedAt:1020, validUntil:1035,
};

it('moves within an admitted pair of adjacent stations only when a fresh GPS-backed segment changes', () => {
    const current = transferSnapshot(betweenStations);
    expect(presentSavedJourneyStage(current,binding,transferInput,1021)).toMatchObject({
        title:'명동 → 충무로', action:expect.stringMatching(/다음 충무로 하차.*3호선 환승/)});
    const anchor = presentSavedJourneyRoutePosition(current,binding,transferInput,1021)!;
    expect(anchor.legProgress).toBeCloseTo(0.7);
    expect(presentSavedJourneyRoutePosition(current,binding,transferInput,1034)).toEqual(anchor);
    const moved = transferSnapshot({...betweenStations,rideProgress:0.85, observedAt:1023,validUntil:1038,
        subwaySegment:{...betweenStations.subwaySegment,progress:0.7}});
    expect(presentSavedJourneyRoutePosition(moved,binding,transferInput,1024)!.barFraction).toBeGreaterThan(anchor.barFraction);
    expect(presentSavedJourneyRoutePosition(current,binding,transferInput,1035)).toBeNull();
    expect(presentSavedJourneyStage(current,binding,transferInput,1035)?.title).toBe('마지막 확인 · 명동');
    expect(presentSavedJourneyStage(current,binding,transferInput,1104)?.title).toBe('위치 확인 중');
});

it('requires original station confirmation, matching adjacent names, the correct leg and original evidence expiry', () => {
    for (const patch of [
        {subwaySegment:{...betweenStations.subwaySegment,confirmedAt:1040}},
        {subwaySegment:{...betweenStations.subwaySegment,confirmedAt:900}},
        {subwaySegment:{...betweenStations.subwaySegment,fromStopName:'안국'}},
        {subwaySegment:{...betweenStations.subwaySegment,toStopName:'경복궁'}},
        {subwaySegment:{...betweenStations.subwaySegment,unexpected:'raw'}},
        {activeLegIndex:3}, {phase:'RIDING'}, {schemaVersion:8}, {boardingConfirmed:false},
        {rideProgress:0.71}, {validUntil:1060}, {observedAt:1120,validUntil:1135},
        {subway:{currentStopName:'충무로'}},
    ]) {
        expect(presentSavedJourneyRoutePosition(transferSnapshot({...betweenStations,...patch}),binding,transferInput,1021)).toBeNull();
    }
});
