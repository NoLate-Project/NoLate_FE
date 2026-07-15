import React, { useEffect } from "react";
import { Image, StyleSheet, View } from "react-native";
import Reanimated, {
    cancelAnimation,
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withSequence,
    withTiming,
} from "react-native-reanimated";

const APP_LOGO = require("../../../../../assets/icon.png");

const BLUE = "#246BFE";
const ORBIT_DURATION_MS = 1900;
const PULSE_HALF_DURATION_MS = 1050;
const PULSE_EASING = Easing.bezier(0.2, 0.72, 0.24, 1);

type Props = {
    accessibilityLabel: string;
};

/**
 * 빠른 일정 분석처럼 실제 완료율을 계산할 수 없는 작업에 사용하는 브랜드 로더다.
 *
 * 로고의 화살표는 방향성이 강하므로 로고 자체를 360도로 돌리지 않는다. 대신 로고는
 * 정방향으로 유지하고 바깥 궤도와 빛 점만 회전시켜 브랜드 인지성과 진행 중이라는
 * 피드백을 동시에 보존한다. 모든 애니메이션은 Reanimated UI 스레드에서 실행된다.
 */
export default function QuickScheduleLogoLoader({ accessibilityLabel }: Props) {
    const orbitRotation = useSharedValue(0);
    const pulse = useSharedValue(0);

    useEffect(() => {
        orbitRotation.value = withRepeat(
            withTiming(360, {
                duration: ORBIT_DURATION_MS,
                easing: Easing.linear,
            }),
            -1,
            false
        );
        pulse.value = withRepeat(
            withSequence(
                withTiming(1, {
                    duration: PULSE_HALF_DURATION_MS,
                    easing: PULSE_EASING,
                }),
                withTiming(0, {
                    duration: PULSE_HALF_DURATION_MS,
                    easing: PULSE_EASING,
                })
            ),
            -1,
            false
        );

        // 모달이 닫힌 뒤 무한 반복 애니메이션이 남아 UI 스레드를 점유하지 않도록
        // 공유 값에 연결된 두 애니메이션을 명시적으로 정리한다.
        return () => {
            cancelAnimation(orbitRotation);
            cancelAnimation(pulse);
        };
    }, [orbitRotation, pulse]);

    const orbitAnimatedStyle = useAnimatedStyle(() => ({
        transform: [{ rotate: `${orbitRotation.value}deg` }],
    }));
    const logoAnimatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: 0.985 + pulse.value * 0.03 }],
    }));
    const glowAnimatedStyle = useAnimatedStyle(() => ({
        opacity: 0.16 + pulse.value * 0.2,
        transform: [{ scale: 0.96 + pulse.value * 0.12 }],
    }));

    return (
        <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={accessibilityLabel}
            style={styles.stage}
        >
            <Reanimated.View
                pointerEvents="none"
                style={[styles.glow, glowAnimatedStyle]}
            />
            <View pointerEvents="none" style={styles.orbitTrack} />
            <Reanimated.View
                pointerEvents="none"
                style={[styles.orbitSpinner, orbitAnimatedStyle]}
            >
                <View style={styles.orbitDot} />
            </Reanimated.View>
            <Reanimated.View style={[styles.logoFrame, logoAnimatedStyle]}>
                <Image source={APP_LOGO} resizeMode="cover" style={styles.logoImage} />
            </Reanimated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    stage: {
        width: 124,
        height: 124,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 4,
    },
    glow: {
        position: "absolute",
        width: 88,
        height: 88,
        borderRadius: 44,
        backgroundColor: "rgba(36,107,254,0.24)",
        shadowColor: BLUE,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 24,
    },
    orbitTrack: {
        position: "absolute",
        width: 108,
        height: 108,
        borderRadius: 54,
        borderWidth: 1,
        borderColor: "rgba(36,107,254,0.18)",
    },
    orbitSpinner: {
        position: "absolute",
        width: 108,
        height: 108,
        borderRadius: 54,
        borderWidth: 2,
        borderTopColor: "#58D7F7",
        borderRightColor: BLUE,
        borderBottomColor: "rgba(69,199,165,0.36)",
        borderLeftColor: "rgba(36,107,254,0.08)",
    },
    orbitDot: {
        position: "absolute",
        top: -5,
        left: 49,
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: "#8BE8FF",
        shadowColor: "#58D7F7",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.9,
        shadowRadius: 7,
    },
    logoFrame: {
        width: 68,
        height: 68,
        borderRadius: 34,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.38)",
        overflow: "hidden",
        backgroundColor: BLUE,
    },
    logoImage: {
        width: "100%",
        height: "100%",
    },
});
