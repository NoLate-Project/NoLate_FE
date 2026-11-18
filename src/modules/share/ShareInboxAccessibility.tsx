import React from "react";
import {
    Pressable,
    View,
    type PressableProps,
    type ViewProps,
} from "react-native";

export function ShareInboxButton({ ref, ...props }: PressableProps & { ref?: React.Ref<View> }) {
    return (
        <Pressable
            {...props}
            ref={ref}
            accessible
            role="button"
            accessibilityRole="button"
        />
    );
}

export function ShareInboxDecoration(props: ViewProps) {
    return (
        <View
            {...props}
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
        />
    );
}
