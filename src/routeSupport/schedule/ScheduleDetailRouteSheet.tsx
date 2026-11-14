import ImportedTicketSummary from '../../modules/schedule/components/detail/ImportedTicketSummary';
import React, { useMemo, useEffect, useRef, useState } from 'react';
import Reanimated, { Easing, FadeIn, FadeOut, Keyframe, ReduceMotion } from 'react-native-reanimated';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { SavedJourneyRouteTimeline } from '../../modules/journey/SavedJourneyRouteTimeline';
import ScheduleArrivalObservationAction from '../../modules/schedule/components/detail/ScheduleArrivalObservationAction';
import { fromISO } from '../../../lib/util/data';
import {
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
  hhmmText,
  Ionicons,
} from './ScheduleDetailChrome';
import {
  getRouteDisclosureScrollDelta,
  travelModeLabel,
  travelPlanParticipantLabel,
} from './scheduleDetailModel';
import { createScheduleDetailStyles } from './schedule-detail.styles';
import type { ScheduleDetailPresentation } from './scheduleDetailPresentationModel';
import { ScheduleRouteFacts } from './ScheduleRouteFacts';
import { ScheduleDetailRouteQuickSummary } from './ScheduleDetailRouteQuickSummary';
import { SavedJourneyGuidanceCard } from '../../modules/journey/SavedJourneyGuidanceCard';
import { buildSavedJourneyInput } from '../../modules/journey/savedJourneyGuidance';
import { useSavedJourneyBinding } from '../../modules/journey/useSavedJourneyBinding';
import { SavedJourneyTrialControls } from '../../modules/journey/SavedJourneyTrialControls';
import { isAutomaticJourneyEntryEnabled } from '../../modules/journey/journeyFeature';

type ScheduleDetailRouteSheetProps = {
  presentation: ScheduleDetailPresentation;
  companionCount: number;
  renderRouteCompanions: (onFirstRowLayout: (row: View) => void) => React.ReactNode;
};

