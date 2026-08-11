import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import type { RouteInfo, RouteStep } from '../../routeInfo';
import type { TransitRouteProgressSegment } from '../../transitRouteProgress';
import RouteStepTimeline from '../route/RouteStepTimeline';
import TransitRouteProgressBar from '../route/TransitRouteProgressBar';
import styles from './RouteDetailDesignPreview.styles';
import {
  LINE_2,
  LINE_4,
  type PreviewPalette,
} from './routeDetailPreviewPalette';

/** 경로 상세 시트의 드래그 가능 영역과 시각적 손잡이를 공통 형태로 렌더링합니다. */
export function SheetHandle({
  expanded,
  palette,
  onPress,
}: {
  expanded: boolean;
  palette: PreviewPalette;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        expanded ? '경로 상세 시트 접기' : '경로 상세 시트 펼치기'
      }
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={styles.handleHitArea}
    >
      <View style={[styles.handle, { backgroundColor: palette.border }]} />
    </Pressable>
  );
}

/** 현재 디자인의 접힌 경로 요약 상태를 핵심 시간과 이동 정보만 포함해 렌더링합니다. */
export function CurrentCompact({ palette }: { palette: PreviewPalette }) {
  return (
    <View style={styles.currentCompact}>
      <View>
        <View style={styles.smallLabelRow}>
          <Ionicons name="time-outline" size={13} color="#F59E0B" />
          <Text
            style={[styles.currentSmallLabel, { color: palette.secondary }]}
          >
            일정까지 남은 시간
          </Text>
        </View>
        <Text style={[styles.currentCountdown, { color: palette.text }]}>
          42분
        </Text>
      </View>
      <View style={styles.currentCompactTrailing}>
        <Text style={[styles.currentCompactDate, { color: palette.secondary }]}>
          8월 8일 · 오후 12:00
        </Text>
        <Ionicons name="chevron-up" size={18} color={palette.text} />
      </View>
      <View style={styles.currentStatusLine}>
        <Ionicons name="walk-outline" size={13} color={palette.blue} />
        <Text style={[styles.currentStatusText, { color: palette.secondary }]}>
          권장 출발 오전 11:24 · 18분 뒤 출발
        </Text>
      </View>
    </View>
  );
}

/** 공유 일정 참가자의 이름과 출발 상태를 간결한 목록으로 표시합니다. */
function Participants({ palette }: { palette: PreviewPalette }) {
  return (
    <View style={[styles.participantRow, { borderTopColor: palette.border }]}>
      <View style={styles.participantTitleRow}>
        <Ionicons name="people-outline" size={15} color={palette.secondary} />
        <Text style={[styles.participantTitle, { color: palette.text }]}>
          참여자 출발 현황
        </Text>
      </View>
      <View style={styles.participantMetaRow}>
        <View style={[styles.avatar, { backgroundColor: palette.blueSoft }]}>
          <Text style={[styles.avatarText, { color: palette.blue }]}>나</Text>
        </View>
        <View style={[styles.avatar, { backgroundColor: palette.sheetMuted }]}>
          <Text style={[styles.avatarText, { color: palette.secondary }]}>
            민
          </Text>
        </View>
        <Text style={[styles.participantMeta, { color: palette.secondary }]}>
          1명 출발
        </Text>
        <Ionicons name="chevron-down" size={15} color={palette.tertiary} />
      </View>
    </View>
  );
}

/** 이동 구간별 비중과 색상을 유지한 경로 진행 막대를 렌더링합니다. */
function ProgressBar({ palette }: { palette: PreviewPalette }) {
  return (
    <View style={styles.progressWrap}>
      <View
        style={[
          styles.progressPiece,
          styles.progressWalkStart,
          { backgroundColor: palette.tertiary },
        ]}
      />
      <View
        style={[
          styles.progressPiece,
          styles.progressLine4,
          { backgroundColor: LINE_4 },
        ]}
      />
      <View
        style={[
          styles.progressPiece,
          styles.progressLine2,
          { backgroundColor: LINE_2 },
        ]}
      />
      <View
        style={[
          styles.progressPiece,
          styles.progressWalkEnd,
          { backgroundColor: palette.tertiary },
        ]}
      />
    </View>
  );
}

