import { Ionicons } from "@expo/vector-icons";

import { getScheduleAlertModeLabel } from "../../scheduleAlertMode";
import {
  isQuickScheduleRouteReady as canUseRouteNotification,
  type QuickSchedulePreviewDraft as PreviewDraft,
  type QuickSchedulePreviewField as PreviewField,
} from "../../quickScheduleDraft";
import {
  FIELD_LABEL,
  LOW_RECOGNITION_CONFIDENCE,
  PHOTO_PREVIEW_STAGE_HEIGHT,
  dateFromDraftTime,
  formatKoreanDate,
  formatKoreanTime,
  formatNotification,
  formatVoiceDuration,
  resolvePhotoPreviewAspectRatio,
  toHm,
  toYmd,
  type FlowStep,
  type InputMode,
} from "./quickScheduleModalModel";

type QuickSchedulePresentationOptions = {
  cardWidth: number;
  editingField: PreviewField | null;
  flowStep: FlowStep;
  inputMode: InputMode;
  isDark: boolean;
  isPhotoRecognizing: boolean;
  isVoiceFinalizing: boolean;
  isVoiceRecording: boolean;
  photoRecognitionConfidence?: number;
  photoRecognitionError: string;
  photoTranscript: string;
  selectedPhoto?: { uri?: string; width?: number; height?: number } | null;
  submitting: boolean;
  text: string;
  voiceDurationMillis: number;
  voiceMeterHistory: number[];
  voiceStatusMessage: string;
  voiceTranscript: string;
  voiceUri: string | null;
};

