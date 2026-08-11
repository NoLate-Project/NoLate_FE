import { getUserVisibleScheduleNotes } from "../../src/modules/schedule/calendarImportNotes";
import { PLAIN_SCHEDULE_DETAIL_HEADER_BODY_HEIGHT } from "../../src/modules/schedule/components/detail/PlainScheduleDetailView";
import {
  buildDepartureParticipantPresentations,
  getDepartureOverview,
  getScheduleCountdownPresentation,
  resolveScheduleCountdownEndAt,
} from "../../src/modules/schedule/detailPresentation";
import {
  getScheduleDetailLayout,
  getSavedRouteSummaryKind,
  shouldRenderScheduleDetailMap,
} from "../../src/modules/schedule/savedRouteDetailPresentation";
import { fromISO } from "../../lib/util/data";
import { APP_ACCENT_BLUE, hhmmText } from "./ScheduleDetailChrome";
import {
  formatCompactScheduleRange,
  getDepartureRemainingLabel,
  routeNumberText,
  travelModeLabel,
} from "./scheduleDetailModel";
import type { ScheduleDetailController } from "./useScheduleDetailController";

/**
 * 컨트롤러의 원시 상태를 일정 상세 각 영역이 바로 표시할 수 있는 읽기 전용 화면 모델로 변환한다.
 * 일정이 아직 없으면 null을 반환해 로딩·오류 화면과 정상 상세 계산의 경계를 명확히 한다.
 */
export function buildScheduleDetailPresentation(
  controller: ScheduleDetailController,
) {
  const {
    colors,
    currentMemberId,
    currentMemberDepartedAt,
    departureDisplayState,
    departureParticipants,
    displayDestination,
    displayOrigin,
    displayPathOverlays,
    displayTravelMinutes,
    displayTravelMode,
    insets,
    inspectedTravelPlan,
    isDark,
    item,
    mapCoords,
    nowMs,
    recommendedDepartureAt,
    routeDetailInfo,
    routeOption,
  } = controller;
  if (!item) return null;

  const routeTitle =
    item.locationName ||
    (displayOrigin?.name && displayDestination?.name
      ? `${displayOrigin.name} → ${displayDestination.name}`
      : undefined) ||
    displayDestination?.name ||
    displayOrigin?.name ||
    '선택된 경로가 없어요';
  const routeIdentityTitle =
    displayOrigin?.name && displayDestination?.name
      ? `${displayOrigin.name} → ${displayDestination.name}`
      : routeTitle;
  const travelText = displayTravelMinutes
    ? `${travelModeLabel(
        displayTravelMode ?? undefined,
      )} ${displayTravelMinutes}분`
    : travelModeLabel(displayTravelMode ?? undefined);
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
  const departureStatusMuted =
    departureDisplayState.kind === 'status' &&
    departureDisplayState.tone === 'disabled';
  const departureStatusAccent = departureCompleted
    ? isDark
      ? '#86EFAC'
      : '#16A34A'
    : departureStatusMuted
    ? secondaryText
    : colors.selectedDayBg;
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
  const hasRenderableDetailedRoute = displayPathOverlays.some(
    overlay => overlay.coords.length >= 2,
  );
  const routeSummaryKind = getSavedRouteSummaryKind(
    hasRenderableDetailedRoute,
    displayTravelMinutes ?? undefined,
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
  const routeDetailMeta = [
    hasDetailedRoute
      ? `${arrivalTimeLabel} 도착`
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
    ? '최적 경로'
    : routeSummaryKind === 'duration_only'
    ? '상세 경로 미설정'
    : '저장된 경로 없음';
  const departureCountLabel =
    departureOverview.totalCount > 0
      ? `${departureOverview.departedCount}/${departureOverview.totalCount}`
      : departureCompleted
      ? '완료'
      : '대기';
  const routeDurationLabel = hasRouteSummary
    ? routeNumberText(routeOption, displayTravelMinutes ?? undefined)
    : '미설정';
  const departureRemainingLabel = getDepartureRemainingLabel(
    departureDisplayState,
  );
  const recommendedDepartureTimeLabel = recommendedDepartureAt
    ? hhmmText(recommendedDepartureAt)
    : departureDisplayState.kind === 'status'
    ? departureDisplayState.text
    : scheduleCountdown.compactValue;
  const routeArrivalSummary = hasRouteSummary
    ? `${arrivalTimeLabel} 도착 · 총 ${routeDurationLabel}`
    : scheduleRangeLabel;
  const routeWalkingMinutes =
    routeDetailInfo?.steps.reduce(
      (total, step) =>
        step.type === 'WALK' && typeof step.durationMinutes === 'number'
          ? total + step.durationMinutes
          : total,
      0,
    ) ?? 0;
  const routeFactLabels = [
    typeof routeDetailInfo?.transferCount === 'number'
      ? `환승 ${routeDetailInfo.transferCount}회`
      : typeof routeOption?.transferCount === 'number'
      ? `환승 ${routeOption.transferCount}회`
      : undefined,
    routeWalkingMinutes > 0 ? `도보 ${routeWalkingMinutes}분` : undefined,
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
    travelText,
    hasDepartureInfo,
    departureCompleted,
    sheetBorder,
    primaryText,
    secondaryText,
    topCardControlBg,
    topCardAccentText,
    departureStatusMuted,
    departureStatusAccent,
    participantPresentations,
    travelPlanParticipants,
    inspectedParticipant,
    departureOverview,
    scheduleRangeLabel,
    scheduleCountdownEndAt,
    scheduleCountdown,
    arrivalTimeLabel,
    hasRenderableDetailedRoute,
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
    departureCountLabel,
    routeDurationLabel,
    departureRemainingLabel,
    recommendedDepartureTimeLabel,
    routeArrivalSummary,
    routeWalkingMinutes,
    routeFactLabels,
  };
}

/** 정상 일정 상세 영역이 공유하는 계산 완료 화면 모델이다. */
export type ScheduleDetailPresentation = NonNullable<
  ReturnType<typeof buildScheduleDetailPresentation>
>;
