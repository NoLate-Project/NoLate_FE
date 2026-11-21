import { getUserVisibleScheduleNotes } from '../../modules/schedule/calendarImportNotes';
import { isTransitRideKind } from '../../modules/map/transitModes';
import { PLAIN_SCHEDULE_DETAIL_HEADER_BODY_HEIGHT } from '../../modules/schedule/components/detail/PlainScheduleDetailView';
import {
  buildDepartureParticipantPresentations,
  getDepartureOverview,
  getScheduleCountdownPresentation,
  resolveScheduleCountdownEndAt,
} from '../../modules/schedule/detailPresentation';
import {
  getScheduleDetailLayout,
  getSavedRouteSummaryKind,
  shouldRenderScheduleDetailMap,
} from '../../modules/schedule/savedRouteDetailPresentation';
import { fromISO } from '../../../lib/util/data';
import { APP_ACCENT_BLUE, hhmmText } from './ScheduleDetailChrome';
import {
  formatCompactScheduleRange,
  getDepartureDateLabel,
  getDepartureRemainingLabel,
  routeNumberText,
  travelModeLabel,
} from './scheduleDetailModel';
import type { ScheduleDetailController } from './useScheduleDetailController';
import { getTransitEtaTrustPresentation, SAVED_TRANSIT_ESTIMATE_WARNING } from '../../modules/schedule/transitEtaTrustPresentation';
import { formatTransitWalkingSummary, getTransitRouteWalkingMinutes } from '../../modules/schedule/transitRouteProgress';

function formatRouteHeaderPlaceName(name: string): string {
  // Search results can suffix station names with a transport classification.
  return name.replace(/(역)\s*\[(?:KTX\s*정차역|수도권\s*\d+호선)\]$/u, '$1');
}

/**
 * 컨트롤러의 원시 상태를 일정 상세 각 영역이 바로 표시할 수 있는 읽기 전용 화면 모델로 변환한다.
 * 일정이 아직 없으면 null을 반환해 로딩·오류 화면과 정상 상세 계산의 경계를 명확히 한다.
 */
