import { Ionicons as ExpoIonicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
    getBusArrivals,
    getSubwayArrivals,
    type TransitArrivalInfo,
} from "../../../../api/transitArrivals";
import { useTheme } from "../../../theme/ThemeContext";
import {
    formatRouteDistance,
    getRouteStepDirectionHint,
    getRouteStepColor,
    type RouteInfo,
    type RouteStep,
    type RouteStepType,
} from "../../routeInfo";
import { getBusArrivalStationIdentifiers } from "../../transitArrivalIdentifiers";
import {
    getTransitArrivalAttributeLabels,
    getTransitArrivalInlineMessage,
    getTransitArrivalPresentation,
    getTransitArrivalStatusLabel,
    type TransitArrivalLoadState,
} from "./transitArrivalPresentation";

function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
    return <ExpoIonicons {...props} accessible={false} importantForAccessibility="no" />;
}

type Props = {
    routeInfo: RouteInfo;
    selectedStepId?: string;
    selectedPassStop?: {
        stepId: string;
        stopIndex: number;
    };
    onStepPress?: (step: RouteStep) => void;
    allowEndpointPress?: boolean;
    forceDark?: boolean;
    primaryTextColor?: string;
    secondaryTextColor?: string;
    initialExpandedStepId?: string;
    compact?: boolean;
};

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

type ArrivalRequest =
    | {
        kind: "SUBWAY";
        stationName: string;
        lineName?: string;
        directionName?: string;
        directionCode?: "UP" | "DOWN";
    }
    | {
        kind: "BUS";
        arsId?: string;
        cityCode?: string;
        nodeId?: string;
        stationName?: string;
        routeName?: string;
    };

function getStepIcon(type: RouteStepType): IoniconName {
    if (type === "DESTINATION") return "location";
    if (type === "WALK") return "walk-outline";
    if (type === "SUBWAY") return "train-outline";
    if (type === "BUS") return "bus-outline";
    if (type === "DRIVE") return "car-outline";
    if (type === "BIKE") return "bicycle-outline";
    return "swap-horizontal";
}

function getStepIconSize(type: RouteStepType, compact: boolean): number {
    if (type === "DESTINATION") return compact ? 20 : 20;
    if (type === "WALK") return compact ? 19 : 19;
    return compact ? 20 : 18;
}

function StepIconGlyph({
    type,
    color,
    compact,
}: {
    type: RouteStepType;
    color: string;
    compact: boolean;
}) {
    if (type === "ORIGIN") {
        return (
            <View
                style={[
                    styles.originGlyphOuter,
                    compact && styles.originGlyphOuterCompact,
                    { borderColor: color },
                ]}
            >
                <View
                    style={[
                        styles.originGlyphCore,
                        compact && styles.originGlyphCoreCompact,
                        { backgroundColor: color },
                    ]}
                />
            </View>
        );
    }

    return (
        <Ionicons
            name={getStepIcon(type)}
            size={getStepIconSize(type, compact)}
            color={color}
        />
    );
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
    if (step.title.trim() !== "도보") return step.title;
    const distance = formatRouteDistance(step.distanceMeters);
    const duration = typeof step.durationMinutes === "number" ? `${step.durationMinutes}분` : undefined;
    const summary = [distance, duration].filter(Boolean).join(" · ");
    return summary ? `도보 ${summary}` : step.title;
}

function shouldShowDescription(step: RouteStep): boolean {
    if (!step.description) return false;
    if (step.type === "WALK" && step.title.trim() === "도보") return false;
    return true;
}

function getPointLabel(type: RouteStepType): string | undefined {
    if (type === "ORIGIN") return "출발";
    if (type === "DESTINATION") return "도착";
    return undefined;
}

