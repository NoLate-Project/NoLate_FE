import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  Text,
  View,
} from 'react-native';

import { getTransitRouteSummaryAccessibilityLabel } from '../../src/modules/schedule/components/route/TransitRouteSummaryRow';
import { getScheduleAccessibilityVisibility } from '../../src/modules/schedule/accessibilityVisibility';
import {
  APP_ACCENT_BLUE,
  CompactRouteProgressStrip,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
  Ionicons,
} from './ScheduleDetailChrome';
import { createScheduleDetailStyles } from './schedule-detail.styles';
import type { ScheduleDetailPresentation } from './scheduleDetailPresentationModel';

type ScheduleDetailRouteQuickSummaryProps = {
  presentation: ScheduleDetailPresentation;
};

/** 축소된 경로 시트에 권장 출발, 남은 시간, 경로 막대와 출발 완료 동작을 요약한다. */
export function ScheduleDetailRouteQuickSummary({
  presentation,
}: ScheduleDetailRouteQuickSummaryProps) {
  const {
    completeDeparture,
    departureActionPending,
    departureCompleted,
    departureRemainingLabel,
    departureStatusAccent,
    effectiveRouteAccessibilityLabel,
    effectiveTransitRoutePresentation,
    hasDepartureInfo,
    isDark,
    primaryText,
    recommendedDepartureTimeLabel,
    routeArrivalSummary,
    routeFactLabels,
    routeIdentityTitle,
    routeProgressSegments,
    secondaryText,
    sheetMode,
    sheetQuickSummaryAnimatedStyle,
    snapSheet,
    topCardAccentText,
  } = presentation;

  return (
    <Animated.View
      {...getScheduleAccessibilityVisibility(sheetMode === 'compact')}
      style={[styles.sheetQuickSummaryClip, sheetQuickSummaryAnimatedStyle]}
    >
      <View style={styles.improvedCompactSummary}>
        <View style={styles.improvedRouteIdentityCompact}>
          <Pressable
            onPress={() => snapSheet('expanded')}
            accessibilityRole="button"
            accessibilityLabel={`일정 상세 시트 펼치기, ${routeIdentityTitle}`}
            style={({ pressed }) => [
              styles.improvedRouteIdentityMain,
              { opacity: pressed ? 0.62 : 1 },
            ]}
          >
            <Ionicons
              name="navigate-outline"
              size={15}
              color={topCardAccentText}
            />
            <Text
              numberOfLines={1}
              style={[
                styles.improvedRouteIdentityTitle,
                { color: primaryText },
              ]}
            >
              {routeIdentityTitle}
            </Text>
          </Pressable>
          {hasDepartureInfo && (
            <Pressable
              onPress={completeDeparture}
              disabled={departureCompleted || departureActionPending}
              accessibilityRole="button"
              accessibilityLabel={
                departureCompleted ? '출발 완료' : '출발했어요'
              }
              accessibilityState={{
                selected: departureCompleted,
                busy: departureActionPending,
                disabled: departureCompleted || departureActionPending,
              }}
              style={({ pressed }) => [
                styles.improvedCompactDepartureAction,
                {
                  backgroundColor: departureCompleted
                    ? isDark
                      ? 'rgba(41,121,255,0.20)'
                      : 'rgba(41,121,255,0.12)'
                    : APP_ACCENT_BLUE,
                  opacity: pressed || departureActionPending ? 0.64 : 1,
                },
              ]}
            >
              {departureActionPending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons
                  name={departureCompleted ? 'checkmark' : 'navigate'}
                  size={14}
                  color={departureCompleted ? topCardAccentText : '#FFFFFF'}
                />
              )}
              <Text
                style={[
                  styles.improvedCompactDepartureActionText,
                  {
                    color: departureCompleted ? topCardAccentText : '#FFFFFF',
                  },
                ]}
              >
                {departureActionPending
                  ? '처리 중'
                  : departureCompleted
                  ? '출발 완료'
                  : '출발했어요'}
              </Text>
            </Pressable>
          )}
        </View>

        <Pressable
          onPress={() => snapSheet('expanded')}
          accessibilityRole="button"
          accessibilityLabel={[
            '일정 상세 시트 펼치기',
            `권장 출발 ${recommendedDepartureTimeLabel}`,
            departureRemainingLabel,
            routeArrivalSummary,
            effectiveRouteAccessibilityLabel,
            ...routeFactLabels,
            routeProgressSegments.length > 0
              ? getTransitRouteSummaryAccessibilityLabel(routeProgressSegments)
              : undefined,
          ]
            .filter(Boolean)
            .join(', ')}
          style={({ pressed }) => [
            styles.improvedCompactBody,
            { opacity: pressed ? 0.72 : 1 },
          ]}
        >
          <View style={styles.improvedCompactTopRow}>
            <View style={styles.improvedCompactTimeCopy}>
              <Text
                style={[
                  styles.improvedDepartureEyebrow,
                  { color: topCardAccentText },
                ]}
              >
                권장 출발
              </Text>
              <View style={styles.improvedDepartureTimeRow}>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                  style={[
                    styles.improvedCompactDepartureTime,
                    { color: primaryText },
                  ]}
                >
                  {recommendedDepartureTimeLabel}
                </Text>
                {departureRemainingLabel ? (
                  <View
                    style={[
                      styles.improvedRemainingChip,
                      {
                        backgroundColor: isDark
                          ? 'rgba(41,121,255,0.20)'
                          : 'rgba(41,121,255,0.10)',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.improvedRemainingChipText,
                        { color: topCardAccentText },
                      ]}
                    >
                      {departureRemainingLabel}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
            <Ionicons name="chevron-up" size={18} color={secondaryText} />
          </View>
          <Text
            numberOfLines={1}
            style={[styles.improvedArrivalSummary, { color: secondaryText }]}
          >
            {routeArrivalSummary}
          </Text>
          {!effectiveTransitRoutePresentation ? (
            <CompactRouteProgressStrip
              segments={routeProgressSegments}
              isDark={isDark}
            />
          ) : null}
          {effectiveTransitRoutePresentation ? (
            <View style={styles.effectiveRouteCompactNotice}>
              <Ionicons
                name="swap-horizontal"
                size={14}
                color={topCardAccentText}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.effectiveRouteCompactNoticeText,
                  { color: topCardAccentText },
                ]}
              >
                실시간 추천 경로 · {effectiveTransitRoutePresentation.itinerary}
              </Text>
            </View>
          ) : departureCompleted ? (
            <View style={styles.improvedDepartureSharedRow}>
              <Ionicons
                name="checkmark-circle"
                size={15}
                color={departureStatusAccent}
              />
              <Text
                style={[styles.improvedCompactFacts, { color: secondaryText }]}
              >
                출발 상태를 공유했어요
              </Text>
            </View>
          ) : routeFactLabels.length > 0 ? (
            <Text
              numberOfLines={1}
              style={[styles.improvedCompactFacts, { color: secondaryText }]}
            >
              {routeFactLabels.join(' · ')}
            </Text>
          ) : null}
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = createScheduleDetailStyles({
  APP_ACCENT_BLUE,
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
});
