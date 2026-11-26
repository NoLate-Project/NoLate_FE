import React, { useContext, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Reanimated, { FadeIn, ReduceMotion } from "react-native-reanimated";

import type { TmapLoadState } from "../../modules/map/TmapMapView";
import LoadingIndicator from "../../ui/LoadingIndicator";
import {
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
  Ionicons,
} from "./ScheduleDetailChrome";
import { createScheduleDetailStyles } from "./schedule-detail.styles";
import type { ScheduleDetailPresentation } from "./scheduleDetailPresentationModel";
import { useSystemReduceMotion } from "../../modules/performance/useSystemReduceMotion";
import {
  SCHEDULE_EDITOR_EXIT_MS,
  ScheduleDetailEditingContext,
  ScheduleDetailEditResultContext,
} from "./ScheduleDetailEditorTransition";
import { getRouteInfoFromRoute, isSameScheduleDraftRoute } from "../../modules/schedule/routeInfo";
import { buildSavedJourneyInput } from "../../modules/journey/savedJourneyGuidance";
import { useSavedJourneyGuidanceView } from "../../modules/journey/useSavedJourneyGuidanceView";

function hasEditedRoute(previous: ScheduleDetailPresentation["item"], updated: ScheduleDetailPresentation["item"]) {
  if (previous.route === updated.route && previous.travelMinutes === updated.travelMinutes
    && previous.travelMode === updated.travelMode && previous.origin === updated.origin
    && previous.destination === updated.destination) return false;

  const before = getRouteInfoFromRoute(previous.route, previous);
  const after = getRouteInfoFromRoute(updated.route, updated);
  if (!before || !after) return Boolean(before || after);
  // A schedule time edit can re-anchor the same route. It does not change the route itself.
  return previous.travelMode !== updated.travelMode
    || !isSameScheduleDraftRoute(before, { ...after, departureTime: before.departureTime });
}

const MAP_STATUS_HEIGHT = 52;
const LARGE_MAP_STATUS_WITH_ACTION_HEIGHT = 108;
const MAP_STATUS_GAP = 8;
const LARGE_HEADER_FONT_MULTIPLIER = 2.5;
const mapStatusEntrance = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const mapStatusLabels = {
  loading: '지도를 불러오는 중',
  retrying: '지도를 다시 불러오는 중',
  error: '지도를 불러오지 못했어요',
  unavailable: '지도를 사용할 수 없어요',
};

type ScheduleDetailHeaderProps = {
  presentation: ScheduleDetailPresentation;
  mapState?: TmapLoadState | 'retrying';
  onRetryMap: () => void;
};

/** The map keeps its own camera and route sheet; this surface only changes the
 * top-level reading order when the user enters guidance. */
function JourneyNavigationHeader({ presentation, mapState, onRetryMap }: ScheduleDetailHeaderProps) {
  const reduceMotion = useSystemReduceMotion();
  const {
    goBack, guidanceEndedHandoff, insets, isDark, item, navigationEnd, navigationReconciling, primaryText, secondaryText,
    routeDurationLabel, setRouteHeaderHeight, sheetBorder, sheetMode, topCardAccentText,
  } = presentation;
  const input = React.useMemo(() => buildSavedJourneyInput(item.route, item.origin, item.destination),
    [item.route, item.origin, item.destination]);
  const { snapshot, stage } = useSavedJourneyGuidanceView(input, String(item.id));
  const active = snapshot?.status === 'ACTIVE';
  const armed = snapshot?.status === 'ARMED';
  const ended = !active && !armed &&
    (navigationEnd?.scheduleId === String(item.id) || guidanceEndedHandoff);
  const arrived = navigationEnd?.scheduleId === String(item.id) && navigationEnd.reason === 'DESTINATION_ARRIVED';
  const expanded = sheetMode === 'expanded';
  const title = ended ? arrived ? '목적지에 도착했어요' : '위치 안내가 끝났어요'
    : stage?.title ?? (active ? '현재 위치를 확인 중이에요' : '출발 전');
  const action = ended ? '저장한 경로는 계속 볼 수 있어요'
    : stage?.action ?? (active ? '위치가 확인되면 안내를 이어가요' : '안내를 준비하고 이동하면 출발을 감지해요');
  const mapProblem = mapState === 'error' || mapState === 'unavailable';
  const rideCount = input?.legs.filter(leg => leg.kind === 'BUS' || leg.kind === 'SUBWAY').length ?? 0;
  // This is the saved route's planned duration, never a live remaining-time claim.
  const summary = [routeDurationLabel && routeDurationLabel !== '미설정' ? `예정 ${routeDurationLabel}` : '대중교통',
    rideCount > 1 ? `환승 ${rideCount - 1}회` : rideCount === 1 ? '환승 없음' : undefined].filter(Boolean).join(' · ');
  const surface = { backgroundColor: isDark ? '#20242C' : '#FFFFFF', borderColor: sheetBorder };
  return <Reanimated.View entering={reduceMotion ? undefined : FadeIn.duration(220).reduceMotion(ReduceMotion.System)}
    pointerEvents="box-none"
    style={[styles.topOverlay, navigationHeaderStyles.overlay, { paddingTop: insets.top + 8 }]} onLayout={({ nativeEvent }) =>
    setRouteHeaderHeight(Math.ceil(nativeEvent.layout.height), 0)}>
    <View testID="schedule-navigation-header" pointerEvents="box-none">
      <View style={navigationHeaderStyles.row}>
        <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="길안내 화면에서 돌아가기"
          style={({ pressed }) => [navigationHeaderStyles.back, surface, { opacity: pressed ? 0.58 : 1 }]}>
          <Ionicons name="chevron-back-outline" size={22} color={primaryText} />
        </Pressable>
        {!expanded && <>
          <View style={[navigationHeaderStyles.statePill,
            { backgroundColor: isDark ? '#183C70' : '#E7F0FF', borderColor: sheetBorder }]}>
            <Text testID="schedule-navigation-state" accessibilityRole="header"
              style={[navigationHeaderStyles.state, { color: topCardAccentText }]}>
              {ended ? '안내 종료' : navigationReconciling ? '상태 확인 중' : active ? '안내 중' : armed ? '출발 대기' : '안내 준비'}
            </Text>
          </View>
          <View style={[navigationHeaderStyles.summaryPill, surface]}>
            <Text testID="schedule-navigation-route-summary" style={[navigationHeaderStyles.summary, { color: primaryText }]}
              accessibilityLabel={`대중교통 길안내, ${summary}`}
              lineBreakStrategyIOS="hangul-word">{summary}</Text>
          </View>
        </>}
      </View>
      {!expanded && ended && <Reanimated.View key={`${title}:${action}`}
        entering={reduceMotion ? undefined : FadeIn.duration(160).reduceMotion(ReduceMotion.System)}
        testID="schedule-navigation-next-step" style={[navigationHeaderStyles.step, surface]}
        accessibilityLiveRegion="polite">
        <Text accessibilityRole="header" numberOfLines={2} maxFontSizeMultiplier={2}
          style={[navigationHeaderStyles.title, { color: primaryText }]}>{title}</Text>
        <Text numberOfLines={2} maxFontSizeMultiplier={2}
          style={[navigationHeaderStyles.action, { color: secondaryText }]}>{action}</Text>
      </Reanimated.View>}
      {mapProblem && <View style={[navigationHeaderStyles.mapProblem, surface]}>
        <Text style={[navigationHeaderStyles.action, { color: secondaryText }]}>지도를 불러오지 못했어요</Text>
        {mapState === 'error' && <Pressable accessibilityRole="button" accessibilityLabel="지도 다시 불러오기"
          onPress={onRetryMap} style={navigationHeaderStyles.retry}>
          <Text style={[navigationHeaderStyles.action, { color: topCardAccentText }]}>다시 시도</Text>
        </Pressable>}
      </View>}
    </View>
  </Reanimated.View>;
}

/** 일정 제목, 공유·수정 동작과 현재 경로 요약을 상단에 표시한다. */
export function ScheduleDetailHeader({
  presentation,
  mapState,
  onRetryMap,
}: ScheduleDetailHeaderProps) {
  const { height, fontScale } = useWindowDimensions();
  const editing = useContext(ScheduleDetailEditingContext);
  const editResult = useContext(ScheduleDetailEditResultContext);
  const reduceMotion = useSystemReduceMotion();
  const editButton = useRef<View>(null);
  const openedEditor = useRef(false);
  const handledEditResult = useRef<typeof editResult>(null);
  const [changedHeader, setChangedHeader] = useState({ title: false, route: false });
  const highlight = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (editing || !openedEditor.current) return;
    const timer = setTimeout(() => {
      openedEditor.current = false;
      if (editButton.current) AccessibilityInfo.sendAccessibilityEvent(editButton.current, "focus");
    }, reduceMotion ? 0 : SCHEDULE_EDITOR_EXIT_MS);
    return () => clearTimeout(timer);
  }, [editing, reduceMotion]);
  const {
    canEditSchedule,
    canManageSchedule,
    colors,
    goBack,
    hasDetailedRoute,
    hasRouteSummary,
    insets,
    internalPreviewItem,
    isDark,
    isPlainSchedule,
    navigationMode,
    item,
    largeRouteHeader: usesLargeRouteHeader,
    openScheduleEditor,
    plainHeaderHeight,
    primaryText,
    routeTitle,
    secondaryText,
    setRouteHeaderHeight,
    setShareSheetVisible,
    sheetBorder,
    showTopRouteBar,
    topCardAccentText,
    topCardControlBg,
    travelText,
  } = presentation;
  useEffect(() => {
    if (editing || isPlainSchedule || !editResult || editResult === handledEditResult.current
      || editResult.updated.id !== item.id) return;
    if (reduceMotion) {
      handledEditResult.current = editResult;
      return;
    }
    const { previous, updated } = editResult;
    const title = previous.title !== updated.title;
    const route = hasEditedRoute(previous, updated);
    if (!title && !route) {
      handledEditResult.current = editResult;
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      handledEditResult.current = editResult;
      setChangedHeader({ title, route });
      highlight.setValue(1);
      Animated.timing(highlight, { toValue: 0, duration: 180, useNativeDriver: true, isInteraction: false })
        .start(({ finished }) => {
          if (active && finished) setChangedHeader({ title: false, route: false });
        });
    }, SCHEDULE_EDITOR_EXIT_MS);
    return () => {
      active = false;
      clearTimeout(timer);
      highlight.stopAnimation();
      highlight.setValue(0);
    };
  }, [editing, editResult, highlight, isPlainSchedule, item.id, reduceMotion]);

  const renderHighlight = (field: "title" | "route") => changedHeader[field] && !editing && !reduceMotion
    ? <Animated.View
      testID={`schedule-detail-edit-highlight-${field}`}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFillObject, { backgroundColor: topCardAccentText, borderRadius: 8,
        opacity: highlight.interpolate({ inputRange: [0, 1], outputRange: [0, 0.14] }) }]}
    />
    : null;
  const largeRouteHeader = !isPlainSchedule && usesLargeRouteHeader;
  const headerFontScale = Math.min(fontScale, LARGE_HEADER_FONT_MULTIPLIER);
  const largeTitleFontSize = Math.round(17 * headerFontScale);
  const largeDurationFontSize = Math.round(11 * headerFontScale);
  const mapStatus = mapState !== 'ready' ? mapState : undefined;
  const mapRetryPending = mapStatus === 'retrying';
  const canRetryMap = mapStatus === 'error' || mapRetryPending;
  const mapStatusHeight = largeRouteHeader ? LARGE_MAP_STATUS_WITH_ACTION_HEIGHT : MAP_STATUS_HEIGHT;
  // Reserve the same clearance at each map state so the route sheet stays put on retry.
  const mapStatusClearance = mapState === 'ready' ? mapStatusHeight + MAP_STATUS_GAP : 0;
  const titleText = (
    <Text
      accessibilityRole="header"
      accessibilityLabel={isPlainSchedule ? '일정 상세' : item.title}
      style={[
        styles.topHeaderTitle,
        isPlainSchedule && styles.plainTopHeaderTitle,
        !isPlainSchedule && titleTextLayout,
        largeRouteHeader && { fontSize: largeTitleFontSize },
        { color: primaryText },
      ]}
      numberOfLines={largeRouteHeader ? undefined : 1}
      allowFontScaling={!largeRouteHeader}
      lineBreakStrategyIOS="hangul-word"
    >
      {isPlainSchedule ? '일정 상세' : item.title}
    </Text>
  );
  const title = isPlainSchedule ? titleText : (
    <View style={[titleRowLayout, largeRouteHeader && styles.topHeaderTitleLarge]}>
      {renderHighlight("title")}
      {titleText}
    </View>
  );
  const duration = hasRouteSummary ? (
    <View style={[styles.topHeaderTravelPill, largeRouteHeader && styles.topHeaderTravelPillLarge]}>
      <Text
        testID="schedule-detail-route-duration"
        style={[
          styles.topHeaderTravelText,
          { color: topCardAccentText },
          largeRouteHeader && { fontSize: largeDurationFontSize, lineHeight: Math.ceil(largeDurationFontSize * 1.3) },
        ]}
        allowFontScaling={!largeRouteHeader}
        accessibilityLabel={travelText}
        numberOfLines={largeRouteHeader ? undefined : 1}
        lineBreakStrategyIOS="hangul-word"
      >
        {largeRouteHeader ? travelText.replace(/(\d+)\s*분/gu, '$1\u2060분') : travelText}
      </Text>
    </View>
  ) : null;
  const routeBar = showTopRouteBar ? (
    <View style={[
      styles.topHeaderRouteBar,
      largeRouteHeader && styles.topHeaderRouteBarLarge,
      { borderTopColor: sheetBorder },
    ]}>
      <View style={[styles.topHeaderRouteBarMain, largeRouteHeader && styles.topHeaderRouteBarMainLarge]}>
        {renderHighlight("route")}
        <Ionicons
          name={hasDetailedRoute ? 'navigate-outline' : 'location-outline'}
          size={largeRouteHeader ? 19 : 13}
          color={topCardAccentText}
        />
        <Text
          testID="schedule-detail-route-name"
          style={[styles.topHeaderRouteBarText, { color: primaryText }]}
          accessibilityLabel={routeTitle}
          maxFontSizeMultiplier={largeRouteHeader ? LARGE_HEADER_FONT_MULTIPLIER : undefined}
          numberOfLines={largeRouteHeader ? undefined : 1}
          lineBreakStrategyIOS="hangul-word"
        >
          {routeTitle}
        </Text>
      </View>
      {!largeRouteHeader && duration}
    </View>
  ) : null;

  if (navigationMode && !isPlainSchedule) {
    return <JourneyNavigationHeader presentation={presentation} mapState={mapState} onRetryMap={onRetryMap} />;
  }

  return (
      <View
        style={styles.topOverlay}
        onLayout={!isPlainSchedule ? ({ nativeEvent }) => setRouteHeaderHeight(Math.ceil(nativeEvent.layout.height), mapStatusClearance) : undefined}
      >
        <View
          style={[
            styles.topHeaderSurface,
            isPlainSchedule
              ? { backgroundColor: colors.background }
              : isDark ? styles.panelOpaqueBackdropDark : styles.panelOpaqueBackdropLight,
            isPlainSchedule && styles.plainPageHeader,
            {
              paddingTop: insets.top + 6,
              borderBottomColor: sheetBorder,
              ...(isPlainSchedule ? { height: plainHeaderHeight } : null),
            },
          ]}
        >
          <View style={styles.topHeaderRow}>
            <Pressable
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel="이전 화면으로 돌아가기"
              style={({ pressed }) => [
                styles.topHeaderIconButton,
                {
                  backgroundColor: pressed ? topCardControlBg : 'transparent',
                  opacity: pressed ? 0.58 : 1,
                },
              ]}
            >
              <Ionicons name="chevron-back-outline" size={21} color={primaryText} />
            </Pressable>

            <View
              style={[
                styles.topHeaderContent,
                isPlainSchedule && styles.plainTopHeaderContent,
              ]}
            >
              <View
                style={[
                  styles.topHeaderTitleRow,
                  isPlainSchedule && styles.plainTopHeaderTitleRow,
                ]}
              >
                {!isPlainSchedule ? (
                  <View style={styles.topHeaderKindBadge}>
                    <Ionicons
                      name="calendar-clear-outline"
                      size={13}
                      color={topCardAccentText}
                    />
                    <Text
                      allowFontScaling={!largeRouteHeader}
                      style={[
                        styles.topHeaderKindText,
                        largeRouteHeader && styles.topHeaderKindTextLarge,
                        { color: topCardAccentText },
                      ]}
                    >
                      일정
                    </Text>
                  </View>
                ) : null}
                {!largeRouteHeader && title}
              </View>
            </View>

            {(canManageSchedule || canEditSchedule) && (
              <View
                style={[
                  styles.topHeaderActions,
                  isPlainSchedule && styles.plainTopHeaderActions,
                ]}
              >
                {canManageSchedule ? (
                  <Pressable
                    onPress={() => {
                      if (!internalPreviewItem) setShareSheetVisible(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="일정 공유"
                    style={({ pressed }) => [
                      styles.topHeaderIconButton,
                      {
                        backgroundColor: pressed
                          ? topCardControlBg
                          : 'transparent',
                        opacity: pressed ? 0.58 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      name="share-social-outline"
                      size={20}
                      color={primaryText}
                    />
                  </Pressable>
                ) : null}
                {canEditSchedule ? (
                  <Pressable
                    ref={editButton}
                    onPress={() => {
                      openedEditor.current = true;
                      openScheduleEditor();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="일정 수정"
                    style={({ pressed }) => [
                      styles.topHeaderIconButton,
                      {
                        backgroundColor: pressed
                          ? isPlainSchedule
                            ? isDark
                              ? 'rgba(75,157,255,0.14)'
                              : 'rgba(41,121,255,0.08)'
                            : topCardControlBg
                          : 'transparent',
                        opacity: pressed ? 0.58 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      name="pencil-outline"
                      size={isPlainSchedule ? 19 : 20}
                      color={isPlainSchedule ? topCardAccentText : primaryText}
                    />
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>

          {largeRouteHeader ? (
            <ScrollView
              testID="schedule-detail-header-scroll"
              bounces={false}
              indicatorStyle={isDark ? 'white' : 'black'}
              style={[styles.topHeaderScrollableContext, { maxHeight: Math.max(110, Math.floor(height * 0.48) - insets.top - 62) }]}
            >
              {title}
              {routeBar}
              {duration}
            </ScrollView>
          ) : routeBar}
          {mapStatus ? (
            <View style={[
              styles.topHeaderMapStatus,
              largeRouteHeader && styles.topHeaderMapStatusLarge,
              { borderTopColor: sheetBorder, height: mapStatusHeight, marginTop: MAP_STATUS_GAP },
            ]}>
              <Reanimated.View
                key={mapStatus}
                entering={mapStatusEntrance}
                style={[styles.topHeaderMapStatusCopy, largeRouteHeader && styles.topHeaderMapStatusCopyLarge]}
              >
                <View style={styles.topHeaderMapStatusMark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  {mapStatus === 'loading' || mapRetryPending ? (
                    <LoadingIndicator size="inline" delayMs={150} />
                  ) : (
                    <Ionicons name="map-outline" size={16} color={secondaryText} />
                  )}
                </View>
                <Text
                  accessibilityLiveRegion="polite"
                  maxFontSizeMultiplier={1.5}
                  style={[styles.topHeaderMapStatusText, styles.topHeaderMapStatusLabel, { color: secondaryText }]}
                  lineBreakStrategyIOS="hangul-word"
                >
                  {mapStatusLabels[mapStatus]}
                </Text>
              </Reanimated.View>
              {canRetryMap ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="지도 다시 불러오기"
                  accessibilityState={{ busy: mapRetryPending, disabled: mapRetryPending }}
                  disabled={mapRetryPending}
                  onPress={onRetryMap}
                  style={({ pressed }) => [styles.topHeaderMapRetry, largeRouteHeader && styles.topHeaderMapRetryLarge, { opacity: pressed ? 0.58 : 1 }]}
                >
                  <Text maxFontSizeMultiplier={1.5} style={[styles.topHeaderMapStatusText, { color: mapRetryPending ? secondaryText : topCardAccentText }]}>
                    다시 시도
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>

  );
}

const styles = createScheduleDetailStyles({
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
});
const titleRowLayout = { flex: 1, minWidth: 0 } as const;
const titleTextLayout = { flex: 0 } as const;
const navigationHeaderStyles = StyleSheet.create({
  overlay: { paddingHorizontal: 16, paddingBottom: 8 },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  back: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center' },
  statePill: { minHeight: 44, paddingHorizontal: 13, paddingVertical: 12, borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center', flexShrink: 1 },
  state: { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  summaryPill: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 13, paddingVertical: 12,
    borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  summary: { fontSize: 13, fontWeight: '600', lineHeight: 20 },
  step: { marginTop: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth, gap: 3 },
  title: { fontSize: 19, lineHeight: 26, fontWeight: '700' },
  action: { fontSize: 14, lineHeight: 20 },
  mapProblem: { marginTop: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  retry: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
});