/** 현재 디자인의 펼친 경로 상세와 참가자·시간 정보를 렌더링합니다. */
export function CurrentExpanded({
  palette,
  departed,
  onDeparture,
}: {
  palette: PreviewPalette;
  departed: boolean;
  onDeparture: () => void;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.currentExpandedContent}
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      <View
        style={[
          styles.currentStatusSection,
          { borderBottomColor: palette.border },
        ]}
      >
        <View style={styles.currentStatusTopRow}>
          <View>
            <View style={styles.smallLabelRow}>
              <Ionicons name="time-outline" size={13} color="#F59E0B" />
              <Text
                style={[styles.currentSmallLabel, { color: palette.secondary }]}
              >
                일정까지 남은 시간
              </Text>
            </View>
            <Text style={[styles.currentHeroValue, { color: palette.text }]}>
              42분
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="출발 알리기"
            onPress={onDeparture}
            style={[
              styles.currentDepartureButton,
              { backgroundColor: palette.blueSoft },
            ]}
          >
            <Text
              style={[
                styles.currentDepartureButtonText,
                { color: palette.blue },
              ]}
            >
              {departed ? '출발 완료' : '출발 알리기'}
            </Text>
          </Pressable>
        </View>
        <Text style={[styles.currentDateText, { color: palette.secondary }]}>
          8월 8일 토요일 · 오후 12:00
        </Text>
        <Text
          style={[styles.currentDepartureHint, { color: palette.secondary }]}
        >
          권장 출발 오전 11:24 · 18분 뒤 출발
        </Text>
        <Participants palette={palette} />
      </View>

      <View
        style={[
          styles.currentRouteSection,
          { borderBottomColor: palette.border },
        ]}
      >
        <View style={styles.currentRouteTop}>
          <View>
            <View style={styles.currentLiveRow}>
              <View
                style={[styles.liveDot, { backgroundColor: palette.green }]}
              />
              <Text
                style={[styles.currentRouteMeta, { color: palette.secondary }]}
              >
                실시간 교통 반영
              </Text>
            </View>
            <Text style={[styles.currentRouteTitle, { color: palette.text }]}>
              최적 경로
            </Text>
          </View>
          <View style={styles.currentRouteDurationRow}>
            <Text
              style={[styles.currentRouteDuration, { color: palette.text }]}
            >
              36분
            </Text>
            <View style={styles.currentMapIconButton}>
              <Ionicons name="map-outline" size={21} color={palette.text} />
            </View>
          </View>
        </View>
        <ProgressBar palette={palette} />
      </View>

      <View style={styles.currentTimelineHeader}>
        <Text style={[styles.currentTimelineTitle, { color: palette.text }]}>
          경로 상세
        </Text>
        <Text
          style={[styles.currentTimelineTime, { color: palette.secondary }]}
        >
          오전 11:24 출발 기준
        </Text>
      </View>
      <View style={styles.currentMiniTimeline}>
        <Ionicons name="walk-outline" size={17} color={palette.secondary} />
        <Text style={[styles.currentMiniTimelineText, { color: palette.text }]}>
          서울역까지 도보 5분
        </Text>
        <Text
          style={[styles.currentMiniTimelineMeta, { color: palette.secondary }]}
        >
          340m
        </Text>
      </View>
      <View style={styles.currentMiniTimeline}>
        <View style={[styles.currentLineBadge, { backgroundColor: LINE_4 }]}>
          <Text style={styles.currentLineBadgeText}>4</Text>
        </View>
        <Text style={[styles.currentMiniTimelineText, { color: palette.text }]}>
          서울역 → 사당역
        </Text>
        <Text
          style={[styles.currentMiniTimelineMeta, { color: palette.secondary }]}
        >
          23분
        </Text>
      </View>
    </ScrollView>
  );
}

