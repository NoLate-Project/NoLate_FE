import React, {
    forwardRef,
    useCallback,
    useImperativeHandle,
    useRef,
} from "react";
import {
    Platform,
    Pressable,
    requireNativeComponent,
    StyleSheet,
    View,
    type HostComponent,
    type NativeMethods,
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

export type LiquidGlassIconButtonHandle = {
    setDisplayContent: (content: {
        label: string;
        buttonWidth: number;
    }) => void;
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

const LiquidGlassIconButton = forwardRef<
    LiquidGlassIconButtonHandle,
    LiquidGlassIconButtonProps
>(function LiquidGlassIconButton({
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
}, ref) {
    const nativeButtonRef = useRef<
        (React.Component<NativeLiquidGlassIconButtonProps> & NativeMethods) | null
    >(null);
    const handlePress = useCallback(() => {
        if (!disabled) {
            onPress?.();
        }
    }, [disabled, onPress]);

    useImperativeHandle(ref, () => ({
        setDisplayContent: ({ label: nextLabel, buttonWidth: nextButtonWidth }) => {
            nativeButtonRef.current?.setNativeProps({
                label: nextLabel,
                buttonWidth: nextButtonWidth,
            });
        },
    }), []);

    if (!NativeLiquidGlassIconButton) {
        return null;
    }

    const NativeButton = NativeLiquidGlassIconButton;
    const interactive = !disabled && Boolean(onPress) && pointerEvents !== "none";

    return (
        <View pointerEvents={pointerEvents ?? "box-none"} style={style}>
            <NativeButton
                ref={nativeButtonRef}
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
});

export default LiquidGlassIconButton;

const styles = StyleSheet.create({
    hitTarget: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 2,
    },
});
