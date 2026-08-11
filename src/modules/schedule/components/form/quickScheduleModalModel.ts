import { Ionicons } from "@expo/vector-icons";
import { AppState, InteractionManager, Platform } from "react-native";
import { Easing as ReanimatedEasing } from "react-native-reanimated";

import { ADD_HANDOFF_MOTION } from "../../addHandoffMotion";
import type { LiveSpeechRecognitionAlternative } from "../../liveSpeechRecognition";
import type { QuickSchedulePreviewField as PreviewField } from "../../quickScheduleDraft";

export type InputMode = "text" | "photo" | "voice";
export type FlowStep =
  | "input"
  | "analyzing"
  | "analysisError"
  | "preview"
  | "edit"
  | "saving"
  | "saved";
export type TimeEditMode = "picker" | "manual";
export type TabLayout = { x: number; width: number };
export type LiveSpeechCaptureStartMode = "fresh" | "rollover";

export const QUICK_TEXT_LIMIT = 300;
export const PHOTO_RECOGNITION_TIMEOUT_MILLIS = 15_000;
export const PHOTO_PREVIEW_STAGE_HEIGHT = 164;
const PHOTO_PREVIEW_MIN_ASPECT_RATIO = 0.55;
const PHOTO_PREVIEW_MAX_ASPECT_RATIO = 2.2;
export const BLUE = "#246BFE";
export const OPEN_START_PROGRESS = 0;
export const PREWARM_PRESENTATION_OPACITY = 0.001;
export const OPEN_DURATION_MS = ADD_HANDOFF_MOTION.quickOpenMs;
export const CLOSE_SURFACE_DELAY_MS = 0;
export const CLOSE_TARGET_WIDTH = 150;
export const CLOSE_TARGET_HEIGHT = 44;
export const EXPANDED_CARD_RADIUS = 26;
export const OPEN_EASING = ReanimatedEasing.bezier(
  ...ADD_HANDOFF_MOTION.openBezier,
);
export const CLOSE_EASING = ReanimatedEasing.bezier(
  ...ADD_HANDOFF_MOTION.closeBezier,
);
export const MODE_PILL_SPRING = {
  damping: 18,
  stiffness: 150,
  mass: 0.82,
  overshootClamping: false,
};
export const CARD_SIZE_SPRING = {
  damping: 24,
  stiffness: 190,
  mass: 0.88,
  overshootClamping: true,
};
export const CARD_HEIGHT_BY_MODE: Record<InputMode, number> = {
  text: 420,
  photo: 560,
  voice: 560,
};
// 서버의 mediaRecognitionReviewThreshold와 같은 정책을 사용한다.
export const LOW_RECOGNITION_CONFIDENCE = 0.78;
export const LIVE_SPEECH_TOTAL_DURATION_MILLIS = 60_000;
export const LIVE_SPEECH_MIN_SESSION_DURATION_MILLIS = 5_000;
export const VOICE_SPECTRUM_SAMPLE_COUNT = 24;
export const VOICE_SPECTRUM_BAR_COUNT = VOICE_SPECTRUM_SAMPLE_COUNT * 2;
export const VOICE_SPECTRUM_BARS = Array.from(
  { length: VOICE_SPECTRUM_BAR_COUNT },
  (_, index) => index,
);
export const VOICE_SPECTRUM_SIZE = 142;
export const VOICE_SPECTRUM_INNER_RADIUS = 41;
export const VOICE_SPECTRUM_ATTACK_MS = 82;
export const VOICE_SPECTRUM_RELEASE_MS = 250;
export const VOICE_SPECTRUM_HALO_ATTACK_MS = 110;
export const VOICE_SPECTRUM_HALO_RELEASE_MS = 320;
export const VOICE_SPECTRUM_MOTION_EASING = ReanimatedEasing.bezier(
  0.2,
  0.72,
  0.24,
  1,
);
export const VOICE_SPECTRUM_COLORS = [
  "#58D7F7",
  "#3B9DFF",
  BLUE,
  "#3887FF",
  "#45C7A5",
];
export const FLOW_CARD_HEIGHT_BY_STEP: Record<
  Exclude<FlowStep, "input">,
  number
