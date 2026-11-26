import React, { useLayoutEffect, useRef } from "react";
import { Animated, Image } from "react-native";
import { useSystemReduceMotion } from "../modules/performance/useSystemReduceMotion";

const artwork = require("../../assets/nolate-loading-mark.png");

type Props = {
    size: number;
    delayMs?: number;
    durationMs?: number;
    startup?: boolean;
};

export default function NoLateLoadingMark({ size, delayMs = 150, durationMs = 200, startup = false }: Props) {
    const reduceMotion = useSystemReduceMotion();
    const opacity = useRef(new Animated.Value(startup || reduceMotion ? 1 : 0)).current;
    const revealed = useRef(false);

    useLayoutEffect(() => {
        if (startup || reduceMotion || revealed.current) {
            revealed.current = true;
            opacity.setValue(1);
            return;
        }
        const fade = Animated.timing(opacity, { toValue: 1, duration: durationMs, delay: delayMs, useNativeDriver: true });
        fade.start(({ finished }) => { if (finished) revealed.current = true; });
        return () => fade.stop();
    }, [delayMs, durationMs, opacity, reduceMotion, startup]);

    return (
        <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ opacity }}>
            <Image source={artwork} testID="nolate-loading-mark" resizeMode="contain" fadeDuration={0}
                accessible={false} accessibilityIgnoresInvertColors style={{ width: size, height: size }} />
        </Animated.View>
    );
}
