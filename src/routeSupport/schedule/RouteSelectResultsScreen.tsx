import React from "react";
import {
    AccessibilityInfo,
    Animated,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
} from "react-native";

import RouteEndpointReselectCard from "../../modules/schedule/components/route/RouteEndpointReselectCard";
import TransitRouteProgressBar from "../../modules/schedule/components/route/TransitRouteProgressBar";
import { DottedWalkingRail } from "../../modules/schedule/components/route/DottedWalkingRail";
import { DisclosureChevron } from "../../modules/schedule/components/route/RouteStepTimeline.helpers";
import IntercityTimetableSheet from "../../modules/schedule/components/route/IntercityTimetableSheet";
import BusBookingAction from "../../modules/schedule/components/route/BusBookingAction";
import TrainBookingAction from "../../modules/schedule/components/route/TrainBookingAction";
import { isIntercityBusKind, isIntercityRideKind, isTransitRideKind, transitModeLabel } from "../../modules/map/transitModes";
import { getTransitRouteSummaryAccessibilityLabel } from "../../modules/schedule/transitRouteProgress";
import type { TransitLegDetail, RouteAlternativeOption } from "../../modules/map/tmapApiCore";
import { TRAVEL_MODE_META } from "../../modules/schedule/travelMode";
import { routeColorForWhiteIcon } from "../../modules/schedule/routeColorContrast";
import { shouldShowRequiredMapAttribution } from "../../modules/map/routingService";
import {
    buildRouteInfoFromAlternative,
    formatRouteDuration as formatRouteInfoDuration,
} from "../../modules/schedule/routeInfo";
import { getNaverLikeRouteRecommendationLabel } from "../../modules/schedule/routeAlternativeRanking";
import BrandedLoader from "../../ui/BrandedLoader";
import styles from "./route-select.styles";
import {
    AnimatedRouteExpansion,
    AnimatedTransitFilterButton,
    AnimatedTravelModeButton,
    Ionicons,
    SELECTABLE_TRAVEL_MODES,
    TRANSIT_FILTER_ITEMS,
    TRAVEL_MODE_ICONS,
    configureRouteExpansionAnimation,
    type RouteDropdownSummaryKind,
} from "./RouteSelectAnimatedControls";
import {
    buildRouteBoardingSummary,
    buildRouteDropdownSummaryItems,
    buildRouteMetricChips,
    buildRouteProgressSegments,
    formatCurrentRouteNoticeTime,
    formatRouteTimeFare,
    formatScheduleRouteNoticeTime,
    sharesTransitDurationEstimate,
} from "./routeSelectRouteModel";
import type { RouteSelectController } from "./useRouteSelectController";
import type { RoutePointTarget } from "../../modules/schedule/routePointSelection";

const MAP_OPEN_ERROR = "지도를 열지 못했어요. 다시 시도해 주세요.";

function getRouteDropdownIcon(kind: RouteDropdownSummaryKind): React.ComponentProps<typeof Ionicons>["name"] {
    if (kind === "SUBWAY" || kind === "TRAIN") return "train-outline";
    if (kind === "BUS" || isIntercityBusKind(kind)) return "bus-outline";
    if (kind === "WALK") return "walk-outline";
    if (kind === "WAIT") return "time-outline";
    return "navigate-outline";
}

type RouteSelectResultsScreenProps = {
    controller: RouteSelectController;
    onEditPoint: (target: RoutePointTarget, scrollY: number) => void;
    pointEditReturn?: { target: RoutePointTarget; scrollY: number };
};

