import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "../../../theme/ThemeContext";
import {
    formatRouteDistance,
    getRouteStepColor,
    type RouteInfo,
    type RouteStep,
    type RouteStepType,
} from "../../routeInfo";

type Props = {
    routeInfo: RouteInfo;
    selectedStepId?: string;
    onStepPress?: (step: RouteStep) => void;
    forceDark?: boolean;
    primaryTextColor?: string;
    secondaryTextColor?: string;
    initialExpandedStepId?: string;
};

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

function getStepIcon(type: RouteStepType): IoniconName {
    if (type === "ORIGIN") return "navigate";
    if (type === "DESTINATION") return "location";
    if (type === "WALK") return "walk";
    if (type === "SUBWAY") return "train";
    if (type === "BUS") return "bus";
    return "swap-horizontal";
}

function buildStepTitle(step: RouteStep): string {
    if (step.type !== "WALK") {
        const badge = step.badgeText ?? step.lineName;
        const withoutBadge = badge && step.title.startsWith(`${badge} `)
            ? step.title.slice(badge.length + 1)
            : step.title;
        return withoutBadge
            .replace(/\s*승차\s*→.*$/u, "")
            .replace(/\s*하차\s*$/u, "")
            .replace(/\s*승차\s*$/u, "")
            .trim() || withoutBadge;
    }
    const distance = formatRouteDistance(step.distanceMeters);
    const duration = typeof step.durationMinutes === "number" ? `${step.durationMinutes}분` : undefined;
    const summary = [distance, duration].filter(Boolean).join(" · ");
    return summary ? `도보 ${summary}` : step.title;
}

function shouldShowDescription(step: RouteStep): boolean {
    if (!step.description) return false;
    if (step.type === "WALK") return false;
    return true;
}

function getPointLabel(type: RouteStepType): string | undefined {
    if (type === "ORIGIN") return "출발";
    if (type === "DESTINATION") return "도착";
    return undefined;
}

function buildRideDescription(step: RouteStep): string | undefined {
    if (step.description) return step.description
        .replace(/\s*승차\s*/gu, " ")
        .replace(/\s*하차\s*/gu, " ")
        .replace(/\s*→\s*/gu, " · ")
        .replace(/\s+/g, " ")
        .trim();
    const chunks = [
        typeof step.stationCount === "number"
            ? `${step.stationCount}${step.type === "BUS" ? "개 정류장" : "정거장"}`
            : undefined,
        typeof step.durationMinutes === "number" ? `${step.durationMinutes}분` : undefined,
    ].filter(Boolean);
    return chunks.join(" · ") || step.description;
}

