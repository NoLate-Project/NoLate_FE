import React, { useCallback } from "react";
import { Platform } from "react-native";

import NativeViewModeLiquidDropdown from "./NativeViewModeLiquidDropdown";
import {
    ENABLE_NATIVE_IOS_LIQUID_DROPDOWN,
    type ViewModeDropdownProps,
    type ViewModeDropdownSelectEvent,
} from "./types";
import { CALENDAR_VIEW_OPTIONS, type CalendarViewMode } from "../viewMode";

const KNOWN_VIEW_MODES = new Set<CalendarViewMode>(
    CALENDAR_VIEW_OPTIONS.map((option) => option.value),
);

function isIOS26OrNewer() {
    if (Platform.OS !== "ios") return false;

    const version = Platform.Version;
    const majorVersion = typeof version === "string"
        ? Number.parseInt(version.split(".")[0], 10)
        : version;

    return Number.isFinite(majorVersion) && majorVersion >= 26;
}

function isCalendarViewMode(mode: string): mode is CalendarViewMode {
    return KNOWN_VIEW_MODES.has(mode as CalendarViewMode);
}

export default function ViewModeDropdown({
    visible,
    selectedMode,
    onSelect,
    onClose,
    style,
    fallback = null,
}: ViewModeDropdownProps) {
    const handleSelect = useCallback(
        (event: { nativeEvent: ViewModeDropdownSelectEvent }) => {
            const { mode } = event.nativeEvent;
            if (isCalendarViewMode(mode)) {
                onSelect(mode);
            }
        },
        [onSelect],
    );

    if (
        !ENABLE_NATIVE_IOS_LIQUID_DROPDOWN ||
        !isIOS26OrNewer() ||
        !NativeViewModeLiquidDropdown
    ) {
        return <>{fallback}</>;
    }

    const NativeDropdown = NativeViewModeLiquidDropdown;

    return (
        <NativeDropdown
            visible={visible}
            selectedMode={selectedMode}
            onSelect={handleSelect}
            onClose={onClose}
            style={style}
        />
    );
}