function buildBoardingGuideItems(step: RouteStep): Array<{ key: string; icon: IoniconName; label: string }> {
    const items: Array<{ key: string; icon: IoniconName; label: string }> = [];
    if (step.boardingExit) {
        items.push({ key: "exit", icon: "exit-outline", label: step.boardingExit });
    }
    if (step.boardingPlatform) {
        items.push({ key: "platform", icon: "business-outline", label: step.boardingPlatform });
    }
    const transferPosition = step.recommendedTransferPosition?.trim();
    const boardingPosition = step.recommendedBoardingPosition?.trim();
    if (transferPosition) {
        items.push({
            key: "transfer-position",
            icon: "swap-horizontal-outline",
            label: `추천 승차칸 ${transferPosition} · 환승 최적 위치`,
        });
    } else if (boardingPosition) {
        items.push({
            key: "boarding-position",
            icon: "compass-outline",
            label: `추천 승차칸 ${boardingPosition}`,
        });
    }
    return items;
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

function formatArrivalClock(baseValue: string, offsetMinutes: number): string {
    const base = new Date(baseValue);
    if (Number.isNaN(base.getTime())) return "--:--";
    const next = new Date(base.getTime() + Math.max(0, offsetMinutes) * 60 * 1000);
    const hours = String(next.getHours()).padStart(2, "0");
    const minutes = String(next.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
}

function getTransitLineLabel(step: RouteStep): string | undefined {
    return step.badgeText ?? step.lineName;
}

function pickBusStationIdentifiers(step: RouteStep): Pick<Extract<ArrivalRequest, { kind: "BUS" }>, "arsId" | "cityCode" | "nodeId" | "stationName"> {
    return getBusArrivalStationIdentifiers(step.passStops, buildStepTitle(step));
}

function getArrivalRequest(step: RouteStep): ArrivalRequest | undefined {
    if (step.type === "SUBWAY") {
        const stationName = buildStepTitle(step).replace(/\s+/g, " ").trim();
        if (!stationName) return undefined;
        return {
            kind: "SUBWAY",
            stationName,
            lineName: getTransitLineLabel(step),
            directionName: step.directionName,
            directionCode: step.directionCode,
        };
    }

    if (step.type === "BUS") {
        const identifiers = pickBusStationIdentifiers(step);
        if (!identifiers.arsId && !identifiers.nodeId && !identifiers.stationName) return undefined;
        return {
            kind: "BUS",
            ...identifiers,
            routeName: getTransitLineLabel(step),
        };
    }

    return undefined;
}

function buildArrivalLookupKey(steps: RouteStep[]): string {
    return steps
        .map((step) => {
            const request = getArrivalRequest(step);
            if (!request) return `${step.id}:none`;
            if (request.kind === "SUBWAY") {
                return `${step.id}:subway:${request.stationName}:${request.lineName ?? ""}:${request.directionName ?? ""}:${request.directionCode ?? ""}`;
            }
            return `${step.id}:bus:${request.arsId ?? ""}:${request.cityCode ?? ""}:${request.nodeId ?? ""}:${request.stationName ?? ""}:${request.routeName ?? ""}`;
        })
        .join("|");
}

function formatClockValue(value?: string | null): string | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
}

function getArrivalWaitText(arrival: TransitArrivalInfo): string {
    if (arrival.arrivalStatus === "APPROACHING") return "곧";
    if (arrival.arrivalStatus === "ARRIVED") return "도착";
    if (arrival.arrivalStatus === "DEPARTED") return "출발";
    if (typeof arrival.waitMinutes === "number" && Number.isFinite(arrival.waitMinutes)) {
        return arrival.waitMinutes <= 0 ? "곧" : `${arrival.waitMinutes}분`;
    }
    if (typeof arrival.waitSeconds === "number" && Number.isFinite(arrival.waitSeconds)) {
        const minutes = Math.ceil(Math.max(0, arrival.waitSeconds) / 60);
        return minutes <= 0 ? "곧" : `${minutes}분`;
    }
    return arrival.arrivalMessage?.trim() || "도착 예정";
}

function getArrivalClockText(
    arrival: TransitArrivalInfo
): string {
    const expectedClock = formatClockValue(arrival.expectedAt);
    if (expectedClock) return expectedClock;

    const waitMinutes = typeof arrival.waitMinutes === "number"
        ? arrival.waitMinutes
        : typeof arrival.waitSeconds === "number"
            ? Math.ceil(Math.max(0, arrival.waitSeconds) / 60)
            : undefined;

    if (typeof waitMinutes === "number" && Number.isFinite(waitMinutes)) {
        return formatArrivalClock(new Date().toISOString(), waitMinutes);
    }
    return "--:--";
}

function getArrivalDirectionText(arrival: TransitArrivalInfo, fallback?: string): string {
    const chunks: string[] = [];
    const destinationName = arrival.destinationName?.trim();
    if (destinationName) chunks.push(`${destinationName}행`);
    else if (arrival.direction?.trim()) chunks.push(arrival.direction.trim());

    if (typeof arrival.remainingStops === "number" && Number.isFinite(arrival.remainingStops)) {
        chunks.push(arrival.remainingStops <= 0 ? "정류장 진입" : `${arrival.remainingStops}정류장 전`);
    }
    if (
        arrival.arrivalStatusLabel?.trim() &&
        (arrival.arrivalStatus === "PREVIOUS_STOP" || arrival.arrivalStatus === "IN_TRANSIT")
    ) {
        chunks.push(arrival.arrivalStatusLabel.trim());
    }
    const vehicleType = arrival.vehicleType?.trim();
    const vehicleTypeAlreadyBadged = !!vehicleType && (
        (arrival.lowFloor && vehicleType.includes("저상")) ||
        (arrival.express && (vehicleType.includes("급행") || vehicleType.includes("특급")))
    );
    if (vehicleType && !vehicleTypeAlreadyBadged) chunks.push(vehicleType);

    if (chunks.length > 0) return Array.from(new Set(chunks)).join(" · ");
    return arrival.arrivalMessage?.trim() || fallback || "도착 예정";
}

function getArrivalUpdatedAt(arrivals: TransitArrivalInfo[], fallback: string): string {
    const timestamps = arrivals
        .flatMap((arrival) => [arrival.sourceUpdatedAt, arrival.observedAt])
        .map((value) => value ? new Date(value).getTime() : Number.NaN)
        .filter((value) => Number.isFinite(value));
    if (!timestamps.length) return fallback;
    return new Date(Math.max(...timestamps)).toISOString();
}

export default function RouteStepTimeline({
    routeInfo,
    selectedStepId,
    selectedPassStop,
    onStepPress,
    allowEndpointPress = false,
    forceDark,
    primaryTextColor,
    secondaryTextColor,
    initialExpandedStepId,
    compact = false,
}: Props) {
    const { colors, mode } = useTheme();
    const isDark = forceDark ?? mode === "dark";
    const primaryColor = primaryTextColor ?? colors.textPrimary;
    const secondaryColor = secondaryTextColor ?? colors.textSecondary;
    const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(() => (
        initialExpandedStepId ? new Set([initialExpandedStepId]) : new Set()
    ));
    const [arrivalByStepId, setArrivalByStepId] = useState<Record<string, TransitArrivalInfo[]>>({});
    const [arrivalStateByStepId, setArrivalStateByStepId] = useState<Record<string, TransitArrivalLoadState>>({});
    const [arrivalUpdatedAtByStepId, setArrivalUpdatedAtByStepId] = useState<Record<string, string>>({});
    const arrivalLookupKey = useMemo(() => buildArrivalLookupKey(routeInfo.steps), [routeInfo.steps]);
    let runningOffsetMinutes = 0;
    const stepStartOffsets = routeInfo.steps.map((step) => {
        const currentOffset = runningOffsetMinutes;
        if (typeof step.durationMinutes === "number" && Number.isFinite(step.durationMinutes)) {
            runningOffsetMinutes += Math.max(0, step.durationMinutes);
        }
        return currentOffset;
    });
    const scheduleSourceLabel = routeInfo.timeBasis === "provider_schedule"
        ? routeInfo.provider === "odsay" ? "ODsay 시간표" : "경로 시간표"
        : "경로 예상 시간";

    useEffect(() => {
        if (!initialExpandedStepId) return;
        setExpandedStepIds((prev) => {
            if (prev.has(initialExpandedStepId)) return prev;
            const next = new Set(prev);
            next.add(initialExpandedStepId);
            return next;
        });
    }, [initialExpandedStepId]);

    useEffect(() => {
        if (!selectedStepId) return;
        const selectedStep = routeInfo.steps.find((step) => step.id === selectedStepId);
        if (!selectedStep || !Array.isArray(selectedStep.passStops) || selectedStep.passStops.length === 0) return;
        setExpandedStepIds((prev) => {
            if (prev.has(selectedStepId)) return prev;
            const next = new Set(prev);
            next.add(selectedStepId);
            return next;
        });
    }, [routeInfo.steps, selectedStepId]);

    useEffect(() => {
        if (!compact) {
            setArrivalByStepId({});
            setArrivalStateByStepId({});
            setArrivalUpdatedAtByStepId({});
            return;
        }

        const requests = routeInfo.steps
            .map((step) => ({ step, request: getArrivalRequest(step) }))
            .filter((item): item is { step: RouteStep; request: ArrivalRequest } => !!item.request);

        if (requests.length === 0) {
            setArrivalByStepId({});
            setArrivalStateByStepId({});
            setArrivalUpdatedAtByStepId({});
            return;
        }

        let cancelled = false;
        const refreshArrivals = async () => {
            setArrivalStateByStepId((prev) => {
                const next = { ...prev };
                requests.forEach(({ step }) => {
                    if (!next[step.id]) next[step.id] = "loading";
                });
                return next;
            });
            const entries = await Promise.all(
                requests.map(async ({ step, request }) => {
                    try {
                        const arrivals = request.kind === "BUS"
                            ? await getBusArrivals({
                                arsId: request.arsId,
                                cityCode: request.cityCode,
                                nodeId: request.nodeId,
                                stationName: request.stationName,
                                routeName: request.routeName,
                                limit: 2,
                            })
                            : await getSubwayArrivals({
                                stationName: request.stationName,
                                lineName: request.lineName,
                                directionName: request.directionName,
                                directionCode: request.directionCode,
                                limit: 3,
                            });
                        const completedAt = new Date().toISOString();
                        return [
                            step.id,
                            arrivals,
                            arrivals.length > 0 ? "ready" : "empty",
                            getArrivalUpdatedAt(arrivals, completedAt),
                        ] as const;
                    } catch {
                        return [step.id, [] as TransitArrivalInfo[], "error", undefined] as const;
                    }
                })
            );

            if (cancelled) return;
            setArrivalByStepId((prev) => {
                const next = { ...prev };
                entries.forEach(([stepId, arrivals, state]) => {
                    // 갱신 오류에서는 마지막 정상값을 유지하고 상태만 지연으로 바꾼다.
                    if (state !== "error") next[stepId] = arrivals;
                });
                return next;
            });
            const nextStates: Record<string, TransitArrivalLoadState> = {};
            const nextUpdatedAt: Record<string, string> = {};
            entries.forEach(([stepId, , state, updatedAt]) => {
                nextStates[stepId] = state;
                if (updatedAt) nextUpdatedAt[stepId] = updatedAt;
            });
            setArrivalStateByStepId(nextStates);
            setArrivalUpdatedAtByStepId((prev) => ({ ...prev, ...nextUpdatedAt }));
        };

        refreshArrivals();
        const timer = setInterval(refreshArrivals, 45 * 1000);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [arrivalLookupKey, compact, routeInfo.steps]);

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
                const isEndpointStep = step.type === "ORIGIN" || step.type === "DESTINATION";
                const stepPressEnabled = !!onStepPress && (allowEndpointPress || !isEndpointStep);
                const hasBadge = step.type === "SUBWAY" || step.type === "BUS";
                const pointLabel = getPointLabel(step.type);
                const expandable = hasBadge && Array.isArray(step.passStops) && step.passStops.length > 0;
                const expanded = expandedStepIds.has(step.id);
                const rideDescription = hasBadge ? buildRideDescription(step) : undefined;
                const rideDirectionLabel = hasBadge ? getRouteStepDirectionHint(step, rideDescription) : undefined;
                const boardingGuideItems = hasBadge ? buildBoardingGuideItems(step) : [];
                const arrivalRequest = hasBadge ? getArrivalRequest(step) : undefined;
                const realtimeArrivals = hasBadge ? arrivalByStepId[step.id] ?? [] : [];
                const arrivalState = hasBadge ? arrivalStateByStepId[step.id] : undefined;
                const arrivalUpdatedAt = hasBadge ? arrivalUpdatedAtByStepId[step.id] : undefined;
                const arrivalPresentation = getTransitArrivalPresentation({
                    hasRequest: !!arrivalRequest,
                    loadState: arrivalState,
                    arrivalCount: realtimeArrivals.length,
                    updatedAt: arrivalUpdatedAt,
                });
                const stepStartOffset = stepStartOffsets[index] ?? 0;
                const timelineClockText = compact ? formatArrivalClock(routeInfo.departureTime, stepStartOffset) : undefined;
                const arrivalInlineMessage = getTransitArrivalInlineMessage(
                    arrivalPresentation,
                    timelineClockText,
                    scheduleSourceLabel
                );
                const arrivalStatusLabel = getTransitArrivalStatusLabel(
                    arrivalPresentation,
                    timelineClockText
                );
                const shouldShowTimelineClock = !!timelineClockText && (
                    step.type !== "WALK" ||
                    (index > 1 && !isLast)
                );
                const isWalkStep = step.type === "WALK";
                const isPointStep = step.type === "ORIGIN" || step.type === "DESTINATION";
                const isTransitStep = step.type === "SUBWAY" || step.type === "BUS";
                const isColoredMovementStep = isTransitStep || step.type === "DRIVE" || step.type === "BIKE";
                const iconBackgroundColor = compact
                    ? (isColoredMovementStep ? stepColor : isDark ? "#1C2028" : "#F8FAFC")
                    : (isDark ? "#15181E" : "#F8FAFC");
                const iconBorderColor = isPointStep || isWalkStep
                    ? (isDark ? "rgba(255,255,255,0.18)" : "#E5E7EB")
                    : stepColor;
                const iconColor = isPointStep
                    ? stepColor
                    : compact && isColoredMovementStep
                        ? "#FFFFFF"
                        : isDark
                        ? "#F5F7FA"
                        : isTransitStep
                            ? stepColor
                            : "#374151";
                const content = (
                    <>
                        <View style={[styles.rail, compact && styles.railCompact]}>
                            <View
                                style={[
                                    styles.dot,
                                    compact && styles.dotCompact,
                                    {
                                        backgroundColor: iconBackgroundColor,
                                        borderColor: iconBorderColor,
                                    },
                                ]}
                            >
                                <StepIconGlyph type={step.type} color={iconColor} compact={compact} />
                            </View>
                            {compact && shouldShowTimelineClock && (
                                <View style={[styles.timelineClockBadge, { backgroundColor: isDark ? "#22252C" : "#F8FAFC", borderColor: isDark ? "rgba(255,255,255,0.16)" : "#D1D5DB" }]}>
                                    <Text style={[styles.timelineClockText, { color: isDark ? "#D7D7DA" : "#374151" }]}>
                                        {timelineClockText}
                                    </Text>
                                </View>
                            )}
                            {!isLast && (
                                <View
                                    style={[
                                        styles.line,
                                        compact && styles.lineCompact,
                                        {
                                            backgroundColor: step.type === "WALK" || step.type === "ORIGIN" || step.type === "DESTINATION"
                                                ? (isDark ? "#3A404A" : "#D1D5DB")
                                                : stepColor,
                                        },
                                    ]}
                                />
                            )}
                        </View>
                        <View style={[styles.body, compact && styles.bodyCompact]}>
                            <View style={[styles.titleRow, compact && styles.titleRowCompact]}>
                                {!!pointLabel && (
                                    <View style={[styles.pointBadge, compact && styles.pointBadgeCompact, { backgroundColor: stepColor }]}>
                                        <Text style={[styles.pointBadgeText, compact && styles.pointBadgeTextCompact]}>{pointLabel}</Text>
                                    </View>
                                )}
                                {hasBadge && (
                                    <View style={[styles.badge, compact && styles.badgeCompact, { backgroundColor: stepColor }]}>
                                        <Text numberOfLines={1} style={[styles.badgeText, compact && styles.badgeTextCompact]}>
                                            {step.badgeText ?? step.lineName ?? (step.type === "BUS" ? "버스" : "지하철")}
                                        </Text>
                                    </View>
                                )}
                                <Text
                                    numberOfLines={2}
                                style={[
                                    styles.title,
                                    compact && styles.titleCompact,
                                    { color: primaryColor },
                                ]}
                            >
                                    {buildStepTitle(step)}
                                    {compact && hasBadge && (
                                        <Text style={[styles.titleSuffix, { color: secondaryColor }]}> 승차</Text>
                                    )}
                                </Text>
                                {expandable && (
                                    <Ionicons
                                        name={expanded ? "chevron-up" : "chevron-down"}
                                        size={compact ? 14 : 16}
                                        color={secondaryColor}
                                    />
                                )}
                            </View>
                            {hasBadge && !compact && (
                                <Text numberOfLines={1} style={[styles.description, compact && styles.descriptionCompact, { color: secondaryColor }]}>
                                    {rideDescription}
                                </Text>
                            )}
                            {compact && hasBadge && (
                                <>
                                    <View style={styles.rideInfoRow}>
                                        <View style={styles.rideInfoTextStack}>
                                            {!!rideDescription && (
                                                <Text numberOfLines={1} style={[styles.description, styles.descriptionCompact, { color: secondaryColor }]}>
                                                    {rideDescription}
                                                </Text>
                                            )}
                                            {!!rideDirectionLabel && (
                                                <Text numberOfLines={1} style={[styles.rideAssistText, { color: secondaryColor }]}>
                                                    {rideDirectionLabel}
                                                </Text>
                                            )}
                                        </View>
                                        <View style={styles.rideActionStack}>
                                            <View style={styles.rideActionRow}>
                                                <View style={[styles.rideActionChip, { borderColor: isDark ? "rgba(255,255,255,0.16)" : "#D1D5DB" }]}>
                                                    <Text style={[styles.rideActionText, { color: primaryColor }]}>
                                                        {arrivalStatusLabel}
                                                    </Text>
                                                </View>
                                            </View>
                                            {!!arrivalPresentation.freshnessLabel && (
                                                <Text style={[styles.arrivalFreshnessText, { color: secondaryColor }]}>
                                                    {arrivalPresentation.freshnessLabel}
                                                </Text>
                                            )}
                                        </View>
                                    </View>
                                    {boardingGuideItems.length > 0 && (
                                        <View style={styles.boardingGuideRow}>
                                            {boardingGuideItems.map((item) => (
                                                <View
                                                    key={`${step.id}-${item.key}`}
                                                    style={[
                                                        styles.boardingGuideChip,
                                                        { borderColor: isDark ? "rgba(255,255,255,0.16)" : "#D1D5DB" },
                                                    ]}
                                                >
                                                    <Ionicons name={item.icon} size={13} color={stepColor} />
                                                    <Text
                                                        numberOfLines={1}
                                                        style={[styles.boardingGuideText, { color: primaryColor }]}
                                                    >
                                                        {item.label}
                                                    </Text>
                                                </View>
                                            ))}
                                        </View>
                                    )}
                                    {arrivalPresentation.showArrivalCard ? (
                                        <View style={[styles.arrivalCard, { borderColor: isDark ? "rgba(255,255,255,0.16)" : "#D1D5DB" }]}>
                                        {step.type === "BUS" ? (
                                            <>
                                                {realtimeArrivals.slice(0, 2).map((arrival, arrivalIndex) => {
                                                    const attributeLabels = getTransitArrivalAttributeLabels(arrival);
                                                    return (
                                                        <View key={`${step.id}-bus-arrival-${arrivalIndex}`} style={styles.busArrivalRow}>
                                                            <View style={[styles.busArrivalBadge, { backgroundColor: stepColor }]}>
                                                                <Text numberOfLines={1} style={styles.busArrivalBadgeText}>
                                                                    {step.badgeText ?? step.lineName ?? "버스"}
                                                                </Text>
                                                            </View>
                                                            <Text style={styles.arrivalWaitText}>
                                                                {getArrivalWaitText(arrival)}
                                                            </Text>
                                                            <Text numberOfLines={1} style={[styles.arrivalMutedText, { color: secondaryColor }]}>
                                                                {getArrivalDirectionText(
                                                                    arrival,
                                                                    typeof step.stationCount === "number" ? `${step.stationCount}정류장` : undefined
                                                                )}
                                                            </Text>
                                                            {attributeLabels.length > 0 && (
                                                                <View style={styles.arrivalAttributeList}>
                                                                    {attributeLabels.map((label) => (
                                                                        <View key={label} style={[styles.arrivalAttributeBadge, { borderColor: stepColor }]}>
                                                                            <Text style={[styles.arrivalAttributeText, { color: stepColor }]}>{label}</Text>
                                                                        </View>
                                                                    ))}
                                                                </View>
                                                            )}
                                                        </View>
                                                    );
                                                })}
                                            </>
                                        ) : (
                                            realtimeArrivals.slice(0, 3).map((arrival, arrivalIndex) => {
                                                const attributeLabels = getTransitArrivalAttributeLabels(arrival);
                                                return (
                                                    <View key={`${step.id}-arrival-${arrivalIndex}`} style={styles.trainArrivalRow}>
                                                        <Text style={[styles.arrivalClockText, { color: primaryColor }]}>
                                                            {getArrivalClockText(arrival)}
                                                        </Text>
                                                        <Text style={styles.arrivalWaitText}>
                                                            {getArrivalWaitText(arrival)}
                                                        </Text>
                                                        <Text numberOfLines={1} style={[styles.arrivalMutedText, { color: secondaryColor }]}>
                                                            {getArrivalDirectionText(arrival, rideDirectionLabel?.replace(/\s*방면$/u, "행"))}
                                                        </Text>
                                                        {attributeLabels.length > 0 && (
                                                            <View style={styles.arrivalAttributeList}>
                                                                {attributeLabels.map((label) => (
                                                                    <View key={label} style={[styles.arrivalAttributeBadge, { borderColor: stepColor }]}>
                                                                        <Text style={[styles.arrivalAttributeText, { color: stepColor }]}>{label}</Text>
                                                                    </View>
                                                                ))}
                                                            </View>
                                                        )}
                                                    </View>
                                                );
                                            })
                                        )}
                                        </View>
                                    ) : (
                                        <View style={styles.arrivalInlineRow}>
                                            <Ionicons
                                                name={arrivalPresentation.showLoadingIcon ? "sync-outline" : "information-circle-outline"}
                                                size={15}
                                                color={secondaryColor}
                                            />
                                            <Text numberOfLines={1} style={[styles.arrivalInlineText, { color: secondaryColor }]}>
                                                {arrivalInlineMessage}
                                            </Text>
                                        </View>
                                    )}
                                </>
                            )}
                            {!hasBadge && shouldShowDescription(step) && (
                                <Text numberOfLines={2} style={[styles.description, compact && styles.descriptionCompact, { color: secondaryColor }]}>
                                    {step.description}
                                </Text>
                            )}
                            {expanded && Array.isArray(step.passStops) && step.passStops.length > 0 && (
                                <View style={[styles.stopList, { borderColor: isDark ? "rgba(255,255,255,0.10)" : "#E5E7EB" }]}>
                                    {step.passStops.map((stop, stopIndex) => {
                                        const first = stopIndex === 0;
                                        const last = stopIndex === step.passStops!.length - 1;
                                        const stopSelected = selectedPassStop?.stepId === step.id
                                            && selectedPassStop.stopIndex === stopIndex;
                                        return (
                                            <View
                                                key={`${step.id}-${stop.name}-${stopIndex}`}
                                                style={[
                                                    styles.stopRow,
                                                    stopSelected
                                                        ? {
                                                            backgroundColor: isDark
                                                                ? "rgba(41,121,255,0.16)"
                                                                : "rgba(41,121,255,0.10)",
                                                        }
                                                        : null,
                                                ]}
                                            >
                                                <View style={styles.stopRail}>
                                                    <View
                                                        style={[
                                                            styles.stopDot,
                                                            {
                                                                borderColor: first || last || stopSelected ? stepColor : secondaryColor,
                                                                backgroundColor: first || last || stopSelected ? stepColor : "transparent",
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
                                                            color: first || last || stopSelected ? primaryColor : secondaryColor,
                                                            fontWeight: first || last || stopSelected ? "900" : "700",
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
                            {compact && !isLast && (
                                <View
                                    style={[
                                        styles.itemDivider,
                                        { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "#E5E7EB" },
                                    ]}
                                />
                            )}
                        </View>
                    </>
                );

                const selectedStyle = selected
                    ? compact
                        ? styles.itemCompactFocused
                        : {
                            backgroundColor: isDark ? "rgba(41,121,255,0.16)" : "rgba(41,121,255,0.10)",
                            borderColor: isDark ? "rgba(41,121,255,0.34)" : "rgba(41,121,255,0.22)",
                        }
                    : {
                        backgroundColor: "transparent",
                        borderColor: "transparent",
                    };
                const stepAccessibilityLabel = isEndpointStep
                    ? `${pointLabel}, ${buildStepTitle(step)}`
                    : [
                        step.badgeText ?? step.lineName,
                        buildStepTitle(step),
                        hasBadge ? rideDescription : step.description,
                    ].filter(Boolean).join(", ");

                return (
                    <Pressable
                        key={step.id}
                        disabled={!stepPressEnabled}
                        accessibilityRole={stepPressEnabled ? "button" : undefined}
                        accessibilityLabel={stepPressEnabled ? stepAccessibilityLabel : undefined}
                        accessibilityState={stepPressEnabled ? {
                            selected,
                            expanded: expandable ? expanded : undefined,
                        } : undefined}
                        accessibilityHint={stepPressEnabled
                            ? expandable
                                ? "지도에서 이 구간을 표시하고 경유지 목록을 열거나 닫습니다"
                                : "지도에서 이 지점을 표시합니다"
                            : undefined}
                        onPress={() => toggleStep(step)}
                        style={[
                            styles.item,
                            compact && styles.itemCompact,
                            selectedStyle,
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
    itemCompact: {
        paddingVertical: 1,
    },
    itemCompactFocused: {
        backgroundColor: "transparent",
        borderColor: "transparent",
    },
    rail: {
        width: 42,
        alignItems: "center",
    },
    railCompact: {
        width: 56,
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
        width: 5,
        minHeight: 46,
        marginTop: 0,
    },
    timelineClockBadge: {
        position: "absolute",
        top: 35,
        minWidth: 48,
        height: 23,
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
        lineHeight: 16,
        letterSpacing: 0,
    },
    body: {
        flex: 1,
        minWidth: 0,
        paddingTop: 0,
        paddingBottom: 10,
    },
    bodyCompact: {
        paddingTop: 2,
        paddingBottom: 6,
    },
    titleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    titleRowCompact: {
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
    badgeCompact: {
        height: 25,
        borderRadius: 7,
        paddingHorizontal: 9,
    },
    pointBadge: {
        minWidth: 36,
        height: 22,
        borderRadius: 6,
        paddingHorizontal: 6,
        alignItems: "center",
        justifyContent: "center",
    },
    pointBadgeCompact: {
        minWidth: 42,
        height: 25,
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
        lineHeight: 15,
    },
    badgeText: {
        color: "#FFFFFF",
        fontSize: 11,
        fontWeight: "900",
        letterSpacing: 0,
    },
    badgeTextCompact: {
        fontSize: 13,
        lineHeight: 16,
    },
    title: {
        flex: 1,
        minWidth: 0,
        fontSize: 17,
        fontWeight: "900",
        lineHeight: 23,
        letterSpacing: 0,
    },
    titleCompact: {
        fontSize: 17,
        fontWeight: "900",
        lineHeight: 23,
    },
    titleSuffix: {
        fontSize: 15,
        fontWeight: "900",
        lineHeight: 22,
    },
    description: {
        marginTop: 6,
        fontSize: 14,
        fontWeight: "800",
        lineHeight: 20,
    },
    descriptionCompact: {
        marginTop: 4,
        fontSize: 15,
        fontWeight: "800",
        lineHeight: 20,
    },
    rideInfoRow: {
        marginTop: 4,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
    },
    rideInfoTextStack: {
        flex: 1,
        minWidth: 0,
    },
    rideAssistText: {
        marginTop: 3,
        fontSize: 14,
        fontWeight: "800",
        lineHeight: 19,
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
        lineHeight: 16,
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
        lineHeight: 17,
        letterSpacing: 0,
    },
    arrivalFreshnessText: {
        fontSize: 11,
        fontWeight: "800",
        lineHeight: 14,
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
        lineHeight: 18,
        letterSpacing: 0,
    },
    arrivalClockText: {
        minWidth: 52,
        fontSize: 17,
        fontWeight: "900",
        lineHeight: 22,
        letterSpacing: 0,
    },
    arrivalWaitText: {
        color: "#FF5A52",
        fontSize: 16,
        fontWeight: "900",
        lineHeight: 21,
        letterSpacing: 0,
    },
    arrivalMutedText: {
        flex: 1,
        minWidth: 0,
        fontSize: 15,
        fontWeight: "800",
        lineHeight: 20,
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
        lineHeight: 15,
    },
    busArrivalBadge: {
        minWidth: 44,
        maxWidth: 70,
        height: 28,
        borderRadius: 7,
        paddingHorizontal: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    busArrivalBadgeText: {
        color: "#FFFFFF",
        fontSize: 14,
        fontWeight: "900",
        lineHeight: 18,
    },
    itemDivider: {
        height: StyleSheet.hairlineWidth,
        marginTop: 12,
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
