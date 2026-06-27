import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import CalendarGlassSurface, { liquidGlassTokens } from "../calendar/CalendarGlassSurface";
import { useTheme } from "../../../theme/ThemeContext";

export type FloatingBarAction = {
    key: string;
    label?: string;
    icon?: React.ComponentProps<typeof Ionicons>["name"];
    accessibilityLabel: string;
    onPress: () => void;
    disabled?: boolean;
    emphasized?: boolean;
};

type Props = {
    leftActions?: FloatingBarAction[];
    rightActions?: FloatingBarAction[];
    bottomInset?: number;
    hidden?: boolean;
    style?: ViewStyle;
};

export default function GlobalFloatingActionBar({
    leftActions = [],
    rightActions = [],
    bottomInset = 0,
    hidden = false,
    style,
}: Props) {
    const { colors, mode } = useTheme();
    const progress = useRef(new Animated.Value(hidden ? 0 : 1)).current;
    const actionSignature = useMemo(
        () => [...leftActions, ...rightActions].map((action) => action.key).join("|"),
        [leftActions, rightActions]
    );

    useEffect(() => {
        progress.stopAnimation();
        if (hidden) {
            Animated.timing(progress, {
                toValue: 0,
                duration: 160,
                useNativeDriver: true,
            }).start();
            return;
        }

        progress.setValue(0.82);
        Animated.spring(progress, {
            toValue: 1,
            damping: liquidGlassTokens.spring.damping,
            stiffness: liquidGlassTokens.spring.stiffness,
            mass: liquidGlassTokens.spring.mass,
            useNativeDriver: true,
        }).start();
    }, [actionSignature, hidden, progress]);

    const translateY = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [18, 0],
    });
    const scale = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.96, 1],
    });

    const renderAction = (action: FloatingBarAction) => (
        <CalendarGlassSurface
            key={action.key}
            interactive
            clear
            glow
            variant="bottomBar"
            tone="softGlass"
            style={[
                styles.actionSurface,
                {
                    borderColor: colors.border,
                },
            ]}
        >
            <ActionButton
                action={action}
                colors={colors}
                mode={mode}
            />
        </CalendarGlassSurface>
    );

    return (
        <Animated.View
            pointerEvents={hidden ? "none" : "box-none"}
            style={[
                styles.host,
                {
                    bottom: Math.max(bottomInset, 10) + 8,
                    opacity: progress,
                    transform: [{ translateY }, { scale }],
                },
                style,
            ]}
        >
            <View style={styles.side}>
                {leftActions.map(renderAction)}
            </View>

            <View style={[styles.side, styles.rightSide]}>
                {rightActions.map(renderAction)}
            </View>
        </Animated.View>
    );
}

function ActionButton({
    action,
    colors,
    mode,
}: {
    action: FloatingBarAction;
    colors: ReturnType<typeof useTheme>["colors"];
    mode: ReturnType<typeof useTheme>["mode"];
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel}
            disabled={action.disabled}
            onPress={action.onPress}
            style={({ pressed }) => [
                styles.action,
                action.emphasized && styles.emphasizedAction,
                action.emphasized && {
                    backgroundColor: mode === "dark"
                        ? "rgba(255,255,255,0.16)"
                        : "rgba(255,255,255,0.62)",
                    borderColor: mode === "dark"
                        ? "rgba(255,255,255,0.28)"
                        : "rgba(255,255,255,0.78)",
                },
                !action.emphasized && pressed && {
                    backgroundColor: mode === "dark"
                        ? "rgba(255,255,255,0.10)"
                        : "rgba(0,0,0,0.07)",
                },
                {
                    opacity: action.disabled ? 0.38 : pressed ? 0.74 : 1,
                    transform: [{ scale: pressed ? liquidGlassTokens.pressedScale : 1 }],
                },
            ]}
        >
            {!!action.icon && (
                <Ionicons
                    name={action.icon}
                    size={24}
                    color={colors.textPrimary}
                />
            )}
            {!action.icon && !!action.label && (
                <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.82}
                    style={[
                        styles.actionText,
                        {
                            color: action.emphasized ? colors.textPrimary : colors.textPrimary,
                        },
                    ]}
                >
                    {action.label}
                </Text>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    host: {
        position: "absolute",
        left: 16,
        right: 16,
        zIndex: 60,
        elevation: 60,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    side: {
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    rightSide: {
        flexShrink: 1,
        justifyContent: "flex-end",
    },
    actionSurface: {
        width: 58,
        height: 58,
        borderRadius: 29,
        borderWidth: StyleSheet.hairlineWidth,
    },
    action: {
        width: "100%",
        height: "100%",
        borderRadius: 29,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
    },
    emphasizedAction: {
        borderWidth: StyleSheet.hairlineWidth,
        shadowColor: "#FFFFFF",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.20,
        shadowRadius: 14,
    },
    actionText: {
        fontSize: 13,
        fontWeight: "800",
        letterSpacing: 0,
    },
});
