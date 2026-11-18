import React, { useEffect, useRef } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons as ExpoIonicons } from '@expo/vector-icons';
import Reanimated, { Easing, FadeInDown, ReduceMotion } from 'react-native-reanimated';
import BrandedLoader from '../../../ui/BrandedLoader';
import styles from './styles';
import {
  buildTransitLegMeta,
  formatAlternativeInfo,
  formatTransitClock,
  getTransitLegKindMeta,
  shouldShowTransitDurationOnly,
} from './presentation';
import { buildTransitLegAssistText } from './routeTransitMarkers';
import { formatRouteDuration as formatRouteInfoDuration } from '../routeInfo';
import RouteStepTimeline from '../components/route/RouteStepTimeline';
import { formatArrivalClock } from '../components/route/RouteStepTimeline.helpers';
import type { RoutePlannerController } from './useRoutePlannerController';

function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
  return (
    <ExpoIonicons
      {...props}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}

type Props = {
  controller: RoutePlannerController;
  onRevealFirstStop: (row: View, animated: boolean) => void;
};
const refreshedRouteEntrance = FadeInDown.duration(160)
  .easing(Easing.out(Easing.cubic))
  .withInitialValues({ opacity: 0.65, transform: [{ translateY: 4 }] })
  .reduceMotion(ReduceMotion.System);

