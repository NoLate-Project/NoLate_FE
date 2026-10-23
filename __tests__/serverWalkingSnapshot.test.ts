import {composeServerWalkingInput,parseWalkingSnapshot, requestWalkingContext,requestWalkingSnapshot,savedWalkingBaseJSON} from '../src/modules/journey/serverWalkingSnapshot';
import {savedJourneyProviderFixture} from '../test-support/savedJourneyProviderFixture';
import {savedJourneyProviderPreflight} from '../src/modules/journey/savedJourneyProviderPreflight';
import {journeyAuthentication} from '../src/modules/journey/automaticJourneyAuthentication';
import {Buffer} from 'buffer';
jest.mock('expo-device',()=>({isDevice:false}));
jest.mock('../src/api/env',()=>({getEnv:()=>{throw new Error('NO_NETWORK_KEYS');}}));
const now=1791792000000;
const context={scheduleId:9001,routeRevision:1,routeFingerprint:'a'.repeat(64)};
const identity={authMemberId:7,loginGeneration:0};
const id='12345678-1234-1234-1234-123456789abc';
const data=()=>({schemaVersion:1,snapshotId:id,memberId:7,scheduleId:9001,loginGeneration:0,routeRevision:1,
    routeFingerprint:'a'.repeat(64),issuedAtMs:now,expiresAtMs:now+300000,transitProvider:'odsay',walkProvider:'tmap',
    navigationReady:false,reason:'TRANSIT_ADMISSION_PENDING',walks:[0,2].map(legIndex=>({legIndex,provider:'tmap',
        points:[{lat:37.5665,lng:126.978},{lat:37.5665,lng:126.9785}]}))});
