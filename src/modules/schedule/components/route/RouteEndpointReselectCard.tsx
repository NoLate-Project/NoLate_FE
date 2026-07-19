import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons as ExpoIonicons } from "@expo/vector-icons";

function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
    return <ExpoIonicons {...props} accessible={false} importantForAccessibility="no" />;
}

type RouteEndpointReselectCardProps = {
    originText: string;
    destinationText: string;
    onEditOrigin: () => void;
    onEditDestination: () => void;
    onSwap: () => void;
    colors: {
        surface: string;
        surface2: string;
        border: string;
        textPrimary: string;
        textSecondary: string;
        accentGreen: string;
        accentRed: string;
    };
    style?: StyleProp<ViewStyle>;
};

export default function RouteEndpointReselectCard({
    originText,
    destinationText,
    onEditOrigin,
    onEditDestination,
    onSwap,
    colors,
    style,
}: RouteEndpointReselectCardProps) {
    const resolvedOriginText = originText || "출발지 미지정";
    const resolvedDestinationText = destinationText || "도착지 미지정";

    return (
        <View
            style={[
                styles.card,
                style,
                { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
        >
            <View style={styles.endpointRows}>
                <View
                    pointerEvents="none"
                    style={[styles.railLine, { backgroundColor: colors.border }]}
                />
                <Pressable
                    onPress={onEditOrigin}
                    accessibilityRole="button"
                    accessibilityLabel={`출발지 재선택, 현재 ${resolvedOriginText}`}
                    accessibilityHint="검색 또는 지도에서 출발지를 다시 선택합니다"
                    style={({ pressed }) => [styles.endpointButton, pressed && styles.pressed]}
                >
                    <View pointerEvents="none" style={styles.markerCell}>
                        <View style={[styles.dot, { borderColor: colors.accentGreen }]} />
                    </View>
                    <Text style={[styles.endpointLabel, { color: colors.textSecondary }]}>출발지</Text>
                    <Text numberOfLines={1} style={[styles.endpointText, { color: colors.textPrimary }]}>
                        {resolvedOriginText}
                    </Text>
                    <Text style={[styles.editText, { color: colors.textSecondary }]}>변경</Text>
                </Pressable>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <Pressable
                    onPress={onEditDestination}
                    accessibilityRole="button"
                    accessibilityLabel={`도착지 재선택, 현재 ${resolvedDestinationText}`}
                    accessibilityHint="검색 또는 지도에서 도착지를 다시 선택합니다"
                    style={({ pressed }) => [styles.endpointButton, pressed && styles.pressed]}
                >
                    <View pointerEvents="none" style={styles.markerCell}>
                        <View style={[styles.dot, { borderColor: colors.accentRed }]} />
                    </View>
                    <Text style={[styles.endpointLabel, { color: colors.textSecondary }]}>도착지</Text>
                    <Text numberOfLines={1} style={[styles.endpointText, { color: colors.textPrimary }]}>
                        {resolvedDestinationText}
                    </Text>
                    <Text style={[styles.editText, { color: colors.textSecondary }]}>변경</Text>
                </Pressable>
            </View>

            <Pressable
                onPress={onSwap}
                accessibilityRole="button"
                accessibilityLabel="출발지와 도착지 바꾸기"
                hitSlop={4}
                style={({ pressed }) => [
                    styles.swapButton,
                    { backgroundColor: colors.surface2, borderColor: colors.border },
                    pressed && styles.pressed,
                ]}
            >
                <Ionicons name="swap-vertical" size={22} color={colors.textSecondary} />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        minHeight: 104,
        borderWidth: 1,
        borderRadius: 20,
        paddingLeft: 14,
        paddingRight: 8,
        paddingVertical: 7,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        overflow: "hidden",
    },
    railLine: {
        position: "absolute",
        left: 8.5,
        top: 22,
        bottom: 22,
        width: StyleSheet.hairlineWidth,
        borderRadius: 999,
    },
    markerCell: {
        width: 18,
        alignSelf: "stretch",
        alignItems: "center",
        justifyContent: "center",
    },
    dot: {
        width: 10,
        height: 10,
        borderRadius: 999,
        borderWidth: 2,
    },
    endpointRows: {
        flex: 1,
        minWidth: 0,
        alignSelf: "stretch",
        position: "relative",
    },
    endpointButton: {
        flex: 1,
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        borderRadius: 9,
        paddingHorizontal: 2,
    },
    endpointLabel: {
        width: 35,
        fontSize: 10,
        fontWeight: "800",
        lineHeight: 13,
    },
    endpointText: {
        flex: 1,
        minWidth: 0,
        fontSize: 14,
        fontWeight: "900",
        lineHeight: 19,
    },
    editText: {
        fontSize: 10,
        fontWeight: "900",
        lineHeight: 13,
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        alignSelf: "stretch",
        marginLeft: 26,
    },
    swapButton: {
        width: 38,
        height: 64,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
    },
    pressed: {
        opacity: 0.72,
    },
});
