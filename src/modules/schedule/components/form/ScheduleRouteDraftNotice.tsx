import React from "react";
import { StyleSheet, Text } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";

export type ScheduleRouteDraftChange = { kind: "applied" | "removed"; revision: number };

const noticeEntry = FadeIn.duration(160).reduceMotion(ReduceMotion.System);

export function ScheduleRouteDraftNotice({ change, color }: {
    change?: ScheduleRouteDraftChange;
    color: string;
}) {
    if (!change) return null;
    return (
        <Animated.View key={change.revision} entering={noticeEntry}>
            <Text accessibilityLiveRegion="polite" lineBreakStrategyIOS="hangul-word" style={[styles.notice, { color }]}>
                {change.kind === "applied"
                    ? "일정을 저장하면 새 경로가 반영돼요."
                    : "일정을 저장하면 경로가 삭제돼요."}
            </Text>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    notice: { marginTop: 7, marginHorizontal: 2, fontSize: 12, fontWeight: "500" },
});
