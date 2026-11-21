import React, { useLayoutEffect, useRef } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { Easing, FadeIn, Keyframe, ReduceMotion } from "react-native-reanimated";
import type { JourneyRouteInput } from "./journeyRouteInput";
import { SavedJourneyRouteBar } from "./SavedJourneyRouteBar";
import { useSavedJourneyGuidanceView } from "./useSavedJourneyGuidanceView";
import type { SavedJourneyStage } from "./savedJourneyStage";
import type { SavedJourneyGuidanceView } from "./savedJourneyGuidance";
import { SAVED_JOURNEY_MOTION } from "./savedJourneyMotion";

const instructionEntrance = FadeIn.duration(SAVED_JOURNEY_MOTION.instructionMs).reduceMotion(ReduceMotion.System);
const instructionChange = new Keyframe({
    0: { opacity: 0.6, transform: [{ translateY: 4 }] },
    100: { opacity: 1, transform: [{ translateY: 0 }], easing: Easing.bezier(...SAVED_JOURNEY_MOTION.contentCurve) },
}).duration(SAVED_JOURNEY_MOTION.instructionMs).reduceMotion(ReduceMotion.System);

function arrivalCopy(arrival: NonNullable<SavedJourneyGuidanceView['arrival']>) {
    if (arrival.kind === 'SUBWAY') return `${arrival.directionLabel} 열차 약 ${Math.ceil(arrival.remainingSeconds / 60)}분 뒤 도착`;
    return `${arrival.directionLabel} · 버스 도착까지 약 ${arrival.remainingSeconds}초`;
}

export function SavedJourneyInstruction({ stage, value, isDark, reduceMotion, legKind, compact = false, inFooter = false }: {
    stage: SavedJourneyStage; value: SavedJourneyGuidanceView; isDark: boolean; reduceMotion: boolean;
    legKind?: JourneyRouteInput["legs"][number]["kind"];
    compact?: boolean;
    inFooter?: boolean;
}) {
    const standard = useWindowDimensions().fontScale <= 1.35;
    const hasShownInstruction = useRef(false);
    useLayoutEffect(() => {
        hasShownInstruction.current = true;
    }, []);
    const checking = value.phase === "UNAVAILABLE" && stage.title === "위치 확인 중";
    const icon = value.phase === "UNAVAILABLE" ? "location-outline"
        : value.phase === "READY" ? "navigate-outline"
        : legKind === "SUBWAY" ? "train-outline"
        : legKind === "BUS" ? "bus-outline" : "walk-outline";
    const text = <>
        <Text testID="saved-journey-instruction" accessibilityRole="header" accessibilityLiveRegion="polite"
            style={[styles.title, compact && standard && styles.compactTitle, inFooter && styles.footerTitle, isDark && styles.darkTitle]}>
            {checking ? "현재 위치를 확인 중이에요" : stage.title}
        </Text>
        <Text testID="saved-journey-progress" style={[styles.action, compact && standard && styles.compactAction, inFooter && styles.footerAction, isDark && styles.darkAction]}>
            {checking ? "위치가 확인되면 안내를 이어가요." : stage.action}
        </Text>
        {value.arrival && <Text testID="saved-journey-instruction-arrival" style={[styles.row, isDark && styles.darkCopy]}>
            {arrivalCopy(value.arrival)}
        </Text>}
    </>;
    if (inFooter) return <View style={styles.footerInstruction}>{text}</View>;
    if (!standard) return <Animated.View key={stage.title} entering={reduceMotion ? undefined : instructionEntrance}
        testID="saved-journey-instruction-panel" style={styles.instruction}>{text}</Animated.View>;

    const modeIcon = <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={[styles.instructionIcon, compact && styles.compactIcon, isDark && styles.darkInstructionIcon]}>
        <Ionicons accessible={false} name={icon} size={compact ? 19 : 21} color={isDark ? "#A3C9FF" : "#205DD1"} />
    </View>;
    return <View testID="saved-journey-instruction-panel" style={[
        styles.instruction, styles.standardInstruction, { borderBottomColor: isDark ? "#303A49" : "#E5EAF0" },
        compact && styles.compactInstruction,
    ]}>
        {compact && modeIcon}
        <Animated.View key={`${value.phase}:${stage.activeLegIndex}:${stage.title}`}
            entering={reduceMotion || !hasShownInstruction.current ? undefined : instructionChange}
            style={styles.instructionText}>{text}</Animated.View>
        {!compact && modeIcon}
    </View>;
}

/** Read-only shared route-detail view. Mount/unmount never starts/stops tracking or HTTP. */
export function SavedJourneyGuidanceCard({ input, scheduleId, compact = false, isDark = false }: {
    input: JourneyRouteInput | null; scheduleId: string; compact?: boolean; isDark?: boolean;
}) {
    if (!input) return null;
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
            ? arrivalCopy(value.arrival)
            : position?.waiting ? "도착정보 확인 중 · 탑승 미확정" : position ? "현재 위치에 맞춰 안내합니다" : "위치 정보 업데이트 필요"}</Text>
    </View>;
}
const styles = StyleSheet.create({
    instruction: { gap: 5, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
    standardInstruction: { flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
    compactInstruction: { paddingHorizontal: 4, paddingTop: 2, paddingBottom: 6, gap: 10, borderBottomWidth: 0 },
    compactTitle: { fontSize: 18, lineHeight: 24 },
    compactAction: { fontSize: 14, lineHeight: 20 },
    footerInstruction: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8, paddingHorizontal: 4 },
    footerTitle: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
    footerAction: { fontSize: 14, lineHeight: 20 },
    compactIcon: { width: 36, height: 36, borderRadius: 18 },
    instructionText: { flex: 1, gap: 4 },
    instructionIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: "#EAF2FF", alignItems: "center", justifyContent: "center" },
    darkInstructionIcon: { backgroundColor: "#233653" },
    card: { backgroundColor: "#EAF3FF", padding: 14, marginVertical: 8, borderRadius: 16, gap: 6 },
    darkCard: { backgroundColor: "#15283D" },
    caption: { color: "#52657A", fontSize: 12 }, title: { color: "#173953", fontSize: 21, fontWeight: "700", letterSpacing: -0.35 },
    action: { color: "#1264C7", fontSize: 16, fontWeight: "600", lineHeight: 23 }, darkAction: { color: "#79B8FF" },
    row: { color: "#344A60", fontSize: 13 },
    darkCopy: { color: "#B8CCE0" }, darkTitle: { color: "#F1F6FC" },
});
