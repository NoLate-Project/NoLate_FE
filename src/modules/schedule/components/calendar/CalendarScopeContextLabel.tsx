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
    searchResultCount?: number;
    style?: StyleProp<ViewStyle>;
};

/** 현재 일정에 적용된 캘린더 범위를 하단 전환 버튼과 분리해 보여 준다. */
export default function CalendarScopeContextLabel({ title, color, searchResultCount, style }: Props) {
    const { colors } = useTheme();

    return (
        <View
            testID="calendar-scope-context"
            pointerEvents="none"
            style={[styles.root, searchResultCount !== undefined && styles.rootWithCount, style]}
        >
            <View
                accessible
                accessibilityRole="header"
                accessibilityLabel={`현재 캘린더, ${title}`}
                style={[styles.content, searchResultCount !== undefined && styles.contentWithCount]}
            >
                <Text accessible={false} maxFontSizeMultiplier={1.35} style={[styles.prefix, { color: colors.textSecondary }]}>캘린더</Text>
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
                    maxFontSizeMultiplier={1.35}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[styles.title, { color: colors.textPrimary }]}
                >
                    {title}
                </Text>
            </View>
            {searchResultCount !== undefined && (
                <Text
                    testID="calendar-search-result-count"
                    accessibilityLabel={`검색 결과 ${searchResultCount}개`}
                    maxFontSizeMultiplier={1.35}
                    style={[styles.prefix, { color: colors.textSecondary }]}
                >
                    {`일정 ${searchResultCount}개`}
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        height: 24,
        paddingHorizontal: 20,
        justifyContent: "center",
    },
    rootWithCount: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    content: {
        minWidth: 0,
        maxWidth: "100%",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    contentWithCount: { flexShrink: 1 },
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