/** 경로 요약과 펼친 상세 정보를 드래그 가능한 하단 시트로 표시한다. */
export function ScheduleDetailRouteSheet({
  presentation,
  companionCount,
  renderRouteCompanions,
}: ScheduleDetailRouteSheetProps) {
  const {
    completeDeparture,
    currentMemberDepartedAt,
    departureActionPending,
    departureSubmissionStatus,
    departureCompleted,
    departureOverview,
    departureDateLabel,
    departureRemainingLabel,
    departureTimeLabel,
    displayTravelMode,
    effectiveRouteAccessibilityLabel,
    effectiveTransitRoutePresentation,
    handleExpandedContentLayout,
    handleSheetHeaderLayout,
    handleRouteStepPress,
    canShowPassStopOnMap,
    handleRoutePassStopPress,
    hasDepartureInfo,
    hasDetailedRoute,
    inspectedParticipant,
    inspectedTravelPlan,
    internalPreviewItem,
    isDark,
    journeyGuidanceAvailable,
    isPlainSchedule,
    item,
    largeRouteHeader,
    openCurrentRoutePlanner,
    participantDisclosureAnimatedStyle,
    participantPresentations,
    participantsExpanded,
    primaryText,
    recommendedDepartureTimeLabel,
    reduceMotion,
    routeArrivalSummary,
    routeDetailInfo,
    routeDetailMeta,
    routeDurationLabel,
    routeFactLabels,
    routeIdentityTitle,
    routeSavePending,
    routeSaveConfirmed,
    canRetryRouteSave,
    retryRouteSave,
    routeSummaryTitle,
    selectedRoutePassStop,
    selectedRouteStepId,
    secondaryText,
    returnToOwnTravelPlan,
    sheetBottomPadding,
    sheetBorder,
    sheetExpandedContentAnimatedStyle,
    sheetHandleAnimatedStyle,
    sheetMaxHeight,
    sheetMode,
    sheetPanResponder,
    sheetScrollRef,
    sheetTranslateY,
    showRouteIdentityInSheet,
    snapSheet,
    toggleParticipantsExpanded,
    topCardAccentText,
    topCardControlBg,
  } = presentation;
  const departedCountLabel = `${departureOverview.departedCount}명 출발`;
  const inspectedParticipantName = participantPresentations.find(
    participant => participant.memberId === inspectedTravelPlan?.memberId,
  )?.label ?? (inspectedParticipant && travelPlanParticipantLabel(inspectedParticipant));
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
  const guidanceInput = useMemo(() => presentation.currentMemberId != null && !inspectedTravelPlan
    && (item.myTravelPlan?.memberId ?? item.ownerMemberId) === presentation.currentMemberId
    ? buildSavedJourneyInput(item.route, item.origin, item.destination) : null,
    [presentation.currentMemberId, inspectedTravelPlan, item.route, item.origin, item.destination, item.myTravelPlan?.memberId, item.ownerMemberId]);
  const guidanceBinding = useSavedJourneyBinding(guidanceInput, String(item.id));
  const authenticatedGuidanceEntry = isAutomaticJourneyEntryEnabled()
    && !internalPreviewItem && presentation.authoritativeDetailLoaded && !presentation.loadError
    && !presentation.offlineGuidancePreview && presentation.currentMemberId != null
    && !inspectedTravelPlan && (item.myTravelPlan?.memberId ?? item.ownerMemberId) === presentation.currentMemberId;
  const guidancePrepared = (guidanceBinding?.savedRouteValidated === true && guidanceBinding.guidanceEnabled === true
    && guidanceBinding.scheduleId === String(item.id)) || (presentation.offlineGuidancePreview && !!guidanceInput) || authenticatedGuidanceEntry;
  const showsGuidanceControls = (presentation.offlineGuidancePreview || authenticatedGuidanceEntry) && !inspectedTravelPlan;

  const departureFailed = departureSubmissionStatus === 'failed' && !departureCompleted && !journeyGuidanceAvailable;
  const departureActionDisabled = departureActionPending || routeSavePending;
  const sharedDeparture = companionCount > 1;
  const departureActionLabel = departureCompleted ? '길안내 보기' : '길안내 시작';
  const routeSaveSucceeded = routeSaveConfirmed && !routeSavePending && !canRetryRouteSave;
  const expanded = sheetMode === 'expanded';
  const automaticGuidanceActive = !!guidanceBinding?.savedRouteValidated && !!guidanceBinding.guidanceEnabled
    && guidanceBinding.scheduleId === String(item.id);
  const actionInSummary = !expanded && !automaticGuidanceActive;
  const showDepartureInHeader = expanded && hasDetailedRoute && !automaticGuidanceActive && !inspectedTravelPlan;
  const [openedGuidanceSchedule, setOpenedGuidanceSchedule] = useState<string>();
  const keepsGuidanceControls = showsGuidanceControls && (expanded || openedGuidanceSchedule === String(item.id));
  useEffect(() => {
    if (expanded && showsGuidanceControls) setOpenedGuidanceSchedule(String(item.id));
  }, [expanded, showsGuidanceControls, item.id]);
  const { height: windowHeight } = useWindowDimensions();
  const scrollOffset = useRef(0);
  const revealRequest = useRef(0);
  const sheetHeader = useRef<View>(null);
  const savedRouteHeading = useRef<View>(null);
  const shouldRevealCompanion = useRef(false);
  const selectedStopRow = useRef<View>(null);
  useEffect(() => () => { revealRequest.current += 1; }, [expanded, routeDetailInfo]);

  const hasSelectedRoutePassStop = selectedRoutePassStop != null;
  useEffect(() => {
    if (!expanded || !hasSelectedRoutePassStop) return;
    const request = ++revealRequest.current;
    const frame = requestAnimationFrame(() => {
      const scroll = sheetScrollRef.current;
      const viewport = scroll?.getNativeScrollRef();
      const row = selectedStopRow.current;
      if (!scroll || !viewport || !row || request !== revealRequest.current) return;
      // The row and viewport move together as the sheet opens.
      viewport.measureInWindow((_x, viewportTop, _width, viewportHeight) => {
        row.measureInWindow((_rowX, rowTop, _rowWidth, rowHeight) => {
          if (request !== revealRequest.current || row !== selectedStopRow.current
            || rowHeight <= 0 || viewportHeight <= 0) return;
          const top = rowTop - viewportTop;
          const bottom = viewportHeight - sheetBottomPadding - 12;
          const delta = top < 12 ? top - 12 : Math.max(0, top + rowHeight - bottom);
          if (Math.abs(delta) >= 1) {
            scroll.scrollTo({ y: Math.max(0, scrollOffset.current + delta), animated: !reduceMotion });
          }
        });
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      if (request === revealRequest.current) revealRequest.current += 1;
    };
  }, [expanded, hasSelectedRoutePassStop, selectedRoutePassStop?.stepId, selectedRoutePassStop?.stopIndex, reduceMotion, sheetBottomPadding, sheetScrollRef]);

  const openGuidanceControls = () => {
    sheetScrollRef.current?.scrollTo({ y: 0, animated: false });
    snapSheet('expanded');
  };

  const showSavedRoute = () => {
    const scroll = sheetScrollRef.current;
    const viewport = scroll?.getNativeScrollRef();
    const heading = savedRouteHeading.current;
    if (!scroll || !viewport || !heading) return;
    const request = ++revealRequest.current;
    viewport.measureInWindow((_x, viewportTop) => {
      heading.measureInWindow((_headingX, headingTop, _width, headingHeight) => {
        if (request === revealRequest.current && headingHeight > 0) {
          scroll.scrollTo({ y: Math.max(0, scrollOffset.current + headingTop - viewportTop - 8), animated: !reduceMotion });
        }
      });
    });
  };

  const revealSheetRow = (row: View, animated: boolean, boardingRow?: View) => {
    const scroll = sheetScrollRef.current;
    const viewport = scroll?.getNativeScrollRef();
    if (!expanded || !scroll || !viewport) return;
    const request = ++revealRequest.current;
    viewport.measureInWindow((_x, viewportTop, _width, viewportHeight) => {
      row.measureInWindow((_rowX, rowTop, _rowWidth, rowHeight) => {
        if (request !== revealRequest.current || rowHeight <= 0 || viewportHeight <= 0) return;
        const visibleBottom = Math.min(viewportTop + viewportHeight, windowHeight) - sheetBottomPadding;
        const rowBottom = rowTop + rowHeight;
        const move = (delta: number) => {
          if (request !== revealRequest.current || delta <= 0) return;
          scroll.scrollTo({ y: Math.max(0, scrollOffset.current + delta), animated });
        };
        const header = sheetHeader.current;
        if (!boardingRow || !header) {
          move(getRouteDisclosureScrollDelta(rowBottom, visibleBottom));
          return;
        }
        boardingRow.measureInWindow((_boardingX, boardingTop, _boardingWidth, boardingHeight) => {
          if (boardingHeight <= 0) {
            move(getRouteDisclosureScrollDelta(rowBottom, visibleBottom));
            return;
          }
          header.measureInWindow((_headerX, headerTop, _headerWidth, headerHeight) => {
            const visibleTop = Math.max(viewportTop, headerTop + headerHeight);
            move(getRouteDisclosureScrollDelta(rowBottom, visibleBottom, boardingTop, visibleTop));
          });
        });
      });
    });
  };

  const revealFirstCompanion = (row: View) => {
    if (!shouldRevealCompanion.current) return;
    shouldRevealCompanion.current = false;
    revealSheetRow(row, !reduceMotion);
  };

  const departureAction = !inspectedTravelPlan && !guidancePrepared && journeyGuidanceAvailable ? (
    <Pressable
      testID="schedule-route-departure-action"
      onPress={completeDeparture}
      disabled={departureActionDisabled}
      accessibilityRole="button"
      accessibilityLabel={departureActionLabel}
      accessibilityState={{ busy: departureActionDisabled, disabled: departureActionDisabled }}
      style={({ pressed }) => [
        styles.sheetDepartureAction,
        largeRouteHeader ? styles.sheetDepartureActionLarge : (actionInSummary || showDepartureInHeader) && styles.sheetDepartureActionInline,
        {
          backgroundColor: departureCompleted
            ? isDark ? 'rgba(41,121,255,0.20)' : 'rgba(41,121,255,0.12)'
            : APP_ACCENT_BLUE,
          opacity: pressed || departureActionPending || routeSavePending ? 0.64 : 1,
        },
      ]}
    >
      <Ionicons name="navigate-outline" size={16} color={departureCompleted ? topCardAccentText : '#FFFFFF'} />
      <Text
        maxFontSizeMultiplier={2}
        lineBreakStrategyIOS="hangul-word"
        style={[styles.sheetDepartureActionText, { color: departureCompleted ? topCardAccentText : '#FFFFFF' }]}
      >
        {departureActionLabel}
      </Text>
    </Pressable>
  ) : null;

  const departureAlertEnabled = item.myTravelPlan?.notificationEnabled ?? item.notificationEnabled;
  const canRecordDeparture = !journeyGuidanceAvailable && !guidancePrepared && (
    departureFailed || departureActionPending || (hasDepartureInfo && (sharedDeparture || departureAlertEnabled))
  );
  const manualDepartureLabel = departureActionPending ? '출발 기록 중'
    : departureFailed ? '출발 기록 다시 시도'
    : sharedDeparture ? '내 출발 알리기' : '출발 기록하고 알림 끄기';
  const manualDepartureHint = [
    sharedDeparture && '함께하는 사람에게 내 출발 시각을 표시합니다.',
    departureAlertEnabled && (sharedDeparture || departureFailed) && '내 출발 알림이 꺼집니다.',
  ].filter(Boolean).join(' ') || undefined;
  const manualDeparture = inspectedTravelPlan ? null : sharedDeparture && currentMemberDepartedAt ? (
    <Reanimated.View
      testID="schedule-route-manual-departure-status"
      entering={departureSubmissionStatus === 'recorded' ? departureConfirmedLabelIn : undefined}
      accessibilityLiveRegion="polite"
      style={styles.manualDepartureRow}
    >
      <Ionicons name="checkmark-circle-outline" size={18} color={topCardAccentText} />
      <Text style={[styles.manualDepartureText, { color: primaryText }]}>
        {hhmmText(fromISO(currentMemberDepartedAt))}에 출발
      </Text>
    </Reanimated.View>
  ) : !departureCompleted && canRecordDeparture ? (
    <Pressable
      testID="schedule-route-manual-departure"
      onPress={completeDeparture}
      disabled={departureActionDisabled}
      accessibilityRole="button"
      accessibilityLabel={manualDepartureLabel}
      accessibilityHint={manualDepartureHint}
      accessibilityState={{ busy: departureActionPending, disabled: departureActionDisabled }}
      style={({ pressed }) => [
        styles.manualDepartureRow,
        { opacity: pressed || departureActionDisabled ? 0.6 : 1 },
      ]}
    >
      {departureActionPending ? <ActivityIndicator size="small" color={topCardAccentText} /> : (
        <Ionicons
          name={departureFailed ? 'refresh-outline' : sharedDeparture ? 'time-outline' : 'notifications-off-outline'}
          size={18}
          color={topCardAccentText}
        />
      )}
      <Text style={[styles.manualDepartureText, { color: topCardAccentText }]}>{manualDepartureLabel}</Text>
    </Pressable>
  ) : null;

  const showExpandedStatus = !showDepartureInHeader || showRouteIdentityInSheet ||
    Boolean(arrivalSummary || (!sharedDeparture && manualDeparture) || item.myDepartedAt);
  const departureContext = (
    <View style={styles.expandedDepartureContext}>
      <Reanimated.View
        key={!sharedDeparture && departureSubmissionStatus === 'recorded' ? 'confirmed' : 'departure'}
        entering={!sharedDeparture && departureSubmissionStatus === 'recorded' ? departureConfirmedLabelIn : undefined}
        accessibilityLiveRegion="polite"
      >
        <Text
          maxFontSizeMultiplier={2}
          lineBreakStrategyIOS="hangul-word"
          style={[styles.expandedDepartureTime, { color: primaryText }]}
        >
          <Text style={{ color: secondaryText }}>{departureTimeLabel}{' '}</Text>
          {recommendedDepartureTimeLabel}
        </Text>
      </Reanimated.View>
      {departureDateLabel || departureRemainingLabel ? (
        <Text
          testID={departureDateLabel ? 'schedule-route-departure-date' : undefined}
          maxFontSizeMultiplier={1.65}
          style={[styles.improvedDepartureDateText, { color: secondaryText }]}
        >
          {departureDateLabel ?? departureRemainingLabel}
        </Text>
      ) : null}
    </View>
  );

  return !isPlainSchedule ? (
    <Animated.View
      style={[
        styles.routeSheet,
        {
          height: sheetMaxHeight,
          transform: [{ translateY: sheetTranslateY }],
        },
      ]}
    >
      <View
        style={[
          styles.routeSheetSurface,
          isDark ? styles.panelOpaqueBackdropDark : styles.panelOpaqueBackdropLight,
          { borderColor: sheetBorder },
        ]}
      >
        <View ref={sheetHeader} collapsable={false} onLayout={handleSheetHeaderLayout}>
          <View
            style={styles.sheetHandleHitArea}
            {...sheetPanResponder.panHandlers}
          >
            <Pressable
              testID="schedule-route-sheet-handle"
              style={({ pressed }) => [styles.sheetHandleButton, { opacity: pressed ? 0.62 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={expanded ? '경로 시트 접기' : '경로 시트 펼치기'}
              accessibilityState={{ expanded }}
              onPress={() => snapSheet(expanded ? 'compact' : 'expanded')}
            >
              <Animated.View style={sheetHandleAnimatedStyle} pointerEvents="none">
                <Ionicons
                  name={sheetHandleAnimatedStyle ? 'chevron-up-outline' :
                    expanded ? 'chevron-down-outline' : 'chevron-up-outline'}
                  size={20}
                  color={secondaryText}
                />
              </Animated.View>
            </Pressable>
          </View>
          {inspectedTravelPlan && (
            <Reanimated.View
              entering={inspectedPlanEntrance}
              style={[styles.inspectedPlanBar, { backgroundColor: topCardControlBg }]}
            >
              <View style={styles.inspectedPlanIdentity}>
                <Ionicons name="person-circle-outline" size={19} color={topCardAccentText} />
                <Text maxFontSizeMultiplier={1.9} style={[styles.inspectedPlanText, { color: primaryText }]}>
                  {inspectedParticipantName ? `${inspectedParticipantName}의 경로` : '동행자 경로'}
                </Text>
              </View>
              <Pressable
                onPress={returnToOwnTravelPlan}
                accessibilityRole="button"
                accessibilityLabel="내 이동 계획으로 돌아가기"
                style={({ pressed }) => [styles.inspectedPlanClose, { opacity: pressed ? 0.55 : 1 }]}
              >
                <Text maxFontSizeMultiplier={1.65} style={[styles.inspectedPlanActionText, { color: topCardAccentText }]}>
                  내 경로
                </Text>
                <Ionicons name="return-up-back-outline" size={16} color={topCardAccentText} />
              </Pressable>
            </Reanimated.View>
          )}
          {showsGuidanceControls && !expanded && (
            <Pressable
              testID="schedule-route-guidance-entry"
              accessibilityRole="button"
              accessibilityLabel="위치 안내"
              accessibilityHint="같은 경로 시트에서 안내 설정을 엽니다"
              onPress={openGuidanceControls}
              style={({ pressed }) => [
                styles.sheetDepartureAction,
                largeRouteHeader && styles.sheetDepartureActionLarge,
                { backgroundColor: topCardControlBg, opacity: pressed ? 0.64 : 1 },
              ]}
            >
              <Ionicons name="navigate-outline" size={16} color={topCardAccentText} />
              <Text maxFontSizeMultiplier={2} style={[styles.sheetDepartureActionText, { color: primaryText }]}>위치 안내</Text>
              <Ionicons name="chevron-up-outline" size={15} color={secondaryText} />
            </Pressable>
          )}
          {showDepartureInHeader ? (
            <View style={[styles.expandedDepartureHeader, largeRouteHeader && styles.expandedDepartureHeaderLarge]}>
              <Reanimated.View entering={departureContextIn} style={!largeRouteHeader && styles.expandedDepartureHeaderCopy}>
                {departureContext}
              </Reanimated.View>
              {departureAction}
            </View>
          ) : !actionInSummary && departureAction}
          {(routeSavePending || routeSaveConfirmed || canRetryRouteSave) && (
            <Reanimated.View
              entering={routeSaveFeedbackIn}
              exiting={routeSaveFeedbackOut}
              style={[
                styles.sheetRouteSaveFeedback,
                largeRouteHeader && canRetryRouteSave && styles.sheetRouteSaveFeedbackStack,
                { backgroundColor: topCardControlBg },
              ]}
            >
              <View style={styles.sheetRouteSaveFeedbackMessage}>
                <View style={styles.sheetRouteSaveFeedbackIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  {routeSavePending ? (
                    <ActivityIndicator size="small" color={topCardAccentText} />
                  ) : routeSaveSucceeded ? (
                    <Reanimated.View entering={confirmationCheckIn}>
                      <Ionicons name="checkmark-circle-outline" size={20} color={topCardAccentText} />
                    </Reanimated.View>
                  ) : (
                    <Ionicons name="alert-circle-outline" size={20} color={secondaryText} />
                  )}
                </View>
                <Text
                  testID="schedule-route-apply-status"
                  accessibilityLiveRegion="polite"
                  maxFontSizeMultiplier={2}
                  lineBreakStrategyIOS="hangul-word"
                  style={[styles.sheetRouteSaveFeedbackText, { color: primaryText }]}
                >
                  {routeSavePending ? '경로를 적용하고 있어요' :
                    canRetryRouteSave ? '경로를 적용하지 못했어요' : '경로를 적용했어요'}
                </Text>
              </View>
              {canRetryRouteSave && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="경로 적용 다시 시도"
                  accessibilityState={{ busy: routeSavePending, disabled: routeSavePending }}
                  disabled={routeSavePending}
                  onPress={retryRouteSave}
                  style={({ pressed }) => [
                    styles.sheetRouteRetry,
                    largeRouteHeader && styles.sheetRouteRetryStack,
                    { opacity: pressed || routeSavePending ? 0.6 : 1 },
                  ]}
                >
                  <Text maxFontSizeMultiplier={1.5} style={[styles.sheetRouteSaveFeedbackText, { color: topCardAccentText }]}>
                    다시 시도
                  </Text>
                </Pressable>
              )}
            </Reanimated.View>
          )}
        </View>
        <View style={styles.sheetContent}>
        <ScheduleDetailRouteQuickSummary
          presentation={presentation}
          automaticGuidanceActive={automaticGuidanceActive}
          automaticRouteInput={automaticGuidanceActive ? guidanceInput : null}
          departureAction={actionInSummary ? departureAction : null}
        />
        <Animated.ScrollView
          ref={sheetScrollRef}
          pointerEvents={expanded ? 'auto' : 'none'}
          style={[styles.sheetScroll, sheetExpandedContentAnimatedStyle]}
          contentContainerStyle={[
            styles.sheetScrollContent,
            { paddingBottom: sheetBottomPadding },
          ]}
          showsVerticalScrollIndicator={false}
          onScroll={event => { scrollOffset.current = event.nativeEvent.contentOffset.y; }}
          onScrollBeginDrag={() => { revealRequest.current += 1; }}
          scrollEventThrottle={16}
          bounces={false}
          scrollEnabled={sheetMode === 'expanded'}
          accessibilityElementsHidden={!expanded}
          importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
        >
          <ImportedTicketSummary route={item.route} showBooking={sheetMode === 'expanded'} />
          {sheetMode === 'expanded' && <SavedJourneyGuidanceCard input={guidanceInput} scheduleId={String(item.id)} isDark={isDark} />}
          {keepsGuidanceControls
            ? <SavedJourneyTrialControls key={String(item.id)} input={guidanceInput} savedRoute={item.route} isDark={isDark}
                onViewSavedRoute={hasDetailedRoute ? showSavedRoute : undefined}
                authenticatedSchedule={authenticatedGuidanceEntry || presentation.guidancePreviewAuthenticationSource
                ? { scheduleId: String(item.id), memberId: presentation.currentMemberId! } : undefined}
                previewAuthenticationSource={presentation.guidancePreviewAuthenticationSource} /> : null}
          <View
            onLayout={handleExpandedContentLayout}
            pointerEvents={sheetMode === 'expanded' ? 'auto' : 'none'}
            accessibilityElementsHidden={sheetMode !== 'expanded'}
            importantForAccessibility={
              sheetMode === 'expanded' ? 'auto' : 'no-hide-descendants'
            }
            style={styles.sheetExpandedContent}
          >
            {showExpandedStatus ? (
              <View
                style={[
                  styles.sheetStatusSection,
                  { borderBottomColor: sheetBorder },
                ]}
              >
                <View style={styles.improvedExpandedHero}>
                  {showRouteIdentityInSheet && <View style={styles.improvedExpandedIdentityRow}>
                    <View style={[
                      styles.improvedRouteIdentityExpanded,
                      largeRouteHeader && styles.improvedRouteIdentityExpandedLarge,
                    ]}>
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
                      <Text
                        numberOfLines={largeRouteHeader ? undefined : 1}
                        style={[
                          styles.improvedRouteIdentityMeta,
                          { color: secondaryText },
                        ]}
                      >
                        {travelModeLabel(displayTravelMode ?? undefined)}
                      </Text>
                    </View>
                  </View>}

                  {!showDepartureInHeader && departureContext}
                  {arrivalSummary}
                  {!sharedDeparture && manualDeparture}
                  {!hasDetailedRoute && (
                    <ScheduleRouteFacts
                      labels={routeFactLabels}
                      color={secondaryText}
                      borderColor={sheetBorder}
                      largeText={largeRouteHeader}
                    />
                  )}

                  {item.myDepartedAt ? (
                    <ScheduleArrivalObservationAction
                      scheduleId={item.id}
                      myDepartedAt={item.myDepartedAt}
                      compact
                    />
                ) : null}
              </View>

            </View>
            ) : null}

            {effectiveTransitRoutePresentation ? (
              <View
                accessible
                accessibilityRole="summary"
                accessibilityLabel={effectiveRouteAccessibilityLabel}
                style={[
                  styles.effectiveRouteCard,
                  isDark
                    ? styles.effectiveRouteCardDark
                    : styles.effectiveRouteCardLight,
                ]}
              >
                <View style={styles.effectiveRouteCardHeader}>
                  <View style={styles.effectiveRouteCardTitleRow}>
                    <View
                      style={[
                        styles.effectiveRouteCardIcon,
                        isDark
                          ? styles.effectiveRouteCardIconDark
                          : styles.effectiveRouteCardIconLight,
                      ]}
                    >
                      <Ionicons
                        name="swap-horizontal"
                        size={15}
                        color={topCardAccentText}
                      />
                    </View>
                    <Text
                      style={[
                        styles.effectiveRouteCardTitle,
                        { color: primaryText },
                      ]}
                    >
                      {effectiveTransitRoutePresentation.guidanceTitle}
                    </Text>
                  </View>
                  {effectiveTransitRoutePresentation.summary ? (
                    <Text
                      style={[
                        styles.effectiveRouteCardSummary,
                        { color: topCardAccentText },
                      ]}
                    >
                      {effectiveTransitRoutePresentation.summary}
                    </Text>
                  ) : null}
                </View>
                {/* Expanded sheet is scrollable: keep per-train comparison clocks visible, not ellipsized. */}
                <Text
                  style={[
                    styles.effectiveRouteCardItinerary,
                    { color: primaryText },
                  ]}
                >
                  {effectiveTransitRoutePresentation.itinerary}
                </Text>
                {effectiveTransitRoutePresentation.waitMeta ? (
                  <View style={styles.effectiveRouteWaitMetaRow}>
                    <Ionicons
                      name="time-outline"
                      size={13}
                      color={topCardAccentText}
                    />
                    <Text
                      style={[
                        styles.effectiveRouteWaitMeta,
                        { color: topCardAccentText },
                      ]}
                    >
                      {effectiveTransitRoutePresentation.waitMeta}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.effectiveRouteMapNoteRow}>
                  <Ionicons
                    name="map-outline"
                    size={13}
                    color={secondaryText}
                  />
                  <Text
                    style={[
                      styles.effectiveRouteMapNote,
                      { color: secondaryText },
                    ]}
                  >
                    {effectiveTransitRoutePresentation.mapNote}
                  </Text>
                </View>
              </View>
            ) : null}

            <>
              <View
                ref={savedRouteHeading}
                collapsable={false}
                style={[
                  styles.sheetRouteSummary,
                  { borderBottomColor: sheetBorder },
                ]}
              >
                <View style={[styles.sheetRouteTopRow, largeRouteHeader && styles.sheetRouteTopRowLarge]}>
                  <View style={styles.sheetRouteCopy}>
                    {hasDetailedRoute ? (
                      <Text
                        accessibilityRole="header"
                        testID="schedule-route-timeline-heading"
                        lineBreakStrategyIOS="hangul-word"
                        maxFontSizeMultiplier={2.25}
                        style={[styles.sheetRouteTitle, { color: primaryText }]}
                      >
                        {routeSummaryTitle}
                      </Text>
                    ) : (
                      <>
                        <View style={styles.sheetRouteKickerRow}>
                          <View
                            style={[
                              styles.sheetRouteLiveDot,
                              { backgroundColor: secondaryText },
                            ]}
                          />
                          <Text
                            style={[
                              styles.sheetRouteMeta,
                              { color: secondaryText },
                            ]}
                          >
                            {routeDetailMeta}
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.sheetRouteTitle,
                            { color: primaryText },
                          ]}
                        >
                          {routeSummaryTitle}
                        </Text>
                      </>
                    )}
                  </View>
                  {!hasDetailedRoute || !inspectedTravelPlan ? (
                    <View style={styles.sheetRouteActions}>
                      {!hasDetailedRoute ? (
                        <Text
                          style={[
                            styles.sheetRouteDuration,
                            { color: primaryText },
                          ]}
                        >
                          {routeDurationLabel}
                        </Text>
                      ) : null}
                      {!inspectedTravelPlan && (
                        <Pressable
                          onPress={openCurrentRoutePlanner}
                          disabled={routeSavePending}
                          accessibilityRole="button"
                          accessibilityLabel={
                            hasDetailedRoute
                              ? '길찾기에서 경로 보기'
                              : '이동 경로 설정'
                          }
                          accessibilityState={{
                            busy: routeSavePending,
                            disabled: routeSavePending,
                          }}
                          style={({ pressed }) => [
                            styles.sheetRouteMapButton,
                            hasDetailedRoute && styles.sheetRouteMapButtonLabeled,
                            {
                              backgroundColor: hasDetailedRoute || pressed
                                ? topCardControlBg
                                : 'transparent',
                              opacity: routeSavePending
                                ? 0.35
                                : pressed
                                ? 0.58
                                : 1,
                            },
                          ]}
                        >
                          {routeSavePending ? (
                            <ActivityIndicator
                              size="small"
                              color={primaryText}
                            />
                          ) : (
                            <Ionicons
                              name="map-outline"
                              size={hasDetailedRoute ? 17 : 21}
                              color={hasDetailedRoute ? topCardAccentText : primaryText}
                            />
                          )}
                          {hasDetailedRoute && (
                            <Text
                              maxFontSizeMultiplier={2}
                              style={[styles.sheetRouteMapButtonLabel, { color: topCardAccentText }]}
                            >
                              길찾기
                            </Text>
                          )}
                        </Pressable>
                      )}
                    </View>
                  ) : null}
                </View>
                {hasDetailedRoute && routeDetailInfo && inspectedTravelPlan ? (
                  <Text style={[styles.routeDetailBaseTimeText, { color: secondaryText }]}>
                    {hhmmText(fromISO(routeDetailInfo.departureTime))} 출발 기준
                  </Text>
                ) : null}
              </View>

              {hasDetailedRoute && routeDetailInfo ? (
                <SavedJourneyRouteTimeline
                  input={guidanceInput}
                  scheduleId={String(item.id)}
                  routeInfo={routeDetailInfo}
                  selectedStepId={selectedRouteStepId}
                  selectedPassStop={selectedRoutePassStop}
                  selectedStopRowRef={selectedStopRow}
                  preserveStopDisclosureOnLegFocus
                  showLegFocus={expanded}
                  onStepPress={handleRouteStepPress}
                  canShowPassStopOnMap={canShowPassStopOnMap}
                  onPassStopPress={handleRoutePassStopPress}
                  onRevealFirstStop={revealSheetRow}
                  allowEndpointPress
                  forceDark={isDark}
                  primaryTextColor={primaryText}
                  secondaryTextColor={secondaryText}
                  compact
                  inlineStationRail
                  realtimeArrivalsEnabled={!internalPreviewItem && !routeDetailInfo.matchedTimeline}
                />
              ) : (
                <Text style={[styles.sheetEmptyText, { color: secondaryText }]}>
                  저장된 상세 경로가 없어요.
                </Text>
              )}
              {hasDetailedRoute && routeFactLabels.length > 0 && (
                <View style={[styles.expandedRouteFactsFooter, { borderTopColor: sheetBorder }]}>
                  <ScheduleRouteFacts
                    labels={routeFactLabels}
                    color={secondaryText}
                    borderColor={sheetBorder}
                    largeText={largeRouteHeader}
                  />
                </View>
              )}
              {sharedDeparture && (
                <View
                  style={[
                    styles.sheetSharedPeopleSection,
                    { borderTopColor: sheetBorder },
                  ]}
                >
                  <Pressable
                    testID="schedule-route-companions-disclosure"
                    onPress={() => {
                      revealRequest.current += 1;
                      shouldRevealCompanion.current = !participantsExpanded;
                      toggleParticipantsExpanded();
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: participantsExpanded }}
                    accessibilityLabel={`함께하는 사람 ${
                      companionCount
                    }명, ${departedCountLabel}, 참여자 목록 ${
                      participantsExpanded ? '접기' : '보기'
                    }`}
                    style={({ pressed }) => [
                      styles.sheetParticipantDisclosure,
                      { opacity: pressed ? 0.56 : 1 },
                    ]}
                  >
                    <View style={styles.sheetParticipantDisclosureTitle}>
                      <Ionicons
                        name="people-outline"
                        size={16}
                        color={secondaryText}
                      />
                      <View style={[
                        styles.sheetParticipantDisclosureCopy,
                        largeRouteHeader && styles.sheetParticipantDisclosureCopyLarge,
                      ]}>
                        <Text
                          maxFontSizeMultiplier={1.9}
                          style={[styles.sheetSectionTitle, styles.sheetParticipantTitle, { color: primaryText }]}
                        >
                          함께하는 사람 {companionCount}명
                        </Text>
                        <Text maxFontSizeMultiplier={1.65} style={[styles.sheetParticipantSummary, { color: secondaryText }]}>
                          {departedCountLabel}
                        </Text>
                      </View>
                    </View>
                    <Animated.View style={participantDisclosureAnimatedStyle}>
                      <Ionicons name="chevron-down-outline" size={16} color={secondaryText} />
                    </Animated.View>
                  </Pressable>
                  {manualDeparture}
                  {participantsExpanded ? (
                    <View style={styles.sheetParticipantExpandedContent}>
                      {renderRouteCompanions(revealFirstCompanion)}
                    </View>
                  ) : null}
                </View>
              )}
            </>
          </View>
        </Animated.ScrollView>
        </View>
      </View>
    </Animated.View>
  ) : null;
}

const inspectedPlanEntrance = FadeIn.duration(180).reduceMotion(ReduceMotion.System);
const routeSaveFeedbackIn = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const routeSaveFeedbackOut = FadeOut.duration(120).reduceMotion(ReduceMotion.System);
const departureContextIn = new Keyframe({
  0: { opacity: 0.65, transform: [{ translateY: 4 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: Easing.out(Easing.cubic) },
}).duration(180).reduceMotion(ReduceMotion.System);
const departureConfirmedLabelIn = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 3 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: Easing.out(Easing.cubic) },
}).duration(160).reduceMotion(ReduceMotion.System);
const confirmationCheckIn = new Keyframe({
  0: { opacity: 0, transform: [{ perspective: 180 }, { rotateX: '-38deg' }, { scale: 0.82 }] },
  100: {
    opacity: 1,
    transform: [{ perspective: 180 }, { rotateX: '0deg' }, { scale: 1 }],
    easing: Easing.out(Easing.cubic),
  },
}).duration(200).reduceMotion(ReduceMotion.System);

const styles = createScheduleDetailStyles({
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
});
