import styles from "./RouteStepTimeline.styles";
import React, { useEffect, useMemo, useState } from "react";
import {
    Platform,
    Pressable,
    Text,
    UIManager,
    View,
} from "react-native";

import {
    getBusArrivals,
    getSubwayArrivals,
    type TransitArrivalInfo,
} from "../../../../api/transitArrivals";
import { useTheme } from "../../../theme/ThemeContext";
import {
    getRouteStepDirectionHint,
    getRouteStepColor,
    type RouteStep,
} from "../../routeInfo";
import {
    buildArrivalLookupKey,
    buildBoardingGuideItems,
    buildRideDescription,
    buildStepTitle,
    configureRouteStepDisclosureAnimation,
    DisclosureChevron,
    formatArrivalClock,
    getArrivalClockText,
    getArrivalDirectionText,
    getArrivalRequest,
    getArrivalUpdatedAt,
    getArrivalWaitText,
    getPointLabel,
    Ionicons,
    shouldShowDescription,
    StepIconGlyph,
    type ArrivalRequest,
    type RouteStepTimelineProps as Props,
} from "./RouteStepTimeline.helpers";
import {
    getTransitArrivalAttributeLabels,
    getTransitArrivalInlineMessage,
    getTransitArrivalPresentation,
    getTransitArrivalStatusLabel,
    type TransitArrivalLoadState,
} from "./transitArrivalPresentation";


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
    realtimeArrivalsEnabled = true,
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
        ? "운행 시간표"
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
        if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
            UIManager.setLayoutAnimationEnabledExperimental(true);
        }
    }, []);

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
        if (!compact || !realtimeArrivalsEnabled) {
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
    }, [arrivalLookupKey, compact, realtimeArrivalsEnabled, routeInfo.steps]);

    const toggleStepDisclosure = (step: RouteStep) => {
        configureRouteStepDisclosureAnimation(!expandedStepIds.has(step.id));
        setExpandedStepIds((prev) => {
            const next = new Set(prev);
            if (next.has(step.id)) next.delete(step.id);
            else next.add(step.id);
            return next;
        });
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
                const arrivalRequest = realtimeArrivalsEnabled && hasBadge
                    ? getArrivalRequest(step)
                    : undefined;
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
                            <View
                                style={[
                                    styles.titleRow,
                                    compact && styles.titleRowCompact,
                                    expandable && styles.titleRowWithDisclosure,
                                ]}
                            >
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
                    <View
                        key={step.id}
                        style={[
                            styles.item,
                            compact && styles.itemCompact,
                            selectedStyle,
                        ]}
                    >
                        <Pressable
                            testID={`route-step-row-${step.id}`}
                            disabled={!stepPressEnabled}
                            accessibilityRole={stepPressEnabled ? "button" : undefined}
                            accessibilityLabel={stepPressEnabled ? stepAccessibilityLabel : undefined}
                            accessibilityState={stepPressEnabled ? {
                                selected,
                            } : undefined}
                            accessibilityHint={stepPressEnabled
                                ? "지도에서 이 지점을 표시합니다"
                                : undefined}
                            onPress={() => onStepPress?.(step)}
                            style={styles.itemPressTarget}
                        >
                            {content}
                        </Pressable>
                        {expandable && (
                            <Pressable
                                testID={`route-step-disclosure-${step.id}`}
                                accessibilityRole="button"
                                accessibilityLabel={`${step.badgeText ?? step.lineName ?? (step.type === "BUS" ? "버스" : "지하철")} 경유지 ${expanded ? "접기" : "보기"}`}
                                accessibilityState={{ expanded }}
                                accessibilityHint="현재 시트를 유지한 채 경유지 목록만 열거나 닫습니다"
                                hitSlop={10}
                                onPress={() => toggleStepDisclosure(step)}
                                style={({ pressed }) => [
                                    styles.disclosureButton,
                                    compact
                                        ? styles.disclosureButtonCompact
                                        : styles.disclosureButtonRegular,
                                    { opacity: pressed ? 0.5 : 1 },
                                ]}
                            >
                                <DisclosureChevron
                                    expanded={expanded}
                                    size={compact ? 14 : 16}
                                    color={secondaryColor}
                                />
                            </Pressable>
                        )}
                    </View>
                );
            })}
        </View>
    );
}
