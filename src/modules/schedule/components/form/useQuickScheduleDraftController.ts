import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { Alert, Keyboard } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { cancelAnimation, type SharedValue } from "react-native-reanimated";
import type { ImagePickerAsset } from "expo-image-picker";

import { canWriteScheduleCategory } from "../../categoryPermissions";
import { isSameScheduleDraftRoute } from "../../routeInfo";
import { refreshOdsayScheduleTiming } from "../../refreshOdsayScheduleTiming";
import { consumeRoutePlannerResult, observeRoutePlannerReturn, setRoutePlannerInitial } from "../../routePlannerSession";
import type { ScheduleRouteDraftChange } from "./ScheduleRouteDraftNotice";
import {
  applyQuickScheduleNotificationSettings,
  applyQuickScheduleRouteResult as applyRouteResultToPreviewDraft,
  buildQuickSchedulePayload,
  buildQuickScheduleReliabilityFeedback,
  buildQuickSchedulePreviewDraft as buildPreviewDraft,
  getQuickScheduleBlockingReviewField,
  getQuickSchedulePreviewRouteInfo,
  hasQuickScheduleLocationChanged,
  isQuickScheduleRouteReady,
  quickSchedulePlaceFromLocation as placeFromDraftLocation,
  updateQuickSchedulePreviewDraft,
  type QuickSchedulePreviewDraft as PreviewDraft,
  type QuickSchedulePreviewField as PreviewField,
} from "../../quickScheduleDraft";
import type {
  QuickScheduleReliabilityFeedback,
  ScheduleAlertMode,
  ScheduleCategory,
  ScheduleItem,
  ScheduleParseResult,
} from "../../types";
import type { QuickScheduleMediaInput } from "../../quickInputExtraction";
import {
  QUICK_TEXT_LIMIT,
  dateFromDraftTime,
  normalizeTimeInput,
  type FlowStep,
  type InputMode,
  type TimeEditMode,
} from "./quickScheduleModalModel";

type QuickScheduleDraftControllerOptions = {
  categoryError?: string | null;
  clearPhotoRecognition: () => void;
  closingRef: MutableRefObject<boolean>;
  defaultDay: string;
  initialInputType?: QuickScheduleMediaInput["inputTypeOverride"];
  initialPreviewField?: PreviewField;
  initialRequestId?: string;
  initialText?: string;
  inlineSaveErrors: boolean;
  inputMode: InputMode;
  isPhotoRecognizing: boolean;
  isVoiceRecording: boolean;
  onAnalyze: (text: string, media?: QuickScheduleMediaInput) => Promise<ScheduleParseResult>;
  onFeedback?: (feedback: QuickScheduleReliabilityFeedback) => void | Promise<void>;
  onSave: (payload: Omit<ScheduleItem, "id">) => void | Promise<void>;
  photoRecognitionConfidence?: number;
  photoTranscript: string;
  presentationOpacity: SharedValue<number>;
  progress: SharedValue<number>;
  resetVoiceInput: () => void;
  selectedCategory?: ScheduleCategory;
  selectedPhoto: ImagePickerAsset | null;
  setContentMounted: Dispatch<SetStateAction<boolean>>;
  setInputMode: Dispatch<SetStateAction<InputMode>>;
  setRendered: Dispatch<SetStateAction<boolean>>;
  setSubmitting: Dispatch<SetStateAction<boolean>>;
  setText: Dispatch<SetStateAction<string>>;
  submitting: boolean;
  text: string;
  visible: boolean;
  visibleRef: MutableRefObject<boolean>;
  voiceDurationMillis: number;
  voiceRecognitionAlternatives: QuickScheduleMediaInput["voiceAlternatives"];
  voiceRecognitionConfidence?: number;
  voiceTranscript: string;
  voiceUri: string | null;
};