> = {
  analyzing: 360,
  analysisError: 368,
  preview: 552,
  edit: 520,
  saving: 368,
  saved: 368,
};
export const EDIT_CARD_HEIGHT_BY_FIELD: Record<PreviewField, number> = {
  title: 290,
  date: 365,
  time: 410,
  location: 285,
  notification: 520,
  memo: 310,
};
export const INPUT_MODES: Array<{
  key: InputMode;
  label: string;
  accessibilityLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  {
    key: "text",
    label: "텍스트",
    accessibilityLabel: "텍스트로 빠른 일정 만들기",
    icon: "text-outline",
  },
  {
    key: "photo",
    label: "사진",
    accessibilityLabel: "사진으로 빠른 일정 만들기",
    icon: "image-outline",
  },
  {
    key: "voice",
    label: "음성",
    accessibilityLabel: "음성으로 빠른 일정 만들기",
    icon: "mic-outline",
  },
];
export const PREVIEW_FIELDS: Array<{
  key: PreviewField;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { key: "title", label: "제목", icon: "sparkles-outline" },
  { key: "date", label: "날짜", icon: "calendar-outline" },
  { key: "time", label: "시간", icon: "time-outline" },
  { key: "location", label: "장소", icon: "location-outline" },
  { key: "notification", label: "알림", icon: "notifications-outline" },
  { key: "memo", label: "메모", icon: "document-text-outline" },
];
export const FIELD_LABEL: Record<PreviewField, string> = PREVIEW_FIELDS.reduce(
  (labels, item) => {
    labels[item.key] = item.label;
    return labels;
  },
  {} as Record<PreviewField, string>,
);
export const NOTIFICATION_OPTIONS = [
  { label: "10분", value: "10" },
  { label: "30분", value: "30" },
  { label: "1시간", value: "60" },
];

/** 인식된 문자열을 빠른 일정 입력 제한에 맞추고 잘림 여부를 함께 반환한다. */
export function limitRecognizedText(value: string) {
  return {
    text: value.slice(0, QUICK_TEXT_LIMIT),
    truncated: value.length > QUICK_TEXT_LIMIT,
  };
}

/** 음성 인식 대안에서 빈 값과 중복을 제거하고 최대 세 개의 짧은 후보만 남긴다. */
export function limitRecognitionAlternatives(
  alternatives: LiveSpeechRecognitionAlternative[] | undefined,
): LiveSpeechRecognitionAlternative[] {
  if (!alternatives) return [];

  const limited: LiveSpeechRecognitionAlternative[] = [];
  for (const alternative of alternatives) {
    const text = limitRecognizedText(alternative.text).text.trim();
    if (!text || limited.some(candidate => candidate.text === text)) continue;
    limited.push({
      text,
      ...(alternative.confidence !== undefined
        ? { confidence: alternative.confidence }
        : {}),
    });
    if (limited.length >= 3) break;
  }
  return limited;
}

/** 사진 비율을 미리보기에서 사용할 수 있는 안전한 범위로 제한한다. */
export function resolvePhotoPreviewAspectRatio(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.max(
    PHOTO_PREVIEW_MIN_ASPECT_RATIO,
    Math.min(PHOTO_PREVIEW_MAX_ASPECT_RATIO, value),
  );
}

/** 네이티브 녹음 미터의 데시벨 값을 화면 파형용 0~1 값으로 변환한다. */
export function normalizeVoiceMetering(metering?: number | null) {
  if (typeof metering !== "number" || Number.isNaN(metering)) return null;
  const clamped = Math.max(-60, Math.min(0, metering));
  const linear = (clamped + 60) / 60;
  return Math.max(0, Math.min(1, Math.pow(linear, 1.28)));
}

/** 원형 음성 파형이 처음부터 균형 있게 보이도록 고정 길이의 샘플 배열을 만든다. */
export function createVoiceMeterHistory(level = 0) {
  return Array.from({ length: VOICE_SPECTRUM_SAMPLE_COUNT }, (_, index) => {
    if (level <= 0) return 0;
    const speechEnvelope =
      0.52 +
      Math.sin(index * 0.57) * 0.24 +
      Math.sin(index * 1.31 + 0.8) * 0.16;
    return Math.max(0.04, Math.min(1, level * Math.max(0.2, speechEnvelope)));
  });
}

/** 새 음량을 상승은 빠르고 하강은 느리게 평활화해 파형 이력을 한 칸 이동한다. */
export function appendVoiceMeterHistory(history: number[], level: number) {
  const source =
    history.length === VOICE_SPECTRUM_SAMPLE_COUNT
      ? history
      : createVoiceMeterHistory();
  const normalized = Math.max(0, Math.min(1, level));
  const previous = source[source.length - 1] ?? 0;
  const smoothed =
    normalized >= previous
      ? previous * 0.18 + normalized * 0.82
      : previous * 0.72 + normalized * 0.28;
  return [...source.slice(1), smoothed];
}

/** 현재 입력 모드에 맞는 안내 문구를 반환한다. */
export function placeholderForMode(inputMode: InputMode) {
  switch (inputMode) {
    case "photo":
      return "사진에 담긴 일정에 메모를 추가해보세요";
    case "voice":
      return "녹음한 일정에 메모를 추가해보세요";
    default:
      return "예) 금요일 오후 7시\n강남역에서 친구와 저녁";
  }
}

