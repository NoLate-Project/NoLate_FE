import { Redirect, useRouter } from "expo-router";
import React, { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { JourneyAutomaticTrialPanel } from "../../src/modules/journey/JourneySelectedRouteTrial";
import { journeyRouteFixtures } from "../../src/modules/journey/journeyRouteFixtures";

const fixtureIds = ["direct-provider-shape", "wrong-direction-shape", "invalid-middle-coordinate"];

export default function JourneyAutomaticRoute() {
    if (!__DEV__ || Platform.OS !== "ios") return <Redirect href="/schedule" />;
    return <JourneyAutomaticScreen />;
}

function JourneyAutomaticScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const fixtures = journeyRouteFixtures.filter(fixture => fixtureIds.includes(fixture.id));
    const [selectedId, setSelectedId] = useState("direct-provider-shape");
    const selected = fixtures.find(fixture => fixture.id === selectedId);
    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Text style={styles.title}>선택 경로 자동 출발 시험</Text>
                <Pressable testID="automatic-journey-close" accessibilityRole="button" accessibilityLabel="화면만 닫기"
                    onPress={() => router.canGoBack() ? router.back() : router.replace("/schedule")}>
                    <Text style={styles.link}>화면만 닫기</Text>
                </Pressable>
            </View>
            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
                <Text style={styles.note}>합성 예시 + 시뮬레이터 위치 입력 + 로컬 HTTP 시험 서버입니다. 실제 경로 조회나 실제 사용자 일정의 출발 확정이 아닙니다.</Text>
                <View style={styles.fixtures}>
                    {fixtures.map(fixture => (
                        <Pressable key={fixture.id} testID={`automatic-journey-fixture-${fixture.id}`} accessibilityRole="button"
                            accessibilityLabel={fixture.title} accessibilityState={{ selected: fixture.id === selectedId }}
                            onPress={() => setSelectedId(fixture.id)} style={[styles.fixture, fixture.id === selectedId && styles.selected]}>
                            <Text style={styles.fixtureText}>{fixture.title}</Text>
                        </Pressable>
                    ))}
                </View>
                <Text testID="automatic-journey-fixture-description" style={styles.note}>{selected?.description}</Text>
                <JourneyAutomaticTrialPanel input={selected?.input ?? null} scope="SANDBOX" />
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: "#FFFFFF" },
    header: { padding: 16, flexDirection: "row", alignItems: "center", gap: 8 },
    title: { flex: 1, fontSize: 19, fontWeight: "700", color: "#152A43" },
    link: { padding: 5, color: "#1264C7", fontSize: 13 },
    content: { paddingHorizontal: 16, gap: 10 },
    note: { color: "#415971", fontSize: 13, lineHeight: 21 },
    fixtures: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    fixture: { flexGrow: 1, flexBasis: "29%", minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: "#CDD8E7", padding: 9, justifyContent: "center" },
    selected: { borderColor: "#1264C7", backgroundColor: "#E6F0FF" },
    fixtureText: { color: "#173953", fontSize: 12, lineHeight: 18 },
});
