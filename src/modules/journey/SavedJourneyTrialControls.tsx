import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { JourneyRouteInput } from "./journeyRouteInput";
import { useAutomaticJourneyTrial } from "./useAutomaticJourneyTrial";
import { currentJourneyAuthentication, type JourneyAuthenticationSource } from "./automaticJourneyAuthentication";
import { getAutomaticJourneyTrialBinding } from './automaticJourneyTrial';
import { savedJourneyProviderPreflight } from './savedJourneyProviderPreflight';
import {composeServerWalkingInput,requestWalkingContext,requestWalkingSnapshot,savedWalkingBaseJSON} from './serverWalkingSnapshot';
import {JourneyNoticeControls} from './JourneyNoticeControls';
import {journeyNoticeAvailability} from './journeyNoticeAvailability';
import {isAutomaticJourneyDevelopment} from './automaticJourney';

/** Opt-in saved-route entry. Native and server independently enforce execution and account ownership. */
export function SavedJourneyTrialControls({ input:baseInput, savedRoute, authenticatedSchedule, previewAuthenticationSource, showDiagnostics=false, onTrialEnded }: {
    input: JourneyRouteInput | null; savedRoute?: unknown; authenticatedSchedule?: { scheduleId: string; memberId: number };
    /** Internal QA caller only; never installed in real authentication storage. */
    previewAuthenticationSource?: JourneyAuthenticationSource;
    /** Internal simulator screen only: bounded, coordinate/token-free runtime reasons. */
    showDiagnostics?: boolean;
    /** Internal QA: the native remote-push pilot resets when its trial ends. */
    onTrialEnded?: () => void;
}) {
    const [connected,setConnected]=useState<JourneyRouteInput|null>(null);
    const [connecting,setConnecting]=useState(false);
    const [connectionError,setConnectionError]=useState(false);
    const [noticePending,setNoticePending]=useState(false);
    const noticeBusy=useRef(false);
    const noticePendingChanged=useCallback((pending:boolean)=>{noticeBusy.current=pending;setNoticePending(pending);},[]);
    const connectionRevision=useRef(0); const connectionBusy=useRef(false);
    useEffect(()=>{const revision=connectionRevision;++revision.current;setConnected(null);setConnectionError(false);setConnecting(false);
        return ()=>{++revision.current;};},[baseInput,authenticatedSchedule?.scheduleId,authenticatedSchedule?.memberId]);
    const input=connected&&baseInput&&savedWalkingBaseJSON(connected)===savedWalkingBaseJSON(baseInput)?connected:baseInput;
    const memberId = authenticatedSchedule?.memberId;
    const source = useCallback(async (requiredUntilEpochSeconds?: number) => {
        const auth = await (__DEV__ && previewAuthenticationSource ? previewAuthenticationSource(requiredUntilEpochSeconds) : currentJourneyAuthentication(requiredUntilEpochSeconds));
        if (auth.authMemberId !== memberId) throw new Error("AUTOMATIC_AUTH_CHANGED");
        return auth;
    }, [memberId, previewAuthenticationSource]);
    // The owned saved-route entry has the same server/native fences as internal QA.
    // Preview credentials are not a prerequisite for a real account's single subway leg.
    const subwayTrial=isAutomaticJourneyDevelopment()&&!!authenticatedSchedule;
    const preflight = savedJourneyProviderPreflight(input, savedRoute,subwayTrial);
    const issue = preflight.issue;
    const scheduleId = authenticatedSchedule?.scheduleId ?? '9001';
    const scope = authenticatedSchedule ? 'AUTHENTICATED' : 'SANDBOX';
    const trial = useAutomaticJourneyTrial(input, scope, !!issue, scheduleId, authenticatedSchedule ? source : undefined);
    const rejectedSession=useRef<string|null>(null);
    const snapshot=trial.snapshot;
    useEffect(()=>{
        if(!snapshot||!['EXPIRED','STOPPED'].includes(snapshot.status))return;
        const key=`${snapshot.sessionId}:${snapshot.status}:${snapshot.lastErrorCode}`;
        if(rejectedSession.current===key)return;
        rejectedSession.current=key;
        onTrialEnded?.();
        setConnected(null);setConnectionError(['SAVED_SESSION_VALIDATION_REJECTED','SAVED_SESSION_VALIDATION_EXPIRED'].includes(snapshot.lastErrorCode??''));
    },[snapshot,onTrialEnded]);
    const ownsRunning = () => {
        const binding = input ? getAutomaticJourneyTrialBinding(input) : null;
        return binding?.scheduleId === scheduleId && binding.sessionId === trial.snapshot?.sessionId
            && binding.syncScope === scope && binding.savedRouteValidated === true && binding.guidanceEnabled === true
            && (!authenticatedSchedule || binding.authMemberId === memberId);
    };
    const ownRunning = trial.running && ownsRunning();
    const connectWalking=async()=>{
        if(!isAutomaticJourneyDevelopment()||connectionBusy.current||noticeBusy.current||trial.running||trial.pending||!baseInput||!authenticatedSchedule)return;
        connectionBusy.current=true;const revision=connectionRevision.current;setConnecting(true);setConnectionError(false);setConnected(null);
        try {
            const context=await requestWalkingContext(source,Number(authenticatedSchedule.scheduleId));
            const value=await requestWalkingSnapshot(source,context,'issue');if(!value)throw new Error();
            const prepared=composeServerWalkingInput(baseInput,value);
            if(revision===connectionRevision.current)setConnected(prepared);
        } catch {if(revision===connectionRevision.current)setConnectionError(true);}
        finally{connectionBusy.current=false;if(revision===connectionRevision.current)setConnecting(false);}
    };
    const action = (id: string, label: string, disabled: boolean, callback: () => unknown) => <Pressable
        testID={`saved-detail-${id}`} accessibilityRole="button" accessibilityLabel={label}
        disabled={disabled||noticePending} accessibilityState={{ disabled:disabled||noticePending }} onPress={() => { if (!disabled&&!noticeBusy.current) Promise.resolve(callback()).catch(() => undefined); }}
        style={[styles.button, disabled && styles.disabled]}><Text style={styles.label}>{label}</Text></Pressable>;
    const diagnosticCode=(value:unknown)=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/.test(value)?value:'UNAVAILABLE';
    const count=(value:unknown,max=1000)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max?value:0;
    const consentLabel=connected?.walkingSnapshot?.schemaVersion===4?'최대 2시간 위치 안내 시험 동의':'최대 10분 위치 안내 시험 동의';
    return <View testID="saved-detail-controls" style={styles.root}>
        <Text>위치 안내 시험 · {trial.running && !ownRunning ? '다른 경로 안내 중' : trial.snapshot?.status ?? 'IDLE'}</Text>
        <Text>준비는 출발이 아닙니다. GPS 이동으로 출발을 판단합니다.</Text>
        {trial.snapshot?.status==='EXPIRED'&&<Text accessibilityLiveRegion="polite">시험 계약 시간이 만료되어 안내를 종료했어요. 다시 이용하려면 경로를 새로 연결해 주세요.</Text>}
        {!trial.running&&authenticatedSchedule&&baseInput?.provider==='odsay'&&baseInput.legs.length>=3&&baseInput.legs.length<=31
            &&baseInput.legs.length%2===1&&baseInput.legs.every((leg,i)=>leg.index===i&&(i%2===0?leg.kind==='WALK':leg.kind==='BUS'||subwayTrial&&baseInput.legs.length===3&&leg.kind==='SUBWAY'))&&
            action('connect-walking',connecting?'도보 경로 연결 중':'서버 도보 경로 연결',connecting||trial.pending,connectWalking)}
        {connected&&<Text testID="saved-detail-walking-connected">TMAP 도보 연결됨 · 저장된 ODsay 대중교통 경로 유지 · 서버·기기 검사 필요</Text>}
        {connected&&<Text>{connected.walkingSnapshot?.schemaVersion===4
            ?'경로 연결 후 5분 안에 준비해야 합니다. 준비된 안내는 최대 2시간이며 위치·차량 신선도와 서버 재검증·취소·경로 변경 검사는 그대로 유지합니다.'
            :connected.walkingSnapshot?.schemaVersion===3
            ?'경로 연결 후 5분 안에 준비해야 합니다. 준비된 시험 안내는 최대 10분이며 서버 재검증·취소·경로 변경을 계속 확인합니다.'
            :'이번 서버 도보 계약은 발급 후 최대 5분입니다. 준비 대기 시간도 포함하며 계약 만료 시 안내를 종료합니다.'}</Text>}
        {connectionError&&<Text accessibilityLiveRegion="polite">도보 경로를 연결하지 못했어요. 이전 경로로 안내를 시작하지 않아요.</Text>}
        {/* Admission preflight is not the lifetime of an already prepared session.
            Runtime rejection remains visible below and is enforced by server/native. */}
        {!trial.running && issue && <Text testID="saved-detail-unsupported">{issue}</Text>}
        {trial.running && !ownRunning && <Text testID="saved-detail-other-session">다른 경로의 안내를 먼저 종료해 주세요. 이 화면에서는 다른 경로를 변경하거나 종료하지 않아요.</Text>}
        {!trial.running && !issue && !connecting && <>
            <Text>대중교통 경로 시험 · 서버·기기 재검증 후 준비돼요. 현장 GPS 검증 전입니다.</Text>
            <JourneyNoticeControls compact running={trial.running} pending={trial.pending} refresh={trial.refresh}
                selectedMode={trial.snapshot?.guidanceNoticeMode} permission={trial.snapshot?.guidanceNoticePermission} onPendingChange={noticePendingChanged}/>
            {action('assess', '안내 경로 검사', !trial.canAssess, trial.assess)}
            <Pressable testID="saved-detail-consent" accessibilityRole="checkbox" accessibilityLabel={consentLabel}
                disabled={trial.pending || noticePending || !trial.eligible} accessibilityState={{ checked: trial.consented, disabled: trial.pending || noticePending || !trial.eligible }}
                onPress={() => {if(!noticeBusy.current&&!trial.pending&&trial.eligible)trial.setConsented(!trial.consented);}} style={styles.consent}><Text>{trial.consented ? '☑' : '☐'} {consentLabel}</Text></Pressable>
            {action('prepare', '위치 안내 준비', !trial.canPrepare, trial.prepare)}
        </>}
        {ownRunning && action('stop', '위치 안내 종료', trial.pending, () => { if (ownsRunning()) return trial.stop(); })}
        {!trial.running && <View testID="saved-detail-provider-preflight" style={{ gap: 6 }}>
            <Text accessibilityRole="header">실제 경로 연결 전 확인</Text>
            {preflight.checks.map(check => <Text key={check.code} testID={`saved-detail-preflight-${check.code}`}>
                {check.state === 'PRESENT' ? '입력 있음' : check.state === 'MISSING' ? '미확보' : '재검증 필요'} · {check.detail}
            </Text>)}
        </View>}
        {ownRunning&&<Text testID="saved-detail-notice-channel">안내 방식 · {trial.snapshot?.guidanceNoticeMode==='VOICE_AND_NOTIFICATIONS'
            ?'전경 음성 + 알림':trial.snapshot?.guidanceNoticeMode==='NOTIFICATIONS'?'알림':'꺼짐'}</Text>}
        {ownRunning&&journeyNoticeAvailability(trial.snapshot?.guidanceNoticeMode,trial.snapshot?.guidanceNoticePermission)&&
            <Text testID="saved-detail-notice-availability" accessibilityLiveRegion="polite">{journeyNoticeAvailability(trial.snapshot?.guidanceNoticeMode,trial.snapshot?.guidanceNoticePermission)}</Text>}
        {trial.errorCode==='AUTOMATIC_AUTH_LIFETIME_INSUFFICIENT'&&
            <Text accessibilityLiveRegion="polite">로그인 유효기간이 안내 종료 시점까지 충분하지 않아요. 로그인을 갱신한 뒤 다시 준비해 주세요. 위치 안내는 시작하지 않았어요.</Text>}
        {trial.errorCode==='AUTOMATIC_AUTH_REFRESH_UNAVAILABLE'&&
            <Text accessibilityLiveRegion="polite">로그인 갱신에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 준비해 주세요.</Text>}
        {trial.errorCode ? <Text>{trial.errorCode}</Text> : null}
        {!trial.errorCode&&(trial.snapshot?.lastErrorCode||trial.sync.errorCode)&&
            <Text testID="saved-detail-runtime-error">{trial.snapshot?.lastErrorCode??trial.sync.errorCode}</Text>}
        {__DEV__&&showDiagnostics&&<View testID="saved-detail-diagnostics">
            {action('refresh-diagnostics','기기 진단 새로고침',trial.pending,trial.refresh)}
            <Text>남은 시험 시간: {count(trial.snapshot?.remainingSeconds,7200)}초 · 자동 출발: {count(trial.snapshot?.departureCount)}</Text>
            <Text>위치: {diagnosticCode(trial.snapshot?.qualityReason)} · {diagnosticCode(trial.snapshot?.locationState)}</Text>
            {input?.legs.some(leg=>leg.kind==='SUBWAY')
                ?<Text>지하철 탑승: {diagnosticCode(trial.snapshot?.subwayPhase)} · {diagnosticCode(trial.snapshot?.subwayReason)}</Text>
                :<Text>탑승: {diagnosticCode(trial.snapshot?.ridePhase)} · {diagnosticCode(trial.snapshot?.rideReason)} · {count(trial.snapshot?.rideEvidenceCount)}</Text>}
            <Text>하차: {diagnosticCode(trial.snapshot?.separationStatus)} · {diagnosticCode(trial.snapshot?.separationReason)} · {count(trial.snapshot?.separationEvidenceCount)}</Text>
            <Text>환승 도보: {diagnosticCode(trial.snapshot?.transferWalkPhase)} · {diagnosticCode(trial.snapshot?.transferWalkReason)} · {count(trial.snapshot?.transferWalkEvidenceCount)}</Text>
            <Text>차량 조회: {diagnosticCode(input?.legs.some(leg=>leg.kind==='SUBWAY')?trial.snapshot?.subwayTransportState:trial.snapshot?.rideTransportState)}</Text>
            <Text>최종 도보: {diagnosticCode(trial.snapshot?.finalWalkPhase)} · {diagnosticCode(trial.snapshot?.finalWalkReason)} · {count(trial.snapshot?.finalWalkEvidenceCount)}</Text>
            <Text>도착 근거: {count(trial.snapshot?.destinationEvidenceCount)} · 종료 대기: {count(trial.sync.pendingStopCount)}</Text>
            <Text>알림 상태: {diagnosticCode(trial.snapshot?.guidanceNoticeState)} · 권한: {diagnosticCode(trial.snapshot?.guidanceNoticePermission)}</Text>
            <Text>알림 접수: {count(trial.snapshot?.guidanceNoticeScheduledCount)} · 음성 큐: {count(trial.snapshot?.guidanceVoiceQueuedCount)}</Text>
            <Text>원격 Activity: {diagnosticCode(trial.snapshot?.guidancePushState)} · 토큰 {trial.snapshot?.guidancePushTokenAvailable?'발급됨':'없음'} · provider 접수 {count(trial.snapshot?.guidancePushProviderAcceptedCount)}</Text>
        </View>}
    </View>;
}
const styles = StyleSheet.create({ root: { gap: 6, paddingVertical: 8 }, button: { padding: 12, backgroundColor: '#1264C7', borderRadius: 10 },
    disabled: { backgroundColor: '#A8B8CC' }, label: { color: 'white', fontWeight: '600' }, consent: { paddingVertical: 12 } });
