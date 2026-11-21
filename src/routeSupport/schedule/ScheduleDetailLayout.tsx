import React, { useCallback, useRef, useState } from "react";
import Reanimated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import type { TmapLoadState } from "../../modules/map/TmapMapView";
import { Platform, Pressable, Text, View } from "react-native";
import LoadingIndicator from "../../ui/LoadingIndicator";
import {
  canSendDepartureNudge,
} from "../../modules/schedule/detailPresentation";
import {
  canOpenParticipantTravelPlan,
  travelPlanStatusLabel,
} from "../../modules/schedule/travelPlanPresentation";
import {
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
  Ionicons,
} from "./ScheduleDetailChrome";
import {
  travelModeLabel,
  travelPlanParticipantLabel,
} from "./scheduleDetailModel";
import { createScheduleDetailStyles } from "./schedule-detail.styles";
import type { Place } from "../../modules/schedule/types";
import type { ScheduleDetailPresentation } from "./scheduleDetailPresentationModel";
import { ScheduleDetailAuxiliarySheets } from "./ScheduleDetailAuxiliarySheets";
import { ScheduleDetailBackground } from "./ScheduleDetailBackground";
import { ScheduleDetailHeader } from "./ScheduleDetailHeader";
import { ScheduleDetailRouteSheet } from "./ScheduleDetailRouteSheet";

import { DrivingNavigationScreen, canStartSavedDrive } from "../../modules/journey/DrivingNavigationScreen";
import { isJourneyGuidanceEnabled } from "../../modules/journey/journeyFeature";

type ScheduleDetailLayoutProps = {
  presentation: ScheduleDetailPresentation;
};

const travelPlanFeedbackEntrance = FadeIn.duration(160).reduceMotion(ReduceMotion.System);

