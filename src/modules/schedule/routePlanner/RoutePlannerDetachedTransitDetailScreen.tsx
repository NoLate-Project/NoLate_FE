import React from 'react';
import { Pressable, ScrollView, StatusBar, Text, View } from 'react-native';
import { Ionicons as ExpoIonicons } from '@expo/vector-icons';
import BrandedLoader from '../../../ui/BrandedLoader';
import TmapMapView from '../../map/TmapMapView';
import styles from './styles';
import { TRANSIT_DETAIL_ACTION_BAR_MIN_HEIGHT } from './bottomSheetLayout';
import { formatTransitClock } from './presentation';
import {
  FALLBACK_LAT,
  getMapRouteCasingColor,
  MAP_GUIDE_ROUTE_BLUE,
} from './routeMapTypesAndStyle';
import { isRideLegKind } from './routeTransitLegCoordinates';
import { getPrimaryTransitLineLabel } from './routePlannerRouteInfo';
import { formatRouteDuration as formatRouteInfoDuration } from '../routeInfo';
import RouteStepTimeline from '../components/route/RouteStepTimeline';
import TransitRouteProgressBar from '../components/route/TransitRouteProgressBar';
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

const FALLBACK_LNG = 126.978;

const INITIAL_CAMERA = {
  latitude: FALLBACK_LAT,
  longitude: FALLBACK_LNG,
  zoom: 12,
};

type Props = { controller: RoutePlannerController };

