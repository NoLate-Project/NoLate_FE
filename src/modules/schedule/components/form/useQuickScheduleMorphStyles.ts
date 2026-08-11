import {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

import {
  ADD_HANDOFF_MOTION,
  lerpAddHandoffValue,
} from "../../addHandoffMotion";
import { EXPANDED_CARD_RADIUS } from "./quickScheduleModalModel";

type QuickScheduleMorphStylesOptions = {
  cardLeft: number;
  cardTop: number;
  cardWidth: number;
  closeSourceHeight: number;
  closeSourceLeft: number;
  closeSourceRadius: number;
  closeSourceWidth: number;
  closingPhase: SharedValue<number>;
  expandedCardHeight: SharedValue<number>;
  modeIndicatorWidth: SharedValue<number>;
  modeIndicatorX: SharedValue<number>;
  openSourceHeight: number;
  openSourceLeft: number;
  openSourceRadius: number;
  openSourceWidth: number;
  progress: SharedValue<number>;
  sourceTop: number;
};

/** 모달 원본 버튼과 확장 카드 사이의 위치·크기·가림막 애니메이션 스타일을 계산한다. */
export function useQuickScheduleMorphStyles({
  cardLeft,
  cardTop,
  cardWidth,
  closeSourceHeight,
  closeSourceLeft,
  closeSourceRadius,
  closeSourceWidth,
  closingPhase,
  expandedCardHeight,
  modeIndicatorWidth,
  modeIndicatorX,
  openSourceHeight,
  openSourceLeft,
  openSourceRadius,
  openSourceWidth,
  progress,
  sourceTop,
}: QuickScheduleMorphStylesOptions) {
  const cardMotionRadiusStyle = useAnimatedStyle(() => {
    const motionProgress = progress.value;
    const finalHeight = expandedCardHeight.value;
    const closing = closingPhase.value >= 0.5;
    const sourceRadius = closing ? closeSourceRadius : openSourceRadius;
    const sourceHeight = closing ? closeSourceHeight : openSourceHeight;
    const scaleY = lerpAddHandoffValue(
      sourceHeight / finalHeight,
      1,
      motionProgress,
    );
    const visualRadius = lerpAddHandoffValue(
      sourceRadius,
      EXPANDED_CARD_RADIUS,
      motionProgress,
    );
    return { borderRadius: visualRadius / Math.max(scaleY, 0.01) };
  }, [
    closeSourceHeight,
    closeSourceRadius,
    expandedCardHeight,
    openSourceHeight,
    openSourceRadius,
    progress,
  ]);

  const cardClipRadiusStyle = useAnimatedStyle(() => {
    const motionProgress = progress.value;
    const finalHeight = expandedCardHeight.value;
    const closing = closingPhase.value >= 0.5;
    const sourceRadius = closing ? closeSourceRadius : openSourceRadius;
    const sourceHeight = closing ? closeSourceHeight : openSourceHeight;
    const scaleY = lerpAddHandoffValue(
      sourceHeight / finalHeight,
      1,
      motionProgress,
    );
    const visualRadius = lerpAddHandoffValue(
      sourceRadius,
      EXPANDED_CARD_RADIUS,
      motionProgress,
    );
    return { borderRadius: visualRadius / Math.max(scaleY, 0.01) };
  }, [
    closeSourceHeight,
    closeSourceRadius,
    expandedCardHeight,
    openSourceHeight,
    openSourceRadius,
    progress,
  ]);

  const cardMotionStyle = useAnimatedStyle(() => {
    const finalHeight = expandedCardHeight.value;
    const motionProgress = progress.value;
    const closing = closingPhase.value >= 0.5;
    const sourceLeft = closing ? closeSourceLeft : openSourceLeft;
    const sourceWidth = closing ? closeSourceWidth : openSourceWidth;
    const sourceHeight = closing ? closeSourceHeight : openSourceHeight;
    return {
      left: cardLeft,
      top: cardTop,
      width: cardWidth,
      height: finalHeight,
      transform: [
        {
          translateX: lerpAddHandoffValue(
            sourceLeft - cardLeft,
            0,
            motionProgress,
          ),
        },
        {
          translateY: lerpAddHandoffValue(
            sourceTop - cardTop,
            0,
            motionProgress,
          ),
        },
        {
          scaleX: lerpAddHandoffValue(
            sourceWidth / cardWidth,
            1,
            motionProgress,
          ),
        },
        {
          scaleY: lerpAddHandoffValue(
            sourceHeight / finalHeight,
            1,
            motionProgress,
          ),
        },
      ],
    };
  }, [
    cardLeft,
    cardTop,
    cardWidth,
    closeSourceHeight,
    closeSourceLeft,
    closeSourceWidth,
    expandedCardHeight,
    openSourceHeight,
    openSourceLeft,
    openSourceWidth,
    progress,
    sourceTop,
  ]);

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      progress.value,
      ADD_HANDOFF_MOTION.backdropInputRange,
      ADD_HANDOFF_MOTION.backdropOutputRange,
      Extrapolation.CLAMP,
    ),
  }));
  const cardDenseCloseStyle = useAnimatedStyle(() => {
    if (closingPhase.value < 0.5) return { opacity: 1 };
    return {
      opacity: interpolate(
        progress.value,
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
  const contentRevealCurtainAnimatedStyle = useAnimatedStyle(() => {
    if (closingPhase.value >= 0.5) return { opacity: 0 };
    return {
      opacity: interpolate(
        progress.value,
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
  });
  const modeIndicatorAnimatedStyle = useAnimatedStyle(() => ({
    opacity: modeIndicatorWidth.value > 0 ? 1 : 0,
    width: modeIndicatorWidth.value,
    transform: [{ translateX: modeIndicatorX.value }],
  }));

  return {
    backdropAnimatedStyle,
    cardClipRadiusStyle,
    cardDenseCloseStyle,
    cardMotionRadiusStyle,
    cardMotionStyle,
    contentRevealCurtainAnimatedStyle,
    modeIndicatorAnimatedStyle,
  };
}
