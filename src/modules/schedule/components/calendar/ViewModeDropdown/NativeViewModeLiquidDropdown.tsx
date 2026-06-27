import {
    requireNativeComponent,
    type HostComponent,
    type NativeSyntheticEvent,
    type ViewProps,
} from "react-native";

import type {
    ViewModeDropdownCloseEvent,
    ViewModeDropdownSelectEvent,
} from "./types";
import type { CalendarViewMode } from "../viewMode";

export type NativeViewModeLiquidDropdownProps = ViewProps & {
    visible?: boolean;
    selectedMode?: CalendarViewMode;
    onSelect?: (event: NativeSyntheticEvent<ViewModeDropdownSelectEvent>) => void;
    onClose?: (event: NativeSyntheticEvent<ViewModeDropdownCloseEvent>) => void;
};

const NativeViewModeLiquidDropdown = (() => {
    try {
        return requireNativeComponent<NativeViewModeLiquidDropdownProps>(
            "ViewModeLiquidDropdown",
        );
    } catch {
        return null;
    }
})() as HostComponent<NativeViewModeLiquidDropdownProps> | null;

export default NativeViewModeLiquidDropdown;
