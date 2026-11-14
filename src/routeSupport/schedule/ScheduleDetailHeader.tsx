import React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import Reanimated, { FadeIn, ReduceMotion } from "react-native-reanimated";

import type { TmapLoadState } from "../../modules/map/TmapMapView";
import {
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
  Ionicons,
} from "./ScheduleDetailChrome";
import { createScheduleDetailStyles } from "./schedule-detail.styles";
import type { ScheduleDetailPresentation } from "./scheduleDetailPresentationModel";

const MAP_STATUS_HEIGHT = 52;
const LARGE_MAP_STATUS_WITH_ACTION_HEIGHT = 108;
const MAP_STATUS_GAP = 8;
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

/** 일정 제목, 공유·수정 동작과 현재 경로 요약을 상단에 표시한다. */
export function ScheduleDetailHeader({
  presentation,
  mapState,
  onRetryMap,
}: ScheduleDetailHeaderProps) {
  const { height, fontScale } = useWindowDimensions();
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
  const largeRouteHeader = !isPlainSchedule && usesLargeRouteHeader;
  const largeDurationFontSize = Math.round(11 * Math.min(fontScale, 2.5));
  const mapStatus = mapState !== 'ready' ? mapState : undefined;
  const mapRetryPending = mapStatus === 'retrying';
  const canRetryMap = mapStatus === 'error' || mapRetryPending;
  const mapStatusHeight = largeRouteHeader ? LARGE_MAP_STATUS_WITH_ACTION_HEIGHT : MAP_STATUS_HEIGHT;
  // Reserve the same clearance at each map state so the route sheet stays put on retry.
  const mapStatusClearance = mapState === 'ready' ? mapStatusHeight + MAP_STATUS_GAP : 0;
  const title = (
    <Text
      accessibilityRole="header"
      accessibilityLabel={isPlainSchedule ? '일정 상세' : item.title}
      style={[
        styles.topHeaderTitle,
        isPlainSchedule && styles.plainTopHeaderTitle,
        largeRouteHeader && styles.topHeaderTitleLarge,
        { color: primaryText },
      ]}
      numberOfLines={largeRouteHeader ? undefined : 1}
      lineBreakStrategyIOS="hangul-word"
    >
      {isPlainSchedule ? '일정 상세' : item.title}
    </Text>
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
        <Ionicons
          name={hasDetailedRoute ? 'navigate-outline' : 'location-outline'}
          size={largeRouteHeader ? 19 : 13}
          color={topCardAccentText}
        />
        <Text
          style={[styles.topHeaderRouteBarText, { color: primaryText }]}
          accessibilityLabel={routeTitle}
          maxFontSizeMultiplier={largeRouteHeader ? 2.5 : undefined}
          numberOfLines={largeRouteHeader ? undefined : 1}
          lineBreakStrategyIOS="hangul-word"
        >
          {routeTitle}
        </Text>
      </View>
      {!largeRouteHeader && duration}
    </View>
  ) : null;

  return (
      <View
        style={styles.topOverlay}
        onLayout={!isPlainSchedule ? ({ nativeEvent }) => setRouteHeaderHeight(Math.ceil(nativeEvent.layout.height + mapStatusClearance)) : undefined}
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
                    onPress={openScheduleEditor}
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
            <View style={{ maxHeight: Math.max(110, Math.floor(height * 0.48) - insets.top - 62) }}>
              <ScrollView
                bounces={false}
                indicatorStyle={isDark ? 'white' : 'black'}
                style={styles.topHeaderScrollableContext}
              >
                {title}
                {routeBar}
              </ScrollView>
              {duration}
            </View>
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
                {mapStatus === 'loading' || mapRetryPending ? (
                  <ActivityIndicator size="small" color={topCardAccentText} />
                ) : (
                  <Ionicons name="map-outline" size={16} color={secondaryText} />
                )}
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