/** 개선 디자인의 접힌 시트에서 출발 시각과 핵심 경로 지표를 우선해 렌더링합니다. */
export function ImprovedCompact({
  palette,
  departed,
  onDeparture,
}: {
  palette: PreviewPalette;
  departed: boolean;
  onDeparture: () => void;
}) {
  const actionContentColor = departed ? palette.blue : '#FFFFFF';

  return (
    <View style={styles.improvedCompact}>
      <View
        style={[styles.sheetRouteIdentity, styles.sheetRouteIdentityCompact]}
      >
        <Ionicons name="navigate-outline" size={14} color={palette.blue} />
        <Text
          style={[styles.sheetRouteIdentityTitle, { color: palette.text }]}
          numberOfLines={1}
        >
          서울역 → 강남역
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={departed ? '출발 완료' : '출발했어요'}
          accessibilityState={{ selected: departed }}
          hitSlop={3}
          onPress={onDeparture}
          style={({ pressed }) => [
            styles.compactDepartureAction,
            { backgroundColor: departed ? palette.blueSoft : palette.blue },
            pressed && styles.previewActionPressed,
          ]}
        >
          <Ionicons
            name={departed ? 'checkmark' : 'navigate'}
            size={14}
            color={actionContentColor}
          />
          <Text
            style={[
              styles.compactDepartureActionText,
              { color: actionContentColor },
            ]}
          >
            {departed ? '출발 완료' : '출발했어요'}
          </Text>
        </Pressable>
      </View>
      <View style={styles.improvedCompactTop}>
        <View>
          <Text style={[styles.improvedEyebrow, { color: palette.blue }]}>
            권장 출발
          </Text>
          <View style={styles.improvedTimeRow}>
            <Text style={[styles.improvedCompactTime, { color: palette.text }]}>
              오전 11:24
            </Text>
            <View
              style={[
                styles.timeLeftChip,
                { backgroundColor: palette.blueSoft },
              ]}
            >
              <Text style={[styles.timeLeftChipText, { color: palette.blue }]}>
                18분 남음
              </Text>
            </View>
          </View>
        </View>
        <Ionicons name="chevron-up" size={18} color={palette.secondary} />
      </View>
      <Text style={[styles.improvedArrivalLine, { color: palette.secondary }]}>
        오후 12:00 도착 · 총 36분 · 환승 1회
      </Text>
      <ProgressBar palette={palette} />
      {departed ? (
        <View style={styles.departedInline}>
          <Ionicons name="checkmark-circle" size={15} color={palette.green} />
          <Text
            style={[styles.departedInlineText, { color: palette.secondary }]}
          >
            출발 상태를 공유했어요
          </Text>
        </View>
      ) : (
        <Text
          style={[styles.improvedCompactFacts, { color: palette.secondary }]}
        >
          도보 620m · 교통비 1,550원
        </Text>
      )}
    </View>
  );
}

