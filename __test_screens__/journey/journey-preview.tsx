import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { JourneyGuidanceView } from "../../src/modules/journey/JourneyGuidanceView";
import { normalizeJourneyRoute } from "../../src/modules/journey/journeyRoute";
import { createInitialJourneyProgress, transitionJourney } from "../../src/modules/journey/journeyStateMachine";
import type { JourneyManualAction } from "../../src/modules/journey/types";
import type { TransitLegDetail } from "../../src/modules/map/routingService";
import { useTheme } from "../../src/modules/theme/ThemeContext";

// Synthetic route for UI review only. It never creates a server session or requests location.
const PREVIEW_LEGS: TransitLegDetail[] = [
    { kind: "WALK", label: "정류장까지 도보", startName: "출발지", endName: "시청 앞", durationMinutes: 4 },
    { kind: "BUS", label: "402번 버스", lineName: "402번", startName: "시청 앞", endName: "환승역", directionName: "환승역 방면", durationMinutes: 15, stationCount: 6 },
    { kind: "WALK", label: "지하철로 환승", startName: "환승역 버스 정류장", endName: "환승역 승강장", durationMinutes: 5 },
    { kind: "SUBWAY", label: "2호선", lineName: "2호선", startName: "환승역", endName: "목적지역", directionName: "목적지역 방면", boardingPlatform: "2번 승강장", durationMinutes: 12, stationCount: 4 },
    { kind: "WALK", label: "목적지까지 도보", startName: "목적지역", endName: "약속 장소", durationMinutes: 3 },
];
const PREVIEW_ROUTE = normalizeJourneyRoute(PREVIEW_LEGS);

export default function JourneyPreviewRoute() {
    if (!__DEV__) return <Redirect href="/schedule" />;
    return <JourneyPreview />;
}

function JourneyPreview() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();
    const initial = () => createInitialJourneyProgress(
        { sessionId: "local-journey-preview", generation: 1, routeRevision: 1 }, PREVIEW_ROUTE, new Date().toISOString(),
    );
    const [progress, setProgress] = useState(initial);
    const apply = (type: JourneyManualAction["type"]) => setProgress((current) => transitionJourney(current, PREVIEW_ROUTE, {
        type, sessionId: current.sessionId, generation: current.generation, routeRevision: current.routeRevision,
        sequence: current.sequence + 1, observedAt: new Date().toISOString(), source: "MANUAL",
    }));

    return (
        <View style={[styles.root, { backgroundColor: colors.background }]}>
            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                <Pressable accessibilityRole="button" accessibilityLabel="미리보기 닫기" style={styles.headerButton}
                    onPress={() => router.canGoBack() ? router.back() : router.replace("/schedule")}>
                    <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
                </Pressable>
                <Text style={[styles.title, { color: colors.textPrimary }]}>길안내 미리보기</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="미리보기 처음부터" style={styles.reset} onPress={() => setProgress(initial())}>
                    <Text style={{ color: colors.textPrimary }}>초기화</Text>
                </Pressable>
            </View>
            <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
                <Text style={[styles.note, { color: colors.textSecondary }]}>개발용 가상 경로예요. 실제 일정이나 Live Activity에 반영되지 않아요.</Text>
                <JourneyGuidanceView progress={progress} route={PREVIEW_ROUTE} onAdvance={() => apply("ADVANCE")} onStop={() => apply("STOP")} />
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 8 },
    headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    title: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700" },
    reset: { minWidth: 54, minHeight: 44, alignItems: "center", justifyContent: "center" },
    scroll: { padding: 20, gap: 18 },
    note: { fontSize: 12, lineHeight: 19 },
});
