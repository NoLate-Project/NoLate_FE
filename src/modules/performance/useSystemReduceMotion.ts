import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

/** Follows accessibility changes while the app is running. */
export function useSystemReduceMotion(): boolean {
    const initialValue = useReducedMotion();
    const [enabled, setEnabled] = useState(initialValue);

    useEffect(() => {
        let receivedUpdate = false;
        const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", next => {
            receivedUpdate = true;
            setEnabled(next);
        });
        AccessibilityInfo.isReduceMotionEnabled()
            .then(next => {
                if (!receivedUpdate) setEnabled(next);
            })
            .catch(() => undefined);
        return () => {
            receivedUpdate = true;
            subscription.remove();
        };
    }, []);

    return enabled;
}