export function buildScheduleDetailPresentation(
  controller: ScheduleDetailController,
) {
  const {
    currentMemberId,
    currentMemberDepartedAt,
    departureDisplayState,
    departureParticipants,
    displayDestination,
    displayOrigin,
    displayPathOverlays,
    currentTravelMinutes,
    displayTravelMode,
    effectiveTransitRoutePresentation,
    insets,
    inspectedTravelPlan,
    isDark,
    item,
    mapCoords,
    nowMs,
    recommendedDepartureAt,
    routeDetailInfo,
    routeOption,
    savedDisplayTravelMinutes,
  } = controller;
  if (!item) return null;

  const originName = displayOrigin?.name;
  const destinationName = displayDestination?.name;
  const endpointTitle = originName && destinationName
    ? `${originName} → ${destinationName}`
    : undefined;
  const locationTitle =
    item.locationName ||
    endpointTitle ||
    destinationName ||
    originName ||
    '선택된 경로가 없어요';
  const routeIdentityTitle = endpointTitle ?? locationTitle;
  const headerDestination = destinationName && formatRouteHeaderPlaceName(destinationName);
  const headerLocation = item.locationName && formatRouteHeaderPlaceName(item.locationName);
  const compactEndpointTitle = !controller.largeRouteHeader && originName && headerDestination &&
    (inspectedTravelPlan || !headerLocation || headerLocation === headerDestination || item.locationName === endpointTitle)
    ? `${formatRouteHeaderPlaceName(originName)} → ${headerDestination}`
    : undefined;
  const routeTitle = compactEndpointTitle ?? (inspectedTravelPlan ? routeIdentityTitle : locationTitle);
  const savedTravelText = savedDisplayTravelMinutes
    ? `${travelModeLabel(
        displayTravelMode ?? undefined,
      )} ${savedDisplayTravelMinutes}분`
    : travelModeLabel(displayTravelMode ?? undefined);
  // Header/map describe the saved plan, while the lower card describes the current evaluation.
  const travelText = effectiveTransitRoutePresentation ? `저장 경로 · ${savedTravelText}` : savedTravelText;
  const hasDepartureInfo = Boolean(
    recommendedDepartureAt ||
      currentMemberDepartedAt ||
      typeof item.travelMinutes === 'number',
  );
  const departureCompleted = Boolean(currentMemberDepartedAt);
  const sheetBorder = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.11)';
  const primaryText = isDark ? '#F3F4F6' : '#111827';
  const secondaryText = isDark ? '#B8B8B8' : '#64748B';
  const topCardControlBg = isDark
    ? 'rgba(255,255,255,0.07)'
    : 'rgba(15,23,42,0.05)';
  const topCardAccentText = isDark ? '#78B4FF' : APP_ACCENT_BLUE;
  const participantPresentations = buildDepartureParticipantPresentations(
    departureParticipants,
    currentMemberId,
  );
  const travelPlanParticipants = item.travelPlanParticipants ?? [];
  const inspectedParticipant = inspectedTravelPlan
    ? travelPlanParticipants.find(
        participant => participant.memberId === inspectedTravelPlan.memberId,
      )
    : undefined;
  const departureOverview = getDepartureOverview(
    departureParticipants,
    currentMemberId,
  );
  const scheduleRangeLabel = formatCompactScheduleRange(
    item.startAt,
    item.endAt,
    item.hasEndTime !== false,
    item.allDay === true,
  );
  const scheduleCountdownEndAt = resolveScheduleCountdownEndAt({
    startAtMs: fromISO(item.startAt).getTime(),
    endAtMs: fromISO(item.endAt).getTime(),
    hasEndTime: item.hasEndTime !== false,
    allDay: item.allDay,
  });
  const scheduleCountdown = getScheduleCountdownPresentation(
    fromISO(item.startAt).getTime(),
    scheduleCountdownEndAt,
    nowMs,
  );
  const arrivalTimeLabel = hhmmText(fromISO(item.startAt));
  // A saved itinerary can still describe boarding and stops when its line cannot be drawn.
  const hasItineraryDetails = routeDetailInfo?.steps.some(step => isTransitRideKind(step.type)) ?? false;
  const hasRenderablePath = displayPathOverlays.some(overlay => overlay.coords.length >= 2);
  const routeSummaryKind = getSavedRouteSummaryKind(
    hasRenderablePath || hasItineraryDetails,
    savedDisplayTravelMinutes ?? undefined,
  );
  const hasRouteSummary = routeSummaryKind !== 'none';
  const hasDetailedRoute = routeSummaryKind === 'detailed';
  const shouldRenderMap = shouldRenderScheduleDetailMap(
    hasDetailedRoute,
    mapCoords.length,
  );
  const isPlainSchedule =
    getScheduleDetailLayout({
      routeSummaryKind,
      routeSetupRequired: item.routeSetupRequired,
    }) === 'plain';
  const plainHeaderHeight =
    insets.top + PLAIN_SCHEDULE_DETAIL_HEADER_BODY_HEIGHT;
  const showTopRouteBar = !isPlainSchedule;
  const notesText = getUserVisibleScheduleNotes(item.notes);
  const etaTrust = getTransitEtaTrustPresentation({
    travelMode: displayTravelMode,
    status: controller.departureStatus,
    isInspectingTravelPlan: Boolean(inspectedTravelPlan),
    preservingEarlierDeparture: controller.preservingEarlierDeparture,
    intercityJourneySelected: Boolean(routeDetailInfo?.intercityJourney),
    intercityTicketSelected: routeDetailInfo?.intercityJourney?.service.timingBasis === "TICKET",
  });
  // 저장만 한 경로의 반복 안내는 줄이되, 실제 조회가 실패한 사실까지 숨기지 않는다.
  // 다른 참여자의 경로에는 현재 사용자의 조회 실패를 적용하지 않는다.
  const hasFailedTimingLookup = !inspectedTravelPlan && Boolean(controller.departureStatus?.failureReason);
  const isSavedRouteEstimate = etaTrust.warning === SAVED_TRANSIT_ESTIMATE_WARNING && !hasFailedTimingLookup;
  const routeDetailMeta = [
    hasDetailedRoute
      ? isSavedRouteEstimate ? undefined : etaTrust.warning ?? (effectiveTransitRoutePresentation
        ? '지도에 표시된 저장 경로'
        : `${arrivalTimeLabel} 도착`)
      : routeSummaryKind === 'duration_only'
      ? '예상 이동 시간만 저장됨'
      : '이동 경로 미설정',
    hasDetailedRoute && typeof routeOption?.transferCount === 'number'
      ? `환승 ${routeOption.transferCount}회`
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const routeSummaryTitle = hasDetailedRoute
    ? etaTrust.warning || effectiveTransitRoutePresentation
      ? '저장한 경로'
      : '최적 경로'
    : routeSummaryKind === 'duration_only'
    ? '상세 경로 미설정'
    : '저장된 경로 없음';
  const currentRouteDurationLabel = hasRouteSummary
    ? typeof currentTravelMinutes === 'number'
      ? `${currentTravelMinutes}분`
      : routeNumberText(routeOption)
    : '미설정';
  const routeDurationLabel = hasRouteSummary
    ? typeof savedDisplayTravelMinutes === 'number'
      ? `${savedDisplayTravelMinutes}분`
      : routeNumberText(routeOption)
    : '미설정';
  const recordedDepartureAt = currentMemberDepartedAt && !inspectedTravelPlan
    ? fromISO(currentMemberDepartedAt)
    : undefined;
  const displayedDepartureAt = recordedDepartureAt ?? recommendedDepartureAt;
  const departureDateLabel = getDepartureDateLabel(displayedDepartureAt, nowMs);
  const departureRemainingLabel = recordedDepartureAt || departureDateLabel
    ? undefined
    : getDepartureRemainingLabel(departureDisplayState);
  const recommendedDepartureTimeLabel = displayedDepartureAt
    ? hhmmText(displayedDepartureAt)
    : departureDisplayState.kind === 'status'
    ? departureDisplayState.text
    : scheduleCountdown.compactValue;
  const departureTimeLabel = recordedDepartureAt ? '실제 출발' : etaTrust.departureLabel;
  const repeatsHeaderDuration = showTopRouteBar && hasDetailedRoute &&
    !effectiveTransitRoutePresentation && Boolean(savedDisplayTravelMinutes) &&
    currentRouteDurationLabel === routeDurationLabel;
  const routeArrivalSummary = !hasRouteSummary
    ? scheduleRangeLabel
    : isSavedRouteEstimate
    ? undefined
    : etaTrust.warning ?? (repeatsHeaderDuration
      ? `일정 ${arrivalTimeLabel}`
      : `일정 ${arrivalTimeLabel} · 현재 이동 ${currentRouteDurationLabel}`);
  const effectiveRouteAccessibilityLabel = effectiveTransitRoutePresentation
    ? [
        effectiveTransitRoutePresentation.guidanceTitle,
        effectiveTransitRoutePresentation.summary,
        effectiveTransitRoutePresentation.itinerary,
        effectiveTransitRoutePresentation.waitMeta,
        effectiveTransitRoutePresentation.mapNote,
      ]
        .filter(Boolean)
        .join(', ')
    : undefined;
  // A saved ODsay timetable keeps its verified walk lengths in the timeline steps.
  // Older routes can store a physical transfer walk as TRANSFER, which can also mean waiting.
  const transitLegs = routeOption?.transitLegs;
  const timetableSteps = routeDetailInfo?.provider === 'odsay' && routeDetailInfo.timeBasis === 'provider_schedule' &&
    routeDetailInfo.providerTimeBasis === 'timetable' ? routeDetailInfo.steps : undefined;
  const routeWalkingMinutes = timetableSteps
    ? getTransitRouteWalkingMinutes(timetableSteps.filter(step => step.type === 'WALK')
      .map(({ durationMinutes, durationSeconds }) => ({ kind: 'WALK', durationMinutes, durationSeconds })), undefined, true)
    : transitLegs?.length
    ? getTransitRouteWalkingMinutes(transitLegs)
    : routeDetailInfo?.steps.reduce(
      (total, step) =>
        step.type === 'WALK' && typeof step.durationMinutes === 'number'
          ? total + step.durationMinutes
          : total,
      0,
    ) ?? 0;
  const routeFactLabels = effectiveTransitRoutePresentation
    ? []
    : [
        typeof routeDetailInfo?.transferCount === 'number'
          ? `환승 ${routeDetailInfo.transferCount}회`
          : typeof routeOption?.transferCount === 'number'
          ? `환승 ${routeOption.transferCount}회`
          : undefined,
        formatTransitWalkingSummary(routeWalkingMinutes),
        typeof routeDetailInfo?.fare === 'number'
          ? `${routeDetailInfo.fare.toLocaleString()}원`
          : typeof routeOption?.fareWon === 'number'
          ? `${routeOption.fareWon.toLocaleString()}원`
          : undefined,
      ].filter((label): label is string => Boolean(label));

  return {
    ...controller,
    item,
    routeTitle,
    routeIdentityTitle,
    showRouteIdentityInSheet: !showTopRouteBar ||
      (!compactEndpointTitle && !inspectedTravelPlan && routeIdentityTitle !== routeTitle),
    travelText,
    departureTimeLabel,
    hasDepartureInfo,
    departureCompleted,
    sheetBorder,
    primaryText,
    secondaryText,
    topCardControlBg,
    topCardAccentText,
    participantPresentations,
    travelPlanParticipants,
    inspectedParticipant,
    departureOverview,
    scheduleRangeLabel,
    scheduleCountdownEndAt,
    scheduleCountdown,
    arrivalTimeLabel,
    routeSummaryKind,
    hasRouteSummary,
    hasDetailedRoute,
    shouldRenderMap,
    isPlainSchedule,
    plainHeaderHeight,
    showTopRouteBar,
    notesText,
    routeDetailMeta,
    routeSummaryTitle,
    currentRouteDurationLabel,
    routeDurationLabel,
    departureDateLabel,
    departureRemainingLabel,
    recommendedDepartureTimeLabel,
    routeArrivalSummary,
    effectiveRouteAccessibilityLabel,
    routeWalkingMinutes,
    routeFactLabels,
  };
}

/** 정상 일정 상세 영역이 공유하는 계산 완료 화면 모델이다. */
export type ScheduleDetailPresentation = NonNullable<
  ReturnType<typeof buildScheduleDetailPresentation>
>;
