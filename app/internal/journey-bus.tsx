import { Redirect, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { JourneyAutomaticTrialPanel } from "../../src/modules/journey/JourneySelectedRouteTrial";
import { journeyBusFixtures } from "../../src/modules/journey/journeyBusFixtures";
import { syntheticBusMappingRoute } from "../../src/modules/journey/journeyBusMappingFixture";
import { resolveJourneyBusRouteMapping } from "../../src/modules/journey/journeyBusRouteBinding";

export default function JourneyBusRoute() {
    if (!__DEV__ || Platform.OS !== "ios") return <Redirect href="/schedule" />;
    return <JourneyBusScreen />;
}

function JourneyBusScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [selectedId, setSelectedId] = useState("first-bus-valid");
    const selected = journeyBusFixtures.find(fixture => fixture.id === selectedId);
    const mapping = useMemo(() => resolveJourneyBusRouteMapping(syntheticBusMappingRoute()), []);
    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Text style={styles.title}>첫 버스 관측 시험</Text>
                <Pressable testID="journey-bus-close" accessibilityRole="button" accessibilityLabel="화면만 닫기"
                    onPress={() => router.canGoBack() ? router.back() : router.replace("/schedule")}>
                    <Text style={styles.link}>화면만 닫기</Text>
                </Pressable>
            </View>
            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
                <Text style={styles.note}>합성 경로·시뮬레이터 위치·로컬 HTTP 시험 서버를 사용합니다. 첫 버스의 정류장 접근·대기·탑승 후보만 관측하며 실제 차량 탑승을 확정하지 않습니다.</Text>
                <View style={styles.fixtures}>
                    {journeyBusFixtures.map(fixture => (
                        <Pressable key={fixture.id} testID={`journey-bus-fixture-${fixture.id}`} accessibilityRole="button"
                            accessibilityLabel={fixture.title} accessibilityState={{ selected: fixture.id === selectedId }}
                            onPress={() => setSelectedId(fixture.id)} style={[styles.fixture, fixture.id === selectedId && styles.selected]}>
                            <Text style={styles.fixtureText}>{fixture.title}</Text>
                        </Pressable>
                    ))}
                </View>
                <Text testID="journey-bus-fixture-description" style={styles.note}>{selected?.description}</Text>
                <JourneyAutomaticTrialPanel input={selected?.input ?? null} scope="SANDBOX" stage="P2-2" mapping={mapping} />
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
