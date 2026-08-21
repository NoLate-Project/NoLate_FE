import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Alert, Animated, BackHandler, Platform } from 'react-native';
import {
  cancelAnimation,
  Easing as ReanimatedEasing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  ADD_HANDOFF_MOTION,
  resolveAddHandoffCloseDuration,
} from '../../addHandoffMotion';
import { getScheduleAddCloseAction } from '../../scheduleAddCloseGuard';
import {
  type CloseSheetOptions,
  MORPH_OPEN_DURATION_MS,
  MORPH_OPEN_START_PROGRESS,
  PREWARM_PRESENTATION_OPACITY,
  type Props,
  SHEET_HIDDEN_Y,
} from './scheduleAddModalModel';

type UseScheduleAddSheetLifecycleParams = Pick<
  Props,
  'morphPresenterRef' | 'onClose' | 'onCloseStart' | 'onMorphReady' | 'visible'
> & {
  closePromptVisibleRef: MutableRefObject<boolean>;
  discardDraft: () => void;
  formDirtyRef: MutableRefObject<boolean>;
  isMorphPresentation: boolean;
  measuredContentHeight: number | null;
  measuredContentHeightRef: MutableRefObject<number | null>;
  morphContentMounted: boolean;
  prewarm: boolean;
  rendered: boolean;
  routePlannerHidden: boolean;
  setMeasuredContentHeight: Dispatch<SetStateAction<number | null>>;
  setMorphContentMounted: Dispatch<SetStateAction<boolean>>;
  setMorphSheetRasterized: Dispatch<SetStateAction<boolean>>;
  setRendered: Dispatch<SetStateAction<boolean>>;
  submitInFlightRef: MutableRefObject<boolean>;
  submitting: boolean;
};

/**
 * 일정 추가 시트의 열기·닫기·프리웜·뒤로가기 생명주기를 한곳에서 관리합니다.
 * 폼 값 자체는 변경하지 않고 표시 상태와 애니메이션 값, 닫기 명령만 반환합니다.
 */
