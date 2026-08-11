import { StyleSheet } from "react-native";

import type { ScheduleIndexStylesOptions } from "../index.styles";

/** timeline 영역의 정적 스타일을 생성합니다. */
export function createTimelineStyles(options: ScheduleIndexStylesOptions) {
    const {
        DAY_MINUTES,
        DAY_TIMELINE_END_PADDING,
        DAY_TIMELINE_GUTTER,
        DAY_TIMELINE_HOUR_HEIGHT,
    } = options;
    return StyleSheet.create({
        dayTimelineScroll: {
        flex: 1,
    },
        dayTimelineContent: {
        paddingHorizontal: 0,
        paddingTop: 0,
    },
        floatingBarContentEnd: {
        paddingBottom: 24,
    },
        timelineInlineState: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        elevation: 10,
        height: 34,
        paddingLeft: DAY_TIMELINE_GUTTER + 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        justifyContent: "center",
    },
        timelineInlineStateText: {
        fontSize: 13,
        fontWeight: "700",
        letterSpacing: 0,
    },
        dayTimelineEmptyText: {
        marginTop: 8,
        paddingLeft: 4,
        fontSize: 13,
        fontWeight: "700",
        letterSpacing: 0,
    },
        dayTimelineCanvas: {
        height: DAY_MINUTES / 60 * DAY_TIMELINE_HOUR_HEIGHT + DAY_TIMELINE_END_PADDING,
    },
        multiDayTimelineCanvas: {
        height: DAY_MINUTES / 60 * DAY_TIMELINE_HOUR_HEIGHT + DAY_TIMELINE_END_PADDING,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
        multiDayColumns: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: DAY_TIMELINE_GUTTER + 18,
        right: 0,
        flexDirection: "row",
    },
        multiDayColumn: {
        flex: 1,
        borderLeftWidth: StyleSheet.hairlineWidth,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
        multiDayTimelineEvent: {
        position: "absolute",
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 6,
        paddingVertical: 6,
        overflow: "hidden",
    },
        multiDayNowLine: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 18,
        marginTop: -9,
        justifyContent: "center",
        zIndex: 12,
    },
        multiDayNowTimeGutter: {
        position: "absolute",
        top: 0,
        left: 0,
        width: DAY_TIMELINE_GUTTER + 18,
        height: 18,
        marginTop: -9,
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 12,
    },
        multiDayNowRule: {
        height: 1.5,
        borderRadius: 1,
    },
        multiDayEventTitle: {
        fontSize: 10.5,
        fontWeight: "800",
        letterSpacing: 0,
    },
        dayHourRow: {
        position: "absolute",
        left: DAY_TIMELINE_GUTTER + 18,
        right: 0,
        height: DAY_TIMELINE_HOUR_HEIGHT,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
        dayHourText: {
        position: "absolute",
        top: -9,
        left: -(DAY_TIMELINE_GUTTER + 18),
        width: DAY_TIMELINE_GUTTER + 12,
        fontSize: 12,
        fontWeight: "500",
        textAlign: "right",
        letterSpacing: 0,
    },
        dayEventLayer: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: DAY_TIMELINE_GUTTER + 18,
        right: 12,
    },
        dayNowLine: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 18,
        marginTop: -9,
        flexDirection: "row",
        alignItems: "center",
        zIndex: 12,
    },
        dayNowTimeGutter: {
        width: DAY_TIMELINE_GUTTER + 18,
        height: 18,
        alignItems: "flex-end",
        justifyContent: "center",
    },
        dayNowTimeBadge: {
        minWidth: 42,
        height: 18,
        paddingHorizontal: 6,
        borderRadius: 9,
        alignItems: "center",
        justifyContent: "center",
    },
        dayNowTimeText: {
        color: "#ffffff",
        fontSize: 12,
        lineHeight: 14,
        fontWeight: "700",
        fontVariant: ["tabular-nums"],
        letterSpacing: 0,
    },
        dayNowRule: {
        flex: 1,
        height: 1.5,
        borderRadius: 1,
    },
    });
}
