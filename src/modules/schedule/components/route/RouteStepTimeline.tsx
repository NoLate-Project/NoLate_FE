import { isIntercityRideKind, isTransitRideKind, transitModeLabel } from "../../../map/transitModes";
import styles from "./RouteStepTimeline.styles";
import BusBookingAction from './BusBookingAction';
import TrainBookingAction from './TrainBookingAction';
import { RouteBusBoardingContext } from './RouteBusBoardingContext';
import { DottedWalkingRail } from './DottedWalkingRail';
import { routeColorForWhiteIcon, routeColorInk } from '../../routeColorContrast';
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Platform,
    Pressable,
    Text,
    UIManager,
    View,
    useWindowDimensions,
} from "react-native";
import Reanimated, { Easing, FadeIn, Keyframe, ReduceMotion } from "react-native-reanimated";

import {
    getBusArrivals,
    getSubwayArrivals,
    type TransitArrivalInfo,
} from "../../../../api/transitArrivals";
import { useTheme } from "../../../theme/ThemeContext";
import { useSystemReduceMotion } from "../../../performance/useSystemReduceMotion";
import {
    getRouteStepDirectionHint,
    getRouteStepColor,
    formatRouteDurationSeconds,
    isOdsayTimetableRouteInfo,
    roundRouteArrivalMinute,
    normalizeStopName,
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
    getTransferWalkDestination,
    hasPassedArrivalEstimate,
    Ionicons,
    buildStepDescription,
    StepIconGlyph,
    stripStopAction,
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

type ArrivalLookup = { step: RouteStep; request: ArrivalRequest };

async function loadArrivals(requests: ArrivalLookup[]) {
    return Promise.all(requests.map(async ({ step, request }) => {
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
            return [
                step.id,
                arrivals,
                arrivals.length > 0 ? "ready" : "empty",
                getArrivalUpdatedAt(arrivals, new Date().toISOString()),
            ] as const;
        } catch {
            return [step.id, [] as TransitArrivalInfo[], "error", undefined] as const;
        }
    }));
}

