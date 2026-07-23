import React, { useCallback } from "react";
import {
    Platform,
    requireNativeComponent,
    StyleSheet,
    View,
    type HostComponent,
    type NativeSyntheticEvent,
    type ViewProps,
} from "react-native";

import { CALENDAR_VIEW_OPTIONS, type CalendarViewMode } from "./viewMode";
import type {
    ViewModeGlassControlColorScheme,
    ViewModeGlassControlOpenChangeEvent,
    ViewModeGlassControlSelectEvent,
} from "./ViewModeGlassControl/types";

export type LiquidCalendarMenuSelectionMode = CalendarViewMode | "day" | "multi";
export type LiquidCalendarMenuVariant = "calendar" | "timeline";

export type LiquidCalendarMenuPrototypeProps = ViewProps & {
    selectedMode?: LiquidCalendarMenuSelectionMode;
    viewModeVariant?: LiquidCalendarMenuVariant;
    showsViewModeButton?: boolean;
    disabled?: boolean;
    colorScheme?: ViewModeGlassControlColorScheme;
    tapRequest?: number;
    closeRequest?: number;
    addMenuRequest?: number;
    searchRequest?: number;
    quickAddRequest?: number;
    manualAddRequest?: number;
    searchExpandedWidth?: number;
    searchQuery?: string;
    onSelect?: (mode: LiquidCalendarMenuSelectionMode) => void;
    onOpenChange?: (open: boolean) => void;
    onSearch?: () => void;
    onSearchTextChange?: (text: string) => void;
    onSearchClose?: () => void;
    onAdd?: () => void;
    onQuickAdd?: () => void;
    onManualAdd?: () => void;
    onManageCategories?: () => void;
};

type NativeLiquidCalendarMenuPrototypeProps = ViewProps & {
    selectedMode?: string;
    viewModeVariant?: LiquidCalendarMenuVariant;
    showsViewModeButton?: boolean;
    disabled?: boolean;
    colorScheme?: ViewModeGlassControlColorScheme;
    tapRequest?: number;
    closeRequest?: number;
    addMenuRequest?: number;
    searchRequest?: number;
    quickAddRequest?: number;
    manualAddRequest?: number;
    searchExpandedWidth?: number;
    searchQuery?: string;
    onSelect?: (
        event: NativeSyntheticEvent<ViewModeGlassControlSelectEvent>
    ) => void;
    onOpenChange?: (
        event: NativeSyntheticEvent<ViewModeGlassControlOpenChangeEvent>
    ) => void;
    onSearch?: (event: NativeSyntheticEvent<Record<string, never>>) => void;
    onSearchTextChange?: (event: NativeSyntheticEvent<{ text?: string }>) => void;
    onSearchClose?: (event: NativeSyntheticEvent<Record<string, never>>) => void;
    onAdd?: (event: NativeSyntheticEvent<Record<string, never>>) => void;
    onQuickAdd?: (event: NativeSyntheticEvent<Record<string, never>>) => void;
    onManualAdd?: (event: NativeSyntheticEvent<Record<string, never>>) => void;
    onManageCategories?: (event: NativeSyntheticEvent<Record<string, never>>) => void;
};

const KNOWN_VIEW_MODES = new Set<CalendarViewMode>(
    CALENDAR_VIEW_OPTIONS.map((option) => option.value),
);
const KNOWN_SELECTION_MODES = new Set<LiquidCalendarMenuSelectionMode>([
    ...CALENDAR_VIEW_OPTIONS.map((option) => option.value),
    "day",
    "multi",
]);

const NativeLiquidCalendarMenuPrototype = (() => {
    try {
        return requireNativeComponent<NativeLiquidCalendarMenuPrototypeProps>(
            "LiquidCalendarMenuPrototype",
        );
    } catch {
        return null;
    }
})() as HostComponent<NativeLiquidCalendarMenuPrototypeProps> | null;

export const isLiquidCalendarMenuPrototypeAvailable =
    Platform.OS === "ios" && Boolean(NativeLiquidCalendarMenuPrototype);

