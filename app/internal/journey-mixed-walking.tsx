import React,{useRef,useState,useEffect,useMemo,useCallback} from 'react';
import {Redirect} from 'expo-router';
import {Platform,Pressable,ScrollView,Text,View} from 'react-native';
import {ScheduleDetail} from '../schedule/[id]';
import type {ScheduleItem,ScheduleTravelPlan} from '../../src/modules/schedule/types';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {SavedJourneyTrialControls} from '../../src/modules/journey/SavedJourneyTrialControls';
import {SavedJourneyGuidanceCard} from '../../src/modules/journey/SavedJourneyGuidanceCard';
import {buildSavedJourneyInput} from '../../src/modules/journey/savedJourneyGuidance';
import {journeyAuthentication,type JourneyAuthenticationSource} from '../../src/modules/journey/automaticJourneyAuthentication';
import {journeyJSONRequest} from '../../src/modules/journey/journeyJSONRequest';
import {automaticRecord,configureAutomaticJourneyPushPilot,getAutomaticJourneySnapshot} from '../../src/modules/journey/automaticJourney';
import type {JourneyRouteInput} from '../../src/modules/journey/journeyRouteInput';
import {createMixedWalkingFixtureAuthentication,isMixedWalkingRealActivityContext} from '../../src/modules/journey/mixedWalkingFixtureAuthentication';
import {loadJourneyPushInstallation,journeyPushInstallationError} from '../../src/modules/journey/journeyPushInstallation';
import {OfflineMixedActivityControls,useOfflineMixedActivityTrial} from '../../src/modules/journey/OfflineMixedActivityControls';