/** 계산이 끝난 일정 상세 화면을 지도·헤더·경로 시트·보조 모달 순서로 조립한다. */
export function ScheduleDetailLayout({
  presentation,
}: ScheduleDetailLayoutProps) {
  const [mapState, setMapState] = useState<TmapLoadState | 'retrying'>('loading');
  const [mapRevision, setMapRevision] = useState(0);
  const hasInteractiveMap = presentation.shouldRenderMap;

  const updateMapLoadState = useCallback((state: TmapLoadState) => {
    setMapState(current => current === 'retrying' && state === 'loading' ? current : state);
  }, []);

  const retryMap = () => {
    setMapState('retrying');
    setMapRevision(revision => revision + 1);
  };
  const {
    colors,
    isDark,
    currentMemberId,
    departureNudgePendingMemberId,
    inspectedTravelPlan,
    travelPlanDetailPendingMemberId,
    failedTravelPlanMemberId,
    item,
    confirmDepartureNudge,
    openParticipantTravelPlan,
    sheetBorder,
    primaryText,
    secondaryText,
    topCardControlBg,
    topCardAccentText,
    participantPresentations,
    travelPlanParticipants,
  } = presentation;
  const [drivingTrip, setDrivingTrip] = useState<{
    scheduleId: string; memberId: number; route: unknown; origin: Place; destination: Place;
  } | null>(null);
  const ownPlan = item.myTravelPlan;
  const driveRoute = ownPlan?.route ?? item.route;
  const driveOrigin = ownPlan?.origin ?? item.origin;
  const driveDestination = ownPlan?.destination ?? item.destination;
  const canStartDrive = Platform.OS === 'ios' && isJourneyGuidanceEnabled()
    && presentation.authoritativeDetailLoaded && !presentation.loadError && !presentation.internalPreviewItem
    && !inspectedTravelPlan && !item.routeSetupRequired && currentMemberId != null
    && (ownPlan?.memberId ?? item.ownerMemberId) === currentMemberId
    && (ownPlan?.travelMode ?? item.travelMode) === 'CAR' && canStartSavedDrive(driveOrigin, driveDestination);
  const departureByMember = new Map(participantPresentations.map(person => [person.memberId, person]));
  const planByMember = new Map(travelPlanParticipants.map(plan => [plan.memberId, plan]));
  const companionIds = [...new Set([...departureByMember.keys(), ...planByMember.keys()])];
  const openingTravelPlan = travelPlanDetailPendingMemberId !== undefined;

  const firstCompanionRow = useRef<View>(null);
  const failedCompanionMessage = useRef<Text>(null);
  const requestedCompanionId = useRef<number | undefined>(undefined);
  const renderRouteCompanions = (
    onFirstRowLayout: (row: View) => void,
    onFailureLayout: (message: Text) => void,
  ) => (
    <View style={styles.routeCompanionList}>
      {companionIds.map((memberId, index) => {
        const departure = departureByMember.get(memberId);
        const plan = planByMember.get(memberId);
        const label = memberId === currentMemberId ? '나'
          : departure?.label ?? (plan ? travelPlanParticipantLabel(plan) : '참여자');
        const status = departure ? (departure.departed ? '출발 완료' : '대기 중') : null;
        const planLabel = plan
          ? plan.status === 'READY' && plan.travelMinutes
            ? `${travelModeLabel(plan.travelMode ?? undefined)} ${plan.travelMinutes}분`
            : travelPlanStatusLabel(plan.status)
          : null;
        const routeLabel = [plan?.originName, planLabel].filter(Boolean).join(' · ');
        const canOpen = Boolean(plan && canOpenParticipantTravelPlan(plan, currentMemberId));
        const selected = canOpen && (inspectedTravelPlan?.memberId === memberId
          || (!inspectedTravelPlan && memberId === currentMemberId));
        const opening = travelPlanDetailPendingMemberId === memberId;
        const failed = failedTravelPlanMemberId === memberId;
        const canNudge = Boolean(departure && canSendDepartureNudge(departure, currentMemberId, item.ownerMemberId));
        const sending = departureNudgePendingMemberId === memberId;
        const feedback = opening ? '경로를 불러오는 중' : failed ? '경로를 불러오지 못했어요 · 다시 시도' : undefined;
        const rowAccessibilityLabel = [label, status, feedback ?? routeLabel].filter(Boolean).join(', ');

        return (
          <View
            key={memberId}
            ref={index === 0 ? firstCompanionRow : undefined}
            onLayout={index === 0 ? () => {
              if (firstCompanionRow.current) onFirstRowLayout(firstCompanionRow.current);
            } : undefined}
            style={[styles.routeCompanionRow, { borderBottomColor: sheetBorder }]}
          >
            <Pressable
              testID={`route-companion-${memberId}`}
              accessible
              disabled={!canOpen || openingTravelPlan}
              accessibilityRole={canOpen ? 'button' : 'text'}
              accessibilityLabel={rowAccessibilityLabel}
              accessibilityState={canOpen ? { selected, busy: opening, disabled: openingTravelPlan } : undefined}
              accessibilityHint={canOpen ? '이 사람의 경로를 지도에서 봅니다.' : undefined}
              onPress={plan && canOpen ? () => {
                requestedCompanionId.current = memberId;
                openParticipantTravelPlan(plan);
              } : undefined}
              style={({ pressed }) => [
                styles.routeCompanionMain,
                { opacity: pressed ? 0.62 : 1 },
              ]}
            >
              <View style={[styles.travelPlanAvatar, { backgroundColor: topCardControlBg }]}>
                <Text allowFontScaling={false} style={[styles.routeCompanionInitial, { color: topCardAccentText }]}>
                  {departure?.avatarLabel ?? label.slice(0, 1)}
                </Text>
              </View>
              <View style={styles.travelPlanCopy}>
                <Text maxFontSizeMultiplier={2} style={[styles.routeCompanionName, { color: primaryText }]}>{label}</Text>
                {status ? (
                  <Text maxFontSizeMultiplier={1.75} style={[
                    styles.routeCompanionMeta,
                    { color: departure?.departed ? (isDark ? '#86EFAC' : '#15803D') : secondaryText },
                  ]}>{status}</Text>
                ) : null}
                {feedback || routeLabel ? (
                  <Reanimated.Text
                    key={feedback ?? routeLabel}
                    ref={failed ? failedCompanionMessage : undefined}
                    onLayout={failed ? () => {
                      const message = failedCompanionMessage.current;
                      if (!message || requestedCompanionId.current !== memberId) return;
                      requestedCompanionId.current = undefined;
                      onFailureLayout(message);
                    } : undefined}
                    entering={feedback ? travelPlanFeedbackEntrance : undefined}
                    accessibilityLiveRegion="polite"
                    maxFontSizeMultiplier={1.75}
                    lineBreakStrategyIOS="hangul-word"
                    style={[styles.routeCompanionMeta, { color: failed ? topCardAccentText : secondaryText }]}
                  >{feedback ?? routeLabel}</Reanimated.Text>
                ) : null}
              </View>
              {opening ? (
                <LoadingIndicator size="inline" delayMs={150} />
              ) : canOpen ? (
                <Ionicons
                  name={failed ? 'refresh-outline' : selected ? 'checkmark-circle-outline' : 'chevron-forward-outline'}
                  size={16}
                  color={selected ? topCardAccentText : secondaryText}
                />
              ) : null}
            </Pressable>
            {canNudge ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${label}에게 출발 확인 알림 보내기`}
                accessibilityState={{ busy: sending, disabled: departureNudgePendingMemberId !== undefined }}
                disabled={departureNudgePendingMemberId !== undefined}
                onPress={() => confirmDepartureNudge(memberId, label)}
                style={({ pressed }) => [styles.routeCompanionAction, { opacity: pressed ? 0.62 : 1 }]}
              >
                {sending ? <LoadingIndicator size="inline" delayMs={150} />
                  : <Ionicons name="notifications-outline" size={19} color={topCardAccentText} />}
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );

  const renderTravelPlanRows = () => {
    if (travelPlanParticipants.length <= 1) return null;

    return (
      <View style={[styles.travelPlanList, { borderTopColor: sheetBorder }]}>
        {travelPlanParticipants.map(participant => {
          const canOpen = canOpenParticipantTravelPlan(
            participant,
            currentMemberId,
          );
          const selected =
            inspectedTravelPlan?.memberId === participant.memberId ||
            (!inspectedTravelPlan && participant.memberId === currentMemberId);
          const pending =
            travelPlanDetailPendingMemberId === participant.memberId;
          const failed = failedTravelPlanMemberId === participant.memberId;
          const detail =
            participant.status === 'READY' && participant.travelMinutes
              ? `${travelModeLabel(participant.travelMode ?? undefined)} ${
                  participant.travelMinutes
                }분`
              : travelPlanStatusLabel(participant.status);

          return (
            <Pressable
              key={`travel-plan-${participant.memberId}`}
              onPress={() => openParticipantTravelPlan(participant)}
              disabled={!canOpen || openingTravelPlan}
              accessibilityRole={canOpen ? 'button' : undefined}
              accessibilityLabel={`${travelPlanParticipantLabel(
                participant,
              )}, ${pending ? '경로를 불러오는 중' : failed ? '경로를 불러오지 못했어요 · 다시 시도' : detail}`}
              accessibilityState={{
                selected,
                busy: pending,
                disabled: !canOpen || openingTravelPlan,
              }}
              style={({ pressed }) => [
                styles.travelPlanRow,
                {
                  backgroundColor: selected
                    ? isDark
                      ? 'rgba(41,121,255,0.16)'
                      : 'rgba(41,121,255,0.08)'
                    : 'transparent',
                  opacity: pressed ? 0.58 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.travelPlanAvatar,
                  {
                    backgroundColor:
                      participant.status === 'READY'
                        ? isDark
                          ? 'rgba(41,121,255,0.24)'
                          : 'rgba(41,121,255,0.12)'
                        : topCardControlBg,
                  },
                ]}
              >
                <Ionicons
                  name={
                    participant.status === 'READY'
                      ? 'navigate'
                      : 'location-outline'
                  }
                  size={14}
                  color={
                    participant.status === 'READY'
                      ? topCardAccentText
                      : secondaryText
                  }
                />
              </View>
              <View style={styles.travelPlanCopy}>
                <Text
                  numberOfLines={1}
                  style={[styles.travelPlanName, { color: primaryText }]}
                >
                  {travelPlanParticipantLabel(participant)}
                  {participant.memberId === currentMemberId ? ' · 나' : ''}
                </Text>
                <Text
                  numberOfLines={pending || failed ? undefined : 1}
                  lineBreakStrategyIOS="hangul-word"
                  style={[styles.travelPlanMeta, { color: secondaryText }]}
                >
                  {pending ? '경로를 불러오는 중'
                    : failed ? '경로를 불러오지 못했어요 · 다시 시도'
                    : [participant.originName, detail].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {pending ? (
                <LoadingIndicator size="inline" delayMs={150} />
              ) : canOpen ? (
                <Ionicons
                  name={failed ? "refresh-outline" : "chevron-forward-outline"}
                  size={15}
                  color={secondaryText}
                />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    );
  };

  if (drivingTrip?.scheduleId === item.id && drivingTrip.memberId === currentMemberId && canStartDrive) {
    return <DrivingNavigationScreen key={item.id} scheduleId={item.id} savedRoute={drivingTrip.route}
      origin={drivingTrip.origin} destination={drivingTrip.destination} isDark={isDark}
      departureRecorded={!!presentation.currentMemberDepartedAt || presentation.departureSubmissionStatus === 'recorded'}
      onDeparted={presentation.completeDeparture} onExit={() => setDrivingTrip(null)} />;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScheduleDetailBackground
        presentation={presentation}
        renderTravelPlanRows={renderTravelPlanRows}
        mapReady={hasInteractiveMap && mapState === 'ready'}
        mapRevision={mapRevision}
        onMapLoadStateChange={updateMapLoadState}
      />
      <ScheduleDetailHeader
        presentation={presentation}
        mapState={hasInteractiveMap ? mapState : undefined}
        onRetryMap={retryMap}
      />
      <ScheduleDetailRouteSheet
        presentation={presentation}
        companionCount={companionIds.length}
        onStartDriving={canStartDrive && driveOrigin && driveDestination && currentMemberId != null
          ? () => setDrivingTrip({scheduleId:item.id, memberId:currentMemberId, route:driveRoute, origin:driveOrigin, destination:driveDestination})
          : undefined}
        renderRouteCompanions={renderRouteCompanions}
      />
      <ScheduleDetailAuxiliarySheets presentation={presentation} />
    </View>
  );

}

const styles = createScheduleDetailStyles({
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
});