export default function RouteStepTimeline({
    routeInfo,
    selectedStepId,
    selectedPassStop,
    onStepPress,
    onRevealFirstStop,
    selectedStopRowRef,
    canShowPassStopOnMap,
    onPassStopPress,
    preserveStopDisclosureOnLegFocus = false,
    showLegFocus = false,
    allowEndpointPress = false,
    forceDark,
    primaryTextColor,
    secondaryTextColor,
    initialExpandedStepId,
    compact = false,
    inlineStationRail = false,
    busBoardingScroll,
    realtimeArrivalsEnabled = true,
    realtimeArrivalsActive = true,
    showEstimatedClockHeading = false,
    currentGuidance,
    currentGuidanceRowRef,
    stepDisplayNames,
}: Props) {
    const { fontScale } = useWindowDimensions();
    const stackTimelineText = compact && fontScale > 1.35;
    const reduceMotion = useSystemReduceMotion();
    const { colors, mode } = useTheme();
    const isDark = forceDark ?? mode === "dark";
    const primaryColor = primaryTextColor ?? colors.textPrimary;
    const secondaryColor = secondaryTextColor ?? colors.textSecondary;
    const neutralRailColor = isDark ? "#3A404A" : "#D1D5DB";
    const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(() => (
        initialExpandedStepId ? new Set([initialExpandedStepId]) : new Set()
    ));
    const requestedStopReveal = useRef<string | null>(null);
    const firstStopRow = useRef<View | null>(null);
    const boardingRows = useRef(new Map<string, View>());
    const [arrivalByStepId, setArrivalByStepId] = useState<Record<string, TransitArrivalInfo[]>>({});
    const [arrivalStateByStepId, setArrivalStateByStepId] = useState<Record<string, TransitArrivalLoadState>>({});
    const [arrivalUpdatedAtByStepId, setArrivalUpdatedAtByStepId] = useState<Record<string, string>>({});
    const arrivalLookupKey = useMemo(() => buildArrivalLookupKey(routeInfo.steps), [routeInfo.steps]);
    const arrivalCacheKey = useRef<string | undefined>(undefined);
    const pendingArrivals = useRef(new Map<string, ReturnType<typeof loadArrivals>>());
    const canShowCachedArrivals = compact && realtimeArrivalsEnabled && arrivalCacheKey.current === arrivalLookupKey;
    let runningOffsetSeconds = 0;
    let offsetKnown = true;
    const stepOffsets = routeInfo.steps.map((step) => {
        const start = offsetKnown ? runningOffsetSeconds : undefined;
        if (
            typeof step.durationSeconds === "number"
            && Number.isFinite(step.durationSeconds)
            && step.durationSeconds >= 0
        ) {
            runningOffsetSeconds += step.durationSeconds;
        } else if (typeof step.durationMinutes === "number" && Number.isFinite(step.durationMinutes) && step.durationMinutes >= 0) {
            runningOffsetSeconds += step.durationMinutes * 60;
        } else if (step.type !== "ORIGIN" && step.type !== "DESTINATION") {
            offsetKnown = false;
        }
        return { start, end: offsetKnown ? runningOffsetSeconds : undefined };
    });
    const usesOdsayTimetable = routeInfo.provider === "odsay" && routeInfo.timeBasis === "provider_schedule" &&
        routeInfo.providerTimeBasis === "timetable";
    const hasExactTimeline = routeInfo.matchedTimeline || usesOdsayTimetable;
    const scheduleSourceLabel = routeInfo.matchedTimeline ? "현재 보정 여정" : routeInfo.intercityJourney ? (routeInfo.intercityJourney.service.timingBasis === "TICKET" ? "승차권 입력 시각 · 앞뒤 이동 예상 · 예매 상태 미검증" : "선택 운행편 · 앞뒤 이동 예상 · 예매 미확인") : routeInfo.timeBasis === "provider_schedule"
        ? "운행 시간표"
        : "경로 예상 시간";
    const labelsEstimatedClocks = compact && showEstimatedClockHeading &&
        routeInfo.timeBasis === "estimated" && !routeInfo.matchedTimeline && !routeInfo.intercityJourney &&
        routeInfo.steps.length > 0 && Boolean(formatArrivalClock(routeInfo.departureTime, 0));
    const arrivalRequests = useMemo(() => routeInfo.steps
        .map((step) => ({ step, request: getArrivalRequest(step) }))
        .filter((item): item is ArrivalLookup => !!item.request),
    [routeInfo.steps]);
    const latestArrivalRequests = useRef(arrivalRequests);
    useEffect(() => {
        latestArrivalRequests.current = arrivalRequests;
    }, [arrivalRequests]);
    const firstArrivalRequest = arrivalRequests[0];
    const sharedArrivalState = firstArrivalRequest && arrivalStateByStepId[firstArrivalRequest.step.id];
    const showSharedArrivalNotice = labelsEstimatedClocks && canShowCachedArrivals &&
        (sharedArrivalState === "error" || sharedArrivalState === "empty") &&
        arrivalRequests.length > 1 && arrivalRequests.every(({ step }) => (
            arrivalStateByStepId[step.id] === sharedArrivalState &&
            !arrivalByStepId[step.id]?.length
        ));
    const estimatedClockHeading = showSharedArrivalNotice
        ? sharedArrivalState === "error" ? "구간별 예상 시각 · 실시간 도착 조회 실패" : "구간별 예상 시각 · 실시간 도착 정보 없음"
        : "구간별 예상 시각";

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

    const stepToDisclose = preserveStopDisclosureOnLegFocus ? selectedPassStop?.stepId : selectedStepId;
    useEffect(() => {
        if (!stepToDisclose) return;
        const selectedStep = routeInfo.steps.find((step) => step.id === stepToDisclose);
        if (!selectedStep || !Array.isArray(selectedStep.passStops) || selectedStep.passStops.length === 0) return;
        setExpandedStepIds((prev) => {
            if (prev.has(stepToDisclose)) return prev;
            const next = new Set(prev);
            next.add(stepToDisclose);
            return next;
        });
    }, [routeInfo.steps, stepToDisclose]);

    useEffect(() => {
        const requests = latestArrivalRequests.current;
        const canLoadArrivals = compact && realtimeArrivalsEnabled && requests.length > 0;
        const nextCacheKey = canLoadArrivals ? arrivalLookupKey : undefined;
        if (arrivalCacheKey.current !== nextCacheKey) {
            arrivalCacheKey.current = nextCacheKey;
            setArrivalByStepId({});
            setArrivalStateByStepId({});
            setArrivalUpdatedAtByStepId({});
        }
        if (!canLoadArrivals || !realtimeArrivalsActive) return;

        const pending = pendingArrivals.current;
        let cancelled = false;
        let refreshing = false;
        const refreshArrivals = async () => {
            if (refreshing) return;
            refreshing = true;
            setArrivalStateByStepId((prev) => {
                const next = { ...prev };
                requests.forEach(({ step }) => {
                    if (!next[step.id]) next[step.id] = "loading";
                });
                return next;
            });
            const response = pending.get(arrivalLookupKey) ?? loadArrivals(requests);
            pending.set(arrivalLookupKey, response);
            const entries = await response;
            if (pending.get(arrivalLookupKey) === response) pending.delete(arrivalLookupKey);

            refreshing = false;
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
            setArrivalUpdatedAtByStepId((prev) => {
                const next = { ...prev, ...nextUpdatedAt };
                entries.forEach(([stepId, , state]) => {
                    if (state === "empty") delete next[stepId];
                });
                return next;
            });
        };

        refreshArrivals();
        const timer = setInterval(refreshArrivals, 45 * 1000);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [arrivalLookupKey, compact, realtimeArrivalsActive, realtimeArrivalsEnabled]);

    const toggleStepDisclosure = (step: RouteStep, inlineStops = false) => {
        const opening = !expandedStepIds.has(step.id);
        requestedStopReveal.current = opening && onRevealFirstStop ? step.id : null;
        if (!reduceMotion) configureRouteStepDisclosureAnimation(opening, inlineStops);
        setExpandedStepIds((prev) => {
            const next = new Set(prev);
            if (next.has(step.id)) next.delete(step.id);
            else next.add(step.id);
            return next;
        });
    };

    let previousAlightingClock: string | undefined;
    return (
        <View key={fontScale} style={styles.root}>
            {labelsEstimatedClocks && (
                <Text
                    accessibilityRole="header"
                    lineBreakStrategyIOS="hangul-word"
                    style={[styles.estimatedClockHeading, { color: secondaryColor }]}
                >
                    {estimatedClockHeading}
                </Text>
            )}
            {routeInfo.intercityJourney?.service.timingBasis !== 'TICKET' && routeInfo.steps.some(step => step.type === 'TRAIN') && <TrainBookingAction dark={isDark} />}
            {routeInfo.intercityJourney?.service.timingBasis !== 'TICKET' && routeInfo.steps.filter(step => ['EXPRESS_BUS', 'INTERCITY_BUS', 'COACH'].includes(step.type)).slice(0, 1).map(step => <BusBookingAction key={step.id} kind={step.type} dark={isDark} />)}
            {routeInfo.steps.map((step, index) => {
                const isLast = index === routeInfo.steps.length - 1;
                const stepColor = getRouteStepColor(step);
                const selected = selectedStepId === step.id;
                const current = currentGuidance?.stepId === step.id && !['ORIGIN', 'DESTINATION'].includes(step.type);
                const isEndpointStep = step.type === "ORIGIN" || step.type === "DESTINATION";
                const stepPressEnabled = !!onStepPress && (allowEndpointPress || !isEndpointStep);
                const hasBadge = isTransitRideKind(step.type);
                const pointLabel = getPointLabel(step.type);
                const expandable = hasBadge && Array.isArray(step.passStops) && step.passStops.length > 0;
                const inlineStops = inlineStationRail && compact && expandable && (step.type === "SUBWAY" || step.type === "BUS");
                const expanded = expandedStepIds.has(step.id);
                const intercityRide = isIntercityRideKind(step.type);
                const modeLabel = transitModeLabel(step.type);
                const intercityLine = intercityRide
                    ? (step.lineName ?? step.badgeText)?.trim().replace(`${modeLabel} · `, "")
                    : undefined;
                const rideDescription = hasBadge ? [
                    intercityLine !== modeLabel && intercityLine !== stripStopAction(step.title) && intercityLine,
                    buildRideDescription(step),
                ].filter(Boolean).join(" · ") || undefined : undefined;
                const stopSummaryParts = [
                    typeof step.stationCount === "number" && `${step.stationCount}${step.type === "BUS" ? "개 정류장" : "정거장"}`,
                    typeof step.durationMinutes === "number" && `${step.durationMinutes}분`,
                ].filter(Boolean);
                const lastStopName = step.passStops?.at(-1)?.name;
                const alightingStop = compact && inlineStationRail && hasBadge && step.alightingName
                    ? normalizeStopName(step.alightingName)
                    : inlineStops && lastStopName && rideDescription?.split(" · ").includes(`${lastStopName}까지`)
                        ? lastStopName : undefined;
                const alightingName = alightingStop && (stripStopAction(alightingStop) || undefined);
                const isAlightingHint = (part: string) => alightingName && part.endsWith("까지")
                    && stripStopAction(part.slice(0, -2)) === alightingName;
                const boardingDescription = inlineStops || alightingStop
                    ? rideDescription?.split(" · ").filter(part =>
                        !isAlightingHint(part) &&
                        (!inlineStops || !/^\d+(?:개\s*)?\s*(?:정거장|정류장|분)$/u.test(part)),
                    ).join(" · ")
                    : rideDescription;
                const directionHint = hasBadge ? getRouteStepDirectionHint(step, rideDescription) : undefined;
                const rideDirectionLabel = directionHint && !isAlightingHint(directionHint) && !boardingDescription?.split(" · ").includes(directionHint)
                    ? directionHint : undefined;
                const boardingGuideItems = hasBadge ? buildBoardingGuideItems(step) : [];
                const arrivalRequest = realtimeArrivalsEnabled && hasBadge
                    ? getArrivalRequest(step)
                    : undefined;
                const arrivalNow = Date.now();
                const arrivals = hasBadge && canShowCachedArrivals ? arrivalByStepId[step.id] ?? [] : [];
                const realtimeArrivals = arrivals.filter(arrival =>
                    arrival.arrivalStatus !== "DEPARTED" && !hasPassedArrivalEstimate(arrival, arrivalNow));
                const allArrivalsPassed = arrivals.length > 0 && realtimeArrivals.length === 0;
                const arrivalState = hasBadge && canShowCachedArrivals ? arrivalStateByStepId[step.id] : undefined;
                const arrivalUpdatedAt = hasBadge && canShowCachedArrivals ? arrivalUpdatedAtByStepId[step.id] : undefined;
                const arrivalPresentation = getTransitArrivalPresentation({
                    hasRequest: !!arrivalRequest,
                    loadState: arrivalState,
                    arrivalCount: realtimeArrivals.length,
                    allEstimatesPassed: allArrivalsPassed,
                    updatedAt: arrivalUpdatedAt,
                    nowMs: arrivalNow,
                });
                const stepStartOffsetSeconds = stepOffsets[index].start;
                const scheduledArrivalClock = step.type === "DESTINATION" && !routeInfo.matchedTimeline && isOdsayTimetableRouteInfo(routeInfo)
                    ? roundRouteArrivalMinute(routeInfo.arrivalTime)?.toISOString() : routeInfo.arrivalTime;
                const exactClock = step.type === "ORIGIN" ? routeInfo.departureTime
                    : step.type === "DESTINATION" ? scheduledArrivalClock
                    : routeInfo.matchedTimeline ? step.matchedTimeline?.startAt : step.scheduledRide?.boardingAt;
                const timelineClockText = !compact ? undefined : hasExactTimeline
                    ? exactClock ? formatArrivalClock(exactClock, 0) : undefined
                    : stepStartOffsetSeconds === undefined ? undefined
                        : formatArrivalClock(routeInfo.departureTime, stepStartOffsetSeconds / 60);
                const endOffset = stepOffsets[index].end;
                const exactAlighting = routeInfo.matchedTimeline ? step.matchedTimeline?.endAt : step.scheduledRide?.arrivalAt;
                const transferWaitSeconds = routeInfo.matchedTimeline ? step.matchedTimeline?.transferWaitSeconds : undefined;
                const transferWaitLabel = typeof transferWaitSeconds === "number" &&
                    transferWaitSeconds > 0 && Number.isSafeInteger(transferWaitSeconds)
                    ? `환승 대기 예상 ${formatRouteDurationSeconds(transferWaitSeconds)}` : undefined;
                const alightingClock = !alightingName ? undefined : hasExactTimeline
                    ? exactAlighting && formatArrivalClock(exactAlighting, 0)
                    : endOffset === undefined ? undefined : formatArrivalClock(routeInfo.departureTime, endOffset / 60);
                const repeatsAlightingClock = (step.type === "WALK" || step.type === "TRANSFER") && previousAlightingClock !== undefined &&
                    timelineClockText === previousAlightingClock;
                previousAlightingClock = alightingClock;
                const usesScheduledClock = compact && !!timelineClockText
                    && !arrivalPresentation.showArrivalCard && !arrivalPresentation.showLoadingIcon;
                const scheduledClockBasis = `${scheduleSourceLabel} 기준`;
                const arrivalInlineMessage = usesScheduledClock
                    ? labelsEstimatedClocks
                        ? (arrivalRequest && !showSharedArrivalNotice ? arrivalPresentation.inlineMessage : undefined)
                        : arrivalRequest && (allArrivalsPassed || arrivalState === "error" || arrivalState === "empty")
                        ? `${arrivalPresentation.inlineMessage} ${scheduledClockBasis}이에요.`
                        : scheduledClockBasis
                    : getTransitArrivalInlineMessage(arrivalPresentation, timelineClockText, scheduleSourceLabel);
                const arrivalStatusLabel = getTransitArrivalStatusLabel(arrivalPresentation, timelineClockText);
                const arrivalWaitColor = arrivalPresentation.statusLabel === "갱신 지연"
                    ? secondaryColor
                    : isDark ? "#FF8C86" : "#B42318";
                const prioritizeStops = expanded && !inlineStops && stackTimelineText && Boolean(onRevealFirstStop);
                const transferDestination = compact ? getTransferWalkDestination(routeInfo.steps, index) : undefined;
                const walkingTransfer = compact && step.journeyPhase !== "BUFFER" &&
                    (Boolean(transferDestination) || step.type === "TRANSFER");
                const alightingIntoTransfer = !!alightingName &&
                    !!getTransferWalkDestination(routeInfo.steps, index + 1);
                const stepTitle = buildStepTitle(step, transferDestination ? "환승 도보" : undefined);
                const lineBadgeText = intercityRide ? modeLabel : step.badgeText ?? step.lineName ?? modeLabel;
                const showsLineBadge = hasBadge && (!compact || stepTitle !== lineBadgeText);
                const fullStepName = stepDisplayNames?.[step.id];
                const bareLineName = step.type === "SUBWAY" ? fullStepName?.replace(/^수도권\s*/u, "") : fullStepName;
                const repeatsLineName = hasBadge && bareLineName?.replace(/\s+/gu, "") === lineBadgeText.replace(/\s+/gu, "");
                const showsFullStepName = !!fullStepName && (fontScale > 1.35 || !repeatsLineName);
                const stepDescription = transferDestination ?? buildStepDescription(step, stepTitle);
                const firstStopIsBoarding = prioritizeStops && step.passStops?.[0]?.name.trim() === stepTitle.trim();
                const combineClockAndLine = stackTimelineText && showsLineBadge && !!timelineClockText;
                const shouldShowTimelineClock = !!timelineClockText && !repeatsAlightingClock && (
                    step.type !== "WALK" ||
                    (index > 1 && !isLast)
                );
                const stationArrivalLabel = shouldShowTimelineClock && routeInfo.matchedTimeline &&
                    step.matchedTimeline?.startsWithStationArrivalPrediction ? "열차 도착 예측" : undefined;
                const clockAccessibilityLabel = shouldShowTimelineClock
                    ? stationArrivalLabel ? `${timelineClockText} ${stationArrivalLabel}`
                        : labelsEstimatedClocks ? `예상 ${timelineClockText}` : timelineClockText
                    : undefined;
                const isWalkStep = step.type === "WALK";
                const isPointStep = step.type === "ORIGIN" || step.type === "DESTINATION";
                const isTransitStep = isTransitRideKind(step.type);
                const isColoredMovementStep = isTransitStep || step.type === "DRIVE" || step.type === "BIKE";
                const transitBadgeColor = compact && isTransitStep ? routeColorForWhiteIcon(stepColor) : stepColor;
                const iconBackgroundColor = compact
                    ? (isColoredMovementStep ? transitBadgeColor : isDark ? "#1C2028" : "#F8FAFC")
                    : (isDark ? "#15181E" : "#F8FAFC");
                const iconBorderColor = isPointStep || isWalkStep
                    ? (isDark ? "rgba(255,255,255,0.18)" : "#E5E7EB")
                    : transitBadgeColor;
                const iconColor = isPointStep
                    ? stepColor
                    : compact && isTransitStep
                        ? "#FFFFFF"
                    : compact && isColoredMovementStep
                        ? routeColorInk(transitBadgeColor)
                        : isDark
                        ? "#F5F7FA"
                        : isTransitStep
                            ? stepColor
                            : "#374151";
                const clockBadge = shouldShowTimelineClock ? (
                    <View style={[
                        styles.timelineClockBadge,
                        stackTimelineText && styles.timelineClockBadgeExpanded,
                        combineClockAndLine && styles.timelineClockBadgeInline,
                        { backgroundColor: isDark ? "#22252C" : "#F8FAFC", borderColor: isDark ? "rgba(255,255,255,0.16)" : "#D1D5DB" },
                    ]}>
                        <Text
                            numberOfLines={1}
                            maxFontSizeMultiplier={stackTimelineText ? undefined : 1.3}
                            style={[styles.timelineClockText, { color: isDark ? "#D7D7DA" : "#374151" }]}
                        >
                            {timelineClockText}
                        </Text>
                    </View>
                ) : null;
                const lineBadge = showsLineBadge ? (
                    <View style={[styles.badge, compact && styles.badgeCompact, intercityRide && styles.badgeIntercity, stackTimelineText && styles.badgeExpanded, { backgroundColor: transitBadgeColor }]}>
                        <Text numberOfLines={stackTimelineText ? undefined : 1} maxFontSizeMultiplier={1.5} style={[styles.badgeText, compact && styles.badgeTextCompact, { color: routeColorInk(transitBadgeColor) }]}>
                            {lineBadgeText}
                        </Text>
                    </View>
                ) : null;
                const disclosureLabel = `${stepDisplayNames?.[step.id] ?? step.badgeText ?? step.lineName ?? transitModeLabel(step.type)} 경유지 ${expanded ? "접기" : "보기"}`;
                const stops = step.passStops ?? [];
                const isStopSelected = (stopIndex: number) =>
                    selectedPassStop?.stepId === step.id && selectedPassStop.stopIndex === stopIndex;
                const canMapStop = (stopIndex: number) =>
                    Boolean(onPassStopPress && canShowPassStopOnMap?.(step.id, stopIndex));
                const repeatsEndpoint = (stop: typeof stops[number], stopIndex: number) =>
                    (stopIndex === 0 && normalizeStopName(stop.name) === normalizeStopName(stepTitle)) ||
                    (stopIndex === stops.length - 1 && stripStopAction(normalizeStopName(stop.name) ?? stop.name) === alightingName);
                const showsStop = (stop: typeof stops[number], stopIndex: number) => !inlineStops ||
                    canMapStop(stopIndex) || isStopSelected(stopIndex) || !repeatsEndpoint(stop, stopIndex);
                const firstVisibleStopIndex = (expanded || inlineStops) ? stops.findIndex(showsStop) : -1;
                const knownIntermediateStops = inlineStops && typeof step.stationCount !== "number"
                    ? stops.filter((stop, index) => !repeatsEndpoint(stop, index)).length : 0;
                const stopSummary = [
                    knownIntermediateStops > 0 && `${step.type === "BUS" ? "경유 정류장" : "경유역"} ${knownIntermediateStops}곳`,
                    ...stopSummaryParts,
                ].filter(Boolean).join(" · ") || "경유지";
                const StopList = inlineStops ? Reanimated.View : View;
                const stopList = expanded && firstVisibleStopIndex !== -1 && (
                    <StopList
                        entering={inlineStops && !reduceMotion ? inlineStopsEntrance : undefined}
                        style={inlineStops ? styles.inlineStopList : [styles.stopList, { borderColor: isDark ? "rgba(255,255,255,0.10)" : "#E5E7EB" }]}
                    >
                        {stops.map((stop, stopIndex) => {
                            if (!showsStop(stop, stopIndex)) return null;
                            const first = stopIndex === 0;
                            const last = stopIndex === stops.length - 1;
                            const firstVisible = stopIndex === firstVisibleStopIndex;
                            const stopSelected = isStopSelected(stopIndex);
                            const mapAction = canMapStop(stopIndex);
                            const StopRow = mapAction ? Pressable : View;
                            return (
                                <StopRow
                                    key={`${step.id}-${stop.name}-${stopIndex}`}
                                    ref={firstVisible && requestedStopReveal.current === step.id ? firstStopRow
                                        : stopSelected ? selectedStopRowRef : undefined}
                                    testID={stopSelected ? `route-step-selected-stop-${step.id}`
                                        : mapAction ? `route-step-map-stop-${step.id}-${stopIndex}`
                                        : firstVisible && onRevealFirstStop ? `route-step-first-stop-${step.id}` : undefined}
                                    accessible={mapAction || stopSelected || undefined}
                                    accessibilityRole={mapAction ? "button" : undefined}
                                    accessibilityHint={mapAction ? "지도에서 이 정류장을 표시합니다" : undefined}
                                    accessibilityLabel={mapAction || stopSelected ? stop.name : undefined}
                                    accessibilityState={mapAction || stopSelected ? { selected: stopSelected } : undefined}
                                    onPress={mapAction ? () => onPassStopPress?.(step.id, stopIndex) : undefined}
                                    collapsable={stopSelected || (firstVisible && requestedStopReveal.current === step.id) ? false : undefined}
                                    onLayout={firstVisible && requestedStopReveal.current === step.id ? () => {
                                        if (requestedStopReveal.current !== step.id || !firstStopRow.current) return;
                                        requestedStopReveal.current = null;
                                        onRevealFirstStop?.(firstStopRow.current, !reduceMotion, boardingRows.current.get(step.id));
                                    } : undefined}
                                    style={[styles.stopRow, inlineStops && styles.inlineStopRow, mapAction && styles.stopRowMapAction]}
                                >
                                    {stopSelected && (
                                        <View
                                            pointerEvents="none"
                                            style={[styles.stopSelectionSurface, {
                                                backgroundColor: stepColor,
                                                opacity: isDark ? 0.22 : 0.12,
                                            }]}
                                        />
                                    )}
                                    <View pointerEvents="none" style={inlineStops ? styles.inlineStopRail : styles.stopRail}>
                                        <View
                                            style={[
                                                styles.stopDot,
                                                {
                                                    borderColor: inlineStops || first || last || stopSelected ? stepColor : secondaryColor,
                                                    backgroundColor: first || last || stopSelected
                                                        ? stepColor : inlineStops ? (isDark ? "#181D25" : "#F6F8FA") : "transparent",
                                                },
                                                inlineStops && styles.inlineStopDot,
                                            ]}
                                        />
                                        {!inlineStops && stopIndex < step.passStops!.length - 1 && (
                                            <View style={[styles.stopLine, { backgroundColor: stepColor }]} />
                                        )}
                                    </View>
                                    <Text
                                        numberOfLines={stackTimelineText ? undefined : 1}
                                        lineBreakStrategyIOS="hangul-word"
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
                                    {mapAction && (
                                        <Reanimated.View
                                            key={stopSelected ? "selected-pin" : "pin"}
                                            pointerEvents="none"
                                            entering={stopSelected && !reduceMotion ? stopPinEntrance : undefined}
                                            style={[
                                                styles.stopMapIcon,
                                                stopSelected && { backgroundColor: transitBadgeColor },
                                            ]}
                                        >
                                            <Ionicons name="location-outline" size={16} color={stopSelected ? "#FFFFFF" : secondaryColor} />
                                        </Reanimated.View>
                                    )}
                                </StopRow>
                            );
                        })}
                    </StopList>
                );
                const TitleRow = inlineStops && stepPressEnabled ? Pressable : View;
                const content = (
                    <>
                        <View style={[styles.rail, compact && styles.railCompact]}>
                            {!walkingTransfer && <View
                                style={[
                                    styles.dot,
                                    compact && styles.dotCompact,
                                    {
                                        backgroundColor: iconBackgroundColor,
                                        borderColor: iconBorderColor,
                                    },
                                ]}
                            >
                                <StepIconGlyph
                                    type={step.type}
                                    isWaiting={step.journeyPhase === "BUFFER"}
                                    color={iconColor}
                                    compact={compact}
                                />
                            </View>}
                            {!stackTimelineText && clockBadge}
                            {!isLast && (
                                <View
                                    style={[
                                        styles.line,
                                        compact && styles.lineCompact,
                                        {
                                            backgroundColor: walkingTransfer ? "transparent" :
                                                step.type === "WALK" || step.type === "ORIGIN" || step.type === "DESTINATION"
                                                ? neutralRailColor
                                                : stepColor,
                                        },
                                    ]}
                                >
                                    {walkingTransfer && <DottedWalkingRail color={neutralRailColor} />}
                                </View>
                            )}
                        </View>
                        <View style={[styles.body, compact && styles.bodyCompact]}>
                            {combineClockAndLine ? (
                                <View testID={`route-step-boarding-heading-${step.id}`} style={[styles.boardingHeading, expandable && !inlineStops && styles.boardingHeadingWithDisclosure]}>
                                    {clockBadge}
                                    {lineBadge}
                                </View>
                            ) : stackTimelineText && clockBadge}
                            {!firstStopIsBoarding && <TitleRow
                                testID={inlineStops ? `route-step-row-${step.id}` : undefined}
                                accessibilityRole={inlineStops && stepPressEnabled ? "button" : undefined}
                                accessibilityHint={inlineStops && stepPressEnabled ? "지도에서 이 지점을 표시합니다" : undefined}
                                accessibilityState={inlineStops && stepPressEnabled ? { selected } : undefined}
                                accessibilityLabel={inlineStops && stepPressEnabled
                                    ? [step.badgeText ?? step.lineName, stepTitle, stationArrivalLabel ? undefined : "승차", clockAccessibilityLabel,
                                        hasExactTimeline && alightingClock ? `${alightingClock} 예상 하차` : undefined,
                                        current ? "현재 구간" : undefined].filter(Boolean).join(" ")
                                    : undefined}
                                onPress={inlineStops && stepPressEnabled ? () => onStepPress?.(step) : undefined}
                                style={[
                                    styles.titleRow,
                                    compact && styles.titleRowCompact,
                                    stackTimelineText && styles.titleRowExpanded,
                                    expandable && !inlineStops && (!stackTimelineText || !clockBadge) && styles.titleRowWithDisclosure,
                                ]}
                            >
                                {!!pointLabel && (
                                    <View style={[styles.pointBadge, compact && styles.pointBadgeCompact, { backgroundColor: stepColor }]}>
                                        <Text style={[styles.pointBadgeText, compact && styles.pointBadgeTextCompact, { color: routeColorInk(stepColor) }]}>{pointLabel}</Text>
                                    </View>
                                )}
                                {!combineClockAndLine && lineBadge}
                                <Text
                                    numberOfLines={stackTimelineText ? undefined : 2}
                                    lineBreakStrategyIOS="hangul-word"
                                style={[
                                    styles.title,
                                    compact && styles.titleCompact,
                                    stackTimelineText && styles.titleExpanded,
                                    { color: primaryColor },
                                ]}
                            >
                                    {stepTitle}
                                    {compact && hasBadge && (
                                        <Text style={[styles.titleSuffix, { color: secondaryColor }]}> 승차</Text>
                                    )}
                                </Text>
                            </TitleRow>}
                            {showsFullStepName && <Text testID={`route-step-full-name-${step.id}`}
                                style={[styles.description, { color: primaryColor }]}>{fullStepName}</Text>}
                            {hasBadge && !compact && (
                                <Text
                                    numberOfLines={intercityRide ? undefined : 1}
                                    lineBreakStrategyIOS="hangul-word"
                                    style={[styles.description, { color: secondaryColor }]}
                                >
                                    {rideDescription}
                                </Text>
                            )}
                            {prioritizeStops && stopList}
                            {compact && hasBadge && (
                                <>
                                    <View style={[styles.rideInfoRow, stackTimelineText && styles.rideInfoRowExpanded]}>
                                        <View style={[styles.rideInfoTextStack, stackTimelineText && styles.rideInfoTextStackExpanded]}>
                                            {!!stationArrivalLabel && (
                                                <Text style={[styles.rideAssistText, { color: secondaryColor }]}>{stationArrivalLabel}</Text>
                                            )}
                                            {!!boardingDescription && (
                                                <Text numberOfLines={stackTimelineText || intercityRide ? undefined : 1} lineBreakStrategyIOS="hangul-word" style={[styles.description, styles.descriptionCompact, { color: secondaryColor }]}>
                                                    {boardingDescription}
                                                </Text>
                                            )}
                                            {!!rideDirectionLabel && (
                                                <Text numberOfLines={stackTimelineText ? undefined : 1} lineBreakStrategyIOS="hangul-word" style={[styles.rideAssistText, { color: secondaryColor }]}>
                                                    {rideDirectionLabel}
                                                </Text>
                                            )}
                                            {!!transferWaitLabel && (
                                                <Text style={[styles.rideAssistText, { color: secondaryColor }]}>
                                                    {transferWaitLabel}
                                                </Text>
                                            )}
                                        </View>
                                        {!usesScheduledClock && <View style={[styles.rideActionStack, stackTimelineText && styles.rideActionStackExpanded]}>
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
                                        </View>}
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
                                                        numberOfLines={stackTimelineText ? undefined : 1}
                                                        lineBreakStrategyIOS="hangul-word"
                                                        style={[styles.boardingGuideText, { color: primaryColor }]}
                                                    >
                                                        {item.label}
                                                    </Text>
                                                </View>
                                            ))}
                                        </View>
                                    )}
                                    {arrivalPresentation.showArrivalCard ? (
                                        <Reanimated.View
                                            entering={arrivalCardEntrance}
                                            style={[styles.arrivalCard, { borderColor: isDark ? "rgba(255,255,255,0.16)" : "#D1D5DB" }]}
                                        >
                                        {step.type === "BUS" ? (
                                            <>
                                                {realtimeArrivals.slice(0, 2).map((arrival, arrivalIndex) => {
                                                    const attributeLabels = getTransitArrivalAttributeLabels(arrival);
                                                    return (
                                                        <View key={`${step.id}-bus-arrival-${arrivalIndex}`} style={[styles.busArrivalRow, stackTimelineText && styles.arrivalRowExpanded]}>
                                                            <Text style={[styles.arrivalWaitText, { color: arrivalWaitColor }]}>
                                                                {getArrivalWaitText(arrival, arrivalNow)}
                                                            </Text>
                                                            <Text numberOfLines={stackTimelineText ? undefined : 1} lineBreakStrategyIOS="hangul-word" style={[styles.arrivalMutedText, stackTimelineText && styles.arrivalDirectionExpanded, { color: secondaryColor }]}>
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
                                                const arrivalClock = getArrivalClockText(arrival);
                                                return (
                                                    <View key={`${step.id}-arrival-${arrivalIndex}`} style={[styles.trainArrivalRow, stackTimelineText && styles.arrivalRowExpanded]}>
                                                        {arrivalClock && (
                                                            <Text style={[styles.arrivalClockText, { color: primaryColor }]}>
                                                                {arrivalClock}
                                                            </Text>
                                                        )}
                                                        <Text style={[styles.arrivalWaitText, { color: arrivalWaitColor }]}>
                                                            {getArrivalWaitText(arrival, arrivalNow)}
                                                        </Text>
                                                        <Text numberOfLines={stackTimelineText ? undefined : 1} lineBreakStrategyIOS="hangul-word" style={[styles.arrivalMutedText, stackTimelineText && styles.arrivalDirectionExpanded, { color: secondaryColor }]}>
                                                            {getArrivalDirectionText(arrival, directionHint?.replace(/\s*방면$/u, "행"))}
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
                                        </Reanimated.View>
                                    ) : arrivalInlineMessage ? (
                                        <View style={styles.arrivalInlineRow}>
                                            <Ionicons
                                                name={arrivalPresentation.showLoadingIcon ? "sync-outline" : "information-circle-outline"}
                                                size={15}
                                                color={secondaryColor}
                                            />
                                            <Text lineBreakStrategyIOS="hangul-word" style={[styles.arrivalInlineText, { color: secondaryColor }]}>
                                                {arrivalInlineMessage}
                                            </Text>
                                        </View>
                                    ) : null}
                                </>
                            )}
                            {!hasBadge && stepDescription && (
                                <Text numberOfLines={stackTimelineText ? undefined : 2} lineBreakStrategyIOS="hangul-word" style={[styles.description, compact && styles.descriptionCompact, { color: secondaryColor }]}>
                                    {stepDescription}
                                </Text>
                            )}
                            {inlineStops && firstVisibleStopIndex !== -1 && (
                                <Pressable
                                    testID={`route-step-disclosure-${step.id}`}
                                    accessibilityRole="button"
                                    accessibilityLabel={`${disclosureLabel}, ${stopSummary}`}
                                    accessibilityState={{ expanded }}
                                    onPress={() => toggleStepDisclosure(step, true)}
                                    style={({ pressed }) => [styles.inlineDisclosure, {
                                        borderTopColor: isDark ? "#353D49" : "#E5E7EB",
                                        opacity: pressed ? 0.64 : 1,
                                    }]}
                                >
                                    <Text style={[styles.inlineDisclosureText, { color: primaryColor }]}>{stopSummary}</Text>
                                    <DisclosureChevron expanded={expanded} reduceMotion={reduceMotion} size={16} color={secondaryColor} />
                                </Pressable>
                            )}
                            {inlineStops && firstVisibleStopIndex === -1 && stopSummaryParts.length > 0 && (
                                <Text style={[styles.description, styles.descriptionCompact, { color: secondaryColor }]}>{stopSummary}</Text>
                            )}
                            {!prioritizeStops && stopList}
                            {alightingName && (
                                <View style={[styles.inlineAlighting, alightingClock && styles.inlineAlightingTimed]}>
                                    {!isLast && (
                                        <View
                                            testID={`route-step-alighting-connector-${step.id}`}
                                            pointerEvents="none"
                                            style={[
                                                styles.inlineAlightingConnector,
                                                alightingClock && !stackTimelineText && styles.inlineAlightingConnectorTimed,
                                                { backgroundColor: alightingIntoTransfer
                                                    ? isDark ? "#181D25" : "#F6F8FA"
                                                    : neutralRailColor },
                                            ]}
                                        >
                                            {alightingIntoTransfer && <DottedWalkingRail color={neutralRailColor} />}
                                        </View>
                                    )}
                                    <View pointerEvents="none" style={[styles.inlineStopRail, alightingClock && !stackTimelineText && styles.inlineAlightingRail]}>
                                        <View testID={`route-step-alighting-marker-${step.id}`}
                                            style={[styles.inlineAlightingMarker, { backgroundColor: isDark ? "#2B3748" : "#E6EDF6", borderColor: isDark ? "#181D25" : "#F6F8FA" }]}>
                                            <Ionicons accessible={false} name={alightingIntoTransfer ? "walk-outline" : "checkmark-outline"} size={14} color={isDark ? "#F5F7FA" : "#334155"} />
                                        </View>
                                    </View>
                                    <Text style={[styles.inlineDisclosureText, { color: primaryColor }]}>{`${alightingName} 하차`}</Text>
                                    {alightingClock && (
                                        <View style={[
                                            styles.timelineClockBadge,
                                            stackTimelineText ? styles.timelineClockBadgeExpanded : styles.inlineAlightingClock,
                                            { backgroundColor: isDark ? "#22252C" : "#F8FAFC", borderColor: isDark ? "rgba(255,255,255,0.16)" : "#D1D5DB" },
                                        ]}>
                                            <Text
                                                testID={`route-step-alighting-clock-${step.id}`}
                                                accessibilityLabel={`${routeInfo.timeBasis === "provider_schedule" ? "시간표" : "예상"} 하차 ${alightingClock}`}
                                                maxFontSizeMultiplier={stackTimelineText ? undefined : 1.3}
                                                style={[styles.timelineClockText, { color: isDark ? "#D7D7DA" : "#374151" }]}
                                            >
                                                {alightingClock}
                                            </Text>
                                        </View>
                                    )}
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
                    ? [pointLabel, stepTitle, clockAccessibilityLabel].filter(Boolean).join(", ")
                    : [
                        isTransitRideKind(step.type) ? transitModeLabel(step.type) : undefined,
                        isTransitStep ? stepDisplayNames?.[step.id] ?? step.badgeText ?? step.lineName : undefined,
                        stepTitle,
                        hasBadge ? rideDescription : stepDescription,
                        clockAccessibilityLabel,
                        hasExactTimeline && alightingClock ? `${alightingClock} 예상 하차` : undefined,
                        compact ? transferWaitLabel : undefined,
                        compact && hasBadge && !arrivalPresentation.showArrivalCard ? arrivalInlineMessage : undefined,
                        arrivalPresentation.showArrivalCard ? arrivalStatusLabel : undefined,
                        arrivalPresentation.showArrivalCard ? arrivalPresentation.freshnessLabel : undefined,
                        ...(arrivalPresentation.showArrivalCard
                            ? realtimeArrivals.slice(0, step.type === "BUS" ? 2 : 3).map(arrival => [
                                getArrivalWaitText(arrival, arrivalNow),
                                getArrivalDirectionText(arrival),
                                ...getTransitArrivalAttributeLabels(arrival),
                            ].filter(Boolean).join(" · "))
                            : []),
                    ].filter(Boolean).join(", ");

                return (
                    <View
                        key={step.id}
                        ref={current || (expandable && onRevealFirstStop) ? node => {
                            if (current && currentGuidanceRowRef) currentGuidanceRowRef.current = node;
                            if (expandable && onRevealFirstStop) {
                                if (node) boardingRows.current.set(step.id, node);
                                else boardingRows.current.delete(step.id);
                            }
                        } : undefined}
                        collapsable={current || (expandable && onRevealFirstStop) ? false : undefined}
                        style={[
                            styles.item,
                            compact && styles.itemCompact,
                            selectedStyle,
                        ]}
                    >
                        {current && (
                            <View
                                testID={`journey-current-step-${step.id}`}
                                pointerEvents="none"
                                accessibilityElementsHidden
                                importantForAccessibility="no-hide-descendants"
                                style={[styles.guidanceCurrentRow, {
                                    borderLeftColor: isDark ? '#75A9F2' : '#2979FF',
                                    backgroundColor: isDark ? 'rgba(117,169,242,0.16)' : 'rgba(41,121,255,0.10)',
                                }]}
                            />
                        )}
                        {showLegFocus && selected && !current && (
                            <Reanimated.View
                                pointerEvents="none"
                                entering={legFocusEntrance}
                                style={[styles.legFocusSurface, {
                                    backgroundColor: isDark ? "rgba(117,169,242,0.12)" : "rgba(41,121,255,0.08)",
                                }]}
                            />
                        )}
                        {inlineStops ? <View style={styles.itemPressTarget}>{content}</View> : <Pressable
                            testID={`route-step-row-${step.id}`}
                            accessible
                            disabled={!stepPressEnabled}
                            accessibilityRole={stepPressEnabled ? "button" : undefined}
                            accessibilityLabel={[stepAccessibilityLabel, current ? '현재 구간' : null].filter(Boolean).join(', ')}
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
                        </Pressable>}
                        {busBoardingScroll && !stackTimelineText && inlineStops && expanded && step.type === "BUS" && firstVisibleStopIndex >= 0 && (
                            <RouteBusBoardingContext scroll={busBoardingScroll} getRow={() => boardingRows.current.get(step.id)}
                                line={step.badgeText ?? step.lineName ?? "버스"} clock={timelineClockText} stop={stepTitle}
                                color={stepColor} textColor={primaryColor} surface={busBoardingScroll.surface} border={busBoardingScroll.border} />
                        )}
                        {expandable && !inlineStops && (
                            <Pressable
                                testID={`route-step-disclosure-${step.id}`}
                                accessibilityRole="button"
                                accessibilityLabel={disclosureLabel}
                                accessibilityState={{ expanded }}
                                accessibilityHint="현재 시트를 유지한 채 경유지 목록만 열거나 닫습니다"
                                onPress={() => toggleStepDisclosure(step)}
                                style={({ pressed }) => [
                                    styles.disclosureButton,
                                    compact
                                        ? styles.disclosureButtonCompact
                                        : styles.disclosureButtonRegular,
                                    { opacity: pressed ? 0.64 : 1 },
                                ]}
                            >
                                <View pointerEvents="none" style={[
                                    styles.disclosureSurface,
                                    compact && styles.disclosureSurfaceLabelled,
                                    { backgroundColor: expanded
                                        ? (isDark ? "#24374F" : "#E8F0FF")
                                        : (isDark ? "#292F39" : "#EBEFF4") },
                                ]}>
                                    {compact && (
                                        <Text
                                            accessible={false}
                                            maxFontSizeMultiplier={1.4}
                                            style={[styles.disclosureLabel, { color: primaryColor }]}
                                        >
                                            경유지
                                        </Text>
                                    )}
                                    <DisclosureChevron
                                        expanded={expanded}
                                        reduceMotion={reduceMotion}
                                        size={14}
                                        color={expanded ? primaryColor : secondaryColor}
                                    />
                                </View>
                            </Pressable>
                        )}
                    </View>
                );
            })}
        </View>
    );
}

const legFocusEntrance = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const arrivalCardEntrance = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const inlineStopsEntrance = new Keyframe({
    0: { opacity: 0.55, transform: [{ translateY: -4 }] },
    100: { opacity: 1, transform: [{ translateY: 0 }], easing: Easing.out(Easing.cubic) },
}).duration(160).reduceMotion(ReduceMotion.System);
const stopPinEntrance = new Keyframe({
    0: { transform: [{ perspective: 160 }, { translateY: -3 }, { rotateX: "22deg" }, { scale: 0.94 }] },
    100: {
        transform: [{ perspective: 160 }, { translateY: 0 }, { rotateX: "0deg" }, { scale: 1 }],
        easing: Easing.out(Easing.cubic),
    },
}).duration(160).reduceMotion(ReduceMotion.System);
