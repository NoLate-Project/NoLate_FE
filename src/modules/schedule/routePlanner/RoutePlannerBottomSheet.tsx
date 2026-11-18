import React, { useCallback, useLayoutEffect, useRef } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons as ExpoIonicons } from '@expo/vector-icons';
import { shouldShowRequiredMapAttribution } from '../../map/routingService';
import styles from './styles';
import TransitRouteProgressBar from '../components/route/TransitRouteProgressBar';
import BrandedLoader from '../../../ui/BrandedLoader';
import type { RoutePlannerController } from './useRoutePlannerController';
import { RoutePlannerAlternativeSection } from './RoutePlannerAlternativeSection';
import { LARGE_TRANSIT_DETAIL_HANDLE_TOUCH_HEIGHT, TRANSIT_OVERVIEW_HANDLE_TOUCH_HEIGHT } from './bottomSheetLayout';
import { getRouteOverviewAccessWalk, getRoutePlannerQualityNotice, shouldShowTransitDurationOnly } from './presentation';
import { formatArrivalClock } from '../components/route/RouteStepTimeline.helpers';
import { getTransitRouteSegmentAccessibilityLabel, getTransitRouteSummaryAccessibilityLabel } from '../transitRouteProgress';

function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
  return (
    <ExpoIonicons
      {...props}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}

type Props = { controller: RoutePlannerController };

