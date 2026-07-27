import React, { useCallback } from "react";
import {
    Platform,
    Pressable,
    requireNativeComponent,
    StyleSheet,
    View,
    type HostComponent,
    type NativeSyntheticEvent,
    type ViewProps,
} from "react-native";

import type { ViewModeGlassControlColorScheme } from "./ViewModeGlassControl/types";

type LiquidGlassIconButtonPressEvent = Record<string, never>;

type NativeLiquidGlassIconButtonProps = ViewProps & {
    symbolName?: string;
    label?: string;
    leadingSymbolName?: string;
    trailingSymbolName?: string;
    buttonWidth?: number;
    buttonHeight?: number;
    disabled?: boolean;
    colorScheme?: ViewModeGlassControlColorScheme;
    animatesContentChanges?: boolean;
    onPress?: (event: NativeSyntheticEvent<LiquidGlassIconButtonPressEvent>) => void;
};

export type LiquidGlassIconButtonProps = ViewProps & {
    symbolName?: string;
    label?: string;
    leadingSymbolName?: string;
    trailingSymbolName?: string;
    buttonWidth?: number;
    buttonHeight?: number;
    disabled?: boolean;
    colorScheme?: ViewModeGlassControlColorScheme;
    animatesContentChanges?: boolean;
    accessibilityLabel?: string;
    onPress?: () => void;
};

const NativeLiquidGlassIconButton = (() => {
    try {
        return requireNativeComponent<NativeLiquidGlassIconButtonProps>(
            "LiquidGlassIconButton",
        );
    } catch {
        return null;
    }
})() as HostComponent<NativeLiquidGlassIconButtonProps> | null;

export const isLiquidGlassIconButtonAvailable =
    Platform.OS === "ios" && Boolean(NativeLiquidGlassIconButton);

export default function LiquidGlassIconButton({
    symbolName = "magnifyingglass",
    label,
    leadingSymbolName,
    trailingSymbolName,
    buttonWidth = 58,
    buttonHeight = 58,
    disabled = false,
    colorScheme = "dark",
    animatesContentChanges = true,
    accessibilityLabel,
    onPress,
    style,
    pointerEvents,
}: LiquidGlassIconButtonProps) {
    const handlePress = useCallback(() => {
        if (!disabled) {
            onPress?.();
        }
    }, [disabled, onPress]);

    if (!NativeLiquidGlassIconButton) {
        return null;
    }

    const NativeButton = NativeLiquidGlassIconButton;
    const interactive = !disabled && Boolean(onPress) && pointerEvents !== "none";

    return (
        <View pointerEvents={pointerEvents ?? "box-none"} style={style}>
            <NativeButton
                symbolName={symbolName}
                label={label}
                leadingSymbolName={leadingSymbolName}
                trailingSymbolName={trailingSymbolName}
                buttonWidth={buttonWidth}
                buttonHeight={buttonHeight}
                disabled={disabled}
                colorScheme={colorScheme}
                animatesContentChanges={animatesContentChanges}
                onPress={handlePress}
                pointerEvents="none"
                style={StyleSheet.absoluteFill}
            />

            {interactive && (
                <Pressable
                    accessibilityLabel={
                        accessibilityLabel ??
                        label ??
                        (symbolName === "plus" ? "일정 추가" : "일정 검색")
                    }
                    accessibilityRole="button"
                    onPress={handlePress}
                    style={styles.hitTarget}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    hitTarget: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 2,
    },
});
