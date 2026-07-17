import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import CalendarGlassSurface, { liquidGlassTokens } from "../calendar/CalendarGlassSurface";
import LiquidGlassIconButton, { isLiquidGlassIconButtonAvailable } from "../calendar/LiquidGlassIconButton";
import { useTheme } from "../../../theme/ThemeContext";

const FLOATING_PILL_HEIGHT = 44;
const FLOATING_ICON_ONLY_WIDTH = 72;
const FLOATING_LABEL_WIDTH = 76;

export type FloatingBarAction = {
    key: string;
    label?: string;
    icon?: React.ComponentProps<typeof Ionicons>["name"];
    nativeSymbolName?: string;
    badgeCount?: number;
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
    disabled?: boolean;
    style?: ViewStyle;
};

export default function GlobalFloatingActionBar({
    leftActions = [],
    rightActions = [],
    bottomInset = 0,
    hidden = false,
    disabled = false,
    style,
}: Props) {
    const { colors, mode } = useTheme();
    const progress = useRef(new Animated.Value(hidden ? 0 : 1)).current;
    const actionSignature = useMemo(
        () => [...leftActions, ...rightActions]
            .map((action) => `${action.key}:${action.badgeCount ?? 0}`)
            .join("|"),
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
            const buttonWidth = action.icon ? FLOATING_ICON_ONLY_WIDTH : FLOATING_LABEL_WIDTH;

            return (
                <View
                    style={[
                        styles.nativeActionHost,
                        { width: buttonWidth },
                    ]}
                >
                    <LiquidGlassIconButton
                        symbolName={nativeSymbolName}
                        label={!action.icon ? action.label : undefined}
                        buttonWidth={buttonWidth}
                        buttonHeight={FLOATING_PILL_HEIGHT}
                        disabled={action.disabled}
                        colorScheme={mode}
                        accessibilityLabel={action.accessibilityLabel}
                        onPress={action.onPress}
                        style={[
                            styles.nativeActionButton,
                            { width: buttonWidth },
                        ]}
                    />
                    <ActionBadge count={action.badgeCount} mode={mode} />
                </View>
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
            pointerEvents={hidden || disabled ? "none" : "box-none"}
            accessibilityElementsHidden={hidden || disabled}
            importantForAccessibility={hidden || disabled ? "no-hide-descendants" : "auto"}
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
        case "mail-unread-outline":
            return "envelope.badge";
        case "mail-outline":
            return "envelope";
        case "search":
            return "magnifyingglass";
        case "add":
            return "plus";
        default:
            return "circle";
    }
}

function formatBadgeCount(count?: number) {
    if (!count || count <= 0) return null;
    return count > 99 ? "99+" : String(count);
}

function ActionBadge({
    count,
    mode,
}: {
    count?: number;
    mode: ReturnType<typeof useTheme>["mode"];
}) {
    const label = formatBadgeCount(count);
    if (!label) return null;

    return (
        <View
            accessible={false}
            pointerEvents="none"
            style={[
                styles.badge,
                {
                    backgroundColor: mode === "dark" ? "#FF453A" : "#FF3B30",
                    borderColor: mode === "dark" ? "#1C1C1E" : "#FFFFFF",
                },
            ]}
        >
            <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
                style={styles.badgeText}
            >
                {label}
            </Text>
        </View>
    );
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
                <View style={styles.iconHost}>
                    <Ionicons
                        accessible={false}
                        name={action.icon}
                        size={24}
                        color={colors.textPrimary}
                    />
                    <ActionBadge count={action.badgeCount} mode={mode} />
                </View>
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
            {!action.icon && <ActionBadge count={action.badgeCount} mode={mode} />}
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
        height: FLOATING_PILL_HEIGHT,
        borderRadius: FLOATING_PILL_HEIGHT / 2,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: "hidden",
    },
    singleIconActionSurface: {
        width: FLOATING_ICON_ONLY_WIDTH,
    },
    nativeActionHost: {
        height: FLOATING_PILL_HEIGHT,
        position: "relative",
    },
    nativeActionButton: {
        height: FLOATING_PILL_HEIGHT,
    },
    actionGroup: {
        height: FLOATING_PILL_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
    },
    singleIconActionGroup: {
        width: "100%",
        justifyContent: "center",
    },
    action: {
        minWidth: FLOATING_PILL_HEIGHT,
        height: FLOATING_PILL_HEIGHT,
        paddingHorizontal: 0,
        borderRadius: FLOATING_PILL_HEIGHT / 2,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        position: "relative",
    },
    wideIconAction: {
        width: "100%",
    },
    labelAction: {
        minWidth: FLOATING_LABEL_WIDTH,
        paddingHorizontal: 16,
    },
    emphasizedAction: {
        borderWidth: StyleSheet.hairlineWidth,
        shadowColor: "#FFFFFF",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.20,
        shadowRadius: 14,
    },
    actionText: {
        fontSize: 15,
        fontWeight: "800",
        letterSpacing: 0,
    },
    iconHost: {
        width: 28,
        height: 28,
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
    },
    badge: {
        position: "absolute",
        top: -3,
        right: 2,
        minWidth: 17,
        height: 17,
        paddingHorizontal: 4,
        borderRadius: 9,
        borderWidth: 1.5,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 4,
    },
    badgeText: {
        color: "#FFFFFF",
        fontSize: 9,
        fontWeight: "900",
        lineHeight: 11,
        letterSpacing: 0,
    },
});
