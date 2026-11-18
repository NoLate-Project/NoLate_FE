import React from 'react';
import { StyleSheet } from 'react-native';
import TestRenderer,{act,type ReactTestRenderer} from 'react-test-renderer';
import {SavedJourneyTrialControls} from '../src/modules/journey/SavedJourneyTrialControls';
import {savedJourneyProviderFixture} from '../test-support/savedJourneyProviderFixture';
const mockContext=jest.fn(),mockIssue=jest.fn(),mockTrial=jest.fn(),mockNotice=jest.fn(),mockPermission=jest.fn(),mockBinding=jest.fn();
jest.mock('../src/modules/journey/automaticJourney',()=>({...jest.requireActual('../src/modules/journey/automaticJourney'),
    configureAutomaticJourneyNoticeMode:(...args:unknown[])=>mockNotice(...args)}));
jest.mock('../src/modules/notification/pushPermission',()=>({requestPushNotificationPermission:()=>mockPermission()}));
jest.mock('../src/api/env',()=>({getEnv:()=>{throw new Error('NO_KEYS');}}));
jest.mock('../src/modules/journey/useAutomaticJourneyTrial',()=>({useAutomaticJourneyTrial:(...args:unknown[])=>mockTrial(...args)}));
jest.mock('../src/modules/journey/automaticJourneyTrial',()=>({getAutomaticJourneyTrialBinding:()=>mockBinding()}));
jest.mock('../src/modules/journey/serverWalkingSnapshot',()=>({...jest.requireActual('../src/modules/journey/serverWalkingSnapshot'),
    requestWalkingContext:(...args:unknown[])=>mockContext(...args),requestWalkingSnapshot:(...args:unknown[])=>mockIssue(...args)}));
const context={scheduleId:9001,routeRevision:4,routeFingerprint:'a'.repeat(64)};
function setup(){
    const f=savedJourneyProviderFixture(),now=Date.now();
    const snapshot={...context,snapshotId:'12345678-1234-1234-1234-123456789abc',memberId:7,loginGeneration:2,
        issuedAtMs:now,expiresAtMs:now+300000,navigationReady:false,
        walks:[0,2].map(i=>({legIndex:i,provider:'tmap',points:f.input.legs[i].coordinates.map(p=>({lat:p!.latitude,lng:p!.longitude}))}))};
    return {...f,snapshot};
}
beforeEach(()=>{jest.clearAllMocks();mockBinding.mockReturnValue(null);mockContext.mockResolvedValue(context);mockTrial.mockReturnValue({snapshot:{status:'IDLE'},sync:{errorCode:null},
    running:false,pending:false,canAssess:true,canPrepare:false,consented:false,eligible:false,assess:jest.fn(),prepare:jest.fn()});});