// Fixed loopback issuer only. No app authentication storage, provider keys or production API.
export default function MixedWalkingRoute(){
    if(!__DEV__||Platform.OS!=='ios')return <Redirect href="/schedule"/>;
    return <MixedWalkingScreen/>;
}
function MixedWalkingScreen(){
    const insets=useSafeAreaInsets(),revision=useRef(0);
    const [value,setValue]=useState<{input:JourneyRouteInput;plan:ScheduleTravelPlan;source:JourneyAuthenticationSource;context:unknown;offlineActivity:boolean;realActivity:boolean}|null>(null);
    const [installationDigest,setInstallationDigest]=useState<string|null>(null);
    const [pushBusy,setPushBusy]=useState(false),[pushError,setPushError]=useState<string|null>(null);
    const [pushReady,setPushReady]=useState(false);
    const offline=useOfflineMixedActivityTrial(value?.context,value?.input??null,value?.source??null);
    const [detail,setDetail]=useState(false);
    const [pending,setPending]=useState(false),[error,setError]=useState<string|null>(null);
    const clearPushReady=useCallback(()=>setPushReady(false),[]);
    useEffect(()=>()=>{++revision.current;},[]);
    async function load(){
        if(pending)return;const requested=++revision.current;setPending(true);setError(null);setValue(null);clearPushReady();
        let stage='CONTEXT';
        try{
            const context=automaticRecord(await journeyJSONRequest('http://127.0.0.1:15546/__fixture/context'));
            if(context?.fixtureOnly!==true||context.memberId!==7||context.apiOrigin!=='http://127.0.0.1:15546'
                ||!(context.guidancePushRealProvider===false||isMixedWalkingRealActivityContext(context)))throw new Error('CONTEXT_INVALID');
            stage='AUTH';const auth=journeyAuthentication(context.accessToken,context.apiOrigin,7);
            const request:RequestInit&{redirect:'error'}={method:'GET',redirect:'error',credentials:'omit',
                headers:{Authorization:`Bearer ${auth.accessToken}`}};
            stage='ROUTE_HTTP';const response=await fetch('http://127.0.0.1:15546/__fixture/saved-route',request);
            const raw=await response.text();if(!response.ok||response.redirected||raw.length>524288)throw new Error('ROUTE_HTTP_INVALID');
            stage='ROUTE_PARSE';const root=automaticRecord(JSON.parse(raw)),plan=automaticRecord(root?.plan);
            stage='ROUTE_INPUT';
            const input=plan&&root?.fixtureOnly===true?buildSavedJourneyInput(plan.route,plan.origin,plan.destination):null;
            if(!input)throw new Error('ROUTE_INPUT_INVALID');
            if(plan?.scheduleId!==9001||plan.memberId!==7||plan.status!=='READY'||plan.travelMode!=='TRANSIT')throw new Error('ROUTE_PLAN_INVALID');
            stage='COMMIT';if(revision.current===requested)setValue({input,plan:plan as unknown as ScheduleTravelPlan,
                source:createMixedWalkingFixtureAuthentication(context),context,offlineActivity:context.offlineActivityFixture===true,
                realActivity:isMixedWalkingRealActivityContext(context)});
        }catch(e){if(revision.current===requested)setError(e instanceof Error && /^(Network request failed|CONTEXT_INVALID|ROUTE_HTTP_INVALID|ROUTE_INPUT_INVALID|ROUTE_PLAN_INVALID|FAILED_TO_FETCH)$/.test(e.message)
            ? e.message : stage);}
        finally{if(revision.current===requested)setPending(false);}
    }
    const item=useMemo<ScheduleItem|null>(()=>value?({id:'9001',ownerMemberId:7,scheduleType:'ROUTE',
        title:value.input.legs[1]?.kind==='SUBWAY'?'지하철 GPS · 실제 상세 연결 시험':'5구간 GPS · 실제 상세 컴포넌트 시험',
        startAt:new Date(Date.now()+3600000).toISOString(),endAt:new Date(Date.now()+7200000).toISOString(),
        category:{id:'fixture',title:'합성 시험',color:'#1264C7'},travelMode:'TRANSIT',
        origin:value.plan.origin??undefined,destination:value.plan.destination??undefined,route:value.plan.route,
        notificationEnabled:false}):null,[value]);
    if(detail&&value&&item)return <View style={{flex:1}}>
        <ScheduleDetail previewItem={item} previewCurrentMemberId={7} initialSheetMode="expanded" previewOfflineGuidanceMap
            previewGuidanceAuthenticationSource={value.source}/>
        <Pressable accessibilityRole="button" accessibilityLabel="GPS 시험 진단으로 돌아가기" onPress={()=>setDetail(false)}
            style={{position:'absolute',top:insets.top+5,right:10,zIndex:10000,padding:12,backgroundColor:'#1264C7',borderRadius:10}}>
            <Text style={{color:'white'}}>시험 진단</Text>
        </Pressable>
    </View>;
    return <ScrollView style={{flex:1,backgroundColor:'white'}} contentContainerStyle={{padding:20,paddingTop:insets.top+20,paddingBottom:insets.bottom+20,gap:12}}>
        <Text accessibilityRole="header" style={{fontSize:23,fontWeight:'700'}}>서버 도보 · GPS 연결 시험</Text>
        <Text>독립 H2·합성 경로/GPS 시험입니다. {value?.realActivity?'지정된 시험 설치 한 대에만 실제 Firebase/APNs를 발송합니다. 최초 카드 이후 로컬 갱신은 끕니다.':'실제 APNs 발송은 연결하지 않았습니다.'} 운영 DB·실사용 일정은 변경하지 않습니다.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="시험 시뮬레이터 APNs 등록 · 설치 지문 확인" disabled={pushBusy||pending}
            onPress={async()=>{if(pushBusy)return;setPushBusy(true);setPushError(null);try{
                const s=await getAutomaticJourneySnapshot();if(['ARMED','ACTIVE'].includes(s.status))throw Error('ACTIVE_TRIAL');
                setInstallationDigest((await loadJourneyPushInstallation()).digest);
            }catch(e){setPushError(journeyPushInstallationError(e));}finally{setPushBusy(false);}}}
            style={{padding:14,backgroundColor:'#1264C7',borderRadius:12}}><Text style={{color:'white'}}>시험 APNs 등록 · 설치 지문 확인</Text></Pressable>
        {installationDigest&&<Text selectable>시험 설치 SHA-256: {installationDigest}</Text>}
        {pushError&&<Text accessibilityLiveRegion="polite">{pushError}</Text>}
        {value?.realActivity&&<Pressable accessibilityRole="button" accessibilityLabel="지정된 시험 설치로 실제 APNs 연결"
            disabled={pushBusy||!installationDigest} onPress={async()=>{if(pushBusy)return;setPushBusy(true);setPushReady(false);setPushError(null);
                try{const installation=await loadJourneyPushInstallation();
                    if(installation.digest!==installationDigest||installation.digest!==automaticRecord(value.context)?.allowedInstallationDigest)
                        throw Error('APNS_TEST_DIGEST_INVALID');
                    await configureAutomaticJourneyPushPilot(installation.token);setPushReady(true);
                }catch(e){setPushError(journeyPushInstallationError(e));}finally{setPushBusy(false);}}}
            style={{padding:14,backgroundColor:'#1264C7',borderRadius:12}}><Text style={{color:'white'}}>실제 APNs 연결 · 로컬 갱신 끄기</Text></Pressable>}
        {value?.realActivity&&<Text>원격 시험 연결: {pushReady?'설정됨 · 준비 후 GPS로 출발':'준비 전 연결 필요'} · 수신 성공은 잠금 화면으로 별도 확인합니다.</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="시험 저장 경로 불러오기" disabled={pending} onPress={load}
            style={{padding:14,backgroundColor:'#1264C7',borderRadius:12}}><Text style={{color:'white'}}>{pending?'불러오는 중':'시험 저장 경로 불러오기'}</Text></Pressable>
        {error&&<Text>시험 서버 연결 실패 ({error}) · 이전 입력으로 시작하지 않습니다.</Text>}
        {value&&<>{value.offlineActivity&&<OfflineMixedActivityControls trial={offline}/>}<SavedJourneyGuidanceCard input={value.input} scheduleId="9001"/>
            <Pressable accessibilityRole="button" accessibilityLabel={value.input.legs[1]?.kind==='SUBWAY'?'지하철 실제 경로 상세 열기':'5구간 실제 경로 상세 열기'} onPress={()=>setDetail(true)}
                style={{padding:14,backgroundColor:'#1264C7',borderRadius:12}}><Text style={{color:'white'}}>{value.input.legs[1]?.kind==='SUBWAY'?'지하철 실제 경로 상세 열기':'5구간 실제 경로 상세 열기'}</Text></Pressable>
            <SavedJourneyTrialControls input={value.input} savedRoute={value.plan.route} authenticatedSchedule={{scheduleId:'9001',memberId:7}}
                previewAuthenticationSource={value.source} showDiagnostics onTrialEnded={clearPushReady}/></>}
    </ScrollView>;
}
