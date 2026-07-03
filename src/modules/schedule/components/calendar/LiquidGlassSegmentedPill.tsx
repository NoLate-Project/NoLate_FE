import React, { useCallback } from "react";
import {
    Platform,
    requireNativeComponent,
    type HostComponent,
    type NativeSyntheticEvent,
    type ViewProps,
} from "react-native";

import type { ViewModeGlassControlColorScheme } from "./ViewModeGlassControl/types";

type SelectEvent = {
    index?: number;
};

type NativeProps = ViewProps & {
    symbolNames?: string[];
    selectedIndex?: number;
    buttonHeight?: number;
    slotWidth?: number;
    disabled?: boolean;
    colorScheme?: ViewModeGlassControlColorScheme;
    onSelect?: (event: NativeSyntheticEvent<SelectEvent>) => void;
};

type Props = ViewProps & {
    symbolNames: string[];
    selectedIndex?: number;
    buttonHeight?: number;
    slotWidth?: number;
    disabled?: boolean;
    colorScheme?: ViewModeGlassControlColorScheme;
    onSelect?: (index: number) => void;
};

const NativeLiquidGlassSegmentedPill = (() => {
    try {
        return requireNativeComponent<NativeProps>("LiquidGlassSegmentedPill");
    } catch {
        return null;
    }
})() as HostComponent<NativeProps> | null;

export const isLiquidGlassSegmentedPillAvailable =
    Platform.OS === "ios" && Boolean(NativeLiquidGlassSegmentedPill);

export default function LiquidGlassSegmentedPill({
    symbolNames,
    selectedIndex = -1,
    buttonHeight = 44,
    slotWidth = 44,
    disabled = false,
    colorScheme = "dark",
    onSelect,
    style,
}: Props) {
    const handleSelect = useCallback((event: NativeSyntheticEvent<SelectEvent>) => {
        const index = event.nativeEvent.index;
        if (typeof index === "number") {
            onSelect?.(index);
        }
    }, [onSelect]);

    if (!NativeLiquidGlassSegmentedPill) return null;

    const width = Math.max(slotWidth, slotWidth * symbolNames.length);

    return (
        <NativeLiquidGlassSegmentedPill
            symbolNames={symbolNames}
            selectedIndex={selectedIndex}
            buttonHeight={buttonHeight}
            slotWidth={slotWidth}
            disabled={disabled}
            colorScheme={colorScheme}
            onSelect={handleSelect}
            style={[{ width, height: buttonHeight }, style]}
        />
    );
}