/** 녹음 시간을 분:초 형식으로 표시한다. */
export function formatVoiceDuration(durationMillis: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMillis / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/** 한 자리 숫자를 날짜·시간 문자열에 맞게 두 자리로 채운다. */
export function pad2(value: number) {
  return String(value).padStart(2, "0");
}

/** Date 값을 로컬 시간대의 YYYY-MM-DD 문자열로 변환한다. */
export function toYmd(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}`;
}

/** Date 값을 로컬 시간대의 HH:mm 문자열로 변환한다. */
export function toHm(date: Date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** YYYY-MM-DD 문자열로 해당 로컬 날짜의 자정 Date를 만든다. */
export function dateFromYmd(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date();
  date.setFullYear(year || date.getFullYear(), (month || 1) - 1, day || 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** 일정 날짜와 HH:mm 값을 합쳐 로컬 Date를 만든다. */
export function dateFromDraftTime(ymd: string, hm: string) {
  const date = dateFromYmd(ymd);
  const [hours, minutes] = hm.split(":").map(Number);
  date.setHours(
    Number.isFinite(hours) ? hours : 9,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0,
  );
  return date;
}

/** 콜론 또는 한국어 오전·오후 입력을 검증된 HH:mm 값으로 정규화한다. */
export function normalizeTimeInput(value: string, fallback: string) {
  const trimmed = value.trim();
  const colonMatch = trimmed.match(/^(\d{1,2}):(\d{1,2})$/);
  const koreanMatch = trimmed.match(
    /^(오전|오후)?\s*(\d{1,2})(?:\s*(?:시|:)\s*(\d{1,2}))?/,
  );
  const match = colonMatch ?? koreanMatch;
  if (!match) return fallback;
  const period = colonMatch ? undefined : match[1];
  let hours = Number(colonMatch ? match[1] : match[2]);
  const minutes = Number(colonMatch ? match[2] : match[3] ?? 0);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    minutes < 0 ||
    minutes > 59
  ) {
    return fallback;
  }
  if (period === "오후" && hours < 12) hours += 12;
  if (period === "오전" && hours === 12) hours = 0;
  if (hours < 0 || hours > 23) return fallback;
  return `${pad2(hours)}:${pad2(minutes)}`;
}

/** YYYY-MM-DD 값을 한국어 요일이 포함된 날짜로 표시한다. */
export function formatKoreanDate(ymd: string) {
  const date = dateFromYmd(ymd);
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${weekday})`;
}

/** HH:mm 값을 한국어 오전·오후 시간으로 표시한다. */
export function formatKoreanTime(hm: string) {
  const [rawHours, rawMinutes] = hm.split(":").map(Number);
  const hours = Number.isFinite(rawHours) ? rawHours : 9;
  const minutes = Number.isFinite(rawMinutes) ? rawMinutes : 0;
  const period = hours >= 12 ? "오후" : "오전";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${period} ${displayHours}:${pad2(minutes)}`;
}

/** 알림 선행 시간을 사용자가 읽기 쉬운 분·시간 단위로 표시한다. */
export function formatNotification(minutes?: number) {
  if (minutes === undefined) return "사용 안 함";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes % 60 === 0) return `${minutes / 60}시간 전`;
  return `${minutes}분 전`;
}

/** 네이티브 시트 전환이 끝난 다음 사진 선택 작업을 안전하게 실행하고 취소 함수를 반환한다. */
export function runAfterInteraction(task: () => void) {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const interaction = InteractionManager.runAfterInteractions(() => {
    if (cancelled) return;
    timer = setTimeout(
      () => {
        timer = null;
        if (!cancelled) task();
      },
      Platform.OS === "ios" ? 360 : 0,
    );
  });
  return () => {
    cancelled = true;
    interaction.cancel();
    if (timer) clearTimeout(timer);
  };
}

/** 앱이 포그라운드로 돌아올 때까지 기다려 오디오 세션 재개 충돌을 피한다. */
export function waitForAudioForegroundReady() {
  return new Promise<void>(resolve => {
    let settled = false;
    let subscription: { remove: () => void } | null = null;
    /** 대기를 한 번만 종료하고 오디오 세션 안정화 시간을 확보한다. */
    const finish = () => {
      if (settled) return;
      settled = true;
      subscription?.remove();
      setTimeout(resolve, 350);
    };
    if (AppState.currentState === "active") {
      finish();
      return;
    }
    subscription = AppState.addEventListener("change", state => {
      if (state === "active") finish();
    });
    setTimeout(finish, 1200);
  });
}