export default function RouteStepTimeline({
    routeInfo,
    selectedStepId,
    onStepPress,
    forceDark,
    primaryTextColor,
    secondaryTextColor,
    initialExpandedStepId,
}: Props) {
    const { colors, mode } = useTheme();
    const isDark = forceDark ?? mode === "dark";
    const primaryColor = primaryTextColor ?? colors.textPrimary;
    const secondaryColor = secondaryTextColor ?? colors.textSecondary;
    const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(() => (
        initialExpandedStepId ? new Set([initialExpandedStepId]) : new Set()
    ));

    useEffect(() => {
        if (!initialExpandedStepId) return;
        setExpandedStepIds((prev) => {
            if (prev.has(initialExpandedStepId)) return prev;
            const next = new Set(prev);
            next.add(initialExpandedStepId);
            return next;
        });
    }, [initialExpandedStepId]);

    const toggleStep = (step: RouteStep) => {
        const expandable = (step.type === "SUBWAY" || step.type === "BUS") && Array.isArray(step.passStops) && step.passStops.length > 0;
        if (expandable) {
            setExpandedStepIds((prev) => {
                const next = new Set(prev);
                if (next.has(step.id)) next.delete(step.id);
                else next.add(step.id);
                return next;
            });
        }
        onStepPress?.(step);
    };

    return (
        <View style={styles.root}>
            {routeInfo.steps.map((step, index) => {
                const isLast = index === routeInfo.steps.length - 1;
                const stepColor = getRouteStepColor(step);
                const selected = selectedStepId === step.id;
                const hasBadge = step.type === "SUBWAY" || step.type === "BUS";
                const pointLabel = getPointLabel(step.type);
                const expandable = hasBadge && Array.isArray(step.passStops) && step.passStops.length > 0;
                const expanded = expandedStepIds.has(step.id);
                const content = (
                    <>
                        <View style={styles.rail}>
                            <View
                                style={[
                                    styles.dot,
                                    {
                                        backgroundColor: step.type === "WALK" ? (isDark ? "#30343B" : "#F3F4F6") : stepColor,
                                        borderColor: stepColor,
                                    },
                                ]}
                            >
                                <Ionicons
                                    name={getStepIcon(step.type)}
                                    size={step.type === "WALK" ? 15 : 14}
                                    color={step.type === "WALK" ? stepColor : "#FFFFFF"}
                                />
                            </View>
                            {!isLast && (
                                <View
                                    style={[
                                        styles.line,
                                        {
                                            backgroundColor: step.type === "WALK"
                                                ? (isDark ? "#363B44" : "#D1D5DB")
                                                : stepColor,
                                        },
                                    ]}
                                />
                            )}
                        </View>
                        <View style={styles.body}>
                            <View style={styles.titleRow}>
                                {!!pointLabel && (
                                    <View style={[styles.pointBadge, { backgroundColor: stepColor }]}>
                                        <Text style={styles.pointBadgeText}>{pointLabel}</Text>
                                    </View>
                                )}
                                {hasBadge && (
                                    <View style={[styles.badge, { backgroundColor: stepColor }]}>
                                        <Text numberOfLines={1} style={styles.badgeText}>
                                            {step.badgeText ?? step.lineName ?? (step.type === "BUS" ? "버스" : "지하철")}
                                        </Text>
                                    </View>
                                )}
                                <Text
                                    numberOfLines={2}
                                style={[
                                    styles.title,
                                    { color: primaryColor },
                                ]}
                            >
                                    {buildStepTitle(step)}
                                </Text>
                                {expandable && (
                                    <Ionicons
                                        name={expanded ? "chevron-up" : "chevron-down"}
                                        size={16}
                                        color={secondaryColor}
                                    />
                                )}
                            </View>
                            {hasBadge && (
                                <Text numberOfLines={1} style={[styles.description, { color: secondaryColor }]}>
                                    {buildRideDescription(step)}
                                </Text>
                            )}
                            {!hasBadge && shouldShowDescription(step) && (
                                <Text numberOfLines={2} style={[styles.description, { color: secondaryColor }]}>
                                    {step.description}
                                </Text>
                            )}
                            {expanded && Array.isArray(step.passStops) && step.passStops.length > 0 && (
                                <View style={[styles.stopList, { borderColor: isDark ? "rgba(255,255,255,0.10)" : "#E5E7EB" }]}>
                                    {step.passStops.map((stop, stopIndex) => {
                                        const first = stopIndex === 0;
                                        const last = stopIndex === step.passStops!.length - 1;
                                        return (
                                            <View key={`${step.id}-${stop.name}-${stopIndex}`} style={styles.stopRow}>
                                                <View style={styles.stopRail}>
                                                    <View
                                                        style={[
                                                            styles.stopDot,
                                                            {
                                                                borderColor: first || last ? stepColor : secondaryColor,
                                                                backgroundColor: first || last ? stepColor : "transparent",
                                                            },
                                                        ]}
                                                    />
                                                    {stopIndex < step.passStops!.length - 1 && (
                                                        <View style={[styles.stopLine, { backgroundColor: stepColor }]} />
                                                    )}
                                                </View>
                                                <Text
                                                    numberOfLines={1}
                                                    style={[
                                                        styles.stopText,
                                                        {
                                                            color: first || last ? primaryColor : secondaryColor,
                                                            fontWeight: first || last ? "900" : "700",
                                                        },
                                                    ]}
                                                >
                                                    {stop.name}
                                                </Text>
                                            </View>
                                        );
                                    })}
                                </View>
                            )}
                        </View>
                    </>
                );

                return (
                    <Pressable
                        key={step.id}
                        disabled={!onStepPress || step.type === "ORIGIN" || step.type === "DESTINATION"}
                        onPress={() => toggleStep(step)}
                        style={[
                            styles.item,
                            selected
                                ? {
                                    backgroundColor: isDark ? "rgba(41,121,255,0.16)" : "rgba(41,121,255,0.10)",
                                    borderColor: isDark ? "rgba(41,121,255,0.34)" : "rgba(41,121,255,0.22)",
                                }
                                : {
                                    backgroundColor: "transparent",
                                    borderColor: "transparent",
                                },
                        ]}
                    >
                        {content}
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        gap: 0,
    },
    item: {
        flexDirection: "row",
        borderWidth: 0,
        borderRadius: 8,
        paddingVertical: 10,
        paddingHorizontal: 0,
    },
    rail: {
        width: 42,
        alignItems: "center",
    },
    dot: {
        width: 30,
        height: 30,
        borderRadius: 15,
        borderWidth: 2,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2,
    },
    line: {
        width: 4,
        flex: 1,
        minHeight: 30,
        marginTop: 4,
        borderRadius: 2,
        opacity: 0.86,
    },
    body: {
        flex: 1,
        minWidth: 0,
        paddingTop: 0,
        paddingBottom: 10,
    },
    titleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    badge: {
        minWidth: 32,
        maxWidth: 74,
        height: 22,
        borderRadius: 6,
        paddingHorizontal: 7,
        alignItems: "center",
        justifyContent: "center",
    },
    pointBadge: {
        minWidth: 36,
        height: 22,
        borderRadius: 6,
        paddingHorizontal: 6,
        alignItems: "center",
        justifyContent: "center",
    },
    pointBadgeText: {
        color: "#FFFFFF",
        fontSize: 10,
        fontWeight: "900",
        letterSpacing: 0,
    },
    badgeText: {
        color: "#FFFFFF",
        fontSize: 11,
        fontWeight: "900",
        letterSpacing: 0,
    },
    title: {
        flex: 1,
        minWidth: 0,
        fontSize: 17,
        fontWeight: "900",
        lineHeight: 23,
        letterSpacing: 0,
    },
    description: {
        marginTop: 6,
        fontSize: 14,
        fontWeight: "800",
        lineHeight: 20,
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
    stopRow: {
        minHeight: 30,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    stopRail: {
        width: 12,
        alignSelf: "stretch",
        alignItems: "center",
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
        lineHeight: 20,
        letterSpacing: 0,
    },
});
