import { useMemo } from 'react';
import { Animated, PanResponder } from 'react-native';

import {
  clampSheetY,
  SHEET_CLOSE_DISTANCE,
  SHEET_CLOSE_VELOCITY,
  SHEET_VELOCITY_PROJECTION,
} from './scheduleAddModalModel';

type Params = {
  posY: Animated.Value;
  requestClose: (restoreBeforePrompt?: boolean) => void;
};

/**
 * 일정 추가 시트의 핸들 드래그를 수직 이동으로 변환하고 거리·속도 기준으로 닫기 여부를 결정합니다.
 * 닫기 기준에 못 미치거나 제스처가 중단되면 시트를 열린 위치로 부드럽게 복원합니다.
 */
export function useScheduleAddSheetPanResponder({
  posY,
  requestClose,
}: Params) {
  return useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dy > 2 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onMoveShouldSetPanResponderCapture: () => false,
        onPanResponderMove: (_, gesture) => {
          posY.setValue(clampSheetY(gesture.dy));
        },
        onPanResponderRelease: (_, gesture) => {
          const projectedY = clampSheetY(
            gesture.dy + gesture.vy * SHEET_VELOCITY_PROJECTION,
          );
          if (
            projectedY > SHEET_CLOSE_DISTANCE ||
            gesture.vy > SHEET_CLOSE_VELOCITY
          ) {
            requestClose(true);
            return;
          }
          restoreOpenPosition(posY);
        },
        onPanResponderTerminate: () => restoreOpenPosition(posY),
      }),
    [posY, requestClose],
  );
}

/** 드래그가 취소된 시트를 열린 위치로 복원합니다. */
function restoreOpenPosition(posY: Animated.Value) {
  Animated.spring(posY, {
    toValue: 0,
    useNativeDriver: true,
    damping: 24,
    stiffness: 230,
    mass: 0.9,
    restDisplacementThreshold: 0.35,
    restSpeedThreshold: 0.35,
  }).start();
}