/** 개선 디자인의 펼친 시트에서 경로 단계, 참가자, 액션을 정보 위계에 맞춰 렌더링합니다. */
export function ImprovedExpanded({
  palette,
  isDark,
  routeDetailInfo,
  routeProgressSegments,
  departed,
  selectedRouteStepId,
  infoExpanded,
  onDeparture,
  onSelectRouteStep,
  onToggleInfo,
}: {
  palette: PreviewPalette;
  isDark: boolean;
  routeDetailInfo: RouteInfo;
  routeProgressSegments: TransitRouteProgressSegment[];
  departed: boolean;
  selectedRouteStepId?: string;
  infoExpanded: boolean;
  onDeparture: () => void;
  onSelectRouteStep: (step: RouteStep) => void;
  onToggleInfo: () => void;
}) {
  const departureTextColor = departed ? palette.blue : '#FFFFFF';
  const [nudgeSent, setNudgeSent] = useState(false);
  const sharedPeople = [
    {
      id: 'me',
      avatar: '나',
      name: '나',
      status: '대기 중',
      departed: false,
      canNudge: false,
    },
    {
      id: 'minji',
      avatar: '민',
      name: '민지',
      status: '출발 완료',
      departed: true,
      canNudge: false,
    },
    {
      id: 'junho',
      avatar: '준',
      name: '준호',
      status: nudgeSent ? '알림 보냄' : '대기 중',
      departed: false,
      canNudge: true,
    },
  ];

  return (
    <ScrollView
      contentContainerStyle={styles.improvedExpandedContent}
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      <View
        style={[styles.sheetRouteIdentity, styles.sheetRouteIdentityExpanded]}
      >
        <Ionicons name="navigate-outline" size={14} color={palette.blue} />
        <Text
          style={[styles.sheetRouteIdentityTitle, { color: palette.text }]}
          numberOfLines={1}
        >
          서울역 → 강남역
        </Text>
        <Text
          style={[styles.sheetRouteIdentityMeta, { color: palette.secondary }]}
        >
          대중교통
        </Text>
      </View>
      <View
        style={[styles.improvedHero, { borderBottomColor: palette.border }]}
      >
        <View style={styles.improvedHeroTop}>
          <View style={styles.improvedHeroCopy}>
            <Text style={[styles.improvedEyebrow, { color: palette.blue }]}>
              권장 출발
            </Text>
            <View style={styles.improvedTimeRow}>
              <Text style={[styles.improvedHeroTime, { color: palette.text }]}>
                오전 11:24
              </Text>
              <View
                style={[
                  styles.timeLeftChip,
                  { backgroundColor: palette.blueSoft },
                ]}
              >
                <Text
                  style={[styles.timeLeftChipText, { color: palette.blue }]}
                >
                  18분 남음
                </Text>
              </View>
            </View>
            <Text
              style={[styles.improvedArrivalLine, { color: palette.secondary }]}
            >
              오후 12:00 도착 · 총 36분
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={departed ? '출발 완료' : '출발했어요'}
            accessibilityState={{ selected: departed }}
            onPress={onDeparture}
            style={[
              styles.improvedDepartureButton,
              { backgroundColor: departed ? palette.blueSoft : palette.blue },
            ]}
          >
            <Ionicons
              name={departed ? 'checkmark' : 'navigate'}
              size={15}
              color={departureTextColor}
            />
            <Text
              style={[
                styles.improvedDepartureButtonText,
                { color: departureTextColor },
              ]}
            >
              {departed ? '출발 완료' : '출발했어요'}
            </Text>
          </Pressable>
        </View>
        <View style={styles.improvedRouteFacts}>
          <Text
            style={[styles.improvedRouteFact, { color: palette.secondary }]}
          >
            환승 1회
          </Text>
          <View
            style={[styles.factDivider, { backgroundColor: palette.border }]}
          />
          <Text
            style={[styles.improvedRouteFact, { color: palette.secondary }]}
          >
            도보 9분
          </Text>
          <View
            style={[styles.factDivider, { backgroundColor: palette.border }]}
          />
          <Text
            style={[styles.improvedRouteFact, { color: palette.secondary }]}
          >
            1,550원
          </Text>
        </View>
        <View style={styles.improvedExistingRouteBar}>
          <TransitRouteProgressBar
            segments={routeProgressSegments}
            isDark={isDark}
            compact
          />
        </View>
      </View>

      <View
        style={[
          styles.sharedPeopleSection,
          { borderBottomColor: palette.border },
        ]}
      >
        <View style={styles.sharedPeopleHeader}>
          <View style={styles.sharedPeopleTitleRow}>
            <Ionicons
              name="people-outline"
              size={16}
              color={palette.secondary}
            />
            <Text style={[styles.sharedPeopleTitle, { color: palette.text }]}>
              함께하는 사람 3
            </Text>
          </View>
          <Text
            style={[styles.sharedPeopleSummary, { color: palette.secondary }]}
          >
            1/3 출발
          </Text>
        </View>
        <View style={styles.sharedPeopleRow}>
          {sharedPeople.map(person => {
            const profile = (
              <>
                <View
                  style={[
                    styles.sharedPersonAvatar,
                    {
                      backgroundColor: person.departed
                        ? palette.greenSoft
                        : person.canNudge
                        ? palette.blueSoft
                        : palette.sheetMuted,
                    },
                    person.canNudge && { borderColor: palette.blue },
                  ]}
                >
                  <Text
                    style={[
                      styles.sharedPersonAvatarText,
                      {
                        color: person.departed
                          ? palette.green
                          : person.canNudge
                          ? palette.blue
                          : palette.secondary,
                      },
                    ]}
                  >
                    {person.avatar}
                  </Text>
                  {person.canNudge ? (
                    <View
                      style={[
                        styles.sharedPersonBell,
                        { backgroundColor: palette.blue },
                      ]}
                    >
                      <Ionicons
                        name={nudgeSent ? 'checkmark' : 'notifications'}
                        size={8}
                        color="#FFFFFF"
                      />
                    </View>
                  ) : null}
                </View>
                <View style={styles.sharedPersonCopy}>
                  <Text
                    numberOfLines={1}
                    style={[styles.sharedPersonName, { color: palette.text }]}
                  >
                    {person.name}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.sharedPersonStatus,
                      {
                        color: person.departed
                          ? palette.green
                          : person.canNudge
                          ? palette.blue
                          : palette.secondary,
                      },
                    ]}
                  >
                    {person.status}
                  </Text>
                </View>
              </>
            );

            return person.canNudge ? (
              <Pressable
                key={person.id}
                accessibilityRole="button"
                accessibilityLabel={
                  nudgeSent
                    ? `${person.name}에게 출발 확인 알림을 보냈어요`
                    : `${person.name}에게 출발 확인 알림 보내기`
                }
                accessibilityState={{ selected: nudgeSent }}
                onPress={() => setNudgeSent(true)}
                style={({ pressed }) => [
                  styles.sharedPerson,
                  pressed && styles.previewActionPressed,
                ]}
              >
                {profile}
              </Pressable>
            ) : (
              <View
                key={person.id}
                accessible
                accessibilityLabel={`${person.name}, ${person.status}`}
                style={styles.sharedPerson}
              >
                {profile}
              </View>
            );
          })}
        </View>
      </View>

      <View
        style={[
          styles.improvedTimelineHeader,
          { borderBottomColor: palette.border },
        ]}
      >
        <Text style={[styles.improvedSectionTitle, { color: palette.text }]}>
          경로 상세
        </Text>
        <Text
          style={[styles.improvedSectionMeta, { color: palette.secondary }]}
        >
          오전 11:24 출발 기준
        </Text>
      </View>
      <RouteStepTimeline
        routeInfo={routeDetailInfo}
        selectedStepId={selectedRouteStepId}
        onStepPress={onSelectRouteStep}
        forceDark={isDark}
        primaryTextColor={palette.text}
        secondaryTextColor={palette.secondary}
        compact
        realtimeArrivalsEnabled={false}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="일정 정보"
        accessibilityState={{ expanded: infoExpanded }}
        onPress={onToggleInfo}
        style={[
          styles.scheduleInfoDisclosure,
          { borderTopColor: palette.border },
        ]}
      >
        <View style={styles.scheduleInfoTitleRow}>
          <Ionicons
            name="calendar-outline"
            size={17}
            color={palette.secondary}
          />
          <Text style={[styles.scheduleInfoTitle, { color: palette.text }]}>
            일정 정보
          </Text>
        </View>
        <Text
          style={[styles.scheduleInfoSummary, { color: palette.secondary }]}
        >
          알람 · 메모 있음
        </Text>
        <Ionicons
          name={infoExpanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={palette.tertiary}
        />
      </Pressable>
      {infoExpanded ? (
        <View
          style={[
            styles.scheduleInfoBody,
            { backgroundColor: palette.sheetMuted },
          ]}
        >
          <Text
            style={[styles.scheduleInfoBodyText, { color: palette.secondary }]}
          >
            출발 알람 · 오전 11:24
          </Text>
          <Text
            style={[styles.scheduleInfoBodyText, { color: palette.secondary }]}
          >
            2번 출구 앞에서 만나기
          </Text>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="저장된 경로 수정"
        style={styles.routeEditButton}
      >
        <Text style={[styles.routeEditButtonText, { color: palette.blue }]}>
          경로 수정
        </Text>
      </Pressable>
    </ScrollView>
  );
}
