import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "../../../theme/ThemeContext";

export default function CategoryLoadErrorBanner({
    onRetry,
    retrying = false,
    compact = false,
}: {
    onRetry: () => void;
    retrying?: boolean;
    compact?: boolean;
}) {
    const { colors, mode } = useTheme();
    const errorColor = mode === "dark" ? "#FF9F92" : "#C9342B";

    return (
        <View
            style={[
                styles.container,
                compact && styles.compactContainer,
                mode === "dark" ? styles.containerDark : styles.containerLight,
            ]}
        >
            <Ionicons accessible={false} name="alert-circle-outline" size={19} color={errorColor} />
            <Text
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                style={[styles.message, { color: colors.textPrimary }]}
            >
                카테고리를 불러오지 못했어요.
            </Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="카테고리 다시 불러오기"
                accessibilityState={{ disabled: retrying, busy: retrying }}
                disabled={retrying}
                onPress={onRetry}
                hitSlop={8}
                style={({ pressed }) => [
                    styles.retryButton,
                    { opacity: pressed || retrying ? 0.55 : 1 },
                ]}
            >
                {retrying ? (
                    <ActivityIndicator size="small" color={errorColor} />
                ) : (
                    <Text style={[styles.retryText, { color: errorColor }]}>다시 시도</Text>
                )}
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        minHeight: 50,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 14,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
    compactContainer: {
        minHeight: 44,
        borderRadius: 13,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    containerDark: {
        backgroundColor: "rgba(255,69,58,0.12)",
        borderColor: "rgba(255,159,146,0.26)",
    },
    containerLight: {
        backgroundColor: "rgba(255,59,48,0.08)",
        borderColor: "rgba(201,52,43,0.18)",
    },
    message: {
        flex: 1,
        fontSize: 14,
        fontWeight: "600",
    },
    retryButton: {
        minWidth: 60,
        minHeight: 32,
        alignItems: "center",
        justifyContent: "center",
    },
    retryText: {
        fontSize: 14,
        fontWeight: "800",
    },
});
