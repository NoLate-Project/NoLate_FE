import { getImportedTicket } from '../../modules/schedule/importedTicket';
import { ImportedTicketDisclosure } from '../../modules/schedule/components/detail/ImportedTicketSummary';
import ScheduleSharingInformation from '../../modules/schedule/components/detail/ScheduleSharingInformation';
import React, { useMemo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Reanimated, { Easing, FadeIn, FadeOut, Keyframe, ReduceMotion } from 'react-native-reanimated';
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { SavedJourneyRouteTimeline } from '../../modules/journey/SavedJourneyRouteTimeline';
import LoadingIndicator from '../../ui/LoadingIndicator';
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
import { SavedJourneyInstruction } from '../../modules/journey/SavedJourneyGuidanceCard';
import { RouteSheetOverview } from './RouteSheetOverview';
import { presentPlannedJourneyRouteLayout } from '../../modules/journey/savedJourneyRouteLayout';
import { JourneyNavigationOptions } from '../../modules/journey/JourneyNavigationOptions';
import { SavedJourneyRouteBar } from '../../modules/journey/SavedJourneyRouteBar';
import { useSavedJourneyGuidanceView } from '../../modules/journey/useSavedJourneyGuidanceView';
import { buildSavedJourneyInput } from '../../modules/journey/savedJourneyGuidance';
import { journeyDisplayName } from '../../modules/journey/journeyRouteInput';
import { SavedJourneyTrialControls, type SavedDepartureRequest } from '../../modules/journey/SavedJourneyTrialControls';
import { isAutomaticJourneyEntryEnabled } from '../../modules/journey/journeyFeature';
import { savedWalkingBaseJSON } from '../../modules/journey/serverWalkingSnapshot';
import { SAVED_JOURNEY_MOTION } from '../../modules/journey/savedJourneyMotion';

type ScheduleDetailRouteSheetProps = {
  presentation: ScheduleDetailPresentation;
  companionCount: number;
  onStartDriving?: () => void;
  renderRouteCompanions: (
    onFirstRowLayout: (row: View) => void,
    onFailureLayout: (message: Text) => void,
  ) => React.ReactNode;
};

/** 경로 요약과 펼친 상세 정보를 드래그 가능한 하단 시트로 표시한다. */
export function ScheduleDetailRouteSheet({
  presentation,
  companionCount,
  onStartDriving,
  renderRouteCompanions,
}: ScheduleDetailRouteSheetProps) {
  const routePlannerButton = useRef<View>(null);
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
    guidanceResumeHandoff,
    navigationMode,
    navigationEnd,
    navigationReconciling,
    isPlainSchedule,
    item,
    liveActivityEntry,
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
    routePlanTimeLabel,
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
  const inspectedPlanTitle = inspectedParticipantName ? `${inspectedParticipantName}의 경로` : '동행자 경로';
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
  const guidance = useSavedJourneyGuidanceView(guidanceInput, String(item.id));
  const displayedGuidanceInput = guidance.input ?? guidanceInput;
  const guidanceBinding = guidance.binding;
  const authenticatedGuidanceEntry = isAutomaticJourneyEntryEnabled()
    && !internalPreviewItem && presentation.authoritativeDetailLoaded && !presentation.loadError
    && (item.myTravelPlan?.travelMode ?? item.travelMode) === 'TRANSIT'
    && presentation.currentMemberId != null
    && !inspectedTravelPlan && (item.myTravelPlan?.memberId ?? item.ownerMemberId) === presentation.currentMemberId;
  const departureScope = useMemo(() => authenticatedGuidanceEntry && guidanceInput
    ? JSON.stringify([item.id, presentation.currentMemberId, savedWalkingBaseJSON(guidanceInput)]) : null,
  [authenticatedGuidanceEntry, guidanceInput, item.id, presentation.currentMemberId]);
  const departureIntent = useRef<AbortController | null>(null);
  const [requestedDeparture, setRequestedDeparture] = useState<SavedDepartureRequest | null>(null);
  // Opening a URL or returning to the app must never create a new start request.
  useLayoutEffect(() => {
    const cancel = () => { departureIntent.current?.abort(); departureIntent.current = null; };
    const subscription = AppState.addEventListener('change', state => { if (state === 'background') cancel(); });
    return () => { cancel(); subscription.remove(); };
  }, [departureScope, presentation.scheduleScreenVisible]);
  const guidancePrepared = guidanceBinding?.savedRouteValidated === true && guidanceBinding.guidanceEnabled === true
    && guidanceBinding.scheduleId === String(item.id);

  const departureFailed = departureSubmissionStatus === 'failed' && !departureCompleted && !journeyGuidanceAvailable;
  const departureActionDisabled = departureActionPending || routeSavePending;
  const sharedDeparture = companionCount > 1;
  const departureActionLabel = departureCompleted ? '길안내 보기' : onStartDriving ? '지금 출발' : '안내 시작';
  const routeSaveSucceeded = routeSaveConfirmed && !routeSavePending && !canRetryRouteSave;
  const expanded = sheetMode === 'expanded';
  const { value: guidanceValue, stage: guidanceStage, position: guidancePosition, layout: guidanceLayout } = guidance;
  const plannedGuidanceLayout = useMemo(() => displayedGuidanceInput && !largeRouteHeader
    ? presentPlannedJourneyRouteLayout(displayedGuidanceInput, presentation.routeProgressSegments) : null,
  [displayedGuidanceInput, largeRouteHeader, presentation.routeProgressSegments]);
  const previousLocation = useRef<{ sessionId: string | null; unavailable: boolean } | null>(null);
  const guidanceSessionId = guidanceBinding?.scheduleId === String(item.id) ? guidanceBinding.sessionId : null;
  const locationUnavailable = !!guidanceStage && guidanceValue?.phase !== 'READY' && !guidancePosition;
  const positionRecovered = !!guidancePosition && !!guidanceSessionId && previousLocation.current?.sessionId === guidanceSessionId
    && previousLocation.current.unavailable;
  useLayoutEffect(() => {
    previousLocation.current = { sessionId: guidanceSessionId, unavailable: locationUnavailable };
  }, [guidanceSessionId, locationUnavailable]);
  const automaticGuidanceActive = !!guidanceBinding && (guidance.snapshot == null ||
    (guidance.snapshot.sessionId === guidanceBinding.sessionId &&
      (guidance.snapshot.status === 'ARMED' || guidance.snapshot.status === 'ACTIVE')));
  const mapFocusedSession = useRef<string | null>(null);
  useEffect(() => {
    if (!navigationMode || !automaticGuidanceActive || !guidanceSessionId || liveActivityEntry) return;
    if (mapFocusedSession.current === guidanceSessionId) return;
    mapFocusedSession.current = guidanceSessionId;
    // An atomic reroute changes the server session ID. Keep the user's open detail
    // sheet so the newly admitted origin and remaining legs are immediately visible.
    if (sheetMode !== 'compact' && guidanceBinding?.rerouteValidated !== true) snapSheet('compact');
  }, [automaticGuidanceActive, guidanceSessionId, guidanceBinding?.rerouteValidated,
    liveActivityEntry, navigationMode, sheetMode, snapSheet]);
  const recentEndHere = navigationMode && navigationEnd?.scheduleId === String(item.id) && !automaticGuidanceActive;
  const endedGuidance = recentEndHere || navigationMode && presentation.guidanceEndedHandoff || navigationMode && !!guidanceBinding
    && guidance.snapshot?.sessionId === guidanceBinding.sessionId
    && (guidance.snapshot.status === 'STOPPED' || guidance.snapshot.status === 'EXPIRED');
  const arrivedGuidance = recentEndHere
    ? navigationEnd?.reason === 'DESTINATION_ARRIVED'
    : endedGuidance && guidance.snapshot?.status === 'STOPPED'
      && guidance.snapshot.qualityReason === 'DESTINATION_ARRIVED';
  const navigationReady = navigationMode && authenticatedGuidanceEntry && !automaticGuidanceActive && !guidanceResumeHandoff
    && !navigationReconciling;
  const navigationHeroActive = navigationReady || automaticGuidanceActive || navigationReconciling;
  const firstBoardingName = journeyDisplayName(displayedGuidanceInput?.legs[1]?.stops?.[0]?.name);
  const firstWalkMeters = displayedGuidanceInput?.legs[0]?.display?.distanceMeters;
  const plannedWalk = typeof firstWalkMeters === 'number' && Number.isFinite(firstWalkMeters)
    && firstWalkMeters > 0 && firstWalkMeters <= 100_000 ? ` · 도보 약 ${Math.ceil(firstWalkMeters / 10) * 10}m` : '';
  const nextPlannedStep = firstBoardingName ? `${firstBoardingName}까지${plannedWalk}` : '첫 승차 지점까지 이동할 경로를 확인해요';
  const showNavigationDock = navigationMode && authenticatedGuidanceEntry && automaticGuidanceActive && !!displayedGuidanceInput;
  const [optionsKey, setOptionsKey] = useState<string | null>(null);
  const activeMenuKey = showNavigationDock && guidance.snapshot?.sessionId === guidanceSessionId && guidanceSessionId
    ? JSON.stringify([departureScope, guidanceSessionId, guidanceBinding?.generation]) : null;
  const idleMenuKey = authenticatedGuidanceEntry && !navigationMode && !automaticGuidanceActive
    ? departureScope ?? item.id : null;
  const visibleMenuKey = presentation.scheduleScreenVisible ? activeMenuKey ?? idleMenuKey : null;
  useEffect(() => { setOptionsKey(current => current === visibleMenuKey ? current : null); }, [visibleMenuKey]);
  const [dockRowHeight, setDockRowHeight] = useState(52);
  const browseRoute = hasDetailedRoute && displayTravelMode === 'TRANSIT' && !largeRouteHeader
    && !inspectedTravelPlan && !navigationMode && !automaticGuidanceActive;
  const showBrowseDock = browseRoute && journeyGuidanceAvailable && authenticatedGuidanceEntry;
  const [browseDockRowHeight, setBrowseDockRowHeight] = useState(64);
  const dockReserve = showNavigationDock ? dockRowHeight : showBrowseDock ? browseDockRowHeight : 0;
  const coveredBottom = sheetBottomPadding + dockReserve;
  const actionInSummary = !expanded && !navigationHeroActive;
  const showDepartureInHeader = expanded && hasDetailedRoute && !navigationHeroActive && !inspectedTravelPlan && !browseRoute;
  const [openedGuidanceSchedule, setOpenedGuidanceSchedule] = useState<string>();
  const keepsGuidanceControls = authenticatedGuidanceEntry && (navigationMode || largeRouteHeader
    && (expanded || showNavigationDock || openedGuidanceSchedule === String(item.id)));
  const showGuidanceControlsFirst = navigationMode || navigationHeroActive || !hasDetailedRoute;
  useEffect(() => {
    if (expanded && authenticatedGuidanceEntry) setOpenedGuidanceSchedule(String(item.id));
  }, [expanded, authenticatedGuidanceEntry, item.id]);
  const { height: windowHeight } = useWindowDimensions();
  const scrollOffset = useRef(0);
  const busBoardingOffset = useRef(new Animated.Value(0)).current;
  useLayoutEffect(() => {
    if (!navigationMode) return;
    scrollOffset.current = 0;
    busBoardingOffset.setValue(0);
    sheetScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [navigationMode, busBoardingOffset, sheetScrollRef]);
  const revealRequest = useRef(0);
  const sheetHeader = useRef<View>(null);
  const shouldRevealCompanion = useRef(false);
  const selectedStopRow = useRef<View>(null);
  const currentGuidanceRow = useRef<View>(null);
  const revealedActivityEntry = useRef<string | undefined>(undefined);
  useEffect(() => () => { revealRequest.current += 1; }, [expanded, routeDetailInfo]);

  const currentActivityLeg = guidanceStage?.activeLegIndex;
  const hasGuidanceStage = guidanceStage != null;
  useEffect(() => {
    if (!liveActivityEntry || !expanded || revealedActivityEntry.current === liveActivityEntry) return;
    if (currentActivityLeg == null && hasGuidanceStage) {
      // A confirmed unknown/ready state has no active row to reveal.
      revealedActivityEntry.current = liveActivityEntry;
      return;
    }
    if (currentActivityLeg == null) return;
    const request = ++revealRequest.current;
    const reveal = () => {
      const scroll = sheetScrollRef.current;
      const viewport = scroll?.getNativeScrollRef();
      const row = currentGuidanceRow.current;
      if (!scroll || !viewport || !row || request !== revealRequest.current) return;
      viewport.measureInWindow((_x, top, _width, height) => {
        row.measureInWindow((_rowX, rowTop, _rowWidth, rowHeight) => {
          if (request !== revealRequest.current || row !== currentGuidanceRow.current || height <= 0 || rowHeight <= 0) return;
          revealedActivityEntry.current = liveActivityEntry;
          const remaining = Math.min(top + height, windowHeight) - coveredBottom - 12;
          const offset = rowTop < top + 12 || rowTop + rowHeight > remaining ? rowTop - top - 12 : 0;
          if (Math.abs(offset) >= 1) {
            scroll.scrollTo({ y: Math.max(0, scrollOffset.current + offset), animated: false });
          }
        });
      });
    };
    if (reduceMotion) {
      const frame = requestAnimationFrame(reveal);
      return () => cancelAnimationFrame(frame);
    }
    const timer = setTimeout(reveal, SAVED_JOURNEY_MOTION.activityHandoffMs);
    return () => clearTimeout(timer);
  }, [currentActivityLeg, expanded, hasGuidanceStage, liveActivityEntry, reduceMotion, coveredBottom, sheetScrollRef, windowHeight]);

  const hasSelectedRoutePassStop = selectedRoutePassStop != null;
  useEffect(() => {
    if (!expanded || !hasSelectedRoutePassStop || navigationReady) return;
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
          const bottom = viewportHeight - coveredBottom - 12;
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
  }, [expanded, hasSelectedRoutePassStop, navigationReady, selectedRoutePassStop?.stepId, selectedRoutePassStop?.stopIndex, reduceMotion, coveredBottom, sheetScrollRef]);

  const openGuidanceControls = () => {
    sheetScrollRef.current?.scrollTo({ y: 0, animated: false });
    snapSheet('expanded');
  };

  const revealSheetRow = (row: Pick<View, 'measureInWindow'>, animated: boolean, boardingRow?: View) => {
    const scroll = sheetScrollRef.current;
    const viewport = scroll?.getNativeScrollRef();
    if (!expanded || !scroll || !viewport) return;
    const request = ++revealRequest.current;
    viewport.measureInWindow((_x, viewportTop, _width, viewportHeight) => {
      row.measureInWindow((_rowX, rowTop, _rowWidth, rowHeight) => {
        if (request !== revealRequest.current || rowHeight <= 0 || viewportHeight <= 0) return;
        const visibleBottom = Math.min(viewportTop + viewportHeight, windowHeight) - coveredBottom;
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

  const offersTransitStart = !onStartDriving && !departureCompleted && !!departureScope;
  const departNow = () => {
    if (onStartDriving) { onStartDriving(); return; }
    if (offersTransitStart && departureScope && presentation.scheduleScreenVisible) {
      departureIntent.current?.abort();
      const intent = new AbortController();
      departureIntent.current = intent;
      setRequestedDeparture({ scope: departureScope, signal: intent.signal, claimed: false });
    }
    void completeDeparture();
  };
  const departureButton = !inspectedTravelPlan && !navigationMode && !automaticGuidanceActive
    && (onStartDriving || (journeyGuidanceAvailable && authenticatedGuidanceEntry)) ? (
    <Pressable
      testID="schedule-route-departure-action"
      onPress={departNow}
      disabled={departureActionDisabled}
      accessibilityRole="button"
      accessibilityLabel={departureActionLabel}
      accessibilityHint={onStartDriving ? "주행 지도를 열고 현재 위치에 따라 회전과 남은 거리를 안내합니다."
        : offersTransitStart ? "이 경로에서 최대 2시간 위치를 사용해 길안내를 시작합니다. 이동하면 출발을 기록합니다." : "저장된 경로의 길안내 화면을 엽니다."}
      accessibilityState={{ busy: departureActionDisabled, disabled: departureActionDisabled }}
      style={({ pressed }) => [
        styles.sheetDepartureAction,
        offersTransitStart ? styles.transitStartButton : largeRouteHeader ? styles.sheetDepartureActionLarge : (actionInSummary || showDepartureInHeader) && styles.sheetDepartureActionInline,
        browseRoute && navigationStyles.browseStartButton,
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
  const departureAction = offersTransitStart && departureButton && largeRouteHeader ? (
    <View style={[styles.transitDepartureActions, largeRouteHeader && styles.sheetDepartureActionLarge]}>
      <Pressable testID="schedule-route-guidance-settings" accessibilityRole="button" accessibilityLabel="길안내 설정"
        accessibilityHint="출발 전에 음성과 알림 방식을 선택합니다." onPress={() => setOptionsKey(idleMenuKey)}
        disabled={departureActionDisabled} style={styles.transitSettingsButton}>
        <Ionicons name="menu-outline" size={23} color={topCardAccentText} />
      </Pressable>
      {departureButton}
    </View>
  ) : departureButton;

  const showRouteActions = hasDetailedRoute && !largeRouteHeader && !inspectedTravelPlan
    && !navigationMode && !automaticGuidanceActive;
  const routeActions = showRouteActions ? (
    <View testID="schedule-route-secondary-actions" style={styles.routeSecondaryActions}>
      <Pressable ref={routePlannerButton}
        accessibilityRole="button" accessibilityLabel="길찾기에서 경로 보기"
        accessibilityState={{ busy: routeSavePending, disabled: routeSavePending }}
        disabled={routeSavePending}
        onPress={() => openCurrentRoutePlanner(() => {
          if (routePlannerButton.current) AccessibilityInfo.sendAccessibilityEvent?.(routePlannerButton.current, 'focus');
        })}
        style={({ pressed }) => [styles.routeSecondaryAction, { opacity: routeSavePending ? 0.35 : pressed ? 0.58 : 1 }]}
      >
        {routeSavePending ? <LoadingIndicator size="inline" delayMs={150} />
          : <Ionicons name="map-outline" size={16} color={secondaryText} />}
        <Text style={[styles.routeSecondaryActionLabel, { color: secondaryText }]}>길찾기</Text>
      </Pressable>
      {!browseRoute && offersTransitStart && departureButton && <Pressable
        testID="schedule-route-guidance-settings" accessibilityRole="button" accessibilityLabel="안내 설정"
        accessibilityHint="출발 전에 음성과 알림 방식을 선택합니다."
        accessibilityState={{ disabled: departureActionDisabled, expanded: !!idleMenuKey && optionsKey === idleMenuKey }}
        onPress={() => setOptionsKey(idleMenuKey)} disabled={departureActionDisabled}
        style={({ pressed }) => [styles.routeSecondaryAction, { opacity: departureActionDisabled ? 0.35 : pressed ? 0.58 : 1 }]}
      >
        <Ionicons name="options-outline" size={16} color={secondaryText} />
        <Text style={[styles.routeSecondaryActionLabel, { color: secondaryText }]}>안내 설정</Text>
      </Pressable>}
    </View>
  ) : null;

  const overview = browseRoute ? <RouteSheetOverview minutes={presentation.displayedRouteMinutes}
    fallback={routeDurationLabel} departureClock={recommendedDepartureTimeLabel}
    departureDate={departureDateLabel} departed={departureCompleted}
    primary={primaryText} secondary={secondaryText}
    warning={routeDetailInfo?.intercityJourney ? undefined : routeArrivalSummary} /> : null;

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
      onPress={onStartDriving ?? completeDeparture}
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
      {departureActionPending ? <LoadingIndicator size="inline" delayMs={150} /> : (
        <Ionicons
          name={departureFailed ? 'refresh-outline' : sharedDeparture ? 'time-outline' : 'notifications-off-outline'}
          size={18}
          color={topCardAccentText}
        />
      )}
      <Text style={[styles.manualDepartureText, { color: topCardAccentText }]}>{manualDepartureLabel}</Text>
    </Pressable>
  ) : null;

  const showDepartureInBody = !navigationHeroActive && !showDepartureInHeader;
  const showExpandedStatus = !browseRoute && (showDepartureInBody || showRouteIdentityInSheet ||
    Boolean(arrivalSummary || (!sharedDeparture && manualDeparture)));
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

  const guidanceControls = keepsGuidanceControls ? (
    <SavedJourneyTrialControls key={String(item.id)} input={guidanceInput} savedRoute={item.route} isDark={isDark}
      navigationMenu={showNavigationDock ? { open: !!activeMenuKey && optionsKey === activeMenuKey && presentation.scheduleScreenVisible,
        close: () => setOptionsKey(null) } : undefined}
      autoPrepareRoute={navigationMode && !guidanceResumeHandoff}
      departureRequest={navigationMode && !liveActivityEntry && presentation.scheduleScreenVisible && departureScope
        && requestedDeparture?.scope === departureScope ? requestedDeparture : undefined}
      statusShownInRouteHeader={endedGuidance || automaticGuidanceActive && !!guidanceStage && !!guidanceValue}
      authenticatedSchedule={{ scheduleId: String(item.id), memberId: presentation.currentMemberId! }} />
  ) : null;

  return !isPlainSchedule ? (
    <>
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
              style={({ pressed }) => [styles.sheetHandleButton, automaticGuidanceActive && styles.guidanceSheetHandle,
                { opacity: pressed ? 0.62 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={automaticGuidanceActive ? (expanded ? '저장 경로 접기' : '저장 경로 보기')
                : expanded ? '경로 시트 접기' : '경로 시트 펼치기'}
              accessibilityState={{ expanded }}
              onPress={() => snapSheet(expanded ? 'compact' : 'expanded')}
            >
              {automaticGuidanceActive && (
                <Text maxFontSizeMultiplier={2} style={[styles.guidanceSheetLabel, { color: topCardAccentText }]}>
                  {expanded ? '저장 경로 접기' : '저장 경로 보기'}
                </Text>
              )}
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
          {navigationReady && (!endedGuidance || expanded) && (
            <View testID="schedule-route-navigation-ready" style={navigationStyles.ready}>
              <View style={navigationStyles.readyCopy}>
                <Text accessibilityRole="header" style={[navigationStyles.readyTitle, { color: primaryText }]}>
                  {arrivedGuidance ? '목적지에 도착했어요' : endedGuidance ? '위치 안내가 끝났어요' : '출발 전'}
                </Text>
                <Text style={[navigationStyles.readyNext, { color: topCardAccentText }]}>
                  {endedGuidance ? '저장한 경로는 계속 볼 수 있어요' : nextPlannedStep}
                </Text>
              </View>
            </View>
          )}
          {navigationReconciling && <View style={navigationStyles.ready} accessibilityLiveRegion="polite">
            <Text accessibilityRole="header" style={[navigationStyles.readyTitle, { color: primaryText }]}>
              안내 상태를 확인 중이에요
            </Text>
          </View>}
          {automaticGuidanceActive && !navigationMode && guidanceStage && guidanceValue && (
            <SavedJourneyInstruction stage={guidanceStage} value={guidanceValue} isDark={isDark} reduceMotion={reduceMotion}
              legKind={guidanceStage.activeLegIndex == null ? undefined : displayedGuidanceInput?.legs[guidanceStage.activeLegIndex]?.kind} />
          )}
          {inspectedTravelPlan && (
            <Reanimated.View
              entering={inspectedPlanEntrance}
              style={[styles.inspectedPlanBar, { backgroundColor: topCardControlBg }]}
            >
              <View
                accessible
                accessibilityRole="text"
                accessibilityLabel={inspectedPlanTitle}
                style={styles.inspectedPlanIdentity}
              >
                <Ionicons name="person-circle-outline" size={19} color={topCardAccentText} />
                {inspectedParticipantName && !largeRouteHeader ? (
                  <View style={[styles.inspectedPlanTitle, styles.inspectedPlanTitleRow]}>
                    <Text
                      numberOfLines={1}
                      maxFontSizeMultiplier={1.9}
                      style={[styles.inspectedPlanText, styles.inspectedPlanName, { color: primaryText }]}
                    >
                      {inspectedParticipantName}
                    </Text>
                    <Text numberOfLines={1} maxFontSizeMultiplier={1.9} style={[styles.inspectedPlanText, { color: primaryText }]}>
                      의 경로
                    </Text>
                  </View>
                ) : (
                  <Text maxFontSizeMultiplier={1.9} style={[styles.inspectedPlanText, styles.inspectedPlanTitle, { color: primaryText }]}>
                    {inspectedPlanTitle}
                  </Text>
                )}
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
          {authenticatedGuidanceEntry && navigationReady && !endedGuidance && !expanded && (
            <Pressable
              testID="schedule-route-guidance-entry"
              accessibilityRole="button"
              accessibilityLabel="위치 안내 준비"
              accessibilityHint="같은 경로 시트에서 안내 설정을 엽니다"
              onPress={openGuidanceControls}
              style={({ pressed }) => [
                styles.sheetDepartureAction,
                largeRouteHeader && styles.sheetDepartureActionLarge,
                { backgroundColor: topCardControlBg, opacity: pressed ? 0.64 : 1 },
              ]}
            >
              <Ionicons name="navigate-outline" size={16} color={topCardAccentText} />
              <Text maxFontSizeMultiplier={2} style={[styles.sheetDepartureActionText, { color: primaryText }]}>위치 안내 준비</Text>
              <Ionicons name="chevron-up-outline" size={15} color={secondaryText} />
            </Pressable>
          )}
          {browseRoute && expanded && overview}
          {!browseRoute && (showDepartureInHeader ? (
            <View style={[styles.expandedDepartureHeader, largeRouteHeader && styles.expandedDepartureHeaderLarge]}>
              <Reanimated.View entering={departureContextIn} style={!largeRouteHeader && styles.expandedDepartureHeaderCopy}>
                {departureContext}
              </Reanimated.View>
              {departureAction}
            </View>
          ) : !actionInSummary && departureAction)}
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
                    <LoadingIndicator size="inline" delayMs={150} />
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
          reservedFooterHeight={dockReserve}
          automaticGuidanceActive={navigationHeroActive}
          navigationInstruction={navigationHeroActive && automaticGuidanceActive && guidanceStage && guidanceValue && (
            <View testID="schedule-navigation-next-step">
              <SavedJourneyInstruction stage={guidanceStage} value={guidanceValue} isDark={isDark}
                reduceMotion={reduceMotion} compact={navigationMode}
                legKind={guidanceStage.activeLegIndex == null ? undefined
                  : displayedGuidanceInput?.legs[guidanceStage.activeLegIndex]?.kind} />
            </View>
          )}
          automaticRouteSummary={!showNavigationDock && navigationHeroActive && displayedGuidanceInput && (
            <SavedJourneyRouteBar input={displayedGuidanceInput} position={expanded ? null : guidancePosition}
              layout={guidanceLayout ?? plannedGuidanceLayout} compact isDark={isDark} showCopy={false} recovery={positionRecovered}
              navigation={navigationMode} trackingLocation={!endedGuidance} />
          )}
          departureAction={actionInSummary ? departureAction : null}
          secondaryActions={actionInSummary && !browseRoute ? routeActions : null}
          overview={actionInSummary ? overview : undefined}
        />
        <Animated.ScrollView
          ref={sheetScrollRef}
          pointerEvents={expanded ? 'auto' : 'none'}
          style={[styles.sheetScroll, sheetExpandedContentAnimatedStyle]}
          contentContainerStyle={[
            styles.sheetScrollContent,
            { paddingBottom: coveredBottom },
          ]}
          showsVerticalScrollIndicator={false}
          onScroll={event => {
            scrollOffset.current = event.nativeEvent.contentOffset.y;
            if (expanded && !largeRouteHeader) busBoardingOffset.setValue(scrollOffset.current);
          }}
          onScrollBeginDrag={() => {
            revealRequest.current += 1;
            revealedActivityEntry.current = liveActivityEntry;
          }}
          scrollEventThrottle={16}
          bounces={false}
          scrollEnabled={sheetMode === 'expanded'}
          accessibilityElementsHidden={!expanded}
          importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
        >
          {showGuidanceControlsFirst && guidanceControls}
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

                  {showDepartureInBody && departureContext}
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
                        name="swap-horizontal-outline"
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
              {!browseRoute && <View
                collapsable={false}
                style={[
                  styles.sheetRouteSummary,
                  !largeRouteHeader && styles.compactRouteSectionSpacing,
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
                        style={[styles.sheetRouteTitle, !largeRouteHeader && styles.compactRouteSheetHeading, { color: primaryText }]}
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
                  {!hasDetailedRoute || (!inspectedTravelPlan && !showRouteActions) ? (
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
                          ref={routePlannerButton}
                          onPress={() => openCurrentRoutePlanner(() => {
                            if (routePlannerButton.current) AccessibilityInfo.sendAccessibilityEvent?.(routePlannerButton.current, 'focus');
                          })}
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
                              backgroundColor: pressed || (hasDetailedRoute && largeRouteHeader)
                                ? topCardControlBg
                                : 'transparent',
                              opacity: routeSavePending
                                ? 0.35
                                : pressed
                                ? 0.58
                                : 1,
                            },
                            hasDetailedRoute && !largeRouteHeader && styles.compactRoutePlannerLink,
                          ]}
                        >
                          {routeSavePending ? (
                            <LoadingIndicator size="inline" delayMs={150} />
                          ) : (
                            (largeRouteHeader || !hasDetailedRoute) && <Ionicons
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
                  {!actionInSummary && routeActions}
                </View>
                {!largeRouteHeader && hasDetailedRoute && routePlanTimeLabel && (
                  <Text testID="schedule-route-plan-time" style={[styles.routePlanTimeText, { color: secondaryText }]}>
                    {routePlanTimeLabel}
                  </Text>
                )}
                {hasDetailedRoute && routeDetailInfo && inspectedTravelPlan && largeRouteHeader ? (
                  <Text style={[styles.routeDetailBaseTimeText, { color: secondaryText }]}>
                    {hhmmText(fromISO(routeDetailInfo.departureTime))} 출발 기준
                  </Text>
                ) : null}
              </View>}

              {hasDetailedRoute && routeDetailInfo ? (
                <SavedJourneyRouteTimeline
                  input={displayedGuidanceInput}
                  guidance={guidance}
                  currentGuidanceRowRef={currentGuidanceRow}
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
                  showEstimatedClockHeading={false}
                  busBoardingScroll={expanded && !largeRouteHeader ? {
                    ref: sheetScrollRef,
                    offset: busBoardingOffset,
                    surface: (isDark ? styles.panelOpaqueBackdropDark : styles.panelOpaqueBackdropLight).backgroundColor,
                    border: sheetBorder,
                  } : undefined}
                  realtimeArrivalsEnabled={!internalPreviewItem && !routeDetailInfo.matchedTimeline}
                  realtimeArrivalsActive={expanded}
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
              {expanded && <ScheduleSharingInformation item={item} />}
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
                      {renderRouteCompanions(revealFirstCompanion, message => revealSheetRow(message, !reduceMotion))}
                    </View>
                  ) : null}
                </View>
              )}
            </>
          </View>
          {!showGuidanceControlsFirst && guidanceControls}
          {!navigationMode && sheetMode === 'expanded' && getImportedTicket(item.route) && (
            <ImportedTicketDisclosure key={item.id} route={item.route} />
          )}
        </Animated.ScrollView>
        </View>
      </View>
    </Animated.View>
    {showBrowseDock && departureButton && <View testID="route-browse-action-dock"
      style={[navigationStyles.dock, { paddingBottom: presentation.insets.bottom, borderColor: sheetBorder,
        backgroundColor: isDark ? '#171A20' : '#F6F8FA' }]}>
      <View style={navigationStyles.browseDockRow}
        onLayout={event => setBrowseDockRowHeight(Math.ceil(event.nativeEvent.layout.height))}>
        <Pressable ref={routePlannerButton} testID="schedule-route-guidance-settings" accessibilityRole="button"
          accessibilityLabel="안내 설정" accessibilityHint="출발 전에 음성과 알림 방식을 선택합니다."
          disabled={departureActionDisabled} accessibilityState={{ disabled: departureActionDisabled }}
          onPress={() => setOptionsKey(idleMenuKey)}
          style={({ pressed }) => [styles.routeSecondaryAction, { opacity: pressed || departureActionDisabled ? 0.5 : 1 }]}>
          <Ionicons name="options-outline" size={17} color={secondaryText} />
          <Text style={[styles.routeSecondaryActionLabel, { color: secondaryText }]}>안내 설정</Text>
        </Pressable>
        <View style={navigationStyles.browseDeparture}>{departureButton}</View>
      </View>
    </View>}
    {showNavigationDock && displayedGuidanceInput && (
      <View style={[navigationStyles.dock, {paddingBottom: presentation.insets.bottom, borderColor: sheetBorder,
        backgroundColor: isDark ? '#13171D' : '#FFFFFF'}]}>
        <View testID="journey-navigation-footer" style={navigationStyles.dockRow}
          onLayout={event => setDockRowHeight(Math.ceil(event.nativeEvent.layout.height))}>
          <View style={navigationStyles.dockRail}>
            <SavedJourneyRouteBar input={displayedGuidanceInput} position={guidancePosition}
              layout={guidanceLayout ?? plannedGuidanceLayout} compact navigation docked isDark={isDark} showCopy={false}
              dockCaption={expanded && guidanceStage && guidanceValue
                ? <SavedJourneyInstruction stage={guidanceStage} value={guidanceValue} isDark={isDark} reduceMotion={reduceMotion} inFooter />
                : undefined}
              recovery={positionRecovered} />
          </View>
          <Pressable testID="journey-navigation-menu" accessibilityRole="button" accessibilityLabel="길안내 옵션 열기"
            disabled={!activeMenuKey} accessibilityState={{disabled: !activeMenuKey, expanded: !!activeMenuKey && optionsKey === activeMenuKey}}
            onPress={() => setOptionsKey(activeMenuKey)}
            style={({pressed}) => [navigationStyles.menuButton, {borderLeftColor: sheetBorder, opacity: pressed ? 0.55 : 1}]}>
            <Ionicons name="menu-outline" size={27} color={primaryText} />
          </Pressable>
        </View>
      </View>
    )}
    {idleMenuKey && optionsKey === idleMenuKey && presentation.scheduleScreenVisible &&
      <JourneyNavigationOptions dark={isDark} onClose={() => setOptionsKey(null)}
        onChangeRoute={browseRoute ? () => {
          setOptionsKey(null);
          openCurrentRoutePlanner(() => {
            if (routePlannerButton.current) AccessibilityInfo.sendAccessibilityEvent?.(routePlannerButton.current, 'focus');
          });
        } : undefined}
        onPrepare={browseRoute ? undefined : () => { setOptionsKey(null); void completeDeparture(); }}/>
}
    </>
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

const navigationStyles = StyleSheet.create({
  browseDockRow: { minHeight: 64, paddingHorizontal: 20, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  browseDeparture: { flex: 1, alignItems: 'stretch' },
  browseStartButton: { alignSelf: 'stretch', minHeight: 48, marginBottom: 0, borderRadius: 12 },
  dock: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 29, borderTopWidth: StyleSheet.hairlineWidth },
  dockRow: { minHeight: 52, paddingHorizontal: 12, paddingVertical: 3, flexDirection: 'row', alignItems: 'center' },
  dockRail: { flex: 1, minWidth: 0 },
  menuButton: { width: 52, minHeight: 44, borderLeftWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  ready: { paddingHorizontal: 16, paddingVertical: 5 },
  readyCopy: { gap: 2 },
  readyTitle: { fontSize: 18, fontWeight: '700' },
  readyNext: { fontSize: 14, fontWeight: '600' },
});
