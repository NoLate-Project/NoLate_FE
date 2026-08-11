import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { Animated, PanResponder } from 'react-native';

import type { RouteAlternativeOption } from '../../map/routingService';
import type { TravelMode } from '../types';
import type { BottomSheetSnap } from './bottomSheetLayout';
import type { SelectedTransitMapStop } from './routeTransitMarkers';

const BOTTOM_SHEET_EDGE_RESISTANCE = 0.28;
const BOTTOM_SHEET_EDGE_OVERSHOOT = 30;
const BOTTOM_SHEET_SNAP_VELOCITY_PROJECTION = 180;
const BOTTOM_SHEET_SNAP_VELOCITY_THRESHOLD = 0.45;

type SetValue<T> = Dispatch<SetStateAction<T>>;

type Options = {
  bottomSheetAnimatedOffsetRef: MutableRefObject<number>;
  bottomSheetCollapsedOffset: number;
  bottomSheetDragMaxOffset: number;
  bottomSheetDragMinOffset: number;
  bottomSheetExpandedOffset: number;
  bottomSheetHiddenOffset: number;
  bottomSheetMiddleOffset: number;
  bottomSheetStartYRef: MutableRefObject<number>;
  bottomSheetTranslateY: Animated.Value;
  focusedTransitLegIndex?: number;
  isBottomSheetHidden: boolean;
  isRouteDetailMode: boolean;
  selectedAlternative?: RouteAlternativeOption;
  selectedAlternativeId?: string;
  setBottomSheetAnimatedOffset: SetValue<number>;
  setBottomSheetSnap: SetValue<BottomSheetSnap>;
  setFocusedTransitLegIndex: SetValue<number | undefined>;
  setIsBottomSheetCollapsed: SetValue<boolean>;
  setIsBottomSheetHidden: SetValue<boolean>;
  setSelectedTransitMapStop: SetValue<SelectedTransitMapStop | undefined>;
  travelMode: TravelMode;
};

/**
 * 바텀시트의 스냅 애니메이션과 드래그 제스처를 관리하고 경로 변경 시 선택 상태를 정리한다.
 * 가장자리 저항과 속도 기반 스냅 판정을 한곳에 모아 화면별 시트 동작을 일관되게 유지한다.
 */
