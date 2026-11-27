import React from "react";
import { View } from "react-native";
import NoLateLoadingMark from "./NoLateLoadingMark";

type Props = {
    delayMs?: number;
    tone?: "accent" | "inverse";
    size?: "inline" | "compact" | "regular";
};

const markSizes = { inline: 20, compact: 20, regular: 28 };

/** The surrounding status owns the announcement; every loading size uses the same blue artwork. */
export default function LoadingIndicator({ delayMs = 0, size = "compact" }: Props) {
    return (
        <View
            testID="loading-indicator"
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
        >
            <NoLateLoadingMark size={markSizes[size]} delayMs={delayMs} />
        </View>
    );
}
