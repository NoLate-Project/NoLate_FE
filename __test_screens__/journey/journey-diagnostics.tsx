import { Redirect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    getJourneyDiagnostics, startJourneyLocationProbe, stopJourneyLocationProbe, speakJourneyProbe,
    type JourneyDiagnosticsSnapshot,
} from "../../src/modules/journey/journeyDiagnostics";

export default function JourneyDiagnosticsRoute() {
    if (!__DEV__) return <Redirect href="/schedule" />;
    return <JourneyDiagnostics />;
}

function JourneyDiagnostics() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [snapshot, setSnapshot] = useState<JourneyDiagnosticsSnapshot | null>(null);
    const [pending, setPending] = useState(false);
    const mounted = useRef(false);
    const revision = useRef(0);
    const busy = useRef(false);
    const refresh = useCallback(async () => {
        if (busy.current) return;
        const request = ++revision.current;
        const next = await getJourneyDiagnostics();
        if (mounted.current && request === revision.current) setSnapshot(next);
    }, []);

    useEffect(() => {
        mounted.current = true;
        refresh().catch(() => undefined);
        const timer = setInterval(() => { if (AppState.currentState === "active") refresh().catch(() => undefined); }, 2000);
        const subscription = AppState.addEventListener("change", state => { if (state === "active") refresh().catch(() => undefined); });
        return () => {
            mounted.current = false;
            clearInterval(timer);
            subscription.remove();
            stopJourneyLocationProbe().catch(() => undefined);
        };
    }, [refresh]);

    const run = async (operation: () => Promise<JourneyDiagnosticsSnapshot>) => {
        if (busy.current) return;
        busy.current = true;
        ++revision.current;
        setPending(true);
        try {
            const next = await operation();
            if (mounted.current) setSnapshot(next);
            else await stopJourneyLocationProbe();
        } finally {
            busy.current = false;
            if (mounted.current) setPending(false);
        }
    };
    const close = async () => {
        await stopJourneyLocationProbe();
        if (mounted.current) router.canGoBack() ? router.back() : router.replace("/schedule");
    };
    const action = (id: string, title: string, operation: () => Promise<JourneyDiagnosticsSnapshot>) => (
        <Pressable key={id} testID={id} accessibilityRole="button" accessibilityLabel={title}
            disabled={pending || !snapshot?.enabled} style={[styles.button, (pending || !snapshot?.enabled) && styles.disabled]}
            onPress={() => { run(operation).catch(() => undefined); }}>
            <Text style={styles.buttonText}>{title}</Text>
        </Pressable>
    );
    const row = (title: string, value: string | number) => <Text style={styles.row}>{title}: {value}</Text>;

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Text style={styles.title}>길안내 P0 진단</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="진단 종료하고 닫기" onPress={() => { close().catch(() => undefined); }}>
                    <Text style={styles.link}>닫기</Text>
                </Pressable>
            </View>
            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
                <Text style={styles.note}>개발 검증용입니다. 자동 길안내의 완성 화면이 아니며, 원시 위치를 표시하거나 서버로 전송하지 않습니다.</Text>
                <Text testID="journey-diagnostics-status" style={styles.status}>
                    {snapshot ? (snapshot.enabled ? "진단 준비 완료" : `진단 불가: ${snapshot.reason}`) : "진단 상태 확인 중"}
                </Text>
                {snapshot && <>
                    {row("iOS / 앱 상태", `${snapshot.iosVersion} / ${snapshot.applicationState}`)}
                    <Text style={styles.section}>연속 위치 수신</Text>
                    {row("권한", snapshot.location.authorization)}
                    {row("정밀 위치", snapshot.location.accuracyAuthorization)}
                    {row("백그라운드 설정", snapshot.location.backgroundModeConfigured ? "있음" : "없음")}
                    {row("수집 상태", snapshot.location.state)}
                    <Text testID="journey-location-counts" style={styles.row}>
                        전체 {snapshot.location.totalSamples} · 전경 {snapshot.location.foregroundSamples} · 배경 {snapshot.location.backgroundSamples}
                    </Text>
                    {row("최근 정확도", snapshot.location.lastAccuracyMeters === null ? "관측 없음" : `${snapshot.location.lastAccuracyMeters.toFixed(1)} m`)}
                    {row("위치 오류", snapshot.location.lastErrorCode ?? "없음")}
                    {action("journey-probe-start", "위치 수신 시험 시작", startJourneyLocationProbe)}
                    {action("journey-probe-stop", "위치와 음성 시험 중지", stopJourneyLocationProbe)}
                    <Text style={styles.note}>시작한 뒤 홈 또는 잠금 화면으로 이동하여 위치를 주입하고, 복귀 후 배경 수신 수를 확인합니다. 화면을 닫거나 제한 시간이 지나면 시험을 중지합니다.</Text>
                    <Text style={styles.section}>음성 정책 비교</Text>
                    {row("음성 상태", `${snapshot.speech.state} / ${snapshot.speech.mode}`)}
                    <Text testID="journey-speech-counts" style={styles.row}>
                        시작 {snapshot.speech.startedCount} · 완료 {snapshot.speech.completedCount} · 취소 {snapshot.speech.cancelledCount}
                    </Text>
                    {row("음성 오류", snapshot.speech.lastErrorCode ?? "없음")}
                    {action("journey-probe-silent", "무음 존중 음성 시험", () => speakJourneyProbe("RESPECT_SILENT"))}
                    {action("journey-probe-lock", "잠금 재생 음성 시험", () => speakJourneyProbe("LOCK_SCREEN"))}
                    <Text style={styles.warning}>잠금 재생 시험은 기기 무음 모드에서도 소리가 날 수 있습니다. 음성 완료 횟수는 실제 청취나 무음 감지의 증거가 아닙니다.</Text>
                    {row("기기 무음 자동 감지", "미검증 / 감지 API 없음")}
                    <Text style={styles.section}>Live Activity 준비도</Text>
                    {row("Activity 허용", snapshot.liveActivity.activitiesEnabled ? "허용" : "비허용")}
                    {row("원격 시작 OS 지원", snapshot.liveActivity.pushToStartSupported ? "지원" : "미지원")}
                    <Text style={styles.warning}>실제 APNs 전달: 미검증. 이 화면은 푸시를 보내거나 Live Activity 표시 성공을 판정하지 않습니다.</Text>
                </>}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: "#F4F7FA" },
    header: { padding: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    title: { fontSize: 21, fontWeight: "700", color: "#152238" },
    link: { fontSize: 16, color: "#125ECC", padding: 8 },
    content: { paddingHorizontal: 20, gap: 10 },
    section: { fontSize: 18, fontWeight: "700", color: "#152238", marginTop: 16 },
    note: { color: "#43536A", fontSize: 13, lineHeight: 20 },
    warning: { color: "#844509", fontSize: 13, lineHeight: 20 },
    status: { color: "#125ECC", fontSize: 16, fontWeight: "600" },
    row: { fontSize: 14, color: "#203047", lineHeight: 21 },
    button: { minHeight: 46, borderRadius: 10, padding: 12, backgroundColor: "#1265CE", alignItems: "center", justifyContent: "center" },
    buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
    disabled: { opacity: 0.4 },
});
