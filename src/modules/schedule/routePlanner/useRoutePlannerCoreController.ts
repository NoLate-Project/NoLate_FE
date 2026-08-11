import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import type { TmapCameraState } from '../../map/TmapMapView';
import type { useTheme } from '../../theme/ThemeContext';
import {
  getRouteDetailSummarySurface,
  getTransitDetailSummaryPalette,
} from '../transitDetailPresentation';
import {
  resolveRoutePlannerBackAction,
  shouldEnableRoutePlannerGesture,
} from '../routePlannerNavigation';
import type { TravelMode } from '../types';
import type { RoutePointTarget } from './params';
import { getRoutePlannerBottomSheetLayout, type BottomSheetSnap } from './bottomSheetLayout';
import { estimateMetersPerPixel } from './routeMapCoordinate';
import type { Coordinate } from './routeMapTypesAndStyle';

type Options = {
  activeTarget: RoutePointTarget | null;
  bottomPanelHeight: number;
  bottomSheetAnimatedOffset: number;
  bottomSheetSnap: BottomSheetSnap;
  colors: ReturnType<typeof useTheme>['colors'];
  destinationAddress: string;
  destinationLat?: number;
  destinationLng?: number;
  destinationName: string;
  hasBottomSheetMeasured: boolean;
  insetsBottom: number;
  insetsTop: number;
  isBottomSheetHidden: boolean;
  isDark: boolean;
  isRoutePointEditMode: boolean;
  isRouteSelectionScreen: boolean;
  lastCameraActionKeyRef: MutableRefObject<string>;
  navigation: { setOptions: (options: { gestureEnabled: boolean }) => void };
  originAddress: string;
  originLat?: number;
  originLng?: number;
  originName: string;
  overlayCardBg: string;
  overlayPanelBg: string;
  setMapCamera: Dispatch<SetStateAction<TmapCameraState>>;
  shouldReturnToScheduleDetail: boolean;
  transitActionBarHeight: number;
  travelMode: TravelMode;
  windowHeight: number;
};

/**
 * 경로 화면의 좌표 준비 여부, 상세 색상, 뒤로가기 정책, 바텀시트 레이아웃을 계산한다.
 * 카메라 명령 전 상태를 먼저 예열해 WebView 명령과 React 상태가 서로 덮어쓰지 않게 한다.
 */