/** 출발지·도착지 입력과 이동수단별 경로 대안, 상세 펼침 및 저장 동작을 표시한다. */
export function RouteSelectResultsScreen({
    controller,
    onEditPoint,
    pointEditReturn,
}: RouteSelectResultsScreenProps) {
    const [timetableLeg, setTimetableLeg] = React.useState<{ leg: TransitLegDetail; option: RouteAlternativeOption; legIndex: number }>();
    const [timetableVisible, setTimetableVisible] = React.useState(false);
    const timetableReturnId = React.useRef<string | undefined>(undefined);
    const timetableTrigger = React.useRef<React.ElementRef<typeof Pressable>>(null);
    const selectedCandidateHeader = React.useRef<React.ElementRef<typeof Pressable>>(null);
    const selectedCandidateMapButton = React.useRef<React.ElementRef<typeof Pressable>>(null);
    const { fontScale, height } = useWindowDimensions();
    const routeScroll = React.useRef<ScrollView>(null);
    const editedEndpoint = React.useRef<View>(null);
    const restoredCandidate = React.useRef<View>(null);
    const interactedWithCandidates = React.useRef(false);
    const currentScrollY = React.useRef(0);
    const restoredCandidateScroll = React.useRef(false);
    const modeRowOffset = React.useRef(0);
    const revealWalkResult = React.useRef(false);
    const focusWalkMode = React.useRef(false);
    const walkModeButton = React.useRef<View>(null);
    const {
        statusBarStyle,
        insets,
        isDark,
        originText,
        destinationText,
        travelMode,
        setActiveTarget,
        setIsEditingRoutePoint,
        selectedRouteId,
        setSelectedRouteId,
        transitRouteFilter,
        routeLoading,
        routeError,
        routeErrorCode,
        showTransitRecovery,
        routeSubmitPending,
        waitingForPreview,
        appliesToSchedule,
        returnsToScheduleDraft,
        routePointUiRevisionRef,
        routeDepartureAt,
        hasExplicitDeparture,
        routeScheduleBased,
        routeTargetArrivalAt,
        origin,
        destination,
        hasRouteCoords,
        shouldShowRouteResults,
        transitFilterCounts,
        visibleRouteAlternatives,
        routeContentAnimatedStyle,
        reduceMotion,
        restoredScrollY: mapReturnScrollY,
        restoredCandidateId,
        restoredExpandedCandidateId,
        collapsedCandidateId,
        setCollapsedCandidateId,
        selectTravelMode,
        selectTransitFilter,
        hasTransitFilters,
        routeListBottomPadding,
        close,
        goToScheduleList,
        handleSearchChange,
        swapPlaces,
        retryRouteSearch,
        openRouteAttribution,
        failedMapRouteId,
        openMapForOption,
        routeMapPending,
        saveRouteOption,
        applyIntercityService,
        importedTicket,
        routeUi,
    } = controller;
    const restoredScrollY = pointEditReturn?.scrollY ?? mapReturnScrollY;
    const largeRouteText = fontScale > 1.35;
    React.useEffect(() => {
        if (!largeRouteText && failedMapRouteId) AccessibilityInfo.announceForAccessibility(MAP_OPEN_ERROR);
    }, [failedMapRouteId, largeRouteText]);
    const showProviderRetry = !largeRouteText && routeErrorCode === "PROVIDER_UNAVAILABLE";
    const mapReturnCandidateId = React.useRef(
        !pointEditReturn && mapReturnScrollY !== undefined && !largeRouteText ? selectedRouteId : undefined,
    ).current;
    const [mapReturnHighlight] = React.useState(() => new Animated.Value(mapReturnCandidateId ? 1 : 0));
    React.useEffect(() => () => mapReturnHighlight.stopAnimation(), [mapReturnHighlight]);
    const sharedDurationEstimate = sharesTransitDurationEstimate(visibleRouteAlternatives);
    const routeTimeBasis = hasExplicitDeparture ? "출발" : routeScheduleBased ? "일정" : "현재 시간";
    const routeReferenceTime = hasExplicitDeparture
        ? formatScheduleRouteNoticeTime(routeDepartureAt)
        : routeScheduleBased && routeTargetArrivalAt
        ? `${formatScheduleRouteNoticeTime(routeTargetArrivalAt)} 도착`
        : formatCurrentRouteNoticeTime(routeDepartureAt);
    const showWalkingRoutes = () => {
        revealWalkResult.current = largeRouteText;
        focusWalkMode.current = !largeRouteText;
        selectTravelMode("WALK");
    };
    React.useEffect(() => {
        if (travelMode !== "WALK" || !focusWalkMode.current) return;
        const frame = requestAnimationFrame(() => {
            focusWalkMode.current = false;
            if (walkModeButton.current) AccessibilityInfo.sendAccessibilityEvent?.(walkModeButton.current, "focus");
        });
        return () => cancelAnimationFrame(frame);
    }, [travelMode]);
    const updateCandidateScrollAfterLayout = () => {
        if (!restoredCandidateScroll.current && restoredScrollY !== undefined) {
            restoredCandidateScroll.current = true;
            currentScrollY.current = restoredScrollY;
            routeScroll.current?.scrollTo({ y: restoredScrollY, animated: false });
            if (mapReturnCandidateId === selectedRouteId && mapReturnCandidateId !== undefined) {
                Animated.timing(mapReturnHighlight, {
                    toValue: 0,
                    delay: 650,
                    duration: reduceMotion ? 0 : 180,
                    useNativeDriver: true,
                }).start();
            }
            requestAnimationFrame(() => {
                const target = pointEditReturn ? editedEndpoint.current : selectedCandidateMapButton.current;
                if (target) AccessibilityInfo.sendAccessibilityEvent?.(target, "focus");
            });
            return;
        }
        if (!revealWalkResult.current || travelMode !== "WALK" || routeLoading) return;
        revealWalkResult.current = false;
        routeScroll.current?.scrollTo({ y: modeRowOffset.current, animated: !reduceMotion });
    };
    const revealRestoredCandidate = () => {
        const scroll = routeScroll.current;
        const viewport = scroll?.getNativeScrollRef();
        const candidate = restoredCandidate.current;
        if (!scroll || !viewport || !candidate || restoredScrollY !== undefined || restoredCandidateScroll.current) return;
        viewport.measureInWindow((_x, viewportY, _width, height) => {
            candidate.measureInWindow((_candidateX, candidateY, _candidateWidth, candidateHeight) => {
                if (restoredCandidateScroll.current || height <= 0 || candidateHeight <= 0) return;
                restoredCandidateScroll.current = true;
                if (candidateY < viewportY || candidateY + candidateHeight > viewportY + height) {
                    scroll.scrollTo({ y: Math.max(0, currentScrollY.current + candidateY - viewportY - 8), animated: false });
                }
                requestAnimationFrame(() => {
                    const header = selectedCandidateHeader.current;
                    if (restoredCandidate.current === candidate && header) AccessibilityInfo.sendAccessibilityEvent?.(header, "focus");
                });
            });
        });
    };
    const restoreAfterTimetable = React.useCallback(() => {
        const connectedId = timetableReturnId.current;
        timetableReturnId.current = undefined;
        if (!connectedId) {
            if (timetableTrigger.current) AccessibilityInfo.sendAccessibilityEvent?.(timetableTrigger.current, "focus");
        } else if (selectedRouteId === connectedId) {
            const header = selectedCandidateHeader.current;
            const scroll = routeScroll.current;
            const viewport = scroll?.getNativeScrollRef();
            if (header && scroll && viewport) {
                viewport.measureInWindow((_x, top, _width, height) => {
                    header.measureInWindow((_headerX, headerTop, _headerWidth, headerHeight) => {
                        if (selectedCandidateHeader.current !== header || height <= 0 || headerHeight <= 0) return;
                        if (headerTop < top || headerTop + headerHeight > top + height) {
                            scroll.scrollTo({ y: Math.max(0, currentScrollY.current + headerTop - top - 8), animated: false });
                        }
                        requestAnimationFrame(() => {
                            if (selectedCandidateHeader.current === header) AccessibilityInfo.sendAccessibilityEvent?.(header, "focus");
                        });
                    });
                });
            }
        }
        setTimetableLeg(undefined);
    }, [selectedRouteId]);
    React.useEffect(() => {
        if (Platform.OS === "ios" || timetableVisible || !timetableLeg) return;
        const frame = requestAnimationFrame(restoreAfterTimetable);
        return () => cancelAnimationFrame(frame);
    }, [restoreAfterTimetable, timetableLeg, timetableVisible]);
    const scheduleAction = (
        <Pressable
            onPress={returnsToScheduleDraft ? close : goToScheduleList}
            accessibilityRole="button"
            accessibilityLabel={returnsToScheduleDraft ? "이동 경로 화면 닫기" : "일정 목록으로 이동"}
            style={[
                styles.routeResultScheduleButton,
                largeRouteText && styles.routeResultScheduleFooterButton,
                { backgroundColor: largeRouteText ? routeUi.surface2 : routeUi.surface, borderColor: routeUi.border },
            ]}
        >
            <Ionicons name={returnsToScheduleDraft ? "chevron-back-outline" : "calendar-outline"} size={20} color={routeUi.textPrimary} />
            <Text style={[styles.routeResultScheduleButtonText, { color: routeUi.textSecondary }]}>
                {returnsToScheduleDraft ? "돌아가기" : "일정"}
            </Text>
        </Pressable>
    );
    return (
        <View
            style={[
                styles.screen,
                {
                    backgroundColor: routeUi.background,
                    paddingTop: shouldShowRouteResults ? Math.max(insets.top - 10, 24) : insets.top + 8,
                },
            ]}
        >
            <StatusBar barStyle={statusBarStyle} />
            {timetableLeg && <IntercityTimetableSheet importedTicket={importedTicket} visible={timetableVisible}
                kind={timetableLeg.leg.kind === "COACH" ? undefined : timetableLeg.leg.kind as "TRAIN" | "EXPRESS_BUS" | "INTERCITY_BUS"}
                departureName={timetableLeg.leg.startName} arrivalName={timetableLeg.leg.endName}
                date={routeDepartureAt ?? new Date()} targetArrivalAt={routeTargetArrivalAt} dark={isDark}
                onSelect={async (selection, isCurrent) => {
                    const connectedId = await applyIntercityService(timetableLeg.option, timetableLeg.legIndex, selection, isCurrent);
                    if (isCurrent()) timetableReturnId.current = connectedId;
                }}
                onClose={() => setTimetableVisible(false)}
                onDismiss={Platform.OS === "ios" ? restoreAfterTimetable : undefined} />}
            {!shouldShowRouteResults && (
                <View style={styles.headerRow}>
                    <Pressable
                        onPress={close}
                        accessibilityRole="button"
                        accessibilityLabel="이동 경로 화면 닫기"
                        style={[styles.headerButton, { backgroundColor: routeUi.surface2, borderColor: routeUi.border }]}
                    >
                        <Ionicons name="chevron-back-outline" size={22} color={routeUi.textPrimary} />
                    </Pressable>
                    <View style={styles.headerTitleWrap}>
                        <Text style={[styles.headerTitle, { color: routeUi.textPrimary }]}>이동 경로</Text>
                        <Text style={[styles.headerSubtitle, { color: routeUi.textSecondary }]}>
                            출발지와 도착지를 입력하고 경로를 선택하세요
                        </Text>
                    </View>
                    {!returnsToScheduleDraft && <Pressable
                        onPress={goToScheduleList}
                        accessibilityRole="button"
                        accessibilityLabel="일정 목록으로 이동"
                        style={[styles.headerScheduleButton, { backgroundColor: routeUi.surface2, borderColor: routeUi.border }]}
                    >
                        <Ionicons name="calendar-outline" size={17} color={routeUi.textPrimary} />
                        <Text style={[styles.headerScheduleButtonText, { color: routeUi.textPrimary }]}>일정</Text>
                    </Pressable>}
                </View>
            )}

            <ScrollView
                ref={routeScroll}
                directionalLockEnabled
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentOffset={restoredScrollY === undefined ? undefined : { x: 0, y: restoredScrollY }}
                onScroll={(event) => { currentScrollY.current = Math.max(0, event.nativeEvent.contentOffset.y); }}
                scrollEventThrottle={16}
                onContentSizeChange={updateCandidateScrollAfterLayout}
                contentContainerStyle={[styles.content, { paddingBottom: routeListBottomPadding }]}
            >
                {!shouldShowRouteResults && (
                    <View style={[styles.routeCard, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                        <View style={styles.routeInputRows}>
                            <View style={styles.routeRail}>
                                <View style={[styles.routeDot, { borderColor: routeUi.accentGreen, backgroundColor: "transparent" }]} />
                                <View style={[styles.routeRailLine, { backgroundColor: routeUi.border }]} />
                                <View style={[styles.routeDot, { borderColor: routeUi.accentRed, backgroundColor: "transparent" }]} />
                            </View>
                            <View style={styles.routeInputs}>
                                <TextInput
                                    value={originText}
                                    onFocus={() => {
                                        routePointUiRevisionRef.current += 1;
                                        setActiveTarget("origin");
                                        setIsEditingRoutePoint(true);
                                    }}
                                    onChangeText={(text) => handleSearchChange("origin", text)}
                                    accessibilityLabel="출발지 검색"
                                    accessibilityHint="장소 이름이나 주소를 입력하세요"
                                    placeholder="출발지를 입력하세요"
                                    placeholderTextColor={routeUi.inputPlaceholder}
                                    textContentType="none"
                                    autoComplete="off"
                                    secureTextEntry={false}
                                    style={[styles.routeInput, { color: routeUi.textPrimary, borderBottomColor: routeUi.inputBorder }]}
                                />
                                <TextInput
                                    value={destinationText}
                                    onFocus={() => {
                                        routePointUiRevisionRef.current += 1;
                                        setActiveTarget("destination");
                                        setIsEditingRoutePoint(true);
                                    }}
                                    onChangeText={(text) => handleSearchChange("destination", text)}
                                    accessibilityLabel="도착지 검색"
                                    accessibilityHint="장소 이름이나 주소를 입력하세요"
                                    placeholder="도착지를 입력하세요"
                                    placeholderTextColor={routeUi.inputPlaceholder}
                                    textContentType="none"
                                    autoComplete="off"
                                    secureTextEntry={false}
                                    style={[styles.routeInput, { color: routeUi.textPrimary }]}
                                />
                            </View>
                            <Pressable
                                onPress={swapPlaces}
                                accessibilityRole="button"
                                accessibilityLabel="출발지와 도착지 바꾸기"
                                style={[styles.swapButton, { backgroundColor: routeUi.surface2, borderColor: routeUi.border }]}
                            >
                                <Ionicons name="swap-vertical-outline" size={22} color={routeUi.textSecondary} />
                            </Pressable>
                        </View>

                    </View>
                )}

                {shouldShowRouteResults && (
                    <View style={styles.routeResultHeaderRow}>
                        <RouteEndpointReselectCard
                            originText={originText}
                            destinationText={destinationText}
                            onEditOrigin={() => onEditPoint("origin", currentScrollY.current)}
                            onEditDestination={() => onEditPoint("destination", currentScrollY.current)}
                            originRef={pointEditReturn?.target === "origin" ? editedEndpoint : undefined}
                            destinationRef={pointEditReturn?.target === "destination" ? editedEndpoint : undefined}
                            onSwap={swapPlaces}
                            colors={{
                                surface: routeUi.surface,
                                surface2: routeUi.surface2,
                                border: routeUi.border,
                                textPrimary: routeUi.textPrimary,
                                textSecondary: routeUi.textSecondary,
                                accentGreen: routeUi.accentGreen,
                                accentRed: routeUi.accentRed,
                            }}
                            style={styles.routeCompactCardInHeader}
                            stackLabels={largeRouteText}
                            footerAction={largeRouteText ? scheduleAction : undefined}
                        />
                        {!largeRouteText && scheduleAction}
                    </View>
                )}

                {shouldShowRouteResults && (
                <View
                    style={styles.modeRow}
                    onLayout={largeRouteText ? (event) => { modeRowOffset.current = event.nativeEvent.layout.y; } : undefined}
                >
                    {SELECTABLE_TRAVEL_MODES.map((modeItem) => {
                        const selected = travelMode === modeItem;
                        return (
                            <AnimatedTravelModeButton
                                buttonRef={modeItem === "WALK" ? walkModeButton : undefined}
                                reduceMotion={reduceMotion}
                                key={modeItem}
                                selected={selected}
                                label={TRAVEL_MODE_META[modeItem].label}
                                iconName={TRAVEL_MODE_ICONS[modeItem] ?? "navigate-outline"}
	                                backgroundColor={selected ? routeUi.selectedModeBg : "transparent"}
                                borderColor={selected ? "rgba(41,121,255,0.95)" : "transparent"}
                                textColor={selected ? routeUi.accentBlue : routeUi.textSecondary}
                                onPress={() => {
                                    revealWalkResult.current = false;
                                    focusWalkMode.current = false;
                                    selectTravelMode(modeItem);
                                }}
                            />
                        );
                    })}
                </View>
                )}

                {shouldShowRouteResults && (
                    <View style={[
                        largeRouteText && revealWalkResult.current && travelMode === "WALK" && routeLoading &&
                            { minHeight: height - insets.top },
                    ]}>
                {hasTransitFilters && !showTransitRecovery && (
                    <View
                        style={[styles.transitFilterRow, largeRouteText && styles.transitFilterRowWrapped, { borderBottomColor: routeUi.border }]}
                    >
                        {TRANSIT_FILTER_ITEMS.map((item) => {
                            const selected = transitRouteFilter === item.key;
                            const count = transitFilterCounts[item.key];
                            const disabled = item.key !== "ALL" && count === 0;
                            const label = item.key === "ALL" ? item.label : `${item.label} ${count}`;
                            return (
                                <AnimatedTransitFilterButton
                                    reduceMotion={reduceMotion}
                                    key={item.key}
                                    onPress={() => {
                                        if (!selected) interactedWithCandidates.current = true;
                                        selectTransitFilter(item.key);
                                    }}
                                    disabled={disabled}
                                    selected={selected}
                                    wrapped={largeRouteText}
                                    label={label}
                                    textColor={selected ? routeUi.textPrimary : routeUi.textSecondary}
                                    accentColor={routeUi.accentBlue}
                                />
                            );
                        })}
                    </View>
                )}

                {hasTransitFilters && !showTransitRecovery && visibleRouteAlternatives.length > 0 && (
                    <>
                        <View style={styles.currentRouteNotice}>
                            {largeRouteText ? (
                                <Text lineBreakStrategyIOS="hangul-word" style={[styles.currentRouteNoticeText, styles.currentRouteNoticeExpanded, { color: routeUi.textSecondary }]}>
                                    {`${routeTimeBasis} ${routeReferenceTime} 기준`}
                                </Text>
                            ) : (
                                <>
                                    <View style={styles.currentRouteTimeGroup}>
                                        <Text style={[styles.currentRouteNoticeText, { color: routeUi.textDisabled }]}>{routeTimeBasis}</Text>
                                        <Text style={[styles.currentRouteNoticeTimeText, { color: routeUi.accentBlue }]}>{routeReferenceTime}</Text>
                                        <Text style={[styles.currentRouteNoticeText, { color: routeUi.textDisabled }]}>기준</Text>
                                    </View>
                                    <View accessibilityLabel="추천 경로순" style={styles.currentRouteSortGroup}>
                                        <Text style={[styles.currentRouteSortText, { color: routeUi.textSecondary }]}>추천 경로순</Text>
                                    </View>
                                </>
                            )}
                        </View>
                        {sharedDurationEstimate && !routeLoading && !routeError && (
                            <Text
                                lineBreakStrategyIOS="hangul-word"
                                style={[styles.currentRouteEstimateText, { color: routeUi.textSecondary }]}
                            >
                                이동 시간은 예상값이에요
                            </Text>
                        )}
                    </>
                )}

                    <Animated.View style={[styles.routeList, routeContentAnimatedStyle]}>
                    {hasRouteCoords && !routeLoading && (showTransitRecovery || showProviderRetry) && (
                        <View style={styles.transitRecovery} accessibilityLiveRegion="polite">
                            <Text accessibilityRole="header" lineBreakStrategyIOS="hangul-word" style={[styles.transitRecoveryTitle, { color: routeUi.textPrimary }]}>
                                {showProviderRetry ? "경로를 불러오지 못했어요" : "대중교통 경로를 찾지 못했어요"}
                            </Text>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={showProviderRetry ? "경로 다시 검색" : "도보 경로 보기"}
                                accessibilityHint={showProviderRetry ? "같은 출발지와 도착지로 다시 검색합니다" : undefined}
                                onPress={showProviderRetry ? retryRouteSearch : showWalkingRoutes}
                                style={({ pressed }) => [
                                    styles.transitRecoveryAction,
                                    { backgroundColor: routeUi.surface2, opacity: pressed ? 0.75 : 1 },
                                ]}
                            >
                                <Ionicons name={showProviderRetry ? "refresh-outline" : "walk-outline"} size={19} color={routeUi.textPrimary} />
                                <Text lineBreakStrategyIOS="hangul-word" style={[styles.transitRecoveryActionText, { color: routeUi.textPrimary }]}>
                                    {showProviderRetry ? "다시 검색" : "도보 경로 보기"}
                                </Text>
                                {!showProviderRetry && <Ionicons name="chevron-forward-outline" size={15} color={routeUi.textSecondary} />}
                            </Pressable>
                        </View>
                    )}
                    {hasRouteCoords && routeLoading && (
                        <View style={[styles.emptyCard, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                            <BrandedLoader
                                size="section"
                                variant="route"
                                accessibilityLabel="경로를 계산하고 있어요"
                            />
                            <Text style={[styles.emptyText, { color: routeUi.textSecondary }]}>경로 계산 중...</Text>
                        </View>
                    )}

                    {hasRouteCoords && !routeLoading && !showTransitRecovery && !showProviderRetry && !!routeError && (
                        <View style={[styles.emptyCard, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                            <Text style={[styles.emptyText, { color: routeUi.textSecondary }]}>{routeError}</Text>
                            <Pressable
                                onPress={retryRouteSearch}
                                accessibilityRole="button"
                                accessibilityLabel="경로 다시 검색"
                                style={[styles.emptyRetryButton, { backgroundColor: routeUi.accentBlue }]}
                            >
                                <Ionicons name="refresh-outline" size={15} color="#FFFFFF" />
                                <Text style={styles.emptyRetryText}>다시 검색</Text>
                            </Pressable>
                        </View>
                    )}

                    {hasRouteCoords && !routeLoading && !showTransitRecovery && !routeError && visibleRouteAlternatives.length === 0 && (
                        <View style={[styles.emptyCard, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                            <Text style={[styles.emptyText, { color: routeUi.textSecondary }]}>
                                선택한 교통수단에 해당하는 경로가 없습니다.
                            </Text>
                        </View>
                    )}

                    {hasRouteCoords && !routeLoading && !showTransitRecovery && !routeError && visibleRouteAlternatives.map((option, displayIndex) => {
                        const selected = selectedRouteId === option.id;
                        const routeInfo = buildRouteInfoFromAlternative(
                            option,
                            origin ?? undefined,
                            destination ?? undefined,
                            routeDepartureAt,
                            displayIndex
                        );
                        const progressSegments = buildRouteProgressSegments(option);
                        const rideCount = progressSegments.filter(segment => segment.isRide).length;
                        const routeMetricChips = buildRouteMetricChips(option);
                        const accent = selected ? routeUi.selectedBorder : routeUi.border;
                        const cardBackground = selected ? routeUi.selectedSurface : routeUi.surface;
                        const routeTimeFare = formatRouteTimeFare(option, routeDepartureAt, {
                            targetArrivalAt: routeTargetArrivalAt?.toISOString(),
                            routeInfo,
                        }, !sharedDurationEstimate);
                        const duration = formatRouteInfoDuration(routeInfo.totalDurationMinutes);
                        const timingLabel = routeTimeFare ? (
                            <Text
                                lineBreakStrategyIOS="hangul-word"
                                style={[styles.routeOptionTimeFare, { color: routeUi.textSecondary }]}
                            >
                                {routeTimeFare}
                            </Text>
                        ) : null;
                        const dropdownSummaryItems = buildRouteDropdownSummaryItems(
                            option,
                            originText,
                            destinationText
                        );
                        const hasDetails = dropdownSummaryItems.length > 0;
                        const detailsExpanded = selected && hasDetails && collapsedCandidateId !== option.id;
                        const routeBoardingSummary = !detailsExpanded && rideCount < 3
                            ? buildRouteBoardingSummary(option, originText)
                            : undefined;
                        const routeLegSummary = !detailsExpanded && progressSegments.length > 0
                            ? getTransitRouteSummaryAccessibilityLabel(progressSegments)
                            : undefined;
                        const selectRoute = () => {
                            if (selected && !hasDetails) return;
                            interactedWithCandidates.current = true;
                            if (!reduceMotion) configureRouteExpansionAnimation();
                            if (selected) {
                                setCollapsedCandidateId(detailsExpanded ? option.id : undefined);
                                return;
                            }
                            setCollapsedCandidateId(undefined);
                            setSelectedRouteId(option.id);
                        };
                        return (
                            <View
                                key={option.id}
                                ref={option.id === restoredCandidateId ? restoredCandidate : undefined}
                                collapsable={option.id === restoredCandidateId ? false : undefined}
                                onLayout={option.id === restoredCandidateId ? revealRestoredCandidate : undefined}
                                style={styles.routeCandidateItem}
                            >
                                <View style={[styles.routeOptionCard, { backgroundColor: cardBackground, borderColor: accent }]}>
                                    <Pressable
                                        ref={selected ? selectedCandidateHeader : undefined}
                                        onPress={selectRoute}
                                        accessibilityRole="button"
                                        accessibilityLabel={`${duration} 경로`}
                                        accessibilityValue={{ text: [routeTimeFare, ...routeMetricChips.map((metric) => metric.label)]
                                            .filter(Boolean).join(", ") }}
                                        accessibilityHint={[
                                            routeLegSummary, routeBoardingSummary,
                                            selected && hasDetails ? (detailsExpanded ? "상세를 접습니다" : "상세를 펼칩니다") : undefined,
                                        ].filter(Boolean).join(", ")}
                                        accessibilityState={{ selected, ...(hasDetails && { expanded: detailsExpanded }) }}
                                        style={styles.routeOptionPressable}
                                    >
                                        <View style={styles.routeOptionHeader}>
                                            <View style={[styles.routeOptionHeaderRow, largeRouteText && styles.routeOptionHeaderStack]}>
                                                <Text
                                                    lineBreakStrategyIOS="hangul-word"
                                                    style={[
                                                        styles.routeOptionDuration,
                                                        largeRouteText && styles.routeOptionDurationExpanded,
                                                        { color: routeUi.textPrimary },
                                                    ]}
                                                >
                                                    {duration}
                                                </Text>
                                                <View style={styles.routeOptionLabelRow}>
                                                    {selected && <Ionicons name="checkmark-outline" size={15} color={routeUi.accentBlue} />}
                                                    <Text lineBreakStrategyIOS="hangul-word" style={[styles.routeOptionLabel, {
                                                        color: selected ? routeUi.accentBlue : routeUi.textSecondary,
                                                    }]}>
                                                        {option.intercityJourney ? "선택 운행편" : getNaverLikeRouteRecommendationLabel(
                                                            option, visibleRouteAlternatives, displayIndex
                                                        )}
                                                    </Text>
                                                    {hasDetails && <DisclosureChevron
                                                        expanded={detailsExpanded}
                                                        reduceMotion={reduceMotion}
                                                        size={16}
                                                        color={selected ? routeUi.accentBlue : routeUi.textSecondary}
                                                    />}
                                                </View>
                                            </View>
                                            {timingLabel}
                                            {routeMetricChips.length > 0 && (largeRouteText ? (
                                                <View style={styles.routeMetricsWrapped}>
                                                    {routeMetricChips.map(metric => (
                                                        <Text
                                                            key={metric.key}
                                                            lineBreakStrategyIOS="hangul-word"
                                                            style={[styles.routeMetricText, { color: routeUi.textSecondary }]}
                                                        >
                                                            {metric.label.replace(/(\d)([분회])/gu, "$1\u2060$2")}
                                                        </Text>
                                                    ))}
                                                </View>
                                            ) : (
                                                <Text lineBreakStrategyIOS="hangul-word" style={[styles.routeMetricText, { color: routeUi.textSecondary }]}>
                                                    {routeMetricChips.map(metric => metric.label).join(" · ")}
                                                </Text>
                                            ))}
                                            {progressSegments.length > 0 && !detailsExpanded && (
                                                <AnimatedRouteExpansion
                                                    variant="summary"
                                                    reduceMotion={reduceMotion}
                                                    restored={!selected || !interactedWithCandidates.current}
                                                    style={undefined}
                                                >
                                                    <TransitRouteProgressBar
                                                        segments={progressSegments}
                                                        isDark={isDark}
                                                        compact
                                                        labelledSummary
                                                        alignedSummary
                                                    />
                                                </AnimatedRouteExpansion>
                                            )}
                                            {!!routeBoardingSummary && (
                                                <View style={styles.routeBoardingSummaryRow}>
                                                    <Ionicons name="navigate-circle-outline" size={16} color={routeUi.textSecondary} />
                                                    <Text
                                                        numberOfLines={largeRouteText ? undefined : 1}
                                                        lineBreakStrategyIOS="hangul-word"
                                                        style={[styles.routeBoardingSummaryText, { color: routeUi.textSecondary }]}
                                                    >
                                                        {routeBoardingSummary}
                                                    </Text>
                                                </View>
                                            )}
                                        </View>
                                    </Pressable>
                                    {detailsExpanded && (
                                        <AnimatedRouteExpansion
                                            reduceMotion={reduceMotion}
                                            restored={!interactedWithCandidates.current && restoredExpandedCandidateId === option.id}
                                            style={[
                                                styles.routeOptionExpansion,
                                                { borderTopColor: routeUi.border },
                                            ]}
                                        >
                                            <View style={styles.routeDropdownSummaryList}>
                                                {dropdownSummaryItems.map((summary, summaryIndex) => {
                                                    const walkingTransfer = summary.kind === "TRANSFER";
                                                    const isRide = isTransitRideKind(summary.kind);
                                                    const itemColor = summary.color ??
                                                        (summary.kind === "WAIT"
                                                            ? routeUi.textSecondary
                                                            : routeUi.borderStrong);
                                                    const iconColor = isRide ? "#FFFFFF" : routeUi.textSecondary;
                                                    const iconName = getRouteDropdownIcon(summary.kind);
                                                    return (
                                                        <View key={summary.key} style={styles.routeDropdownSummaryRow}>
                                                            <View style={styles.routeDropdownMarkerColumn}>
                                                                {walkingTransfer ? <DottedWalkingRail color={routeUi.borderStrong} /> : <>
                                                                <View
                                                                    style={[
                                                                        styles.routeDropdownIcon,
                                                                        {
                                                                            borderColor: itemColor,
                                                                            backgroundColor: isRide ? routeColorForWhiteIcon(itemColor) : "transparent",
                                                                        },
                                                                    ]}
                                                                >
                                                                    <Ionicons
                                                                        name={iconName}
                                                                        size={14}
                                                                        color={iconColor}
                                                                    />
                                                                </View>
                                                                {summaryIndex < dropdownSummaryItems.length - 1 && (
                                                                    <View
                                                                        style={[
                                                                            styles.routeDropdownConnector,
                                                                            { backgroundColor: itemColor },
                                                                        ]}
                                                                    />
                                                                )}
                                                                </>}
                                                            </View>
                                                            <View style={styles.routeDropdownStepTextWrap}>
                                                                <Text
                                                                    numberOfLines={largeRouteText ? undefined : 1}
                                                                    lineBreakStrategyIOS="hangul-word"
                                                                    style={[
                                                                        styles.routeDropdownStepLine,
                                                                        { color: routeUi.textPrimary },
                                                                    ]}
                                                                >
                                                                    {summary.title}
                                                                </Text>
                                                                {!!summary.subtitle && (
                                                                    <Text
                                                                        numberOfLines={largeRouteText ? undefined : 1}
                                                                        lineBreakStrategyIOS="hangul-word"
                                                                        style={[
                                                                            styles.routeDropdownStepMeta,
                                                                            { color: routeUi.textSecondary },
                                                                        ]}
                                                                    >
                                                                        {summary.subtitle}
                                                                    </Text>
                                                                )}
                                                            </View>
                                                        </View>
                                                    );
                                                })}
                                            </View>
                                        </AnimatedRouteExpansion>
                                    )}
                                    {selected && option.transitLegs?.filter(leg => isIntercityRideKind(leg.kind)).map((leg, index) => (
                                        <Pressable key={`timetable-${index}`} accessibilityRole="button"
                                            ref={timetableLeg?.option.id === option.id && timetableLeg.leg === leg ? timetableTrigger : undefined}
                                            accessibilityLabel={`${transitModeLabel(leg.kind)} 운행 시간표 조회`}
                                            onPress={() => {
                                                if (timetableLeg) return;
                                                setTimetableLeg({ leg, option, legIndex: option.transitLegs!.indexOf(leg) });
                                                setTimetableVisible(true);
                                            }}
                                            style={[styles.routeCardSecondaryButton, { backgroundColor: routeUi.surface, borderColor: routeUi.border }]}>
                                            <Text style={[styles.routeCardSecondaryButtonText, { color: routeUi.textPrimary }]}>
                                                {transitModeLabel(leg.kind)} 운행 시간표 · {leg.startName} → {leg.endName}
                                            </Text>
                                        </Pressable>
                                    ))}
                                    {selected && option.transitLegs?.some(leg => leg.kind === 'TRAIN') && <TrainBookingAction dark={isDark} />}
                                    {selected && option.transitLegs?.filter(leg => ['EXPRESS_BUS', 'INTERCITY_BUS', 'COACH'].includes(leg.kind)).slice(0, 1).map(leg => <BusBookingAction key={leg.kind} kind={leg.kind} dark={isDark} />)}
                                    {shouldShowRequiredMapAttribution(option) && !!option.attributionText && !!option.attributionUrl && (
                                        <Pressable
                                            accessibilityRole="link"
                                            accessibilityLabel={`${option.attributionText} 지도 정보 열기`}
                                            onPress={() => openRouteAttribution(option)}
                                            style={[styles.routeAttributionLink, { borderTopColor: routeUi.border }]}
                                        >
                                            <Text style={[styles.routeAttributionText, { color: routeUi.textSecondary }]}>
                                                {option.attributionText} · 지도 수정
                                            </Text>
                                            <Ionicons name="open-outline" size={13} color={routeUi.textSecondary} />
                                        </Pressable>
                                    )}
									{selected && (
                                        <View
                                            style={[
                                                styles.routeCardActions,
                                                largeRouteText && styles.routeCardActionsStack,
                                                { borderTopColor: routeUi.border },
                                            ]}
                                        >
                                            <Pressable
                                                ref={selectedCandidateMapButton}
                                                onPress={() => openMapForOption(option, currentScrollY.current)}
                                                disabled={routeMapPending}
                                                accessibilityRole="button"
                                                accessibilityLabel={routeMapPending ? "경로 지도를 여는 중" : "지도에서 경로 보기"}
                                                accessibilityState={{ busy: routeMapPending, disabled: routeMapPending }}
                                                style={[
                                                    styles.routeCardSecondaryButton,
                                                    largeRouteText && styles.routeCardActionExpanded,
                                                    {
                                                        backgroundColor: routeUi.surface,
                                                        borderColor: routeUi.border,
                                                    },
                                                ]}
                                            >
                                                {option.id === mapReturnCandidateId && (
                                                    <Animated.View
                                                        pointerEvents="none"
                                                        style={[
                                                            StyleSheet.absoluteFillObject,
                                                            styles.routeCardMapReturnHighlight,
                                                            { borderColor: routeUi.accentBlue, opacity: mapReturnHighlight },
                                                        ]}
                                                    />
                                                )}
                                                <Ionicons name="map-outline" size={15} color={routeUi.textPrimary} />
                                                <Text lineBreakStrategyIOS="hangul-word" style={[styles.routeCardSecondaryButtonText, largeRouteText && styles.routeCardActionTextExpanded, { color: routeUi.textPrimary }]}>
                                                    {routeMapPending ? "지도 여는 중…" : "지도에서 보기"}
                                                </Text>
                                            </Pressable>
                                            <Pressable
                                                onPress={() => saveRouteOption(option, displayIndex)}
                                                disabled={routeSubmitPending || waitingForPreview}
                                                accessibilityRole="button"
                                                accessibilityLabel={appliesToSchedule ? "이 경로를 일정에 적용" : "이 경로 저장"}
                                                accessibilityState={{
                                                    busy: routeSubmitPending || waitingForPreview,
                                                    disabled: routeSubmitPending || waitingForPreview,
                                                }}
                                                style={[
                                                    styles.routeCardPrimaryButton,
                                                    largeRouteText && styles.routeCardActionExpanded,
                                                    {
                                                        backgroundColor: routeUi.accentBlue,
                                                        opacity: routeSubmitPending || waitingForPreview ? 0.58 : 1,
                                                    },
                                                ]}
                                            >
                                                {routeSubmitPending || waitingForPreview ? (
                                                    <BrandedLoader
                                                        size="button"
                                                        variant="route"
                                                        accessibilityLabel={waitingForPreview ? "선택한 경로의 시간표를 확인하고 있어요" : "선택한 경로를 저장하고 있어요"}
                                                    />
                                                ) : (
                                                    <Text lineBreakStrategyIOS="hangul-word" style={[styles.routeCardPrimaryButtonText, largeRouteText && styles.routeCardActionTextExpanded]}>
                                                        {appliesToSchedule ? "일정에 적용" : "이 경로로 저장"}
                                                    </Text>
                                                )}
                                            </Pressable>
                                        </View>
                                    )}

                                    {!largeRouteText && selected && failedMapRouteId === option.id && (
                                        <Text accessibilityLiveRegion="polite" style={[styles.routeCardMapError, { color: routeUi.textSecondary }]}>
                                            {MAP_OPEN_ERROR}
                                        </Text>
                                    )}
	                                </View>
	                            </View>
                        );
                    })}
                    </Animated.View>
                    </View>
                )}
            </ScrollView>
        </View>
    );

}
