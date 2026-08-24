import { useCallback, useEffect, useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { Alert, Keyboard, type LayoutChangeEvent } from "react-native";
import {
  cancelAnimation,
  Easing as ReanimatedEasing,
  runOnJS,
  withDelay,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { ADD_HANDOFF_MOTION, resolveAddHandoffCloseDuration } from "../../addHandoffMotion";
import { buildQuickScheduleReliabilityFeedback, type QuickSchedulePreviewDraft as PreviewDraft } from "../../quickScheduleDraft";
import type { QuickScheduleReliabilityFeedback } from "../../types";
import {
  CLOSE_EASING,
  CLOSE_SURFACE_DELAY_MS,
  OPEN_DURATION_MS,
  OPEN_EASING,
  OPEN_START_PROGRESS,
  PREWARM_PRESENTATION_OPACITY,
  type FlowStep,
  type InputMode,
} from "./quickScheduleModalModel";

type QuickScheduleMorphLifecycleOptions = {
  closingPhase: SharedValue<number>;
  closingRef: MutableRefObject<boolean>;
  contentMounted: boolean;
  flowStep: FlowStep;
  hasActiveVoiceSession: boolean;
  invalidatePendingAnalysis: () => void;
  invalidatePhotoSource: () => void;
  invalidateVoiceOperations: () => void;
  isVoiceFinalizing: boolean;
  isVoiceRecording: boolean;
  morphPresenterRef?: MutableRefObject<(() => boolean) | null>;
  onClose: () => void;
  onCloseStart?: () => void;
  onFeedback?: (feedback: QuickScheduleReliabilityFeedback) => void | Promise<void>;
  onMorphReady?: () => void;
  photoTranscript: string;
  presentationOpacity: SharedValue<number>;
  prewarm: boolean;
  previewDraft: PreviewDraft | null;
  progress: SharedValue<number>;
  rendered: boolean;
  resetDraftFlow: () => void;
  resetPhotoRecognition: () => void;
  resetVoiceInput: () => void;
  routePlannerHidden: boolean;
  selectedPhotoUri?: string;
  setCardRasterized: Dispatch<SetStateAction<boolean>>;
  setContentMounted: Dispatch<SetStateAction<boolean>>;
  setInputMode: Dispatch<SetStateAction<InputMode>>;
  setPreviewCategoryPickerOpen: Dispatch<SetStateAction<boolean>>;
  setRendered: Dispatch<SetStateAction<boolean>>;
  setSelectedCategoryId: Dispatch<SetStateAction<string>>;
  setSubmitting: Dispatch<SetStateAction<boolean>>;
  setText: Dispatch<SetStateAction<string>>;
  stopActiveRecording: (preserveRecording?: boolean) => Promise<string | null>;
  submitting: boolean;
  text: string;
  visible: boolean;
  visibleRef: MutableRefObject<boolean>;
  voiceDurationMillis: number;
  voiceTranscript: string;
  voiceUri: string | null;
};

/** 모달의 사전 렌더링, 열기·닫기 모프와 작성 내용 폐기 확인 수명 주기를 관리한다. */
export function useQuickScheduleMorphLifecycle({
  closingPhase,
  closingRef,
  contentMounted,
  flowStep,
  hasActiveVoiceSession,
  invalidatePendingAnalysis,
  invalidatePhotoSource,
  invalidateVoiceOperations,
  isVoiceFinalizing,
  isVoiceRecording,
  morphPresenterRef,
  onClose,
  onCloseStart,
  onFeedback,
  onMorphReady,
  photoTranscript,
  presentationOpacity,
  prewarm,
  previewDraft,
  progress,
  rendered,
  resetDraftFlow,
  resetPhotoRecognition,
  resetVoiceInput,
  routePlannerHidden,
  selectedPhotoUri,
  setCardRasterized,
  setContentMounted,
  setInputMode,
  setPreviewCategoryPickerOpen,
  setRendered,
  setSelectedCategoryId,
  setSubmitting,
  setText,
  stopActiveRecording,
  submitting,
  text,
  visible,
  visibleRef,
  voiceDurationMillis,
  voiceTranscript,
  voiceUri,
}: QuickScheduleMorphLifecycleOptions) {
  const openHandoffFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const seedHasLayoutRef = useRef(false);
  const openStartedRef = useRef(false);
  const openCycleRef = useRef(0);
  const closeFinishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeFinishedRef = useRef(false);
  const discardConfirmationVisibleRef = useRef(false);

  if (visible || (!openStartedRef.current && openHandoffFrameRef.current === null)) {
    visibleRef.current = visible;
  }

  /** 닫기 애니메이션이 끝난 뒤 모든 입력·초안·표시 상태를 초기화하고 부모에게 완료를 알린다. */
  const finishClose = useCallback((shouldNotifyClose: boolean) => {
    if (closeFinishedRef.current) return;
    closeFinishedRef.current = true;
    invalidateVoiceOperations(); invalidatePhotoSource();
    if (closeFinishTimerRef.current) { clearTimeout(closeFinishTimerRef.current); closeFinishTimerRef.current = null; }
    setRendered(prewarm); setText(""); setInputMode("text"); resetPhotoRecognition(); resetVoiceInput();
    setSubmitting(false); setCardRasterized(false); setContentMounted(prewarm); resetDraftFlow();
    setSelectedCategoryId(""); setPreviewCategoryPickerOpen(false);
    discardConfirmationVisibleRef.current = false; openStartedRef.current = false;
    presentationOpacity.value = PREWARM_PRESENTATION_OPACITY; closingRef.current = false;
    if (shouldNotifyClose) onClose();
  }, [closingRef, invalidatePhotoSource, invalidateVoiceOperations, onClose, presentationOpacity, prewarm, resetDraftFlow, resetPhotoRecognition, resetVoiceInput, setCardRasterized, setContentMounted, setInputMode, setPreviewCategoryPickerOpen, setRendered, setSelectedCategoryId, setSubmitting, setText]);

  /** 현재 모프 진행률에 맞는 닫기 시간을 계산해 원본 버튼 위치로 되돌린다. */
  const runCloseAnimation = useCallback((shouldNotifyClose = false) => {
    Keyboard.dismiss(); invalidateVoiceOperations(); invalidatePhotoSource();
    if (hasActiveVoiceSession) stopActiveRecording().catch(() => undefined);
    if (openHandoffFrameRef.current !== null) { cancelAnimationFrame(openHandoffFrameRef.current); openHandoffFrameRef.current = null; }
    if (closeFinishTimerRef.current) { clearTimeout(closeFinishTimerRef.current); closeFinishTimerRef.current = null; }
    closeFinishedRef.current = false; closingPhase.value = 1;
    const duration = resolveAddHandoffCloseDuration(progress.value);
    cancelAnimation(progress);
    progress.value = withDelay(CLOSE_SURFACE_DELAY_MS, withTiming(0, { duration, easing: CLOSE_EASING }, finished => {
      if (finished) runOnJS(finishClose)(shouldNotifyClose);
    }));
    closeFinishTimerRef.current = setTimeout(() => finishClose(shouldNotifyClose), CLOSE_SURFACE_DELAY_MS + duration + 48);
  }, [closingPhase, finishClose, hasActiveVoiceSession, invalidatePhotoSource, invalidateVoiceOperations, progress, stopActiveRecording]);

  /** 분석 취소 피드백을 기록하고 확인 없이 모달 닫기를 시작한다. */
  const closeQuickSchedule = useCallback(() => {
    if ((submitting && flowStep !== "analyzing") || closingRef.current) return;
    if (flowStep === "analyzing") { invalidatePendingAnalysis(); setSubmitting(false); }
    const feedback = (flowStep === "preview" || flowStep === "edit") && previewDraft
      ? buildQuickScheduleReliabilityFeedback(previewDraft, "CANCELLED") : null;
    if (feedback) Promise.resolve(onFeedback?.(feedback)).catch(() => undefined);
    closingRef.current = true; onCloseStart?.(); runCloseAnimation(true);
  }, [closingRef, flowStep, invalidatePendingAnalysis, onCloseStart, onFeedback, previewDraft, runCloseAnimation, setSubmitting, submitting]);

  /** 작성 내용이 있으면 폐기 확인을 거친 뒤 닫기 동작을 실행한다. */
  const requestClose = useCallback(() => {
    if ((submitting && flowStep !== "analyzing") || closingRef.current) return;
    const hasDirtyDraft = Boolean(previewDraft || text.trim() || selectedPhotoUri || photoTranscript.trim() || voiceUri || voiceTranscript.trim() || isVoiceRecording || isVoiceFinalizing || voiceDurationMillis > 0);
    if (flowStep === "saved" || !hasDirtyDraft) { closeQuickSchedule(); return; }
    if (discardConfirmationVisibleRef.current) return;
    discardConfirmationVisibleRef.current = true;
    Alert.alert("작성 중인 일정이 있어요", "지금 닫으면 입력한 내용은 저장되지 않아요.", [
      { text: "계속 작성", style: "cancel", onPress: () => { discardConfirmationVisibleRef.current = false; } },
      { text: "작성 취소", style: "destructive", onPress: () => { discardConfirmationVisibleRef.current = false; closeQuickSchedule(); } },
    ], { cancelable: true, onDismiss: () => { discardConfirmationVisibleRef.current = false; } });
  }, [closeQuickSchedule, closingRef, flowStep, isVoiceFinalizing, isVoiceRecording, photoTranscript, previewDraft, selectedPhotoUri, submitting, text, voiceDurationMillis, voiceTranscript, voiceUri]);

  /** 현재 열기 세대가 유효할 때 카드와 소유권 전환 애니메이션을 같은 프레임에 시작한다. */
  const startOpenAnimation = useCallback((openCycle: number) => {
    if (!visibleRef.current || openCycle !== openCycleRef.current || openStartedRef.current || closingRef.current) return;
    openStartedRef.current = true;
    presentationOpacity.value = withTiming(1, { duration: ADD_HANDOFF_MOTION.ownershipCrossfadeMs, easing: ReanimatedEasing.linear });
    progress.value = withTiming(1, { duration: Math.round(OPEN_DURATION_MS * (1 - OPEN_START_PROGRESS)), easing: OPEN_EASING });
    onMorphReady?.();
  }, [closingRef, onMorphReady, presentationOpacity, progress, visibleRef]);

  /** 미리 렌더링된 카드가 준비된 경우 React 재마운트 없이 즉시 모프를 시작한다. */
  const presentPrewarmedMorph = useCallback(() => {
    if (!prewarm || !rendered || !contentMounted || routePlannerHidden || !seedHasLayoutRef.current || closingRef.current) return false;
    closeFinishedRef.current = false; visibleRef.current = true; closingRef.current = false; closingPhase.value = 0;
    cancelAnimation(progress); progress.value = OPEN_START_PROGRESS; openStartedRef.current = false; openCycleRef.current += 1;
    presentationOpacity.value = PREWARM_PRESENTATION_OPACITY;
    startOpenAnimation(openCycleRef.current); return true;
  }, [closingPhase, closingRef, contentMounted, presentationOpacity, prewarm, progress, rendered, routePlannerHidden, startOpenAnimation, visibleRef]);

  useLayoutEffect(() => {
    if (!morphPresenterRef) return undefined;
    morphPresenterRef.current = presentPrewarmedMorph;
    return () => { if (morphPresenterRef.current === presentPrewarmedMorph) morphPresenterRef.current = null; };
  }, [morphPresenterRef, presentPrewarmedMorph]);

  /** 첫 레이아웃 페인트 다음 프레임에 열기 모프를 예약한다. */
  const scheduleOpenAfterPaint = useCallback((openCycle: number) => {
    if (!visibleRef.current || openStartedRef.current || closingRef.current || openHandoffFrameRef.current !== null) return;
    const frame = requestAnimationFrame(() => {
      if (openHandoffFrameRef.current !== frame) return;
      openHandoffFrameRef.current = null; startOpenAnimation(openCycle);
    });
    openHandoffFrameRef.current = frame;
  }, [closingRef, startOpenAnimation, visibleRef]);

  /** 카드 시드의 유효한 레이아웃을 확인한 뒤 열기 모프 예약을 시작한다. */
  const handleSeedLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    seedHasLayoutRef.current = true;
    if (!visibleRef.current || openStartedRef.current || closingRef.current || openHandoffFrameRef.current !== null) return;
    scheduleOpenAfterPaint(openCycleRef.current);
  }, [closingRef, scheduleOpenAfterPaint, visibleRef]);

  useLayoutEffect(() => {
    if (!prewarm || visible) return;
    setRendered(true); setContentMounted(true); setCardRasterized(true);
    if (!openStartedRef.current && !closingRef.current) presentationOpacity.value = PREWARM_PRESENTATION_OPACITY;
  }, [closingRef, presentationOpacity, prewarm, setCardRasterized, setContentMounted, setRendered, visible]);

  useLayoutEffect(() => {
    if (!visible || openStartedRef.current) return undefined;
    closingRef.current = false; closeFinishedRef.current = false; openStartedRef.current = false;
    setCardRasterized(true); openCycleRef.current += 1;
    if (closeFinishTimerRef.current) { clearTimeout(closeFinishTimerRef.current); closeFinishTimerRef.current = null; }
    setRendered(true); setContentMounted(true); cancelAnimation(progress); closingPhase.value = 0;
    progress.value = OPEN_START_PROGRESS; presentationOpacity.value = prewarm ? PREWARM_PRESENTATION_OPACITY : 1;
    if (openHandoffFrameRef.current !== null) { cancelAnimationFrame(openHandoffFrameRef.current); openHandoffFrameRef.current = null; }
    if (seedHasLayoutRef.current) scheduleOpenAfterPaint(openCycleRef.current);
    return () => {
      if (openHandoffFrameRef.current !== null) { cancelAnimationFrame(openHandoffFrameRef.current); openHandoffFrameRef.current = null; }
      if (closeFinishTimerRef.current) { clearTimeout(closeFinishTimerRef.current); closeFinishTimerRef.current = null; }
    };
  }, [closingPhase, closingRef, presentationOpacity, prewarm, progress, scheduleOpenAfterPaint, setCardRasterized, setContentMounted, setRendered, visible]);

  useEffect(() => {
    if (visible || !rendered || closingRef.current) return;
    if (!openStartedRef.current) {
      if (!prewarm) { setRendered(false); setContentMounted(false); }
      return;
    }
    closingRef.current = true; onCloseStart?.(); runCloseAnimation(true);
  }, [closingRef, onCloseStart, prewarm, rendered, runCloseAnimation, setContentMounted, setRendered, visible]);

  useEffect(() => {
    if (visible) return;
    invalidateVoiceOperations(); invalidatePhotoSource();
  }, [invalidatePhotoSource, invalidateVoiceOperations, visible]);

  useEffect(() => () => {
    invalidatePendingAnalysis(); invalidatePhotoSource(); stopActiveRecording().catch(() => undefined);
    if (closeFinishTimerRef.current) clearTimeout(closeFinishTimerRef.current);
  }, [invalidatePendingAnalysis, invalidatePhotoSource, stopActiveRecording]);

  return {
    handleSeedLayout,
    isPrewarmOnly: prewarm && !visible && !openStartedRef.current && !closingRef.current,
    requestClose,
  };
}
