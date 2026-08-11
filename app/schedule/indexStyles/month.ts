import { StyleSheet } from "react-native";

import type { ScheduleIndexStylesOptions } from "../index.styles";

/** month 영역의 정적 스타일을 생성합니다. */
export function createMonthStyles(options: ScheduleIndexStylesOptions) {
    void options;
    return StyleSheet.create({
        monthCalendarFrame: {
        minHeight: 0,
        alignSelf: "stretch",
        position: "relative",
        overflow: "hidden",
    },
        monthCalendarIncomingLayer: {
        minHeight: 0,
        alignSelf: "stretch",
        transformOrigin: "top",
    },
        monthCalendarLayerContentFull: {
        flex: 1,
        minHeight: 0,
        alignSelf: "stretch",
    },
        monthCalendarLayerContentCompact: {
        minHeight: 0,
        flexShrink: 0,
        alignSelf: "stretch",
    },
        monthAgendaSlot: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        minHeight: 0,
        alignSelf: "stretch",
        overflow: "visible",
        zIndex: 2,
        elevation: 2,
    },
        monthAgendaMotion: {
        flex: 1,
        minHeight: 0,
    },
        monthAgendaCurrentLayer: {
        flex: 1,
        minHeight: 0,
        zIndex: 2,
    },
        monthAgendaSwapLayer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1,
    },
        calendarContent: {
        flex: 1,
        zIndex: 10,
        elevation: 10,
        overflow: "hidden",
    },
        displayStack: {
        flex: 1,
        overflow: "hidden",
    },
        monthDisplayLayer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1,
        elevation: 1,
        overflow: "hidden",
    },
        dayDisplayLayer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 2,
        elevation: 2,
        overflow: "hidden",
    },
    });
}