export function useScheduleAddSheetLifecycle({
  closePromptVisibleRef,
  discardDraft,
  formDirtyRef,
  isMorphPresentation,
  measuredContentHeight,
  measuredContentHeightRef,
  morphContentMounted,
  morphPresenterRef,
  onClose,
  onCloseStart,
  onMorphReady,
  prewarm,
  rendered,
  routePlannerHidden,
  setMeasuredContentHeight,
  setMorphContentMounted,
  setMorphSheetRasterized,
  setRendered,
  submitInFlightRef,
  submitting,
  visible,
}: UseScheduleAddSheetLifecycleParams) {
  // 새 일정 바텀시트의 열림/닫힘 위치를 관리한다.
  const posY = useRef(new Animated.Value(SHEET_HIDDEN_Y)).current;
  const morphProgress = useSharedValue(0);
  const morphClosingPhase = useSharedValue(0);
  const morphPresentationOpacity = useSharedValue(
    isMorphPresentation && visible && !prewarm
      ? 1
      : PREWARM_PRESENTATION_OPACITY,
  );
  const morphPresentationStyle = useAnimatedStyle(() => ({
    opacity: morphPresentationOpacity.value,
  }));
  const morphSeedPaintFrameRef = useRef<ReturnType<
    typeof requestAnimationFrame
  > | null>(null);
  const morphCloseFinishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const morphClosingRef = useRef(false);
  const morphWasPresentedRef = useRef(false);
  const closingRef = useRef(false);
  const closeCycleRef = useRef(0);
  const morphOpenCycleRef = useRef(0);
  const morphSeedHasLayoutRef = useRef(false);
  const morphOpenStartedRef = useRef(false);
  const visibleRef = useRef(visible);
  const onMorphReadyRef = useRef(onMorphReady);
  if (
    visible ||
    (!morphOpenStartedRef.current && morphSeedPaintFrameRef.current === null)
  ) {
    visibleRef.current = visible;
  }
  onMorphReadyRef.current = onMorphReady;

  /** 진행 중인 닫기 타이머와 예약 프레임을 취소하고 다음 표시 주기를 시작할 수 있는 상태로 초기화합니다. */
  const resetCloseLifecycle = useCallback(() => {
    closeCycleRef.current += 1;
    closingRef.current = false;
    morphClosingRef.current = false;
    morphClosingPhase.value = 0;
    if (morphCloseFinishTimerRef.current) {
      clearTimeout(morphCloseFinishTimerRef.current);
      morphCloseFinishTimerRef.current = null;
    }
    if (morphSeedPaintFrameRef.current !== null) {
      cancelAnimationFrame(morphSeedPaintFrameRef.current);
      morphSeedPaintFrameRef.current = null;
    }
  }, [morphClosingPhase]);

  /** 현재 표시 주기가 여전히 유효할 때 모프 소유권과 도형 전환 애니메이션을 같은 시점에 시작합니다. */
  const startMorphOpenAnimation = useCallback(
    (openCycle: number) => {
      if (
        !isMorphPresentation ||
        !visibleRef.current ||
        openCycle !== morphOpenCycleRef.current ||
        morphOpenStartedRef.current ||
        closingRef.current
      )
        return;

      morphOpenStartedRef.current = true;
      // Start geometry and ownership on the same UI-thread clock, matching
      // quick create and avoiding a stationary blank surface after selection.
      morphPresentationOpacity.value = withTiming(1, {
        duration: ADD_HANDOFF_MOTION.ownershipCrossfadeMs,
        easing: ReanimatedEasing.linear,
      });
      morphProgress.value = withTiming(1, {
        duration: Math.round(
          MORPH_OPEN_DURATION_MS * (1 - MORPH_OPEN_START_PROGRESS),
        ),
        easing: ReanimatedEasing.bezier(...ADD_HANDOFF_MOTION.openBezier),
      });
      onMorphReadyRef.current?.();
    },
    [isMorphPresentation, morphPresentationOpacity, morphProgress],
  );

  /** 미리 렌더링된 모프 시트를 즉시 표시하고 실제로 시작할 수 있었는지 반환합니다. */
  const presentPrewarmedMorph = useCallback(() => {
    if (
      !isMorphPresentation ||
      !prewarm ||
      !rendered ||
      !morphContentMounted ||
      routePlannerHidden ||
      measuredContentHeightRef.current === null ||
      !morphSeedHasLayoutRef.current ||
      closingRef.current
    ) {
      return false;
    }

    visibleRef.current = true;
    closeCycleRef.current += 1;
    morphWasPresentedRef.current = true;
    morphClosingRef.current = false;
    morphClosingPhase.value = 0;
    morphOpenStartedRef.current = false;
    if (morphSeedPaintFrameRef.current !== null) {
      cancelAnimationFrame(morphSeedPaintFrameRef.current);
      morphSeedPaintFrameRef.current = null;
    }
    if (morphCloseFinishTimerRef.current) {
      clearTimeout(morphCloseFinishTimerRef.current);
      morphCloseFinishTimerRef.current = null;
    }
    cancelAnimation(morphProgress);
    morphProgress.value = MORPH_OPEN_START_PROGRESS;
    morphOpenCycleRef.current += 1;
    // Prewarm keeps the seed layer resident, so start on the native action
    // event instead of inserting another requestAnimationFrame boundary.
    morphPresentationOpacity.value = PREWARM_PRESENTATION_OPACITY;
    const openCycle = morphOpenCycleRef.current;
    startMorphOpenAnimation(openCycle);
    return true;
  }, [
    isMorphPresentation,
    measuredContentHeightRef,
    morphClosingPhase,
    morphContentMounted,
    morphPresentationOpacity,
    morphProgress,
    prewarm,
    rendered,
    routePlannerHidden,
    startMorphOpenAnimation,
  ]);

  useLayoutEffect(() => {
    if (!morphPresenterRef) return undefined;

    morphPresenterRef.current = presentPrewarmedMorph;
    return () => {
      if (morphPresenterRef.current === presentPrewarmedMorph) {
        morphPresenterRef.current = null;
      }
    };
  }, [morphPresenterRef, presentPrewarmedMorph]);

  /** 시드 레이아웃과 콘텐츠 측정이 끝난 다음 프레임에 모프 열기 애니메이션을 예약합니다. */
  const scheduleMorphOpenAfterPaint = useCallback(
    (openCycle: number) => {
      if (
        !visibleRef.current ||
        morphOpenStartedRef.current ||
        closingRef.current ||
        morphSeedPaintFrameRef.current !== null
      )
        return;

      const paintFrame = requestAnimationFrame(() => {
        if (morphSeedPaintFrameRef.current !== paintFrame) return;
        morphSeedPaintFrameRef.current = null;
        startMorphOpenAnimation(openCycle);
      });
      morphSeedPaintFrameRef.current = paintFrame;
    },
    [startMorphOpenAnimation],
  );

  /** 시작 버튼 시드의 유효한 레이아웃을 기록하고 준비가 끝났다면 모프 애니메이션을 예약합니다. */
  const handleMorphSeedLayout = useCallback(
    (width: number, height: number) => {
      if (!isMorphPresentation || width <= 0 || height <= 0) return;

      morphSeedHasLayoutRef.current = true;
      if (
        !visibleRef.current ||
        measuredContentHeightRef.current === null ||
        morphOpenStartedRef.current ||
        closingRef.current ||
        morphSeedPaintFrameRef.current !== null
      )
        return;

      scheduleMorphOpenAfterPaint(morphOpenCycleRef.current);
    },
    [
      isMorphPresentation,
      measuredContentHeightRef,
      scheduleMorphOpenAfterPaint,
    ],
  );

  /** 모프 콘텐츠의 실제 높이를 정수 픽셀로 저장해 목표 시트 높이 계산에 사용합니다. */
  const handleMorphContentSizeChange = useCallback(
    (_width: number, height: number) => {
      if (!isMorphPresentation || !Number.isFinite(height) || height <= 0)
        return;

      const measuredHeight = Math.ceil(height);
      if (measuredContentHeightRef.current === measuredHeight) return;

      measuredContentHeightRef.current = measuredHeight;
      setMeasuredContentHeight(measuredHeight);
    },
    [isMorphPresentation, measuredContentHeightRef, setMeasuredContentHeight],
  );

  useLayoutEffect(() => {
    if (
      !isMorphPresentation ||
      measuredContentHeight === null ||
      !visibleRef.current ||
      !morphSeedHasLayoutRef.current ||
      morphOpenStartedRef.current ||
      closingRef.current
    )
      return;

    scheduleMorphOpenAfterPaint(morphOpenCycleRef.current);
  }, [isMorphPresentation, measuredContentHeight, scheduleMorphOpenAfterPaint]);

  /** 프레젠테이션 방식에 맞춰 일반 시트 스프링 또는 모프 열기 애니메이션을 실행합니다. */
  const openSheet = useCallback(() => {
    resetCloseLifecycle();
    morphWasPresentedRef.current = true;
    setMorphSheetRasterized(isMorphPresentation);

    if (isMorphPresentation) {
      // Render the complete form before the seed reports layout. Motion
      // starts only after this expensive tree is committed, so mounting
      // cannot consume the first animation frames.
      setMorphContentMounted(true);
      cancelAnimation(morphProgress);
      morphProgress.value = MORPH_OPEN_START_PROGRESS;
      morphOpenStartedRef.current = false;
      morphOpenCycleRef.current += 1;
      morphPresentationOpacity.value = prewarm
        ? PREWARM_PRESENTATION_OPACITY
        : 1;
      if (
        morphSeedHasLayoutRef.current &&
        measuredContentHeightRef.current !== null
      ) {
        scheduleMorphOpenAfterPaint(morphOpenCycleRef.current);
      }
      return;
    }

    setMorphContentMounted(true);
    Animated.spring(posY, {
      toValue: 0,
      useNativeDriver: true,
      damping: 24,
      stiffness: 230,
      mass: 0.9,
      restDisplacementThreshold: 0.35,
      restSpeedThreshold: 0.35,
    }).start();
  }, [
    isMorphPresentation,
    measuredContentHeightRef,
    morphPresentationOpacity,
    morphProgress,
    posY,
    prewarm,
    resetCloseLifecycle,
    scheduleMorphOpenAfterPaint,
    setMorphContentMounted,
    setMorphSheetRasterized,
  ]);

  /** 시트를 닫고 현재 표시 주기가 유효한 경우에만 후속 콜백과 렌더 상태 정리를 실행합니다. */
  const closeSheet = useCallback(
    (
      after?: () => void,
      { notifyCloseStart = true }: CloseSheetOptions = {},
    ) => {
      if (closingRef.current) return;

      closingRef.current = true;
      const closeCycle = ++closeCycleRef.current;

      if (isMorphPresentation) {
        morphOpenCycleRef.current += 1;
        morphClosingRef.current = true;
        morphClosingPhase.value = 1;
        if (notifyCloseStart) onCloseStart?.();
        if (morphSeedPaintFrameRef.current !== null) {
          cancelAnimationFrame(morphSeedPaintFrameRef.current);
          morphSeedPaintFrameRef.current = null;
        }
        if (morphCloseFinishTimerRef.current) {
          clearTimeout(morphCloseFinishTimerRef.current);
          morphCloseFinishTimerRef.current = null;
        }
        const closeDuration = resolveAddHandoffCloseDuration(
          morphProgress.value,
        );
        cancelAnimation(morphProgress);
        morphProgress.value = withTiming(0, {
          duration: closeDuration,
          easing: ReanimatedEasing.bezier(...ADD_HANDOFF_MOTION.closeBezier),
        });
        morphCloseFinishTimerRef.current = setTimeout(() => {
          morphCloseFinishTimerRef.current = null;
          if (closeCycle !== closeCycleRef.current || !closingRef.current)
            return;

          closingRef.current = false;
          morphWasPresentedRef.current = false;
          setMorphContentMounted(prewarm);
          morphClosingRef.current = false;
          morphOpenStartedRef.current = false;
          morphPresentationOpacity.value = PREWARM_PRESENTATION_OPACITY;
          setMorphSheetRasterized(isMorphPresentation && prewarm);
          setRendered(prewarm);
          after?.();
        }, closeDuration + 32);
        return;
      }

      Animated.spring(posY, {
        toValue: SHEET_HIDDEN_Y,
        useNativeDriver: true,
        damping: 28,
        stiffness: 240,
        mass: 0.95,
        restDisplacementThreshold: 0.45,
        restSpeedThreshold: 0.45,
      }).start(({ finished }) => {
        if (
          !finished ||
          closeCycle !== closeCycleRef.current ||
          !closingRef.current
        )
          return;

        closingRef.current = false;
        morphWasPresentedRef.current = false;
        setRendered(prewarm);
        after?.();
      });
    },
    [
      isMorphPresentation,
      morphClosingPhase,
      morphPresentationOpacity,
      morphProgress,
      onCloseStart,
      posY,
      prewarm,
      setMorphContentMounted,
      setMorphSheetRasterized,
      setRendered,
    ],
  );

  /** 닫기 확인을 취소했을 때 일반 바텀시트를 열린 위치로 복원합니다. */
  const restoreSheetPosition = useCallback(() => {
    if (isMorphPresentation) return;
    Animated.spring(posY, {
      toValue: 0,
      useNativeDriver: true,
      damping: 24,
      stiffness: 230,
      mass: 0.9,
      restDisplacementThreshold: 0.35,
      restSpeedThreshold: 0.35,
    }).start();
  }, [isMorphPresentation, posY]);

  /** 현재 초안을 폐기한 뒤 추가 확인 없이 시트를 닫습니다. */
  const closeWithoutPrompt = useCallback(() => {
    discardDraft();
    closeSheet(onClose);
  }, [closeSheet, discardDraft, onClose]);

  /** 폼 변경 여부와 제출 상태를 검사해 즉시 닫거나 초안 폐기 확인창을 표시합니다. */
  const requestClose = useCallback(
    (restoreBeforePrompt = false) => {
      const action = getScheduleAddCloseAction({
        dirty: formDirtyRef.current,
        submitting: submitting || submitInFlightRef.current,
      });
      if (action === 'ignore') return;
      if (action === 'close') {
        closeWithoutPrompt();
        return;
      }

      if (restoreBeforePrompt) restoreSheetPosition();
      if (closePromptVisibleRef.current) return;
      closePromptVisibleRef.current = true;

      const keepEditing = () => {
        closePromptVisibleRef.current = false;
      };
      Alert.alert(
        '작성 중인 일정을 닫을까요?',
        '지금 닫으면 입력한 내용은 저장되지 않아요.',
        [
          { text: '계속 작성', style: 'cancel', onPress: keepEditing },
          { text: '작성 취소', style: 'destructive', onPress: closeWithoutPrompt },
        ],
        { cancelable: true, onDismiss: keepEditing },
      );
    },
    [
      closePromptVisibleRef,
      closeWithoutPrompt,
      formDirtyRef,
      restoreSheetPosition,
      submitInFlightRef,
      submitting,
    ],
  );

  useEffect(() => {
    if (
      Platform.OS !== 'android' ||
      !visible ||
      !rendered ||
      routePlannerHidden
    )
      return undefined;

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        requestClose();
        return true;
      },
    );
    return () => subscription.remove();
  }, [rendered, requestClose, routePlannerHidden, visible]);

  useLayoutEffect(() => {
    if (!prewarm || visible) return;

    setRendered(true);
    setMorphContentMounted(true);
    if (isMorphPresentation) {
      setMorphSheetRasterized(true);
      if (!morphWasPresentedRef.current && !morphClosingRef.current) {
        morphPresentationOpacity.value = PREWARM_PRESENTATION_OPACITY;
      }
    }
  }, [
    isMorphPresentation,
    morphPresentationOpacity,
    prewarm,
    setMorphContentMounted,
    setMorphSheetRasterized,
    setRendered,
    visible,
  ]);

  useLayoutEffect(() => {
    if (!visible) return undefined;

    // A pre-composed morph can already be running from the native action
    // callback. Let the later React visibility commit update semantics
    // without rewinding the UI-thread geometry animation.
    if (isMorphPresentation && morphOpenStartedRef.current) return undefined;

    setRendered(true);
    if (isMorphPresentation) {
      posY.setValue(0);
    } else {
      posY.setValue(SHEET_HIDDEN_Y);
    }
    openSheet();

    return () => {
      if (morphSeedPaintFrameRef.current !== null) {
        cancelAnimationFrame(morphSeedPaintFrameRef.current);
        morphSeedPaintFrameRef.current = null;
      }
    };
  }, [isMorphPresentation, visible, openSheet, posY, setRendered]);

  useEffect(() => {
    if (visible || !rendered || morphClosingRef.current) return;

    if (!morphWasPresentedRef.current) {
      if (!prewarm) {
        setRendered(false);
        setMorphContentMounted(!isMorphPresentation);
      }
      return;
    }

    closeSheet();
  }, [
    closeSheet,
    isMorphPresentation,
    prewarm,
    rendered,
    setMorphContentMounted,
    setRendered,
    visible,
  ]);

  useEffect(
    () => () => {
      closeCycleRef.current += 1;
      morphOpenCycleRef.current += 1;
      morphOpenStartedRef.current = false;
      closingRef.current = false;
      morphClosingRef.current = false;
      if (morphSeedPaintFrameRef.current !== null) {
        cancelAnimationFrame(morphSeedPaintFrameRef.current);
        morphSeedPaintFrameRef.current = null;
      }
      if (morphCloseFinishTimerRef.current) {
        clearTimeout(morphCloseFinishTimerRef.current);
        morphCloseFinishTimerRef.current = null;
      }
      posY.stopAnimation();
      cancelAnimation(morphProgress);
    },
    [morphProgress, posY],
  );
  return {
    closeWithoutPrompt,
    closeSheet,
    handleMorphContentSizeChange,
    handleMorphSeedLayout,
    morphClosingPhase,
    morphClosingRef,
    morphPresentationStyle,
    morphProgress,
    morphWasPresentedRef,
    openSheet,
    posY,
    requestClose,
    resetCloseLifecycle,
  };
}
