import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
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
export function SavedJourneyTrialControls({ input:baseInput, savedRoute, authenticatedSchedule, previewAuthenticationSource, showDiagnostics=false, onTrialEnded, onViewSavedRoute, isDark=false }: {
    input: JourneyRouteInput | null; savedRoute?: unknown; authenticatedSchedule?: { scheduleId: string; memberId: number };
    /** Internal QA caller only; never installed in real authentication storage. */
    previewAuthenticationSource?: JourneyAuthenticationSource;
    /** Internal simulator screen only: bounded, coordinate/token-free runtime reasons. */
    showDiagnostics?: boolean;
    /** Internal QA: the native remote-push pilot resets when its trial ends. */
    onTrialEnded?: () => void;
    onViewSavedRoute?: () => void;
    isDark?: boolean;
}) {
    const [connected,setConnected]=useState<JourneyRouteInput|null>(null);
    const [connecting,setConnecting]=useState(false);
    const [connectionError,setConnectionError]=useState(false);
    const [checksExpanded, setChecksExpanded] = useState(showDiagnostics);
    const [noticePending,setNoticePending]=useState(false);
    const noticeBusy=useRef(false);
    const noticePendingChanged=useCallback((pending:boolean)=>{noticeBusy.current=pending;setNoticePending(pending);},[]);
    const connectionRevision=useRef(0); const connectionBusy=useRef(false);
    // A schedule refresh creates a new input object even when its saved route
    // is byte-for-byte unchanged. Keep the owned walking snapshot for that same
    // route; invalidate it only when the actual saved input or owner changes.
    const baseRouteIdentity=useMemo(()=>baseInput?savedWalkingBaseJSON(baseInput):null,[baseInput]);
    useEffect(()=>{const revision=connectionRevision;++revision.current;setConnected(null);setConnectionError(false);setConnecting(false);
        return ()=>{++revision.current;};},[baseRouteIdentity,authenticatedSchedule?.scheduleId,authenticatedSchedule?.memberId]);
    const input=connected&&baseInput&&savedWalkingBaseJSON(connected)===baseRouteIdentity?connected:baseInput;
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
    const lastOwnedSession = useRef<{ scheduleId: string; sessionId: string; route: string | null; memberId?: number } | null>(null);
    useEffect(() => {
        if (ownRunning && snapshot?.sessionId) {
            lastOwnedSession.current = { scheduleId, sessionId: snapshot.sessionId, route: baseRouteIdentity, memberId };
        }
    }, [ownRunning, snapshot?.sessionId, scheduleId, baseRouteIdentity, memberId]);
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
    const previous = lastOwnedSession.current;
    const endedHere = !trial.running && previous?.scheduleId === scheduleId
        && previous.route === baseRouteIdentity && previous.memberId === memberId
        && previous.sessionId === snapshot?.sessionId
        && (snapshot?.status === 'EXPIRED' || snapshot?.status === 'STOPPED');
    const heading = ownRunning ? (snapshot?.status === 'ARMED' ? '출발 대기' : '위치 안내 중')
        : endedHere ? '위치 안내가 끝났어요' : '위치 안내 설정';
    const descriptionStyle = [styles.explanation, isDark && styles.explanationDark];
    return <View testID="saved-detail-controls" style={styles.root}>
        <Animated.View key={heading} entering={headingEntrance}>
            <Text testID="saved-detail-guidance-heading" accessibilityRole="header" accessibilityLiveRegion="polite"
                style={[styles.heading, isDark && styles.headingDark]}>{heading}</Text>
        </Animated.View>
        {!trial.running && <Text style={descriptionStyle}>
            {endedHere ? '저장한 경로는 계속 볼 수 있어요.' : '준비를 마치면 위치를 확인해 출발과 이동 구간을 안내해요.'}
        </Text>}
        {endedHere && onViewSavedRoute && action('view-saved-route', '저장한 경로 보기', false, onViewSavedRoute)}
        {endedHere && snapshot?.status === 'EXPIRED' && <Text style={descriptionStyle}>이용 시간이 끝났어요. 다시 안내받으려면 경로를 새로 연결해 주세요.</Text>}
        {!trial.running&&authenticatedSchedule&&baseInput?.provider==='odsay'&&baseInput.legs.length>=3&&baseInput.legs.length<=31
            &&baseInput.legs.length%2===1&&baseInput.legs.every((leg,i)=>leg.index===i&&(i%2===0?leg.kind==='WALK':leg.kind==='BUS'||subwayTrial&&baseInput.legs.length===3&&leg.kind==='SUBWAY'))&&
            action('connect-walking',connecting?'도보 경로 연결 중':'서버 도보 경로 연결',connecting||trial.pending,connectWalking)}
        {connected&&<Text testID="saved-detail-walking-connected">TMAP 도보 연결됨 · 저장된 ODsay 대중교통 경로 유지 · {ownRunning?'서버·기기 검사 완료':'서버·기기 검사 필요'}</Text>}
        {connected&&<Text>{connected.walkingSnapshot?.schemaVersion===4
            ?'경로 연결 후 5분 안에 준비해야 합니다. 준비된 안내는 최대 2시간이며 위치·차량 신선도와 서버 재검증·취소·경로 변경 검사는 그대로 유지합니다.'
            :connected.walkingSnapshot?.schemaVersion===3
            ?'경로 연결 후 5분 안에 준비해야 합니다. 준비된 시험 안내는 최대 10분이며 서버 재검증·취소·경로 변경을 계속 확인합니다.'
            :'이번 서버 도보 계약은 발급 후 최대 5분입니다. 준비 대기 시간도 포함하며 계약 만료 시 안내를 종료합니다.'}</Text>}
        {connectionError&&<Text accessibilityLiveRegion="polite">도보 경로를 연결하지 못했어요. 이전 경로로 안내를 시작하지 않아요.</Text>}
        {/* Admission preflight is not the lifetime of an already prepared session.
            Runtime rejection remains visible below and is enforced by server/native. */}
        {!trial.running && issue && <Text style={descriptionStyle} testID="saved-detail-unsupported">{issue}</Text>}
        {trial.running && !ownRunning && <Text style={descriptionStyle} testID="saved-detail-other-session">다른 경로의 안내를 먼저 종료해 주세요.</Text>}
        {!trial.running && !issue && !connecting && <>
            <JourneyNoticeControls compact isDark={isDark} running={trial.running} pending={trial.pending} refresh={trial.refresh}
                selectedMode={trial.snapshot?.guidanceNoticeMode} permission={trial.snapshot?.guidanceNoticePermission} onPendingChange={noticePendingChanged}/>
            {action('assess', '안내 경로 검사', !trial.canAssess, trial.assess)}
            <Pressable testID="saved-detail-consent" accessibilityRole="checkbox" accessibilityLabel={consentLabel}
                disabled={trial.pending || noticePending || !trial.eligible} accessibilityState={{ checked: trial.consented, disabled: trial.pending || noticePending || !trial.eligible }}
                onPress={() => {if(!noticeBusy.current&&!trial.pending&&trial.eligible)trial.setConsented(!trial.consented);}} style={styles.consent}><Text style={descriptionStyle}>{trial.consented ? '☑' : '☐'} {consentLabel}</Text></Pressable>
            {action('prepare', '위치 안내 준비', !trial.canPrepare, trial.prepare)}
        </>}
        {ownRunning && action('stop', '위치 안내 종료', trial.pending, () => { if (ownsRunning()) return trial.stop(); })}
        {!trial.running && <View testID="saved-detail-provider-preflight" style={styles.root}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: checksExpanded }}
                accessibilityLabel="경로 연결 상태" onPress={() => setChecksExpanded(value => !value)} style={styles.checksToggle}>
                <Text style={[styles.checksLabel, isDark && styles.checksLabelDark]}>경로 연결 상태</Text>
                <Text style={descriptionStyle}>{checksExpanded ? '접기' : '보기'}</Text>
            </Pressable>
            {checksExpanded && <Animated.View entering={headingEntrance} style={styles.checksList}>
                {preflight.checks.map(check => <Text style={descriptionStyle} key={check.code} testID={`saved-detail-preflight-${check.code}`}>
                    {check.state === 'PRESENT' ? '입력 있음' : check.state === 'MISSING' ? '미확보' : '재검증 필요'} · {check.detail}
                </Text>)}
            </Animated.View>}
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
const headingEntrance = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const styles = StyleSheet.create({ root: { gap: 8, paddingVertical: 10 },
    heading: { color: '#111827', fontSize: 17, fontWeight: '700' }, headingDark: { color: '#F3F4F6' },
    explanation: { color: '#475569', fontSize: 13 }, explanationDark: { color: '#BCC8D7' },
    checksToggle: { minHeight: 44, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    checksLabel: { color: '#1264C7', fontSize: 14, fontWeight: '600' }, checksLabelDark: { color: '#78B4FF' },
    checksList: { gap: 8 },
    button: { minHeight: 44, justifyContent: 'center', padding: 12, backgroundColor: '#1264C7', borderRadius: 10 },
    disabled: { backgroundColor: '#A8B8CC' }, label: { color: 'white', fontWeight: '600' }, consent: { paddingVertical: 12 } });
