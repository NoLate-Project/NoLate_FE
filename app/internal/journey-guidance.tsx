import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScheduleDetail } from "../schedule/[id]";
import { journeyJSONRequest } from "../../src/modules/journey/journeyJSONRequest";
import { createRenewingJourneyAuthenticationSource, journeyAuthentication, requireJourneyAuthenticationIdentity, type JourneyAuthenticationSource } from "../../src/modules/journey/automaticJourneyAuthentication";
import { configureAutomaticJourneyPushPilot, refreshAutomaticJourneyCredentials, automaticRecord } from "../../src/modules/journey/automaticJourney";
import { JourneyNoticeControls } from '../../src/modules/journey/JourneyNoticeControls';
import { SavedJourneyGuidanceCard } from "../../src/modules/journey/SavedJourneyGuidanceCard";
import { buildSavedJourneyInput } from "../../src/modules/journey/savedJourneyGuidance";
import { journeyDisplayNumber } from "../../src/modules/journey/journeyRouteInput";
import { useAutomaticJourneyTrial } from "../../src/modules/journey/useAutomaticJourneyTrial";
import type { ScheduleItem, ScheduleTravelPlan } from "../../src/modules/schedule/types";
import { retryAutomaticJourneyStops } from '../../src/modules/journey/automaticJourneyTrial';
import { journeyPushInstallationError, loadJourneyPushInstallation } from '../../src/modules/journey/journeyPushInstallation';

