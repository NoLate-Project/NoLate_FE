import React, { useMemo } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import type { RouteAlternativeOption } from "../map/routingService";
import type { Place } from "../schedule/types";
import { buildJourneyRouteInput, type JourneyRouteInput } from "./journeyRouteInput";
import { useAutomaticJourneyTrial } from "./useAutomaticJourneyTrial";
import { JourneyBusArrivalTrial } from "./JourneyBusArrivalTrial";
import { resolveJourneyBusRouteMapping, type JourneyBusRouteMapping } from "./journeyBusRouteBinding";

type SelectedRouteProps = { route: RouteAlternativeOption; origin?: Place; destination?: Place; disabled?: boolean };

/** New opt-in entry, deliberately separate from saving a route or the legacy journey start API. */
export function JourneySelectedRouteTrial(props: SelectedRouteProps) {
    if (!__DEV__ || Platform.OS !== "ios") return null;
    return <SelectedRouteTrialContent {...props} />;
}

function SelectedRouteTrialContent({ route, origin, destination, disabled = false }: SelectedRouteProps) {
    const input = useMemo(() => {
        const built = buildJourneyRouteInput(route, { routeRevision: 1, context: "ROUTING_RESPONSE", origin, destination });
        return built.ok ? built.input : null;
    }, [route, origin, destination]);
    const firstTransitLeg = input?.legs.find(leg => leg.kind !== "WALK");
    const mapping = useMemo(() => resolveJourneyBusRouteMapping(route), [route]);
    return <JourneyAutomaticTrialPanel input={input} scope="LOCAL_ONLY" blocked={disabled}
        mapping={mapping} stage={firstTransitLeg?.kind === "BUS" ? "P2-2" : "P1-3"} />;
}

type PanelProps = { input: JourneyRouteInput | null; scope: "LOCAL_ONLY" | "SANDBOX"; blocked?: boolean; stage?: "P1-3" | "P2-1" | "P2-2"; mapping?: JourneyBusRouteMapping | null };

const busPhaseLabels: Record<string, string> = {
    WALKING_TO_STOP: "승차 정류장으로 이동 관측",
    APPROACHING_STOP: "승차 정류장 접근 관측",
    WAITING: "정류장 주변 대기 관측",
    BOARDING_CANDIDATE: "탑승 후보 관측 · 미확정",
    UNAVAILABLE: "버스 관측 사용 불가",
};