export function isCalendarViewMode(mode: string): mode is CalendarViewMode {
    return KNOWN_VIEW_MODES.has(mode as CalendarViewMode);
}

function isKnownSelectionMode(mode: string): mode is LiquidCalendarMenuSelectionMode {
    return KNOWN_SELECTION_MODES.has(mode as LiquidCalendarMenuSelectionMode);
}

export default function LiquidCalendarMenuPrototype({
    selectedMode,
    viewModeVariant = "calendar",
    showsViewModeButton = true,
    disabled = false,
    colorScheme = "dark",
    tapRequest,
    closeRequest,
    addMenuRequest,
    searchRequest,
    quickAddRequest,
    manualAddRequest,
    searchExpandedWidth,
    searchQuery,
    onSelect,
    onOpenChange,
    onSearch,
    onSearchTextChange,
    onSearchClose,
    onAdd,
    onQuickAdd,
    onManualAdd,
    onManageCategories,
    style,
}: LiquidCalendarMenuPrototypeProps) {
    const handleSelect = useCallback(
        (event: NativeSyntheticEvent<ViewModeGlassControlSelectEvent>) => {
            const { mode } = event.nativeEvent;
            if (isKnownSelectionMode(mode)) {
                onSelect?.(mode);
            }
        },
        [onSelect],
    );

    const handleOpenChange = useCallback(
        (event: NativeSyntheticEvent<ViewModeGlassControlOpenChangeEvent>) => {
            const open = Boolean(event.nativeEvent.open);
            onOpenChange?.(open);
        },
        [onOpenChange],
    );

    const handleSearch = useCallback(() => {
        if (!disabled) {
            onSearch?.();
        }
    }, [disabled, onSearch]);

    const handleSearchTextChange = useCallback((
        event: NativeSyntheticEvent<{ text?: string }>
    ) => {
        onSearchTextChange?.(event.nativeEvent.text ?? "");
    }, [onSearchTextChange]);

    const handleSearchClose = useCallback(() => {
        if (!disabled) {
            onSearchClose?.();
        }
    }, [disabled, onSearchClose]);

    const handleAdd = useCallback(() => {
        if (!disabled) {
            onAdd?.();
        }
    }, [disabled, onAdd]);

    const handleQuickAdd = useCallback(() => {
        if (!disabled) {
            onQuickAdd?.();
        }
    }, [disabled, onQuickAdd]);

    const handleManualAdd = useCallback(() => {
        if (!disabled) {
            onManualAdd?.();
        }
    }, [disabled, onManualAdd]);

    const handleManageCategories = useCallback(() => {
        if (!disabled) {
            onManageCategories?.();
        }
    }, [disabled, onManageCategories]);

    if (!NativeLiquidCalendarMenuPrototype) {
        return null;
    }

    const NativePrototype = NativeLiquidCalendarMenuPrototype;

    return (
        <View pointerEvents="box-none" style={style}>
            <NativePrototype
                selectedMode={selectedMode}
                viewModeVariant={viewModeVariant}
                showsViewModeButton={showsViewModeButton}
                disabled={disabled}
                colorScheme={colorScheme}
                tapRequest={tapRequest}
                closeRequest={closeRequest}
                addMenuRequest={addMenuRequest}
                searchRequest={searchRequest}
                quickAddRequest={quickAddRequest}
                manualAddRequest={manualAddRequest}
                searchExpandedWidth={searchExpandedWidth}
                searchQuery={searchQuery}
                onSelect={handleSelect}
                onOpenChange={handleOpenChange}
                onSearch={handleSearch}
                onSearchTextChange={handleSearchTextChange}
                onSearchClose={handleSearchClose}
                onAdd={handleAdd}
                onQuickAdd={handleQuickAdd}
                onManualAdd={handleManualAdd}
                onManageCategories={handleManageCategories}
                style={StyleSheet.absoluteFill}
            />
        </View>
    );
}
