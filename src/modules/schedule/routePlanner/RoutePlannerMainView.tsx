import { useLayoutEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';

import { RouteSelectScreenContent } from '../../../routeSupport/schedule/RouteSelectScreenContent';
import { useRouteSelectController } from '../../../routeSupport/schedule/useRouteSelectController';
import { getScheduleAccessibilityVisibility } from '../accessibilityVisibility';
import { shouldEnableRoutePlannerGesture } from '../routePlannerNavigation';
import styles from './styles';
import { RoutePlannerBottomSheet } from './RoutePlannerBottomSheet';
import { RoutePlannerMapCanvas } from './RoutePlannerMapCanvas';
import { RoutePlannerMapHeader } from './RoutePlannerMapHeader';
import { RoutePlannerModals } from './RoutePlannerModals';
import type { RoutePlannerController } from './useRoutePlannerController';
import type { RoutePlannerPlaceEditor } from './useRoutePlannerSubmissionActions';

type Props = { controller: RoutePlannerController };
const placeEditorEntrance = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const placeEditorExit = FadeOut.duration(120).reduceMotion(ReduceMotion.System);

function RoutePlannerPlaceSearch({
  placeEditor, closePlaceEditor, confirmRoutePoints,
}: Pick<RoutePlannerController, 'closePlaceEditor' | 'confirmRoutePoints'> & { placeEditor: RoutePlannerPlaceEditor }) {
  const isFocused = useIsFocused();
  const searchController = useRouteSelectController({
    sessionIdOverride: placeEditor.sessionId,
    placeEditor: {
      initial: placeEditor.initial,
      target: placeEditor.target,
      onCancel: closePlaceEditor,
      onConfirm: confirmRoutePoints,
      isFocused,
    },
  });

  return <RouteSelectScreenContent controller={searchController} />;
}

/** 지도와 기능별 오버레이 컴포넌트를 조합해 경로 플래너의 기본 화면 구조를 렌더링합니다. */
export function RoutePlannerMainView({ controller }: Props) {
  const navigation = useNavigation();
  const { placeEditor, closePlaceEditor, confirmRoutePoints, shouldReturnToScheduleDetail } = controller;
  const editingPlaces = Boolean(placeEditor);
  const allowBackGesture = shouldEnableRoutePlannerGesture({ shouldReturnToScheduleDetail });
  useLayoutEffect(() => {
    navigation.setOptions({ gestureEnabled: allowBackGesture && !editingPlaces });
  }, [allowBackGesture, editingPlaces, navigation]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: controller.colors.background },
      ]}
    >
      <View
        style={StyleSheet.absoluteFill}
        {...getScheduleAccessibilityVisibility(!editingPlaces)}
        pointerEvents={editingPlaces ? 'none' : 'auto'}
      >
        <RoutePlannerMapCanvas controller={controller} />
        <RoutePlannerMapHeader controller={controller} />
        <RoutePlannerBottomSheet controller={controller} />
        <RoutePlannerModals controller={controller} />
      </View>
      {placeEditor && (
        <Animated.View
          accessibilityViewIsModal
          entering={placeEditorEntrance}
          exiting={placeEditorExit}
          style={StyleSheet.absoluteFill}
        >
          <RoutePlannerPlaceSearch
            placeEditor={placeEditor}
            closePlaceEditor={closePlaceEditor}
            confirmRoutePoints={confirmRoutePoints}
          />
        </Animated.View>
      )}
    </View>
  );
}
