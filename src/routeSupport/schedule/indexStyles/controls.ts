import { StyleSheet, Platform } from "react-native";

import type { ScheduleIndexStylesOptions } from "../index.styles";

/** controls 영역의 정적 스타일을 생성합니다. */
export function createControlsStyles(options: ScheduleIndexStylesOptions) {
    void options;
    return StyleSheet.create({
        yearOverviewLayer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 30,
        elevation: 30,
        overflow: "hidden",
    },
        bottomControls: {
        position: "absolute",
        left: 18,
        right: 18,
        zIndex: 20,
        elevation: 20,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
        todayGlass: {
        minWidth: 74,
        height: 44,
        borderRadius: 22,
        borderWidth: Platform.OS === "ios" ? 0 : 1,
    },
        todayButton: {
        flex: 1,
        paddingHorizontal: 18,
        alignItems: "center",
        justifyContent: "center",
    },
        todayText: {
        fontSize: 15,
        fontWeight: "800",
    },
        settingsGlass: {
        width: 48,
        height: 48,
        borderRadius: 24,
        borderWidth: Platform.OS === "ios" ? 0 : 1,
    },
        settingsButton: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    });
}