const schedule={scheduleId:'9001',memberId:7};
test('an existing checkpoint protects the owned walking route and requires explicit consent to resume',async()=>{
    const f=setup();let view!:ReactTestRenderer;
    const restoreSaved=jest.fn(),setConsented=jest.fn();
    const state={running:false,pending:false,consented:false,snapshot:{status:'IDLE',checkpointAvailable:true},
        sync:{errorCode:null,checkpointState:'CURRENT'},savedCheckpoint:{...schedule,sessionId:'retained'},
        canConsentToSavedRestore:true,canRestoreSaved:false,restoreSaved,setConsented};
    const render=()=> <SavedJourneyTrialControls input={f.input} savedRoute={f.route}
        authenticatedSchedule={schedule} autoPrepareRoute/>;
    mockTrial.mockReturnValue(state);
    await act(async()=>{view=TestRenderer.create(render());});
    expect(mockContext).not.toHaveBeenCalled();expect(mockIssue).not.toHaveBeenCalled();
    expect(view.root.findAllByProps({testID:'saved-detail-prepare'})).toHaveLength(0);
    await act(async()=>view.root.findByProps({testID:'saved-detail-restore'}).props.onPress());
    expect(restoreSaved).not.toHaveBeenCalled();
    await act(async()=>view.root.findByProps({testID:'saved-detail-restore-consent'}).props.onPress());
    expect(setConsented).toHaveBeenCalledWith(true);
    mockTrial.mockReturnValue({...state,consented:true,canRestoreSaved:true});
    await act(async()=>view.update(render()));
    await act(async()=>view.root.findByProps({testID:'saved-detail-restore'}).props.onPress());
    expect(restoreSaved).toHaveBeenCalledTimes(1);
    expect(mockIssue).not.toHaveBeenCalled();act(()=>view.unmount());
});
test('running detail distinguishes selected voice channel from unavailable lock-screen permission',async()=>{
    const f=setup();let view!:ReactTestRenderer;
    mockBinding.mockReturnValue({scheduleId:'9001',sessionId:'synthetic',syncScope:'AUTHENTICATED',savedRouteValidated:true,guidanceEnabled:true,authMemberId:7});
    mockTrial.mockReturnValue({running:true,pending:false,sync:{errorCode:null},snapshot:{status:'ACTIVE',sessionId:'synthetic',
        guidanceNoticeMode:'VOICE_AND_NOTIFICATIONS',guidanceNoticePermission:'NOT_DETERMINED_LOCK_UNSUPPORTED_ALERT_UNSUPPORTED'}});
    await act(async()=>{view=TestRenderer.create(<SavedJourneyTrialControls input={f.input} savedRoute={f.route} authenticatedSchedule={schedule} isDark/>);});
    const text=JSON.stringify(view.toJSON());expect(text).toContain('전경 음성 + 알림');expect(text).toContain('잠금 화면 안내를 받을 수 없어요');
    for (const id of ['saved-detail-notice-channel', 'saved-detail-notice-availability']) {
        expect(StyleSheet.flatten(view.root.findByProps({ testID: id }).props.style).color).toBe('#BCC8D7');
    }
    expect(text).not.toContain('잠금·무음에서는 알림');expect(text).not.toContain('준비는 출발이 아닙니다');
    expect(view.root.findAllByProps({testID:'saved-guidance-notice-expand'})).toHaveLength(0);
    expect(mockPermission).not.toHaveBeenCalled();act(()=>view.unmount());
});
test.each(['ARMED','ACTIVE'])('route header owns the running %s status without hiding the stop control',async status=>{
    const f=setup();let view!:ReactTestRenderer;
    mockBinding.mockReturnValue({scheduleId:'9001',sessionId:'synthetic',syncScope:'AUTHENTICATED',savedRouteValidated:true,guidanceEnabled:true,authMemberId:7});
    mockTrial.mockReturnValue({running:true,pending:false,sync:{errorCode:null},snapshot:{status,sessionId:'synthetic',guidanceNoticeMode:'OFF'}});
    await act(async()=>{view=TestRenderer.create(<SavedJourneyTrialControls input={f.input} savedRoute={f.route}
        authenticatedSchedule={schedule} statusShownInRouteHeader/>);});
    expect(view.root.findAllByProps({testID:'saved-detail-guidance-heading'})).toHaveLength(0);
    expect(view.root.findAllByProps({testID:'saved-detail-stop'}).length).toBeGreaterThan(0);
    expect(view.root.findAllByProps({testID:'saved-detail-notice-channel'}).length).toBeGreaterThan(0);
    act(()=>view.unmount());
});
test('insufficient navigation credential lifetime is explained without claiming GPS has started',async()=>{
    const f=setup();let view!:ReactTestRenderer;
    mockTrial.mockReturnValue({...mockTrial.mock.results.at(-1)?.value,running:false,pending:false,sync:{errorCode:null},
        errorCode:'AUTOMATIC_AUTH_LIFETIME_INSUFFICIENT',snapshot:{status:'IDLE'}});
    await act(async()=>{view=TestRenderer.create(<SavedJourneyTrialControls input={f.input} savedRoute={f.route} authenticatedSchedule={schedule}/>);});
    expect(JSON.stringify(view.toJSON())).toContain('위치 안내는 시작하지 않았어요');
    expect(mockContext).not.toHaveBeenCalled();expect(mockNotice).not.toHaveBeenCalled();act(()=>view.unmount());
});
test('actual detail owns a collapsed explicit notice selection and fences preparation while it is pending',async()=>{
    const f=setup();let view!:ReactTestRenderer;let done!:()=>void;
    const prepare=jest.fn();
    mockNotice.mockImplementation(()=>new Promise<void>(resolve=>{done=resolve;}));
    mockTrial.mockReturnValue({...mockTrial.mock.results.at(-1)?.value,running:false,pending:false,sync:{errorCode:null},
        snapshot:{status:'IDLE',guidanceNoticeMode:'OFF'},canAssess:true,canPrepare:true,prepare,refresh:jest.fn().mockResolvedValue(undefined)});
    await act(async()=>{view=TestRenderer.create(<SavedJourneyTrialControls input={f.input} savedRoute={f.route} authenticatedSchedule={schedule}/>);});
    expect(mockNotice).not.toHaveBeenCalled();expect(mockPermission).not.toHaveBeenCalled();
    expect(view.root.findAllByProps({testID:'saved-guidance-notice-options'})).toHaveLength(0);
    await act(async()=>view.root.findByProps({testID:'saved-guidance-notice-expand'}).props.onPress());
    await act(async()=>view.root.findByProps({testID:'saved-guidance-notice-voice'}).props.onPress());
    expect(view.root.findByProps({testID:'saved-detail-prepare'}).props.disabled).toBe(true);
    await act(async()=>view.root.findByProps({testID:'saved-detail-prepare'}).props.onPress());expect(prepare).not.toHaveBeenCalled();
    await act(async()=>done());
    expect(view.root.findByProps({testID:'saved-detail-prepare'}).props.disabled).toBe(false);
    expect(mockNotice).toHaveBeenCalledWith('VOICE_AND_NOTIFICATIONS');expect(mockPermission).not.toHaveBeenCalled();
    act(()=>view.unmount());
});
test.each(['ARMED','ACTIVE'])('expired admission does not falsely reject an existing %s session in the UI',async status=>{
    const f=setup();
    const input={...f.input,walkingSnapshot:{...f.snapshot,schemaVersion:3 as const,transitProvider:'odsay' as const,
        walkProvider:'tmap' as const,reason:'TRANSIT_ADMISSION_PENDING' as const,navigationReady:false as const,
        issuedAtMs:Date.now()-301000,expiresAtMs:Date.now()-1000,navigationExpiresAtMs:Date.now()+599000,
        walks:f.snapshot.walks.map(w=>({...w,provider:'tmap' as const}))}};
    const render=()=> <SavedJourneyTrialControls input={input} savedRoute={f.route} authenticatedSchedule={schedule}/>;
    mockTrial.mockReturnValue({...mockTrial.mock.results.at(-1)?.value,running:true,pending:false,
        snapshot:{status,sessionId:'synthetic',lastErrorCode:'SAVED_SESSION_VALIDATION_REJECTED'},sync:{errorCode:null}});
    let view!:ReactTestRenderer;await act(async()=>{view=TestRenderer.create(render());});
    expect(view.root.findAllByProps({testID:'saved-detail-unsupported'})).toHaveLength(0);
    expect(JSON.stringify(view.toJSON())).toContain('SAVED_SESSION_VALIDATION_REJECTED');
    expect(view.root.findAllByProps({testID:'saved-detail-prepare'})).toHaveLength(0);
    // This changes display only: expired input still blocks NEW admission.
    expect(mockTrial.mock.calls.at(-1)![2]).toBe(true);
    mockTrial.mockReturnValue({...mockTrial.mock.results.at(-1)!.value,running:false,snapshot:{status:'IDLE'}});
    await act(async()=>view.update(render()));
    expect(view.root.findAllByProps({testID:'saved-detail-unsupported'}).length).toBeGreaterThan(0);
    act(()=>view.unmount());
});
test.each([3,5,7,31])('alternating %i-leg bus route offers explicit walking connection without fetching or arming on mount',async count=>{
    const f=setup();
    const input={...f.input,legs:Array.from({length:count},(_,index)=>({...f.input.legs[index%2],index}))};
    let view!:ReactTestRenderer;
    await act(async()=>{view=TestRenderer.create(<SavedJourneyTrialControls input={input} savedRoute={f.route} authenticatedSchedule={schedule}/>);});
    expect(view.root.findAllByProps({testID:'saved-detail-connect-walking'}).length).toBeGreaterThan(0);
    expect(mockContext).not.toHaveBeenCalled();expect(mockIssue).not.toHaveBeenCalled();
    expect(mockTrial.mock.results.at(-1)!.value.prepare).not.toHaveBeenCalled();
    act(()=>view.unmount());
});
test('explicit connection only supplies separate paths; mount never fetches, arms or advances a phase',async()=>{
    const f=setup();mockIssue.mockResolvedValue(f.snapshot);let view!:ReactTestRenderer;
    await act(async()=>{view=TestRenderer.create(<SavedJourneyTrialControls input={f.input} savedRoute={f.route} authenticatedSchedule={schedule}/>);});
    expect(mockContext).not.toHaveBeenCalled();expect(mockIssue).not.toHaveBeenCalled();
    await act(async()=>{view.root.findByProps({testID:'saved-detail-connect-walking'}).props.onPress();});
    expect(view.root.findAllByProps({testID:'saved-detail-walking-connected'}).length).toBeGreaterThan(0);
    const connected=mockTrial.mock.calls.at(-1)![0];expect(connected.routeRevision).toBe(4);expect(connected.legs).toEqual(f.input.legs);
    expect(connected.walkingSnapshot.navigationReady).toBe(false);
    expect(mockTrial.mock.results.at(-1)!.value.prepare).not.toHaveBeenCalled();
    act(()=>view.unmount());
});
test('connected detail changes its copy after GPS has actually started the owned session',async()=>{
    const f=setup();mockIssue.mockResolvedValue(f.snapshot);let view!:ReactTestRenderer;
    const render=()=> <SavedJourneyTrialControls input={f.input} savedRoute={f.route} authenticatedSchedule={schedule}/>;
    await act(async()=>{view=TestRenderer.create(render());});
    await act(async()=>{view.root.findByProps({testID:'saved-detail-connect-walking'}).props.onPress();});
    expect(JSON.stringify(view.toJSON())).toContain('도보 경로가 준비됐어요');
    mockBinding.mockReturnValue({scheduleId:'9001',sessionId:'synthetic',syncScope:'AUTHENTICATED',savedRouteValidated:true,guidanceEnabled:true,authMemberId:7});
    mockTrial.mockReturnValue({...mockTrial.mock.results.at(-1)!.value,running:true,pending:false,
        snapshot:{status:'ACTIVE',sessionId:'synthetic',guidanceNoticeMode:'OFF'},sync:{errorCode:null}});
    await act(async()=>view.update(render()));
    const active=JSON.stringify(view.toJSON());
    expect(active).toContain('도보 경로가 준비되어 길안내 중이에요');
    expect(active).not.toContain('도보 경로가 준비됐어요');
    expect(active).not.toContain('준비는 출발이 아닙니다');
    act(()=>view.unmount());
});
test('changing route during connection discards late geometry and clears pending presentation',async()=>{
    const f=setup();let resolve!:(v:unknown)=>void;mockIssue.mockReturnValue(new Promise(r=>{resolve=r;}));let view!:ReactTestRenderer;
    const render=(input:typeof f.input)=><SavedJourneyTrialControls input={input} savedRoute={f.route} authenticatedSchedule={schedule}/>;
    await act(async()=>{view=TestRenderer.create(render(f.input));});
    await act(async()=>{view.root.findByProps({testID:'saved-detail-connect-walking'}).props.onPress();});
    const changed={...f.input,routeRevision:2};await act(async()=>view.update(render(changed)));
    expect(view.root.findByProps({testID:'saved-detail-connect-walking'}).props.accessibilityLabel).toBe('도보 경로 준비');
    await act(async()=>resolve(f.snapshot));
    expect(view.root.findAllByProps({testID:'saved-detail-walking-connected'})).toHaveLength(0);
    expect(mockTrial.mock.calls.at(-1)![0]).toBe(changed);act(()=>view.unmount());
});
test('failed replacement removes the previous connected input and never falls back to stale paths',async()=>{
    const f=setup();mockIssue.mockResolvedValueOnce(f.snapshot).mockRejectedValueOnce(new Error('PRIVATE_BODY'));let view!:ReactTestRenderer;
    await act(async()=>{view=TestRenderer.create(<SavedJourneyTrialControls input={f.input} savedRoute={f.route} authenticatedSchedule={schedule}/>);});
    await act(async()=>{view.root.findByProps({testID:'saved-detail-connect-walking'}).props.onPress();});
    await act(async()=>{view.root.findByProps({testID:'saved-detail-connect-walking'}).props.onPress();});
    expect(view.root.findAllByProps({testID:'saved-detail-walking-connected'})).toHaveLength(0);
    expect(mockTrial.mock.calls.at(-1)![0]).toBe(f.input);expect(JSON.stringify(view.toJSON())).not.toContain('PRIVATE_BODY');
    act(()=>view.unmount());
});
test.each(['STOPPED','EXPIRED'])('terminal %s clears connected input once and permits a fresh explicit connection',async status=>{
    const f=setup();mockIssue.mockResolvedValue(f.snapshot);let view!:ReactTestRenderer;
    const render=()=> <SavedJourneyTrialControls input={f.input} savedRoute={f.route} authenticatedSchedule={schedule}/>;
    await act(async()=>{view=TestRenderer.create(render());});
    await act(async()=>{view.root.findByProps({testID:'saved-detail-connect-walking'}).props.onPress();});
    mockTrial.mockReturnValue({...mockTrial.mock.results.at(-1)!.value,snapshot:{status,sessionId:'synthetic',lastErrorCode:status==='STOPPED'?'SAVED_SESSION_VALIDATION_REJECTED':null}});
    await act(async()=>view.update(render()));
    expect(view.root.findAllByProps({testID:'saved-detail-walking-connected'})).toHaveLength(0);
    await act(async()=>{view.root.findByProps({testID:'saved-detail-connect-walking'}).props.onPress();});
    expect(view.root.findAllByProps({testID:'saved-detail-walking-connected'}).length).toBeGreaterThan(0);
    act(()=>view.unmount());
});
test('terminal callback runs once per terminal state even when snapshots refresh',async()=>{
    const f=setup(),ended=jest.fn();let view!:ReactTestRenderer;
    const render=()=> <SavedJourneyTrialControls input={f.input} savedRoute={f.route} authenticatedSchedule={schedule} onTrialEnded={ended}/>;
    await act(async()=>{view=TestRenderer.create(render());});
    const terminal=(status:string)=>({status,sessionId:'synthetic',lastErrorCode:null});
    mockTrial.mockReturnValue({...mockTrial.mock.results.at(-1)!.value,snapshot:terminal('STOPPED')});
    await act(async()=>view.update(render()));
    expect(ended).toHaveBeenCalledTimes(1);
    mockTrial.mockReturnValue({...mockTrial.mock.results.at(-1)!.value,snapshot:terminal('STOPPED')});
    await act(async()=>view.update(render()));
    expect(ended).toHaveBeenCalledTimes(1);
    mockTrial.mockReturnValue({...mockTrial.mock.results.at(-1)!.value,snapshot:terminal('EXPIRED')});
    await act(async()=>view.update(render()));
    expect(ended).toHaveBeenCalledTimes(2);
    act(()=>view.unmount());
});
test('internal diagnostics allow only bounded codes and counts, no location or credentials',async()=>{
    const f=setup();let view!:ReactTestRenderer;
    mockTrial.mockReturnValue({...mockTrial.mock.results.at(-1)?.value,running:false,pending:false,sync:{errorCode:null,pendingStopCount:2},
        snapshot:{status:'IDLE',ridePhase:'PRIVATE token',rideReason:'SAME_VEHICLE',rideEvidenceCount:3,separationEvidenceCount:Infinity,
            accessToken:'DO_NOT_RENDER',latitude:37.5,longitude:126.9}});
    await act(async()=>{view=TestRenderer.create(<SavedJourneyTrialControls input={f.input} savedRoute={f.route} authenticatedSchedule={schedule} showDiagnostics/>);});
    const output=JSON.stringify(view.toJSON());expect(output).toContain('SAME_VEHICLE');expect(output).not.toContain('PRIVATE token');
    expect(output).not.toContain('DO_NOT_RENDER');expect(output).not.toContain('37.5');expect(output).not.toContain('Infinity');
    act(()=>view.unmount());
});
test.each(['DESTINATION_ARRIVED','STOPPED','EXPIRED'])('normal terminal %s clears old walking connection without reporting a failure',async qualityReason=>{
    const f=setup();mockIssue.mockResolvedValue(f.snapshot);let view!:ReactTestRenderer;
    const render=()=> <SavedJourneyTrialControls input={f.input} savedRoute={f.route} authenticatedSchedule={schedule}/>;
    await act(async()=>{view=TestRenderer.create(render());});
    await act(async()=>{view.root.findByProps({testID:'saved-detail-connect-walking'}).props.onPress();});
    mockTrial.mockReturnValue({...mockTrial.mock.results.at(-1)!.value,snapshot:{status:qualityReason==='EXPIRED'?'EXPIRED':'STOPPED',sessionId:'synthetic',qualityReason,lastErrorCode:null}});
    await act(async()=>view.update(render()));
    expect(view.root.findAllByProps({testID:'saved-detail-walking-connected'})).toHaveLength(0);
    expect(JSON.stringify(view.toJSON())).not.toContain('도보 경로를 연결하지 못했어요');
    act(()=>view.unmount());
});
test('arrival keeps the saved route action without showing a new preparation flow', async () => {
    const f = setup(); let view!: ReactTestRenderer;
    mockBinding.mockReturnValue({scheduleId:'9001',sessionId:'synthetic',syncScope:'AUTHENTICATED',
        savedRouteValidated:true,guidanceEnabled:true,authMemberId:7});
    const onViewSavedRoute = jest.fn();
    const render = () => <SavedJourneyTrialControls input={f.input} savedRoute={f.route}
        authenticatedSchedule={schedule} statusShownInRouteHeader onViewSavedRoute={onViewSavedRoute} />;
    mockTrial.mockReturnValue({running:true,pending:false,sync:{errorCode:null},
        snapshot:{status:'ACTIVE',sessionId:'synthetic'}});
    await act(async () => { view=TestRenderer.create(render()); });
    mockTrial.mockReturnValue({...mockTrial.mock.results.at(-1)!.value,running:false,
        snapshot:{status:'STOPPED',sessionId:'synthetic',qualityReason:'DESTINATION_ARRIVED'}});
    await act(async () => view.update(render()));
    const output=JSON.stringify(view.toJSON());
    expect(view.root.findAllByProps({testID:'saved-detail-guidance-heading'})).toHaveLength(0);
    expect(view.root.findAllByProps({testID:'saved-detail-connect-walking'})).toHaveLength(0);
    expect(view.root.findAllByProps({testID:'saved-detail-unsupported'})).toHaveLength(0);
    expect(view.root.findAllByProps({testID:'saved-detail-provider-preflight'})).toHaveLength(0);
    expect(output).not.toContain('위치 안내 준비');
    expect(output).not.toContain('저장한 경로는 계속 볼 수 있어요.');
    await act(async () => view.root.findByProps({testID:'saved-detail-view-saved-route'}).props.onPress());
    expect(onViewSavedRoute).toHaveBeenCalledTimes(1);
    act(() => view.unmount());
});
