import React from "react";
import { Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSavedJourneyBinding } from './useSavedJourneyBinding';
import type { JourneyRouteInput } from "./journeyRouteInput";
import { SavedJourneyRouteBar } from "./SavedJourneyRouteBar";
import { useSavedJourneyGuidanceView } from "./useSavedJourneyGuidanceView";

/** Read-only shared route-detail view. Mount/unmount never starts/stops tracking or HTTP. */
export function SavedJourneyGuidanceCard({ input, scheduleId, compact = false, isDark = false }: {
    input: JourneyRouteInput | null; scheduleId: string; compact?: boolean; isDark?: boolean;
}) {
    const binding = useSavedJourneyBinding(input, scheduleId);
    if (!__DEV__ || Platform.OS !== "ios" || !input) return null;
    if (!binding?.savedRouteValidated || !binding.guidanceEnabled || binding.scheduleId !== scheduleId) return null;
    return <GuidanceContent input={input} scheduleId={scheduleId} compact={compact} isDark={isDark} />;
}
function GuidanceContent({ input, scheduleId, compact, isDark }: { input: JourneyRouteInput; scheduleId: string; compact: boolean; isDark: boolean }) {
    // Remeasure native text on Dynamic Type changes; the observation hook stays mounted.
    const { fontScale } = useWindowDimensions();
    const { value, position, stage, layout } = useSavedJourneyGuidanceView(input, scheduleId);
    if (!value || !stage) return null;
    const copy = `${stage.title} · ${stage.action}`;
    if (compact) return <SavedJourneyRouteBar input={input} position={position} layout={layout} copy={copy} compact isDark={isDark} />;
    return <View key={fontScale} testID="saved-journey-guidance" style={[styles.card, isDark && styles.darkCard]}>
        <Text style={[styles.caption, isDark && styles.darkCopy]}>대중교통 안내</Text>
        <Text testID="saved-journey-instruction" accessibilityLiveRegion="polite" numberOfLines={2}
            style={[styles.title, isDark && styles.darkTitle]}>{stage.title}</Text>
        <Text testID="saved-journey-progress" style={[styles.action, isDark && styles.darkAction]}>{stage.action}</Text>
        <SavedJourneyRouteBar input={input} position={position} layout={layout} copy={copy} isDark={isDark} />
        <Text testID="saved-journey-arrival" style={[styles.row, isDark && styles.darkCopy]}>{value.arrival
            ? `${value.arrival.directionLabel} · 버스 도착까지 약 ${value.arrival.remainingSeconds}초`
            : position?.waiting ? "도착정보 확인 중 · 탑승 미확정" : position ? "현재 위치에 맞춰 안내합니다" : "위치 정보 업데이트 필요"}</Text>
    </View>;
}
const styles = StyleSheet.create({
    card: { backgroundColor: "#EAF3FF", padding: 14, marginVertical: 8, borderRadius: 16, gap: 6 },
    darkCard: { backgroundColor: "#15283D" },
    caption: { color: "#52657A", fontSize: 12 }, title: { color: "#173953", fontSize: 18, fontWeight: "700" },
    action: { color: "#1264C7", fontSize: 15, fontWeight: "600" }, darkAction: { color: "#79B8FF" },
    row: { color: "#344A60", fontSize: 13 },
    darkCopy: { color: "#B8CCE0" }, darkTitle: { color: "#F1F6FC" },
});
