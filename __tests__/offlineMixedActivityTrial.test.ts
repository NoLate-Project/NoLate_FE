import {createOfflineMixedActivityTrial} from '../src/modules/journey/offlineMixedActivityTrial';
import type {AutomaticJourneyBinding,AutomaticJourneySnapshot} from '../src/modules/journey/automaticJourney';

const context={fixtureOnly:true,offlineActivityFixture:true,extendedNavigationFixture:true,syntheticTransferFixture:true,
    guidancePushRealProvider:false,memberId:7,apiOrigin:'http://127.0.0.1:15546'};
function fixture(){
    let now=1791830000;
    const binding:AutomaticJourneyBinding={sessionId:'aa67598a-6c84-4d0d-8d25-134e0c01c12e',clientOwnerId:'bb67598a-6c84-4d0d-8d25-134e0c01c12e',
        scheduleId:'9001',generation:1,routeRevision:1,routeInputDigest:'a'.repeat(64),preparedAtEpochSeconds:now-10,
        expiresAtEpochSeconds:now+7190,execution:'SIMULATOR',syncScope:'AUTHENTICATED',savedRouteValidated:true,guidanceEnabled:true,
        apiOrigin:context.apiOrigin,authMemberId:7,loginGeneration:2};
    const snapshot={enabled:true,status:'ACTIVE',sessionId:binding.sessionId,routeRevision:1,departureAcknowledged:true,
        guidance:{schemaVersion:1,sessionId:binding.sessionId,scheduleId:'9001',generation:1,routeRevision:1,routeInputDigest:binding.routeInputDigest,
            sequence:1,status:'ACTIVE',phase:'WALKING_TO_STOP',quality:'GOOD',instruction:'승차 정류장으로 이동 중',activeLegIndex:0,
            walkProgress:0.2,observedAt:now,validUntil:now+15,boardingConfirmed:false,arrivalStatus:'UNAVAILABLE',arrival:null}} as unknown as AutomaticJourneySnapshot;
    const read=jest.fn(async()=>snapshot),bound=jest.fn(()=>binding as AutomaticJourneyBinding|null),source=jest.fn();
    const request=jest.fn(async(path:string,body?:Record<string,unknown>):Promise<unknown>=>path==='/__fixture/state'
        ?{offlineActivityFixture:true,guidancePushRealProvider:false,offlineActivityEndState:'ACCEPTED'}
        :{success:true,data:{sessionId:binding.sessionId,deviceVerified:false,...(path.endsWith('/end')?{endQueued:true,providerAccepted:false}
            :{timestamp:body?.timestamp,providerAccepted:true})}});
    const trial=createOfflineMixedActivityTrial({context,source,snapshot:read,binding:bound,request,now:()=>now});
    const advance=(seconds=15)=>{now+=seconds;snapshot.guidance!.sequence=Number(snapshot.guidance!.sequence)+1;
        snapshot.guidance!.observedAt=now;snapshot.guidance!.validUntil=now+15;};
    return {trial,request,read,bound,binding,snapshot,advance,source,now:()=>now};
}
test('construction is inert; armed input waits for GPS departure and server acknowledgement',async()=>{
    const f=fixture();expect(f.read).not.toHaveBeenCalled();expect(f.source).not.toHaveBeenCalled();expect(f.request).not.toHaveBeenCalled();
    f.snapshot.status='ARMED';await f.trial.tick();expect(f.request).not.toHaveBeenCalled();
    f.snapshot.status='ACTIVE';f.snapshot.departureAcknowledged=false;await f.trial.tick();expect(f.request).not.toHaveBeenCalled();
});
test('samples actual content only with synthetic installation credentials and never includes location',async()=>{
    const f=fixture();expect((await f.trial.tick()).status).toBe('OFFLINE_ACCEPTED_NOT_APNS');
    const [path,body]=f.request.mock.calls[0];expect(path).toContain('/9001/automatic-journey/');
    expect(body?.fcmRegistrationToken).toBe('synthetic-offline-installation-not-firebase');expect(body?.liveActivityToken).toBe('a'.repeat(64));
    expect(body?.contentState).toEqual(f.snapshot.guidance);expect(JSON.stringify(body)).not.toContain('latitude');
    await f.trial.tick();expect(f.request).toHaveBeenCalledTimes(1);
    f.advance(14);await f.trial.tick();expect(f.request).toHaveBeenCalledTimes(1);
    f.advance(1);await f.trial.tick();expect(f.request).toHaveBeenCalledTimes(2);
});
test.each(['latitude','longitude','vehicleId','accessToken'])('rejects unexpected %s without publishing',async key=>{
    const f=fixture();f.snapshot.guidance![key]='PRIVATE';expect((await f.trial.tick()).status).toBe('BLOCKED');expect(f.request).not.toHaveBeenCalled();
});
test.each(['latitude','vehicleId','accessToken'])('rejects unexpected nested arrival %s before any transmission',async key=>{
    const f=fixture();f.snapshot.guidance!.arrival={[key]:'PRIVATE'};
    expect((await f.trial.tick()).status).toBe('BLOCKED');expect(f.request).not.toHaveBeenCalled();
});
test('rejects objects hidden in an allowed nested key or primitive progress field',async()=>{
    for(const patch of [{arrival:{providerRouteId:{latitude:37.5}}},{walkProgress:{latitude:37.5}}]){
        const f=fixture();Object.assign(f.snapshot.guidance!,patch);
        expect((await f.trial.tick()).status).toBe('BLOCKED');expect(f.request).not.toHaveBeenCalled();
    }
});
test.each(['arrival','alighting'])('accepts the bounded native %s contract without extra fields',async kind=>{
    const f=fixture();Object.assign(f.snapshot.guidance!,kind==='arrival'
        ?{schemaVersion:7,activeLegIndex:3,phase:'WAITING',walkProgress:1,arrivalStatus:'WAITING_INFORMATION',
            arrival:{busLegIndex:3,providerRouteId:'999999997',directionLabel:'합성 동쪽 방면',sourceUpdatedAt:f.now(),expectedAt:f.now()+120,validUntil:f.now()+120}}
        :{schemaVersion:6,activeLegIndex:3,phase:'RIDING',walkProgress:null,rideProgress:0.5,boardingConfirmed:true,
            alighting:{kind:'ONE_STOP_BEFORE',remainingMeters:500}});
    expect((await f.trial.tick()).status).toBe('OFFLINE_ACCEPTED_NOT_APNS');expect(f.request).toHaveBeenCalledTimes(1);
});
test.each(['offlineActivityFixture','extendedNavigationFixture','syntheticTransferFixture','fixtureOnly'])('requires explicit test context %s',key=>{
    expect(()=>createOfflineMixedActivityTrial({context:{...context,[key]:false},source:jest.fn(),snapshot:jest.fn(),binding:jest.fn()})).toThrow('OFFLINE_ACTIVITY_CONTEXT_REQUIRED');
});
test('rejects real provider or a non-loopback target before any operation',()=>{
    for(const patch of [{guidancePushRealProvider:true},{apiOrigin:'https://example.com'},{memberId:8}])
        expect(()=>createOfflineMixedActivityTrial({context:{...context,...patch},source:jest.fn(),snapshot:jest.fn(),binding:jest.fn()})).toThrow();
});
test('stale evidence is not refreshed or uploaded by sampling',async()=>{
    const f=fixture();f.snapshot.guidance!.validUntil=f.now();await f.trial.tick();expect(f.request).not.toHaveBeenCalled();
});
test('terminal state with no lane sends no END and never starts a session',async()=>{
    const f=fixture();f.snapshot.status='ARMED';await f.trial.tick();f.snapshot.status='STOPPED';f.bound.mockReturnValue(null);
    expect((await f.trial.tick()).status).toBe('NO_ACTIVITY');expect(f.request).not.toHaveBeenCalled();
});
test('keeps only captured cleanup binding after automatic terminal and sends END once',async()=>{
    const f=fixture();await f.trial.tick();f.snapshot.status='STOPPED';f.bound.mockReturnValue(null);
    expect((await f.trial.tick()).status).toBe('END_QUEUED');expect(f.request).toHaveBeenCalledTimes(2);
    expect(f.request.mock.calls[1][0]).toMatch(/\/live-activity\/end$/);
    expect((await f.trial.tick()).status).toBe('END_ACCEPTED');await f.trial.tick();expect(f.request).toHaveBeenCalledTimes(3);
    expect(f.trial.state().ends).toBe(1);
});
test('ambiguous END failure is blocked without blind replay or disclosing provider detail',async()=>{
    const f=fixture();await f.trial.tick();f.snapshot.status='STOPPED';f.request.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER'));
    expect((await f.trial.tick()).status).toBe('BLOCKED');await f.trial.tick();expect(f.request).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.trial.state())).not.toContain('PRIVATE');
});
test('provider receipt is not a device verification and transport rejection consumes its attempt',async()=>{
    const f=fixture();f.request.mockResolvedValueOnce({success:true,data:{sessionId:f.binding.sessionId,timestamp:f.now(),providerAccepted:true,deviceVerified:true}});
    expect((await f.trial.tick()).status).toBe('BLOCKED');await f.trial.tick();expect(f.request).toHaveBeenCalledTimes(1);expect(f.trial.state().updates).toBe(1);
});
test('changed session or binding cannot reuse the offline installation lane',async()=>{
    const f=fixture();await f.trial.tick();f.advance();f.bound.mockReturnValue({...f.binding,generation:2});
    expect((await f.trial.tick()).status).toBe('BLOCKED');expect(f.request).toHaveBeenCalledTimes(1);
});
test('single flight and explicit sampler stop fence late responses without navigation calls',async()=>{
    const f=fixture();let done!:(value:unknown)=>void;f.request.mockImplementationOnce(()=>new Promise(resolve=>{done=resolve;}));
    const running=f.trial.tick();await Promise.resolve();await Promise.resolve();await f.trial.tick();expect(f.request).toHaveBeenCalledTimes(1);
    f.trial.stop();done({success:true});await running;expect(f.trial.state().status).toBe('STOPPED');
});
test('fixed 20 minute and 80 attempt ceiling cannot be renewed by new GPS observations',async()=>{
    const f=fixture();for(let i=0;i<80;i++){await f.trial.tick();f.advance();}
    expect(f.request).toHaveBeenCalledTimes(80);expect((await f.trial.tick()).status).toBe('BLOCKED');
    f.advance();await f.trial.tick();expect(f.request).toHaveBeenCalledTimes(80);
});