/** 선택 가능한 경로 조회 상태와 선택한 경로의 상세 타임라인을 렌더링합니다. */
export function RoutePlannerAlternativeSection({ controller, onRevealFirstStop }: Props) {
  const { fontScale } = useWindowDimensions();
  const {
    colors,
    overlayPanelBg,
    etaLoading,
    reduceMotion,
    departureTimeEdited,
    requestedTransitDepartureAt,
    alternativesError,
    routeAlternatives,
    selectedTransitMapStop,
    focusedTransitLegIndex,
    isTransitMode,
    isTransitDetailMode,
    shouldRenderTransitDetailDark,
    bottomSheetSnap,
    isBottomSheetHidden,
    detailPanelBg,
    detailCardBg,
    detailPrimaryText,
    detailSecondaryText,
    detailBorderColor,
    transitDetailSummaryPalette,
    routeDetailSummarySurface,
    transitFocusedLegBg,
    visibleAlternatives,
    selectedAlternative,
    selectedAlternativeTransitModeLabels,
    selectedTransitMeta,
    selectedRouteInfo,
    retryRouteSearch,
    focusMapOnTransitLeg,
    focusTransitMapStop,
    selectedRouteStepId,
    focusRouteInfoStep,
  } = controller;
  const showDepartureUpdate = isTransitMode && departureTimeEdited;
  const previousRoute = useRef({ loading: etaLoading, id: selectedAlternative?.id });
  const routeChanged = (
    (previousRoute.current.loading && !etaLoading) ||
    (previousRoute.current.id !== undefined && previousRoute.current.id !== selectedAlternative?.id)
  );
  const shouldAnimateRoute = routeChanged && !!selectedAlternative && !reduceMotion && !isBottomSheetHidden
    && bottomSheetSnap !== 'collapsed';
  useEffect(() => {
    previousRoute.current = { loading: etaLoading, id: selectedAlternative?.id };
  }, [etaLoading, selectedAlternative?.id]);
  const isDurationEstimate = isTransitDetailMode && shouldShowTransitDurationOnly(selectedAlternative);
  const largeRouteText = fontScale > 1.35;
  const compactTimelineHeader = isTransitDetailMode && !!selectedRouteInfo;
  const notOperating = selectedAlternative?.transitServiceState === 'not_operating';
  const departureBasisClock = compactTimelineHeader && !notOperating &&
    !selectedRouteInfo?.intercityJourney && selectedRouteInfo?.departureTime
    ? formatArrivalClock(selectedRouteInfo.departureTime, 0)
    : undefined;
  const detailTimeMeta = compactTimelineHeader && (isDurationEstimate || notOperating)
    ? selectedTransitMeta?.fareText
    : selectedTransitMeta?.combinedText;
  const departureLabel = showDepartureUpdate
    ? `${requestedTransitDepartureAt.getMonth() + 1}월 ${requestedTransitDepartureAt.getDate()}일 ${formatTransitClock(requestedTransitDepartureAt)} 출발`
    : undefined;
  const getMapStop = (stepId: string, rowIndex: number) => {
    const legIndex = Number(/^leg-(\d+)$/u.exec(stepId)?.[1]);
    const leg = selectedAlternative?.transitLegs?.[legIndex];
    const stopIndex = selectedRouteInfo?.steps.find(step => step.id === stepId)?.passStops?.[rowIndex]?.sourceIndex;
    if (stopIndex === undefined || !leg?.passStops || stopIndex === 0 || stopIndex === leg.passStops.length - 1) return undefined;
    const coord = leg.passStops[stopIndex]?.coord;
    return coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lng) ? { legIndex, stopIndex } : undefined;
  };
  const mapStopStepId = selectedTransitMapStop && `leg-${selectedTransitMapStop.legIndex}`;
  const selectedStopRow = selectedRouteInfo?.steps.find(step => step.id === mapStopStepId)
    ?.passStops?.findIndex(stop => stop.sourceIndex === selectedTransitMapStop?.stopIndex);
  return (
    <View
      style={[
        styles.alternativeSection,
        styles.alternativeSectionDetail,
        {
          borderColor: 'transparent',
          backgroundColor: detailPanelBg,
        },
      ]}
    >
      {etaLoading ? (
        <View
          style={styles.alternativeLoadingRow}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={['경로를 찾고 있어요', departureLabel].filter(Boolean).join(', ')}
          accessibilityLiveRegion="polite"
        >
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <BrandedLoader size="button" settleMark accessibilityLabel="경로를 찾는 중" />
          </View>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.alternativeLoadingCopy}>
            <Text style={[styles.alternativeLoadingText, { color: detailPrimaryText }]}>
              경로를 찾고 있어요
            </Text>
            {departureLabel && <Text style={[styles.alternativeLoadingText, { color: detailSecondaryText }]}>
              {departureLabel}
            </Text>}
          </View>
        </View>
      ) : null}

      {!etaLoading && !!alternativesError ? (
        <View style={[styles.alternativeErrorWrap, showDepartureUpdate && styles.alternativeDepartureError]}>
          {departureLabel ? (
            <View accessibilityLiveRegion="polite" style={styles.alternativeDepartureErrorCopy}>
              <Text maxFontSizeMultiplier={2} style={[styles.alternativeDepartureErrorTitle, { color: detailPrimaryText }]}>
                경로를 확인하지 못했어요
              </Text>
              <Text maxFontSizeMultiplier={2} style={[styles.alternativeLoadingText, { color: detailSecondaryText }]}>
                {departureLabel}
              </Text>
            </View>
          ) : (
            <Text style={[styles.alternativeErrorText, { color: colors.textSecondary }]}>
              {alternativesError}
            </Text>
          )}
          <Pressable
            onPress={retryRouteSearch}
            accessibilityRole="button"
            accessibilityLabel="경로 다시 검색"
            accessibilityHint={departureLabel ? '같은 출발 시각으로 다시 검색합니다' : undefined}
            style={[
              styles.alternativeRetryButton,
              { backgroundColor: colors.selectedDayBg },
            ]}
          >
            <Ionicons name="refresh-outline" size={15} color={colors.selectedDayText} />
            <Text
              style={[
                styles.alternativeRetryText,
                { color: colors.selectedDayText },
              ]}
            >
              다시 검색
            </Text>
          </Pressable>
        </View>
      ) : null}

      {!etaLoading && !alternativesError && !routeAlternatives.length ? (
        <Text
          style={[styles.alternativeEmptyText, { color: colors.textSecondary }]}
        >
          표시할 대안 경로가 없습니다.
        </Text>
      ) : null}

      {!etaLoading &&
      !alternativesError &&
      !!routeAlternatives.length &&
      !visibleAlternatives.length ? (
        <Text
          style={[styles.alternativeEmptyText, { color: colors.textSecondary }]}
        >
          선택한 필터에 해당하는 경로가 없습니다.
        </Text>
      ) : null}

      {!etaLoading && !alternativesError && !!visibleAlternatives.length && (
        <Reanimated.View
          key={selectedAlternative?.id}
          entering={shouldAnimateRoute ? refreshedRouteEntrance : undefined}
          testID="route-planner-detail-content"
          style={[
            styles.selectedRouteSection,
            styles.selectedRouteSectionDetail,
          ]}
        >
          {!!selectedAlternative && (departureBasisClock ? (
            <Text
              testID="route-planner-departure-basis"
              accessibilityRole="header"
              lineBreakStrategyIOS="hangul-word"
              style={[
                styles.transitDetailDepartureBasis,
                { color: detailSecondaryText, borderBottomColor: detailBorderColor },
              ]}
            >
              {departureBasisClock} 출발 기준
            </Text>
          ) : (
            <View
              style={[
                isTransitMode
                  ? styles.transitReferenceSummaryCard
                  : styles.transitAlternativeCard,
                styles.transitReferenceSummaryCardDetail,
                !isTransitMode ? styles.selectedRouteDetailCard : null,
                {
                  borderColor: isTransitMode
                    ? 'transparent'
                    : colors.selectedDayBg,
                  borderBottomColor:
                    routeDetailSummarySurface.borderBottomColor,
                  backgroundColor: routeDetailSummarySurface.backgroundColor,
                },
              ]}
            >
              <View
                style={[
                  styles.transitDetailHeroSummary,
                  compactTimelineHeader && !largeRouteText && styles.transitDetailTimelineHeading,
                ]}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.76}
                  style={[
                    styles.transitDetailHeroDuration,
                    compactTimelineHeader && styles.transitDetailTimelineDuration,
                    { color: detailPrimaryText },
                  ]}
                >
                  {notOperating
                    ? '운행 종료'
                    : `${compactTimelineHeader && isDurationEstimate ? '예상 ' : ''}${formatRouteInfoDuration(
                        selectedRouteInfo?.totalDurationMinutes ??
                          selectedAlternative.minutes,
                      )}`}
                </Text>
                {!!detailTimeMeta && (
                  <Text
                    numberOfLines={largeRouteText ? undefined : 1}
                    maxFontSizeMultiplier={2}
                    lineBreakStrategyIOS="hangul-word"
                    style={[
                      styles.transitDetailHeroMetaText,
                      compactTimelineHeader && styles.transitDetailTimelineMeta,
                      {
                        color: transitDetailSummaryPalette.metaTextColor,
                      },
                    ]}
                  >
                    {detailTimeMeta}
                  </Text>
                )}
              </View>

              {!isTransitMode && (
                <Text
                  style={[
                    styles.selectedRouteSummaryText,
                    { color: detailPrimaryText },
                  ]}
                >
                  {formatAlternativeInfo(selectedAlternative)}
                </Text>
              )}

              {!isTransitMode &&
                selectedAlternativeTransitModeLabels.length > 0 && (
                  <View style={styles.transitModeChipRow}>
                    {selectedAlternativeTransitModeLabels.map(modeLabel => (
                      <View
                        key={`selected-${modeLabel}`}
                        style={[
                          styles.transitModeChip,
                          {
                            borderColor: colors.border,
                            backgroundColor: overlayPanelBg,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.transitModeChipText,
                            { color: colors.textPrimary },
                          ]}
                        >
                          {modeLabel}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
            </View>
          ))}

          {selectedRouteInfo ? (
            <View
              style={[
                styles.transitReferenceTimeline,
                styles.transitReferenceTimelineDetail,
              ]}
            >
              <RouteStepTimeline
                key={selectedRouteInfo.id}
                routeInfo={selectedRouteInfo}
                selectedStepId={selectedRouteStepId}
                selectedPassStop={mapStopStepId && selectedStopRow !== undefined && selectedStopRow >= 0
                  ? { stepId: mapStopStepId, stopIndex: selectedStopRow }
                  : undefined}
                canShowPassStopOnMap={(stepId, index) => Boolean(getMapStop(stepId, index))}
                preserveStopDisclosureOnLegFocus
                onRevealFirstStop={onRevealFirstStop}
                onPassStopPress={(stepId, index) => {
                  const stop = getMapStop(stepId, index);
                  if (stop) focusTransitMapStop(stop);
                }}
                onStepPress={focusRouteInfoStep}
                forceDark={shouldRenderTransitDetailDark}
                primaryTextColor={detailPrimaryText}
                secondaryTextColor={detailSecondaryText}
                showEstimatedClockHeading={isDurationEstimate}
                realtimeArrivalsActive={!isBottomSheetHidden && bottomSheetSnap !== 'collapsed'}
                compact
                inlineStationRail
              />
            </View>
          ) : Array.isArray(selectedAlternative?.transitLegs) &&
            selectedAlternative.transitLegs.length > 0 ? (
            <View
              style={[
                styles.selectedRouteLegSection,
                {
                  borderColor: detailBorderColor,
                  backgroundColor: detailCardBg,
                },
              ]}
            >
              <Text
                style={[
                  styles.selectedRouteSectionTitle,
                  { color: detailPrimaryText },
                ]}
              >
                선택한 경로 상세
              </Text>
              <View style={styles.transitLegList}>
                {selectedAlternative.transitLegs.map((leg, legIndex) => {
                  const kindMeta = getTransitLegKindMeta(leg.kind);
                  const legMetaText = buildTransitLegMeta(leg);
                  const fromTo =
                    leg.startName && leg.endName
                      ? `${leg.startName} → ${leg.endName}`
                      : '';
                  const assistText = buildTransitLegAssistText(
                    selectedAlternative.transitLegs,
                    legIndex,
                  );
                  const isFocusedLeg = focusedTransitLegIndex === legIndex;
                  return (
                    <Pressable
                      key={`${selectedAlternative.id}-leg-${legIndex}`}
                      onPress={() => focusMapOnTransitLeg(legIndex)}
                      accessibilityRole="button"
                      accessibilityLabel={[
                        leg.label,
                        fromTo,
                        legMetaText,
                        assistText,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                      accessibilityHint="지도에서 이 이동 구간을 확대합니다"
                      accessibilityState={{
                        selected: isFocusedLeg,
                      }}
                      style={[
                        styles.transitLegItemCard,
                        styles.selectedRouteLegItemCard,
                        {
                          borderColor: isFocusedLeg
                            ? colors.selectedDayBg
                            : detailBorderColor,
                          backgroundColor: isFocusedLeg
                            ? transitFocusedLegBg
                            : detailPanelBg,
                        },
                      ]}
                    >
                      <View style={styles.transitLegRow}>
                        <View
                          style={[
                            styles.transitLegKindDot,
                            {
                              backgroundColor: kindMeta.color,
                            },
                          ]}
                        >
                          <Text style={styles.transitLegKindDotText}>
                            {kindMeta.short}
                          </Text>
                        </View>
                        <View style={styles.transitLegTextWrap}>
                          <View style={styles.transitLegPrimaryRow}>
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.transitLegLabel,
                                {
                                  color: detailPrimaryText,
                                },
                              ]}
                            >
                              {leg.label}
                            </Text>
                            {!!legMetaText && (
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.transitLegMeta,
                                  {
                                    color: detailSecondaryText,
                                  },
                                ]}
                              >
                                {legMetaText}
                              </Text>
                            )}
                          </View>
                          {!assistText && !!fromTo && (
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.transitLegFromTo,
                                {
                                  color: detailSecondaryText,
                                },
                              ]}
                            >
                              {fromTo}
                            </Text>
                          )}
                          {!!assistText && (
                            <Text
                              numberOfLines={2}
                              style={[
                                styles.transitLegAssist,
                                {
                                  color: detailSecondaryText,
                                },
                              ]}
                            >
                              {assistText}
                            </Text>
                          )}
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
        </Reanimated.View>
      )}
    </View>
  );
}
