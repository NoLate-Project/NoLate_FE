import { useMemo } from 'react';
import {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';

import {
  ADD_HANDOFF_MOTION,
  ADD_MENU_SOURCE,
  lerpAddHandoffValue,
} from '../../addHandoffMotion';
import {
  MORPH_CLOSE_TARGET_HEIGHT,
  MORPH_TARGET_FALLBACK_HEIGHT,
  SHEET_TARGET_HEIGHT_RATIO,
  SHEET_TARGET_MAX_HEIGHT,
} from './scheduleAddModalModel';

type UseScheduleAddMorphStylesParams = {
  closeTargetWidth: number;
  insetsBottom: number;
  insetsTop: number;
  isMorphPresentation: boolean;
  measuredContentHeight: number | null;
  morphClosingPhase: SharedValue<number>;
  morphProgress: SharedValue<number>;
  screenHeight: number;
  screenWidth: number;
  sourceHeight: number;
  sourceRightOffset: number;
  sourceTopOffset: number;
  sourceWidth: number;
};

/**
 * 일정 추가 모프의 시작 버튼과 최종 시트 사이 좌표를 계산하고 UI 스레드용 스타일을 만듭니다.
 * 화면 크기와 안전 영역이 바뀌면 목표 크기를 다시 계산하며, 열기와 닫기 단계는 같은 보간 규칙을 공유합니다.
 */
export function useScheduleAddMorphStyles({
  closeTargetWidth,
  insetsBottom,
  insetsTop,
  isMorphPresentation,
  measuredContentHeight,
  morphClosingPhase,
  morphProgress,
  screenHeight,
  screenWidth,
  sourceHeight,
  sourceRightOffset,
  sourceTopOffset,
  sourceWidth,
}: UseScheduleAddMorphStylesParams) {
  const geometry = useMemo(() => {
    const openSourceWidth = Math.max(44, sourceWidth);
    const openSourceHeight = Math.max(44, sourceHeight);
    const closeSourceWidth = Math.max(44, closeTargetWidth);
    const closeSourceHeight = MORPH_CLOSE_TARGET_HEIGHT;
    const openSourceRadius = Math.min(
      openSourceHeight / 2,
      ADD_MENU_SOURCE.nativeRadius,
    );
    const closeSourceRadius = Math.min(
      closeSourceHeight / 2,
      ADD_MENU_SOURCE.nativeRadius,
    );
    const sourceRight = screenWidth - sourceRightOffset;
    const openSourceLeft = sourceRight - openSourceWidth;
    const closeSourceLeft = sourceRight - closeSourceWidth;
    const sourceTop = insetsTop + sourceTopOffset;
    const targetWidth = Math.min(screenWidth - 28, 390);
    const targetLeft = (screenWidth - targetWidth) / 2;
    const targetTop = sourceTop;
    const availableHeight = Math.max(
      1,
      screenHeight - targetTop - Math.max(insetsBottom, 14) - 10,
    );
    const targetHeight = Math.min(
      measuredContentHeight ?? MORPH_TARGET_FALLBACK_HEIGHT,
      availableHeight,
    );

    return {
      closeSourceHeight,
      closeSourceLeft,
      closeSourceRadius,
      closeSourceWidth,
      openSourceHeight,
      openSourceLeft,
      openSourceRadius,
      openSourceWidth,
      sourceTop,
      targetHeight,
      targetLeft,
      targetTop,
      targetWidth,
    };
  }, [
    closeTargetWidth,
    insetsBottom,
    insetsTop,
    measuredContentHeight,
    screenHeight,
    screenWidth,
    sourceHeight,
    sourceRightOffset,
    sourceTopOffset,
    sourceWidth,
  ]);

  const morphSheetStyle = useAnimatedStyle(() => {
    const motionProgress = morphProgress.value;
    const closing = morphClosingPhase.value >= 0.5;
    const activeSourceLeft = closing
      ? geometry.closeSourceLeft
      : geometry.openSourceLeft;
    const activeSourceWidth = closing
      ? geometry.closeSourceWidth
      : geometry.openSourceWidth;
    const activeSourceHeight = closing
      ? geometry.closeSourceHeight
      : geometry.openSourceHeight;
    const scaleX = lerpAddHandoffValue(
      activeSourceWidth / geometry.targetWidth,
      1,
      motionProgress,
    );
    const scaleY = lerpAddHandoffValue(
      activeSourceHeight / geometry.targetHeight,
      1,
      motionProgress,
    );

    return {
      left: geometry.targetLeft,
      top: geometry.targetTop,
      width: geometry.targetWidth,
      height: geometry.targetHeight,
      transform: [
        {
          translateX: lerpAddHandoffValue(
            activeSourceLeft - geometry.targetLeft,
            0,
            motionProgress,
          ),
        },
        {
          translateY: lerpAddHandoffValue(
            geometry.sourceTop - geometry.targetTop,
            0,
            motionProgress,
          ),
        },
        { scaleX },
        { scaleY },
      ],
    };
  }, [geometry, morphClosingPhase, morphProgress]);

  const morphSurfaceRadiusStyle = useAnimatedStyle(() => {
    const motionProgress = morphProgress.value;
    const closing = morphClosingPhase.value >= 0.5;
    const activeSourceHeight = closing
      ? geometry.closeSourceHeight
      : geometry.openSourceHeight;
    const activeSourceRadius = closing
      ? geometry.closeSourceRadius
      : geometry.openSourceRadius;
    const scaleY = lerpAddHandoffValue(
      activeSourceHeight / geometry.targetHeight,
      1,
      motionProgress,
    );
    const visualRadius = lerpAddHandoffValue(
      activeSourceRadius,
      ADD_MENU_SOURCE.nativeRadius,
      motionProgress,
    );

    return { borderRadius: visualRadius / Math.max(scaleY, 0.01) };
  }, [geometry, morphClosingPhase, morphProgress]);

  const morphDimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      morphProgress.value,
      ADD_HANDOFF_MOTION.backdropInputRange,
      ADD_HANDOFF_MOTION.backdropOutputRange,
      Extrapolation.CLAMP,
    ),
  }));

  const morphDenseCloseStyle = useAnimatedStyle(() => {
    if (morphClosingPhase.value < 0.5) return { opacity: 1 };

    return {
      opacity: interpolate(
        morphProgress.value,
        [
          0,
          ADD_HANDOFF_MOTION.closeContentFadeStartProgress,
          ADD_HANDOFF_MOTION.closeContentFadeEndProgress,
          1,
        ],
        [
          ADD_HANDOFF_MOTION.closeContentParkedOpacity,
          ADD_HANDOFF_MOTION.closeContentParkedOpacity,
          1,
          1,
        ],
        Extrapolation.CLAMP,
      ),
    };
  });

  const morphContentRevealCurtainStyle = useAnimatedStyle(() => {
    if (!isMorphPresentation || morphClosingPhase.value >= 0.5) {
      return { opacity: 0 };
    }

    return {
      opacity: interpolate(
        morphProgress.value,
        [
          0,
          ADD_HANDOFF_MOTION.contentRevealStartProgress,
          ADD_HANDOFF_MOTION.contentRevealEndProgress,
          1,
        ],
        [1, 1, 0, 0],
        Extrapolation.CLAMP,
      ),
    };
  }, [isMorphPresentation, morphClosingPhase, morphProgress]);

  const sheetTargetHeight = Math.min(
    SHEET_TARGET_MAX_HEIGHT,
    screenHeight * SHEET_TARGET_HEIGHT_RATIO,
  );

  return {
    morphContentRevealCurtainStyle,
    morphDenseCloseStyle,
    morphDimStyle,
    morphSheetStyle,
    morphSurfaceRadiusStyle,
    sheetTargetHeight,
  };
}
