import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons as ExpoIonicons } from '@expo/vector-icons';
import BrandedLoader from '../../../ui/BrandedLoader';
import styles from './styles';
import { formatDistance, getTransitLegKindMeta } from './presentation';
import CalendarGlassSurface from '../components/calendar/CalendarGlassSurface';
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

/** 선택한 경로의 요약 헤더와 구간 상세 오버레이를 렌더링합니다. */
export function RoutePlannerMapHeader({ controller }: Props) {
  const {
    insets,
    colors,
    overlayBoxBg,
    overlayPanelBg,
    originUsesDefault,
    activeTarget,
    searchQuery,
    searching,
    searchResults,
    searchError,
    completedSearchQuery,
    isTransitMode,
    hasOriginCoords,
    hasRouteReady,
    isRouteDetailMode,
    shouldRenderTransitDetailDark,
    transitRouteChipBg,
    transitRouteChipText,
    isRoutePointLocked,
    hasActiveTarget,
    originDisplay,
    destinationDisplay,
    transitLegendKinds,
    shouldShowTransitLegend,
    shouldShowTransitLegendHint,
    selectedDetailHeaderIcon,
    selectedDetailHeaderTitle,
    nextHeaderAlternativeIndex,
    nextHeaderIcon,
    nextHeaderColor,
    nextHeaderLabel,
    selectAlternativeByIndex,
    saveCurrentOriginAsFavorite,
    applyPlace,
    onPressOriginTarget,
    onPressDestinationTarget,
    clearPlaceSearch,
    handleSearchChange,
    openRoutePointEditorFromHeader,
    goToScheduleList,
    goBack,
    openTransitDeparturePicker,
  } = controller;
  return (
    <>
      {isRouteDetailMode ? (
        <View
          style={[
            styles.transitMapRouteHeader,
            { paddingTop: Math.max(insets.top - 2, 8) },
          ]}
        >
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="뒤로가기"
            style={[
              styles.transitMapHeaderIconButton,
              { backgroundColor: transitRouteChipBg },
            ]}
          >
            <Ionicons
              name="chevron-back"
              size={24}
              color={shouldRenderTransitDetailDark ? '#FFFFFF' : '#111827'}
            />
          </Pressable>
          <Pressable
            onPress={() => openRoutePointEditorFromHeader('origin')}
            accessibilityRole="button"
            accessibilityLabel="출발지와 도착지 수정"
            style={styles.transitMapRouteSummaryPill}
          >
            <Ionicons
              name={selectedDetailHeaderIcon}
              size={16}
              color="#111317"
            />
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.76}
              style={styles.transitMapRouteSummaryText}
            >
              {selectedDetailHeaderTitle}
            </Text>
          </Pressable>
          {typeof nextHeaderAlternativeIndex === 'number' &&
            !!nextHeaderLabel && (
              <Pressable
                onPress={() =>
                  selectAlternativeByIndex(nextHeaderAlternativeIndex, false)
                }
                accessibilityRole="button"
                accessibilityLabel={`다음 경로 ${nextHeaderLabel}`}
                style={[
                  styles.transitMapRouteNextChip,
                  { backgroundColor: transitRouteChipBg },
                ]}
              >
                <Ionicons
                  name={nextHeaderIcon}
                  size={15}
                  color={nextHeaderColor}
                />
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.68}
                  style={[
                    styles.transitMapRouteNextText,
                    {
                      color: shouldRenderTransitDetailDark
                        ? '#FFFFFF'
                        : transitRouteChipText,
                    },
                  ]}
                >
                  {nextHeaderLabel}
                </Text>
              </Pressable>
            )}
          <Pressable
            onPress={
              isTransitMode ? openTransitDeparturePicker : goToScheduleList
            }
            accessibilityRole="button"
            accessibilityLabel={
              isTransitMode ? '출발 시각 선택' : '일정 목록으로 이동'
            }
            style={[
              styles.transitMapScheduleButton,
              { backgroundColor: transitRouteChipBg },
            ]}
          >
            <Ionicons
              name="calendar-outline"
              size={19}
              color={shouldRenderTransitDetailDark ? '#FFFFFF' : '#111827'}
            />
          </Pressable>
        </View>
      ) : (
        <View style={[styles.topOverlay, { paddingTop: insets.top + 4 }]}>
          <View style={styles.searchOverlayRow}>
            <Pressable
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel="뒤로가기"
              style={[
                styles.inlineCloseBtn,
                styles.overlaySurface,
                { borderColor: colors.border, backgroundColor: overlayBoxBg },
              ]}
            >
              <Text
                style={[
                  styles.inlineCloseBtnText,
                  { color: colors.textPrimary },
                ]}
              >
                ‹
              </Text>
            </Pressable>

            <Pressable
              onPress={() => openRoutePointEditorFromHeader('origin')}
              disabled={!isRoutePointLocked}
              accessible={isRoutePointLocked}
              accessibilityRole="button"
              accessibilityLabel="출발지와 도착지 수정"
              style={[
                styles.searchInputWrap,
                styles.searchField,
                styles.overlaySurface,
                {
                  borderColor: searching
                    ? colors.inputBorderFocused
                    : colors.inputBorder,
                  backgroundColor: overlayBoxBg,
                },
              ]}
            >
              <TextInput
                accessible={!isRoutePointLocked}
                value={searchQuery}
                onChangeText={handleSearchChange}
                accessibilityLabel={
                  !hasActiveTarget
                    ? '출발지 또는 도착지 검색'
                    : activeTarget === 'destination'
                    ? '도착지 검색'
                    : '출발지 검색'
                }
                accessibilityHint="장소 이름이나 주소를 입력하세요"
                placeholder={
                  isRoutePointLocked
                    ? '출/도 탭을 눌러 위치 수정'
                    : !hasActiveTarget
                    ? '출/도 탭을 선택해 주세요'
                    : activeTarget === 'origin'
                    ? '출발지 검색'
                    : '도착지 검색'
                }
                placeholderTextColor={colors.inputPlaceholder}
                returnKeyType="search"
                editable={!isRoutePointLocked && hasActiveTarget}
                textContentType="none"
                autoComplete="off"
                secureTextEntry={false}
                style={[styles.searchInput, { color: colors.textPrimary }]}
              />
              {searching ? (
                <BrandedLoader
                  size="button"
                  variant="route"
                  accessibilityLabel="장소를 검색하고 있어요"
                  style={styles.searchIcon}
                />
              ) : searchQuery.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="장소 검색어 지우기"
                  onPress={clearPlaceSearch}
                  style={styles.searchIcon}
                >
                  <Text style={{ color: colors.textDisabled, fontSize: 16 }}>
                    ✕
                  </Text>
                </Pressable>
              ) : null}
            </Pressable>

            <View
              style={[
                styles.targetCompactWrap,
                styles.overlaySurface,
                { borderColor: colors.border, backgroundColor: overlayBoxBg },
              ]}
            >
              <Pressable
                onPress={onPressOriginTarget}
                accessibilityRole="button"
                accessibilityLabel="출발지 선택"
                accessibilityState={{ selected: activeTarget === 'origin' }}
                style={[
                  styles.targetCompactBtn,
                  activeTarget === 'origin'
                    ? styles.targetCompactBtnActiveOrigin
                    : null,
                ]}
              >
                <Text
                  style={[
                    styles.targetCompactText,
                    activeTarget === 'origin'
                      ? styles.targetCompactTextActive
                      : { color: colors.textPrimary },
                  ]}
                >
                  출
                </Text>
              </Pressable>
              <Pressable
                onPress={onPressDestinationTarget}
                accessibilityRole="button"
                accessibilityLabel="도착지 선택"
                accessibilityState={{
                  selected: activeTarget === 'destination',
                }}
                style={[
                  styles.targetCompactBtn,
                  activeTarget === 'destination'
                    ? styles.targetCompactBtnActiveDestination
                    : null,
                ]}
              >
                <Text
                  style={[
                    styles.targetCompactText,
                    activeTarget === 'destination'
                      ? styles.targetCompactTextActive
                      : { color: colors.textPrimary },
                  ]}
                >
                  도
                </Text>
              </Pressable>
            </View>
            <Pressable
              onPress={
                isTransitMode && hasRouteReady
                  ? openTransitDeparturePicker
                  : goToScheduleList
              }
              accessibilityRole="button"
              accessibilityLabel={
                isTransitMode && hasRouteReady
                  ? '출발 시각 선택'
                  : '일정 목록으로 이동'
              }
              style={[
                styles.plannerScheduleButton,
                styles.overlaySurface,
                { borderColor: colors.border, backgroundColor: overlayBoxBg },
              ]}
            >
              <Ionicons
                name="calendar-outline"
                size={19}
                color={colors.textPrimary}
              />
            </Pressable>
          </View>

          {!isRoutePointLocked &&
            hasActiveTarget &&
            !!searchQuery.trim() &&
            !searching &&
            completedSearchQuery === searchQuery.trim() &&
            (searchError || searchResults.length === 0) && (
              <CalendarGlassSurface
                prominent
                variant="mapCard"
                style={[
                  styles.searchResultWrap,
                  styles.overlaySurface,
                  { borderColor: colors.border },
                ]}
              >
                <View
                  style={styles.searchStateRow}
                  accessibilityLiveRegion="polite"
                >
                  <Text
                    style={[
                      styles.searchStateText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {searchError
                      ? '장소 검색에 실패했습니다. 네트워크 연결을 확인해 주세요.'
                      : '검색 결과가 없습니다. 다른 장소명이나 주소로 검색해 보세요.'}
                  </Text>
                  {!!searchError && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="장소 다시 검색"
                      onPress={() => handleSearchChange(searchQuery)}
                      style={[
                        styles.searchStateRetryButton,
                        { backgroundColor: colors.selectedDayBg },
                      ]}
                    >
                      <Text
                        style={[
                          styles.searchStateRetryText,
                          { color: colors.selectedDayText },
                        ]}
                      >
                        다시 검색
                      </Text>
                    </Pressable>
                  )}
                </View>
              </CalendarGlassSurface>
            )}

          {!!searchResults.length && !isRoutePointLocked && hasActiveTarget && (
            <CalendarGlassSurface
              prominent
              variant="mapCard"
              style={[
                styles.searchResultWrap,
                styles.overlaySurface,
                { borderColor: colors.border },
              ]}
            >
              {searchResults.slice(0, 6).map((item, index) => (
                <Pressable
                  key={`${item.lat}:${item.lng}:${index}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${
                    item.address || '주소 정보 없음'
                  }`}
                  onPress={() => {
                    if (
                      activeTarget !== 'origin' &&
                      activeTarget !== 'destination'
                    )
                      return;
                    applyPlace(activeTarget, item);
                  }}
                  style={[
                    styles.searchResultItem,
                    {
                      borderTopColor: colors.border,
                      borderTopWidth:
                        index === 0 ? 0 : StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      color: colors.textPrimary,
                      fontWeight: '700',
                      fontSize: 14,
                    }}
                  >
                    {item.name}
                  </Text>
                  {!!(
                    item.category || typeof item.distanceMeters === 'number'
                  ) && (
                    <Text
                      numberOfLines={1}
                      style={{ color: '#1B9B50', fontSize: 11, marginTop: 1 }}
                    >
                      {[
                        item.category,
                        typeof item.distanceMeters === 'number'
                          ? `기준점에서 ${formatDistance(item.distanceMeters)}`
                          : undefined,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  )}
                  <Text
                    numberOfLines={1}
                    style={{
                      color: colors.textSecondary,
                      fontSize: 12,
                      marginTop: 1,
                    }}
                  >
                    {item.address}
                  </Text>
                </Pressable>
              ))}
            </CalendarGlassSurface>
          )}

          <CalendarGlassSurface
            variant="mapCard"
            style={[
              styles.routePreviewCard,
              styles.overlaySurface,
              { borderColor: colors.border },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[styles.routePreviewMain, { color: colors.textPrimary }]}
            >
              {originDisplay} → {destinationDisplay}
            </Text>
            {!hasRouteReady && (
              <Text
                style={[
                  styles.routePreviewSub,
                  { color: colors.textSecondary },
                ]}
              >
                출/도 탭을 선택한 뒤 지도 탭으로 위치를 지정하세요.
              </Text>
            )}
            {hasOriginCoords && (
              <View style={styles.routePreviewActionRow}>
                <Pressable
                  onPress={saveCurrentOriginAsFavorite}
                  accessibilityRole="button"
                  accessibilityLabel={
                    originUsesDefault
                      ? `${originDisplay}, 기본 출발지로 설정됨`
                      : `${originDisplay}, 기본 출발지로 설정`
                  }
                  accessibilityState={{ selected: originUsesDefault }}
                  style={[
                    styles.routePreviewActionBtn,
                    { backgroundColor: overlayPanelBg },
                  ]}
                >
                  <Text
                    style={[
                      styles.routePreviewActionText,
                      { color: colors.textPrimary },
                    ]}
                  >
                    {originUsesDefault ? '기본 출발지' : '기본 출발지로 설정'}
                  </Text>
                </Pressable>
              </View>
            )}

            {(shouldShowTransitLegend || shouldShowTransitLegendHint) && (
              <View style={styles.transitLegendInlineRow}>
                {transitLegendKinds.map(kind => {
                  const kindMeta = getTransitLegKindMeta(kind);
                  return (
                    <View
                      key={`legend-${kind}`}
                      style={[
                        styles.transitLegendInlineChip,
                        {
                          borderColor: colors.border,
                          backgroundColor: overlayPanelBg,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.transitLegendSwatch,
                          { backgroundColor: kindMeta.color },
                        ]}
                      />
                      <Text
                        style={[
                          styles.transitLegendText,
                          { color: colors.textPrimary },
                        ]}
                      >
                        {kindMeta.label}
                      </Text>
                    </View>
                  );
                })}

                {shouldShowTransitLegendHint && !transitLegendKinds.length && (
                  <Text
                    style={[
                      styles.transitLegendHintText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    확대 시 구간 라벨 표시
                  </Text>
                )}
              </View>
            )}
          </CalendarGlassSurface>
        </View>
      )}
    </>
  );
}
