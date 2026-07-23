import React from "react";
import { View, type ViewProps } from "react-native";

import { getScheduleAccessibilityVisibility } from "../accessibilityVisibility";

type Props = ViewProps & {
    focused: boolean;
};

/**
 * Expo Router keeps the previous route mounted while a child route is pushed.
 * Hide that retained calendar tree from VoiceOver/TalkBack until it becomes the
 * focused route again.
 */
export default function ScheduleRouteFocusBoundary({
    focused,
    ...viewProps
}: Props) {
    return (
        <View
            {...viewProps}
            {...getScheduleAccessibilityVisibility(focused)}
        />
    );
}
