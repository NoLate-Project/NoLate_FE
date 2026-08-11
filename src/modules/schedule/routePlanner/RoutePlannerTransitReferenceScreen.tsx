import { Pressable, ScrollView, StatusBar, Text, View } from 'react-native';
import BrandedLoader from '../../../ui/BrandedLoader';
import styles from './styles';
import { type TransitRouteFilter } from './params';
import {
  buildTransitLegMeta,
  buildTransitTimelineTitle,
  formatTransitDepartureNow,
  getTransitLegKindMeta,
} from './presentation';
import { buildTransitLegAssistText } from './routeTransitMarkers';
import { TRAVEL_MODE_META } from '../travelMode';
import type { TravelMode } from '../types';
import { formatRouteDuration as formatRouteInfoDuration } from '../routeInfo';
import type { RoutePlannerController } from './useRoutePlannerController';

const TRANSIT_FILTER_ITEMS: Array<{ key: TransitRouteFilter; label: string }> =
  [
    { key: 'ALL', label: '전체' },
    { key: 'BUS', label: '버스' },
    { key: 'SUBWAY', label: '지하철' },
    { key: 'MIXED', label: '버스+지하철' },
  ];

type Props = { controller: RoutePlannerController };

/** 컨트롤러가 계산한 상태와 명령을 사용해 대중교통 경로 상세 화면을 렌더링합니다. */
export function RoutePlannerTransitReferenceScreen({ controller }: Props) {
  const {
    insets,
    setTravelMode,
    etaLoading,
    alternativesError,
    routeSubmitPending,
    transitRouteFilter,
    setTransitRouteFilter,
    focusedTransitLegIndex,
    originDisplay,
    destinationDisplay,
    transitFilterCounts,
    selectedAlternative,
    canSubmitRoute,
    selectedTransitTimeRange,
    selectedTransitProgressSegments,
    selectedRouteInfo,
    goBack,
    submit,
    focusMapOnTransitLeg,
  } = controller;
  const transitLegs = selectedAlternative?.transitLegs ?? [];
  const departureText = formatTransitDepartureNow();
  const departureTimeText = departureText.replace(/\s*출발$/, '');
  const referenceTravelModes: TravelMode[] = ['TRANSIT', 'CAR', 'WALK', 'BIKE'];

  return (
    <View style={styles.transitReferenceScreen}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="transparent"
        translucent
      />
      <ScrollView
        contentContainerStyle={[
          styles.transitReferenceScrollContent,
          {
            paddingTop: insets.top,
            paddingBottom: Math.max(insets.bottom + 20, 32),
          },
        ]}
        bounces={false}
        alwaysBounceVertical={false}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.transitReferenceAddressCard}>
          <View style={styles.transitReferenceRouteRows}>
            <View style={styles.transitReferenceSwapRail}>
              <Text style={styles.transitReferenceSwapText}>↑↓</Text>
            </View>
            <View style={styles.transitReferenceAddressContent}>
              <View style={styles.transitReferenceAddressRow}>
                <View
                  style={[
                    styles.transitReferencePointDot,
                    styles.transitReferenceOriginDot,
                  ]}
                />
                <Text
                  numberOfLines={1}
                  style={styles.transitReferenceAddressText}
                >
                  {originDisplay}
                </Text>
                <Pressable
                  onPress={goBack}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="경로 화면 닫기"
                  style={styles.transitReferenceCloseButton}
                >
                  <Text style={styles.transitReferenceCloseText}>×</Text>
                </Pressable>
              </View>
              <View style={styles.transitReferenceAddressDivider} />
              <View style={styles.transitReferenceAddressRow}>
                <View
                  style={[
                    styles.transitReferencePointDot,
                    styles.transitReferenceDestinationDot,
                  ]}
                />
                <Text
                  numberOfLines={1}
                  style={styles.transitReferenceAddressText}
                >
                  {destinationDisplay}
                </Text>
                <Text style={styles.transitReferenceMoreText}>⋮</Text>
              </View>
            </View>
          </View>
          <View style={styles.transitReferenceEntranceRow}>
            <Text style={styles.transitReferenceEntranceLabel}>정문</Text>
            <Text style={styles.transitReferenceEntranceAction}>
              출입구 변경 ›
            </Text>
          </View>
        </View>

        <View style={styles.transitReferenceModeRow}>
          {referenceTravelModes.map(travelModeItem => {
            const selected = travelModeItem === 'TRANSIT';
            const label =
              travelModeItem === 'TRANSIT'
                ? selectedAlternative
                  ? formatRouteInfoDuration(
                      selectedRouteInfo?.totalDurationMinutes ??
                        selectedAlternative.minutes,
                    )
                  : '대중교통'
                : TRAVEL_MODE_META[travelModeItem].label;
            return (
              <Pressable
                key={`reference-mode-${travelModeItem}`}
                onPress={() => setTravelMode(travelModeItem)}
                accessibilityRole="radio"
                accessibilityLabel={`${TRAVEL_MODE_META[travelModeItem].label} 이동수단`}
                accessibilityState={{ selected }}
                style={[
                  styles.transitReferenceModeButton,
                  selected ? styles.transitReferenceModeButtonSelected : null,
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.transitReferenceModeText,
                    selected ? styles.transitReferenceModeTextSelected : null,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.transitReferenceFilterRow}>
          {TRANSIT_FILTER_ITEMS.map(item => {
            const selected = transitRouteFilter === item.key;
            const count =
              item.key === 'ALL' ? undefined : transitFilterCounts[item.key];
            const label =
              typeof count === 'number' ? `${item.label} ${count}` : item.label;
            return (
              <Pressable
                key={`reference-filter-${item.key}`}
                onPress={() => setTransitRouteFilter(item.key)}
                accessibilityRole="tab"
                accessibilityLabel={`${label} 경로 필터`}
                accessibilityState={{ selected }}
                style={styles.transitReferenceFilterTab}
              >
                <Text
                  style={[
                    styles.transitReferenceFilterText,
                    selected ? styles.transitReferenceFilterTextSelected : null,
                  ]}
                >
                  {label}
                </Text>
                {selected && (
                  <View style={styles.transitReferenceFilterUnderline} />
                )}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.transitReferenceControlRow}>
          <Text style={styles.transitReferenceDepartureText}>
            <Text style={styles.transitReferenceDepartureBlue}>
              {departureTimeText}
            </Text>
            {' 출발 기준'}
          </Text>
          <Text style={styles.transitReferenceSortText}>추천 경로순</Text>
        </View>

        <View style={styles.transitReferenceDetailPanel}>
          {etaLoading ? (
            <View style={styles.transitReferenceLoadingRow}>
              <BrandedLoader
                size="button"
                variant="route"
                accessibilityLabel="경로 옵션을 계산하고 있어요"
              />
              <Text style={styles.transitReferenceLoadingText}>
                경로 옵션 계산 중...
              </Text>
            </View>
          ) : null}

          {!etaLoading && !!alternativesError ? (
            <Text style={styles.transitReferenceStateText}>
              {alternativesError}
            </Text>
          ) : null}

          {!etaLoading && !alternativesError && !selectedAlternative ? (
            <Text style={styles.transitReferenceStateText}>
              표시할 대중교통 경로가 없습니다.
            </Text>
          ) : null}

          {!etaLoading && !alternativesError && !!selectedAlternative && (
            <>
              <View style={styles.transitReferenceSummaryHeader}>
                <View style={styles.transitReferenceSummaryMain}>
                  <Text style={styles.transitReferenceOptimalText}>최적</Text>
                  <Text style={styles.transitReferenceDurationText}>
                    {formatRouteInfoDuration(
                      selectedRouteInfo?.totalDurationMinutes ??
                        selectedAlternative.minutes,
                    )}
                  </Text>
                  {!!selectedTransitTimeRange && (
                    <Text style={styles.transitReferenceRouteMetaText}>
                      {selectedTransitTimeRange}
                    </Text>
                  )}
                </View>
                <View style={styles.transitReferenceFeedbackButton}>
                  <Text style={styles.transitReferenceFeedbackText}>
                    의견 남기기
                  </Text>
                </View>
              </View>

              <Text style={styles.transitReferenceRouteSummaryText}>
                {selectedAlternative.transitModeSummary ??
                  '선택한 대중교통 경로'}
              </Text>

              {selectedTransitProgressSegments.length > 0 && (
                <View style={styles.transitReferenceProgressTrack}>
                  {selectedTransitProgressSegments.map((segment, index) => (
                    <View
                      key={`reference-${segment.key}`}
                      style={[
                        styles.transitReferenceProgressSegment,
                        {
                          flex: segment.flex,
                          backgroundColor: segment.color,
                          marginLeft: index === 0 ? 0 : 3,
                        },
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        style={styles.transitReferenceProgressText}
                      >
                        {segment.label}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {transitLegs.length > 0 && (
                <View style={styles.transitReferenceFullTimeline}>
                  {transitLegs.map((leg, legIndex) => {
                    const kindMeta = getTransitLegKindMeta(leg.kind);
                    const legMetaText = buildTransitLegMeta(leg);
                    const timelineTitle = buildTransitTimelineTitle(leg);
                    const assistText = buildTransitLegAssistText(
                      transitLegs,
                      legIndex,
                    );
                    const isFocusedLeg = focusedTransitLegIndex === legIndex;
                    const isLastLeg = legIndex === transitLegs.length - 1;
                    return (
                      <Pressable
                        key={`${selectedAlternative.id}-reference-timeline-${legIndex}`}
                        onPress={() => focusMapOnTransitLeg(legIndex)}
                        accessibilityRole="button"
                        accessibilityLabel={[
                          timelineTitle,
                          legMetaText,
                          assistText,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                        accessibilityHint="지도에서 이 이동 구간을 확대합니다"
                        accessibilityState={{ selected: isFocusedLeg }}
                        style={[
                          styles.transitReferenceTimelineItem,
                          isFocusedLeg
                            ? styles.transitReferenceTimelineItemFocused
                            : null,
                        ]}
                      >
                        <View style={styles.transitReferenceTimelineRail}>
                          <View
                            style={[
                              styles.transitReferenceTimelineDot,
                              { backgroundColor: kindMeta.color },
                            ]}
                          >
                            <Text
                              style={styles.transitReferenceTimelineDotText}
                            >
                              {kindMeta.short}
                            </Text>
                          </View>
                          {!isLastLeg && (
                            <View style={styles.transitReferenceTimelineLine} />
                          )}
                        </View>
                        <View style={styles.transitReferenceTimelineContent}>
                          <View style={styles.transitReferenceTimelineTopRow}>
                            <Text
                              numberOfLines={2}
                              style={styles.transitReferenceTimelineTitle}
                            >
                              {timelineTitle}
                            </Text>
                            {!!legMetaText && (
                              <Text
                                numberOfLines={1}
                                style={styles.transitReferenceTimelineMeta}
                              >
                                {legMetaText}
                              </Text>
                            )}
                          </View>
                          {!!assistText && (
                            <Text
                              numberOfLines={2}
                              style={styles.transitReferenceTimelineAssist}
                            >
                              {assistText}
                            </Text>
                          )}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              <Pressable
                onPress={submit}
                accessibilityRole="button"
                accessibilityLabel="선택한 경로 저장"
                accessibilityState={{
                  disabled: !canSubmitRoute,
                  busy: etaLoading || routeSubmitPending,
                }}
                disabled={!canSubmitRoute}
                style={styles.transitReferenceSaveButton}
              >
                <Text style={styles.transitReferenceSaveText}>▣ 경로 저장</Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
