import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import type { JourneyRouteInput } from "./journeyRouteInput";
import { useAutomaticJourneyTrial } from "./useAutomaticJourneyTrial";
import { currentJourneyAuthentication } from "./automaticJourneyAuthentication";
import { getAutomaticJourneyTrialBinding } from './automaticJourneyTrial';
import { supportsSavedTransitLegs } from './savedJourneyEntry';
import { savedJourneyProviderPreflight } from './savedJourneyProviderPreflight';
import {composeServerWalkingInput,requestWalkingContext,requestWalkingSnapshot,savedWalkingBaseJSON} from './serverWalkingSnapshot';
import { JourneyNavigationOptions } from './JourneyNavigationOptions';
import {JourneyNoticeControls} from './JourneyNoticeControls';
import {journeyNoticeAvailability} from './journeyNoticeAvailability';
import {isAutomaticJourneyDevelopment} from './automaticJourney';
import {presentSavedJourneyGuidance} from './savedJourneyGuidance';

export type SavedDepartureRequest = { scope: string; signal: AbortSignal; claimed: boolean };

/** Opt-in saved-route entry. Native and server independently enforce execution and account ownership. */
export function SavedJourneyTrialControls({ input:baseInput, savedRoute, authenticatedSchedule, showDiagnostics=false, autoPrepareRoute=false, departureRequest, navigationMenu, statusShownInRouteHeader=false, onTrialEnded, isDark=false }: {
    input: JourneyRouteInput | null; savedRoute?: unknown; authenticatedSchedule?: { scheduleId: string; memberId: number };
    /** Internal simulator screen only: bounded, coordinate/token-free runtime reasons. */
    showDiagnostics?: boolean;
    /** A deliberate navigation entry may fetch owned walking geometry and assess it before consent. */
    autoPrepareRoute?: boolean;
    departureRequest?: SavedDepartureRequest;
    navigationMenu?: { open: boolean; close: () => void };
    /** The active route header already announces the current guidance stage. */
    statusShownInRouteHeader?: boolean;
    /** Reports the end of this screen's owned guidance session. */
    onTrialEnded?: (outcome: { status: 'STOPPED' | 'EXPIRED'; reason: string }) => void;
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
    const autoConnectionKey = useRef<string | null>(null);
    // A schedule refresh creates a new input object even when its saved route
    // is byte-for-byte unchanged. Keep the owned walking snapshot for that same
    // route; invalidate it only when the actual saved input or owner changes.
    const baseRouteIdentity=useMemo(()=>baseInput?savedWalkingBaseJSON(baseInput):null,[baseInput]);
    useEffect(() => {
        const revision = connectionRevision;
        ++revision.current;
        connectionBusy.current = false;
        autoConnectionKey.current = null;
        setConnected(null);
        setConnectionError(false);
        setConnecting(false);
        return () => { ++revision.current; };
    }, [baseRouteIdentity, authenticatedSchedule?.scheduleId, authenticatedSchedule?.memberId]);
    const input=connected&&baseInput&&savedWalkingBaseJSON(connected)===baseRouteIdentity?connected:baseInput;
    const memberId = authenticatedSchedule?.memberId;
    const source = useCallback(async (requiredUntilEpochSeconds?: number) => {
        const auth = await currentJourneyAuthentication(requiredUntilEpochSeconds);
        if (auth.authMemberId !== memberId) throw new Error("AUTOMATIC_AUTH_CHANGED");
        return auth;
    }, [memberId]);
    // The owned saved-route entry has the same server/native fences as internal QA.
    const subwayTrial=isAutomaticJourneyDevelopment()&&!!authenticatedSchedule;
    const preflight = savedJourneyProviderPreflight(input, savedRoute,subwayTrial);
    const issue = preflight.issue;
    const scheduleId = authenticatedSchedule?.scheduleId ?? '9001';
    const ownedSchedule = !!authenticatedSchedule;
    const canConnectWalking = ownedSchedule && baseInput?.provider === 'odsay' && supportsSavedTransitLegs(baseInput.legs, subwayTrial);
    const scope = authenticatedSchedule ? 'AUTHENTICATED' : 'SANDBOX';
    const trial = useAutomaticJourneyTrial(input, scope, !!issue, scheduleId, authenticatedSchedule ? source : undefined, memberId);
    const rejectedSession=useRef<string|null>(null);
    const snapshot=trial.snapshot;
    const checkpointState = trial.sync?.checkpointState;
    const checkingCheckpoint = ownedSchedule && !trial.running &&
        (!snapshot || snapshot.checkpointAvailable || checkpointState === 'CHECKING' ||
            checkpointState === 'WAITING' || checkpointState === 'BLOCKED');
    const displayed = presentSavedJourneyGuidance(snapshot,input ? getAutomaticJourneyTrialBinding(input) : null,Date.now()/1000);
    const ownsRunning = () => {
        const binding = input ? getAutomaticJourneyTrialBinding(input) : null;
        return binding?.scheduleId === scheduleId && binding.sessionId === trial.snapshot?.sessionId
            && binding.syncScope === scope && binding.savedRouteValidated === true && binding.guidanceEnabled === true
            && (!authenticatedSchedule || binding.authMemberId === memberId);
    };
    const ownsSnapshot = ownsRunning();
    const ownRunning = trial.running && ownsSnapshot;
    const lastOwnedSession = useRef<{ scheduleId: string; sessionId: string; route: string | null; memberId?: number } | null>(null);
    useEffect(() => {
        if (ownRunning && snapshot?.sessionId) {
            lastOwnedSession.current = { scheduleId, sessionId: snapshot.sessionId, route: baseRouteIdentity, memberId };
        }
    }, [ownRunning, snapshot?.sessionId, scheduleId, baseRouteIdentity, memberId]);
    useEffect(()=>{
        if(!snapshot||!['EXPIRED','STOPPED'].includes(snapshot.status))return;
        const previous=lastOwnedSession.current;
        const wasOwned=previous?.scheduleId===scheduleId && previous.memberId===memberId
            && previous.route===baseRouteIdentity && previous.sessionId===snapshot.sessionId;
        if(!ownsSnapshot&&!wasOwned)return;
        const key=`${snapshot.sessionId}:${snapshot.status}:${snapshot.lastErrorCode}`;
        if(rejectedSession.current===key)return;
        rejectedSession.current=key;
        onTrialEnded?.({ status: snapshot.status as 'STOPPED' | 'EXPIRED', reason: snapshot.qualityReason });
        setConnected(null);setConnectionError(['SAVED_SESSION_VALIDATION_REJECTED','SAVED_SESSION_VALIDATION_EXPIRED'].includes(snapshot.lastErrorCode??''));
    },[snapshot,onTrialEnded,ownsSnapshot,scheduleId,baseRouteIdentity,memberId]);
    const connectWalking=useCallback(async()=>{
        if(!isAutomaticJourneyDevelopment()||connectionBusy.current||noticeBusy.current||trial.running||trial.pending||checkingCheckpoint||!baseInput||!ownedSchedule)return;
        connectionBusy.current=true;const revision=connectionRevision.current;setConnecting(true);setConnectionError(false);setConnected(null);
        try {
            const context=await requestWalkingContext(source,Number(scheduleId));
            const value=await requestWalkingSnapshot(source,context,'issue');if(!value)throw new Error();
            const prepared=composeServerWalkingInput(baseInput,value);
            if(revision===connectionRevision.current)setConnected(prepared);
        } catch {if(revision===connectionRevision.current)setConnectionError(true);}
        finally {
            if (revision === connectionRevision.current) {
                connectionBusy.current = false;
                setConnecting(false);
            }
        }
    },[baseInput,ownedSchedule,scheduleId,source,trial.running,trial.pending,checkingCheckpoint]);
    useEffect(() => {
        if (!autoPrepareRoute || !canConnectWalking || !baseInput || connected || connecting || connectionError
            || trial.running || trial.pending || checkingCheckpoint || !baseRouteIdentity) return;
        const key = `${scheduleId}:${memberId}:${baseRouteIdentity}`;
        if (autoConnectionKey.current === key) return;
        autoConnectionKey.current = key;
        connectWalking().catch(() => undefined);
    }, [autoPrepareRoute, canConnectWalking, scheduleId, memberId, baseInput, baseRouteIdentity, connected, connecting, connectionError, trial.running, trial.pending, checkingCheckpoint, connectWalking]);
    const autoAssessmentKey = useRef<string | null>(null);
    useEffect(() => {
        const snapshotId = connected?.walkingSnapshot?.snapshotId;
        if (!autoPrepareRoute || !snapshotId || issue || trial.running || trial.pending || !trial.canAssess || trial.assessment) return;
        const key = `${scheduleId}:${snapshotId}`;
        if (autoAssessmentKey.current === key) return;
        autoAssessmentKey.current = key;
        trial.assess().catch(() => undefined);
    }, [autoPrepareRoute, connected, issue, scheduleId, trial]);
    useEffect(() => {
        if (!departureRequest || departureRequest.claimed || departureRequest.signal.aborted) return;
        if (trial.running || snapshot?.checkpointAvailable || trial.errorCode ||
            checkpointState === 'CURRENT' || checkpointState === 'BLOCKED') {
            departureRequest.claimed = true;
            return;
        }
        if (!autoPrepareRoute || !ownedSchedule || !connected || connectionError || issue || checkingCheckpoint ||
            !trial.canStartSelectedRoute || noticeBusy.current) return;
        departureRequest.claimed = true;
        void trial.startFromDeparture(departureRequest.signal);
    }, [departureRequest, autoPrepareRoute, ownedSchedule, connected, issue, checkingCheckpoint, connectionError,
        snapshot?.checkpointAvailable, checkpointState, trial, noticePending]);
    const action = (id: string, label: string, disabled: boolean, callback: () => unknown) => <Pressable
        testID={`saved-detail-${id}`} accessibilityRole="button" accessibilityLabel={label}
        disabled={disabled||noticePending} accessibilityState={{ disabled:disabled||noticePending }} onPress={() => { if (!disabled&&!noticeBusy.current) Promise.resolve(callback()).catch(() => undefined); }}
        style={[styles.button, disabled && styles.disabled]}><Text style={styles.label}>{label}</Text></Pressable>;
    const diagnosticCode=(value:unknown)=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/.test(value)?value:'UNAVAILABLE';
    const count=(value:unknown,max=1000)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max?value:0;
    const consentLabel=connected?.walkingSnapshot?.schemaVersion===4?'최대 2시간 위치 사용에 동의합니다':'최대 10분 위치 사용에 동의합니다';
    const previous = lastOwnedSession.current;
    const endedHere = !trial.running && previous?.scheduleId === scheduleId
        && previous.route === baseRouteIdentity && previous.memberId === memberId
        && previous.sessionId === snapshot?.sessionId
        && (snapshot?.status === 'EXPIRED' || snapshot?.status === 'STOPPED');
    const heading = ownRunning ? (snapshot?.status === 'ARMED' ? '출발 대기' : '위치 안내 중')
        : endedHere && snapshot?.status === 'STOPPED' && snapshot.qualityReason === 'DESTINATION_ARRIVED'
            ? '목적지에 도착했어요'
            : endedHere ? '위치 안내가 끝났어요' : '길안내 시작';
    const descriptionStyle = [styles.explanation, isDark && styles.explanationDark];
    const recovered = ownRunning && displayed?.fresh === true && snapshot?.departureAcknowledged === true
        && !snapshot.pendingDeparture && !trial.sync.pendingStopCount
        && ['ACKNOWLEDGED', 'IDLE'].includes(trial.sync.status)
        && (!trial.sync.rerouteState || trial.sync.rerouteState === 'IDLE');
    const issues = [trial.errorCode, snapshot?.lastErrorCode, trial.sync.errorCode];
    const applicable = (trial.running && !ownRunning ? [trial.errorCode] : issues).filter((code): code is string =>
        typeof code === 'string' && code.length > 0 && !(ownRunning && displayed?.fresh && code === 'LOCATION_TEMPORARILY_UNAVAILABLE')
        && !(recovered && code === 'AUTOMATIC_SERVER_UNAVAILABLE'));
    const issueCode = applicable.find(code => !['AUTOMATIC_SERVER_UNAVAILABLE', 'SAVED_ROUTE_VALIDATION_UNAVAILABLE',
        'LOCATION_TEMPORARILY_UNAVAILABLE'].includes(code)) ?? applicable[0];
    const issueMessage = issueCode ? guidanceIssueMessage(issueCode, ownRunning, trial.sync.status === 'RETRY_WAIT') : null;
    if (endedHere) {
        return <View testID="saved-detail-controls" style={styles.root}>
            {!statusShownInRouteHeader && <Text testID="saved-detail-guidance-heading" accessibilityRole="header"
                style={[styles.heading, isDark && styles.headingDark]}>{heading}</Text>}
            {!statusShownInRouteHeader && <Text style={descriptionStyle}>저장한 경로는 계속 볼 수 있어요.</Text>}
            {snapshot?.status === 'EXPIRED' && <Text style={descriptionStyle}>
                이용 시간이 끝났어요. 다시 안내받으려면 경로를 새로 연결해 주세요.
            </Text>}
        </View>;
    }
    if (checkingCheckpoint) {
        const resumeConsent = '이 안내를 이어가려면 위치 사용에 동의해 주세요.';
        const checkpointMessage = trial.savedCheckpoint ? '이 일정의 이전 안내를 이어갈 수 있어요.'
            : checkpointState === 'CURRENT' ? '다른 일정의 안내가 남아 있어요. 해당 일정에서 안내를 확인해 주세요.'
            : checkpointState === 'BLOCKED' || checkpointState === 'WAITING'
                ? '이전 안내 상태를 확인하지 못했어요. 저장한 경로는 계속 볼 수 있어요.'
                : '이전 안내 상태를 확인하고 있어요.';
        return <View testID="saved-detail-controls" style={styles.root}>
            <Text accessibilityRole="header" style={[styles.heading, isDark && styles.headingDark]}>이전 위치 안내</Text>
            <Text accessibilityLiveRegion="polite" style={descriptionStyle}>{checkpointMessage}</Text>
            {trial.savedCheckpoint && <>
                <Pressable testID="saved-detail-restore-consent" accessibilityRole="checkbox"
                    accessibilityLabel={resumeConsent} accessibilityState={{ checked: trial.consented, disabled: !trial.canConsentToSavedRestore }}
                    disabled={!trial.canConsentToSavedRestore} onPress={() => trial.setConsented(!trial.consented)} style={styles.consent}>
                    <Text style={descriptionStyle}>{trial.consented ? '☑' : '☐'} {resumeConsent}</Text>
                </Pressable>
                {action('restore', '위치 안내 이어가기', !trial.canRestoreSaved, trial.restoreSaved)}
                {trial.errorCode && <Text accessibilityLiveRegion="polite" style={descriptionStyle}>
                    안내를 이어가지 못했어요. 저장한 경로는 계속 볼 수 있어요.
                </Text>}
            </>}
        </View>;
    }
    if (departureRequest && !departureRequest.signal.aborted && !trial.running && trial.errorCode === 'LOCATION_STATUS_TIMEOUT') {
        return <View testID="saved-detail-controls" style={styles.root}>
            <Text testID="saved-detail-runtime-error" accessibilityLiveRegion="polite" style={descriptionStyle}>
                기기의 위치 서비스 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.
            </Text>
            {action('retry-departure', '길안내 다시 시도', !trial.canStartSelectedRoute,
                () => trial.startFromDeparture(departureRequest.signal))}
        </View>;
    }
    if (!showDiagnostics && canConnectWalking && !trial.running && !connected && (autoPrepareRoute && connecting || connectionError)) {
        return <View testID="saved-detail-controls" style={styles.root}>
            <Text accessibilityLiveRegion="polite" style={descriptionStyle}>
                {connecting ? '도보 경로를 불러오는 중이에요.' : issueMessage ?? '도보 경로를 불러오지 못했어요.'}
            </Text>
            {!connecting && action('connect-walking', '도보 경로 다시 시도', trial.pending, connectWalking)}
        </View>;
    }
    if (departureRequest && !departureRequest.signal.aborted && !trial.running && !connectionError && !trial.errorCode
        && snapshot?.enabled && (!trial.assessment || trial.eligible) && (!departureRequest.claimed || trial.pending)
        && (!issue || connecting || !connected && !autoConnectionKey.current)) {
        return <View testID="saved-detail-starting" style={styles.root}>
            <Text style={descriptionStyle} accessibilityLiveRegion="polite">저장한 경로를 확인하고 있어요.</Text>
        </View>;
    }
    return <View testID="saved-detail-controls" style={ownRunning && navigationMenu && statusShownInRouteHeader ? styles.inlineControls : styles.root}>
        {!(statusShownInRouteHeader && ownRunning) && (trial.running || !autoPrepareRoute) && <Animated.View key={heading} entering={headingEntrance}>
            <Text testID="saved-detail-guidance-heading" accessibilityRole="header" accessibilityLiveRegion="polite"
                style={[styles.heading, isDark && styles.headingDark]}>{heading}</Text>
        </Animated.View>}
        {!trial.running && !autoPrepareRoute && <Text style={descriptionStyle}>
            이동하면 출발을 감지하고 다음 구간을 알려드려요.
        </Text>}
        {!trial.running&&(!autoPrepareRoute||!connected)&&canConnectWalking&&
            action('connect-walking',connecting?'도보 경로 준비 중':'도보 경로 준비',connecting||trial.pending,connectWalking)}
        {connected&&!(statusShownInRouteHeader&&ownRunning)&&<Text testID="saved-detail-walking-connected" style={descriptionStyle}>{ownRunning?'도보 경로로 안내 중이에요':'도보 경로 준비 완료'}</Text>}
        {connected&&!ownRunning&&<Text style={descriptionStyle}>{connected.walkingSnapshot?.schemaVersion===4
            ?'5분 안에 시작해 주세요 · 안내는 최대 2시간 동안 제공돼요.'
            :connected.walkingSnapshot?.schemaVersion===3
            ?'5분 안에 시작해 주세요 · 이 경로의 안내는 최대 10분이에요.'
            :'5분 안에 시작해 주세요. 시간이 지나면 경로를 다시 준비해야 해요.'}</Text>}
        {connectionError&&<Text accessibilityLiveRegion="polite" style={descriptionStyle}>도보 경로를 준비하지 못했어요. 다시 시도해 주세요.</Text>}
        {/* Admission preflight is not the lifetime of an already prepared session.
            Runtime rejection remains visible below and is enforced by server/native. */}
        {!trial.running && issue && !(autoPrepareRoute && connecting) && <Text style={descriptionStyle} testID="saved-detail-unsupported">{issue}</Text>}
        {trial.running && !ownRunning && <Text style={descriptionStyle} testID="saved-detail-other-session">다른 경로의 안내를 먼저 종료해 주세요.</Text>}
        {!trial.running && !issue && !connecting && <>
            <JourneyNoticeControls compact isDark={isDark} running={trial.running} pending={trial.pending} refresh={trial.refresh}
                selectedMode={trial.snapshot?.guidanceNoticeMode} permission={trial.snapshot?.guidanceNoticePermission} onPendingChange={noticePendingChanged}/>
            {(!autoPrepareRoute || !trial.eligible) && action('assess', '경로 확인', !trial.canAssess, trial.assess)}
            <Pressable testID="saved-detail-consent" accessibilityRole="checkbox" accessibilityLabel={consentLabel}
                disabled={trial.pending || noticePending || !trial.eligible} accessibilityState={{ checked: trial.consented, disabled: trial.pending || noticePending || !trial.eligible }}
                onPress={() => {if(!noticeBusy.current&&!trial.pending&&trial.eligible)trial.setConsented(!trial.consented);}} style={styles.consent}><Text style={descriptionStyle}>{trial.consented ? '☑' : '☐'} {consentLabel}</Text></Pressable>
            {action('prepare', '길안내 시작', !trial.canPrepare, trial.prepare)}
        </>}
        {ownRunning && navigationMenu?.open && snapshot?.sessionId && <JourneyNavigationOptions dark={isDark}
            sessionId={snapshot.sessionId} onClose={navigationMenu.close} onStop={async () => {
                if (trial.pending || !ownsRunning()) throw new Error('GUIDANCE_SESSION_CHANGED');
                await trial.stop();
            }}/>}
        {ownRunning && !navigationMenu && <View style={[styles.runningToolbar, isDark && styles.runningToolbarDark]}>
            <View style={styles.runningNotice}>
                <Ionicons name={trial.snapshot?.guidanceNoticeMode==='VOICE_AND_NOTIFICATIONS'
                    ? 'volume-high-outline' : trial.snapshot?.guidanceNoticeMode==='NOTIFICATIONS'
                        ? 'notifications-outline' : 'notifications-off-outline'}
                    size={18} color={isDark?'#B8CCE0':'#52657A'} accessible={false}/>
                <Text testID="saved-detail-notice-channel" style={descriptionStyle}>안내 방식 · {trial.snapshot?.guidanceNoticeMode==='VOICE_AND_NOTIFICATIONS'
                    ?'전경 음성 + 알림':trial.snapshot?.guidanceNoticeMode==='NOTIFICATIONS'?'알림':'꺼짐'}</Text>
            </View>
            <Pressable testID="saved-detail-stop" accessibilityRole="button" accessibilityLabel="위치 안내 종료"
                disabled={trial.pending||noticePending} accessibilityState={{disabled:trial.pending||noticePending}}
                onPress={() => {if(!trial.pending&&!noticeBusy.current&&ownsRunning()) Promise.resolve(trial.stop()).catch(() => undefined);}}
                style={({pressed})=>[styles.stopButton, isDark&&styles.stopButtonDark,
                    {opacity:pressed||trial.pending||noticePending?0.58:1}]}>
                <Ionicons name="close-outline" size={16} color={isDark?'#D5E6F8':'#52657A'} accessible={false}/>
                <Text style={[styles.stopLabel,isDark&&styles.stopLabelDark]}>종료</Text>
            </Pressable>
        </View>}
        {!trial.running && (__DEV__ || showDiagnostics) && <View testID="saved-detail-provider-preflight" style={styles.root}>
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
        {ownRunning&&!navigationMenu&&journeyNoticeAvailability(trial.snapshot?.guidanceNoticeMode,trial.snapshot?.guidanceNoticePermission)&&
            <Text testID="saved-detail-notice-availability" accessibilityLiveRegion="polite" style={descriptionStyle}>{journeyNoticeAvailability(trial.snapshot?.guidanceNoticeMode,trial.snapshot?.guidanceNoticePermission)}</Text>}
        {issueMessage && <Text testID="saved-detail-runtime-error" accessibilityLiveRegion="polite" style={descriptionStyle}>{issueMessage}</Text>}
        {__DEV__&&showDiagnostics&&<View testID="saved-detail-diagnostics">
            {action('refresh-diagnostics','기기 진단 새로고침',trial.pending,trial.refresh)}
            {issues.filter(Boolean).length > 0 && <Text>오류 코드 · {[...new Set(issues.filter(Boolean))].map(diagnosticCode).join(' · ')}</Text>}
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

function guidanceIssueMessage(code: string, running: boolean, retrying: boolean): string {
    switch (code) {
        case 'SAVED_ROUTE_VALIDATION_UNAVAILABLE':
            return '저장된 경로를 다시 확인하고 있어요. 네트워크 연결을 확인해 주세요.';
        case 'AUTOMATIC_SERVER_UNAVAILABLE':
            if (retrying) return '서버에 연결하지 못했어요. 다시 연결하고 있어요.';
            return running ? '안내 정보를 갱신하지 못했어요. 네트워크 연결을 확인해 주세요.'
                : '길안내를 준비하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.';
        case 'LOCATION_PERMISSION_DENIED':
            return '설정에서 NoLate의 위치 접근을 허용해 주세요.';
        case 'LOCATION_TEMPORARILY_UNAVAILABLE':
            return '현재 위치를 확인하고 있어요.';
        case 'SAVED_SESSION_VALIDATION_REJECTED':
        case 'SAVED_SESSION_VALIDATION_EXPIRED':
        case 'AUTOMATIC_SERVER_REJECTED':
            return '저장된 경로의 안내 상태를 확인할 수 없어요. 일정에서 경로를 다시 확인해 주세요.';
        case 'AUTOMATIC_AUTH_LIFETIME_INSUFFICIENT':
            return running ? '안내를 계속하려면 로그인을 갱신해 주세요.'
                : '로그인을 갱신한 뒤 다시 준비해 주세요. 위치 안내는 시작하지 않았어요.';
        case 'AUTOMATIC_AUTH_REFRESH_UNAVAILABLE':
            return '로그인을 갱신하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.';
        case 'AUTOMATIC_AUTH_REQUIRED':
        case 'AUTOMATIC_AUTH_CHANGED':
        case 'AUTOMATIC_AUTH_EXPIRED':
            return '이 일정을 저장한 계정으로 다시 로그인해 주세요.';
        case 'FOREGROUND_REQUIRED':
            return '앱을 열고 길안내를 다시 시작해 주세요.';
        default:
            return running ? '안내 상태를 확인하지 못했어요. 일정에서 경로를 확인해 주세요.'
                : '길안내를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.';
    }
}
const headingEntrance = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const styles = StyleSheet.create({ root: { gap: 8, paddingVertical: 10 },
    inlineControls: { gap: 8 },
    heading: { color: '#111827', fontSize: 17, fontWeight: '700' }, headingDark: { color: '#F3F4F6' },
    explanation: { color: '#475569', fontSize: 13 }, explanationDark: { color: '#BCC8D7' },
    checksToggle: { minHeight: 44, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    checksLabel: { color: '#1264C7', fontSize: 14, fontWeight: '600' }, checksLabelDark: { color: '#78B4FF' },
    checksList: { gap: 8 },
    button: { minHeight: 44, justifyContent: 'center', padding: 12, backgroundColor: '#1264C7', borderRadius: 10 },
    runningToolbar: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5EAF0' },
    runningToolbarDark: { borderBottomColor: '#303A49' },
    runningNotice: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
    stopButton: { minHeight: 44, minWidth: 70, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 3, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: '#CBD5E1' },
    stopButtonDark: { borderColor: '#52657A' },
    stopLabel: { color: '#52657A', fontSize: 13, fontWeight: '600' },
    stopLabelDark: { color: '#D5E6F8' },
    disabled: { backgroundColor: '#A8B8CC' }, label: { color: 'white', fontWeight: '600' }, consent: { paddingVertical: 12 } });
