import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "../theme/ThemeContext";
import { getNextManualActionLabel } from "./journeyPresentation";
import type { JourneyPhase, JourneyProgress, NormalizedJourneyRoute } from "./types";

const PHASE_LABELS: Record<JourneyPhase, string> = {
    READY: "출발 준비", WALKING_TO_STOP: "승차 지점으로 이동", WAITING: "탑승 대기",
    RIDING: "탑승 중", ALIGHTING: "하차 준비", TRANSFERRING: "환승 중",
    FINAL_WALK: "목적지로 이동", ARRIVED: "목적지 도착", STOPPED: "길안내 종료",
};

type Props = {
    progress: JourneyProgress;
    route: NormalizedJourneyRoute;
    pending?: boolean;
    onAdvance: () => void;
    onStop: () => void;
};

/** The real journey and local preview share the same acknowledged-progress presentation. */
export function JourneyGuidanceView({ progress, route, pending = false, onAdvance, onStop }: Props) {
    const { colors, mode } = useTheme();
    const accent = mode === "dark" ? "#78B6FF" : "#1768E8";
    const buttonForeground = mode === "dark" ? "#0B2254" : "#FFFFFF";
    const terminal = progress.phase === "ARRIVED" || progress.phase === "STOPPED";
    const completedLegs = progress.phase === "ARRIVED" ? route.legs.length : progress.activeLegIndex;
    const actionLabel = getNextManualActionLabel(progress, route);
    const destination = route.legs.at(-1)?.detail.endName?.trim() || "목적지";
    const percentage = Math.round(Math.max(0, Math.min(1, completedLegs / Math.max(1, route.legs.length))) * 100);

    return (
        <View style={styles.content}>
            <View style={[styles.hero, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
                <View style={styles.heroTop}>
                    <Text style={[styles.eyebrow, { color: accent }]}>직접 확인하는 길안내</Text>
                    <Ionicons name={progress.phase === "ARRIVED" ? "checkmark-circle" : "navigate-outline"} size={22} color={accent} />
                </View>
                <Text style={[styles.destination, { color: colors.textPrimary }]}>{destination}까지</Text>
                <Text testID="journey-state" accessibilityLiveRegion="polite" style={[styles.phase, { color: accent }]}>
                    {PHASE_LABELS[progress.phase]}
                </Text>
                <Text testID="journey-instruction" style={[styles.instruction, { color: colors.textPrimary }]}>
                    {progress.nextInstruction}
                </Text>
                <View style={[styles.progressTrack, { backgroundColor: colors.border }]} accessibilityRole="progressbar"
                    accessibilityLabel="직접 확인한 경로 구간" accessibilityValue={{ min: 0, max: route.legs.length, now: completedLegs }}>
                    <View style={[styles.progressFill, { backgroundColor: accent, width: `${percentage}%` }]} />
                </View>
                <Text style={[styles.caption, { color: colors.textSecondary }]}>
                    확인한 구간 {completedLegs} / {route.legs.length}
                </Text>
            </View>

            <View style={[styles.manualNote, { borderColor: colors.border }]}>
                <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
                <Text style={[styles.noteText, { color: colors.textSecondary }]}>
                    이동 단계를 아래 버튼으로 직접 확인해 주세요. 현재 위치 추적과 실시간 도착·대기시간 안내는 제공하지 않아요.
                </Text>
            </View>

            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>이동 경로</Text>
            <View style={[styles.timeline, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                {route.legs.map((leg, index) => {
                    const detail = leg.detail;
                    const done = progress.phase === "ARRIVED" || index < progress.activeLegIndex;
                    const current = !terminal && index === progress.activeLegIndex;
                    const label = detail.lineName?.trim() || detail.label || (leg.isRide ? "대중교통" : "도보");
                    const icon = detail.kind === "BUS" ? "bus-outline" : detail.kind === "SUBWAY" ? "subway-outline" : "walk-outline";
                    return (
                        <View key={leg.index} testID={`journey-leg-${leg.index}`} style={[styles.leg, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                            <View style={[styles.legIcon, { backgroundColor: current ? accent : colors.surface2 }]}>
                                <Ionicons name={done ? "checkmark" : icon} size={21} color={current ? (mode === "dark" ? "#0B2254" : "#FFFFFF") : colors.textSecondary} />
                            </View>
                            <View style={styles.legContent}>
                                <View style={styles.legHeading}>
                                    <Text style={[styles.legTitle, { color: colors.textPrimary }]}>{label}</Text>
                                    <Text style={[styles.legBadge, { color: current ? accent : colors.textSecondary }]}>
                                        {done ? "완료" : current ? "현재 구간" : "예정"}
                                    </Text>
                                </View>
                                <Text style={[styles.legPath, { color: colors.textSecondary }]}>
                                    {detail.startName || "출발 지점"} → {detail.endName || "도착 지점"}
                                </Text>
                                {detail.directionName ? <Text style={[styles.caption, { color: colors.textSecondary }]}>{detail.directionName}</Text> : null}
                                {current && detail.boardingPlatform && progress.phase === "WAITING" ? (
                                    <Text style={[styles.caption, { color: accent }]}>{detail.boardingPlatform}</Text>
                                ) : null}
                            </View>
                        </View>
                    );
                })}
            </View>

            {actionLabel ? (
                <Pressable testID="journey-advance" accessibilityRole="button" accessibilityState={{ disabled: pending, busy: pending }}
                    disabled={pending} onPress={onAdvance}
                    style={({ pressed }) => [styles.primaryButton, { backgroundColor: accent, opacity: pending || pressed ? 0.6 : 1 }]}>
                    {pending ? <ActivityIndicator color={mode === "dark" ? "#0B2254" : "#FFFFFF"} /> : null}
                    <Text style={[styles.primaryLabel, { color: buttonForeground }]}>{actionLabel}</Text>
                </Pressable>
            ) : (
                <Text accessibilityLiveRegion="polite" style={[styles.terminalCopy, { color: colors.textSecondary }]}>
                    {progress.phase === "ARRIVED" ? "수고했어요. 길안내를 마쳤어요." : "이 경로의 길안내가 종료되었어요."}
                </Text>
            )}
            {!terminal ? (
                <Pressable testID="journey-stop" accessibilityRole="button" accessibilityState={{ disabled: pending }} disabled={pending}
                    onPress={onStop} style={({ pressed }) => [styles.stopButton, { opacity: pending || pressed ? 0.5 : 1 }]}>
                    <Text style={[styles.stopLabel, { color: colors.textSecondary }]}>길안내 종료</Text>
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    content: { gap: 16 },
    hero: { borderWidth: 1, borderRadius: 24, padding: 22, gap: 10 },
    heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
    eyebrow: { fontSize: 12, fontWeight: "700" },
    destination: { fontSize: 24, lineHeight: 32, fontWeight: "800" },
    phase: { fontSize: 14, fontWeight: "700", marginTop: 4 },
    instruction: { fontSize: 19, lineHeight: 28, fontWeight: "600" },
    progressTrack: { height: 6, borderRadius: 3, overflow: "hidden", marginTop: 10 },
    progressFill: { height: "100%", borderRadius: 3 },
    caption: { fontSize: 12, lineHeight: 18 },
    manualNote: { flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 14, borderWidth: 1, borderRadius: 14 },
    noteText: { flex: 1, fontSize: 12, lineHeight: 19 },
    sectionTitle: { fontSize: 17, fontWeight: "700", marginTop: 6 },
    timeline: { borderWidth: 1, borderRadius: 20, overflow: "hidden" },
    leg: { flexDirection: "row", padding: 16, gap: 13, alignItems: "flex-start" },
    legIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
    legContent: { flex: 1, gap: 5 },
    legHeading: { flexDirection: "row", gap: 8, justifyContent: "space-between", alignItems: "center" },
    legTitle: { flex: 1, fontSize: 15, fontWeight: "700", lineHeight: 21 },
    legBadge: { fontSize: 11, fontWeight: "600" },
    legPath: { fontSize: 13, lineHeight: 20 },
    primaryButton: { minHeight: 54, borderRadius: 17, padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 4 },
    primaryLabel: { fontSize: 16, fontWeight: "700" },
    stopButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
    stopLabel: { fontSize: 14, fontWeight: "600" },
    terminalCopy: { textAlign: "center", fontSize: 14, lineHeight: 22, paddingVertical: 16 },
});