export function JourneyAutomaticTrialPanel({ input, scope, blocked = false, stage = "P1-3", mapping = null }: PanelProps) {
    const trial = useAutomaticJourneyTrial(input, scope, blocked);
    const snapshot = trial.snapshot;
    const isBusTrial = stage === "P2-1" || stage === "P2-2";
    const busPhase = snapshot?.busPhase ?? "UNAVAILABLE";
    const busQuality = snapshot?.busQuality ?? "UNAVAILABLE";
    const busCurrent = snapshot?.enabled === true && (snapshot.status === "ARMED" || snapshot.status === "ACTIVE")
        && busQuality === "GOOD" && busPhase !== "UNAVAILABLE";
    const firstBusIndex = input?.legs.findIndex(leg => leg.kind === "BUS") ?? -1;
    const busAssessment = trial.assessment?.available ? trial.assessment.summary.legs[firstBusIndex] : undefined;
    const distance = (value: number | null | undefined) => value == null ? "관측 없음" : `${value.toFixed(1)} m`;
    const action = (id: string, label: string, enabled: boolean, operation: () => Promise<unknown>) => (
        <Pressable testID={`automatic-journey-${id}`} accessibilityRole="button" accessibilityLabel={label}
            accessibilityState={{ disabled: !enabled, busy: trial.pending }} disabled={!enabled}
            onPress={() => { if (enabled) operation().catch(() => undefined); }}
            style={[styles.button, !enabled && styles.disabled]}>
            <Text style={styles.buttonText}>{label}</Text>
        </Pressable>
    );
    return (
        <View testID="automatic-journey-panel" style={styles.panel}>
            <Text testID="automatic-journey-stage" style={styles.caption}>{stage} 개발 전용 · 시뮬레이터 한정</Text>
            <Text style={styles.title}>{isBusTrial ? "정류장 접근·탑승 후보 시험" : "출발 감지 시험"}</Text>
            <Text style={styles.note}>{isBusTrial ? "첫 버스 구간만 · 탑승 확정/하차·음성 미지원 · 준비는 출발 확정이 아닙니다." : "탑승/하차·음성 미지원 · 준비는 출발 확정이 아닙니다."}</Text>
            <Text testID="automatic-journey-source" style={styles.note}>
                {scope === "SANDBOX" ? "합성 경로 · 로컬 HTTP 시험 서버만 사용" : "선택 경로 · 로컬 감지 전용, 서버 동기화 없음"}
            </Text>
            <Text style={styles.warning}>실제 일정·출발 알람·사용자 서버 데이터는 변경하지 않습니다. 현재 앱은 완성된 대중교통 내비게이션이 아닙니다.</Text>
            <Text testID="automatic-journey-status" style={styles.status}>{snapshot?.status ?? "IDLE"}</Text>
            <Text testID="automatic-journey-capability" style={styles.row}>
                {snapshot ? (snapshot.enabled ? "개발 시험 사용 가능" : `시험 불가: ${snapshot.reason ?? "UNKNOWN"}`) : "네이티브 시험 기능 확인 중"}
            </Text>
            <Text testID="automatic-journey-departure-count" style={styles.row}>자동 출발 감지 {snapshot?.departureCount ?? 0}회</Text>
            <Text testID="automatic-journey-distance" style={styles.row}>{isBusTrial ? "첫 도보 진행" : "진행"} {distance(snapshot?.alongRouteMeters)} · 경로 이격 {distance(snapshot?.crossTrackMeters)}</Text>
            <Text testID="automatic-journey-quality" style={styles.row}>{isBusTrial ? "첫 도보 품질" : "품질"}: {snapshot?.quality ?? "UNKNOWN"} · {snapshot?.qualityReason ?? "UNKNOWN"}</Text>
            {isBusTrial ? (
                <View testID="journey-bus-observation" style={styles.busCard}>
                    <Text style={styles.busTitle}>첫 버스 관측 · 버스 구간 품질</Text>
                    <Text testID="journey-bus-phase" accessibilityLiveRegion="polite" style={styles.busPhase}>
                        {busCurrent ? busPhaseLabels[busPhase] ?? "관측 단계 확인 불가" : busQuality === "UNCERTAIN" ? "현재 판정 불확실 · 단계 확정 안 함" : "버스 관측 사용 불가"}
                    </Text>
                    <Text testID="journey-bus-phase-code" style={styles.row}>관측 단계: {busPhase}</Text>
                    <Text testID="journey-bus-quality" style={styles.row}>신뢰도: {busQuality} · {snapshot?.busReason ?? "NO_BUS_OBSERVATION"}</Text>
                    <Text testID="journey-bus-location-accuracy" style={styles.row}>최근 수평 위치 오차 {distance(busCurrent ? snapshot?.busLastAccuracyMeters : null)}</Text>
                    <Text testID="journey-bus-board-distance" style={styles.row}>승차 정류장까지 {distance(busCurrent ? snapshot?.distanceToBoardMeters : null)}</Text>
                    <Text testID="journey-bus-route-distance" style={styles.row}>버스 경로상 진행 {distance(busCurrent ? snapshot?.busAlongRouteMeters : null)}</Text>
                    <Text testID="journey-bus-boarding-evidence" style={styles.row}>탑승 후보 관측 근거 {snapshot?.boardingEvidenceCount ?? 0}개</Text>
                    <Text testID="journey-bus-boarding-confirmed" style={styles.busWarning}>탑승 미확정 · 차량/노선 매칭 필요</Text>
                    <Text style={styles.warning}>GPS만으로 실제 버스 탑승을 확정할 수 없습니다. 탑승 후보가 보여도 실제 차량·노선 확인 전에는 탑승 완료로 처리하지 않습니다.</Text>
                    {!busCurrent ? <Text testID="journey-bus-uncertainty" style={styles.warning}>위치가 오래되거나 정확도가 낮으면 마지막 단계가 남아 있어도 현재 상태로 확정하지 않습니다. 거리도 표시하지 않습니다.</Text> : null}
                    {busAssessment ? (
                        <>
                            <Text testID="journey-bus-geometry" style={styles.row}>{busAssessment.geometryUsable ? "버스 형상 검사 통과 · 실제 차량 미확인" : "버스 형상 보완 필요 · 버스 관측 차단 대상"}</Text>
                            <Text testID="journey-bus-geometry-reasons" style={styles.codes}>{busAssessment.reasonCodes.join(" · ") || "버스 형상 검사 사유 없음"}</Text>
                        </>
                    ) : null}
                    <Text style={styles.note}>첫 도보 품질과 버스 관측 품질은 별도입니다. 도보 끝을 지나 첫 도보 품질이 낮아져도 버스 구간 품질은 이 카드에서 확인하세요. 버스 형상이 부적합해도 출발 감지 시험은 준비될 수 있습니다.</Text>
                </View>
            ) : null}
            {isBusTrial ? <JourneyBusArrivalTrial input={input} scope={scope} mapping={mapping} /> : null}
            <Text testID="automatic-journey-pending-departure" style={styles.row}>미확인 출발 이벤트: {snapshot?.pendingDeparture ? "있음" : "없음"}</Text>
            <Text testID="automatic-journey-acknowledged" style={styles.row}>출발 이벤트 확인: {snapshot?.departureAcknowledged ? "완료" : "미확인"}</Text>
            <Text testID="automatic-journey-sync" style={styles.row}>동기화: {trial.sync.status} · 세션 범위 {snapshot?.syncScope ?? "NONE"}</Text>
            <Text testID="automatic-journey-remaining" style={styles.row}>남은 시험 시간 {snapshot?.remainingSeconds ?? 0}초</Text>
            <Text testID="automatic-journey-checkpoint" style={styles.row}>저장된 시험 기록: {snapshot?.checkpointAvailable ? "있음" : "없음"}</Text>
            <Text style={styles.row}>위치: {snapshot?.locationState ?? "UNKNOWN"} · 권한: {snapshot?.authorization ?? "UNKNOWN"}</Text>
            {trial.running ? <Text testID="automatic-journey-existing-session" style={styles.warning}>현재 시험 세션이 실행 중입니다. 다른 경로를 준비하려면 먼저 종료하세요. 화면의 새 선택으로 실행 경로가 바뀌지 않습니다.</Text> : null}
            {!trial.running && snapshot?.pendingDeparture ? <Text style={styles.warning}>미확인 출발 이벤트가 남아 새 시험을 준비할 수 없습니다. 기존 시험 복구 또는 동기화를 확인하세요.</Text> : null}
            <Text testID="automatic-journey-assessment" style={styles.row}>
                {trial.assessment ? (trial.assessment.available
                    ? (trial.eligible ? "첫 도보 출발 감지 시험 준비 가능" : "이 경로는 자동 감지 준비 불가")
                    : `경로 검사 불가: ${trial.assessment.reason}`) : "준비 전 선택 경로를 검사하세요"}
            </Text>
            {trial.assessment?.available ? <Text testID="automatic-journey-assessment-reasons" style={styles.codes}>
                {[...trial.assessment.summary.reasonCodes, ...(trial.assessment.summary.legs[0]?.reasonCodes ?? [])].join(" · ") || "첫 도보 형상 검사 통과 · 실주행 미검증"}
            </Text> : null}
            <Text testID="automatic-journey-error" style={styles.warning}>오류: {trial.errorCode ?? snapshot?.lastErrorCode ?? trial.sync.errorCode ?? "없음"}</Text>
            {action("assess", "선택 경로 검사", trial.canAssess, trial.assess)}
            <Pressable testID="automatic-journey-consent" accessibilityRole="checkbox"
                accessibilityLabel="최대 10분 위치 감지 시험에 동의합니다"
                accessibilityState={{ checked: trial.consented, disabled: trial.pending || trial.running || !snapshot?.enabled || blocked }}
                disabled={trial.pending || trial.running || !snapshot?.enabled || blocked}
                onPress={() => trial.setConsented(!trial.consented)} style={styles.consent}>
                <Text style={styles.consentText}>{trial.consented ? "☑" : "☐"} 최대 10분 위치 감지 시험에 동의합니다</Text>
            </Pressable>
            {action("prepare", "자동 감지 준비", trial.canPrepare, trial.prepare)}
            {action("restore", "현재 선택과 일치하는 시험 복구", trial.canRestore, trial.restore)}
            {action("stop", "출발 감지 시험 종료", snapshot?.enabled === true && !trial.pending, trial.stop)}
            {scope === "SANDBOX" ? (
                <>
                    <Pressable testID="automatic-journey-sync-pause" accessibilityRole="checkbox"
                        accessibilityLabel="서버 동기화 중단 시험" accessibilityState={{ checked: trial.sync.paused, disabled: !snapshot?.enabled }}
                        disabled={!snapshot?.enabled}
                        onPress={() => trial.setSyncPaused(!trial.sync.paused)} style={styles.consent}>
                        <Text style={styles.consentText}>{trial.sync.paused ? "☑" : "☐"} 서버 동기화 중단 시험</Text>
                    </Pressable>
                    {action("retry-sync", "미확인 이벤트 동기화 재시도", snapshot?.enabled === true && snapshot.syncScope === "SANDBOX" && !trial.pending, trial.retrySync)}
                </>
            ) : null}
            <Text style={styles.note}>{isBusTrial
                ? "화면을 닫아도 감지는 유지됩니다. 종료 버튼으로 끝내세요. 실제 탑승 확정·하차·환승·음성·APNs 안내는 이번 시험에 포함되지 않습니다."
                : "화면을 닫아도 감지는 유지됩니다. 종료 버튼으로 끝내세요. 실제 APNs·잠금 화면 안내·음성·승하차 판단은 이번 시험에 포함되지 않습니다."}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    panel: { backgroundColor: "#F2F6FB", borderRadius: 16, padding: 16, gap: 9, marginTop: 12 },
    caption: { color: "#52657A", fontSize: 12 },
    title: { color: "#152A43", fontSize: 21, fontWeight: "700" },
    status: { color: "#1264C7", fontSize: 29, fontWeight: "800" },
    row: { color: "#344A60", fontSize: 13, lineHeight: 20 },
    note: { color: "#415971", fontSize: 13, lineHeight: 20 },
    warning: { color: "#815019", fontSize: 12, lineHeight: 19 },
    codes: { color: "#52657A", fontSize: 11, lineHeight: 18 },
    button: { minHeight: 45, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#1264C7", padding: 10 },
    buttonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
    disabled: { opacity: 0.4 },
    consent: { minHeight: 46, justifyContent: "center", padding: 6 },
    consentText: { fontSize: 13, fontWeight: "600", color: "#173953", lineHeight: 20 },
    busCard: { backgroundColor: "#FFFFFF", borderRadius: 12, borderWidth: 1, borderColor: "#CDD8E7", padding: 14, gap: 8 },
    busTitle: { color: "#173953", fontSize: 16, fontWeight: "700" },
    busPhase: { color: "#173953", fontSize: 18, fontWeight: "700", lineHeight: 25 },
    busWarning: { color: "#815019", fontSize: 17, fontWeight: "700", lineHeight: 24 },
});
