import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import {
  canSendDepartureNudge,
} from "../../src/modules/schedule/detailPresentation";
import {
  canOpenParticipantTravelPlan,
  travelPlanStatusLabel,
} from "../../src/modules/schedule/travelPlanPresentation";
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
import type { ScheduleDetailPresentation } from "./scheduleDetailPresentationModel";
import { ScheduleDetailAuxiliarySheets } from "./ScheduleDetailAuxiliarySheets";
import { ScheduleDetailBackground } from "./ScheduleDetailBackground";
import { ScheduleDetailHeader } from "./ScheduleDetailHeader";
import { ScheduleDetailRouteSheet } from "./ScheduleDetailRouteSheet";

type ScheduleDetailLayoutProps = {
  presentation: ScheduleDetailPresentation;
};

/** 계산이 끝난 일정 상세 화면을 지도·헤더·경로 시트·보조 모달 순서로 조립한다. */
export function ScheduleDetailLayout({
  presentation,
}: ScheduleDetailLayoutProps) {
  const {
    colors,
    isDark,
    currentMemberId,
    departureNudgePendingMemberId,
    inspectedTravelPlan,
    travelPlanDetailPendingMemberId,
    item,
    departureParticipants,
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
  const renderDepartureParticipantChips = () => {
    if (departureParticipants.length <= 1) return null;

    return (
      <View style={styles.departureParticipants}>
        {participantPresentations.map(participant => {
          const departed = participant.departed;
          const canNudge = canSendDepartureNudge(
            participant,
            currentMemberId,
            item.ownerMemberId,
          );
          const nudgePending =
            departureNudgePendingMemberId === participant.memberId;
          const profile = (
            <>
              <View
                style={[
                  styles.departureParticipantAvatar,
                  {
                    backgroundColor: departed
                      ? isDark
                        ? 'rgba(34,197,94,0.22)'
                        : 'rgba(34,197,94,0.14)'
                      : canNudge
                      ? isDark
                        ? 'rgba(41,121,255,0.24)'
                        : 'rgba(41,121,255,0.12)'
                      : isDark
                      ? 'rgba(255,255,255,0.10)'
                      : 'rgba(15,23,42,0.07)',
                    borderColor: canNudge ? topCardAccentText : 'transparent',
                    borderWidth: canNudge ? 1 : 0,
                  },
                ]}
              >
                {nudgePending ? (
                  <ActivityIndicator size="small" color={topCardAccentText} />
                ) : (
                  <Text
                    style={[
                      styles.departureParticipantAvatarText,
                      {
                        color: departed
                          ? isDark
                            ? '#BBF7D0'
                            : '#166534'
                          : canNudge
                          ? topCardAccentText
                          : secondaryText,
                      },
                    ]}
                  >
                    {participant.avatarLabel}
                  </Text>
                )}
                {departed && (
                  <View style={styles.departureParticipantCheck}>
                    <Ionicons name="checkmark" size={8} color="#FFFFFF" />
                  </View>
                )}
                {canNudge && !nudgePending && (
                  <View
                    style={[
                      styles.departureParticipantBell,
                      { backgroundColor: topCardAccentText },
                    ]}
                  >
                    <Ionicons name="notifications" size={8} color="#FFFFFF" />
                  </View>
                )}
              </View>
              <View style={styles.departureParticipantCopy}>
                <Text
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={[
                    styles.departureParticipantName,
                    { color: primaryText },
                  ]}
                >
                  {participant.label}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.departureParticipantStatus,
                    {
                      color: departed
                        ? isDark
                          ? '#86EFAC'
                          : '#15803D'
                        : canNudge
                        ? topCardAccentText
                        : secondaryText,
                    },
                  ]}
                >
                  {departed ? '출발 완료' : '대기 중'}
                </Text>
              </View>
            </>
          );

          return canNudge ? (
            <Pressable
              key={`${participant.memberId}-${participant.role}`}
              onPress={() =>
                confirmDepartureNudge(participant.memberId, participant.label)
              }
              disabled={departureNudgePendingMemberId !== undefined}
              accessibilityRole="button"
              accessibilityLabel={`${participant.label}, 대기 중, 출발 확인 알림 보내기`}
              accessibilityHint="프로필을 누르면 해당 참가자의 기기로 출발 확인 푸시를 보냅니다."
              accessibilityState={{
                busy: nudgePending,
                disabled: departureNudgePendingMemberId !== undefined,
              }}
              style={({ pressed }) => [
                styles.departureParticipantItem,
                {
                  opacity: pressed
                    ? 0.56
                    : departureNudgePendingMemberId !== undefined &&
                      !nudgePending
                    ? 0.42
                    : 1,
                },
              ]}
            >
              {profile}
            </Pressable>
          ) : (
            <View
              key={`${participant.memberId}-${participant.role}`}
              accessible
              accessibilityLabel={`${participant.label}, ${
                departed ? '출발함' : '대기 중'
              }`}
              style={styles.departureParticipantItem}
            >
              {profile}
            </View>
          );
        })}
      </View>
    );
  };

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
              disabled={!canOpen || pending}
              accessibilityRole={canOpen ? 'button' : undefined}
              accessibilityLabel={`${travelPlanParticipantLabel(
                participant,
              )}, ${detail}`}
              accessibilityState={{
                selected,
                busy: pending,
                disabled: !canOpen,
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
                  numberOfLines={1}
                  style={[styles.travelPlanMeta, { color: secondaryText }]}
                >
                  {participant.originName ? `${participant.originName} · ` : ''}
                  {detail}
                </Text>
              </View>
              {pending ? (
                <ActivityIndicator size="small" color={topCardAccentText} />
              ) : canOpen ? (
                <Ionicons
                  name="chevron-forward"
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScheduleDetailBackground
        presentation={presentation}
        renderTravelPlanRows={renderTravelPlanRows}
      />
      <ScheduleDetailHeader presentation={presentation} />
      <ScheduleDetailRouteSheet
        presentation={presentation}
        renderDepartureParticipantChips={renderDepartureParticipantChips}
        renderTravelPlanRows={renderTravelPlanRows}
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
