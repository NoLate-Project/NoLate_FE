import React, { useCallback } from "react";

import { CALENDAR_VIEW_OPTIONS, type CalendarViewMode } from "../viewMode";
import NativeViewModeGlassControl from "./NativeViewModeGlassControl";
import type {
    ViewModeGlassControlOpenChangeEvent,
    ViewModeGlassControlProps,
    ViewModeGlassControlSelectEvent,
} from "./types";

const KNOWN_VIEW_MODES = new Set<CalendarViewMode>(
    CALENDAR_VIEW_OPTIONS.map((option) => option.value),
);

function isCalendarViewMode(mode: string): mode is CalendarViewMode {
    return KNOWN_VIEW_MODES.has(mode as CalendarViewMode);
}

export default function ViewModeGlassControl({
    selectedMode,
    disabled = false,
    colorScheme = "dark",
    onSelect,
    onOpenChange,
    style,
}: ViewModeGlassControlProps) {
    const handleSelect = useCallback(
        (event: { nativeEvent: ViewModeGlassControlSelectEvent }) => {
            const { mode } = event.nativeEvent;
            if (isCalendarViewMode(mode)) {
                onSelect?.(mode);
            }
        },
        [onSelect],
    );

    const handleOpenChange = useCallback(
        (event: { nativeEvent: ViewModeGlassControlOpenChangeEvent }) => {
            onOpenChange?.(Boolean(event.nativeEvent.open));
        },
        [onOpenChange],
    );

    if (!NativeViewModeGlassControl) {
        return null;
    }

    const NativeControl = NativeViewModeGlassControl;

    return (
        <NativeControl
            selectedMode={selectedMode}
            disabled={disabled}
            colorScheme={colorScheme}
            onSelect={handleSelect}
            onOpenChange={handleOpenChange}
            style={style}
        />
    );
}