/** 컨트롤러가 계산한 상태와 명령을 사용해 대중교통 경로 상세 화면을 렌더링합니다. */
export function RoutePlannerDetachedTransitDetailScreen({ controller }: Props) {
  const {
    insets,
    windowHeight,
    colors,
    isDark,
    isRouteQaBaseOnly,
    qaMapBaseDimOpacity,
    travelMode,
    etaLoading,
    routeSubmitPending,
    setIsMapInitialized,
    mapZoom,
    selectedTransitMapStop,
    mapRef,
    isRouteDetailMode,
    shouldRenderTransitDetailDark,
    transitDetailActionBarPaddingBottom,
    selectedAlternative,
    canSubmitRoute,
    selectedRouteDepartureAt,
    selectedTransitMeta,
    selectedTransitTimeRange,
    selectedTransitProgressSegments,
    selectedRouteInfo,
    routeStrokeStyle,
    routeOverlayScopeKey,
    pathOverlayCoords,
    themedMapPathOverlays,
    mapMarkers,
    onTapMap,
    goBack,
    submit,
    onMapLayoutReport,
    onMapZoomChanged,
    onMapCameraChanged,
    onMapMarkerPress,
    selectedRouteStepId,
    focusRouteInfoStep,
  } = controller;
  const routeDurationText = formatRouteInfoDuration(
    selectedRouteInfo?.totalDurationMinutes ?? selectedAlternative?.minutes,
  );
  const arrivalText =
    selectedTransitMeta?.arrivalText ??
    selectedTransitTimeRange.split(' | ')[0]?.split(' - ')[1] ??
    '';
  const routeHeaderLine = selectedAlternative
    ? getPrimaryTransitLineLabel(selectedAlternative.transitLegs)
    : '대중교통';
  const routeHeaderTransferText =
    typeof selectedAlternative?.transferCount === 'number' &&
    selectedAlternative.transferCount > 0
      ? ` + 환승 ${selectedAlternative.transferCount}회`
      : '';
  const routeHeaderTitle = `${routeHeaderLine}${routeHeaderTransferText} | ${routeDurationText}`;
  const routeHeaderIcon =
    selectedAlternative?.transitLegs?.find(leg => isRideLegKind(leg.kind))
      ?.kind === 'BUS'
      ? 'bus'
      : 'train';

  return (
    <View style={styles.routeDetailScreen}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />
      <View
        style={[
          styles.routeDetailMapFrame,
          { height: Math.max(258, Math.round(windowHeight * 0.3)) },
        ]}
      >
        <TmapMapView
          ref={mapRef}
          style={styles.routeDetailMapView}
          errorOverlayTop={96}
          camera={INITIAL_CAMERA}
          nightModeEnabled={isDark}
          showLocationButton={false}
          showZoomControls={false}
          onTapMap={onTapMap}
          onMarkerPress={onMapMarkerPress}
          onZoomChanged={onMapZoomChanged}
          onCameraChanged={onMapCameraChanged}
          onInitialized={() => setIsMapInitialized(true)}
          onMapLayoutReport={onMapLayoutReport}
          markers={mapMarkers}
          pathOverlays={themedMapPathOverlays}
          pathOverlayZoom={mapZoom}
          pathCoords={travelMode === 'TRANSIT' ? undefined : pathOverlayCoords}
          pathColor={MAP_GUIDE_ROUTE_BLUE}
          pathWidth={routeStrokeStyle.mainWidth}
          pathOutlineColor={getMapRouteCasingColor(
            shouldRenderTransitDetailDark,
          )}
          pathOutlineWidth={routeStrokeStyle.outlineWidth}
          clearRouteOverlays={isRouteQaBaseOnly}
          routeOverlayScope={routeOverlayScopeKey}
          mapBaseDimOpacity={qaMapBaseDimOpacity}
          routeFocusMode={isRouteDetailMode}
          fallbackBackgroundColor={isDark ? '#0B1220' : '#EEF2F6'}
          fallbackTextColor={colors.textSecondary}
        />
        <View
          pointerEvents="box-none"
          style={[styles.routeDetailMapHeader, { paddingTop: insets.top + 10 }]}
        >
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="뒤로가기"
            style={styles.routeDetailFloatingButton}
          >
            <Ionicons name="chevron-back" size={28} color="#F5F7FA" />
          </Pressable>
          <View style={styles.routeDetailTitlePill}>
            <Ionicons name={routeHeaderIcon} size={18} color="#8FA20B" />
            <Text numberOfLines={1} style={styles.routeDetailHeaderTitle}>
              {routeHeaderTitle}
            </Text>
          </View>
          <Pressable
            onPress={submit}
            accessibilityRole="button"
            accessibilityLabel="선택한 경로 저장"
            accessibilityState={{
              disabled: !canSubmitRoute,
              busy: etaLoading || routeSubmitPending,
            }}
            disabled={!canSubmitRoute}
            style={styles.routeDetailFloatingButton}
          >
            <Ionicons name="bookmark-outline" size={24} color="#F5F7FA" />
          </Pressable>
        </View>
      </View>

      <View style={styles.routeDetailPanel}>
        <View style={styles.routeDetailSheetHandle} />
        <ScrollView
          style={styles.routeDetailPanelScroll}
          contentContainerStyle={[
            styles.routeDetailPanelContent,
            {
              paddingBottom:
                TRANSIT_DETAIL_ACTION_BAR_MIN_HEIGHT +
                transitDetailActionBarPaddingBottom +
                34,
            },
          ]}
          bounces={false}
          alwaysBounceVertical={false}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.routeDetailSummaryCard}>
            <View style={styles.routeDetailCompactSummary}>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.76}
                style={styles.routeDetailCompactDuration}
              >
                {routeDurationText}
              </Text>
              {!!selectedTransitMeta?.combinedText && (
                <Text numberOfLines={1} style={styles.routeDetailMetaText}>
                  {selectedTransitMeta.combinedText}
                </Text>
              )}

              {selectedTransitProgressSegments.length > 0 && (
                <TransitRouteProgressBar
                  segments={selectedTransitProgressSegments}
                  isDark
                  compact
                />
              )}
            </View>

            <View style={styles.routeDetailDivider} />

            <Text style={styles.routeDetailBaseTimeText}>
              {formatTransitClock(selectedRouteDepartureAt)} 기준
            </Text>

            {selectedRouteInfo ? (
              <RouteStepTimeline
                routeInfo={selectedRouteInfo}
                selectedStepId={selectedRouteStepId}
                selectedPassStop={
                  selectedTransitMapStop
                    ? {
                        stepId: `leg-${selectedTransitMapStop.legIndex}`,
                        stopIndex: selectedTransitMapStop.stopIndex,
                      }
                    : undefined
                }
                onStepPress={focusRouteInfoStep}
                forceDark
                primaryTextColor="#F5F7FA"
                secondaryTextColor="#9CA3AF"
                compact
              />
            ) : (
              <View style={styles.routeDetailLoadingRow}>
                <BrandedLoader
                  size="button"
                  variant="route"
                  accessibilityLabel="상세 경로를 불러오고 있어요"
                />
                <Text style={styles.routeDetailEmptyText}>
                  상세 경로를 불러오는 중입니다.
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      </View>

      {!!selectedAlternative && (
        <View
          style={[
            styles.routeDetailActionBar,
            { paddingBottom: transitDetailActionBarPaddingBottom },
          ]}
        >
          <View style={styles.routeDetailActionEta}>
            <Text style={styles.routeDetailActionDuration}>
              {routeDurationText}
            </Text>
            <Text style={styles.routeDetailActionArrival}>
              {arrivalText ? `${arrivalText} 도착` : '도착 시간 확인'}
            </Text>
          </View>
          <View style={styles.routeDetailActionButtons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="지도에서 전체 경로 미리보기"
              onPress={() => {
                const previewCoords = pathOverlayCoords ?? [];
                if (previewCoords.length >= 2) {
                  mapRef.current?.fitToCoordinates(previewCoords, {
                    padding: 72,
                  });
                }
              }}
              style={styles.routeDetailPreviewButton}
            >
              <Ionicons name="bus" size={18} color="#4B9DFF" />
              <Text style={styles.routeDetailPreviewButtonText}>미리보기</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              accessibilityRole="button"
              accessibilityLabel="선택한 경로 저장"
              accessibilityState={{
                disabled: !canSubmitRoute,
                busy: etaLoading || routeSubmitPending,
              }}
              disabled={!canSubmitRoute}
              style={styles.routeDetailSaveButton}
            >
              <Ionicons name="checkmark" size={18} color="#111317" />
              <Text style={styles.routeDetailSaveButtonText}>경로 저장</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}