/** 일정 분석, 미리보기 편집, 경로 선택 왕복과 최종 저장 흐름을 관리한다. */
export function useQuickScheduleDraftController({
  categoryError,
  clearPhotoRecognition,
  closingRef,
  defaultDay,
  initialInputType,
  initialPreviewField,
  initialRequestId,
  initialText,
  inlineSaveErrors,
  inputMode,
  isPhotoRecognizing,
  isVoiceRecording,
  onAnalyze,
  onFeedback,
  onSave,
  photoRecognitionConfidence,
  photoTranscript,
  presentationOpacity,
  progress,
  resetVoiceInput,
  selectedCategory,
  selectedPhoto,
  setContentMounted,
  setInputMode,
  setRendered,
  setSubmitting,
  setText,
  submitting,
  text,
  visible,
  visibleRef,
  voiceDurationMillis,
  voiceRecognitionAlternatives,
  voiceRecognitionConfidence,
  voiceTranscript,
  voiceUri,
}: QuickScheduleDraftControllerOptions) {
  const router = useRouter();
  const pathname = usePathname();
  const [flowStep, setFlowStep] = useState<FlowStep>("input");
  const [previewDraft, setPreviewDraft] = useState<PreviewDraft | null>(null);
  const [previewSourceText, setPreviewSourceText] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const [editingField, setEditingField] = useState<PreviewField | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editingAlertMode, setEditingAlertMode] = useState<ScheduleAlertMode>("STANDARD");
  const [timeEditMode, setTimeEditMode] = useState<TimeEditMode>("picker");
  const [routePlannerSessionId, setRoutePlannerSessionId] = useState<string>();
  const [routePlannerHidden, setRoutePlannerHidden] = useState(false);
  const [routeDraftChange, setRouteDraftChange] = useState<ScheduleRouteDraftChange | { kind: "destinationChanged"; revision: number; hadAlert: boolean }>();
  const routePlannerAwayRef = useRef(false);
  const routePlannerReturnFieldRef = useRef<PreviewField | null>(null);
  const routePlannerReturnValueRef = useRef("");
  const initialRequestHandledRef = useRef<string | null>(null);
  const initialPreviewFieldHandledRef = useRef<string | null>(null);
  const analysisSequenceRef = useRef(0);
  const analysisInFlightRef = useRef(false);
  const saveInFlightRef = useRef(false);

  /** 진행 중 분석을 무효화한다. */
  const invalidatePendingAnalysis = useCallback(() => {
    analysisSequenceRef.current += 1;
    analysisInFlightRef.current = false;
  }, []);

  /** 모달이 닫힐 때 초안·편집·경로 왕복 상태를 최초 값으로 되돌린다. */
  const resetDraftFlow = useCallback(() => {
    setFlowStep("input"); setPreviewDraft(null); setPreviewSourceText("");
    setSaveFailed(false);
    setEditingField(null); setEditingValue(""); setEditingAlertMode("STANDARD"); setTimeEditMode("picker");
    setRoutePlannerSessionId(undefined); setRoutePlannerHidden(false);
    setRouteDraftChange(undefined);
    saveInFlightRef.current = false; invalidatePendingAnalysis();
    routePlannerAwayRef.current = false; routePlannerReturnFieldRef.current = null;
    routePlannerReturnValueRef.current = "";
  }, [invalidatePendingAnalysis]);

  /** 현재 입력 매체를 분석 API에 전달하고 최신 요청 결과를 미리보기 초안으로 변환한다. */
  const startAnalysis = useCallback(async (textOverride?: string, inputTypeOverride?: QuickScheduleMediaInput["inputTypeOverride"]) => {
    const enteredText = textOverride ?? text;
    const normalized = enteredText.trim();
    const analysisInputMode: InputMode = inputTypeOverride ? "text" : inputMode;
    const hasInput = analysisInputMode === "text" ? normalized.length > 0 : analysisInputMode === "photo" ? Boolean(selectedPhoto?.uri && photoTranscript.trim()) : Boolean(voiceTranscript.trim() || voiceUri);
    if (!hasInput || submitting || analysisInFlightRef.current || isVoiceRecording || (analysisInputMode === "photo" && isPhotoRecognizing)) return;
    const fallback = analysisInputMode === "photo" ? "사진으로 입력한 일정" : analysisInputMode === "voice" ? "음성으로 입력한 일정" : "";
    const transcript = analysisInputMode === "voice" ? voiceTranscript : analysisInputMode === "photo" ? photoTranscript : "";
    const rawSource = transcript.trim() ? transcript : normalized ? enteredText : fallback;
    const sourceText = rawSource.trim().slice(0, QUICK_TEXT_LIMIT);
    const sequence = analysisSequenceRef.current + 1;
    analysisSequenceRef.current = sequence; analysisInFlightRef.current = true;
    Keyboard.dismiss();
    try {
      setPreviewSourceText(rawSource.slice(0, QUICK_TEXT_LIMIT));
      setSaveFailed(false);
      setSubmitting(true); setFlowStep("analyzing");
      const parsed = await onAnalyze(sourceText, {
        inputMode: analysisInputMode,
        inputTypeOverride,
        photoUri: analysisInputMode === "photo" ? selectedPhoto?.uri : undefined,
        photoTranscript: analysisInputMode === "photo" ? sourceText || undefined : undefined,
        voiceUri: analysisInputMode === "voice" ? voiceUri ?? undefined : undefined,
        voiceDurationMillis: analysisInputMode === "voice" ? voiceDurationMillis : undefined,
        voiceTranscript: analysisInputMode === "voice" ? sourceText || undefined : undefined,
        voiceAlternatives: analysisInputMode === "voice" ? voiceRecognitionAlternatives : undefined,
        recognitionConfidence: analysisInputMode === "voice" ? voiceRecognitionConfidence : analysisInputMode === "photo" ? photoRecognitionConfidence : undefined,
      });
      if (analysisSequenceRef.current !== sequence || !visibleRef.current) return;
      setRouteDraftChange(undefined);
      setPreviewDraft(buildPreviewDraft(parsed, sourceText, defaultDay));
      setFlowStep("preview"); setSubmitting(false); analysisInFlightRef.current = false;
    } catch {
      if (analysisSequenceRef.current !== sequence || !visibleRef.current) return;
      setFlowStep("analysisError"); setSubmitting(false); analysisInFlightRef.current = false;
    }
  }, [defaultDay, inputMode, isPhotoRecognizing, isVoiceRecording, onAnalyze, photoRecognitionConfidence, photoTranscript, selectedPhoto?.uri, setSubmitting, submitting, text, visibleRef, voiceDurationMillis, voiceRecognitionAlternatives, voiceRecognitionConfidence, voiceTranscript, voiceUri]);

  /** 현재 입력으로 분석을 시작한다. */
  const submit = useCallback(() => { startAnalysis().catch(() => undefined); }, [startAnalysis]);

  useEffect(() => {
    const requestId = initialRequestId?.trim();
    const seedText = initialText?.trim();
    if (!visible || !requestId || !seedText || initialRequestHandledRef.current === requestId) return;
    const bounded = seedText.slice(0, QUICK_TEXT_LIMIT);
    initialRequestHandledRef.current = requestId;
    setInputMode("text"); setText(bounded); clearPhotoRecognition(); resetVoiceInput(); setFlowStep("input");
    startAnalysis(bounded, initialInputType).catch(() => undefined);
  }, [clearPhotoRecognition, initialInputType, initialRequestId, initialText, resetVoiceInput, setInputMode, setText, startAnalysis, visible]);

  /** 한 미리보기 필드를 초안 갱신 규칙에 따라 변경한다. */
  const updatePreviewField = useCallback((field: PreviewField, value: string) => {
    setPreviewDraft(current => current ? updateQuickSchedulePreviewDraft(current, field, value) : current);
  }, []);

  /** 선택 필드의 현재 값을 편집 버퍼에 담고 편집 단계로 전환한다. */
  const openEditField = useCallback((field: PreviewField) => {
    if (!previewDraft || submitting) return;
    setEditingField(field);
    if (field === "notification") {
      setEditingValue(String(previewDraft.notificationLeadMinutes ?? "none"));
    } else {
      const value = field === "memo" && previewDraft.memo === "메모 없음" ? "" : previewDraft[field];
      setEditingValue(value ?? "");
    }
    setEditingAlertMode(previewDraft.alertMode); setTimeEditMode("picker"); setFlowStep("edit");
  }, [previewDraft, submitting]);

  useEffect(() => {
    if (!visible || !initialPreviewField || flowStep !== "preview" || !previewDraft) return;
    const key = `${initialRequestId ?? "preview"}:${initialPreviewField}`;
    if (initialPreviewFieldHandledRef.current === key) return;
    initialPreviewFieldHandledRef.current = key; openEditField(initialPreviewField);
  }, [flowStep, initialPreviewField, initialRequestId, openEditField, previewDraft, visible]);

  /** 편집 버퍼를 필드 규칙에 맞게 정규화해 초안에 반영하고 미리보기로 돌아간다. */
  const confirmEditField = useCallback(() => {
    if (!editingField) return;
    if (editingField === "notification") {
      const leadMinutes = editingValue === "none" ? undefined : Number(editingValue);
      setPreviewDraft(current => current ? applyQuickScheduleNotificationSettings(current, { leadMinutes, alertMode: editingAlertMode }) : current);
    } else {
      const nextValue = editingField === "time" ? normalizeTimeInput(editingValue, previewDraft?.time ?? "09:00") : editingValue.trim() || (editingField === "location" ? "장소 미정" : editingField === "title" ? "새 일정" : editingField === "memo" ? "메모 없음" : "");
      if (editingField === "location" && previewDraft && isQuickScheduleRouteReady(previewDraft) &&
        hasQuickScheduleLocationChanged(previewDraft.location, nextValue)) {
        const hadAlert = previewDraft?.notificationLeadMinutes !== undefined;
        setRouteDraftChange(previous => ({ kind: "destinationChanged", revision: (previous?.revision ?? 0) + 1, hadAlert }));
      }
      updatePreviewField(editingField, nextValue);
    }
    setEditingField(null); setEditingValue(""); setEditingAlertMode("STANDARD"); setTimeEditMode("picker"); setFlowStep("preview");
  }, [editingAlertMode, editingField, editingValue, previewDraft, updatePreviewField]);

  /** 변경을 버리고 편집 버퍼를 비운 뒤 미리보기로 돌아간다. */
  const cancelEditField = useCallback(() => {
    setEditingField(null); setEditingValue(""); setEditingAlertMode("STANDARD"); setTimeEditMode("picker"); setFlowStep("preview");
  }, []);

  /** 현재 초안을 세션에 저장하고 경로 선택 화면으로 이동한다. */
  const openRoutePlannerFromPreview = useCallback(() => {
    if (!previewDraft || submitting) return;
    const routeDraft = editingField === "location"
      ? updateQuickSchedulePreviewDraft(previewDraft, "location", editingValue)
      : previewDraft;
    const destination = routeDraft.destination ?? placeFromDraftLocation(routeDraft.location);
    const sessionId = `quick-route-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    routePlannerAwayRef.current = false;
    setRoutePlannerInitial(sessionId, {
      returnToScheduleDraft: true,
      origin: routeDraft.origin, destination,
      travelMode: routeDraft.travelMode ?? routeDraft.parsed?.travelMode ?? "TRANSIT",
      travelMinutes: routeDraft.travelMinutes ?? routeDraft.parsed?.travelMinutes,
      locationName: destination?.name || destination?.address || undefined,
      targetArrivalAt: dateFromDraftTime(routeDraft.date, routeDraft.time).toISOString(),
      departureAt: routeDraft.departAt, route: routeDraft.route ?? routeDraft.parsed?.route,
    });
    Keyboard.dismiss(); setRoutePlannerSessionId(sessionId); setRoutePlannerHidden(true);
    routePlannerReturnFieldRef.current = editingField;
    routePlannerReturnValueRef.current = editingValue;
    setEditingField(null); setEditingValue(""); setTimeEditMode("picker"); setFlowStep("preview"); setRendered(false);
    try {
      router.push({
        pathname: "/schedule/route-select",
        params: editingField === "location" ? { sessionId, entrySource: "quick-schedule-location" } : { sessionId },
      });
    }
    catch {
      setRoutePlannerSessionId(undefined); setRoutePlannerHidden(false); setRendered(true); setContentMounted(true);
      cancelAnimation(presentationOpacity); presentationOpacity.value = 1; progress.value = 1;
      const returnField = routePlannerReturnFieldRef.current;
      setEditingField(returnField);
      setEditingValue(routePlannerReturnValueRef.current);
      setFlowStep(returnField ? "edit" : "preview"); routePlannerReturnFieldRef.current = null;
    }
  }, [editingField, editingValue, presentationOpacity, previewDraft, progress, router, setContentMounted, setRendered, submitting]);

  useEffect(() => {
    if (!visible || !routePlannerSessionId) return;
    const observation = observeRoutePlannerReturn(pathname, routePlannerAwayRef.current);
    routePlannerAwayRef.current = observation.hasVisitedRouteFlow;
    if (!observation.shouldConsumeResult) return;
    const result = consumeRoutePlannerResult(routePlannerSessionId);
    const returnField = routePlannerReturnFieldRef.current;
    routePlannerAwayRef.current = false; setRoutePlannerSessionId(undefined); setRoutePlannerHidden(false);
    setRendered(true); setContentMounted(true); closingRef.current = false; cancelAnimation(progress); progress.value = 1;
    cancelAnimation(presentationOpacity); presentationOpacity.value = 1;
    setEditingField(null); setEditingValue(""); setTimeEditMode("picker"); setFlowStep("preview");
    if (result && previewDraft) {
      const nextDraft = applyRouteResultToPreviewDraft(previewDraft, result, returnField === "location"
        ? { editedLocation: routePlannerReturnValueRef.current }
        : undefined);
      const sameRoute = previewDraft.travelMode === nextDraft.travelMode &&
        isSameScheduleDraftRoute(getQuickSchedulePreviewRouteInfo(previewDraft), getQuickSchedulePreviewRouteInfo(nextDraft));
      setPreviewDraft(nextDraft);
      if (!sameRoute) setRouteDraftChange(previous => ({ kind: "applied", revision: (previous?.revision ?? 0) + 1 }));
      if (returnField === "notification") { setEditingField("notification"); setEditingValue(routePlannerReturnValueRef.current); setFlowStep("edit"); }
    } else if (returnField && previewDraft) {
      setEditingField(returnField);
      setEditingValue(routePlannerReturnValueRef.current); setFlowStep("edit");
    }
    routePlannerReturnFieldRef.current = null;
    routePlannerReturnValueRef.current = "";
  }, [closingRef, pathname, presentationOpacity, previewDraft, progress, routePlannerSessionId, setContentMounted, setRendered, visible]);

  /** 검토와 카테고리를 확인한 뒤 초안을 일정으로 저장하고 신뢰도 피드백을 전송한다. */
  const savePreview = useCallback(async () => {
    if (!previewDraft || submitting || saveInFlightRef.current) return;
    if (!selectedCategory || !canWriteScheduleCategory(selectedCategory)) {
      Alert.alert("카테고리가 필요해요", categoryError ? "카테고리를 다시 불러온 뒤 일정을 저장해 주세요." : "카테고리를 만든 뒤 일정을 저장해 주세요."); return;
    }
    const blocking = getQuickScheduleBlockingReviewField(previewDraft);
    if (blocking) { if (blocking !== "review") openEditField(blocking); return; }
    try {
      setSaveFailed(false);
      saveInFlightRef.current = true; setSubmitting(true); setFlowStep("saving");
      const payload = buildQuickSchedulePayload(previewDraft, selectedCategory);
      if (previewDraft.routeTimingPreviousArrivalAt && payload.travelMode === "TRANSIT") {
        const timing = await refreshOdsayScheduleTiming({
          route: payload.route, departAt: payload.departAt, travelMinutes: payload.travelMinutes,
          plannedArrivalAt: previewDraft.routeTimingPreviousArrivalAt, nextArrivalAt: payload.startAt,
          origin: payload.origin, destination: payload.destination,
        });
        await onSave({ ...payload, ...timing });
      } else {
        await onSave(payload);
      }
      const feedback = buildQuickScheduleReliabilityFeedback(previewDraft, "SAVED");
      if (feedback) Promise.resolve().then(() => onFeedback?.(feedback)).catch(() => undefined);
      setFlowStep("saved");
    } catch (error) {
      if (inlineSaveErrors) setSaveFailed(true);
      else Alert.alert("일정 저장 실패", error instanceof Error ? error.message : "일정을 저장하지 못했습니다.");
      setFlowStep("preview");
    } finally { saveInFlightRef.current = false; setSubmitting(false); }
  }, [categoryError, inlineSaveErrors, onFeedback, onSave, openEditField, previewDraft, selectedCategory, setSubmitting, submitting]);

  useEffect(() => invalidatePendingAnalysis, [invalidatePendingAnalysis]);

  return {
    cancelEditField,
    confirmEditField,
    editingAlertMode,
    editingField,
    editingValue,
    flowStep,
    invalidatePendingAnalysis,
    openEditField,
    openRoutePlannerFromPreview,
    previewDraft,
    previewSourceText,
    resetDraftFlow,
    routePlannerHidden,
    routeDraftChange,
    saveFailed,
    savePreview,
    setEditingAlertMode,
    setEditingValue,
    setFlowStep,
    setPreviewDraft,
    setTimeEditMode,
    submit,
    timeEditMode,
  };
}