export function useRoutePlannerCoreController({
  activeTarget,
  bottomPanelHeight,
  bottomSheetAnimatedOffset,
  bottomSheetSnap,
  colors,
  destinationAddress,
  destinationLat,
  destinationLng,
  destinationName,
  hasBottomSheetMeasured,
  insetsBottom,
  insetsTop,
  isBottomSheetHidden,
  isDark,
  isRoutePointEditMode,
  isRouteSelectionScreen,
  lastCameraActionKeyRef,
  navigation,
  originAddress,
  originLat,
  originLng,
  originName,
  overlayCardBg,
  overlayPanelBg,
  setMapCamera,
  shouldReturnToScheduleDetail,
  transitActionBarHeight,
  travelMode,
  windowHeight,
}: Options) {
  const insets = { top: insetsTop, bottom: insetsBottom };
  const prewarmMapCameraState = useCallback(
    (center: Coordinate, zoom: number) => {
      const nextMetersPerPixel = estimateMetersPerPixel(center.latitude, zoom);
      setMapCamera(previous => {
        if (
          Math.abs(previous.latitude - center.latitude) < 0.000002 &&
          Math.abs(previous.longitude - center.longitude) < 0.000002 &&
          Math.abs(previous.zoom - zoom) < 0.05 &&
          typeof previous.metersPerPixel === 'number' &&
          Math.abs(previous.metersPerPixel - nextMetersPerPixel) <=
            Math.max(0.001, nextMetersPerPixel * 0.015)
        ) {
          return previous;
        }
        return {
          latitude: center.latitude,
          longitude: center.longitude,
          zoom,
          metersPerPixel: nextMetersPerPixel,
        };
      });
    },
    [setMapCamera],
  );

  const runCameraActionAfterDirectionPrewarm = useCallback(
    (
      actionKey: string,
      center: Coordinate,
      zoom: number,
      action: () => void,
    ) => {
      prewarmMapCameraState(center, zoom);
      // 카메라 상태와 WebView 명령 순서를 맞춰 QA 프리셋 이동이 이전 줌 값에 덮이지 않게 한다.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (lastCameraActionKeyRef.current === actionKey) action();
        });
      });
    },
    [lastCameraActionKeyRef, prewarmMapCameraState],
  );

  const isTransitMode = travelMode === 'TRANSIT';
  const hasOriginCoords =
    typeof originLat === 'number' && typeof originLng === 'number';
  const hasDestinationCoords =
    typeof destinationLat === 'number' && typeof destinationLng === 'number';
  const hasRouteReady = hasOriginCoords && hasDestinationCoords;
  const isRouteDetailMode = hasRouteReady && !isRouteSelectionScreen;
  const isTransitDetailMode = isTransitMode && isRouteDetailMode;
  const shouldRenderTransitDetailDark = isDark;
  const detailPanelBg = isRouteDetailMode
    ? isDark
      ? '#0B0C0F'
      : '#F8FAFC'
    : overlayPanelBg;
  const detailCardBg = isRouteDetailMode
    ? isDark
      ? '#0B0C0F'
      : '#FFFFFF'
    : overlayCardBg;
  const detailPrimaryText = isDark ? '#F3F4F6' : colors.textPrimary;
  const detailSecondaryText = isDark ? '#B8B8B8' : colors.textSecondary;
  const detailBorderColor = isDark ? '#343434' : colors.border;
  const transitDetailSummaryPalette = getTransitDetailSummaryPalette(
    isDark,
    colors,
  );
  const routeDetailSummarySurface = getRouteDetailSummarySurface(
    isTransitDetailMode,
    detailCardBg,
    transitDetailSummaryPalette.borderColor,
  );
  const transitRouteChipBg = shouldRenderTransitDetailDark
    ? 'rgba(18,18,18,0.94)'
    : 'rgba(248,250,252,0.985)';
  const transitRouteChipText = shouldRenderTransitDetailDark
    ? '#D7D7DA'
    : '#334155';
  const transitActionBarBg = shouldRenderTransitDetailDark
    ? '#0B0C0F'
    : '#F8FAFC';
  const transitFocusedLegBg = shouldRenderTransitDetailDark
    ? 'rgba(47,128,255,0.16)'
    : '#DBEAFE';
  const transitDetailPrimaryActionBg = '#2979FF';
  const transitDetailPrimaryActionText = '#FFFFFF';
  const transitDetailControlText = shouldRenderTransitDetailDark
    ? '#F3F4F6'
    : '#111827';
  const isRoutePointLocked = hasRouteReady && !isRoutePointEditMode;
  const isRouteSelectionStage = isRouteSelectionScreen;
  const routePlannerBackAction = resolveRoutePlannerBackAction({
    isRouteSelectionStage,
    shouldReturnToScheduleDetail,
  });
  useEffect(() => {
    navigation.setOptions({
      gestureEnabled: shouldEnableRoutePlannerGesture({
        isRouteSelectionStage,
        shouldReturnToScheduleDetail,
      }),
    });
  }, [isRouteSelectionStage, navigation, shouldReturnToScheduleDetail]);
  const hasActiveTarget =
    activeTarget === 'origin' || activeTarget === 'destination';
  const originDisplay =
    originName.trim() || originAddress.trim() || '출발지 미선택';
  const destinationDisplay =
    destinationName.trim() || destinationAddress.trim() || '도착지 미선택';
  const {
    transitDetailActionBarPaddingBottom,
    bottomPanelMaxHeight,
    bottomSheetCollapsedOffset,
    bottomSheetMiddleOffset,
    bottomSheetExpandedOffset,
    bottomSheetHiddenOffset,
    bottomSheetDragMinOffset,
    bottomSheetDragMaxOffset,
    canScrollBottomSheetContent,
    visibleBottomSheetHeight,
    bottomPanelScrollViewportHeight,
    bottomPanelScrollBottomPadding,
    transitMapBottomOcclusionHeight,
  } = getRoutePlannerBottomSheetLayout({
    bottomPanelHeight,
    transitActionBarHeight,
    hasBottomSheetMeasured,
    bottomSheetAnimatedOffset,
    bottomSheetSnap,
    isBottomSheetHidden,
    isRouteDetailMode,
    windowHeight,
    safeAreaTop: insets.top,
    safeAreaBottom: insets.bottom,
  });

  return {
    bottomPanelMaxHeight,
    bottomPanelScrollBottomPadding,
    bottomPanelScrollViewportHeight,
    bottomSheetCollapsedOffset,
    bottomSheetDragMaxOffset,
    bottomSheetDragMinOffset,
    bottomSheetExpandedOffset,
    bottomSheetHiddenOffset,
    bottomSheetMiddleOffset,
    canScrollBottomSheetContent,
    destinationDisplay,
    detailBorderColor,
    detailCardBg,
    detailPanelBg,
    detailPrimaryText,
    detailSecondaryText,
    hasActiveTarget,
    hasDestinationCoords,
    hasOriginCoords,
    hasRouteReady,
    isRouteDetailMode,
    isRoutePointLocked,
    isRouteSelectionStage,
    isTransitDetailMode,
    isTransitMode,
    originDisplay,
    routeDetailSummarySurface,
    routePlannerBackAction,
    runCameraActionAfterDirectionPrewarm,
    shouldRenderTransitDetailDark,
    transitActionBarBg,
    transitDetailActionBarPaddingBottom,
    transitDetailControlText,
    transitDetailPrimaryActionBg,
    transitDetailPrimaryActionText,
    transitDetailSummaryPalette,
    transitFocusedLegBg,
    transitMapBottomOcclusionHeight,
    transitRouteChipBg,
    transitRouteChipText,
    visibleBottomSheetHeight,
  };
}
