import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons as ExpoIonicons } from '@expo/vector-icons';
import BrandedLoader from '../../../ui/BrandedLoader';
import styles from './styles';
import { SELECTABLE_TRAVEL_MODES } from './params';
import { formatAlternativeInfo, formatDuration } from './presentation';
import CalendarGlassSurface from '../components/calendar/CalendarGlassSurface';
import { TRAVEL_MODE_META } from '../travelMode';
import { getNaverLikeRouteRecommendationLabel } from '../routeAlternativeRanking';
import {
  getRouteSelectionAccessibilityProps,
  getRouteSelectionConfirmAccessibilityProps,
} from '../routeSelectionAccessibility';
import type { RoutePlannerController } from './useRoutePlannerController';

function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
  return (
    <ExpoIonicons
      {...props}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}

type Props = { controller: RoutePlannerController };

/** 출발지·도착지 입력과 장소 검색 결과를 포함한 경로 선택 단계를 렌더링합니다. */
export function RoutePlannerSelectionStage({ controller }: Props) {
  const {
    insets,
    colors,
    isDark,
    overlayBoxBg,
    overlayCardBg,
    travelMode,
    setTravelMode,
    etaLoading,
    alternativesError,
    routeAlternatives,
    transitRouteFilter,
    setTransitRouteFilter,
    selectedAlternativeId,
    isRouteSelectionStage,
    transitFilterCounts,
    visibleTransitFilterItems,
    visibleAlternatives,
    selectAlternativeByIndex,
    retryRouteSearch,
    canEnterRouteDetail,
    onEnterRouteDetailView,
  } = controller;
  return (
    <>
      {isRouteSelectionStage && (
        <View
          style={styles.routeSelectionStageOverlay}
          pointerEvents="box-none"
        >
          <CalendarGlassSurface
            prominent
            variant="mapCard"
            style={[
              styles.routeSelectionStagePanel,
              styles.overlaySurface,
              {
                borderColor: colors.border,
                paddingBottom: Math.max(insets.bottom + 12, 20),
              },
            ]}
          >
            <Text
              style={[
                styles.routeSelectionStageTitle,
                { color: colors.textPrimary },
              ]}
            >
              경로를 먼저 선택해주세요
            </Text>
            <Text
              style={[
                styles.routeSelectionStageSubtitle,
                { color: colors.textSecondary },
              ]}
            >
              선택한 뒤 지도에서 상세 경로를 확인할 수 있습니다.
            </Text>

            <View style={styles.modeRow}>
              {SELECTABLE_TRAVEL_MODES.map(travelModeItem => (
                <Pressable
                  key={`selection-stage-${travelModeItem}`}
                  {...getRouteSelectionAccessibilityProps(
                    'radio',
                    `${TRAVEL_MODE_META[travelModeItem].label} 이동수단`,
                    travelMode === travelModeItem,
                  )}
                  onPress={() => setTravelMode(travelModeItem)}
                  style={[
                    styles.modeChip,
                    {
                      borderColor:
                        travelMode === travelModeItem
                          ? colors.selectedDayBg
                          : colors.border,
                      backgroundColor:
                        travelMode === travelModeItem
                          ? colors.selectedDayBg
                          : overlayBoxBg,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color:
                        travelMode === travelModeItem
                          ? colors.selectedDayText
                          : colors.textPrimary,
                      fontSize: 12,
                      fontWeight: '700',
                    }}
                  >
                    {TRAVEL_MODE_META[travelModeItem].label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View
              style={[
                styles.routeSelectionStageListWrap,
                { borderColor: colors.border, backgroundColor: overlayBoxBg },
              ]}
            >
              {travelMode === 'TRANSIT' &&
                !etaLoading &&
                !alternativesError &&
                !!routeAlternatives.length &&
                visibleTransitFilterItems.length > 1 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={[
                      styles.transitFilterRow,
                      { borderBottomColor: colors.border },
                    ]}
                    contentContainerStyle={styles.transitFilterRowContent}
                  >
                    {visibleTransitFilterItems.map(item => {
                      const selected = transitRouteFilter === item.key;
                      const count = transitFilterCounts[item.key];
                      const label =
                        item.key === 'ALL'
                          ? item.label
                          : `${item.label} ${count}`;
                      return (
                        <Pressable
                          key={`stage-filter-${item.key}`}
                          {...getRouteSelectionAccessibilityProps(
                            'tab',
                            `${label} 경로 필터`,
                            selected,
                          )}
                          onPress={() => setTransitRouteFilter(item.key)}
                          style={[
                            styles.transitFilterTab,
                            {
                              borderBottomColor: selected
                                ? colors.textPrimary
                                : 'transparent',
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.transitFilterTabText,
                              {
                                color: selected
                                  ? colors.textPrimary
                                  : colors.textSecondary,
                              },
                            ]}
                          >
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                )}

              {etaLoading ? (
                <View style={styles.alternativeLoadingRow}>
                  <BrandedLoader
                    size="button"
                    variant="route"
                    accessibilityLabel="경로 옵션을 계산하고 있어요"
                  />
                  <Text
                    style={[
                      styles.alternativeLoadingText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    경로 옵션 계산 중..
                  </Text>
                </View>
              ) : null}

              {!etaLoading && !!alternativesError ? (
                <View style={styles.alternativeErrorWrap}>
                  <Text
                    style={[
                      styles.alternativeErrorText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {alternativesError}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="경로 다시 검색"
                    onPress={retryRouteSearch}
                    style={[
                      styles.alternativeRetryButton,
                      { backgroundColor: colors.selectedDayBg },
                    ]}
                  >
                    <Ionicons
                      name="refresh"
                      size={15}
                      color={colors.selectedDayText}
                    />
                    <Text
                      style={[
                        styles.alternativeRetryText,
                        { color: colors.selectedDayText },
                      ]}
                    >
                      다시 검색
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {!etaLoading &&
              !alternativesError &&
              !visibleAlternatives.length ? (
                <Text
                  style={[
                    styles.alternativeEmptyText,
                    { color: colors.textSecondary },
                  ]}
                >
                  표시할 경로가 없습니다.
                </Text>
              ) : null}

              {!etaLoading &&
                !alternativesError &&
                !!visibleAlternatives.length && (
                  <ScrollView
                    bounces={false}
                    alwaysBounceVertical={false}
                    contentContainerStyle={styles.routeSelectionStageList}
                  >
                    {visibleAlternatives.map((option, index) => {
                      const selected = option.id === selectedAlternativeId;
                      const routeLabel = getNaverLikeRouteRecommendationLabel(
                        option,
                        visibleAlternatives,
                        index,
                      );
                      const summary =
                        option.transitModeSummary ??
                        formatAlternativeInfo(option);
                      const stepSummary = option.stepSummary?.trim();
                      return (
                        <Pressable
                          key={`stage-${option.id}`}
                          {...getRouteSelectionAccessibilityProps(
                            'radio',
                            [
                              routeLabel,
                              formatDuration(option.minutes),
                              summary,
                              stepSummary,
                            ]
                              .filter(Boolean)
                              .join(', '),
                            selected,
                          )}
                          onPress={() => selectAlternativeByIndex(index, false)}
                          style={[
                            styles.routeSelectionStageCard,
                            {
                              borderColor: selected
                                ? colors.selectedDayBg
                                : colors.border,
                              backgroundColor: selected
                                ? isDark
                                  ? 'rgba(29,114,255,0.22)'
                                  : '#EAF2FF'
                                : overlayCardBg,
                            },
                          ]}
                        >
                          <View style={styles.routeSelectionStageCardTop}>
                            <Text
                              style={[
                                styles.alternativeRouteLabel,
                                { color: colors.textPrimary },
                              ]}
                            >
                              {routeLabel}
                            </Text>
                            <Text
                              style={[
                                styles.routeSelectionStageDuration,
                                { color: colors.textPrimary },
                              ]}
                            >
                              {formatDuration(option.minutes)}
                            </Text>
                          </View>
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.routeSelectionStageSummary,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {summary}
                          </Text>
                          {!!stepSummary && (
                            <Text
                              numberOfLines={2}
                              style={[
                                styles.routeSelectionStageStep,
                                { color: colors.textSecondary },
                              ]}
                            >
                              {stepSummary}
                            </Text>
                          )}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                )}
            </View>

            <Pressable
              {...getRouteSelectionConfirmAccessibilityProps(
                canEnterRouteDetail,
              )}
              onPress={onEnterRouteDetailView}
              disabled={!canEnterRouteDetail}
              style={[
                styles.confirmBtn,
                {
                  marginTop: 10,
                  backgroundColor: canEnterRouteDetail
                    ? colors.selectedDayBg
                    : colors.border,
                },
              ]}
            >
              <Text
                style={[styles.confirmText, { color: colors.selectedDayText }]}
              >
                지도에서 상세 경로 보기
              </Text>
            </Pressable>
          </CalendarGlassSurface>
        </View>
      )}
    </>
  );
}