export default function SavedGuidanceRoute() {
    if (!__DEV__ || Platform.OS !== "ios") return <Redirect href="/schedule" />;
    return <SavedGuidanceScreen />;
}
function SavedGuidanceScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams<{ showDetail?: string; authenticated?: string; shortToken?: string; renewToken?: string; pushPilot?: string }>();
    const authenticated = params.authenticated === "1";
    const shortToken = params.shortToken === "1";
    const renewToken = params.renewToken === "1";
    const [source, setSource] = useState<JourneyAuthenticationSource | null>(null);
    const [renewals, setRenewals] = useState(0);
    const [plan, setPlan] = useState<ScheduleTravelPlan | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [realPushProvider, setRealPushProvider] = useState(false);
    const [installationDigest, setInstallationDigest] = useState<string | null>(null);
    const [installationPending, setInstallationPending] = useState(false);
    const [detail, setDetail] = useState(params.showDetail === "1");
    const [unsupportedDetail, setUnsupportedDetail] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    useEffect(() => {
        let active = true;
        setPlan(null); setSource(null); setRenewals(0); setError(null); setRealPushProvider(false);
        journeyJSONRequest(authenticated ? `http://127.0.0.1:15544/__fixture/context${shortToken ? '?short=1' : ''}` : "http://127.0.0.1:15543/__fixture/saved-route")
            .then(value => {
                const raw = automaticRecord(value); const saved = automaticRecord(raw?.plan);
                if (raw?.fixtureOnly !== true || saved?.scheduleId !== 9001 || saved.memberId !== 7 || saved.status !== "READY"
                    || saved.travelMode !== "TRANSIT") throw new Error("INVALID_SAVED_FIXTURE");
                const credentials = authenticated ? journeyAuthentication(raw.accessToken, raw.apiOrigin, raw.memberId) : null;
                if (credentials && credentials.apiOrigin !== "http://127.0.0.1:15544") throw new Error("INVALID_SAVED_FIXTURE");
                if (active) {
                    setRealPushProvider(raw.guidancePushRealProvider === true);
                    // Test-source credentials never enter real authStorage/Keychain.
                    let memory = credentials; let refreshToken = raw.refreshToken;
                    const read = async () => {
                        if (!active || !memory) throw new Error("AUTOMATIC_AUTH_REQUIRED");
                        return memory;
                    };
                    const fixtureSource = renewToken ? createRenewingJourneyAuthenticationSource(read, async previous => {
                        if (typeof refreshToken !== "string") throw new Error("AUTOMATIC_AUTH_REQUIRED");
                        const reply = automaticRecord(await refreshAutomaticJourneyCredentials(previous.apiOrigin, refreshToken));
                        const tokens = automaticRecord(reply?.data);
                        if (!active || memory !== previous) throw new Error("AUTOMATIC_AUTH_CHANGED");
                        if (reply?.success !== true || typeof tokens?.refreshToken !== "string") throw new Error("AUTOMATIC_AUTH_REQUIRED");
                        const next = journeyAuthentication(tokens.accessToken, previous.apiOrigin, previous.authMemberId);
                        requireJourneyAuthenticationIdentity(next, previous);
                        memory = next; refreshToken = tokens.refreshToken; setRenewals(count => count + 1);
                    }, 10) : read;
                    setSource(() => fixtureSource); setPlan(saved as unknown as ScheduleTravelPlan);
                }
            }).catch(() => { if (active) setError("SAVED_FIXTURE_UNAVAILABLE"); });
        return () => { active = false; };
    }, [reloadKey, authenticated, shortToken, renewToken]);
    const authSource = useCallback(async () => {
        if (!source) throw new Error("AUTOMATIC_AUTH_REQUIRED");
        return source();
    }, [source]);
    const input = useMemo(() => plan ? buildSavedJourneyInput(plan.route, plan.origin, plan.destination) : null, [plan]);
    const trial = useAutomaticJourneyTrial(input, authenticated ? "AUTHENTICATED" : "SANDBOX", !plan, "9001", authenticated ? authSource : undefined);
    const item = useMemo<ScheduleItem | null>(() => plan ? ({
        id: "9001", ownerMemberId: 7, scheduleType: "ROUTE", title: automaticRecord(plan.route)?.id === 'seoul-7016-public-preview'
            ? "7016 실제 정류장 자료 · 안내 미지원 시험" : "P2-3 저장 경로 · 합성 시험",
        startAt: new Date(Date.now() + 3600000).toISOString(), endAt: new Date(Date.now() + 7200000).toISOString(),
        category: { id: "fixture", title: "합성 시험", color: "#1264C7" },
        travelMode: "TRANSIT", travelMinutes: automaticRecord(plan.route)?.id === 'seoul-7016-public-preview'
            ? undefined : journeyDisplayNumber(automaticRecord(plan.route)?.durationMinutes, 46_080) ?? 9,
        origin: plan.origin ?? undefined, destination: plan.destination ?? undefined,
        route: unsupportedDetail ? { ...automaticRecord(plan.route), transitLegs: (automaticRecord(plan.route)?.transitLegs as unknown[] ?? []).map(value => {
            const leg = automaticRecord(value); return leg?.kind === 'BUS' ? { ...leg, kind: 'SUBWAY' } : leg;
        }) } : plan.route, notificationEnabled: false,
    }) : null, [plan, unsupportedDetail]);
    const action = (id: string, label: string, disabled: boolean, callback: () => unknown) => <Pressable
        testID={`saved-guidance-${id}`} accessibilityRole="button" accessibilityLabel={label}
        accessibilityState={{ disabled }} disabled={disabled} onPress={() => { Promise.resolve(callback()).catch(() => undefined); }}
        style={[styles.button, disabled && styles.disabled]}>
        <Text style={styles.buttonText} maxFontSizeMultiplier={id === "back" ? 1.3 : undefined}>{id === "back" ? "시험 화면" : label}</Text></Pressable>;
    if (detail && item) return <View style={styles.fill}>
        <ScheduleDetail previewItem={item} previewCurrentMemberId={7} initialSheetMode="expanded" previewOfflineGuidanceMap
            previewGuidanceAuthenticationSource={authenticated ? authSource : undefined} />
        <View style={[styles.back, { top: insets.top + 5 }]}>
            {action("back", "안내 시험 화면으로", false, () => setDetail(false))}
        </View>
    </View>;
    return <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.title}>{authenticated ? "P2-3 인증 transport · 합성 JWT 시험" : "P2-3 저장 경로 위치 안내"}</Text>
        <Text testID="saved-guidance-scope">{authenticated ? "AUTHENTICATED · TEST ISSUER · 실제 로그인 아님" : "SANDBOX · credentials 없음"}</Text>
        <Text testID="saved-guidance-notice-state">안내 채널: {trial.snapshot?.guidanceNoticeMode ?? 'OFF'} · {trial.snapshot?.guidanceNoticeState ?? 'OFF'} · 알림 접수 {trial.snapshot?.guidanceNoticeScheduledCount ?? 0} · 음성 큐 {trial.snapshot?.guidanceVoiceQueuedCount ?? 0}</Text>
        <Text testID="saved-guidance-notice-system-state">OS 알림 설정: {trial.snapshot?.guidanceNoticePermission ?? 'NOT_CHECKED'} · 허용/접수만으로 잠금 표시를 보장하지 않습니다.</Text>
        <JourneyNoticeControls running={trial.running} pending={trial.pending} refresh={trial.refresh} />
        {authenticated && <Text testID="saved-guidance-renewals">시험 토큰 갱신 {renewals}회 · {renewToken ? "활성 화면 갱신" : "갱신 OFF"}</Text>}
        {["probe", "provider"].includes(params.pushPilot ?? "") && <>
            <Text testID="saved-guidance-push-state">APNs 토큰 시험: {trial.snapshot?.guidancePushState ?? "OFF"} · 토큰 {trial.snapshot?.guidancePushTokenAvailable ? "발급됨" : "미발급"} · 실제 전달 미검증</Text>
            {action('push-installation', '시험 시뮬레이터 APNs 등록 · 설치 지문 확인', installationPending || trial.running || trial.pending,
                async () => {
                    setInstallationPending(true); setInstallationDigest(null); setError(null);
                    try { setInstallationDigest((await loadJourneyPushInstallation()).digest); }
                    catch (failure) { setError(journeyPushInstallationError(failure)); }
                    finally { setInstallationPending(false); }
                })}
            {installationDigest && <Text selectable testID="saved-guidance-installation-digest">시험 설치 SHA-256: {installationDigest}</Text>}
            {action("push-probe", "길안내 APNs 토큰 발급 시험 · 준비 전에 설정", trial.running || trial.pending,
                () => configureAutomaticJourneyPushPilot().catch(() => setError("AUTOMATIC_APNS_PILOT_UNAVAILABLE")))}
            {params.pushPilot === "provider" && action("push-provider", "허용된 개발 서버로 실제 APNs 시험 연결", !realPushProvider || installationPending || trial.running || trial.pending,
                async () => {
                    try {
                        const installation = await loadJourneyPushInstallation();
                        if (!installationDigest || installation.digest !== installationDigest) throw new Error('APNS_TEST_DIGEST_INVALID');
                        await configureAutomaticJourneyPushPilot(installation.token);
                        setError(null);
                    } catch (failure) { setError(journeyPushInstallationError(failure)); }
                })}
        </>}
        <Text style={styles.note}>{automaticRecord(plan?.route)?.id === 'seoul-7016-public-preview'
            ? '7016 상명대 방면 · 서울역→경복궁역. 서울시 공식 공개 정류장 관측 자료입니다. 실제 도보 연결 경로와 공급자 어댑터가 없어 자동 안내를 차단합니다. 실시간 차량 조회 성공은 사용자의 탑승 확인이 아닙니다.'
            : <>단일 전체 합성 저장 경로를 서버·native에서 동일하게 검증합니다. 교통 도착정보는 합성이며 실제 공급자는 사용하지 않습니다. {realPushProvider ? '허용된 시험 설치에 한해 실제 APNs 전송이 가능합니다. 서버 수락은 화면 수신 성공이 아닙니다.' : '실제 APNs 전송은 연결되지 않았습니다.'} 첫 도보·정류장 대기·버스 이동·하차 준비와 분리 근거+연속 도보의 최종 도보 전환, 목적지 연속 체류 후 길안내 종료를 시험합니다. 실제 현장 하차·도착 검증과 환승은 미지원입니다.</>}</Text>
        <Text testID="saved-guidance-status">{trial.snapshot?.status ?? "IDLE"} · 출발 감지 {trial.snapshot?.departureCount ?? 0}회 · 동기화 {trial.sync.status}</Text>
        <Text testID="saved-guidance-boarding-diagnostics">승차 후보: {trial.snapshot?.busPhase ?? 'UNAVAILABLE'} · {trial.snapshot?.busReason ?? 'BUS_NOT_PREPARED'} · 이동 근거 {trial.snapshot?.boardingEvidenceCount ?? 0}개 · 후보 GPS 오차 {trial.snapshot?.busLastAccuracyMeters == null ? '확인 불가' : `${trial.snapshot.busLastAccuracyMeters}m`}</Text>
        <Text testID="saved-guidance-ride-diagnostics">자동 탑승: {trial.snapshot?.ridePhase ?? 'UNAVAILABLE'} · {trial.snapshot?.rideReason ?? 'VERIFIED_RIDE_BINDING_UNAVAILABLE'} · 차량 근거 {trial.snapshot?.rideEvidenceCount ?? 0}개</Text>
        <Text testID="saved-guidance-ride-transport">차량 연결: {trial.snapshot?.rideTransportState ?? 'NOT_REQUESTED'} · 이 시험 화면의 차량·GPS는 합성 입력이며 실제 탑승 검증이 아닙니다.</Text>
        <Text testID="saved-guidance-separation">하차 분리 근거: {trial.snapshot?.separationStatus ?? 'UNAVAILABLE'} · {trial.snapshot?.separationReason ?? 'DEPARTURE_WINDOW_UNAVAILABLE'} · {trial.snapshot?.separationEvidenceCount ?? 0}개 · 하차 확정·최종 도보 전환 아님</Text>
        <Text testID="saved-guidance-final-walk">최종 도보: {trial.snapshot?.finalWalkPhase ?? 'UNAVAILABLE'} · {trial.snapshot?.finalWalkReason ?? 'FINAL_WALK_GEOMETRY_UNAVAILABLE'} · {trial.snapshot?.finalWalkEvidenceCount ?? 0}개</Text>
        <Text testID="saved-guidance-destination">{trial.snapshot?.qualityReason === 'DESTINATION_ARRIVED' ? '목적지 도착 · 길안내 종료 (일정 완료와 별개)' : `목적지 체류 근거: ${trial.snapshot?.destinationEvidenceCount ?? 0}개 · 연속 20초 이상 필요`}</Text>
        <Text testID="saved-guidance-errors">오류: {error ?? trial.errorCode ?? trial.snapshot?.lastErrorCode ?? "없음"}</Text>
        <Text testID="saved-guidance-stop-sync">서버 종료 대기 {trial.sync.pendingStopCount ?? 0}건 · {trial.sync.errorCode ?? '오류 없음'}</Text>
        <Text testID="saved-guidance-checkpoint">이전 안내 확인: {({ NONE: '남은 기록 없음', CHECKING: '서버 확인 중',
            CURRENT: '기록 보존 · 복구 전 검증 필요', CLEARED: '종료 확인 · 자동 정리 완료',
            WAITING: '서버 연결 대기 · 기록 보존', BLOCKED: '확인 불가 · 기록 보존' })[trial.sync.checkpointState ?? 'NONE']}</Text>
        <SavedJourneyGuidanceCard input={input} scheduleId="9001" />
        {action("assess", "저장 경로 검사", !trial.canAssess, trial.assess)}
        <Text testID="saved-guidance-assessment">{trial.eligible ? "저장 경로 서버 재검증 가능" : "검사·검증 전에는 안내 차단"}</Text>
        {trial.assessment && <Text testID="saved-guidance-assessment-reasons">검사 결과: {trial.assessment.available
            ? [...new Set([...trial.assessment.summary.reasonCodes, ...trial.assessment.summary.legs.flatMap(leg => leg.reasonCodes)])].join(' · ') || '거부 사유 없음'
            : trial.assessment.reason}</Text>}
        <Pressable accessibilityRole="checkbox" accessibilityLabel="최대 10분 위치 안내 시험 동의"
            accessibilityState={{ checked: trial.consented, disabled: trial.running || trial.pending }}
            disabled={trial.running || trial.pending} onPress={() => trial.setConsented(!trial.consented)} style={styles.consent}>
            <Text>{trial.consented ? "☑" : "☐"} 최대 10분 위치 안내 시험 동의</Text>
        </Pressable>
        {action("prepare", "저장 경로 자동 안내 준비", !trial.canPrepare, trial.prepare)}
        {action("restore", "저장 안내 복구 · 서버 재검증", !trial.canRestore, trial.restore)}
        {action("detail", "실제 경로 상세 컴포넌트 열기", !item, () => { setUnsupportedDetail(false); setDetail(true); })}
        {action("unsupported-detail", "미지원 지하철 상세 차단 시험", !item, () => { setUnsupportedDetail(true); setDetail(true); })}
        {action("reload", "저장 경로 다시 불러오기", false, () => setReloadKey(value => value + 1))}
        {action("stop", "길안내 시험 종료", !trial.snapshot?.enabled || trial.pending, trial.stop)}
        {action('retry-stop', '서버 종료 동기화 재시도', trial.pending,
            () => retryAutomaticJourneyStops(authenticated ? authSource : undefined))}
        {action('readiness', '길안내 검증 상태 · 읽기 전용', false, () => router.push('/internal/journey-readiness'))}
        <Text style={styles.note}>준비는 출발이 아닙니다. GPS 이동과 별도 차량 관측으로 출발·탑승·진행을 판단합니다. 단계 전환 버튼 없음. 하차 준비·분리 근거만으로는 전환하지 않습니다. 검증된 최종 도보 경로의 연속 이동과 목적지 연속 체류로 길안내를 종료합니다. 일정 완료 처리는 하지 않습니다. 지하철·음성·운영 일정 진입은 후속 단계입니다. 화면을 닫아도 native 추적은 유지됩니다.</Text>
    </ScrollView>;
}
const styles = StyleSheet.create({
    fill: { flex: 1 }, root: { flex: 1, backgroundColor: "white" }, content: { padding: 18 },
    title: { fontSize: 22, fontWeight: "700" }, note: { marginVertical: 12, lineHeight: 21 },
    button: { padding: 14, backgroundColor: "#1264C7", borderRadius: 10, marginVertical: 4 },
    disabled: { backgroundColor: "#A8B8CC" }, buttonText: { color: "white", fontWeight: "600" },
    back: { position: "absolute", right: 10, zIndex: 10000, elevation: 20 }, consent: { paddingVertical: 16 },
});
