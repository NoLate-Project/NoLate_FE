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
    originRef?: React.Ref<View>;
    destinationRef?: React.Ref<View>;
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
    stackLabels?: boolean;
    footerAction?: React.ReactNode;
};

export default function RouteEndpointReselectCard({
    originText,
    destinationText,
    onEditOrigin,
    onEditDestination,
    originRef,
    destinationRef,
    onSwap,
    colors,
    style,
    stackLabels = false,
    footerAction,
}: RouteEndpointReselectCardProps) {
    const resolvedOriginText = originText || "출발지 미지정";
    const resolvedDestinationText = destinationText || "도착지 미지정";
    const endpoints = [
        { label: "출발지", name: resolvedOriginText, color: colors.accentGreen, onEdit: onEditOrigin, ref: originRef },
        { label: "도착지", name: resolvedDestinationText, color: colors.accentRed, onEdit: onEditDestination, ref: destinationRef },
    ];
    const swapButton = (
        <Pressable
            onPress={onSwap}
            accessibilityRole="button"
            accessibilityLabel="출발지와 도착지 바꾸기"
            hitSlop={4}
            style={({ pressed }) => [
                styles.swapButton,
                stackLabels && styles.stackedSwapButton,
                { backgroundColor: colors.surface2, borderColor: colors.border },
                pressed && styles.pressed,
            ]}
        >
            <Ionicons name="swap-vertical-outline" size={22} color={colors.textSecondary} />
        </Pressable>
    );

    return (
        <View
            style={[
                styles.card,
                style,
                stackLabels && styles.stackedCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
        >
            <View style={styles.endpointRows}>
                <View
                    pointerEvents="none"
                    style={[styles.railLine, { backgroundColor: colors.border }]}
                />
                {endpoints.map(({ label, name, color, onEdit, ref }, index) => (
                    <React.Fragment key={label}>
                        {index > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
                        <Pressable
                            ref={ref}
                            onPress={onEdit}
                            accessibilityRole="button"
                            accessibilityLabel={`${label} 재선택, 현재 ${name}`}
                            accessibilityHint={`검색 또는 지도에서 ${label}를 다시 선택합니다`}
                            style={({ pressed }) => [
                                styles.endpointButton,
                                stackLabels && styles.stackedEndpointButton,
                                pressed && styles.pressed,
                            ]}
                        >
                            <View pointerEvents="none" style={styles.markerCell}>
                                <View style={[styles.dot, { borderColor: color }]} />
                            </View>
                            {stackLabels ? (
                                <>
                                    <View style={styles.stackedEndpointContent}>
                                        <Text style={[styles.stackedEndpointLabel, { color: colors.textSecondary }]}>{label}</Text>
                                        <Text lineBreakStrategyIOS="hangul-word" style={[styles.stackedEndpointName, { color: colors.textPrimary }]}>{name}</Text>
                                    </View>
                                    <Ionicons name="pencil-outline" size={18} color={colors.textSecondary} />
                                </>
                            ) : (
                                <>
                                    <Text style={[styles.endpointLabel, { color: colors.textSecondary }]}>{label}</Text>
                                    <Text numberOfLines={1} style={[styles.endpointText, { color: colors.textPrimary }]}>{name}</Text>
                                    <Text style={[styles.editText, { color: colors.textSecondary }]}>변경</Text>
                                </>
                            )}
                        </Pressable>
                    </React.Fragment>
                ))}
            </View>
            {stackLabels ? (
                <View style={[styles.stackedFooter, { borderTopColor: colors.border }]}>
                    {swapButton}
                    {footerAction}
                </View>
            ) : swapButton}
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
    stackedCard: {
        flexDirection: "column",
        paddingRight: 14,
    },
    stackedFooter: {
        alignSelf: "stretch",
        borderTopWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        justifyContent: "flex-end",
        alignItems: "center",
        flexWrap: "wrap",
        paddingTop: 8,
        gap: 8,
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
    stackedEndpointButton: {
        paddingVertical: 10,
        gap: 8,
    },
    stackedEndpointContent: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    stackedEndpointLabel: {
        fontSize: 10,
        fontWeight: "700",
    },
    stackedEndpointName: {
        fontSize: 14,
        fontWeight: "800",
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
    stackedSwapButton: {
        width: 44,
        height: 44,
    },
    pressed: {
        opacity: 0.72,
    },
});