test('v3 preserves a separate bounded navigation lifetime but never renews the five-minute admission window',()=>{
    const value={...data(),schemaVersion:3,navigationExpiresAtMs:now+900000};
    expect(parseWalkingSnapshot(value,context,identity,now).navigationExpiresAtMs).toBe(now+900000);
    expect(()=>parseWalkingSnapshot(value,context,identity,now+300000)).toThrow('INVALID_WALKING_SNAPSHOT');
    for(const patch of [{navigationExpiresAtMs:now+900001},{navigationExpiresAtMs:null},{navigationExpiresAtMs:undefined},
        {schemaVersion:1},{schemaVersion:2}]){
        expect(()=>parseWalkingSnapshot({...value,...patch},context,identity,now)).toThrow('INVALID_WALKING_SNAPSHOT');
    }
});
test('v4 allows exactly two-hour retention without new admission after five minutes or v3 reinterpretation',()=>{
    const value={...data(),schemaVersion:4,navigationExpiresAtMs:now+7500000};
    const parsed=parseWalkingSnapshot(value,context,identity,now+299999);
    expect(parsed.navigationExpiresAtMs).toBe(now+7500000);
    expect(()=>parseWalkingSnapshot(value,context,identity,now+300000)).toThrow('INVALID_WALKING_SNAPSHOT');
    for(const patch of [{navigationExpiresAtMs:now+7500001},{navigationExpiresAtMs:now+900000},
        {navigationExpiresAtMs:null},{schemaVersion:3},{schemaVersion:5}]) {
        expect(()=>parseWalkingSnapshot({...value,...patch},context,identity,now)).toThrow('INVALID_WALKING_SNAPSHOT');
    }
});
function auth(generation=0) {
    const payload={type:'ACCESS',sub:'7',sg:generation,iat:now/1000-10,exp:now/1000+600};
    return journeyAuthentication(`e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.AAA`,'http://127.0.0.1:15546',7,now/1000);
}
const originalFetch=globalThis.fetch; const fetchMock=jest.fn();
beforeEach(()=>{jest.spyOn(Date,'now').mockReturnValue(now);globalThis.fetch=fetchMock;fetchMock.mockReset();});
afterEach(()=>{jest.restoreAllMocks();globalThis.fetch=originalFetch;});
test('copies bounded walking geometry as a separate contract and never grants navigation',()=>{
    const value=data(); const parsed=parseWalkingSnapshot(value,context,identity,now);
    expect(parsed.navigationReady).toBe(false);expect(parsed.walks).toHaveLength(2);
    value.walks[0].points[0].lat=0;expect(parsed.walks[0].points[0].lat).toBe(37.5665);
});
test.each([{snapshotId:'bad'},{memberId:8},{scheduleId:9002},{loginGeneration:1},{routeRevision:2},{routeFingerprint:'b'.repeat(64)},
    {transitProvider:'tmap'},{walkProvider:'odsay'},{navigationReady:true},{reason:'OK'},{schemaVersion:2},
    {issuedAtMs:now+1},{expiresAtMs:now+300001},{walks:[]}])('wrong identity/source/time/schema cannot become a route %j',change=>{
    expect(()=>parseWalkingSnapshot({...data(),...change},context,identity,now)).toThrow('INVALID_WALKING_SNAPSHOT');
});
test.each([now-1,now+300000,NaN])('clock/TTL boundary denies reuse %s',time=>{
    expect(()=>parseWalkingSnapshot(data(),context,identity,time)).toThrow('INVALID_WALKING_SNAPSHOT');
});
test.each(['order','provider','coordinate','gap','duplicate','limit'])('invalid stored path is not repaired %s',mode=>{
    const value=data();
    if(mode==='order') value.walks.reverse();
    if(mode==='provider') value.walks[0].provider='odsay';
    if(mode==='coordinate') value.walks[0].points[0].lat=NaN;
    if(mode==='gap') value.walks[0].points[1].lat=0;
    if(mode==='duplicate') value.walks[0].points[1]={...value.walks[0].points[0]};
    if(mode==='limit') value.walks[0].points=Array(2001).fill(value.walks[0].points[0]);
    expect(()=>parseWalkingSnapshot(value,context,identity,now)).toThrow('INVALID_WALKING_SNAPSHOT');
});
test('authenticated API uses only revision body no geometry cookies redirects retries or native writes',async()=>{
    fetchMock.mockResolvedValue({ok:true,text:async()=>JSON.stringify({success:true,data:data()})});
    const source=jest.fn(async()=>auth());
    expect(await requestWalkingSnapshot(source,context,'issue')).toMatchObject({snapshotId:id,navigationReady:false});
    expect(source).toHaveBeenCalledTimes(3);expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:15546/api/schedules/9001/walking-snapshot',expect.objectContaining({
        method:'POST',credentials:'omit',redirect:'error',body:'{"expectedRevision":1}'}));
});
test('current GET has no TTL refresh body and cancel only uses bound opaque id',async()=>{
    fetchMock.mockResolvedValueOnce({ok:true,text:async()=>JSON.stringify({success:true,data:data()})})
        .mockResolvedValueOnce({ok:true,text:async()=>JSON.stringify({success:true,data:{cancelled:true}})});
    await requestWalkingSnapshot(async()=>auth(),context,'current');
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('body');
    expect(await requestWalkingSnapshot(async()=>auth(),context,'cancel',id)).toBeNull();
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
});
test.each(['redirect','oversized','malformed','unsafe-error','auth-change','body-auth-change'])('network failures never return stale paths %s',async mode=>{
    fetchMock.mockResolvedValue({ok:mode!=='unsafe-error',redirected:mode==='redirect',text:async()=>
        mode==='oversized' ? ' '.repeat(524289) : mode==='malformed' ? '{private' : JSON.stringify(mode==='unsafe-error'
            ? {success:false,errorCode:'private-secret',errorMessage:'private-body'} : {success:true,data:data()})});
    let count=0;const source=async()=>auth(++count >= (mode==='body-auth-change' ? 3 : 2) && ['auth-change','body-auth-change'].includes(mode) ? 1:0);
    await expect(requestWalkingSnapshot(source,context,'current')).rejects.toThrow(mode.includes('auth-change') ? 'AUTOMATIC_AUTH_CHANGED'
        : mode==='unsafe-error' ? 'WALKING_SNAPSHOT_UNAVAILABLE' : 'INVALID_WALKING_SNAPSHOT');
    expect(fetchMock).toHaveBeenCalledTimes(1);
});
test('known denial remains a safe code and invalid cancel/context never makes a request',async()=>{
    fetchMock.mockResolvedValue({ok:false,text:async()=>JSON.stringify({success:false,errorCode:'EXPIRED',errorMessage:'private'})});
    await expect(requestWalkingSnapshot(async()=>auth(),context,'current')).rejects.toThrow('EXPIRED');
    fetchMock.mockClear();
    await expect(requestWalkingSnapshot(async()=>auth(),context,'cancel','../other')).rejects.toThrow('INVALID_WALKING_SNAPSHOT');
    await expect(requestWalkingSnapshot(async()=>auth(),{...context,scheduleId:0},'issue')).rejects.toThrow('INVALID_WALKING_SNAPSHOT');
    expect(fetchMock).not.toHaveBeenCalled();
});
function mixedFixture(){
    const f=savedJourneyProviderFixture();
    for(const i of [0,2])Object.assign(f.input.legs[i],{coordinates:[],geometrySource:'DISPLAY_CONNECTOR',exact:false,geometryInputComplete:false});
    for(const i of [0,2])Object.assign(f.route.transitLegs[i],{pathCoords:[],pathGeometrySource:'DISPLAY_CONNECTOR',pathCoordsIsExact:false,
        navigationEvidence:{...f.route.transitLegs[i].navigationEvidence,geometryInputComplete:false}});
    const raw={...data(),routeRevision:4,walks:[0,2].map(i=>({legIndex:i,provider:'tmap',points:
        [f.input.legs[i].start!,f.input.legs[i].end!].map(p=>({lat:p.latitude,lng:p.longitude}))}))};
    const snapshot=parseWalkingSnapshot(raw,{...context,routeRevision:4},identity,now);
    return {...f,snapshot};
}
test('separate server paths connect missing saved walking geometry without changing any ODsay claims',()=>{
    const f=mixedFixture(),before=JSON.stringify(f.input),saved=JSON.stringify(f.route);
    const input=composeServerWalkingInput(f.input,f.snapshot,now);
    expect(input.routeRevision).toBe(4);expect(input.walkingSnapshot?.navigationReady).toBe(false);
    expect(input.legs).toEqual(f.input.legs);expect(JSON.stringify(f.input)).toBe(before);expect(JSON.stringify(f.route)).toBe(saved);
    expect(savedWalkingBaseJSON(input)).toBe(savedWalkingBaseJSON(f.input));
    expect(savedJourneyProviderPreflight(input,f.route).canAssess).toBe(true);
    expect(savedWalkingBaseJSON({...f.input,routeRevision:2})).not.toBe(savedWalkingBaseJSON(input));
});
test('unverified ODsay service can receive walking geometry without gaining navigation admission',()=>{
    const f=mixedFixture();
    f.input.serviceState='UNKNOWN';
    f.route.transitServiceState='unknown';
    const composed=composeServerWalkingInput(f.input,f.snapshot,now);
    expect(composed.serviceState).toBe('UNKNOWN');
    expect(composed.walkingSnapshot?.navigationReady).toBe(false);
    const preflight=savedJourneyProviderPreflight(composed,f.route);
    expect(preflight.canAssess).toBe(true);
    expect(preflight.checks.find(check=>check.code==='SERVER_NATIVE')?.state).toBe('RECHECK_REQUIRED');
    f.input.serviceState='not_operating';
    expect(()=>composeServerWalkingInput(f.input,f.snapshot,now)).toThrow('INVALID_WALKING_SNAPSHOT');
});
test('centimetre ODsay walk endpoint rounding is accepted without inserting a connector',()=>{
    const f=mixedFixture();
    f.input.legs[0].end!.longitude+=.0000001;
    const composed=composeServerWalkingInput(f.input,f.snapshot,now);
    expect(composed.legs[0].end).toEqual(f.input.legs[0].end);
    expect(composed.walkingSnapshot?.navigationReady).toBe(false);
});
test.each(['tuple','endpoint','expired','bus-provider','stops'])('mixed input rejects %s without repair',mode=>{
    const f=mixedFixture();
    if(mode==='tuple')f.input.legs[0].end!.longitude+=.00003;
    if(mode==='endpoint')f.snapshot.walks[0].points[0].lng+=.001;
    if(mode==='bus-provider')f.input.provider='tmap';
    if(mode==='stops')f.input.legs[1].stops[0].coordinate=null;
    expect(()=>composeServerWalkingInput(f.input,f.snapshot,mode==='expired'?now+300000:now)).toThrow('INVALID_WALKING_SNAPSHOT');
});
test('context GET sends no geometry and rechecks identity after reading body',async()=>{
    fetchMock.mockResolvedValue({ok:true,text:async()=>JSON.stringify({success:true,data:context})});
    const source=jest.fn(async()=>auth());expect(await requestWalkingContext(source,9001)).toEqual(context);
    expect(source).toHaveBeenCalledTimes(2);expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({method:'GET',redirect:'error',credentials:'omit'});
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('body');
    let n=0;await expect(requestWalkingContext(async()=>auth(n++?1:0),9001)).rejects.toThrow('AUTOMATIC_AUTH_CHANGED');
});
test('v2 carries all ordered transfer walks and cannot masquerade as the two-walk contract',()=>{
    const f=mixedFixture(),input=JSON.parse(JSON.stringify(f.input)) as typeof f.input;
    const next=JSON.parse(JSON.stringify(input.legs[1])) as typeof input.legs[number];
    const shift=input.legs[2].end!.longitude-next.start!.longitude;
    const move=(p:typeof next.start)=>p?{...p,longitude:p.longitude+shift}:null;
    next.index=3;next.start=move(next.start);next.end=move(next.end);next.coordinates=next.coordinates.map(move);
    next.stops=next.stops.map(stop=>({...stop,coordinate:move(stop.coordinate)}));
    const last=JSON.parse(JSON.stringify(input.legs[2])) as typeof next;
    const finalShift=next.end!.longitude-last.start!.longitude;
    last.index=4;last.start={...last.start!,longitude:last.start!.longitude+finalShift};last.end={...last.end!,longitude:last.end!.longitude+finalShift};
    input.legs.push(next,last);input.destination=last.end;
    const raw={...data(),schemaVersion:2,walks:[0,2,4].map(i=>({legIndex:i,provider:'tmap',points:[input.legs[i].start!,input.legs[i].end!].map(p=>({lat:p.latitude,lng:p.longitude}))}))};
    const value=parseWalkingSnapshot(raw,context,identity,now);
    expect(composeServerWalkingInput(input,value,now).walkingSnapshot?.schemaVersion).toBe(2);
    for(const bad of [{...raw,schemaVersion:1},{...raw,walks:raw.walks.slice(0,2)},
        {...raw,walks:[raw.walks[0],raw.walks[2],raw.walks[1]]},{...raw,walks:raw.walks.map(w=>w.legIndex===4?{...w,legIndex:6}:w)}]) {
        expect(()=>parseWalkingSnapshot(bad,context,identity,now)).toThrow('INVALID_WALKING_SNAPSHOT');
    }
    expect(()=>composeServerWalkingInput(input,f.snapshot,now)).toThrow('INVALID_WALKING_SNAPSHOT');
});