/** 경로 후보와 상세 타임라인을 담은 하단 시트를 렌더링합니다. */
export function RoutePlannerBottomSheet({ controller }: Props) {
  const { fontScale, height: windowHeight } = useWindowDimensions();
  const largeRouteText = fontScale > 1.35;
  const {
    colors,
    isDark,
    overlayBoxBg,
    etaLoading,
    routeSubmitPending,
    returnToScheduleDraft,
    appliesToExistingSchedule,
    shouldReturnToScheduleDetail,
    setBottomPanelHeight,
    setTransitActionBarHeight,
    setHasBottomSheetMeasured,
    bottomSheetSnap,
    reduceMotion,
    snapBottomSheetTo,
    toggleBottomSheetFromHandle,
    isBottomSheetHidden,
    setSelectedTransitMapStop,
    focusedTransitLegIndex,
    setFocusedTransitLegIndex,
    setFocusedRouteStepId,
    bottomSheetTranslateY,
    hasRouteReady,
    isRouteDetailMode,
    detailPanelBg,
    detailSecondaryText,
    detailBorderColor,
    transitActionBarBg,
    transitDetailPrimaryActionBg,
    transitDetailPrimaryActionText,
    transitDetailControlText,
    transitDetailActionBarPaddingBottom,
    bottomPanelMaxHeight,
    canScrollBottomSheetContent,
    bottomPanelScrollViewportHeight,
    bottomPanelScrollBottomPadding,
    selectedAlternative,
    selectedRouteInfo,
    selectedTransitMeta,
    canSubmitRoute,
    openSelectedRouteAttribution,
    selectedAlternativeQualityNotice,
    selectedCollapsedRouteSummary,
    selectedRouteDuration,
    selectedTransitProgressSegments,
    bottomHandlePanResponder,
    submit,
  } = controller;
  const appliesToSchedule = returnToScheduleDraft || appliesToExistingSchedule || shouldReturnToScheduleDetail;
  const routeActionLabel = appliesToSchedule ? '일정에 적용' : '경로 저장';
  const routeActionAccessibilityLabel = appliesToSchedule
    ? '선택한 경로를 일정에 적용'
    : '선택한 경로 저장';
  const routeActionStatus = routeSubmitPending
    ? appliesToSchedule ? '경로 적용 중' : '경로 저장 중'
    : undefined;
  const isMapOverview = bottomSheetSnap === 'collapsed';
  const openRouteDetail = () => snapBottomSheetTo('expanded');
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffset = useRef(0);
  const revealRequest = useRef(0);
  const previousDetailRouteId = useRef(selectedAlternative?.id);
  const cancelStopReveal = useCallback(() => { revealRequest.current += 1; }, []);
  useLayoutEffect(() => cancelStopReveal, [
    cancelStopReveal, selectedAlternative?.id, bottomSheetSnap, isBottomSheetHidden, reduceMotion,
  ]);
  useLayoutEffect(() => {
    const routeId = selectedAlternative?.id;
    if (previousDetailRouteId.current === routeId) return;
    previousDetailRouteId.current = routeId;
    scrollOffset.current = 0;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [selectedAlternative?.id]);
  const revealFirstStop = useCallback((row: View, animated: boolean) => {
    const scroll = scrollRef.current;
    const viewport = scroll?.getNativeScrollRef();
    if (!scroll || !viewport || !canScrollBottomSheetContent) return;
    const request = ++revealRequest.current;
    viewport.measureInWindow((_x, top, _width, height) => {
      row.measureInWindow((_x, rowTop, _width, rowHeight) => {
        if (revealRequest.current !== request || scrollRef.current !== scroll ||
            height <= 0 || rowHeight <= 0) return;
        // Leave room for the next stop so users can act from the revealed list.
        const overflow = rowTop + rowHeight * 2 + 8 - (top + height);
        if (overflow > 0) scroll.scrollTo({ y: scrollOffset.current + overflow, animated: animated && !reduceMotion });
      });
    });
  }, [canScrollBottomSheetContent, reduceMotion]);
  const hideDetailContent = isBottomSheetHidden || (isRouteDetailMode && isMapOverview);
  const handleIsAvailable = !isBottomSheetHidden && (!isRouteDetailMode || !isMapOverview);
  const handleWillCollapse = bottomSheetSnap === 'expanded';
  const overviewRouteId = isMapOverview ? selectedAlternative?.id : undefined;
  const previousOverviewRouteId = useRef(overviewRouteId);
  const summaryProgress = useRef(new Animated.Value(1)).current;
  useLayoutEffect(() => {
    const previous = previousOverviewRouteId.current;
    previousOverviewRouteId.current = overviewRouteId;
    if (reduceMotion || !overviewRouteId || previous === overviewRouteId) {
      summaryProgress.setValue(1);
      return;
    }
    summaryProgress.setValue(0);
    const animation = Animated.timing(summaryProgress, {
      toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [overviewRouteId, reduceMotion, summaryProgress]);
  const isNotOperating = selectedAlternative?.transitServiceState === 'not_operating';
  const accessWalk = isMapOverview
    ? getRouteOverviewAccessWalk(selectedAlternative, selectedRouteInfo?.originName)
    : undefined;
  const accessOrigin = accessWalk?.origin;
  const departureClock = selectedRouteInfo && !isNotOperating && !selectedRouteInfo.intercityJourney
    ? formatArrivalClock(selectedRouteInfo.departureTime, 0)
    : undefined;
  const compactDeparture = selectedAlternative?.mode === 'TRANSIT' && departureClock && (shouldShowTransitDurationOnly(selectedAlternative)
    ? `${departureClock} 예상 출발`
    : `${departureClock} 출발 기준`);
  const collapsedDuration = isNotOperating ? selectedRouteDuration : `예상 ${selectedRouteDuration}`;
  const collapsedMeta = [
    isMapOverview && compactDeparture,
    !isNotOperating && selectedCollapsedRouteSummary?.arrivalText,
    selectedCollapsedRouteSummary?.metricsText,
  ].filter(Boolean).join(' · ');
  const focusedOverviewSegment = focusedTransitLegIndex === undefined
    ? undefined
    : selectedTransitProgressSegments[focusedTransitLegIndex];
  const overviewAccessibilityValue = [
    collapsedDuration,
    collapsedMeta,
    selectedTransitProgressSegments.length > 0 && getTransitRouteSummaryAccessibilityLabel(selectedTransitProgressSegments),
    focusedOverviewSegment && focusedTransitLegIndex !== undefined
      ? `지도 선택: ${getTransitRouteSegmentAccessibilityLabel(selectedTransitProgressSegments, focusedTransitLegIndex)}`
      : undefined,
  ].filter(Boolean).join(', ');
  const showExpandedTransitSummary = !isMapOverview && !etaLoading &&
    selectedAlternative?.mode === 'TRANSIT' && selectedRouteInfo &&
    !selectedRouteInfo.intercityJourney && !isNotOperating &&
    Boolean(departureClock);
  const expandedTransitMetrics = [
    shouldShowTransitDurationOnly(selectedAlternative) ? collapsedDuration : `총 ${selectedRouteDuration}`,
    selectedTransitMeta?.fareText,
  ].filter(Boolean).join(' · ');
  const qualityNotice = getRoutePlannerQualityNotice(
    selectedAlternative, selectedAlternativeQualityNotice, isRouteDetailMode,
  );
  return (
    <View
      style={[styles.bottomOverlay]}
      pointerEvents={isBottomSheetHidden ? 'none' : 'box-none'}
    >
      <Animated.View
        pointerEvents={isBottomSheetHidden ? 'none' : 'auto'}
        onLayout={event => {
          const measured = Math.round(event.nativeEvent.layout.height);
          setHasBottomSheetMeasured(true);
          setBottomPanelHeight(prev =>
            prev === measured ? prev : measured,
          );
        }}
        style={[
          styles.bottomPanelMotion,
          {
            height: isRouteDetailMode ? bottomPanelMaxHeight : undefined,
            maxHeight: bottomPanelMaxHeight,
            opacity: isBottomSheetHidden ? 0 : 1,
            transform: [{ translateY: bottomSheetTranslateY }],
          },
        ]}
      >
        <View
          style={[
            styles.bottomPanel,
            isRouteDetailMode ? styles.bottomPanelDetail : null,
            {
              borderColor: isRouteDetailMode
                ? 'transparent'
                : colors.border,
              backgroundColor: detailPanelBg,
            },
          ]}
        >
          <View pointerEvents={handleIsAvailable ? 'auto' : 'none'} {...bottomHandlePanResponder.panHandlers}>
            <Pressable
              testID="route-planner-sheet-handle"
              accessibilityRole="button"
              accessibilityLabel={handleWillCollapse ? '경로 시트 접기' : '경로 시트 펼치기'}
              accessible={handleIsAvailable}
              accessibilityElementsHidden={!handleIsAvailable}
              importantForAccessibility={handleIsAvailable ? 'yes' : 'no-hide-descendants'}
              accessibilityState={{ expanded: handleWillCollapse }}
              onPress={toggleBottomSheetFromHandle}
              style={[
                styles.bottomHandleTouchArea,
                isRouteDetailMode ? styles.bottomHandleTouchAreaDetail : null,
                isRouteDetailMode && largeRouteText && { height: LARGE_TRANSIT_DETAIL_HANDLE_TOUCH_HEIGHT },
              ]}
            >
              <View
                style={[
                  styles.bottomHandle,
                  isRouteDetailMode ? styles.bottomHandleDetail : null,
                  {
                    backgroundColor: isRouteDetailMode
                      ? detailBorderColor
                      : colors.border,
                    opacity: 0.75,
                  },
                ]}
              />
            </Pressable>
          </View>
          <ScrollView
            ref={scrollRef}
            testID="route-planner-detail-scroll"
            onScroll={event => { scrollOffset.current = event.nativeEvent.contentOffset.y; }}
            onScrollBeginDrag={cancelStopReveal}
            scrollEventThrottle={16}
            pointerEvents={hideDetailContent ? 'none' : 'auto'}
            accessibilityElementsHidden={hideDetailContent}
            importantForAccessibility={hideDetailContent ? 'no-hide-descendants' : 'auto'}
            style={[
              styles.bottomPanelScroll,
              typeof bottomPanelScrollViewportHeight === 'number'
                ? {
                    maxHeight: bottomPanelScrollViewportHeight,
                    height: isRouteDetailMode
                      ? bottomPanelScrollViewportHeight
                      : undefined,
                  }
                : null,
            ]}
            contentContainerStyle={[
              styles.bottomPanelScrollContent,
              isRouteDetailMode
                ? styles.bottomPanelScrollContentDetail
                : null,
              { paddingBottom: bottomPanelScrollBottomPadding },
            ]}
            keyboardShouldPersistTaps="handled"
            scrollEnabled={canScrollBottomSheetContent}
            nestedScrollEnabled
            bounces={false}
            alwaysBounceVertical={false}
            showsVerticalScrollIndicator={isRouteDetailMode && canScrollBottomSheetContent}
          >
            {!hasRouteReady ? (
              <View
                style={[
                  styles.routeHintCard,
                  {
                    borderColor: colors.border,
                    backgroundColor: overlayBoxBg,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.routeHintText,
                    { color: colors.textSecondary },
                  ]}
                >
                  출발지와 도착지를 모두 선택하면 경로 정보가 표시됩니다.
                </Text>
              </View>
            ) : (
              <>
                {!!qualityNotice && !etaLoading && (
                  <View
                    style={[
                      styles.routeQualityWarning,
                      {
                        backgroundColor: isDark
                          ? 'rgba(120,53,15,0.30)'
                          : '#FFF7E6',
                        borderColor: isDark
                          ? 'rgba(251,191,36,0.42)'
                          : '#F4C76A',
                      },
                    ]}
                  >
                    <Ionicons
                      name="alert-circle-outline"
                      size={17}
                      color={isDark ? '#FCD34D' : '#A15C00'}
                    />
                    <Text
                      lineBreakStrategyIOS="hangul-word"
                      style={[
                        styles.routeQualityWarningText,
                        largeRouteText && isRouteDetailMode && styles.routeQualityWarningTextExpanded,
                        { color: isDark ? '#FDE68A' : '#7A4500' },
                      ]}
                    >
                      {qualityNotice}
                    </Text>
                  </View>
                )}
                {shouldShowRequiredMapAttribution(selectedAlternative) &&
                  !!selectedAlternative?.attributionText &&
                  !!selectedAlternative.attributionUrl &&
                  !etaLoading && (
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={`${selectedAlternative.attributionText} 지도 정보 열기`}
                      onPress={openSelectedRouteAttribution}
                      style={styles.routeAttributionLink}
                    >
                      <Text
                        style={[
                          styles.routeAttributionText,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {selectedAlternative.attributionText} · 지도 수정
                      </Text>
                      <Ionicons
                        name="open-outline"
                        size={13}
                        color={colors.textSecondary}
                      />
                    </Pressable>
                  )}

                <RoutePlannerAlternativeSection controller={controller} onRevealFirstStop={revealFirstStop} />

              </>
            )}
          </ScrollView>
        </View>
      </Animated.View>
      {isRouteDetailMode &&
        (Boolean(selectedAlternative) || etaLoading) &&
        !isBottomSheetHidden && (
          <View
            onLayout={event => {
              const measured = Math.round(event.nativeEvent.layout.height);
              setTransitActionBarHeight(prev =>
                prev === measured ? prev : measured,
              );
            }}
            style={[
              styles.transitDetailActionBar,
              {
                backgroundColor: transitActionBarBg,
                borderTopColor: detailBorderColor,
                paddingBottom: transitDetailActionBarPaddingBottom,
              },
              isMapOverview && selectedAlternative && styles.transitOverviewActionBar,
            ]}
          >
            {isMapOverview && selectedAlternative && (
              <View {...bottomHandlePanResponder.panHandlers}>
                <Pressable
                  testID="route-planner-overview-handle"
                  accessibilityRole="button"
                  accessibilityLabel="경로 시트 펼치기"
                  accessibilityState={{ expanded: false }}
                  onPress={openRouteDetail}
                  style={[styles.bottomHandleTouchArea, styles.bottomHandleTouchAreaDetail,
                    { height: TRANSIT_OVERVIEW_HANDLE_TOUCH_HEIGHT }]}
                >
                  <View style={[styles.bottomHandle, styles.bottomHandleDetail,
                    { backgroundColor: detailSecondaryText, opacity: 0.65 }]} />
                </Pressable>
              </View>
            )}
            {isMapOverview && selectedAlternative && (
              <ScrollView
                testID="route-planner-overview-scroll"
                style={{ maxHeight: Math.round(windowHeight * 0.43) }}
                nestedScrollEnabled
                bounces={false}
              >
                <Animated.View
                  style={{
                    opacity: summaryProgress.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }),
                    transform: [{ translateY: summaryProgress.interpolate({ inputRange: [0, 1], outputRange: [3, 0] }) }],
                  }}
                  testID="route-planner-overview-summary"
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="경로 상세 펼치기"
                    accessibilityValue={{ text: overviewAccessibilityValue }}
                    accessibilityState={{ expanded: false }}
                    onPress={openRouteDetail}
                    style={[
                      styles.transitCollapsedSummaryRow,
                      largeRouteText && styles.transitCollapsedSummaryExpanded,
                      { borderBottomColor: detailBorderColor },
                    ]}
                  >
                    <Text
                      numberOfLines={largeRouteText ? undefined : 1}
                      adjustsFontSizeToFit={!largeRouteText}
                      minimumFontScale={0.82}
                      lineBreakStrategyIOS="hangul-word"
                      style={[
                        styles.transitCollapsedArrivalText,
                        largeRouteText && styles.transitCollapsedArrivalExpanded,
                        { color: transitDetailControlText },
                      ]}
                    >
                      {collapsedDuration}
                    </Text>
                    {!!collapsedMeta && (
                      <Text
                        numberOfLines={largeRouteText ? undefined : 2}
                        lineBreakStrategyIOS="hangul-word"
                        style={[
                          styles.transitCollapsedMetricsText,
                          largeRouteText && styles.transitCollapsedMetricsExpanded,
                          { color: detailSecondaryText },
                        ]}
                      >
                        {collapsedMeta}
                      </Text>
                    )}
                    <Ionicons
                      name="chevron-up-outline"
                      size={18}
                      color={transitDetailControlText}
                      style={styles.transitCollapsedSummaryChevron}
                    />
                  </Pressable>
                  {selectedTransitProgressSegments.length > 0 && (
                    <Pressable
                      testID="route-planner-overview-segments"
                      accessible={false}
                      onPress={openRouteDetail}
                      style={styles.transitCollapsedRouteBar}
                    >
                      <TransitRouteProgressBar
                        segments={selectedTransitProgressSegments}
                        isDark={isDark}
                        compact
                        labelledSummary
                        alignedSummary
                        focusedSegmentIndex={focusedTransitLegIndex}
                        reduceFocusMotion={reduceMotion}
                      />
                    </Pressable>
                  )}
                  {accessWalk && (
                    <View
                      testID="route-planner-overview-access-walk"
                      accessible
                      accessibilityLabel={[
                        accessOrigin && `${accessOrigin} 출발`,
                        accessWalk.destination,
                        accessWalk.walking,
                      ].filter(Boolean).join(', ')}
                      style={[styles.transitOverviewWalk, { borderTopColor: detailBorderColor }]}
                    >
                      <Ionicons name={accessOrigin ? 'radio-button-on-outline' : 'walk-outline'} size={19}
                        color={accessOrigin ? (isDark ? '#52D895' : '#168052') : detailSecondaryText} />
                      <View style={styles.transitOverviewWalkText}>
                        {accessOrigin && (
                          <Text lineBreakStrategyIOS="hangul-word" style={[styles.transitOverviewWalkDestination, { color: transitDetailControlText }]}>
                            {accessOrigin} 출발
                          </Text>
                        )}
                        {accessWalk.destination && (
                          <Text lineBreakStrategyIOS="hangul-word" style={[styles.transitOverviewWalkMetric, { color: detailSecondaryText }]}>
                            {accessWalk.destination}까지
                          </Text>
                        )}
                        <Text style={[styles.transitOverviewWalkMetric, { color: detailSecondaryText }]}>{accessWalk.walking}</Text>
                      </View>
                    </View>
                  )}
                </Animated.View>
              </ScrollView>
            )}
            {showExpandedTransitSummary && (
              <View testID="route-planner-footer-summary" style={styles.transitDetailFooterSummary}>
                {!!selectedCollapsedRouteSummary?.arrivalText && (
                  <Text style={[styles.transitDetailFooterArrival, { color: transitDetailControlText }]}>
                    {selectedCollapsedRouteSummary.arrivalText}
                  </Text>
                )}
                <Text testID="route-planner-footer-metrics" style={[styles.transitDetailFooterMetrics, { color: detailSecondaryText }]}>
                  {expandedTransitMetrics}
                </Text>
              </View>
            )}
            <View style={[styles.transitDetailActionButtonRow, largeRouteText && styles.transitDetailActionButtonStack]}>
              {(!isMapOverview || !selectedAlternative) && <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: !isMapOverview }}
                accessibilityLabel={
                  isMapOverview
                    ? '경로 상세 펼치기'
                    : '지도에서 전체 경로 보기'
                }
                onPress={() => {
                  if (isMapOverview) {
                    openRouteDetail();
                    return;
                  }
                  // 시트 상태가 바뀌면 시트 안전영역을 반영한 전체 경로 카메라가 다시 계산된다.
                  setSelectedTransitMapStop(undefined);
                  setFocusedTransitLegIndex(undefined);
                  setFocusedRouteStepId(undefined);
                  snapBottomSheetTo('collapsed');
                }}
                style={[
                  styles.transitDetailPreviewButton,
                  largeRouteText && styles.transitDetailActionButtonExpanded,
                  { borderColor: detailBorderColor },
                ]}
              >
                <Ionicons
                  name={
                    isMapOverview
                      ? 'list-outline'
                      : 'map-outline'
                  }
                  size={18}
                  color={transitDetailControlText}
                />
                <Text
                  numberOfLines={largeRouteText ? undefined : 1}
                  adjustsFontSizeToFit={!largeRouteText}
                  minimumFontScale={0.8}
                  lineBreakStrategyIOS="hangul-word"
                  style={[
                    styles.transitDetailPreviewText,
                    largeRouteText && styles.transitDetailActionTextExpanded,
                    { color: transitDetailControlText },
                  ]}
                >
                  {isMapOverview
                    ? '상세 경로'
                    : '전체 경로 지도'}
                </Text>
              </Pressable>}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={routeActionStatus ?? routeActionAccessibilityLabel}
                accessibilityState={{
                  disabled: !canSubmitRoute,
                  busy: routeSubmitPending,
                }}
                onPress={submit}
                disabled={!canSubmitRoute}
                style={[
                  styles.transitDetailSaveButton,
                  largeRouteText && styles.transitDetailActionButtonExpanded,
                  { backgroundColor: transitDetailPrimaryActionBg },
                  !canSubmitRoute && !routeSubmitPending && styles.transitDetailSaveButtonDisabled,
                ]}
              >
                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
                  style={styles.transitDetailActionIcon}>
                  {routeActionStatus ? (
                    <BrandedLoader size="button" tone="inverse" accessibilityLabel={routeActionStatus} />
                  ) : <Ionicons
                    name="checkmark-outline"
                    size={18}
                    color={transitDetailPrimaryActionText}
                  />}
                </View>
                <Text
                  numberOfLines={largeRouteText ? undefined : 1}
                  adjustsFontSizeToFit={!largeRouteText}
                  minimumFontScale={0.8}
                  lineBreakStrategyIOS="hangul-word"
                  style={[
                    styles.transitDetailSaveText,
                    largeRouteText && styles.transitDetailActionTextExpanded,
                    { color: transitDetailPrimaryActionText },
                  ]}
                >
                  {routeActionStatus ?? routeActionLabel}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
    </View>
  );
}
