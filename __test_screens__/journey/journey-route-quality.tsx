import { Redirect, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    assessJourneyRouteInput,
    type JourneyRouteAssessmentResult,
} from "../../src/modules/journey/journeyRouteAssessment";
import { journeyRouteFixtures } from "../../src/modules/journey/journeyRouteFixtures";

export default function JourneyRouteQualityRoute() {
    if (!__DEV__) return <Redirect href="/schedule" />;
    return <JourneyRouteQualityScreen />;
}

function JourneyRouteQualityScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [selectedId, setSelectedId] = useState(journeyRouteFixtures[0]?.id ?? "");
    const [result, setResult] = useState<JourneyRouteAssessmentResult | null>(null);
    const [pending, setPending] = useState(false);
    const mounted = useRef(false);
    const revision = useRef(0);
    const busy = useRef(false);
    const selected = journeyRouteFixtures.find(fixture => fixture.id === selectedId);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    const selectFixture = (id: string) => {
        ++revision.current;
        busy.current = false;
        setPending(false);
        setResult(null);
        setSelectedId(id);
    };

    const assess = async () => {
        if (!selected || busy.current) return;
        const request = ++revision.current;
        busy.current = true;
        setPending(true);
        setResult(null);
        try {
            const next = await assessJourneyRouteInput(selected.input);
            if (mounted.current && request === revision.current) setResult(next);
        } catch {
            if (mounted.current && request === revision.current) {
                setResult({ available: false, reason: "ASSESSMENT_FAILED" });
            }
        } finally {
            if (mounted.current && request === revision.current) {
                busy.current = false;
                setPending(false);
            }
        }
    };

    const summary = result?.available ? result.summary : null;
    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Text style={styles.title}>경로 데이터 품질 검사</Text>
                <Pressable testID="route-quality-close" accessibilityRole="button" accessibilityLabel="검사 화면 닫기"
                    onPress={() => router.canGoBack() ? router.back() : router.replace("/schedule")}>
                    <Text style={styles.link}>닫기</Text>
                </Pressable>
            </View>
            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
                <View style={styles.card}>
                    <Text style={styles.caption}>P1-2 개발 전용 · 합성 예시</Text>
                    <Text testID="route-quality-guidance-state" style={styles.off}>자동 길안내 OFF</Text>
                    <Text style={styles.note}>읽기 전용 계약 검사입니다. API 요청·위치 추적·일정 변경은 없습니다. 형상 검사를 통과해도 실제 길안내가 시작되지 않습니다.</Text>
                    <Text testID="route-quality-field-validation" style={styles.warning}>실주행 미검증 · 실제 노선의 정확도 보장 아님</Text>
                </View>

                <Text style={styles.heading}>검사할 예시</Text>
                <View style={styles.fixtures}>
                    {journeyRouteFixtures.map(fixture => (
                        <Pressable key={fixture.id} testID={`route-quality-fixture-${fixture.id}`}
                            accessibilityRole="button" accessibilityLabel={fixture.title}
                            accessibilityState={{ selected: fixture.id === selectedId }}
                            onPress={() => selectFixture(fixture.id)}
                            style={[styles.fixture, fixture.id === selectedId && styles.fixtureSelected]}>
                            <Text style={[styles.fixtureText, fixture.id === selectedId && styles.fixtureTextSelected]}>{fixture.title}</Text>
                        </Pressable>
                    ))}
                </View>
                <Text testID="route-quality-fixture-description" style={styles.note}>{selected?.description ?? "검사할 예시가 없습니다."}</Text>
                <Pressable testID="route-quality-assess" accessibilityRole="button" accessibilityLabel="선택한 경로 검사"
                    disabled={pending || !selected} style={[styles.button, (pending || !selected) && styles.disabled]}
                    onPress={() => { assess().catch(() => undefined); }}>
                    <Text style={styles.buttonText}>{pending ? "검사 중…" : "선택한 경로 검사"}</Text>
                </Pressable>

                <Text testID="route-quality-status" accessibilityLiveRegion="polite" style={styles.heading}>
                    {pending ? "검사 중" : result ? (result.available ? "검사 완료 · 자동 길안내 OFF" : "검사 불가") : "예시 선택 후 검사를 눌러 주세요"}
                </Text>
                {result && !result.available ? (
                    <View testID="route-quality-unavailable" style={styles.card}>
                        <Text style={styles.warning}>검사할 수 없습니다: {result.reason}</Text>
                        <Text style={styles.note}>개발용 네이티브 빌드와 입력 형식을 확인해 주세요.</Text>
                    </View>
                ) : null}
                {summary ? (
                    <View testID="route-quality-result" style={styles.results}>
                        <View style={styles.card}>
                            <Text testID="route-quality-source" style={styles.row}>출처: {summary.provider} · {summary.context}</Text>
                            <Text style={styles.row}>계약 v{summary.schemaVersion} · 경로 revision {summary.routeRevision} · {summary.evaluationMode}</Text>
                            <Text testID="route-quality-reasons" style={styles.codes}>{summary.reasonCodes.join("\n") || "별도 사유 없음"}</Text>
                        </View>
                        {summary.legs.map(leg => (
                            <View key={leg.index} testID={`route-quality-leg-${leg.index}`} style={styles.card}>
                                <Text style={styles.heading}>{leg.index + 1}번 구간 · {leg.kind}</Text>
                                <Text testID={`route-quality-leg-${leg.index}-geometry`} style={styles.row}>
                                    {leg.geometryUsable ? "형상 검사 통과" : "형상 보완 필요"}
                                </Text>
                                <Text testID={`route-quality-leg-${leg.index}-counts`} style={styles.row}>형상점 {leg.shapePointCount}개 · 보존 정류장 {leg.stopCount}개</Text>
                                <Text testID={`route-quality-leg-${leg.index}-length`} style={styles.row}>형상 길이: {leg.geometryLengthMeters == null ? "확인 불가" : `${leg.geometryLengthMeters.toFixed(1)} m`}</Text>
                                <Text testID={`route-quality-leg-${leg.index}-stop-applicability`} style={styles.row}>
                                    {leg.kind === "WALK" ? "정류장 순서·방향: 도보 구간 해당 없음"
                                        : `정류장 순서: ${leg.stopSequenceUsable ? "검사 통과" : "보완 필요"} · 명시적 방향: ${leg.directionExplicit ? "있음" : "없음"}`}
                                </Text>
                                <Text testID={`route-quality-leg-${leg.index}-reasons`} style={styles.codes}>{leg.reasonCodes.join("\n") || "별도 사유 없음"}</Text>
                            </View>
                        ))}
                    </View>
                ) : null}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: "#F2F6FB" },
    header: { padding: 18, flexDirection: "row", alignItems: "center", gap: 12 },
    title: { flex: 1, fontSize: 20, fontWeight: "700", color: "#152A43" },
    link: { padding: 8, color: "#1264C7", fontSize: 14 },
    content: { paddingHorizontal: 18, gap: 12 },
    card: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 16, gap: 7 },
    caption: { color: "#52657A", fontSize: 13 },
    off: { color: "#344A60", fontSize: 24, fontWeight: "800" },
    heading: { color: "#173953", fontSize: 16, fontWeight: "600", lineHeight: 23 },
    note: { color: "#415971", fontSize: 13, lineHeight: 21 },
    warning: { color: "#815019", fontSize: 13, lineHeight: 21 },
    fixtures: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    fixture: { flexGrow: 1, flexBasis: "46%", minHeight: 47, padding: 10, borderRadius: 11, borderWidth: 1, borderColor: "#CDD8E7", justifyContent: "center", backgroundColor: "#FFFFFF" },
    fixtureSelected: { borderColor: "#1264C7", backgroundColor: "#E6F0FF" },
    fixtureText: { color: "#415971", fontSize: 13, lineHeight: 19 },
    fixtureTextSelected: { color: "#1264C7", fontWeight: "700" },
    button: { minHeight: 47, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#1264C7", padding: 12 },
    buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
    disabled: { opacity: 0.4 },
    results: { gap: 12 },
    row: { color: "#344A60", fontSize: 13, lineHeight: 20 },
    codes: { color: "#52657A", fontSize: 12, lineHeight: 19 },
});
