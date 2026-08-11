import { Pressable, StatusBar, Text, View } from 'react-native';
import TmapMapView from '../../map/TmapMapView';
import styles from './styles';
import {
  FALLBACK_LAT,
  getMapRouteCasingColor,
  MAP_GUIDE_ROUTE_BLUE,
} from './routeMapTypesAndStyle';
import type { RoutePlannerController } from './useRoutePlannerController';

const FALLBACK_LNG = 126.978;

const INITIAL_CAMERA = {
  latitude: FALLBACK_LAT,
  longitude: FALLBACK_LNG,
  zoom: 12,
};

type Props = { controller: RoutePlannerController };

/** 지도 바탕, 경로 오버레이와 확대·축소 컨트롤을 렌더링합니다. */
export function RoutePlannerMapCanvas({ controller }: Props) {
  const {
    insets,
    colors,
    isDark,
    overlayBoxBg,
    isRouteQaBaseOnly,
    qaMapBaseDimOpacity,
    travelMode,
    setIsMapInitialized,
    mapZoom,
    mapRef,
    isRouteDetailMode,
    shouldRenderTransitDetailDark,
    shouldShowZoomControls,
    routeStrokeStyle,
    routeOverlayScopeKey,
    pathOverlayCoords,
    themedMapPathOverlays,
    mapMarkers,
    onTapMap,
    onPressZoomIn,
    onPressZoomOut,
    onMapLayoutReport,
    onMapZoomChanged,
    onMapCameraChanged,
    onMapMarkerPress,
  } = controller;
  return (
    <>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />
      <TmapMapView
        ref={mapRef}
        style={styles.fullMap}
        errorOverlayTop={Math.max(insets.top + 72, 104)}
        camera={INITIAL_CAMERA}
        nightModeEnabled={isDark}
        // 경로 상세에서는 출발지/도착지 마커가 기준이다. WebView 자체 위치 버튼은
        // 권한 실패를 사용자에게 설명할 수 없으므로 노출하지 않는다.
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
        pathOutlineColor={getMapRouteCasingColor(shouldRenderTransitDetailDark)}
        pathOutlineWidth={routeStrokeStyle.outlineWidth}
        clearRouteOverlays={isRouteQaBaseOnly}
        routeOverlayScope={routeOverlayScopeKey}
        mapBaseDimOpacity={qaMapBaseDimOpacity}
        routeFocusMode={isRouteDetailMode}
        fallbackBackgroundColor={isDark ? '#0B1220' : '#EEF2F6'}
        fallbackTextColor={colors.textSecondary}
      />
      {shouldShowZoomControls && !isRouteDetailMode && (
        <View style={styles.zoomOverlay}>
          <View
            style={[
              styles.zoomControlCard,
              styles.overlaySurface,
              { borderColor: colors.border, backgroundColor: overlayBoxBg },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="지도 확대"
              onPress={onPressZoomIn}
              style={styles.zoomControlBtn}
            >
              <Text
                style={[styles.zoomControlText, { color: colors.textPrimary }]}
              >
                +
              </Text>
            </Pressable>
            <View
              style={[styles.zoomDivider, { backgroundColor: colors.border }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="지도 축소"
              onPress={onPressZoomOut}
              style={styles.zoomControlBtn}
            >
              <Text
                style={[styles.zoomControlText, { color: colors.textPrimary }]}
              >
                -
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </>
  );
}
