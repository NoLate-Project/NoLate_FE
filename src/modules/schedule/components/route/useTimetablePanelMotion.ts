import { useLayoutEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import { useSystemReduceMotion } from "../../../performance/useSystemReduceMotion";

type TimetablePanel = "lookup" | "picker" | "confirm";

export function useTimetablePanelMotion(panel: TimetablePanel) {
    const reduceMotionEnabled = useSystemReduceMotion();
    const opacity = useRef(new Animated.Value(1)).current;
    const previousPanel = useRef(panel);

    useLayoutEffect(() => {
        const changed = previousPanel.current !== panel;
        previousPanel.current = panel;
        if (!changed || reduceMotionEnabled) {
            opacity.setValue(1);
            return;
        }
        opacity.setValue(0.72);
        const transition = Animated.timing(opacity, {
            toValue: 1,
            duration: panel === "lookup" ? 140 : 180,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        });
        transition.start();
        return () => transition.stop();
    }, [opacity, panel, reduceMotionEnabled]);

    return { reduceMotionEnabled, panelAnimatedStyle: { opacity } };
}
