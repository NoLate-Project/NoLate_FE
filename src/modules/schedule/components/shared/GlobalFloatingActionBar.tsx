import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import CalendarGlassSurface, { liquidGlassTokens } from "../calendar/CalendarGlassSurface";
import LiquidGlassIconButton, { isLiquidGlassIconButtonAvailable } from "../calendar/LiquidGlassIconButton";
import { useTheme } from "../../../theme/ThemeContext";

export type FloatingBarAction = {
    key: string;
    label?: string;
    icon?: React.ComponentProps<typeof Ionicons>["name"];
    nativeSymbolName?: string;
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

    const renderSide = (actions: FloatingBarAction[]) => {
        if (actions.length === 0) return null;

        const singleIconOnly = actions.length === 1 && Boolean(actions[0].icon);

        if (isLiquidGlassIconButtonAvailable && actions.length === 1) {
            const action = actions[0];
            const nativeSymbolName = action.nativeSymbolName ?? getNativeSymbolName(action.icon);
            const buttonWidth = action.icon ? 116 : 96;

            return (
                <LiquidGlassIconButton
                    symbolName={nativeSymbolName}
                    label={!action.icon ? action.label : undefined}
                    buttonWidth={buttonWidth}
                    buttonHeight={58}
                    disabled={action.disabled}
                    colorScheme={mode}
                    accessibilityLabel={action.accessibilityLabel}
                    onPress={action.onPress}
                    style={[
                        styles.nativeActionButton,
                        { width: buttonWidth },
                    ]}
                />
            );
        }

        return (
            <CalendarGlassSurface
                interactive
                clear
                glow
                variant="bottomBar"
                tone="softGlass"
                style={[
                    styles.actionSurface,
                    singleIconOnly && styles.singleIconActionSurface,
                    {
                        borderColor: colors.border,
                    },
                ]}
            >
                <View style={[
                    styles.actionGroup,
                    singleIconOnly && styles.singleIconActionGroup,
                ]}>
                    {actions.map((action) => (
                        <ActionButton
                            key={action.key}
                            action={action}
                            colors={colors}
                            mode={mode}
                            wide={singleIconOnly}
                        />
                    ))}
                </View>
            </CalendarGlassSurface>
        );
    };

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
                {renderSide(leftActions)}
            </View>

            <View style={[styles.side, styles.rightSide]}>
                {renderSide(rightActions)}
            </View>
        </Animated.View>
    );
}

function getNativeSymbolName(icon?: React.ComponentProps<typeof Ionicons>["name"]) {
    switch (icon) {
        case "person-circle-outline":
            return "person.circle";
        case "search":
            return "magnifyingglass";
        case "add":
            return "plus";
        default:
            return "circle";
    }
}

function ActionButton({
    action,
    colors,
    mode,
    wide,
}: {
    action: FloatingBarAction;
    colors: ReturnType<typeof useTheme>["colors"];
    mode: ReturnType<typeof useTheme>["mode"];
    wide?: boolean;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel}
            disabled={action.disabled}
            onPress={action.onPress}
            style={({ pressed }) => [
                styles.action,
                wide && styles.wideIconAction,
                !action.icon && !!action.label && styles.labelAction,
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
        height: 58,
        borderRadius: 29,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: "hidden",
    },
    singleIconActionSurface: {
        width: 116,
    },
    nativeActionButton: {
        height: 58,
    },
    actionGroup: {
        height: 58,
        flexDirection: "row",
        alignItems: "center",
    },
    singleIconActionGroup: {
        width: "100%",
        justifyContent: "center",
    },
    action: {
        minWidth: 58,
        height: 58,
        paddingHorizontal: 0,
        borderRadius: 29,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
    },
    wideIconAction: {
        width: "100%",
    },
    labelAction: {
        paddingHorizontal: 18,
    },
    emphasizedAction: {
        borderWidth: StyleSheet.hairlineWidth,
        shadowColor: "#FFFFFF",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.20,
        shadowRadius: 14,
    },
    actionText: {
        fontSize: 17,
        fontWeight: "800",
        letterSpacing: 0,
    },
});
