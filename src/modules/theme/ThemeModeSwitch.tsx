import React from "react";
import { Switch, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "./ThemeContext";

type Props = {
    style?: StyleProp<ViewStyle>;
};

export default function ThemeModeSwitch({ style }: Props) {
    const { colors, mode, toggleMode } = useTheme();

    return (
        <Switch
            accessibilityLabel="다크 모드"
            accessibilityHint="앱의 밝은 테마와 어두운 테마를 전환합니다"
            value={mode === "dark"}
            onValueChange={toggleMode}
            trackColor={{ false: colors.border, true: colors.switchActive }}
            ios_backgroundColor={colors.border}
            thumbColor="#ffffff"
            style={style}
        />
    );
}
