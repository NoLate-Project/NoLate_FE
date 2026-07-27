import type { StyleProp, ViewStyle } from "react-native";

import type { CalendarViewMode } from "../viewMode";

export type ViewModeGlassControlColorScheme = "dark" | "light";

export type ViewModeGlassControlProps = {
    selectedMode: CalendarViewMode;
    disabled?: boolean;
    colorScheme?: ViewModeGlassControlColorScheme;
    onSelect?: (mode: CalendarViewMode) => void;
    onOpenChange?: (open: boolean) => void;
    style?: StyleProp<ViewStyle>;
};

export type ViewModeGlassControlSelectEvent = {
    mode: CalendarViewMode;
};

export type ViewModeGlassControlOpenChangeEvent = {
    open: boolean;
    search?: boolean;
    searchGeneration?: number;
    searchSession?: string;
};
