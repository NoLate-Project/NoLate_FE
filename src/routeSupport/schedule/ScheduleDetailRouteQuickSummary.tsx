import React, { useLayoutEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { getTransitRouteSummaryAccessibilityLabel } from '../../modules/schedule/transitRouteProgress';
import TransitRouteProgressBar from '../../modules/schedule/components/route/TransitRouteProgressBar';
import { buildStepTitle, getTransferWalkDestination } from '../../modules/schedule/components/route/RouteStepTimeline.helpers';
import { transitModeLabel } from '../../modules/map/transitModes';
import { getScheduleAccessibilityVisibility } from '../../modules/schedule/accessibilityVisibility';
import {
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
  Ionicons,
} from './ScheduleDetailChrome';
import { ScheduleRouteFacts } from './ScheduleRouteFacts';
import { createScheduleDetailStyles } from './schedule-detail.styles';
import type { ScheduleDetailPresentation } from './scheduleDetailPresentationModel';
import ImportedTicketSummary from '../../modules/schedule/components/detail/ImportedTicketSummary';
import { getImportedTicket } from '../../modules/schedule/importedTicket';

type ScheduleDetailRouteQuickSummaryProps = {
  presentation: ScheduleDetailPresentation;
  automaticGuidanceActive?: boolean;
  reservedFooterHeight?: number;
  automaticRouteSummary?: React.ReactNode;
  navigationInstruction?: React.ReactNode;
  departureAction?: React.ReactNode;
};

/** 축소된 경로 시트에 권장 출발, 남은 시간, 경로 막대와 출발 완료 동작을 요약한다. */
export function ScheduleDetailRouteQuickSummary({
  presentation,
  automaticGuidanceActive = false,
  reservedFooterHeight = 0,
  automaticRouteSummary,
  navigationInstruction,
  departureAction,
}: ScheduleDetailRouteQuickSummaryProps) {
  const {
    departureDateLabel,
    departureRemainingLabel,
    departureTimeLabel,
    effectiveRouteAccessibilityLabel,
    effectiveTransitRoutePresentation,
    compactSummaryScrollable,
    handleCompactContentSizeChange,
    isDark,
    largeRouteHeader,
    primaryText,
    recommendedDepartureTimeLabel,
    routeArrivalSummary,
    routeFactLabels,
    compactRouteFactLabels,
    routeIdentityTitle,
    routeProgressSegments,
    focusedLegIndex,
    reduceMotion,
    routeDetailInfo,
    selectedRoutePassStopName,
    selectedRouteStepId,
    secondaryText,
    sheetMode,
    sheetBorder,
    showRouteIdentityInSheet,
    sheetQuickSummaryAnimatedStyle,
    snapSheet,
    topCardAccentText,
  } = presentation;
  const summaryScrollRef = useRef<ScrollView>(null);
  useLayoutEffect(() => {
    if (sheetMode === 'compact') {
      summaryScrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [presentation.item.id, sheetMode]);

  const focusedSegmentIndex = sheetMode === 'compact' ? focusedLegIndex : undefined;
  const focusedRouteSegment = focusedSegmentIndex === undefined
    ? undefined
    : routeProgressSegments[focusedSegmentIndex];
  const focusedStepIndex = routeDetailInfo?.steps.findIndex(step => step.id === selectedRouteStepId) ?? -1;
  const focusedStep = routeDetailInfo?.steps[focusedStepIndex];
  const selectedTransferDestination = focusedRouteSegment && routeDetailInfo
    ? getTransferWalkDestination(routeDetailInfo.steps, focusedStepIndex)
    : undefined;
  const focusedRouteContext = focusedStep?.type === 'ORIGIN' || focusedStep?.type === 'DESTINATION'
    ? buildStepTitle(focusedStep)
    : focusedRouteSegment && (selectedTransferDestination
      ? `환승 도보 ${focusedRouteSegment.label} · ${selectedTransferDestination}`
      : focusedRouteSegment.isRide
        ? [focusedRouteSegment.lineLabel || transitModeLabel(focusedRouteSegment.kind),
            selectedRoutePassStopName || (focusedStep ? buildStepTitle(focusedStep) : undefined)].filter(Boolean).join(' · ')
        : `${transitModeLabel(focusedRouteSegment.kind)} ${focusedRouteSegment.label}`
    );
  const arrivalSummary = routeArrivalSummary ? (
    <Text
      numberOfLines={largeRouteHeader ? undefined : 1}
      maxFontSizeMultiplier={1.65}
      lineBreakStrategyIOS="hangul-word"
      style={[styles.improvedArrivalSummary, { color: secondaryText }]}
    >
      {routeArrivalSummary}
    </Text>
  ) : null;
  const SummaryDetails = largeRouteHeader ? View : Pressable;

  return (
    <Animated.View
      {...getScheduleAccessibilityVisibility(sheetMode === 'compact')}
      pointerEvents={sheetMode === 'compact' ? 'auto' : 'none'}
      style={[styles.sheetQuickSummaryClip, sheetQuickSummaryAnimatedStyle]}
    >
      <ScrollView
        ref={summaryScrollRef}
        style={styles.compactSummaryScroll}
        contentContainerStyle={[styles.improvedCompactSummary,
          automaticGuidanceActive && { minHeight: 0 },
          reservedFooterHeight > 0 && { paddingBottom: reservedFooterHeight + 8 }]}
        onContentSizeChange={!largeRouteHeader ? handleCompactContentSizeChange : undefined}
        showsVerticalScrollIndicator={largeRouteHeader || compactSummaryScrollable}
      >
        {!presentation.internalPreviewItem && getImportedTicket(presentation.item.route) ? (
          <ImportedTicketSummary route={presentation.item.route} showBooking={false} />
        ) : null}
        {showRouteIdentityInSheet && <View style={[
          styles.improvedRouteIdentityCompact,
          largeRouteHeader && styles.improvedRouteIdentityCompactLarge,
        ]}>
          <Pressable
            onPress={() => snapSheet('expanded')}
            accessibilityRole="button"
            accessibilityLabel={`일정 상세 시트 펼치기, ${routeIdentityTitle}`}
            style={({ pressed }) => [
              styles.improvedRouteIdentityMain,
              largeRouteHeader && styles.improvedRouteIdentityMainLarge,
              { opacity: pressed ? 0.62 : 1 },
            ]}
          >
            <Ionicons
              name="navigate-outline"
              size={15}
              color={topCardAccentText}
            />
            <Text
              numberOfLines={largeRouteHeader ? undefined : 1}
              lineBreakStrategyIOS="hangul-word"
              style={[
                styles.improvedRouteIdentityTitle,
                { color: primaryText },
              ]}
            >
              {routeIdentityTitle}
            </Text>
          </Pressable>
        </View>}

        {!automaticGuidanceActive && <View style={styles.improvedCompactBody}>
          <View style={[styles.improvedCompactTopRow, largeRouteHeader && styles.improvedCompactTopRowLarge]}>
          <Pressable
          onPress={() => snapSheet('expanded')}
          accessible={sheetMode === 'compact'}
          testID="schedule-route-compact-summary"
          accessibilityRole="button"
          accessibilityLabel={[
            '일정 상세 시트 펼치기',
            `${departureTimeLabel} ${recommendedDepartureTimeLabel}`,
            departureDateLabel,
            departureRemainingLabel,
            routeArrivalSummary,
            effectiveRouteAccessibilityLabel,
            ...routeFactLabels,
            focusedRouteContext && `지도에서 선택: ${focusedRouteContext}`,
            !effectiveTransitRoutePresentation && routeProgressSegments.length > 0
              ? getTransitRouteSummaryAccessibilityLabel(routeProgressSegments)
              : undefined,
          ]
            .filter(Boolean)
            .join(', ')}
          style={({ pressed }) => [
            styles.improvedCompactTimeCopy,
            { opacity: pressed ? 0.72 : 1 },
          ]}
        >
              <Text
                maxFontSizeMultiplier={1.65}
                style={[
                  styles.improvedDepartureEyebrow,
                  largeRouteHeader && styles.improvedDepartureEyebrowLarge,
                  { color: topCardAccentText },
                ]}
              >
                {departureTimeLabel}
              </Text>
              <View style={[styles.improvedDepartureTimeRow, (largeRouteHeader || !!departureAction) && styles.improvedDepartureTimeRowLarge]}>
                <Text
                  testID="schedule-route-compact-departure-time"
                  numberOfLines={1}
                adjustsFontSizeToFit={!largeRouteHeader}
                  minimumFontScale={0.72}
                  maxFontSizeMultiplier={2}
                  style={[
                    styles.improvedCompactDepartureTime,
                    largeRouteHeader && styles.improvedCompactDepartureTimeLarge,
                    { color: primaryText },
                  ]}
                >
                  {recommendedDepartureTimeLabel}
                </Text>
                {departureDateLabel ? (
                  <Text
                    testID="schedule-route-departure-date"
                    maxFontSizeMultiplier={1.65}
                    style={[styles.improvedDepartureDateText, { color: secondaryText }]}
                  >
                    {departureDateLabel}
                  </Text>
                ) : null}
                {departureRemainingLabel ? (
                  <View
                    style={[
                      styles.improvedRemainingChip,
                      {
                        backgroundColor: isDark
                          ? 'rgba(41,121,255,0.20)'
                          : 'rgba(41,121,255,0.10)',
                      },
                    ]}
                  >
                    <Text
                      maxFontSizeMultiplier={1.65}
                      style={[
                        styles.improvedRemainingChipText,
                        largeRouteHeader && styles.improvedRemainingChipTextLarge,
                        { color: topCardAccentText },
                      ]}
                    >
                      {departureRemainingLabel}
                    </Text>
                  </View>
                ) : null}
              </View>
          </Pressable>
          {departureAction}
          </View>
          <SummaryDetails
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onPress={largeRouteHeader ? undefined : () => snapSheet('expanded')}
          >
          {focusedRouteContext && (
            <Text maxFontSizeMultiplier={1.65} style={[styles.improvedArrivalSummary, { color: topCardAccentText }]}>
              {focusedRouteContext}
            </Text>
          )}
          {!largeRouteHeader && arrivalSummary}
          {!effectiveTransitRoutePresentation ? (
            <>
              <TransitRouteProgressBar
                segments={routeProgressSegments}
                isDark={isDark}
                compact
                labelledSummary
                alignedSummary
                focusedSegmentIndex={focusedSegmentIndex}
                reduceFocusMotion={reduceMotion}
              />
            </>
          ) : null}
          {effectiveTransitRoutePresentation ? (
            <View style={styles.effectiveRouteCompactNotice}>
              <Ionicons
              name="swap-horizontal-outline"
                size={14}
                color={topCardAccentText}
              />
              <Text
                numberOfLines={largeRouteHeader ? undefined : 1}
                maxFontSizeMultiplier={1.65}
                style={[
                  styles.effectiveRouteCompactNoticeText,
                  { color: topCardAccentText },
                ]}
              >
                {effectiveTransitRoutePresentation.guidanceTitle} · {effectiveTransitRoutePresentation.compactSummary ?? effectiveTransitRoutePresentation.itinerary}
              </Text>
            </View>
          ) : (
            <ScheduleRouteFacts
              labels={routeDetailInfo ? compactRouteFactLabels : routeFactLabels}
              color={secondaryText}
              borderColor={sheetBorder}
              largeText={largeRouteHeader}
              compact
            />
          )}
          {largeRouteHeader && arrivalSummary}
          </SummaryDetails>
        </View>}
        {sheetMode === 'compact' && navigationInstruction}
        {sheetMode === 'compact' && automaticRouteSummary}
      </ScrollView>
    </Animated.View>
  );
}

const styles = createScheduleDetailStyles({
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
});
