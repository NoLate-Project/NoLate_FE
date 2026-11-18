import React, { useLayoutEffect, useRef } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons as ExpoIonicons } from '@expo/vector-icons';
import BrandedLoader from '../../../ui/BrandedLoader';
import styles from './styles';
import { formatDistance, getMapRouteChoiceLabels, getTransitLegKindMeta } from './presentation';
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
  const { fontScale } = useWindowDimensions();
  const largeRouteText = fontScale > 1.35;
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
    transitDetailPrimaryActionBg,
    transitDetailPrimaryActionText,
    isRoutePointLocked,
    hasActiveTarget,
    originDisplay,
    destinationDisplay,
    transitLegendKinds,
    shouldShowTransitLegend,
    shouldShowTransitLegendHint,
    nextHeaderAlternativeIndex,
    nextHeaderIcon,
    nextHeaderColor,
    nextHeaderLabel,
    visibleAlternatives,
    selectedAlternativeId,
    etaLoading,
    reduceMotion,
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
    backLabel,
    openTransitDeparturePicker,
  } = controller;
  const endpoints = `${originDisplay} → ${destinationDisplay}`;
  const showsRouteChoices = isTransitMode && (visibleAlternatives?.length ?? 0) > 1 && !etaLoading;
  const choiceLabels = showsRouteChoices ? getMapRouteChoiceLabels(visibleAlternatives, {
    compareLinesAcrossDurations: !largeRouteText,
  }) : [];
  const twoInlineChoices = showsRouteChoices && visibleAlternatives.length === 2 && !largeRouteText;
  const choiceAccent = shouldRenderTransitDetailDark ? '#A4CAFA' : transitDetailPrimaryActionBg;
  const choiceAccentText = shouldRenderTransitDetailDark ? '#10243B' : transitDetailPrimaryActionText;
  const activeChoiceId = showsRouteChoices ? selectedAlternativeId : undefined;
  const previousChoiceId = useRef(activeChoiceId);
  const choiceProgress = useRef(new Animated.Value(1)).current;
  useLayoutEffect(() => {
    const previous = previousChoiceId.current;
    previousChoiceId.current = activeChoiceId;
    if (reduceMotion || !previous || !activeChoiceId || previous === activeChoiceId) {
      choiceProgress.setValue(1);
      return;
    }
    choiceProgress.setValue(0);
    const settle = Animated.timing(choiceProgress, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    settle.start();
    return () => settle.stop();
  }, [activeChoiceId, choiceProgress, reduceMotion]);
  const nextRouteAction = !isTransitMode && typeof nextHeaderAlternativeIndex === 'number' && !!nextHeaderLabel && (
    <Pressable
      onPress={() => selectAlternativeByIndex(nextHeaderAlternativeIndex, false)}
      accessibilityRole="button"
      accessibilityLabel={`다음 경로 ${nextHeaderLabel}`}
      style={[
        styles.transitMapRouteNextChip,
        largeRouteText && styles.transitMapRouteNextExpanded,
        { backgroundColor: largeRouteText ? colors.surface : transitRouteChipBg },
      ]}
    >
      <Ionicons name={nextHeaderIcon} size={15} color={nextHeaderColor} />
      <Text
        numberOfLines={largeRouteText ? undefined : 1}
        adjustsFontSizeToFit={!largeRouteText}
        minimumFontScale={0.68}
        lineBreakStrategyIOS="hangul-word"
        style={[
          styles.transitMapRouteNextText,
          { color: shouldRenderTransitDetailDark ? '#FFFFFF' : transitRouteChipText },
        ]}
      >
        {nextHeaderLabel}
      </Text>
    </Pressable>
  );
  const choiceButtons = showsRouteChoices ? visibleAlternatives.map((option, index) => {
    const selected = option.id === selectedAlternativeId;
    const label = choiceLabels[index];
    return (
      <Pressable
        key={option.id}
        testID={`route-planner-map-choice-${option.id}`}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        onPress={() => { if (!selected) selectAlternativeByIndex(index); }}
        style={({ pressed }) => [
          styles.transitMapChoice,
          twoInlineChoices && styles.transitMapChoiceInline,
          {
            backgroundColor: transitRouteChipBg,
            opacity: pressed ? 0.76 : 1,
          },
        ]}
      >
        {selected && (
          <Animated.View
            testID="route-planner-map-choice-highlight"
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFillObject,
              styles.transitMapChoiceHighlight,
              {
                backgroundColor: choiceAccent,
                opacity: reduceMotion ? 1 : choiceProgress.interpolate({
                  inputRange: [0, 1], outputRange: [0.88, 1],
                }),
                transform: [{ scale: reduceMotion ? 1 : choiceProgress.interpolate({
                  inputRange: [0, 1], outputRange: [0.96, 1],
                }) }],
              },
            ]}
          />
        )}
        <Text
          lineBreakStrategyIOS="hangul-word"
          style={[styles.transitMapChoiceText, { color: selected ? choiceAccentText : transitRouteChipText }]}
        >
          {label}
        </Text>
      </Pressable>
    );
  }) : null;
  const EditControls = showsRouteChoices ? View : React.Fragment;
  const choices = showsRouteChoices && (
    twoInlineChoices || largeRouteText ? (
      <View
        testID="route-planner-map-choices"
        style={twoInlineChoices ? styles.transitMapChoicesInline : styles.transitMapChoicesWrapped}
      >
        {choiceButtons}
      </View>
    ) : (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        testID="route-planner-map-choices"
        style={styles.transitMapChoices}
        contentContainerStyle={styles.transitMapChoicesRow}
      >
        {choiceButtons}
      </ScrollView>
    )
  );
  return (
    <>
      {isRouteDetailMode ? (
        <View
          style={[
            styles.transitMapRouteHeader,
            showsRouteChoices && styles.transitMapRouteHeaderWithChoices,
            largeRouteText && styles.transitMapRouteHeaderExpanded,
            { paddingTop: Math.max(insets.top - 2, 8) },
          ]}
        >
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel={backLabel}
            hitSlop={2}
            style={[
              styles.transitMapHeaderIconButton,
              largeRouteText && styles.transitMapRouteExpandedIcon,
              { backgroundColor: largeRouteText ? colors.surface : transitRouteChipBg },
            ]}
          >
            <Ionicons
              name="chevron-back-outline"
              size={24}
              color={shouldRenderTransitDetailDark ? '#FFFFFF' : '#111827'}
            />
          </Pressable>
          {!largeRouteText && choices}
          <EditControls {...(showsRouteChoices ? { style: largeRouteText ? styles.transitMapRouteEditRowLarge : styles.transitMapRouteEditRow } : {})}>
            <Pressable
              onPress={() => openRoutePointEditorFromHeader('origin')}
              accessibilityRole="button"
              accessibilityLabel="출발지와 도착지 수정"
              accessibilityValue={{ text: endpoints }}
              style={({ pressed }) => [
                styles.transitMapRouteSummaryPill,
                showsRouteChoices && { backgroundColor: overlayBoxBg },
                largeRouteText && styles.transitMapRouteSummaryExpanded,
                pressed && styles.transitMapRouteSummaryPressed,
              ]}
            >
              <View style={styles.transitMapRouteSummaryIcon}>
                <Ionicons
                  name="pencil-outline"
                  size={14}
                  color="#FFFFFF"
                />
              </View>
              <Text
                numberOfLines={largeRouteText ? undefined : 1}
                maxFontSizeMultiplier={2}
                lineBreakStrategyIOS="hangul-word"
                style={[styles.transitMapRouteSummaryText, showsRouteChoices && { color: colors.textPrimary }]}
              >
                {endpoints}
              </Text>
            </Pressable>
            {!largeRouteText && nextRouteAction}
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
                largeRouteText && styles.transitMapRouteExpandedIcon,
                { backgroundColor: largeRouteText ? colors.surface : transitRouteChipBg },
              ]}
            >
              <Ionicons
                name="calendar-outline"
                size={19}
                color={shouldRenderTransitDetailDark ? '#FFFFFF' : '#111827'}
              />
            </Pressable>
          </EditControls>
          {largeRouteText && choices}
          {largeRouteText && nextRouteAction}
        </View>
      ) : (
        <View style={[styles.topOverlay, { paddingTop: insets.top + 4 }]}>
          <View style={styles.searchOverlayRow}>
            <Pressable
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel={backLabel}
              style={[
                styles.inlineCloseBtn,
                styles.overlaySurface,
                { borderColor: colors.border, backgroundColor: overlayBoxBg },
              ]}
            >
              <Ionicons name="chevron-back-outline" size={24} color={colors.textPrimary} />
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
                  <Ionicons accessible={false} name="close-outline" size={18} color={colors.textSecondary} />
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
              <View
                style={[
                  styles.searchResultWrap,
                  styles.overlaySurface,
                  { backgroundColor: overlayPanelBg, borderColor: colors.border },
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
              </View>
            )}

          {!!searchResults.length && !isRoutePointLocked && hasActiveTarget && (
            <View
              style={[
                styles.searchResultWrap,
                styles.overlaySurface,
                { backgroundColor: overlayPanelBg, borderColor: colors.border },
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
                      style={{ color: colors.textSecondary, fontSize: 11, marginTop: 1 }}
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
            </View>
          )}

          <View
            style={[
              styles.routePreviewCard,
              styles.overlaySurface,
              { backgroundColor: overlayPanelBg, borderColor: colors.border },
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
          </View>
        </View>
      )}
    </>
  );
}