/** 빠른 일정 입력·사진·음성·헤더에 필요한 표시 전용 값을 한 번에 계산한다. */
export function buildQuickSchedulePresentation({
  cardWidth,
  editingField,
  flowStep,
  inputMode,
  isDark,
  isPhotoRecognizing,
  isVoiceFinalizing,
  isVoiceRecording,
  photoRecognitionConfidence,
  photoRecognitionError,
  photoTranscript,
  selectedPhoto,
  submitting,
  text,
  voiceDurationMillis,
  voiceMeterHistory,
  voiceStatusMessage,
  voiceTranscript,
  voiceUri,
}: QuickSchedulePresentationOptions) {
  const voiceDurationText = formatVoiceDuration(voiceDurationMillis);
  const voiceSpectrumEnergy = isVoiceRecording
    ? voiceMeterHistory[voiceMeterHistory.length - 1] ?? 0
    : 0;
  const voiceControlTitle = isVoiceRecording
    ? "녹음 중"
    : isVoiceFinalizing
      ? "확인 중"
      : voiceTranscript.trim() || voiceUri
        ? "다시 말하기"
        : "말하기";
  const voiceControlMeta = isVoiceRecording
    ? voiceDurationText
    : isVoiceFinalizing
      ? "잠시만 기다려 주세요"
      : voiceTranscript.trim() || voiceUri
        ? voiceDurationText
        : voiceStatusMessage || "눌러서 시작";
  const selectedPhotoAspectRatio =
    selectedPhoto?.width && selectedPhoto.height
      ? selectedPhoto.width / selectedPhoto.height
      : 1;
  const photoPreviewAspectRatio = resolvePhotoPreviewAspectRatio(
    selectedPhotoAspectRatio,
  );
  const photoPreviewContentWidth = cardWidth - 46;
  const photoScanFrameStyle = {
    width: Math.min(
      photoPreviewContentWidth,
      PHOTO_PREVIEW_STAGE_HEIGHT * photoPreviewAspectRatio,
    ),
    height: Math.min(
      PHOTO_PREVIEW_STAGE_HEIGHT,
      photoPreviewContentWidth / photoPreviewAspectRatio,
    ),
  };
  const photoRecognitionState = isPhotoRecognizing
    ? "scanning"
    : photoRecognitionError
      ? "error"
      : photoTranscript.trim()
        ? "ready"
        : "selected";
  const photoStatusColor =
    photoRecognitionState === "scanning"
      ? "#7BE7FF"
      : photoRecognitionState === "ready"
        ? "#72E5A6"
        : photoRecognitionState === "error"
          ? "#FFD166"
          : "#FFFFFF";
  const photoStatusBackground =
    photoRecognitionState === "scanning"
      ? "rgba(10, 52, 78, 0.86)"
      : photoRecognitionState === "ready"
        ? "rgba(9, 62, 43, 0.84)"
        : photoRecognitionState === "error"
          ? "rgba(76, 50, 8, 0.86)"
          : "rgba(8, 13, 22, 0.78)";
  const photoStatusText =
    photoRecognitionState === "scanning"
      ? "일정 정보 읽는 중"
      : photoRecognitionState === "ready"
        ? "읽기 완료"
        : photoRecognitionState === "error"
          ? "내용 확인 필요"
          : "선택한 사진";
  const photoStatusAccessibilityLabel =
    photoRecognitionState === "ready"
      ? "사진 읽기 완료"
      : photoRecognitionState === "error"
        ? "일정 내용을 찾지 못했어요"
        : photoStatusText;
  const photoStatusIcon: keyof typeof Ionicons.glyphMap =
    photoRecognitionState === "ready"
      ? "checkmark-circle"
      : photoRecognitionState === "error"
        ? "alert-circle"
        : "image-outline";
  const photoNeedsReview =
    !isPhotoRecognizing &&
    photoRecognitionConfidence !== undefined &&
    photoRecognitionConfidence < LOW_RECOGNITION_CONFIDENCE;
  const canSubmit =
    (inputMode === "text"
      ? text.trim().length > 0
      : inputMode === "photo"
        ? Boolean(selectedPhoto?.uri && photoTranscript.trim())
        : Boolean(voiceTranscript.trim() || voiceUri)) &&
    !submitting &&
    !isVoiceRecording &&
    !isVoiceFinalizing &&
    (inputMode !== "photo" || !isPhotoRecognizing);
  const flowTitle =
    flowStep === "input"
      ? "빠른 일정"
      : flowStep === "analyzing"
        ? "일정 미리보기"
        : flowStep === "saving"
          ? "일정 저장 중"
          : flowStep === "analysisError"
            ? "일정 만들기 실패"
            : flowStep === "saved"
              ? "일정 저장 완료"
              : flowStep === "edit" && editingField
                ? editingField === "location"
                  ? "장소 수정"
                  : editingField === "notification"
                    ? "출발 알림"
                    : `${FIELD_LABEL[editingField]} 수정`
                : "일정 미리보기";
  const inputModeDescription =
    inputMode === "photo"
      ? "사진을 고르면 날짜와 장소를 자동으로 읽습니다."
      : inputMode === "voice"
        ? "마이크를 누르고 일정을 말해 주세요."
        : "날짜·시간·장소를 한 문장으로 입력하세요.";

  return {
    canSubmit,
    flowTitle,
    inputModeDescription,
    photoErrorBorder: isDark
      ? "rgba(255,138,132,0.30)"
      : "rgba(217,74,74,0.18)",
    photoErrorSurface: isDark
      ? "rgba(255,69,58,0.13)"
      : "rgba(239,68,68,0.065)",
    photoErrorTextColor: isDark ? "#FFB2AD" : "#9F3A36",
    photoErrorTitleColor: isDark ? "#FF8A84" : "#B42318",
    photoNeedsReview,
    photoRecognitionState,
    photoScanFrameStyle,
    photoStatusAccessibilityLabel,
    photoStatusBackground,
    photoStatusColor,
    photoStatusIcon,
    photoStatusText,
    previewChevronColor: isDark ? "#AEAEB2" : "#8E8E93",
    previewDividerColor: isDark
      ? "rgba(84,84,88,0.65)"
      : "rgba(60,60,67,0.12)",
    previewIconBackground: isDark
      ? "rgba(36,107,254,0.14)"
      : "rgba(36,107,254,0.09)",
    previewLabelColor: isDark
      ? "rgba(235,235,245,0.60)"
      : "rgba(60,60,67,0.60)",
    successColor: "#22C55E",
    voiceControlMeta,
    voiceControlTitle,
    voiceSpectrumEnergy,
    warningBackground: isDark
      ? "rgba(255,176,32,0.18)"
      : "rgba(255,176,32,0.16)",
    warningTextColor: isDark ? "#FFD27A" : "#A45B00",
  };
}

/** 미리보기 필드의 내부 값을 사용자가 읽는 날짜·시간·알림 문구로 변환한다. */
export function getQuickSchedulePreviewValue(
  draft: PreviewDraft,
  field: PreviewField,
) {
  switch (field) {
    case "date":
      return formatKoreanDate(draft.date);
    case "time": {
      if (!draft.hasExplicitEndTime) return formatKoreanTime(draft.time);
      const startAt = dateFromDraftTime(draft.date, draft.time);
      const endAt = new Date(startAt.getTime() + draft.durationMinutes * 60_000);
      const endTime = formatKoreanTime(toHm(endAt));
      return toYmd(startAt) === toYmd(endAt)
        ? `${formatKoreanTime(draft.time)} ~ ${endTime}`
        : `${formatKoreanTime(draft.time)} ~ ${formatKoreanDate(
            toYmd(endAt),
          )} ${endTime}`;
    }
    case "notification":
      if (
        !canUseRouteNotification(draft) ||
        draft.notificationLeadMinutes === undefined
      ) {
        return "없음";
      }
      return `${formatNotification(
        draft.notificationLeadMinutes,
      )} · ${getScheduleAlertModeLabel(draft.alertMode)}`;
    case "location":
      return draft.location === "장소 미정" ? "미정" : draft.location;
    case "memo":
      return draft.memo === "메모 없음" ? "없음" : draft.memo;
    default:
      return draft.title;
  }
}
