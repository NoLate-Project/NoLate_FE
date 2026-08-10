import React from "react";
import {
    StyleSheet,
    Text,
    View,
    type StyleProp,
    type ViewStyle,
} from "react-native";

import { useTheme } from "../../../theme/ThemeContext";

type Props = {
    title: string;
    color?: string;
    style?: StyleProp<ViewStyle>;
};

/** 현재 일정에 적용된 캘린더 범위를 하단 전환 버튼과 분리해 보여 준다. */
export default function CalendarScopeContextLabel({ title, color, style }: Props) {
    const { colors } = useTheme();

    return (
        <View
            testID="calendar-scope-context"
            pointerEvents="none"
            style={[styles.root, style]}
        >
            <View
                accessible
                accessibilityRole="header"
                accessibilityLabel={`현재 캘린더, ${title}`}
                style={styles.content}
            >
                <Text accessible={false} style={[styles.prefix, { color: colors.textSecondary }]}>캘린더</Text>
                <View
                    testID="calendar-scope-context-color"
                    accessible={false}
                    style={[
                        styles.colorMarker,
                        { backgroundColor: color ?? colors.textSecondary },
                    ]}
                />
                <Text
                    testID="calendar-scope-context-label"
                    accessible={false}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[styles.title, { color: colors.textPrimary }]}
                >
                    {title}
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        height: 24,
        paddingHorizontal: 20,
        justifyContent: "center",
    },
    content: {
        minWidth: 0,
        maxWidth: "100%",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    prefix: {
        flexShrink: 0,
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: -0.1,
    },
    colorMarker: {
        width: 6,
        height: 6,
        borderRadius: 3,
        flexShrink: 0,
    },
    title: {
        minWidth: 0,
        flexShrink: 1,
        fontSize: 13,
        fontWeight: "700",
        letterSpacing: -0.15,
    },
});
