import { StyleSheet } from "react-native";

const COMPACT_RAIL_WIDTH = 56;
const COMPACT_LINE_WIDTH = 5;
const COMPACT_BODY_BOTTOM_PADDING = 6;
const ROW_DIVIDER_TOP_MARGIN = 12;
const ALIGHTING_TIMED_MARKER_HEIGHT = 30;

/** RouteStepTimeline 화면의 정적 시각 규칙입니다. 화면 로직과 독립적으로 조정할 수 있도록 분리했습니다. */
const styles = StyleSheet.create({
    root: {
        gap: 0,
    },
    estimatedClockHeading: {
        fontSize: 12,
        fontWeight: "600",
        marginBottom: 8,
    },
    guidanceCurrentRow: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 8,
        borderLeftWidth: 3,
    },
    item: {
        flexDirection: "row",
        borderWidth: 0,
        borderRadius: 8,
        paddingVertical: 10,
        paddingHorizontal: 0,
    },
    itemCompact: {
        paddingVertical: 1,
    },
    itemCompactFocused: {
        backgroundColor: "transparent",
        borderColor: "transparent",
    },
    legFocusSurface: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 8,
    },
    itemPressTarget: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
    },
    disclosureButton: {
        position: "absolute",
        right: 0,
        minWidth: 44,
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 3,
    },
    disclosureButtonRegular: {
        top: 10,
    },
    disclosureButtonCompact: {
        top: 0,
    },
    disclosureSurface: {
        minHeight: 28,
        minWidth: 28,
        paddingHorizontal: 7,
        paddingVertical: 4,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 3,
    },
    disclosureSurfaceLabelled: {
        minWidth: 60,
    },
    disclosureLabel: {
        fontSize: 11,
        fontWeight: "600",
    },
    rail: {
        width: 42,
        alignItems: "center",
    },
    railCompact: {
        width: COMPACT_RAIL_WIDTH,
    },
    dot: {
        width: 32,
        height: 32,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2,
    },
    dotCompact: {
        width: 32,
        height: 32,
        borderRadius: 999,
        borderWidth: 1.5,
    },
    originGlyphOuter: {
        width: 17,
        height: 17,
        borderRadius: 999,
        borderWidth: 4,
        alignItems: "center",
        justifyContent: "center",
    },
    originGlyphOuterCompact: {
        width: 18,
        height: 18,
        borderWidth: 4,
    },
    originGlyphCore: {
        width: 4,
        height: 4,
        borderRadius: 999,
    },
    originGlyphCoreCompact: {
        width: 4,
        height: 4,
    },
    line: {
        width: 4,
        flex: 1,
        minHeight: 30,
        marginTop: 2,
        borderRadius: 2,
        opacity: 0.92,
    },
    lineCompact: {
        width: COMPACT_LINE_WIDTH,
        minHeight: 46,
        marginTop: 0,
    },
    timelineClockBadge: {
        position: "absolute",
        top: 35,
        minWidth: 48,
        minHeight: 23,
        borderRadius: 5,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 5,
        zIndex: 3,
    },
    timelineClockText: {
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0,
        fontVariant: ["tabular-nums"],
    },
    timelineClockBadgeExpanded: {
        position: "relative",
        top: 0,
        alignSelf: "flex-start",
        marginBottom: 6,
        paddingHorizontal: 9,
        paddingVertical: 3,
    },
    timelineClockBadgeInline: {
        marginBottom: 0,
    },
    boardingHeading: {
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 8,
        marginBottom: 6,
    },
    boardingHeadingWithDisclosure: {
        paddingRight: 92,
    },
    body: {
        flex: 1,
        minWidth: 0,
        paddingTop: 0,
        paddingBottom: 10,
    },
    bodyCompact: {
        paddingTop: 2,
        paddingBottom: COMPACT_BODY_BOTTOM_PADDING,
    },
    titleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    titleRowCompact: {
        gap: 8,
    },
    titleRowExpanded: {
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 4,
    },
    titleRowWithDisclosure: {
        paddingRight: 92,
    },
    badge: {
        minWidth: 32,
        maxWidth: 74,
        minHeight: 22,
        borderRadius: 6,
        paddingHorizontal: 7,
        alignItems: "center",
        justifyContent: "center",
    },
    badgeCompact: {
        minHeight: 25,
        borderRadius: 7,
        paddingHorizontal: 9,
    },
    badgeIntercity: {
        maxWidth: 112,
    },
    badgeExpanded: {
        maxWidth: "100%",
        paddingVertical: 2,
    },
    pointBadge: {
        minWidth: 36,
        minHeight: 22,
        borderRadius: 6,
        paddingHorizontal: 6,
        alignItems: "center",
        justifyContent: "center",
    },
    pointBadgeCompact: {
        minWidth: 42,
        minHeight: 25,
        borderRadius: 7,
    },
    pointBadgeText: {
        color: "#FFFFFF",
        fontSize: 10,
        fontWeight: "900",
        letterSpacing: 0,
    },
    pointBadgeTextCompact: {
        fontSize: 12,
    },
    badgeText: {
        color: "#FFFFFF",
        fontSize: 11,
        fontWeight: "900",
        letterSpacing: 0,
    },
    badgeTextCompact: {
        fontSize: 13,
    },
    title: {
        flex: 1,
        minWidth: 0,
        fontSize: 17,
        fontWeight: "900",
        letterSpacing: 0,
    },
    titleCompact: {
        fontSize: 17,
        fontWeight: "900",
    },
    titleExpanded: {
        flex: 0,
        alignSelf: "stretch",
    },
    titleSuffix: {
        fontSize: 15,
        fontWeight: "900",
    },
    description: {
        marginTop: 6,
        fontSize: 14,
        fontWeight: "800",
    },
    descriptionCompact: {
        marginTop: 4,
        fontSize: 15,
        fontWeight: "800",
    },
    rideInfoRow: {
        marginTop: 4,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
    },
    rideInfoRowExpanded: {
        flexDirection: "column",
        alignItems: "stretch",
        gap: 5,
    },
    rideInfoTextStack: {
        flex: 1,
        minWidth: 0,
    },
    rideInfoTextStackExpanded: {
        flex: 0,
    },
    rideAssistText: {
        marginTop: 3,
        fontSize: 14,
        fontWeight: "800",
        letterSpacing: 0,
    },
    boardingGuideRow: {
        marginTop: 8,
        marginRight: 4,
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
    },
    boardingGuideChip: {
        maxWidth: "100%",
        minHeight: 28,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 7,
        paddingHorizontal: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    boardingGuideText: {
        flexShrink: 1,
        fontSize: 12,
        fontWeight: "800",
    },
    rideActionRow: {
        flexDirection: "row",
        justifyContent: "flex-start",
        alignItems: "center",
        gap: 6,
        paddingTop: 1,
    },
    rideActionStack: {
        alignItems: "flex-end",
        gap: 3,
    },
    rideActionStackExpanded: {
        alignItems: "flex-start",
    },
    rideActionChip: {
        minHeight: 28,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.03)",
    },
    rideActionText: {
        fontSize: 13,
        fontWeight: "900",
        letterSpacing: 0,
    },
    arrivalFreshnessText: {
        fontSize: 11,
        fontWeight: "800",
        letterSpacing: 0,
    },
    arrivalCard: {
        marginTop: 10,
        marginRight: 4,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 8,
        paddingVertical: 10,
        paddingHorizontal: 14,
        backgroundColor: "rgba(255,255,255,0.025)",
        gap: 9,
    },
    trainArrivalRow: {
        minHeight: 24,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    busArrivalRow: {
        minHeight: 30,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    arrivalRowExpanded: {
        flexWrap: "wrap",
    },
    arrivalDirectionExpanded: {
        flexGrow: 0,
        flexBasis: "100%",
    },
    arrivalInlineRow: {
        minHeight: 24,
        marginTop: 7,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    arrivalInlineText: {
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        fontWeight: "700",
        letterSpacing: 0,
    },
    arrivalClockText: {
        minWidth: 52,
        fontSize: 17,
        fontWeight: "900",
        letterSpacing: 0,
    },
    arrivalWaitText: {
        fontSize: 16,
        fontWeight: "900",
        letterSpacing: 0,
        fontVariant: ["tabular-nums"],
    },
    arrivalMutedText: {
        flex: 1,
        minWidth: 0,
        fontSize: 15,
        fontWeight: "800",
        letterSpacing: 0,
    },
    arrivalAttributeList: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    arrivalAttributeBadge: {
        minWidth: 32,
        height: 22,
        borderRadius: 999,
        borderWidth: 1.2,
        paddingHorizontal: 6,
        alignItems: "center",
        justifyContent: "center",
    },
    arrivalAttributeText: {
        fontSize: 12,
        fontWeight: "900",
    },
    itemDivider: {
        height: StyleSheet.hairlineWidth,
        marginTop: ROW_DIVIDER_TOP_MARGIN,
        marginRight: -2,
    },
    stopList: {
        marginTop: 14,
        marginRight: 4,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 12,
        gap: 0,
    },
    inlineDisclosure: {
        minHeight: 44,
        marginTop: 10,
        paddingVertical: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    inlineDisclosureText: {
        flexShrink: 1,
        fontSize: 15,
        fontWeight: "700",
    },
    inlineStopList: {
        zIndex: 2,
    },
    inlineStopRow: {
        paddingLeft: 0,
    },
    inlineAlighting: {
        zIndex: 2,
        minHeight: 36,
        justifyContent: "center",
        paddingVertical: 6,
    },
    inlineAlightingTimed: {
        minHeight: 52,
        justifyContent: "flex-start",
        paddingTop: 7,
    },
    inlineAlightingMarker: {
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    inlineAlightingRail: {
        bottom: undefined,
        height: ALIGHTING_TIMED_MARKER_HEIGHT,
    },
    inlineAlightingConnector: {
        position: "absolute",
        left: -(COMPACT_RAIL_WIDTH + COMPACT_LINE_WIDTH) / 2,
        width: COMPACT_LINE_WIDTH,
        top: "50%",
        bottom: -(COMPACT_BODY_BOTTOM_PADDING + ROW_DIVIDER_TOP_MARGIN + StyleSheet.hairlineWidth),
        borderBottomLeftRadius: 2,
        borderBottomRightRadius: 2,
    },
    inlineAlightingConnectorTimed: {
        top: ALIGHTING_TIMED_MARKER_HEIGHT / 2,
    },
    inlineAlightingClock: {
        top: 27,
        left: -52,
    },
    inlineStopRail: {
        position: "absolute",
        left: -33,
        top: 0,
        bottom: 0,
        width: 10,
        justifyContent: "center",
        alignItems: "center",
    },
    inlineStopDot: {
        marginTop: 0,
    },
    stopRow: {
        minHeight: 30,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderRadius: 6,
        paddingHorizontal: 4,
    },
    stopRail: {
        width: 12,
        alignSelf: "stretch",
        alignItems: "center",
    },
    stopRowMapAction: {
        minHeight: 44,
    },
    stopSelectionSurface: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 6,
    },
    stopMapIcon: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    stopDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        borderWidth: 1.5,
        marginTop: 9,
        zIndex: 2,
    },
    stopLine: {
        width: 2,
        flex: 1,
        opacity: 0.48,
    },
    stopText: {
        flex: 1,
        minWidth: 0,
        fontSize: 14,
        letterSpacing: 0,
    },
});

export default styles;