export function useRoutePlannerBottomSheetController({
  bottomSheetAnimatedOffsetRef,
  bottomSheetCollapsedOffset,
  bottomSheetDragMaxOffset,
  bottomSheetDragMinOffset,
  bottomSheetExpandedOffset,
  bottomSheetHiddenOffset,
  bottomSheetMiddleOffset,
  bottomSheetStartYRef,
  bottomSheetTranslateY,
  focusedTransitLegIndex,
  isBottomSheetHidden,
  isRouteDetailMode,
  selectedAlternative,
  selectedAlternativeId,
  setBottomSheetAnimatedOffset,
  setBottomSheetSnap,
  setFocusedTransitLegIndex,
  setIsBottomSheetCollapsed,
  setIsBottomSheetHidden,
  setSelectedTransitMapStop,
  travelMode,
}: Options) {
  useEffect(() => {
    const listenerId = bottomSheetTranslateY.addListener(({ value }) => {
      const roundedOffset = Math.round(value);
      if (Math.abs(bottomSheetAnimatedOffsetRef.current - roundedOffset) < 3)
        return;
      bottomSheetAnimatedOffsetRef.current = roundedOffset;
      setBottomSheetAnimatedOffset(roundedOffset);
    });

    return () => {
      bottomSheetTranslateY.removeListener(listenerId);
    };
  }, [bottomSheetAnimatedOffsetRef, bottomSheetTranslateY, setBottomSheetAnimatedOffset]);

  useEffect(() => {
    if (typeof focusedTransitLegIndex !== 'number') return;
    if (!Array.isArray(selectedAlternative?.transitLegs)) {
      setFocusedTransitLegIndex(undefined);
      return;
    }
    if (
      focusedTransitLegIndex < 0 ||
      focusedTransitLegIndex >= selectedAlternative.transitLegs.length
    ) {
      setFocusedTransitLegIndex(undefined);
    }
  }, [focusedTransitLegIndex, selectedAlternative, setFocusedTransitLegIndex]);

  useEffect(() => {
    setSelectedTransitMapStop(undefined);
  }, [selectedAlternativeId, setSelectedTransitMapStop, travelMode]);

  const animateBottomSheetTo = useCallback(
    (toValue: number) => {
      Animated.spring(bottomSheetTranslateY, {
        toValue,
        useNativeDriver: true,
        damping: 34,
        stiffness: 190,
        mass: 1,
        overshootClamping: true,
        restDisplacementThreshold: 0.35,
        restSpeedThreshold: 0.35,
      }).start();
    },
    [bottomSheetTranslateY],
  );

  const getBottomSheetSnapTarget = useCallback(
    (snap: BottomSheetSnap) => {
      if (snap === 'hidden') return bottomSheetHiddenOffset;
      if (snap === 'expanded') return bottomSheetExpandedOffset;
      if (snap === 'middle')
        return isRouteDetailMode
          ? bottomSheetMiddleOffset
          : bottomSheetCollapsedOffset;
      return bottomSheetCollapsedOffset;
    },
    [
      bottomSheetCollapsedOffset,
      bottomSheetExpandedOffset,
      bottomSheetHiddenOffset,
      bottomSheetMiddleOffset,
      isRouteDetailMode,
    ],
  );

  const snapBottomSheetTo = useCallback(
    (snap: BottomSheetSnap) => {
      const target = getBottomSheetSnapTarget(snap);
      if (snap === 'hidden') {
        setBottomSheetSnap('hidden');
        setIsBottomSheetCollapsed(true);
        animateBottomSheetTo(target);
        setIsBottomSheetHidden(true);
        return;
      }
      if (isBottomSheetHidden) {
        setIsBottomSheetHidden(false);
      }
      setBottomSheetSnap(snap);
      setIsBottomSheetCollapsed(snap !== 'expanded');
      animateBottomSheetTo(target);
    },
    [
      animateBottomSheetTo,
      getBottomSheetSnapTarget,
      isBottomSheetHidden,
      setBottomSheetSnap,
      setIsBottomSheetCollapsed,
      setIsBottomSheetHidden,
    ],
  );

  const getSnapFromGesture = useCallback(
    (current: number, velocityY: number): BottomSheetSnap => {
      if (bottomSheetCollapsedOffset <= 0) return 'collapsed';
      if (!isRouteDetailMode) {
        const midpoint =
          bottomSheetExpandedOffset +
          (bottomSheetCollapsedOffset - bottomSheetExpandedOffset) * 0.52;
        const projected =
          current + velocityY * BOTTOM_SHEET_SNAP_VELOCITY_PROJECTION;

        if (velocityY <= -BOTTOM_SHEET_SNAP_VELOCITY_THRESHOLD)
          return 'expanded';
        if (velocityY >= BOTTOM_SHEET_SNAP_VELOCITY_THRESHOLD)
          return 'collapsed';
        return projected >= midpoint ? 'collapsed' : 'expanded';
      }

      if (velocityY <= -BOTTOM_SHEET_SNAP_VELOCITY_THRESHOLD) {
        return current > bottomSheetMiddleOffset ? 'middle' : 'expanded';
      }
      if (velocityY >= BOTTOM_SHEET_SNAP_VELOCITY_THRESHOLD) {
        return current < bottomSheetMiddleOffset ? 'middle' : 'collapsed';
      }

      const projected = Math.min(
        Math.max(
          bottomSheetExpandedOffset,
          current + velocityY * BOTTOM_SHEET_SNAP_VELOCITY_PROJECTION,
        ),
        bottomSheetDragMaxOffset,
      );
      const snapPoints: Array<{ snap: BottomSheetSnap; value: number }> = [
        { snap: 'expanded', value: bottomSheetExpandedOffset },
        { snap: 'middle', value: bottomSheetMiddleOffset },
        { snap: 'collapsed', value: bottomSheetCollapsedOffset },
      ];
      return snapPoints.reduce((nearest, candidate) =>
        Math.abs(candidate.value - projected) <
        Math.abs(nearest.value - projected)
          ? candidate
          : nearest,
      ).snap;
    },
    [
      bottomSheetCollapsedOffset,
      bottomSheetDragMaxOffset,
      bottomSheetExpandedOffset,
      bottomSheetMiddleOffset,
      isRouteDetailMode,
    ],
  );

  const bottomHandlePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () =>
          !isBottomSheetHidden && bottomSheetCollapsedOffset > 0,
        onMoveShouldSetPanResponder: (_event, gestureState) =>
          !isBottomSheetHidden &&
          bottomSheetCollapsedOffset > 0 &&
          Math.abs(gestureState.dy) > 1 &&
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 0.6,
        onPanResponderGrant: () => {
          bottomSheetTranslateY.stopAnimation(value => {
            bottomSheetStartYRef.current = value;
          });
        },
        onPanResponderMove: (_event, gestureState) => {
          let next = bottomSheetStartYRef.current + gestureState.dy;
          if (next < bottomSheetDragMinOffset) {
            next =
              bottomSheetDragMinOffset +
              (next - bottomSheetDragMinOffset) * BOTTOM_SHEET_EDGE_RESISTANCE;
          } else if (next > bottomSheetDragMaxOffset) {
            next =
              bottomSheetDragMaxOffset +
              (next - bottomSheetDragMaxOffset) * BOTTOM_SHEET_EDGE_RESISTANCE;
          }
          next = Math.min(
            bottomSheetDragMaxOffset + BOTTOM_SHEET_EDGE_OVERSHOOT,
            Math.max(
              bottomSheetDragMinOffset - BOTTOM_SHEET_EDGE_OVERSHOOT,
              next,
            ),
          );
          bottomSheetTranslateY.setValue(next);
        },
        onPanResponderRelease: (_event, gestureState) => {
          bottomSheetTranslateY.stopAnimation(current => {
            snapBottomSheetTo(getSnapFromGesture(current, gestureState.vy));
          });
        },
        onPanResponderTerminate: (_event, gestureState) => {
          bottomSheetTranslateY.stopAnimation(current => {
            snapBottomSheetTo(getSnapFromGesture(current, gestureState.vy));
          });
        },
      }),
    [
      bottomSheetCollapsedOffset,
      bottomSheetDragMinOffset,
      bottomSheetDragMaxOffset,
      bottomSheetStartYRef,
      bottomSheetTranslateY,
      getSnapFromGesture,
      isBottomSheetHidden,
      snapBottomSheetTo,
    ],
  );

  return {
    animateBottomSheetTo,
    bottomHandlePanResponder,
    getBottomSheetSnapTarget,
    snapBottomSheetTo,
  };
}
