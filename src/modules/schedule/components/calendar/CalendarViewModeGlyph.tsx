import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import type { CalendarViewMode } from "./viewMode";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

type Props = {
    mode: CalendarViewMode;
    color: string;
    size?: number;
    toolbar?: boolean;
};

const FALLBACK_ICON_BY_MODE: Record<CalendarViewMode, IconName> = {
    stack: "calendar-clear-outline",
    detail: "reader-outline",
    week: "calendar-outline",
    list: "list-outline",
};

export default function CalendarViewModeGlyph({
    mode,
    color,
    size = 26,
    toolbar = false,
}: Props) {
    const unit = size / 28;
    const lineWidth = Math.max(2, 2.2 * unit);
    const roundedLine = {
        borderColor: color,
        borderWidth: lineWidth,
        borderRadius: 999,
    };

    if (toolbar) {
        return <Ionicons accessible={false} name="albums-outline" size={size} color={color} />;
    }

    if (mode === "stack") {
        return <Ionicons accessible={false} name="calendar-clear-outline" size={size} color={color} />;
    }

    if (mode === "detail") {
        return (
            <View
                pointerEvents="none"
                style={[styles.container, { width: size, height: size }]}
            >
                <View style={[styles.detailBar, roundedLine, { width: 22 * unit, height: 8 * unit }]} />
                <View style={[styles.detailBar, roundedLine, { width: 22 * unit, height: 8 * unit }]}>
                    <View style={[styles.detailInnerLine, { backgroundColor: color, width: 10 * unit }]} />
                </View>
            </View>
        );
    }

    if (mode === "list") {
        return (
            <View
                pointerEvents="none"
                style={[styles.container, { width: size, height: size }]}
            >
                <View style={styles.listRow}>
                    <View style={[styles.listBullet, { backgroundColor: color }]} />
                    <View style={[styles.listLine, { backgroundColor: color, width: 19 * unit }]} />
                </View>
                <View style={styles.listRow}>
                    <View style={[styles.listBullet, { backgroundColor: color }]} />
                    <View style={[styles.listLine, { backgroundColor: color, width: 19 * unit }]} />
                </View>
                <View style={[styles.listBase, roundedLine, { width: 18 * unit, height: 7 * unit }]} />
            </View>
        );
    }

    return <Ionicons accessible={false} name={FALLBACK_ICON_BY_MODE[mode]} size={size} color={color} />;
}

const styles = StyleSheet.create({
    container: {
        alignItems: "center",
        justifyContent: "center",
    },
    detailBar: {
        alignItems: "center",
        justifyContent: "center",
        marginVertical: 2,
    },
    detailInnerLine: {
        height: 2,
        borderRadius: 2,
    },
    listRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        marginVertical: 1.4,
    },
    listBullet: {
        width: 3,
        height: 3,
        borderRadius: 1.5,
    },
    listLine: {
        height: 2.2,
        borderRadius: 2,
    },
    listBase: {
        marginTop: 3,
    },
});
