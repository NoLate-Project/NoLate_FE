import { Redirect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    armJourneyEngine, getJourneyEngineSnapshot, restoreJourneyEngine, stopJourneyEngine, subscribeJourneyEngine,
    type JourneyEngineSnapshot,
} from "../../src/modules/journey/journeyEngine";

export default function JourneyEngineRoute() {
    if (!__DEV__) return <Redirect href="/schedule" />;
    return <JourneyEngineScreen />;
}

function JourneyEngineScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [snapshot, setSnapshot] = useState<JourneyEngineSnapshot | null>(null);
    const [consented, setConsented] = useState(false);
    const [pending, setPending] = useState(false);
    const mounted = useRef(false);
    const revision = useRef(0);
    const busy = useRef(false);

    const refresh = useCallback(async () => {
        if (busy.current) return;
        const request = ++revision.current;
        const next = await getJourneyEngineSnapshot();
        if (mounted.current && request === revision.current) setSnapshot(next);
    }, []);

    useEffect(() => {
        mounted.current = true;
        const unsubscribe = subscribeJourneyEngine(next => {
            ++revision.current;
            if (mounted.current) setSnapshot(next);
        });
        refresh().catch(() => undefined);
        const appStateSubscription = AppState.addEventListener("change", state => {
            if (state === "active") refresh().catch(() => undefined);
        });
        return () => {
            mounted.current = false;
            unsubscribe();
            appStateSubscription.remove();
            // Native owns the consented, time-bounded session. Closing a view must not stop it.
        };
    }, [refresh]);

    const run = async (operation: () => Promise<JourneyEngineSnapshot>) => {
        if (busy.current) return;
        busy.current = true;
        const request = ++revision.current;
        setPending(true);
        try {
            const next = await operation();
            if (mounted.current && request === revision.current) setSnapshot(next);
        } finally {
            busy.current = false;
            if (mounted.current) setPending(false);
        }
    };

    const running = snapshot?.status === "ARMED" || snapshot?.status === "ACTIVE";
    const available = snapshot?.enabled === true && !pending;
    const canPrepare = available && consented && !running;
    const distance = (value: number | null | undefined) => value == null ? "관측 없음" : `${value.toFixed(1)} m`;
    const action = (id: string, title: string, enabled: boolean, operation: () => Promise<JourneyEngineSnapshot>) => (
        <Pressable testID={id} accessibilityRole="button" accessibilityLabel={title}
            disabled={!enabled} style={[styles.button, !enabled && styles.disabled]}
            onPress={() => { if (enabled) run(operation).catch(() => undefined); }}>
            <Text style={styles.buttonText}>{title}</Text>
        </Pressable>
    );

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Text style={styles.title}>자동 출발 엔진 시험</Text>
                <Pressable testID="journey-engine-close" accessibilityRole="button" accessibilityLabel="화면만 닫기"
                    onPress={() => router.canGoBack() ? router.back() : router.replace("/schedule")}>
                    <Text style={styles.link}>화면만 닫기</Text>
                </Pressable>
            </View>
            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
                <View style={styles.card}>
                    <Text style={styles.caption}>P1 개발 전용 · 시뮬레이터 한정</Text>
                    <Text testID="journey-engine-status" style={styles.status}>{snapshot?.status ?? "IDLE"}</Text>
                    <Text testID="journey-engine-departure-count" style={styles.count}>자동 출발 감지 {snapshot?.departureCount ?? 0}회</Text>
                    <Text testID="journey-engine-readiness" style={styles.row}>
                        {snapshot ? (snapshot.enabled ? "엔진 시험 준비 완료" : `시험 불가: ${snapshot.reason ?? "UNKNOWN"}`) : "상태 확인 중"}
                    </Text>
                </View>
                <View style={styles.card}>
                    <Text testID="journey-engine-input-mode" style={styles.row}>입력: {snapshot?.inputMode ?? "NONE"}</Text>
                    <Text testID="journey-engine-quality" style={styles.row}>품질: {snapshot?.quality ?? "UNKNOWN"} · {snapshot?.qualityReason ?? "UNKNOWN"}</Text>
                    <Text testID="journey-engine-distance" style={styles.row}>경로 진행 {distance(snapshot?.alongRouteMeters)} · 경로 이격 {distance(snapshot?.crossTrackMeters)}</Text>
                    <Text testID="journey-engine-evidence" style={styles.row}>관측 근거 {snapshot?.evidenceCount ?? 0} · sequence {snapshot?.sequence ?? 0}</Text>
                    <Text testID="journey-engine-remaining" style={styles.row}>남은 시험 시간: {snapshot?.remainingSeconds ?? 0}초</Text>
                    <Text style={styles.row}>위치: {snapshot?.locationState ?? "UNKNOWN"} · 권한: {snapshot?.authorization ?? "UNKNOWN"}</Text>
                    <Text style={styles.row}>앱 상태: {snapshot?.applicationState ?? "UNKNOWN"}</Text>
                    <Text testID="journey-engine-checkpoint" style={styles.row}>저장 기록: {snapshot?.checkpointAvailable ? "있음" : "없음"} · 복구: {snapshot?.restored ? "완료" : "미실행"}</Text>
                    <Text testID="journey-engine-trace" style={styles.row}>기록 재생: {snapshot?.traceFinished ? "완료" : "미완료"}</Text>
                    <Text style={styles.row}>오류: {snapshot?.lastErrorCode ?? "없음"}</Text>
                </View>
                <Text style={styles.note}>공개 좌표로 만든 합성 경로를 사용하는 개발 시험입니다. 실제 기기는 사용하지 않습니다. 최대 10분 동안 실행되며 화면을 닫아도 유지됩니다. 종료하려면 ‘시험 종료’를 눌러 주세요.</Text>
                <Text style={styles.note}>실제 일정 출발 처리·알람 취소·서버 변경은 없습니다. 준비 버튼은 ARMED 상태만 만들며, 출발 여부는 이후 위치 입력으로 판단합니다.</Text>
                <Pressable testID="journey-engine-consent" accessibilityRole="checkbox"
                    accessibilityLabel="최대 10분의 개발 시험에 동의합니다" accessibilityState={{ checked: consented, disabled: running || pending }}
                    disabled={running || pending} style={styles.consent}
                    onPress={() => { if (!running && !pending) setConsented(value => !value); }}>
                    <Text style={styles.consentText}>{consented ? "☑" : "☐"} 최대 10분의 개발 시험에 동의합니다</Text>
                </Pressable>
                {action("journey-engine-arm-location", "위치 입력으로 자동 감지 준비", canPrepare, () => armJourneyEngine("SIMULATOR_LOCATION"))}
                {action("journey-engine-replay", "합성 이동 기록 재생", canPrepare, () => armJourneyEngine("TIMED_REPLAY"))}
                {action("journey-engine-restore", "저장된 시험 복구", canPrepare && snapshot?.checkpointAvailable === true, restoreJourneyEngine)}
                {action("journey-engine-stop", "시험 종료", available, stopJourneyEngine)}
                <Text style={styles.warning}>아직 버스·지하철 자동 길안내의 완성 기능이 아닙니다. 실제 APNs 전달, 하드웨어 무음 전환, 실주행 정확도는 미검증입니다. 화면 이탈·복귀는 시험을 재시작하거나 종료하지 않습니다.</Text>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: "#F2F6FB" },
    header: { padding: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    title: { fontSize: 20, fontWeight: "700", color: "#152A43" },
    link: { padding: 8, color: "#1264C7", fontSize: 14 },
    content: { paddingHorizontal: 18, gap: 12 },
    card: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 18, gap: 7 },
    caption: { color: "#52657A", fontSize: 13 },
    status: { color: "#1264C7", fontSize: 38, fontWeight: "800" },
    count: { color: "#173953", fontSize: 21, fontWeight: "600" },
    row: { color: "#344A60", fontSize: 13, lineHeight: 20 },
    note: { color: "#415971", fontSize: 13, lineHeight: 21 },
    warning: { color: "#815019", fontSize: 13, lineHeight: 21, paddingVertical: 8 },
    consent: { minHeight: 46, justifyContent: "center", padding: 8 },
    consentText: { fontSize: 14, fontWeight: "600", color: "#173953" },
    button: { minHeight: 47, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#1264C7", padding: 12 },
    buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
    disabled: { opacity: 0.4 },
});
