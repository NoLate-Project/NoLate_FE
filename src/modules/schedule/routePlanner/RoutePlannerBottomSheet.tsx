import React from 'react';
import { Animated, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons as ExpoIonicons } from '@expo/vector-icons';
import { shouldShowRequiredMapAttribution } from '../../map/routingService';
import styles from './styles';
import CalendarGlassSurface from '../components/calendar/CalendarGlassSurface';
import type { RoutePlannerController } from './useRoutePlannerController';
import { RoutePlannerAlternativeSection } from './RoutePlannerAlternativeSection';

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

/** 경로 후보와 상세 타임라인을 담은 하단 시트를 렌더링합니다. */
export function RoutePlannerBottomSheet({ controller }: Props) {
  const {
    colors,
    mode,
    isDark,
    overlayBoxBg,
    etaLoading,
    routeSubmitPending,
    setBottomPanelHeight,
    setTransitActionBarHeight,
    setHasBottomSheetMeasured,
    bottomSheetSnap,
    setBottomSheetSnap,
    setIsBottomSheetCollapsed,
    isBottomSheetHidden,
    setSelectedTransitMapStop,
    setFocusedTransitLegIndex,
    setFocusedRouteStepId,
    bottomSheetTranslateY,
    hasRouteReady,
    isRouteDetailMode,
    detailPanelBg,
    detailSecondaryText,
    detailBorderColor,
    transitActionBarBg,
    transitDetailPrimaryActionBg,
    transitDetailPrimaryActionText,
    transitDetailControlText,
    isRouteSelectionStage,
    transitDetailActionBarPaddingBottom,
    bottomPanelMaxHeight,
    canScrollBottomSheetContent,
    bottomPanelScrollViewportHeight,
    bottomPanelScrollBottomPadding,
    selectedAlternative,
    canSubmitRoute,
    openSelectedRouteAttribution,
    selectedAlternativeQualityNotice,
    selectedCollapsedRouteSummary,
    selectedTransitHeaderDuration,
    bottomHandlePanResponder,
    submit,
  } = controller;
  return (
    <>
      {!isRouteSelectionStage && (
        <View
          style={[styles.bottomOverlay]}
          pointerEvents={isBottomSheetHidden ? 'none' : 'box-none'}
        >
          <Animated.View
            pointerEvents={isBottomSheetHidden ? 'none' : 'auto'}
            onLayout={event => {
              const measured = Math.round(event.nativeEvent.layout.height);
              setHasBottomSheetMeasured(true);
              setBottomPanelHeight(prev =>
                prev === measured ? prev : measured,
              );
            }}
            style={[
              styles.bottomPanelMotion,
              {
                height: isRouteDetailMode ? bottomPanelMaxHeight : undefined,
                maxHeight: bottomPanelMaxHeight,
                opacity: isBottomSheetHidden ? 0 : 1,
                transform: [{ translateY: bottomSheetTranslateY }],
              },
            ]}
          >
            <CalendarGlassSurface
              prominent
              variant="mapCard"
              tone={isRouteDetailMode ? 'solidCard' : 'default'}
              forceColorScheme={isRouteDetailMode ? mode : undefined}
              style={[
                styles.bottomPanel,
                isRouteDetailMode ? styles.bottomPanelDetail : null,
                {
                  borderColor: isRouteDetailMode
                    ? 'transparent'
                    : colors.border,
                  backgroundColor: isRouteDetailMode
                    ? detailPanelBg
                    : undefined,
                },
              ]}
            >
              <View
                style={[
                  styles.bottomHandleTouchArea,
                  isRouteDetailMode ? styles.bottomHandleTouchAreaDetail : null,
                ]}
                {...bottomHandlePanResponder.panHandlers}
              >
                <View
                  style={[
                    styles.bottomHandle,
                    isRouteDetailMode ? styles.bottomHandleDetail : null,
                    {
                      backgroundColor: isRouteDetailMode
                        ? detailBorderColor
                        : colors.border,
                      opacity: 0.75,
                    },
                  ]}
                />
              </View>
              <ScrollView
                style={[
                  styles.bottomPanelScroll,
                  typeof bottomPanelScrollViewportHeight === 'number'
                    ? {
                        maxHeight: bottomPanelScrollViewportHeight,
                        height: isRouteDetailMode
                          ? bottomPanelScrollViewportHeight
                          : undefined,
                      }
                    : null,
                ]}
                contentContainerStyle={[
                  styles.bottomPanelScrollContent,
                  isRouteDetailMode
                    ? styles.bottomPanelScrollContentDetail
                    : null,
                  { paddingBottom: bottomPanelScrollBottomPadding },
                ]}
                keyboardShouldPersistTaps="handled"
                scrollEnabled={canScrollBottomSheetContent}
                nestedScrollEnabled
                bounces={false}
                alwaysBounceVertical={false}
                showsVerticalScrollIndicator={false}
              >
                {!hasRouteReady ? (
                  <View
                    style={[
                      styles.routeHintCard,
                      {
                        borderColor: colors.border,
                        backgroundColor: overlayBoxBg,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.routeHintText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      출발지와 도착지를 모두 선택하면 경로 정보가 표시됩니다.
                    </Text>
                  </View>
                ) : (
                  <>
                    {!!selectedAlternativeQualityNotice && !etaLoading && (
                      <View
                        style={[
                          styles.routeQualityWarning,
                          {
                            backgroundColor: isDark
                              ? 'rgba(120,53,15,0.30)'
                              : '#FFF7E6',
                            borderColor: isDark
                              ? 'rgba(251,191,36,0.42)'
                              : '#F4C76A',
                          },
                        ]}
                      >
                        <Ionicons
                          name="alert-circle-outline"
                          size={17}
                          color={isDark ? '#FCD34D' : '#A15C00'}
                        />
                        <Text
                          style={[
                            styles.routeQualityWarningText,
                            { color: isDark ? '#FDE68A' : '#7A4500' },
                          ]}
                        >
                          {selectedAlternativeQualityNotice}
                        </Text>
                      </View>
                    )}
                    {shouldShowRequiredMapAttribution(selectedAlternative) &&
                      !!selectedAlternative?.attributionText &&
                      !!selectedAlternative.attributionUrl &&
                      !etaLoading && (
                        <Pressable
                          accessibilityRole="link"
                          accessibilityLabel={`${selectedAlternative.attributionText} 지도 정보 열기`}
                          onPress={openSelectedRouteAttribution}
                          style={styles.routeAttributionLink}
                        >
                          <Text
                            style={[
                              styles.routeAttributionText,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {selectedAlternative.attributionText} · 지도 수정
                          </Text>
                          <Ionicons
                            name="open-outline"
                            size={13}
                            color={colors.textSecondary}
                          />
                        </Pressable>
                      )}

                    <RoutePlannerAlternativeSection controller={controller} />

                    {!isRouteDetailMode && (
                      <Pressable
                        onPress={submit}
                        accessibilityRole="button"
                        accessibilityLabel="선택한 경로 저장"
                        style={[
                          styles.confirmBtn,
                          { backgroundColor: colors.selectedDayBg },
                        ]}
                      >
                        <Text
                          style={[
                            styles.confirmText,
                            { color: colors.selectedDayText },
                          ]}
                        >
                          경로 저장
                        </Text>
                      </Pressable>
                    )}
                  </>
                )}
              </ScrollView>
            </CalendarGlassSurface>
          </Animated.View>
          {isRouteDetailMode &&
            !!selectedAlternative &&
            !isBottomSheetHidden && (
              <View
                onLayout={event => {
                  const measured = Math.round(event.nativeEvent.layout.height);
                  setTransitActionBarHeight(prev =>
                    prev === measured ? prev : measured,
                  );
                }}
                style={[
                  styles.transitDetailActionBar,
                  {
                    backgroundColor: transitActionBarBg,
                    borderTopColor: detailBorderColor,
                    paddingBottom: transitDetailActionBarPaddingBottom,
                  },
                ]}
              >
                {bottomSheetSnap === 'collapsed' &&
                  selectedCollapsedRouteSummary && (
                    <View
                      style={[
                        styles.transitCollapsedSummaryRow,
                        { borderBottomColor: detailBorderColor },
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.82}
                        style={[
                          styles.transitCollapsedArrivalText,
                          { color: transitDetailControlText },
                        ]}
                      >
                        {selectedCollapsedRouteSummary.arrivalText ??
                          selectedTransitHeaderDuration}
                      </Text>
                      {!!selectedCollapsedRouteSummary.metricsText && (
                        <Text
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.72}
                          style={[
                            styles.transitCollapsedMetricsText,
                            { color: detailSecondaryText },
                          ]}
                        >
                          {selectedCollapsedRouteSummary.metricsText}
                        </Text>
                      )}
                    </View>
                  )}
                <View style={styles.transitDetailActionButtonRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      bottomSheetSnap === 'collapsed'
                        ? '상세 경로 보기'
                        : '지도에서 전체 경로 보기'
                    }
                    onPress={() => {
                      if (bottomSheetSnap === 'collapsed') {
                        setBottomSheetSnap('middle');
                        setIsBottomSheetCollapsed(false);
                        return;
                      }
                      // 시트 상태가 바뀌면 시트 안전영역을 반영한 전체 경로 카메라가 다시 계산된다.
                      setSelectedTransitMapStop(undefined);
                      setFocusedTransitLegIndex(undefined);
                      setFocusedRouteStepId(undefined);
                      setBottomSheetSnap('collapsed');
                      setIsBottomSheetCollapsed(true);
                    }}
                    style={[
                      styles.transitDetailPreviewButton,
                      { borderColor: detailBorderColor },
                    ]}
                  >
                    <Ionicons
                      name={
                        bottomSheetSnap === 'collapsed'
                          ? 'list-outline'
                          : 'map-outline'
                      }
                      size={18}
                      color={transitDetailControlText}
                    />
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                      style={[
                        styles.transitDetailPreviewText,
                        { color: transitDetailControlText },
                      ]}
                    >
                      {bottomSheetSnap === 'collapsed'
                        ? '상세 경로'
                        : '지도 보기'}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="선택한 경로 저장"
                    accessibilityState={{
                      disabled: !canSubmitRoute,
                      busy: etaLoading || routeSubmitPending,
                    }}
                    onPress={submit}
                    disabled={!canSubmitRoute}
                    style={[
                      styles.transitDetailSaveButton,
                      { backgroundColor: transitDetailPrimaryActionBg },
                      !canSubmitRoute && styles.transitDetailSaveButtonDisabled,
                    ]}
                  >
                    <Ionicons
                      name="checkmark"
                      size={18}
                      color={transitDetailPrimaryActionText}
                    />
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                      style={[
                        styles.transitDetailSaveText,
                        { color: transitDetailPrimaryActionText },
                      ]}
                    >
                      경로 저장
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
        </View>
      )}
    </>
  );
}
