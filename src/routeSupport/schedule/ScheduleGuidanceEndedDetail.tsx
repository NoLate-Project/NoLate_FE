import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, findNodeHandle, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Reanimated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import TransitRouteProgressBar from '../../modules/schedule/components/route/TransitRouteProgressBar';
import { StepIconGlyph, buildStepTitle, getTransferWalkDestination, stripStopAction } from '../../modules/schedule/components/route/RouteStepTimeline.helpers';
import { formatRouteDuration } from '../../modules/schedule/routeInfo';
import { isTransitRideKind, transitModeLabel } from '../../modules/map/transitModes';
import { Ionicons } from './ScheduleDetailChrome';
import { travelModeLabel } from './scheduleDetailModel';
import type { ScheduleDetailPresentation } from './scheduleDetailPresentationModel';

const bodyEntrance = FadeIn.duration(160).reduceMotion(ReduceMotion.System);

export function ScheduleGuidanceEndedDetail({
  presentation,
}: {
  presentation: ScheduleDetailPresentation;
}) {
  const {
    item, isDark, insets, sheetBorder, primaryText, secondaryText, topCardAccentText,
    savedDisplayTravelMinutes, displayTravelMode, routeIdentityTitle, routeDetailInfo,
    routeProgressSegments, goBack, reduceMotion,
  } = presentation;
  const [routeOpen, setRouteOpen] = useState(false);
  const routeButton = useRef<View>(null);
  const restoreRouteFocus = useRef(false);
  const routeHeading = useRef<Text>(null);

  useEffect(() => {
    if (!routeOpen && !restoreRouteFocus.current) return;
    const frame = requestAnimationFrame(() => {
      restoreRouteFocus.current = false;
      const target = findNodeHandle(routeOpen ? routeHeading.current : routeButton.current);
      if (target != null) AccessibilityInfo.setAccessibilityFocus(target);
    });
    return () => cancelAnimationFrame(frame);
  }, [routeOpen]);

  const closeRoute = () => {
    restoreRouteFocus.current = true;
    setRouteOpen(false);
  };
  useEffect(() => {
    if (!routeOpen) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      restoreRouteFocus.current = true;
      setRouteOpen(false);
      return true;
    });
    return () => back.remove();
  }, [routeOpen]);
  const routeCaption = [
    routeIdentityTitle,
    [displayTravelMode && travelModeLabel(displayTravelMode),
      savedDisplayTravelMinutes != null ? formatRouteDuration(savedDisplayTravelMinutes) : undefined]
      .filter(Boolean)
      .join(' '),
  ].filter(Boolean).join(' · ');
  const steps = routeDetailInfo?.steps ?? [];
  const movement = steps.filter(step => step.type !== 'ORIGIN' && step.type !== 'DESTINATION');
  const storedLegs = presentation.routeOption?.transitLegs;
  const getStoredLeg = (step: (typeof movement)[number]) => {
    const match = /^leg-(\d+)$/u.exec(step.id);
    const leg = match && storedLegs?.[Number(match[1])];
    return leg && leg.kind === step.type ? leg : undefined;
  };
  const surface = isDark ? '#1B2029' : '#FFFFFF';
  const background = isDark ? '#151920' : '#F5F7FA';
  const schematic = isDark ? '#182333' : '#EAF2FA';
  const status = '위치 안내를 종료했어요';

  return (
    <View style={[styles.root, { backgroundColor: background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={routeOpen ? '저장 경로 닫기' : '캘린더로 돌아가기'}
          onPress={routeOpen ? closeRoute : goBack}
          style={({ pressed }) => [styles.back, { opacity: pressed ? 0.58 : 1 }]}>
          <Ionicons name="chevron-back-outline" size={22} color={primaryText} />
        </Pressable>
        <View style={styles.copy}>
          <Text ref={routeHeading} accessibilityRole="header" style={[styles.headerTitle, { color: primaryText }]}>
            {routeOpen ? '저장 경로 안내' : '일정 상세'}
          </Text>
          {routeOpen && <Text style={[styles.caption, { color: secondaryText }]}>{routeCaption}</Text>}
        </View>
      </View>

      {routeOpen ? (
        <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          testID="schedule-guidance-ended-saved-route">
          {routeProgressSegments.length > 0 && (
            <View style={[styles.schematic, { backgroundColor: schematic }]}>
              <TransitRouteProgressBar segments={routeProgressSegments} isDark={isDark} compact trackOnly />
              <View style={styles.endpoints}>
                <Text style={[styles.caption, { color: secondaryText }]}>출발</Text>
                <Text style={[styles.caption, { color: secondaryText }]}>도착</Text>
              </View>
              <Text style={[styles.schematicLabel, { color: secondaryText }]}>경로 개략도</Text>
            </View>
          )}
          <View style={[styles.routePanel, { backgroundColor: surface, borderColor: sheetBorder }]}>
            <View style={styles.routeHandleRow}>
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
                style={[styles.routeHandle, { backgroundColor: secondaryText }]} />
              <Pressable accessibilityRole="button" accessibilityLabel="저장 경로 접기"
                onPress={closeRoute} style={styles.collapse}>
                <Ionicons name="chevron-down-outline" size={18} color={secondaryText} />
              </Pressable>
            </View>
            <Reanimated.View entering={reduceMotion ? undefined : bodyEntrance} style={styles.routeContent}>
              <Text accessibilityRole="header" style={[styles.title, { color: primaryText }]}>{status}</Text>
              <Text style={[styles.status, { color: secondaryText }]}>저장한 경로는 계속 볼 수 있어요.</Text>
              <View style={[styles.movements, { borderColor: sheetBorder }]}>
                <Text testID="schedule-guidance-ended-movements" accessibilityRole="header"
                  style={[styles.headerTitle, { color: primaryText }]}>이동 경로</Text>
                {movement.map((step, index) => {
                  const leg = getStoredLeg(step);
                  const transfer = getTransferWalkDestination(movement, index);
                  const walking = step.type === 'WALK' || step.type === 'TRANSFER';
                  const line = step.lineName ?? step.badgeText;
                  const title = transfer ? '환승 도보'
                    : walking ? '도보'
                    : step.type === 'BUS' && line && /^\d+$/u.test(line) ? `${line}번`
                      : line ??
                        (step.type === 'DRIVE' ? '자동차' : step.type === 'BIKE' ? '자전거' : transitModeLabel(step.type));
                  const nextStep = movement[index + 1];
                  const nextBoarding = nextStep && isTransitRideKind(nextStep.type)
                    ? getStoredLeg(nextStep)?.startName?.trim() || nextStep.passStops?.[0]?.name || buildStepTitle(nextStep)
                    : undefined;
                  const walkStart = leg?.startName?.trim() || (index === 0
                    ? presentation.displayOrigin?.name ?? routeDetailInfo?.originName : movement[index - 1]?.alightingName);
                  const walkEnd = leg?.endName?.trim() || (index === movement.length - 1
                    ? presentation.displayDestination?.name ?? routeDetailInfo?.destinationName : nextBoarding);
                  const from = leg?.startName?.trim() || step.passStops?.[0]?.name || buildStepTitle(step);
                  const to = step.alightingName || leg?.endName?.trim();
                  const locations = walking ? [walkStart, walkEnd] : [from, to];
                  const subtitle = [...new Set(locations.map(name => name && stripStopAction(name)).filter(Boolean))]
                    .join(' → ') || transfer;
                  const duration = step.durationMinutes != null ? formatRouteDuration(step.durationMinutes) : undefined;
                  return (
                    <View key={step.id} accessible testID={`schedule-guidance-ended-leg-${index}`} style={[styles.movement, index > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth, borderColor: sheetBorder,
                    }]}>
                      <View style={[styles.glyph, { backgroundColor: schematic }]}
                        accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                        <StepIconGlyph type={transfer ? 'WALK' : step.type} color={walking ? secondaryText : topCardAccentText} compact />
                      </View>
                      <View style={styles.copy}>
                        <Text style={[styles.rowTitle, { color: primaryText }]}>{title}</Text>
                        {!!subtitle && <Text style={[styles.caption, { color: secondaryText }]}>{subtitle}</Text>}
                      </View>
                      {!!duration && <Text style={[styles.duration, { color: primaryText }]}>{duration}</Text>}
                    </View>
                  );
                })}
              </View>
            </Reanimated.View>
          </View>
        </ScrollView>
      ) : (
        <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          testID="schedule-guidance-ended-detail">
          <Reanimated.View entering={reduceMotion ? undefined : bodyEntrance} style={styles.summary}>
            <Text accessibilityRole="header" style={[styles.title, { color: primaryText }]}>{item.title}</Text>
            <Text style={[styles.status, { color: secondaryText }]}>{status}</Text>
            {movement.length > 0 && (
              <Pressable ref={routeButton} testID="schedule-guidance-ended-route-button"
                accessibilityRole="button" accessibilityLabel={`저장한 경로, ${routeCaption}`}
                onPress={() => setRouteOpen(true)}
                style={({ pressed }) => [styles.routeButton, {
                  backgroundColor: surface, borderColor: sheetBorder, opacity: pressed ? 0.72 : 1,
                }]}>
                <View style={styles.copy}>
                  <Text style={[styles.rowTitle, { color: primaryText }]}>저장한 경로</Text>
                  <Text style={[styles.caption, { color: secondaryText }]}>{routeCaption}</Text>
                </View>
                <Ionicons name="chevron-forward-outline" size={18} color={secondaryText} />
              </Pressable>
            )}
          </Reanimated.View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
  back: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  title: { fontSize: 21, fontWeight: '800', letterSpacing: -0.4 },
  status: { fontSize: 14, marginTop: 6 },
  summary: { paddingHorizontal: 20, paddingTop: 18 },
  routeButton: { marginTop: 22, minHeight: 64, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  copy: { flex: 1, flexShrink: 1, gap: 3 },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  caption: { fontSize: 13 },
  schematic: { minHeight: 128, justifyContent: 'flex-end', paddingHorizontal: 24, paddingBottom: 16, paddingTop: 24 },
  endpoints: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  schematicLabel: { fontSize: 12, marginTop: 12 },
  routePanel: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: StyleSheet.hairlineWidth, marginTop: -10 },
  routeHandleRow: { height: 35, alignItems: 'center', justifyContent: 'center' },
  routeHandle: { height: 4, width: 40, borderRadius: 2, opacity: 0.45 },
  collapse: { position: 'absolute', right: 8, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  routeContent: { paddingHorizontal: 20, paddingTop: 2, paddingBottom: 16 },
  movements: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 16, paddingTop: 14, gap: 2 },
  movement: { minHeight: 49, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  glyph: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  duration: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
