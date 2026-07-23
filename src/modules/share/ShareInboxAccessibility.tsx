import React from "react";
import {
    Pressable,
    View,
    type PressableProps,
    type ViewProps,
} from "react-native";

export function ShareInboxButton(props: PressableProps) {
    return (
        <Pressable
            {...props}
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
