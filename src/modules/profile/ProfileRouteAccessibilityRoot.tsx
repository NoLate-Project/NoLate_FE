import React from "react";
import { View, type ViewProps } from "react-native";
import { useIsFocused } from "@react-navigation/native";

export default function ProfileRouteAccessibilityRoot(props: ViewProps) {
    const isFocused = useIsFocused();

    return (
        <View
            {...props}
            accessibilityElementsHidden={!isFocused}
            importantForAccessibility={isFocused ? "auto" : "no-hide-descendants"}
        />
    );
}
