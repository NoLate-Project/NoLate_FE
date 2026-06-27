import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

import type { CalendarViewMode } from "../viewMode";

export const ENABLE_NATIVE_IOS_LIQUID_DROPDOWN = false;

export type ViewModeDropdownProps = {
    visible: boolean;
    selectedMode: CalendarViewMode;
    onSelect: (mode: CalendarViewMode) => void;
    onClose: () => void;
    style?: StyleProp<ViewStyle>;
    fallback?: ReactNode;
};

export type ViewModeDropdownSelectEvent = {
    mode: CalendarViewMode;
};

export type ViewModeDropdownCloseEvent = {
    reason?: "close" | "select";
};
