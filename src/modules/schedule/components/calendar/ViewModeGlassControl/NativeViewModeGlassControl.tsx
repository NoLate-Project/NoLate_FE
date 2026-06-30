import {
    requireNativeComponent,
    type HostComponent,
    type NativeSyntheticEvent,
    type ViewProps,
} from "react-native";

import type { CalendarViewMode } from "../viewMode";
import type {
    ViewModeGlassControlColorScheme,
    ViewModeGlassControlOpenChangeEvent,
    ViewModeGlassControlSelectEvent,
} from "./types";

export type NativeViewModeGlassControlProps = ViewProps & {
    selectedMode?: CalendarViewMode;
    disabled?: boolean;
    colorScheme?: ViewModeGlassControlColorScheme;
    onSelect?: (event: NativeSyntheticEvent<ViewModeGlassControlSelectEvent>) => void;
    onOpenChange?: (
        event: NativeSyntheticEvent<ViewModeGlassControlOpenChangeEvent>
    ) => void;
};

const NativeViewModeGlassControl = (() => {
    try {
        return requireNativeComponent<NativeViewModeGlassControlProps>(
            "ViewModeGlassControl",
        );
    } catch {
        return null;
    }
})() as HostComponent<NativeViewModeGlassControlProps> | null;

export default NativeViewModeGlassControl;
