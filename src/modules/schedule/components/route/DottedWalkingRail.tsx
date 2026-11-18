import React, { useState } from "react";
import { StyleSheet, View } from "react-native";

const DOT_SIZE = 5;
const DOT_GAP = 6;

export function DottedWalkingRail({ color }: { color: string }) {
    const [height, setHeight] = useState(0);
    const count = Math.floor((height + DOT_GAP) / (DOT_SIZE + DOT_GAP));
    return (
        <View
            pointerEvents="none"
            style={styles.rail}
            onLayout={({ nativeEvent }) => setHeight(nativeEvent.layout.height)}
        >
            {Array.from({ length: count }, (_, index) => (
                <View key={index} style={[styles.dot, { backgroundColor: color }]} />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    rail: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "center",
        gap: DOT_GAP,
    },
    dot: {
        width: DOT_SIZE,
        height: DOT_SIZE,
        borderRadius: DOT_SIZE / 2,
    },
});
