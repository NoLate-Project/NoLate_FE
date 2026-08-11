import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons as ExpoIonicons } from '@expo/vector-icons';
import BrandedLoader from '../../../ui/BrandedLoader';
import styles from './styles';
import {
  buildTransitLegMeta,
  formatAlternativeInfo,
  formatTransitClock,
  formatTransitDepartureNow,
  getTransitLegKindMeta,
} from './presentation';
import { buildTransitLegAssistText } from './routeTransitMarkers';
import { formatRouteDuration as formatRouteInfoDuration } from '../routeInfo';
import RouteStepTimeline from '../components/route/RouteStepTimeline';
import TransitRouteProgressBar from '../components/route/TransitRouteProgressBar';
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

type Props = { controller: RoutePlannerController };

/** 선택 가능한 경로 카드 목록과 상세 타임라인을 현재 화면 모드에 맞춰 렌더링합니다. */
export function RoutePlannerAlternativeSection({ controller }: Props) {
  const {
    colors,
    isDark,
    overlayPanelBg,
    travelMode,
    etaLoading,
    alternativesError,
    routeAlternatives,
    selectedTransitMapStop,
    focusedTransitLegIndex,
    isTransitMode,
    isRouteDetailMode,
    isTransitDetailMode,
    shouldRenderTransitDetailDark,
    detailPanelBg,
    detailCardBg,
    detailPrimaryText,
    detailSecondaryText,
    detailBorderColor,
    transitDetailSummaryPalette,
    routeDetailSummarySurface,
    transitFocusedLegBg,
    transitDetailControlText,
    visibleAlternatives,
    selectedAlternative,
    selectedAlternativeMetricTags,
    selectedAlternativeTransitModeLabels,
    selectedAlternativeStepPreview,
    selectedRouteDepartureAt,
    selectedTransitMeta,
    selectedTransitTimeRange,
    selectedTransitStatusLabel,
    selectedTransitProgressSegments,
    selectedRouteInfo,
    retryRouteSearch,
    focusMapOnTransitLeg,
    selectedRouteStepId,
    focusRouteInfoStep,
  } = controller;
  return (
    <View
      style={[
        styles.alternativeSection,
        isRouteDetailMode ? styles.alternativeSectionDetail : null,
        {
          borderColor: isRouteDetailMode ? 'transparent' : colors.border,
          backgroundColor: detailPanelBg,
        },
      ]}
    >
      {travelMode === 'TRANSIT' &&
        !isRouteDetailMode &&
        !etaLoading &&
        !alternativesError &&
        !!routeAlternatives.length && (
          <>
            <View
              style={[
                styles.transitDepartureRow,
                { borderBottomColor: detailBorderColor },
              ]}
            >
              <Text
                style={[
                  styles.transitDepartureText,
                  { color: detailPrimaryText },
                ]}
              >
                {formatTransitDepartureNow()}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  styles.transitDepartureHint,
                  { color: detailSecondaryText },
                ]}
              >
                {selectedAlternative?.transitModeSummary ?? '대중교통 경로'}
              </Text>
            </View>
          </>
        )}

      {etaLoading ? (
        <View style={styles.alternativeLoadingRow}>
          <BrandedLoader
            size="button"
            variant="route"
            accessibilityLabel="경로 옵션을 계산하고 있어요"
          />
          <Text
            style={[
              styles.alternativeLoadingText,
              { color: colors.textSecondary },
            ]}
          >
            경로 옵션 계산 중...
          </Text>
        </View>
      ) : null}

      {!etaLoading && !!alternativesError ? (
        <View style={styles.alternativeErrorWrap}>
          <Text
            style={[
              styles.alternativeErrorText,
              { color: colors.textSecondary },
            ]}
          >
            {alternativesError}
          </Text>
          <Pressable
            onPress={retryRouteSearch}
            accessibilityRole="button"
            accessibilityLabel="경로 다시 검색"
            style={[
              styles.alternativeRetryButton,
              { backgroundColor: colors.selectedDayBg },
            ]}
          >
            <Ionicons name="refresh" size={15} color={colors.selectedDayText} />
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
        <View
          style={[
            styles.selectedRouteSection,
            isRouteDetailMode ? styles.selectedRouteSectionDetail : null,
          ]}
        >
          {!!selectedAlternative && (
            <View
              style={[
                isTransitMode
                  ? styles.transitReferenceSummaryCard
                  : styles.transitAlternativeCard,
                isRouteDetailMode
                  ? styles.transitReferenceSummaryCardDetail
                  : null,
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
              {isRouteDetailMode ? (
                <View style={styles.transitDetailHeroSummary}>
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.76}
                    style={[
                      styles.transitDetailHeroDuration,
                      { color: detailPrimaryText },
                    ]}
                  >
                    {selectedAlternative.transitServiceState === 'not_operating'
                      ? '운행 종료'
                      : formatRouteInfoDuration(
                          selectedRouteInfo?.totalDurationMinutes ??
                            selectedAlternative.minutes,
                        )}
                  </Text>
                  {!!selectedTransitMeta?.combinedText && (
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.transitDetailHeroMetaText,
                        {
                          color: transitDetailSummaryPalette.metaTextColor,
                        },
                      ]}
                    >
                      {selectedTransitMeta.combinedText}
                    </Text>
                  )}
                </View>
              ) : (
                <>
                  <View style={styles.selectedRouteSummaryHeader}>
                    <View
                      style={[
                        styles.selectedRouteDurationBlock,
                        isTransitDetailMode &&
                          styles.selectedRouteDurationBlockCompact,
                      ]}
                    >
                      <Text
                        style={[
                          styles.selectedRouteOptimalText,
                          isTransitDetailMode &&
                            styles.selectedRouteOptimalTextCompact,
                          {
                            color: isTransitDetailMode
                              ? transitDetailControlText
                              : colors.selectedDayBg,
                          },
                        ]}
                      >
                        {selectedTransitStatusLabel}
                      </Text>
                      <Text
                        style={[
                          styles.transitDurationLarge,
                          isTransitDetailMode &&
                            styles.transitDurationLargeCompact,
                          { color: detailPrimaryText },
                        ]}
                      >
                        {selectedAlternative.transitServiceState ===
                        'not_operating'
                          ? '운행 종료'
                          : formatRouteInfoDuration(
                              selectedRouteInfo?.totalDurationMinutes ??
                                selectedAlternative.minutes,
                            )}
                      </Text>
                    </View>
                  </View>

                  {!!selectedTransitTimeRange && isTransitMode && (
                    <Text
                      style={[
                        styles.transitReferenceMetaText,
                        isTransitDetailMode &&
                          styles.transitReferenceMetaTextCompact,
                        { color: detailSecondaryText },
                      ]}
                    >
                      {selectedTransitTimeRange}
                    </Text>
                  )}
                </>
              )}

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

              {isTransitMode && selectedTransitProgressSegments.length > 0 && (
                <TransitRouteProgressBar
                  segments={selectedTransitProgressSegments}
                  isDark={isDark}
                  compact={isTransitDetailMode}
                />
              )}

              {isTransitMode && !isTransitDetailMode && (
                <View
                  style={[
                    styles.transitDetailBaseTimeRow,
                    isTransitDetailMode &&
                      styles.transitDetailBaseTimeRowCompact,
                    { borderTopColor: detailBorderColor },
                  ]}
                >
                  <Text
                    style={[
                      styles.transitDetailBaseTimeText,
                      { color: detailSecondaryText },
                    ]}
                  >
                    {formatTransitClock(selectedRouteDepartureAt)} 기준
                  </Text>
                </View>
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

              {!isTransitMode && selectedAlternativeMetricTags.length > 0 && (
                <View style={styles.transitMetricTagRow}>
                  {selectedAlternativeMetricTags.map(metric => (
                    <View
                      key={`selected-${metric}`}
                      style={[
                        styles.transitMetricTag,
                        {
                          borderColor: colors.border,
                          backgroundColor: overlayPanelBg,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.transitMetricTagText,
                          { color: colors.textPrimary },
                        ]}
                      >
                        {metric}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {!isRouteDetailMode &&
                !!selectedAlternativeStepPreview &&
                (!Array.isArray(selectedAlternative.transitLegs) ||
                  selectedAlternative.transitLegs.length === 0) && (
                  <Text
                    style={[
                      styles.selectedRouteBodyText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {selectedAlternativeStepPreview}
                  </Text>
                )}
            </View>
          )}

          {selectedRouteInfo ? (
            <View
              style={[
                styles.transitReferenceTimeline,
                isRouteDetailMode
                  ? styles.transitReferenceTimelineDetail
                  : null,
              ]}
            >
              <RouteStepTimeline
                routeInfo={selectedRouteInfo}
                selectedStepId={selectedRouteStepId}
                selectedPassStop={
                  selectedTransitMapStop
                    ? {
                        stepId: `leg-${selectedTransitMapStop.legIndex}`,
                        stopIndex: selectedTransitMapStop.stopIndex,
                      }
                    : undefined
                }
                onStepPress={focusRouteInfoStep}
                forceDark={shouldRenderTransitDetailDark}
                primaryTextColor={detailPrimaryText}
                secondaryTextColor={detailSecondaryText}
                compact={isRouteDetailMode}
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
        </View>
      )}
    </View>
  );
}
