import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    AppState,
    ActionSheetIOS,
    BackHandler,
    Image,
    InteractionManager,
    Keyboard,
    KeyboardAvoidingView,
    LayoutChangeEvent,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Audio } from "expo-av";
import * as ImagePicker from "expo-image-picker";
import type { ImagePickerAsset } from "expo-image-picker";
import { usePathname, useRouter } from "expo-router";
import Reanimated, {
    cancelAnimation,
    Easing as ReanimatedEasing,
    Extrapolation,
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withSpring,
    withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../../theme/ThemeContext";
import {
    ADD_HANDOFF_MOTION,
    ADD_MENU_SOURCE,
    lerpAddHandoffValue,
    resolveAddHandoffCloseDuration,
} from "../../addHandoffMotion";
import {
    buildScheduleSpeechContext,
    cancelQuickSchedulePhotoRecognition,
    recognizeQuickSchedulePhoto,
    type QuickScheduleMediaInput,
} from "../../quickInputExtraction";
import { finalizeQuickScheduleRecording } from "../../quickInputRecording";
import {
    accumulateLiveSpeechTranscript,
    addLiveSpeechLevelListener,
    addLiveSpeechStateListener,
    addLiveSpeechTranscriptListener,
    cancelLiveSpeechRecognition,
    createLiveSpeechTranscriptBuffer,
    createLiveSpeechSessionId,
    getLiveSpeechRecognitionAvailability,
    isLiveSpeechRecognitionAvailable,
    startLiveSpeechRecognition,
    stopLiveSpeechRecognition,
    type LiveSpeechRecognitionAlternative,
} from "../../liveSpeechRecognition";
import type {
    QuickScheduleReliabilityFeedback,
    ScheduleAlertMode,
    ScheduleCategory,
    ScheduleItem,
    ScheduleParseResult,
} from "../../types";
import { canWriteScheduleCategory } from "../../categoryPermissions";
import { formatRouteClock, formatRouteDuration } from "../../routeInfo";
import { consumeRoutePlannerResult, setRoutePlannerInitial } from "../../routePlannerSession";
import { getScheduleAlertModeLabel, SCHEDULE_ALERT_MODE_PRESENTATION } from "../../scheduleAlertMode";
import {
    applyQuickScheduleNotificationSettings,
    applyQuickScheduleRouteResult as applyRouteResultToPreviewDraft,
    buildQuickSchedulePayload,
    buildQuickScheduleReliabilityFeedback,
    buildQuickSchedulePreviewDraft as buildPreviewDraft,
    confirmQuickScheduleGlobalReview,
    getQuickSchedulePreviewRouteInfo,
    getQuickScheduleBlockingReviewField,
    isQuickScheduleRouteReady as canUseRouteNotification,
    quickSchedulePlaceFromLocation as placeFromDraftLocation,
    updateQuickSchedulePreviewDraft,
    type QuickSchedulePreviewDraft as PreviewDraft,
    type QuickSchedulePreviewField as PreviewField,
} from "../../quickScheduleDraft";
import QuickScheduleLogoLoader from "./QuickScheduleLogoLoader";
import QuickSchedulePhotoScanEffect from "./QuickSchedulePhotoScanEffect";
import BrandedLoader from "../../../../ui/BrandedLoader";
import CategoryLoadErrorBanner from "./CategoryLoadErrorBanner";

type Props = {
    visible: boolean;
    prewarm?: boolean;
    initialText?: string;
    initialRequestId?: string;
    initialInputType?: QuickScheduleMediaInput["inputTypeOverride"];
    /** Development preview entry point used to render each field flow in Simulator QA. */
    initialPreviewField?: PreviewField;
    onClose: () => void;
    onCloseStart?: () => void;
    onAnalyze: (text: string, media?: QuickScheduleMediaInput) => Promise<ScheduleParseResult>;
    onSave: (payload: Omit<ScheduleItem, "id">) => void | Promise<void>;
    onFeedback?: (feedback: QuickScheduleReliabilityFeedback) => void | Promise<void>;
    defaultDay: string;
    defaultCategory?: ScheduleCategory;
    categoryError?: string | null;
    categoryLoading?: boolean;
    onRetryCategories?: () => void;
    sourceTopOffset?: number;
    sourceWidth?: number;
    sourceHeight?: number;
    sourceRightOffset?: number;
    closeTargetWidth?: number;
    onMorphReady?: () => void;
    morphPresenterRef?: React.MutableRefObject<QuickScheduleMorphPresenter | null>;
};

export type QuickScheduleMorphPresenter = () => boolean;

type InputMode = "text" | "photo" | "voice";
type FlowStep = "input" | "analyzing" | "analysisError" | "preview" | "edit" | "saving" | "saved";
type TimeEditMode = "picker" | "manual";
type TabLayout = {
    x: number;
    width: number;
};
const QUICK_TEXT_LIMIT = 300;
const PHOTO_RECOGNITION_TIMEOUT_MILLIS = 15_000;
const PHOTO_PREVIEW_STAGE_HEIGHT = 164;
const PHOTO_PREVIEW_MIN_ASPECT_RATIO = 0.55;
const PHOTO_PREVIEW_MAX_ASPECT_RATIO = 2.2;

function limitRecognizedText(value: string) {
    return {
        text: value.slice(0, QUICK_TEXT_LIMIT),
        truncated: value.length > QUICK_TEXT_LIMIT,
    };
}

function limitRecognitionAlternatives(
    alternatives: LiveSpeechRecognitionAlternative[] | undefined,
): LiveSpeechRecognitionAlternative[] {
    if (!alternatives) return [];

    const limited: LiveSpeechRecognitionAlternative[] = [];
    for (const alternative of alternatives) {
        const text = limitRecognizedText(alternative.text).text.trim();
        if (!text || limited.some(candidate => candidate.text === text)) continue;
        limited.push({
            text,
            ...(alternative.confidence !== undefined ? { confidence: alternative.confidence } : {}),
        });
        if (limited.length >= 3) break;
    }
    return limited;
}

export function resolvePhotoPreviewAspectRatio(value?: number | null) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 1;

    return Math.max(PHOTO_PREVIEW_MIN_ASPECT_RATIO, Math.min(PHOTO_PREVIEW_MAX_ASPECT_RATIO, value));
}

const BLUE = "#246BFE";
const OPEN_START_PROGRESS = 0;
const PREWARM_PRESENTATION_OPACITY = 0.001;
const OPEN_DURATION_MS = ADD_HANDOFF_MOTION.quickOpenMs;
const CLOSE_SURFACE_DELAY_MS = 0;
const CLOSE_TARGET_WIDTH = 150;
const CLOSE_TARGET_HEIGHT = 44;
const EXPANDED_CARD_RADIUS = 26;
const OPEN_EASING = ReanimatedEasing.bezier(...ADD_HANDOFF_MOTION.openBezier);
const CLOSE_EASING = ReanimatedEasing.bezier(...ADD_HANDOFF_MOTION.closeBezier);
const MODE_PILL_SPRING = {
    damping: 18,
    stiffness: 150,
    mass: 0.82,
    overshootClamping: false,
};
const CARD_SIZE_SPRING = {
    damping: 24,
    stiffness: 190,
    mass: 0.88,
    overshootClamping: true,
};
const CARD_HEIGHT_BY_MODE: Record<InputMode, number> = {
    text: 420,
    photo: 560,
    voice: 560,
};
// 서버의 mediaRecognitionReviewThreshold와 같은 정책을 사용한다. 서로 다른 문턱은
// 65~77% 사진을 입력 화면에서는 안전해 보이게 하고 서버에서만 검토 대상으로 만들었다.
const LOW_RECOGNITION_CONFIDENCE = 0.78;
const LIVE_SPEECH_TOTAL_DURATION_MILLIS = 60_000;
const LIVE_SPEECH_MIN_SESSION_DURATION_MILLIS = 5_000;
type LiveSpeechCaptureStartMode = "fresh" | "rollover";
// 실제 음량 샘플은 반원만큼만 보관하고 화면에서는 반대편에 미러링한다.
// 원형 파형의 무게 중심이 한쪽으로 쏠리지 않아 작은 화면에서도 안정적으로 보인다.
const VOICE_SPECTRUM_SAMPLE_COUNT = 24;
const VOICE_SPECTRUM_BAR_COUNT = VOICE_SPECTRUM_SAMPLE_COUNT * 2;
const VOICE_SPECTRUM_BARS = Array.from({ length: VOICE_SPECTRUM_BAR_COUNT }, (_, index) => index);
const VOICE_SPECTRUM_SIZE = 142;
const VOICE_SPECTRUM_INNER_RADIUS = 41;
const VOICE_SPECTRUM_ATTACK_MS = 82;
const VOICE_SPECTRUM_RELEASE_MS = 250;
const VOICE_SPECTRUM_HALO_ATTACK_MS = 110;
const VOICE_SPECTRUM_HALO_RELEASE_MS = 320;
const VOICE_SPECTRUM_MOTION_EASING = ReanimatedEasing.bezier(0.2, 0.72, 0.24, 1);
const VOICE_SPECTRUM_COLORS = ["#58D7F7", "#3B9DFF", BLUE, "#3887FF", "#45C7A5"];
const FLOW_CARD_HEIGHT_BY_STEP: Record<Exclude<FlowStep, "input">, number> = {
    analyzing: 360,
    analysisError: 368,
    preview: 452,
    edit: 520,
    saving: 368,
    saved: 368,
};
const EDIT_CARD_HEIGHT_BY_FIELD: Record<PreviewField, number> = {
    title: 290,
    date: 365,
    time: 410,
    location: 285,
    notification: 520,
    memo: 310,
};
const INPUT_MODES: Array<{
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

function normalizeVoiceMetering(metering?: number | null) {
    if (typeof metering !== "number" || Number.isNaN(metering)) return null;

    const clamped = Math.max(-60, Math.min(0, metering));
    const linear = (clamped + 60) / 60;
    return Math.max(0, Math.min(1, Math.pow(linear, 1.28)));
}

function createVoiceMeterHistory(level = 0) {
    return Array.from({ length: VOICE_SPECTRUM_SAMPLE_COUNT }, (_, index) => {
        if (level <= 0) return 0;

        const speechEnvelope = 0.52 + Math.sin(index * 0.57) * 0.24 + Math.sin(index * 1.31 + 0.8) * 0.16;
        return Math.max(0.04, Math.min(1, level * Math.max(0.2, speechEnvelope)));
    });
}

function appendVoiceMeterHistory(history: number[], level: number) {
    const source = history.length === VOICE_SPECTRUM_SAMPLE_COUNT ? history : createVoiceMeterHistory();
    const normalized = Math.max(0, Math.min(1, level));
    const previous = source[source.length - 1] ?? 0;

    // 미터링 값은 프레임마다 편차가 크다. 상승은 빠르게 따라가고 하강은 천천히
    // 놓아주는 필터로 말소리의 박자는 살리면서 막대가 덜컥거리는 느낌을 줄인다.
    const smoothed = normalized >= previous ? previous * 0.18 + normalized * 0.82 : previous * 0.72 + normalized * 0.28;

    return [...source.slice(1), smoothed];
}

function VoiceSpectrumBar({ angle, color, level }: { angle: string; color: string; level: number }) {
    const normalizedLevel = Math.max(0, Math.min(1, level));
    const animatedLevel = useSharedValue(normalizedLevel);
    const previousLevelRef = useRef(normalizedLevel);

    useEffect(() => {
        const rising = normalizedLevel >= previousLevelRef.current;
        previousLevelRef.current = normalizedLevel;
        animatedLevel.value = withTiming(normalizedLevel, {
            duration: rising ? VOICE_SPECTRUM_ATTACK_MS : VOICE_SPECTRUM_RELEASE_MS,
            easing: VOICE_SPECTRUM_MOTION_EASING,
        });
    }, [animatedLevel, normalizedLevel]);

    const animatedStyle = useAnimatedStyle(() => {
        const height = Math.max(3, Math.min(20, 3 + animatedLevel.value * 17));
        return {
            height,
            opacity: 0.3 + animatedLevel.value * 0.7,
        };
    });

    return (
        <View
            testID="quick-schedule-voice-spectrum-bar"
            style={[styles.voiceSpectrumBarSlot, { transform: [{ rotate: angle }] }]}
        >
            <Reanimated.View
                style={[styles.voiceSpectrumBar, { backgroundColor: color, shadowColor: color }, animatedStyle]}
            />
        </View>
    );
}

function VoiceSpectrumHalo({ energy }: { energy: number }) {
    const normalizedEnergy = Math.max(0, Math.min(1, energy));
    const animatedEnergy = useSharedValue(normalizedEnergy);
    const previousEnergyRef = useRef(normalizedEnergy);

    useEffect(() => {
        const rising = normalizedEnergy >= previousEnergyRef.current;
        previousEnergyRef.current = normalizedEnergy;
        animatedEnergy.value = withTiming(normalizedEnergy, {
            duration: rising ? VOICE_SPECTRUM_HALO_ATTACK_MS : VOICE_SPECTRUM_HALO_RELEASE_MS,
            easing: VOICE_SPECTRUM_MOTION_EASING,
        });
    }, [animatedEnergy, normalizedEnergy]);

    const outerAnimatedStyle = useAnimatedStyle(() => ({
        opacity: 0.1 + animatedEnergy.value * 0.2,
        transform: [{ scale: 1 + animatedEnergy.value * 0.1 }],
    }));
    const innerAnimatedStyle = useAnimatedStyle(() => ({
        opacity: 0.12 + animatedEnergy.value * 0.24,
        transform: [{ scale: 1 + animatedEnergy.value * 0.055 }],
    }));

    return (
        <>
            <Reanimated.View pointerEvents="none" style={[styles.voiceSpectrumHaloOuter, outerAnimatedStyle]} />
            <Reanimated.View pointerEvents="none" style={[styles.voiceSpectrumHaloInner, innerAnimatedStyle]} />
        </>
    );
}

const PREVIEW_FIELDS: Array<{
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
const FIELD_LABEL: Record<PreviewField, string> = PREVIEW_FIELDS.reduce((acc, item) => {
    acc[item.key] = item.label;
    return acc;
}, {} as Record<PreviewField, string>);
const NOTIFICATION_OPTIONS = [
    { label: "10분", value: "10" },
    { label: "30분", value: "30" },
    { label: "1시간", value: "60" },
];

function runAfterInteraction(task: () => void) {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // ActionSheetIOS의 선택 콜백은 시트가 완전히 사라지기 전에 호출될 수 있다.
    // UIKit 전환과 사진 선택기/문서 스캐너 presentation이 겹치지 않도록 현재
    // interaction과 dismiss animation이 끝난 다음 네이티브 화면을 연다.
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
function placeholderForMode(inputMode: InputMode) {
    switch (inputMode) {
        case "photo":
            return "사진에 담긴 일정에 메모를 추가해보세요";
        case "voice":
            return "녹음한 일정에 메모를 추가해보세요";
        default:
            return "예) 금요일 오후 7시\n강남역에서 친구와 저녁";
    }
}

function formatVoiceDuration(durationMillis: number) {
    const totalSeconds = Math.max(0, Math.floor(durationMillis / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");

    return `${minutes}:${seconds}`;
}

function pad2(value: number) {
    return String(value).padStart(2, "0");
}

function toYmd(date: Date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function toHm(date: Date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function dateFromYmd(ymd: string) {
    const [year, month, day] = ymd.split("-").map(Number);
    const date = new Date();
    date.setFullYear(year || date.getFullYear(), (month || 1) - 1, day || 1);
    date.setHours(0, 0, 0, 0);
    return date;
}

function dateFromDraftTime(ymd: string, hm: string) {
    const date = dateFromYmd(ymd);
    const [hours, minutes] = hm.split(":").map(Number);
    date.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0);
    return date;
}

function normalizeTimeInput(value: string, fallback: string) {
    const trimmed = value.trim();
    const colonMatch = trimmed.match(/^(\d{1,2}):(\d{1,2})$/);
    const koreanMatch = trimmed.match(/^(오전|오후)?\s*(\d{1,2})(?:\s*(?:시|:)\s*(\d{1,2}))?/);
    const match = colonMatch ?? koreanMatch;
    if (!match) return fallback;

    const period = colonMatch ? undefined : match[1];
    let hours = Number(colonMatch ? match[1] : match[2]);
    const minutes = Number(colonMatch ? match[2] : match[3] ?? 0);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes < 0 || minutes > 59) {
        return fallback;
    }

    if (period === "오후" && hours < 12) hours += 12;
    if (period === "오전" && hours === 12) hours = 0;
    if (hours < 0 || hours > 23) return fallback;
    return `${pad2(hours)}:${pad2(minutes)}`;
}

function formatKoreanDate(ymd: string) {
    const date = dateFromYmd(ymd);
    const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${weekday})`;
}

function formatKoreanTime(hm: string) {
    const [rawHours, rawMinutes] = hm.split(":").map(Number);
    const hours = Number.isFinite(rawHours) ? rawHours : 9;
    const minutes = Number.isFinite(rawMinutes) ? rawMinutes : 0;
    const period = hours >= 12 ? "오후" : "오전";
    const displayHours = hours % 12 === 0 ? 12 : hours % 12;
    return `${period} ${displayHours}:${pad2(minutes)}`;
}

function formatNotification(minutes?: number) {
    if (minutes === undefined) return "사용 안 함";
    if (minutes < 60) return `${minutes}분 전`;
    if (minutes % 60 === 0) return `${minutes / 60}시간 전`;
    return `${minutes}분 전`;
}

function waitForAudioForegroundReady() {
    return new Promise<void>(resolve => {
        let settled = false;
        let subscription: { remove: () => void } | null = null;

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
            if (state === "active") {
                finish();
            }
        });
        setTimeout(finish, 1200);
    });
}

export default function QuickScheduleModal({
    visible,
    prewarm = false,
    initialText,
    initialRequestId,
    initialInputType,
    initialPreviewField,
    onClose,
    onCloseStart,
    onAnalyze,
    onSave,
    onFeedback,
    defaultDay,
    defaultCategory,
    categoryError,
    categoryLoading = false,
    onRetryCategories,
    sourceTopOffset = 4,
    sourceWidth = ADD_MENU_SOURCE.fallbackWidth,
    sourceHeight = ADD_MENU_SOURCE.nativeHeight,
    sourceRightOffset = ADD_MENU_SOURCE.fallbackRightInset,
    closeTargetWidth = CLOSE_TARGET_WIDTH,
    onMorphReady,
    morphPresenterRef,
}: Props) {
    const router = useRouter();
    const pathname = usePathname();
    const { colors, mode } = useTheme();
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const [rendered, setRendered] = useState(visible || prewarm);
    const [text, setText] = useState("");
    const [inputMode, setInputMode] = useState<InputMode>("text");
    const [selectedPhoto, setSelectedPhoto] = useState<ImagePickerAsset | null>(null);
    const [photoTranscript, setPhotoTranscript] = useState("");
    const [photoTranscriptTruncated, setPhotoTranscriptTruncated] = useState(false);
    const [photoRecognitionConfidence, setPhotoRecognitionConfidence] = useState<number>();
    const [photoRecognitionError, setPhotoRecognitionError] = useState("");
    const [photoRecognitionAttempt, setPhotoRecognitionAttempt] = useState(0);
    const [isPhotoRecognizing, setIsPhotoRecognizing] = useState(false);
    const [voiceUri, setVoiceUri] = useState<string | null>(null);
    const [voiceDurationMillis, setVoiceDurationMillis] = useState(0);
    const [voiceTranscript, setVoiceTranscript] = useState("");
    const [voiceTranscriptTruncated, setVoiceTranscriptTruncated] = useState(false);
    const [voiceRecognitionConfidence, setVoiceRecognitionConfidence] = useState<number>();
    const [voiceRecognitionAlternatives, setVoiceRecognitionAlternatives] = useState<
        LiveSpeechRecognitionAlternative[]
    >([]);
    const [voiceStatusMessage, setVoiceStatusMessage] = useState("");
    const [isVoiceRecording, setIsVoiceRecording] = useState(false);
    const [isVoiceFinalizing, setIsVoiceFinalizing] = useState(false);
    const [voiceMeterHistory, setVoiceMeterHistory] = useState(() => createVoiceMeterHistory(0));
    const [submitting, setSubmitting] = useState(false);
    const [cardRasterized, setCardRasterized] = useState(false);
    const [contentMounted, setContentMounted] = useState(visible || prewarm);
    const [modeLayouts, setModeLayouts] = useState<Partial<Record<InputMode, TabLayout>>>({});
    const [flowStep, setFlowStep] = useState<FlowStep>("input");
    const [analysisError, setAnalysisError] = useState("");
    const [previewDraft, setPreviewDraft] = useState<PreviewDraft | null>(null);
    const [previewSourceText, setPreviewSourceText] = useState("");
    const [editingField, setEditingField] = useState<PreviewField | null>(null);
    const [editingValue, setEditingValue] = useState("");
    const [editingAlertMode, setEditingAlertMode] = useState<ScheduleAlertMode>("STANDARD");
    const [timeEditMode, setTimeEditMode] = useState<TimeEditMode>("picker");
    const [routePlannerSessionId, setRoutePlannerSessionId] = useState<string | undefined>();
    const [routePlannerHidden, setRoutePlannerHidden] = useState(false);
    const recorderState = {
        isRecording: isVoiceRecording,
        durationMillis: voiceDurationMillis,
    };
    const progress = useSharedValue(0);
    const closingPhase = useSharedValue(0);
    const presentationOpacity = useSharedValue(visible && !prewarm ? 1 : PREWARM_PRESENTATION_OPACITY);
    const presentationStyle = useAnimatedStyle(() => ({
        opacity: presentationOpacity.value,
    }));
    const modeIndicatorX = useSharedValue(0);
    const modeIndicatorWidth = useSharedValue(0);
    const inputRef = useRef<TextInput>(null);
    const audioRecordingRef = useRef<Audio.Recording | null>(null);
    const recordingCleanupPromiseRef = useRef<Promise<string | null> | null>(null);
    const liveSpeechSessionIdRef = useRef<string | null>(null);
    const liveSpeechStartingRef = useRef(false);
    const liveSpeechOperationRef = useRef(0);
    const liveSpeechStopInFlightRef = useRef<{
        operation: number;
        sessionId: string;
    } | null>(null);
    const liveSpeechTranscriptBufferRef = useRef(createLiveSpeechTranscriptBuffer());
    const liveSpeechBaseDurationMillisRef = useRef(0);
    const liveSpeechCaptureActiveRef = useRef(false);
    const liveSpeechCaptureStartedAtRef = useRef(0);
    const liveSpeechRequiresOnDeviceRecognitionRef = useRef(true);
    const beginLiveSpeechCaptureRef = useRef<
        ((requiresOnDeviceRecognition: boolean, startMode: LiveSpeechCaptureStartMode) => Promise<void>) | null
    >(null);
    const voiceTranscriptRef = useRef("");
    const voiceDurationMillisRef = useRef(0);
    const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const closingRef = useRef(false);
    const openHandoffFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
    const seedHasLayoutRef = useRef(false);
    const openStartedRef = useRef(false);
    const openCycleRef = useRef(0);
    const visibleRef = useRef(visible);
    const closeFinishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const closeFinishedRef = useRef(false);
    const routePlannerAwayRef = useRef(false);
    const routePlannerReturnFieldRef = useRef<PreviewField | null>(null);
    const initialRequestHandledRef = useRef<string | null>(null);
    const initialPreviewFieldHandledRef = useRef<string | null>(null);
    const analysisSequenceRef = useRef(0);
    const photoRecognitionSequenceRef = useRef(0);
    const photoSourceOperationRef = useRef(0);
    const pendingPhotoActionCancelRef = useRef<(() => void) | null>(null);
    const mountedRef = useRef(false);
    const analysisPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const analysisInFlightRef = useRef(false);
    const saveInFlightRef = useRef(false);

    const cancelPendingPhotoAction = useCallback(() => {
        pendingPhotoActionCancelRef.current?.();
        pendingPhotoActionCancelRef.current = null;
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            photoSourceOperationRef.current += 1;
            cancelPendingPhotoAction();
        };
    }, [cancelPendingPhotoAction]);

    useEffect(() => {
        const belongsToActiveSession = (sessionId: string) => liveSpeechSessionIdRef.current === sessionId;

        const transcriptSubscription = addLiveSpeechTranscriptListener(event => {
            if (!belongsToActiveSession(event.sessionId)) return;
            const snapshot = accumulateLiveSpeechTranscript(liveSpeechTranscriptBufferRef.current, event);
            liveSpeechTranscriptBufferRef.current = snapshot.buffer;
            const limited = limitRecognizedText(snapshot.text);
            voiceTranscriptRef.current = limited.text;
            setVoiceTranscript(limited.text);
            setVoiceTranscriptTruncated(limited.truncated);
            setVoiceRecognitionAlternatives(limitRecognitionAlternatives(snapshot.alternatives));
            setVoiceRecognitionConfidence(event.confidence);
            if (event.elapsedMillis !== undefined) {
                const durationMillis = Math.min(
                    LIVE_SPEECH_TOTAL_DURATION_MILLIS,
                    liveSpeechBaseDurationMillisRef.current + event.elapsedMillis,
                );
                voiceDurationMillisRef.current = durationMillis;
                setVoiceDurationMillis(durationMillis);
            }
        });
        const levelSubscription = addLiveSpeechLevelListener(event => {
            if (!belongsToActiveSession(event.sessionId)) return;
            const level = Math.max(event.rms, event.peak * 0.72);
            setVoiceMeterHistory(current => appendVoiceMeterHistory(current, level));
            if (event.elapsedMillis !== undefined) {
                const durationMillis = Math.min(
                    LIVE_SPEECH_TOTAL_DURATION_MILLIS,
                    liveSpeechBaseDurationMillisRef.current + event.elapsedMillis,
                );
                voiceDurationMillisRef.current = durationMillis;
                setVoiceDurationMillis(durationMillis);
            }
        });
        const stateSubscription = addLiveSpeechStateListener(event => {
            if (!belongsToActiveSession(event.sessionId)) return;

            if (event.state === "listening") {
                setIsVoiceFinalizing(false);
                setIsVoiceRecording(true);
                setVoiceStatusMessage("");
                return;
            }
            if (event.state === "stopping") {
                setIsVoiceRecording(false);
                setIsVoiceFinalizing(true);
                setVoiceStatusMessage("마지막 문장을 정리하고 있어요.");
                return;
            }
            if (event.state === "finished" || event.state === "cancelled" || event.state === "failed") {
                const shouldRollover =
                    event.state === "finished" &&
                    liveSpeechCaptureActiveRef.current &&
                    !liveSpeechStopInFlightRef.current &&
                    mountedRef.current &&
                    visibleRef.current &&
                    !closingRef.current;
                liveSpeechSessionIdRef.current = null;
                liveSpeechStartingRef.current = false;

                const captureWallTimeMillis =
                    liveSpeechCaptureStartedAtRef.current > 0 ? Date.now() - liveSpeechCaptureStartedAtRef.current : 0;
                const totalElapsedMillis = Math.max(voiceDurationMillisRef.current, captureWallTimeMillis);
                const remainingMillis = LIVE_SPEECH_TOTAL_DURATION_MILLIS - totalElapsedMillis;
                const restartCapture = beginLiveSpeechCaptureRef.current;
                if (shouldRollover && remainingMillis >= LIVE_SPEECH_MIN_SESSION_DURATION_MILLIS && restartCapture) {
                    setIsVoiceRecording(true);
                    setIsVoiceFinalizing(true);
                    setVoiceStatusMessage("계속 듣고 있어요.");
                    restartCapture(liveSpeechRequiresOnDeviceRecognitionRef.current, "rollover").catch(() => undefined);
                    return;
                }

                liveSpeechCaptureActiveRef.current = false;
                liveSpeechCaptureStartedAtRef.current = 0;
                setIsVoiceRecording(false);
                setIsVoiceFinalizing(false);
                setVoiceMeterHistory(createVoiceMeterHistory());
                setVoiceStatusMessage(
                    event.state === "failed" ? event.message ?? "음성을 인식하지 못했습니다. 다시 말해 주세요." : "",
                );
            }
        });

        return () => {
            transcriptSubscription?.remove();
            levelSubscription?.remove();
            stateSubscription?.remove();
        };
    }, []);

    useEffect(() => {
        const photoUri = selectedPhoto?.uri;
        const sequence = photoRecognitionSequenceRef.current + 1;
        photoRecognitionSequenceRef.current = sequence;

        if (!photoUri) {
            setPhotoTranscript("");
            setPhotoTranscriptTruncated(false);
            setPhotoRecognitionConfidence(undefined);
            setPhotoRecognitionError("");
            setIsPhotoRecognizing(false);
            return undefined;
        }

        setPhotoTranscript("");
        setPhotoTranscriptTruncated(false);
        setPhotoRecognitionConfidence(undefined);
        setPhotoRecognitionError("");
        setIsPhotoRecognizing(true);
        const requestId = `quick-photo-${Date.now()}-${sequence}`;
        let completed = false;
        const timeout = setTimeout(() => {
            if (photoRecognitionSequenceRef.current !== sequence) return;
            photoRecognitionSequenceRef.current += 1;
            void cancelQuickSchedulePhotoRecognition(requestId).catch(() => undefined);
            setIsPhotoRecognizing(false);
            setPhotoRecognitionError(
                "사진을 읽는 데 시간이 오래 걸려 중단했어요. 다시 읽거나 아래에 직접 입력해 주세요.",
            );
        }, PHOTO_RECOGNITION_TIMEOUT_MILLIS);

        void recognizeQuickSchedulePhoto(photoUri, requestId)
            .then(recognition => {
                if (photoRecognitionSequenceRef.current !== sequence) return;
                const limited = limitRecognizedText(recognition.text);
                setPhotoTranscript(limited.text);
                setPhotoTranscriptTruncated(limited.truncated || recognition.truncated === true);
                setPhotoRecognitionConfidence(recognition.recognitionConfidence);
            })
            .catch(error => {
                if (photoRecognitionSequenceRef.current !== sequence) return;
                setPhotoRecognitionError(
                    error instanceof Error ? error.message : "사진에서 일정 내용을 찾지 못했어요.",
                );
            })
            .finally(() => {
                completed = true;
                clearTimeout(timeout);
                if (photoRecognitionSequenceRef.current === sequence) {
                    setIsPhotoRecognizing(false);
                }
            });

        return () => {
            clearTimeout(timeout);
            if (!completed) {
                void cancelQuickSchedulePhotoRecognition(requestId).catch(() => undefined);
            }
            if (photoRecognitionSequenceRef.current === sequence) {
                photoRecognitionSequenceRef.current += 1;
            }
        };
    }, [photoRecognitionAttempt, selectedPhoto?.uri]);

    if (visible || (!openStartedRef.current && openHandoffFrameRef.current === null)) {
        visibleRef.current = visible;
    }
    const cardWidth = Math.min(width - 60, 348);
    const sourceRight = width - sourceRightOffset;
    const openSourceWidth = sourceWidth;
    const openSourceHeight = sourceHeight;
    const openSourceLeft = sourceRight - openSourceWidth;
    const closeSourceWidth = closeTargetWidth;
    const closeSourceHeight = CLOSE_TARGET_HEIGHT;
    const closeSourceLeft = sourceRight - closeSourceWidth;
    const sourceTop = insets.top + sourceTopOffset;
    const cardTop = sourceTop;
    const baseCardHeight =
        flowStep === "input"
            ? inputMode === "photo" && !selectedPhoto
                ? 378
                : CARD_HEIGHT_BY_MODE[inputMode]
            : flowStep === "edit" && editingField
            ? EDIT_CARD_HEIGHT_BY_FIELD[editingField]
            : FLOW_CARD_HEIGHT_BY_STEP[flowStep];
    const targetCardHeight = baseCardHeight + (categoryError && onRetryCategories ? 58 : 0);
    const cardHeight = Math.min(targetCardHeight, height - cardTop - Math.max(insets.bottom, 16) - 12);
    const expandedCardHeight = useSharedValue(cardHeight);
    const cardLeft = (width - cardWidth) / 2;
    const openSourceRadius = Math.min(openSourceHeight / 2, ADD_MENU_SOURCE.nativeRadius);
    const closeSourceRadius = Math.min(closeSourceHeight / 2, ADD_MENU_SOURCE.nativeRadius);

    const notificationRouteReady = canUseRouteNotification(previewDraft);

    const handleModeLayout = useCallback(
        (key: InputMode) => (event: LayoutChangeEvent) => {
            const { x, width: measuredWidth } = event.nativeEvent.layout;

            setModeLayouts(current => {
                const previous = current[key];
                if (previous && Math.abs(previous.x - x) < 0.5 && Math.abs(previous.width - measuredWidth) < 0.5) {
                    return current;
                }

                return {
                    ...current,
                    [key]: {
                        x,
                        width: measuredWidth,
                    },
                };
            });
        },
        [],
    );

    const clearVoiceTimer = useCallback(() => {
        if (voiceTimerRef.current) {
            clearInterval(voiceTimerRef.current);
            voiceTimerRef.current = null;
        }
    }, []);

    const stopActiveRecording = useCallback(
        (preserveRecording = false): Promise<string | null> => {
            const pendingCleanup = recordingCleanupPromiseRef.current;
            const recorder = audioRecordingRef.current;
            const liveSpeechSessionId = liveSpeechSessionIdRef.current;
            const cleanupOperation = liveSpeechOperationRef.current + 1;
            liveSpeechOperationRef.current = cleanupOperation;
            liveSpeechCaptureActiveRef.current = false;
            liveSpeechCaptureStartedAtRef.current = 0;
            audioRecordingRef.current = null;
            liveSpeechSessionIdRef.current = null;
            liveSpeechStartingRef.current = false;
            liveSpeechStopInFlightRef.current = null;
            clearVoiceTimer();
            setIsVoiceRecording(false);
            // The explicit stop button owns the "finalizing" state while it waits for
            // `finalizeQuickScheduleRecording`. Lifecycle/mode-change cleanup does not
            // preserve a recording and may clear the state immediately.
            if (!preserveRecording) setIsVoiceFinalizing(false);
            setVoiceMeterHistory(createVoiceMeterHistory());

            if (!preserveRecording) {
                voiceDurationMillisRef.current = 0;
                voiceTranscriptRef.current = "";
                liveSpeechBaseDurationMillisRef.current = 0;
                liveSpeechTranscriptBufferRef.current = createLiveSpeechTranscriptBuffer();
                setVoiceUri(null);
                setVoiceDurationMillis(0);
                setVoiceTranscript("");
                setVoiceTranscriptTruncated(false);
                setVoiceRecognitionConfidence(undefined);
                setVoiceRecognitionAlternatives([]);
                setVoiceStatusMessage("");
            }

            const cleanupPromise = (async () => {
                let pendingResult: string | null = null;
                if (pendingCleanup) {
                    try {
                        pendingResult = await pendingCleanup;
                    } catch (error) {
                        // A close/mode-change cleanup supersedes an earlier "save recording"
                        // request. Preserve the error only when this caller is still asking for
                        // that same result; lifecycle teardown must always continue.
                        if (preserveRecording && !recorder && !liveSpeechSessionId) throw error;
                    }
                }

                if (liveSpeechSessionId) {
                    await cancelLiveSpeechRecognition(liveSpeechSessionId).catch(() => undefined);
                }

                if (!recorder) {
                    await Audio.setAudioModeAsync({
                        allowsRecordingIOS: false,
                        playsInSilentModeIOS: true,
                    }).catch(() => undefined);
                    return preserveRecording ? pendingResult : null;
                }

                try {
                    // stopAndUnloadAsync가 끝나기 전에 getURI를 읽거나 분석 버튼을 활성화하면,
                    // Speech가 아직 닫히지 않은 m4a를 읽어 decode 실패가 날 수 있다.
                    if (!preserveRecording) {
                        await recorder.stopAndUnloadAsync();
                        return null;
                    }

                    const recordedUri = await finalizeQuickScheduleRecording(recorder);
                    if (
                        liveSpeechOperationRef.current === cleanupOperation &&
                        mountedRef.current &&
                        visibleRef.current &&
                        !closingRef.current
                    ) {
                        setVoiceUri(recordedUri);
                    }
                    return recordedUri;
                } catch (error) {
                    // 화면 닫기나 입력 모드 변경처럼 녹음을 버리는 경로에서는 저장 실패를 사용자에게
                    // 노출하지 않는다. 사용자가 중지 버튼으로 보존을 요청한 경우에만 호출자가 처리한다.
                    if (preserveRecording) throw error;
                    return null;
                } finally {
                    await Audio.setAudioModeAsync({
                        allowsRecordingIOS: false,
                        playsInSilentModeIOS: true,
                    }).catch(() => undefined);
                }
            })();

            recordingCleanupPromiseRef.current = cleanupPromise;
            const clearCleanup = () => {
                if (recordingCleanupPromiseRef.current === cleanupPromise) {
                    recordingCleanupPromiseRef.current = null;
                }
            };
            // `finally()` creates a rejecting child promise when finalization fails.
            // Clearing through both `then` branches keeps the caller-owned rejection
            // on `cleanupPromise` without creating an unhandled derivative.
            void cleanupPromise.then(clearCleanup, clearCleanup);
            return cleanupPromise;
        },
        [clearVoiceTimer],
    );

    const invalidatePendingAnalysis = useCallback(() => {
        analysisSequenceRef.current += 1;
        analysisInFlightRef.current = false;
        if (analysisPreviewTimerRef.current) {
            clearTimeout(analysisPreviewTimerRef.current);
            analysisPreviewTimerRef.current = null;
        }
    }, []);

    const finishClose = useCallback(
        (shouldNotifyClose: boolean) => {
            if (closeFinishedRef.current) return;
            closeFinishedRef.current = true;
            liveSpeechOperationRef.current += 1;
            liveSpeechStartingRef.current = false;
            liveSpeechCaptureActiveRef.current = false;
            liveSpeechCaptureStartedAtRef.current = 0;
            photoSourceOperationRef.current += 1;
            cancelPendingPhotoAction();
            if (closeFinishTimerRef.current) {
                clearTimeout(closeFinishTimerRef.current);
                closeFinishTimerRef.current = null;
            }
            setRendered(prewarm);
            setText("");
            setInputMode("text");
            setSelectedPhoto(null);
            setPhotoTranscript("");
            setPhotoTranscriptTruncated(false);
            setPhotoRecognitionConfidence(undefined);
            setPhotoRecognitionError("");
            setPhotoRecognitionAttempt(0);
            setIsPhotoRecognizing(false);
            voiceDurationMillisRef.current = 0;
            voiceTranscriptRef.current = "";
            liveSpeechBaseDurationMillisRef.current = 0;
            liveSpeechTranscriptBufferRef.current = createLiveSpeechTranscriptBuffer();
            setVoiceUri(null);
            setVoiceDurationMillis(0);
            setVoiceTranscript("");
            setVoiceTranscriptTruncated(false);
            setVoiceRecognitionConfidence(undefined);
            setVoiceRecognitionAlternatives([]);
            setVoiceStatusMessage("");
            setIsVoiceRecording(false);
            setIsVoiceFinalizing(false);
            setVoiceMeterHistory(createVoiceMeterHistory());
            setSubmitting(false);
            setCardRasterized(false);
            setContentMounted(prewarm);
            setFlowStep("input");
            setAnalysisError("");
            setPreviewDraft(null);
            setPreviewSourceText("");
            setEditingField(null);
            setEditingValue("");
            setEditingAlertMode("STANDARD");
            setTimeEditMode("picker");
            setRoutePlannerSessionId(undefined);
            setRoutePlannerHidden(false);
            saveInFlightRef.current = false;
            invalidatePendingAnalysis();
            routePlannerAwayRef.current = false;
            routePlannerReturnFieldRef.current = null;
            openStartedRef.current = false;
            presentationOpacity.value = PREWARM_PRESENTATION_OPACITY;
            closingRef.current = false;
            if (shouldNotifyClose) {
                onClose();
            }
        },
        [cancelPendingPhotoAction, invalidatePendingAnalysis, onClose, presentationOpacity, prewarm],
    );

    const runCloseAnimation = useCallback(
        (shouldNotifyClose = false) => {
            Keyboard.dismiss();
            // 권한 확인/온라인 인식 동의/ActionSheet 지연 작업은 화면 수명보다 오래
            // 살아남을 수 있으므로 닫기 시작 시 세대와 예약 작업을 즉시 무효화한다.
            liveSpeechOperationRef.current += 1;
            liveSpeechStartingRef.current = false;
            liveSpeechCaptureActiveRef.current = false;
            liveSpeechCaptureStartedAtRef.current = 0;
            photoSourceOperationRef.current += 1;
            cancelPendingPhotoAction();
            if (audioRecordingRef.current || isVoiceRecording || isVoiceFinalizing || voiceUri) {
                void stopActiveRecording();
            }
            if (openHandoffFrameRef.current !== null) {
                cancelAnimationFrame(openHandoffFrameRef.current);
                openHandoffFrameRef.current = null;
            }
            if (closeFinishTimerRef.current) {
                clearTimeout(closeFinishTimerRef.current);
                closeFinishTimerRef.current = null;
            }
            closeFinishedRef.current = false;
            closingPhase.value = 1;
            const closeDuration = resolveAddHandoffCloseDuration(progress.value);
            cancelAnimation(progress);
            progress.value = withDelay(
                CLOSE_SURFACE_DELAY_MS,
                withTiming(
                    0,
                    {
                        duration: closeDuration,
                        easing: CLOSE_EASING,
                    },
                    finished => {
                        if (finished) {
                            runOnJS(finishClose)(shouldNotifyClose);
                        }
                    },
                ),
            );
            closeFinishTimerRef.current = setTimeout(() => {
                finishClose(shouldNotifyClose);
            }, CLOSE_SURFACE_DELAY_MS + closeDuration + 48);
        },
        [
            cancelPendingPhotoAction,
            closingPhase,
            finishClose,
            isVoiceFinalizing,
            isVoiceRecording,
            progress,
            stopActiveRecording,
            voiceUri,
        ],
    );

    const requestClose = useCallback(() => {
        if ((submitting && flowStep !== "analyzing") || closingRef.current) return;

        if (flowStep === "analyzing") {
            invalidatePendingAnalysis();
            setSubmitting(false);
        }

        const feedback =
            (flowStep === "preview" || flowStep === "edit") && previewDraft
                ? buildQuickScheduleReliabilityFeedback(previewDraft, "CANCELLED")
                : null;
        if (feedback) {
            void Promise.resolve(onFeedback?.(feedback)).catch(() => undefined);
        }
        closingRef.current = true;
        onCloseStart?.();
        runCloseAnimation(true);
    }, [flowStep, invalidatePendingAnalysis, onCloseStart, onFeedback, previewDraft, runCloseAnimation, submitting]);

    const startOpenAnimation = useCallback(
        (openCycle: number) => {
            if (
                !visibleRef.current ||
                openCycle !== openCycleRef.current ||
                openStartedRef.current ||
                closingRef.current
            )
                return;

            openStartedRef.current = true;
            // Let the card leave the menu on the same compositor clock as the
            // ownership crossfade. Holding geometry until the native renderer was
            // gone produced two visibly blank white frames after row selection.
            presentationOpacity.value = withTiming(1, {
                duration: ADD_HANDOFF_MOTION.ownershipCrossfadeMs,
                easing: ReanimatedEasing.linear,
            });
            progress.value = withTiming(1, {
                duration: Math.round(OPEN_DURATION_MS * (1 - OPEN_START_PROGRESS)),
                easing: OPEN_EASING,
            });
            // Queue both UI-thread animations before asking the native host to
            // retire, so the source can never disappear one compositor tick early.
            onMorphReady?.();
        },
        [onMorphReady, presentationOpacity, progress],
    );

    const presentPrewarmedMorph = useCallback(() => {
        if (
            !prewarm ||
            !rendered ||
            !contentMounted ||
            routePlannerHidden ||
            !seedHasLayoutRef.current ||
            closingRef.current
        ) {
            return false;
        }

        closeFinishedRef.current = false;
        visibleRef.current = true;
        closingRef.current = false;
        closingPhase.value = 0;
        cancelAnimation(progress);
        progress.value = OPEN_START_PROGRESS;
        openStartedRef.current = false;
        openCycleRef.current += 1;
        // The layer is kept compositor-resident at a tiny opacity while idle,
        // so no extra paint frame is required before starting the handoff.
        presentationOpacity.value = PREWARM_PRESENTATION_OPACITY;
        const openCycle = openCycleRef.current;
        startOpenAnimation(openCycle);
        return true;
    }, [
        closingPhase,
        contentMounted,
        presentationOpacity,
        prewarm,
        progress,
        rendered,
        routePlannerHidden,
        startOpenAnimation,
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

    const scheduleOpenAfterPaint = useCallback(
        (openCycle: number) => {
            if (
                !visibleRef.current ||
                openStartedRef.current ||
                closingRef.current ||
                openHandoffFrameRef.current !== null
            )
                return;

            const paintFrame = requestAnimationFrame(() => {
                if (openHandoffFrameRef.current !== paintFrame) return;
                openHandoffFrameRef.current = null;
                startOpenAnimation(openCycle);
            });
            openHandoffFrameRef.current = paintFrame;
        },
        [startOpenAnimation],
    );

    const handleSeedLayout = useCallback(
        (event: LayoutChangeEvent) => {
            const { width: layoutWidth, height: layoutHeight } = event.nativeEvent.layout;
            if (layoutWidth <= 0 || layoutHeight <= 0) return;

            seedHasLayoutRef.current = true;
            if (
                !visibleRef.current ||
                openStartedRef.current ||
                closingRef.current ||
                openHandoffFrameRef.current !== null
            )
                return;

            const openCycle = openCycleRef.current;

            scheduleOpenAfterPaint(openCycle);
        },
        [scheduleOpenAfterPaint],
    );

    useLayoutEffect(() => {
        if (!prewarm || visible) return;

        // Build and lay out the expensive form while the calendar is idle.
        // A later tap only flips visibility and starts the UI-thread morph.
        setRendered(true);
        setContentMounted(true);
        setCardRasterized(true);
        if (!openStartedRef.current && !closingRef.current) {
            presentationOpacity.value = PREWARM_PRESENTATION_OPACITY;
        }
    }, [presentationOpacity, prewarm, visible]);

    useLayoutEffect(() => {
        if (!visible) return undefined;

        // The hidden, pre-composed seed can begin directly from the native
        // callback. Do not reset that UI-thread animation when the matching
        // React visibility commit arrives a frame or two later.
        if (openStartedRef.current) return undefined;

        closingRef.current = false;
        closeFinishedRef.current = false;
        openStartedRef.current = false;
        // Cache the dense form before the first visible morph frame. Toggling
        // rasterization at animation completion invalidated the layer exactly
        // when the handoff was meant to settle.
        setCardRasterized(true);
        openCycleRef.current += 1;
        if (closeFinishTimerRef.current) {
            clearTimeout(closeFinishTimerRef.current);
            closeFinishTimerRef.current = null;
        }
        setRendered(true);
        // Commit the expensive form before the seed layout starts motion.
        // This prevents a React mount from consuming the first animation
        // frames and making the card jump straight to its expanded state.
        setContentMounted(true);
        cancelAnimation(progress);
        closingPhase.value = 0;
        progress.value = OPEN_START_PROGRESS;
        presentationOpacity.value = prewarm ? PREWARM_PRESENTATION_OPACITY : 1;
        if (openHandoffFrameRef.current !== null) {
            cancelAnimationFrame(openHandoffFrameRef.current);
            openHandoffFrameRef.current = null;
        }
        if (seedHasLayoutRef.current) {
            scheduleOpenAfterPaint(openCycleRef.current);
        }
        return () => {
            if (openHandoffFrameRef.current !== null) {
                cancelAnimationFrame(openHandoffFrameRef.current);
                openHandoffFrameRef.current = null;
            }
            if (closeFinishTimerRef.current) {
                clearTimeout(closeFinishTimerRef.current);
                closeFinishTimerRef.current = null;
            }
        };
    }, [closingPhase, presentationOpacity, prewarm, progress, scheduleOpenAfterPaint, visible]);

    useEffect(() => {
        if (visible || !rendered || closingRef.current) return;

        if (!openStartedRef.current) {
            if (!prewarm) {
                setRendered(false);
                setContentMounted(false);
            }
            return;
        }

        closingRef.current = true;
        onCloseStart?.();
        runCloseAnimation(true);
    }, [onCloseStart, prewarm, rendered, runCloseAnimation, visible]);

    useEffect(() => {
        if (visible) return;
        liveSpeechOperationRef.current += 1;
        liveSpeechStartingRef.current = false;
        liveSpeechCaptureActiveRef.current = false;
        liveSpeechCaptureStartedAtRef.current = 0;
        photoSourceOperationRef.current += 1;
        cancelPendingPhotoAction();
    }, [cancelPendingPhotoAction, visible]);

    const startAnalysis = useCallback(
        async (textOverride?: string, inputTypeOverride?: QuickScheduleMediaInput["inputTypeOverride"]) => {
            const normalized = (textOverride ?? text).trim();
            const analysisInputMode: InputMode = inputTypeOverride ? "text" : inputMode;
            const hasCurrentInput =
                analysisInputMode === "text"
                    ? normalized.length > 0
                    : analysisInputMode === "photo"
                    ? Boolean(selectedPhoto?.uri && photoTranscript.trim())
                    : Boolean(voiceTranscript.trim() || voiceUri);
            if (
                !hasCurrentInput ||
                submitting ||
                analysisInFlightRef.current ||
                isVoiceRecording ||
                (analysisInputMode === "photo" && isPhotoRecognizing)
            )
                return;

            const fallbackText =
                analysisInputMode === "photo"
                    ? "사진으로 입력한 일정"
                    : analysisInputMode === "voice"
                    ? "음성으로 입력한 일정"
                    : "";
            const rawSourceText =
                analysisInputMode === "voice"
                    ? voiceTranscript.trim() || normalized || fallbackText
                    : analysisInputMode === "photo"
                    ? photoTranscript.trim() || normalized || fallbackText
                    : normalized || fallbackText;
            const sourceText = rawSourceText.slice(0, QUICK_TEXT_LIMIT);
            const analysisSequence = analysisSequenceRef.current + 1;
            analysisSequenceRef.current = analysisSequence;
            analysisInFlightRef.current = true;
            if (analysisPreviewTimerRef.current) {
                clearTimeout(analysisPreviewTimerRef.current);
                analysisPreviewTimerRef.current = null;
            }

            try {
                setSubmitting(true);
                setAnalysisError("");
                setFlowStep("analyzing");

                const parsed = await onAnalyze(sourceText, {
                    inputMode: analysisInputMode,
                    inputTypeOverride,
                    photoUri: analysisInputMode === "photo" ? selectedPhoto?.uri : undefined,
                    photoTranscript: analysisInputMode === "photo" ? sourceText || undefined : undefined,
                    voiceUri: analysisInputMode === "voice" ? voiceUri ?? undefined : undefined,
                    voiceDurationMillis: analysisInputMode === "voice" ? voiceDurationMillis : undefined,
                    voiceTranscript: analysisInputMode === "voice" ? sourceText || undefined : undefined,
                    voiceAlternatives: analysisInputMode === "voice" ? voiceRecognitionAlternatives : undefined,
                    recognitionConfidence:
                        analysisInputMode === "voice"
                            ? voiceRecognitionConfidence
                            : analysisInputMode === "photo"
                            ? photoRecognitionConfidence
                            : undefined,
                });
                if (analysisSequenceRef.current !== analysisSequence || !visibleRef.current) return;

                analysisPreviewTimerRef.current = setTimeout(() => {
                    analysisPreviewTimerRef.current = null;
                    if (analysisSequenceRef.current !== analysisSequence || !visibleRef.current) return;
                    setPreviewDraft(buildPreviewDraft(parsed, sourceText, defaultDay));
                    setPreviewSourceText(sourceText);
                    setFlowStep("preview");
                    setSubmitting(false);
                    analysisInFlightRef.current = false;
                }, 220);
            } catch (error) {
                if (analysisSequenceRef.current !== analysisSequence || !visibleRef.current) return;
                setAnalysisError(error instanceof Error ? error.message : "일정을 만들지 못했어요");
                setFlowStep("analysisError");
                setSubmitting(false);
                analysisInFlightRef.current = false;
            }
        },
        [
            defaultDay,
            inputMode,
            isPhotoRecognizing,
            isVoiceRecording,
            onAnalyze,
            photoRecognitionConfidence,
            photoTranscript,
            selectedPhoto?.uri,
            submitting,
            text,
            voiceDurationMillis,
            voiceRecognitionAlternatives,
            voiceRecognitionConfidence,
            voiceTranscript,
            voiceUri,
        ],
    );

    const submit = () => {
        void startAnalysis();
    };

    useEffect(() => {
        const requestId = initialRequestId?.trim();
        const seedText = initialText?.trim();
        if (!visible || !requestId || !seedText || initialRequestHandledRef.current === requestId) return;
        const boundedSeedText = seedText.slice(0, QUICK_TEXT_LIMIT);

        initialRequestHandledRef.current = requestId;
        setInputMode("text");
        setText(boundedSeedText);
        setSelectedPhoto(null);
        setPhotoTranscript("");
        setPhotoTranscriptTruncated(false);
        setPhotoRecognitionConfidence(undefined);
        setPhotoRecognitionError("");
        voiceDurationMillisRef.current = 0;
        voiceTranscriptRef.current = "";
        liveSpeechBaseDurationMillisRef.current = 0;
        liveSpeechTranscriptBufferRef.current = createLiveSpeechTranscriptBuffer();
        setVoiceUri(null);
        setVoiceDurationMillis(0);
        setVoiceTranscript("");
        setVoiceTranscriptTruncated(false);
        setVoiceRecognitionConfidence(undefined);
        setVoiceRecognitionAlternatives([]);
        setVoiceStatusMessage("");
        setAnalysisError("");
        setFlowStep("input");
        void startAnalysis(boundedSeedText, initialInputType);
    }, [initialInputType, initialRequestId, initialText, startAnalysis, visible]);

    const updatePreviewField = useCallback((field: PreviewField, value: string) => {
        setPreviewDraft(current => (current ? updateQuickSchedulePreviewDraft(current, field, value) : current));
    }, []);

    const openEditField = useCallback(
        (field: PreviewField) => {
            if (!previewDraft || submitting) return;

            setEditingField(field);
            setEditingValue(
                field === "notification"
                    ? String(previewDraft.notificationLeadMinutes ?? "none")
                    : String(previewDraft[field] ?? ""),
            );
            setEditingAlertMode(previewDraft.alertMode);
            setTimeEditMode("picker");
            setFlowStep("edit");
        },
        [previewDraft, submitting],
    );

    useEffect(() => {
        if (!visible || !initialPreviewField || flowStep !== "preview" || !previewDraft) return;

        const previewKey = `${initialRequestId ?? "preview"}:${initialPreviewField}`;
        if (initialPreviewFieldHandledRef.current === previewKey) return;
        initialPreviewFieldHandledRef.current = previewKey;
        openEditField(initialPreviewField);
    }, [flowStep, initialPreviewField, initialRequestId, openEditField, previewDraft, visible]);

    const confirmEditField = useCallback(() => {
        if (!editingField) return;

        if (editingField === "notification") {
            const leadMinutes = editingValue === "none" ? undefined : Number(editingValue);
            setPreviewDraft(current =>
                current
                    ? applyQuickScheduleNotificationSettings(current, {
                          leadMinutes,
                          alertMode: editingAlertMode,
                      })
                    : current,
            );
        } else {
            const nextValue =
                editingField === "time"
                    ? normalizeTimeInput(editingValue, previewDraft?.time ?? "09:00")
                    : editingValue.trim() ||
                      (editingField === "location"
                          ? "장소 미정"
                          : editingField === "title"
                          ? "새 일정"
                          : editingField === "memo"
                          ? "메모 없음"
                          : "");
            updatePreviewField(editingField, nextValue);
        }
        setEditingField(null);
        setEditingValue("");
        setEditingAlertMode("STANDARD");
        setTimeEditMode("picker");
        setFlowStep("preview");
    }, [editingAlertMode, editingField, editingValue, previewDraft?.time, updatePreviewField]);

    const cancelEditField = useCallback(() => {
        setEditingField(null);
        setEditingValue("");
        setEditingAlertMode("STANDARD");
        setTimeEditMode("picker");
        setFlowStep("preview");
    }, []);

    useEffect(() => {
        if (Platform.OS !== "android" || routePlannerHidden || (!visible && !rendered)) {
            return undefined;
        }

        const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
            if (flowStep === "edit") {
                cancelEditField();
                return true;
            }
            if (flowStep === "preview" || flowStep === "analysisError") {
                setFlowStep("input");
                return true;
            }
            if (flowStep === "analyzing") {
                invalidatePendingAnalysis();
                setSubmitting(false);
                setFlowStep("input");
                return true;
            }
            if (flowStep === "saving") return true;

            requestClose();
            return true;
        });
        return () => subscription.remove();
    }, [cancelEditField, flowStep, invalidatePendingAnalysis, rendered, requestClose, routePlannerHidden, visible]);

    const openRoutePlannerFromPreview = useCallback(() => {
        if (!previewDraft || submitting) return;

        const destination = previewDraft.destination ?? placeFromDraftLocation(previewDraft.location);
        const sessionId = `quick-route-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        routePlannerAwayRef.current = false;

        setRoutePlannerInitial(sessionId, {
            origin: previewDraft.origin,
            destination,
            travelMode: previewDraft.travelMode ?? previewDraft.parsed?.travelMode ?? "TRANSIT",
            travelMinutes: previewDraft.travelMinutes ?? previewDraft.parsed?.travelMinutes,
            locationName: destination?.name || destination?.address || undefined,
            targetArrivalAt: dateFromDraftTime(previewDraft.date, previewDraft.time).toISOString(),
            departureAt: previewDraft.departAt,
            route: previewDraft.route ?? previewDraft.parsed?.route,
        });

        Keyboard.dismiss();
        setRoutePlannerSessionId(sessionId);
        setRoutePlannerHidden(true);
        routePlannerReturnFieldRef.current = editingField;
        setEditingField(null);
        setEditingValue("");
        setTimeEditMode("picker");
        setFlowStep("preview");
        setRendered(false);
        try {
            router.push({
                pathname: "/schedule/route-select",
                params: { sessionId },
            });
        } catch {
            setRoutePlannerSessionId(undefined);
            setRoutePlannerHidden(false);
            setRendered(true);
            setContentMounted(true);
            progress.value = 1;
            const returnField = routePlannerReturnFieldRef.current;
            setEditingField(returnField);
            setEditingValue(
                returnField === "notification"
                    ? String(previewDraft.notificationLeadMinutes ?? "none")
                    : returnField
                    ? String(previewDraft[returnField] ?? "")
                    : "",
            );
            setFlowStep(returnField ? "edit" : "preview");
            routePlannerReturnFieldRef.current = null;
        }
    }, [editingField, previewDraft, progress, router, submitting]);

    useEffect(() => {
        if (!visible || !routePlannerSessionId) return;

        if (pathname === "/schedule/route-select" || pathname === "/schedule/route-planner") {
            routePlannerAwayRef.current = true;
            return;
        }

        if (!routePlannerAwayRef.current) return;

        const result = consumeRoutePlannerResult(routePlannerSessionId);
        const returnField = routePlannerReturnFieldRef.current;
        routePlannerAwayRef.current = false;
        setRoutePlannerSessionId(undefined);
        setRoutePlannerHidden(false);
        setRendered(true);
        setContentMounted(true);
        closingRef.current = false;
        cancelAnimation(progress);
        progress.value = 1;
        setEditingField(null);
        setEditingValue("");
        setTimeEditMode("picker");
        setFlowStep("preview");

        if (result && previewDraft) {
            const nextDraft = applyRouteResultToPreviewDraft(previewDraft, result);
            setPreviewDraft(nextDraft);
            if (returnField === "notification") {
                setEditingField("notification");
                setEditingValue(String(nextDraft.notificationLeadMinutes ?? "none"));
                setFlowStep("edit");
            }
        } else if (returnField && previewDraft) {
            // 경로 화면에서 뒤로가거나 취소해도 사용자가 떠났던 편집 문맥으로 돌아간다.
            // 경로 결과가 없으므로 기존 초안과 편집값을 그대로 보존한다.
            setEditingField(returnField);
            setEditingValue(
                returnField === "notification"
                    ? String(previewDraft.notificationLeadMinutes ?? "none")
                    : String(previewDraft[returnField] ?? ""),
            );
            setFlowStep("edit");
        }
        routePlannerReturnFieldRef.current = null;
    }, [pathname, previewDraft, progress, routePlannerSessionId, visible]);

    const savePreview = async () => {
        if (!previewDraft || submitting || saveInFlightRef.current) return;

        if (!defaultCategory || !canWriteScheduleCategory(defaultCategory)) {
            Alert.alert(
                "카테고리가 필요해요",
                categoryError
                    ? "카테고리를 다시 불러온 뒤 일정을 저장해 주세요."
                    : "카테고리를 만든 뒤 일정을 저장해 주세요.",
            );
            return;
        }

        const blockingReviewField = getQuickScheduleBlockingReviewField(previewDraft);
        if (blockingReviewField) {
            if (blockingReviewField === "review") return;
            openEditField(blockingReviewField);
            return;
        }

        try {
            saveInFlightRef.current = true;
            setSubmitting(true);
            setFlowStep("saving");
            await onSave(buildQuickSchedulePayload(previewDraft, defaultCategory));
            const feedback = buildQuickScheduleReliabilityFeedback(previewDraft, "SAVED");
            if (feedback) {
                void Promise.resolve(onFeedback?.(feedback)).catch(() => undefined);
            }
            setFlowStep("saved");
        } catch (error) {
            Alert.alert("일정 저장 실패", error instanceof Error ? error.message : "일정을 저장하지 못했습니다.");
            setFlowStep("preview");
        } finally {
            saveInFlightRef.current = false;
            setSubmitting(false);
        }
    };

    const selectPhotoForRecognition = useCallback((asset: ImagePickerAsset | null) => {
        setSelectedPhoto(asset);
        setPhotoRecognitionAttempt(current => current + 1);
    }, []);

    const pickPhotoFromLibrary = useCallback(async () => {
        if (submitting || !mountedRef.current || !visibleRef.current || closingRef.current) return;

        const operation = photoSourceOperationRef.current + 1;
        photoSourceOperationRef.current = operation;
        Keyboard.dismiss();
        await stopActiveRecording();
        if (
            photoSourceOperationRef.current !== operation ||
            !mountedRef.current ||
            !visibleRef.current ||
            closingRef.current
        )
            return;
        setInputMode("photo");

        try {
            // iOS의 시스템 PHPicker는 사용자가 고른 항목만 전달하므로 전체 사진 보관함
            // 권한을 선요청할 필요가 없다. 권한이 거부된 사용자도 선택기를 사용할 수 있다.
            if (Platform.OS !== "ios") {
                const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
                if (!permission.granted) {
                    Alert.alert("사진 권한 필요", "사진으로 빠른 일정을 만들려면 사진 보관함 권한이 필요합니다.");
                    return;
                }
            }
            if (
                photoSourceOperationRef.current !== operation ||
                !mountedRef.current ||
                !visibleRef.current ||
                closingRef.current
            )
                return;

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images"],
                allowsMultipleSelection: false,
                // 얇은 연필선과 작은 손글씨가 JPEG 재압축에서 뭉개지지 않도록 OCR 입력은
                // 원본 품질과 현재 에셋 표현(HEIC/JPEG 등)을 우선 사용한다.
                quality: 1,
                preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
            });

            if (
                photoSourceOperationRef.current === operation &&
                mountedRef.current &&
                visibleRef.current &&
                !closingRef.current &&
                !result.canceled
            ) {
                selectPhotoForRecognition(result.assets[0] ?? null);
            }
        } catch (error) {
            if (
                photoSourceOperationRef.current !== operation ||
                !mountedRef.current ||
                !visibleRef.current ||
                closingRef.current
            )
                return;
            Alert.alert("사진 선택 실패", error instanceof Error ? error.message : "사진을 불러오지 못했습니다.");
        }
    }, [selectPhotoForRecognition, stopActiveRecording, submitting]);

    const capturePhoto = useCallback(async () => {
        if (submitting || !mountedRef.current || !visibleRef.current || closingRef.current) return;

        const operation = photoSourceOperationRef.current + 1;
        photoSourceOperationRef.current = operation;
        Keyboard.dismiss();
        await stopActiveRecording();
        if (
            photoSourceOperationRef.current !== operation ||
            !mountedRef.current ||
            !visibleRef.current ||
            closingRef.current
        )
            return;
        setInputMode("photo");

        try {
            const permission = await ImagePicker.requestCameraPermissionsAsync();
            if (!permission.granted) {
                Alert.alert("카메라 권한 필요", "사진을 촬영해 빠른 일정을 만들려면 카메라 권한이 필요합니다.");
                return;
            }
            if (
                photoSourceOperationRef.current !== operation ||
                !mountedRef.current ||
                !visibleRef.current ||
                closingRef.current
            )
                return;

            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ["images"],
                allowsEditing: false,
                // 촬영 직후 압축으로 획이 사라지는 것을 피한다. 네이티브 OCR에서 해상도 상한을
                // 적용하므로 여기서는 인식에 필요한 원본 픽셀을 보존한다.
                quality: 1,
            });

            if (
                photoSourceOperationRef.current === operation &&
                mountedRef.current &&
                visibleRef.current &&
                !closingRef.current &&
                !result.canceled
            ) {
                selectPhotoForRecognition(result.assets[0] ?? null);
            }
        } catch (error) {
            if (
                photoSourceOperationRef.current !== operation ||
                !mountedRef.current ||
                !visibleRef.current ||
                closingRef.current
            )
                return;
            Alert.alert("촬영 실패", error instanceof Error ? error.message : "카메라를 열지 못했습니다.");
        }
    }, [selectPhotoForRecognition, stopActiveRecording, submitting]);

    const activatePhotoMode = useCallback(() => {
        if (submitting) return;

        cancelPendingPhotoAction();
        Keyboard.dismiss();
        void stopActiveRecording();
        setInputMode("photo");
    }, [cancelPendingPhotoAction, stopActiveRecording, submitting]);

    const schedulePhotoAction = useCallback(
        (expectedSourceOperation: number, action: () => void) => {
            cancelPendingPhotoAction();
            pendingPhotoActionCancelRef.current = runAfterInteraction(() => {
                pendingPhotoActionCancelRef.current = null;
                if (
                    photoSourceOperationRef.current !== expectedSourceOperation ||
                    !mountedRef.current ||
                    !visibleRef.current ||
                    closingRef.current
                )
                    return;
                action();
            });
        },
        [cancelPendingPhotoAction],
    );

    const openPhotoActionSheet = useCallback(async () => {
        if (submitting || !mountedRef.current || !visibleRef.current || closingRef.current) return;

        const operation = photoSourceOperationRef.current + 1;
        photoSourceOperationRef.current = operation;
        cancelPendingPhotoAction();
        Keyboard.dismiss();
        await stopActiveRecording();
        if (
            photoSourceOperationRef.current !== operation ||
            !mountedRef.current ||
            !visibleRef.current ||
            closingRef.current
        )
            return;
        setInputMode("photo");

        if (Platform.OS === "ios") {
            const options = ["사진 찍기", "사진 앱에서 선택", "취소"];
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    title: "사진으로 일정 만들기",
                    options,
                    cancelButtonIndex: options.length - 1,
                    userInterfaceStyle: mode === "dark" ? "dark" : "light",
                },
                buttonIndex => {
                    if (
                        photoSourceOperationRef.current !== operation ||
                        !mountedRef.current ||
                        !visibleRef.current ||
                        closingRef.current
                    )
                        return;
                    if (buttonIndex === 0) {
                        schedulePhotoAction(operation, () => void capturePhoto());
                    }
                    if (buttonIndex === 1) {
                        schedulePhotoAction(operation, () => void pickPhotoFromLibrary());
                    }
                },
            );
            return;
        }

        Alert.alert("사진으로 일정 만들기", undefined, [
            {
                text: "사진 찍기",
                onPress: () => schedulePhotoAction(operation, () => void capturePhoto()),
            },
            {
                text: "사진 앱에서 선택",
                onPress: () => schedulePhotoAction(operation, () => void pickPhotoFromLibrary()),
            },
            { text: "취소", style: "cancel" },
        ]);
    }, [
        capturePhoto,
        cancelPendingPhotoAction,
        mode,
        pickPhotoFromLibrary,
        schedulePhotoAction,
        stopActiveRecording,
        submitting,
    ]);

    const beginLiveSpeechCapture = useCallback(
        async (requiresOnDeviceRecognition: boolean, startMode: LiveSpeechCaptureStartMode = "fresh") => {
            if (
                !mountedRef.current ||
                !visibleRef.current ||
                closingRef.current ||
                liveSpeechSessionIdRef.current ||
                liveSpeechStartingRef.current ||
                liveSpeechStopInFlightRef.current
            )
                return;
            if (startMode === "rollover" && !liveSpeechCaptureActiveRef.current) return;

            if (startMode === "fresh") {
                liveSpeechCaptureActiveRef.current = true;
                liveSpeechCaptureStartedAtRef.current = Date.now();
                voiceDurationMillisRef.current = 0;
                voiceTranscriptRef.current = "";
                liveSpeechBaseDurationMillisRef.current = 0;
                liveSpeechTranscriptBufferRef.current = createLiveSpeechTranscriptBuffer();
                setVoiceDurationMillis(0);
                setVoiceTranscript("");
                setVoiceTranscriptTruncated(false);
                setVoiceRecognitionConfidence(undefined);
                setVoiceRecognitionAlternatives([]);
            }
            liveSpeechRequiresOnDeviceRecognitionRef.current = requiresOnDeviceRecognition;

            const captureWallTimeMillis =
                liveSpeechCaptureStartedAtRef.current > 0 ? Date.now() - liveSpeechCaptureStartedAtRef.current : 0;
            const totalElapsedMillis = Math.max(voiceDurationMillisRef.current, captureWallTimeMillis);
            const remainingDurationMillis = LIVE_SPEECH_TOTAL_DURATION_MILLIS - totalElapsedMillis;
            if (remainingDurationMillis < LIVE_SPEECH_MIN_SESSION_DURATION_MILLIS) {
                liveSpeechCaptureActiveRef.current = false;
                liveSpeechCaptureStartedAtRef.current = 0;
                setIsVoiceRecording(false);
                setIsVoiceFinalizing(false);
                setVoiceStatusMessage("");
                return;
            }

            const operation = liveSpeechOperationRef.current + 1;
            liveSpeechOperationRef.current = operation;
            const requestedSessionId = createLiveSpeechSessionId();
            liveSpeechTranscriptBufferRef.current = createLiveSpeechTranscriptBuffer(voiceTranscriptRef.current);
            liveSpeechBaseDurationMillisRef.current = voiceDurationMillisRef.current;
            liveSpeechSessionIdRef.current = requestedSessionId;
            liveSpeechStartingRef.current = true;
            setIsVoiceFinalizing(true);
            const onlineRecognizerName = Platform.OS === "ios" ? "Apple" : "Android";
            setVoiceStatusMessage(
                requiresOnDeviceRecognition
                    ? "오프라인 음성 입력을 시작하고 있어요."
                    : "인터넷 음성 입력을 시작하고 있어요.",
            );

            try {
                const sessionId = await startLiveSpeechRecognition({
                    sessionId: requestedSessionId,
                    localeIdentifier: "ko-KR",
                    contextualStrings: buildScheduleSpeechContext(
                        `${text} ${voiceTranscriptRef.current} ${defaultCategory?.title ?? ""}`,
                    ),
                    maxDurationMillis: remainingDurationMillis,
                    requiresOnDeviceRecognition,
                });
                if (
                    !liveSpeechStartingRef.current ||
                    liveSpeechOperationRef.current !== operation ||
                    liveSpeechSessionIdRef.current !== sessionId ||
                    !visibleRef.current ||
                    closingRef.current ||
                    !liveSpeechCaptureActiveRef.current
                ) {
                    await cancelLiveSpeechRecognition(sessionId).catch(() => undefined);
                    return;
                }

                liveSpeechSessionIdRef.current = sessionId;
                liveSpeechStartingRef.current = false;
                setIsVoiceFinalizing(false);
                setIsVoiceRecording(true);
                setVoiceStatusMessage(
                    requiresOnDeviceRecognition
                        ? "음성을 글자로 옮기고 있어요."
                        : `인터넷 음성 입력 사용 중 · 음성은 ${onlineRecognizerName} 서비스로 전송될 수 있지만 NoLate에는 저장되지 않아요.`,
                );
            } catch (error) {
                const ownsOperation = liveSpeechOperationRef.current === operation;
                if (!ownsOperation) return;
                if (liveSpeechSessionIdRef.current === requestedSessionId) {
                    liveSpeechSessionIdRef.current = null;
                }
                liveSpeechStartingRef.current = false;
                liveSpeechCaptureActiveRef.current = false;
                liveSpeechCaptureStartedAtRef.current = 0;
                if (!mountedRef.current || !visibleRef.current || closingRef.current) return;
                setIsVoiceRecording(false);
                setIsVoiceFinalizing(false);
                setVoiceMeterHistory(createVoiceMeterHistory());
                const message = error instanceof Error ? error.message : "음성 입력을 시작하지 못했어요.";
                setVoiceStatusMessage(message);
                Alert.alert("음성 입력을 시작하지 못했어요", message);
            }
        },
        [defaultCategory?.title, text],
    );

    useEffect(() => {
        beginLiveSpeechCaptureRef.current = beginLiveSpeechCapture;
        return () => {
            if (beginLiveSpeechCaptureRef.current === beginLiveSpeechCapture) {
                beginLiveSpeechCaptureRef.current = null;
            }
        };
    }, [beginLiveSpeechCapture]);

    const startVoiceRecording = useCallback(async () => {
        if (
            submitting ||
            isVoiceRecording ||
            isVoiceFinalizing ||
            audioRecordingRef.current ||
            liveSpeechSessionIdRef.current ||
            liveSpeechStartingRef.current ||
            liveSpeechStopInFlightRef.current ||
            !mountedRef.current ||
            !visibleRef.current ||
            closingRef.current
        )
            return;

        const operation = liveSpeechOperationRef.current + 1;
        liveSpeechOperationRef.current = operation;
        liveSpeechStartingRef.current = true;
        setIsVoiceFinalizing(true);

        const startIsCurrent = () =>
            liveSpeechOperationRef.current === operation &&
            liveSpeechStartingRef.current &&
            mountedRef.current &&
            visibleRef.current &&
            !closingRef.current;
        const pendingCleanup = recordingCleanupPromiseRef.current;
        if (pendingCleanup) {
            setVoiceStatusMessage("이전 음성 입력을 마무리하고 있어요.");
            await pendingCleanup.catch(() => undefined);
            if (!startIsCurrent()) return;
        }

        Keyboard.dismiss();
        setInputMode("voice");
        setSelectedPhoto(null);
        setVoiceUri(null);
        setVoiceStatusMessage("");
        setVoiceMeterHistory(createVoiceMeterHistory());
        clearVoiceTimer();

        try {
            const permission = await Audio.requestPermissionsAsync();
            if (!startIsCurrent()) return;
            if (!permission.granted) {
                liveSpeechStartingRef.current = false;
                setIsVoiceFinalizing(false);
                Alert.alert("마이크 권한 필요", "음성으로 빠른 일정을 만들려면 마이크 권한이 필요합니다.");
                return;
            }
        } catch (error) {
            if (!startIsCurrent()) return;
            liveSpeechStartingRef.current = false;
            setIsVoiceFinalizing(false);
            Alert.alert(
                "마이크 권한 확인 실패",
                error instanceof Error ? error.message : "마이크 권한을 확인하지 못했습니다.",
            );
            return;
        }

        if (isLiveSpeechRecognitionAvailable) {
            setVoiceStatusMessage("음성 입력을 준비하고 있어요.");

            try {
                const availability = await getLiveSpeechRecognitionAvailability("ko-KR");
                if (!startIsCurrent()) return;

                liveSpeechStartingRef.current = false;
                setIsVoiceFinalizing(false);
                if (!availability.serviceAvailable) {
                    const message =
                        availability.reason ?? "현재 이 기기에서 한국어 음성 인식 서비스를 사용할 수 없습니다.";
                    setVoiceStatusMessage(`${message} 아래 입력칸에 직접 입력할 수 있어요.`);
                    Alert.alert("음성 인식 사용 불가", `${message}\n\n아래 인식 문장 칸에 일정을 직접 입력해 주세요.`);
                    return;
                }

                if (availability.supportsOnDevice) {
                    await beginLiveSpeechCapture(true);
                    return;
                }

                const reason = availability.reason ?? "이 기기에서는 오프라인 음성 입력을 사용할 수 없어요.";
                setVoiceStatusMessage(`${reason} 직접 입력하거나 온라인 인식을 선택할 수 있어요.`);
                Alert.alert(
                    "음성 입력 방법을 선택해 주세요",
                    `${reason}\n\n인터넷 음성 입력으로 계속하면 음성이 ${
                        Platform.OS === "ios" ? "Apple 음성 인식 서비스" : "Android 음성 인식 서비스"
                    }로 전송될 수 있지만, NoLate에는 저장되지 않아요.`,
                    [
                        { text: "직접 입력", style: "cancel" },
                        {
                            text: "인터넷 음성 입력",
                            onPress: () => {
                                if (
                                    liveSpeechOperationRef.current !== operation ||
                                    !visibleRef.current ||
                                    closingRef.current
                                )
                                    return;
                                void beginLiveSpeechCapture(false);
                            },
                        },
                    ],
                );
            } catch (error) {
                const ownsOperation = liveSpeechOperationRef.current === operation;
                if (!ownsOperation) return;
                liveSpeechStartingRef.current = false;
                if (!mountedRef.current || !visibleRef.current || closingRef.current) return;
                setIsVoiceRecording(false);
                setIsVoiceFinalizing(false);
                setVoiceMeterHistory(createVoiceMeterHistory());
                const message = error instanceof Error ? error.message : "음성 입력을 준비하지 못했어요.";
                setVoiceStatusMessage(`${message} 아래 입력칸에 직접 입력할 수 있어요.`);
                Alert.alert("음성 인식 확인 실패", message);
            }
            return;
        }

        voiceDurationMillisRef.current = 0;
        voiceTranscriptRef.current = "";
        liveSpeechBaseDurationMillisRef.current = 0;
        liveSpeechTranscriptBufferRef.current = createLiveSpeechTranscriptBuffer();
        setVoiceDurationMillis(0);
        setVoiceTranscript("");
        setVoiceTranscriptTruncated(false);
        setVoiceRecognitionConfidence(undefined);
        setVoiceRecognitionAlternatives([]);

        let recorder: Audio.Recording | null = null;
        let recordingAudioModeEnabled = false;
        const restorePlaybackAudioMode = async () => {
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
            }).catch(() => undefined);
        };
        const discardPreparedRecorder = async () => {
            const staleRecorder = recorder;
            recorder = null;
            if (staleRecorder) {
                await staleRecorder.stopAndUnloadAsync().catch(() => undefined);
            }
            if (recordingAudioModeEnabled) {
                recordingAudioModeEnabled = false;
                await restorePlaybackAudioMode();
            }
        };

        try {
            await waitForAudioForegroundReady();
            if (!startIsCurrent()) return;
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
            });
            recordingAudioModeEnabled = true;
            if (!startIsCurrent()) {
                await discardPreparedRecorder();
                return;
            }

            const prepareAndStartRecording = async () => {
                const candidate = new Audio.Recording();
                recorder = candidate;
                try {
                    await candidate.prepareToRecordAsync({
                        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
                        isMeteringEnabled: true,
                    });
                    await candidate.startAsync();
                    return candidate;
                } catch (error) {
                    await candidate.stopAndUnloadAsync().catch(() => undefined);
                    if (recorder === candidate) recorder = null;
                    throw error;
                }
            };

            try {
                recorder = await prepareAndStartRecording();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (!message.includes("background")) {
                    throw error;
                }

                if (!startIsCurrent()) {
                    await discardPreparedRecorder();
                    return;
                }
                await waitForAudioForegroundReady();
                if (!startIsCurrent()) {
                    await discardPreparedRecorder();
                    return;
                }
                recorder = await prepareAndStartRecording();
            }

            if (!startIsCurrent()) {
                await discardPreparedRecorder();
                return;
            }
            audioRecordingRef.current = recorder;
            recorder = null;
            liveSpeechStartingRef.current = false;
            setIsVoiceFinalizing(false);
            setIsVoiceRecording(true);
            voiceTimerRef.current = setInterval(() => {
                const activeRecorder = audioRecordingRef.current;
                if (!activeRecorder) return;

                void activeRecorder
                    .getStatusAsync()
                    .then(status => {
                        if ("durationMillis" in status) {
                            setVoiceDurationMillis(status.durationMillis ?? 0);
                        }
                        const normalizedMetering = normalizeVoiceMetering(status.metering);
                        if (normalizedMetering !== null) {
                            setVoiceMeterHistory(current => appendVoiceMeterHistory(current, normalizedMetering));
                        }
                    })
                    .catch(() => undefined);
            }, 110);
        } catch (error) {
            await discardPreparedRecorder();
            // Audio-mode restoration is asynchronous. Re-check ownership after it
            // completes so a close/mode change during cleanup cannot surface a stale
            // alert or update a hidden/unmounted form.
            if (!startIsCurrent()) return;
            audioRecordingRef.current = null;
            liveSpeechStartingRef.current = false;
            clearVoiceTimer();
            setIsVoiceRecording(false);
            setIsVoiceFinalizing(false);
            setVoiceMeterHistory(createVoiceMeterHistory());
            console.warn("[QuickSchedule] Voice recording failed to start.", error);
            Alert.alert("녹음 시작 실패", "음성 녹음을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
    }, [beginLiveSpeechCapture, clearVoiceTimer, isVoiceFinalizing, isVoiceRecording, submitting]);

    const stopVoiceRecording = useCallback(async () => {
        if (isVoiceFinalizing || liveSpeechStopInFlightRef.current) return;

        liveSpeechCaptureActiveRef.current = false;
        liveSpeechCaptureStartedAtRef.current = 0;
        const liveSpeechSessionId = liveSpeechSessionIdRef.current;
        if (liveSpeechSessionId) {
            const operation = liveSpeechOperationRef.current;
            const stopOperation = { operation, sessionId: liveSpeechSessionId };
            liveSpeechStopInFlightRef.current = stopOperation;
            setIsVoiceRecording(false);
            setIsVoiceFinalizing(true);
            setVoiceStatusMessage("마지막 문장을 정리하고 있어요.");
            try {
                const result = await stopLiveSpeechRecognition(liveSpeechSessionId);
                if (
                    liveSpeechStopInFlightRef.current !== stopOperation ||
                    liveSpeechOperationRef.current !== operation ||
                    !mountedRef.current ||
                    !visibleRef.current ||
                    closingRef.current
                )
                    return;
                const snapshot = accumulateLiveSpeechTranscript(liveSpeechTranscriptBufferRef.current, result);
                liveSpeechTranscriptBufferRef.current = snapshot.buffer;
                const limited = limitRecognizedText(snapshot.text);
                voiceTranscriptRef.current = limited.text;
                setVoiceTranscript(limited.text);
                setVoiceTranscriptTruncated(limited.truncated);
                setVoiceRecognitionAlternatives(limitRecognitionAlternatives(snapshot.alternatives));
                setVoiceRecognitionConfidence(result.confidence);
                if (result.elapsedMillis !== undefined) {
                    const durationMillis = Math.min(
                        LIVE_SPEECH_TOTAL_DURATION_MILLIS,
                        liveSpeechBaseDurationMillisRef.current + result.elapsedMillis,
                    );
                    voiceDurationMillisRef.current = durationMillis;
                    setVoiceDurationMillis(durationMillis);
                }
                setVoiceStatusMessage("");
            } catch (error) {
                if (
                    liveSpeechStopInFlightRef.current !== stopOperation ||
                    liveSpeechOperationRef.current !== operation ||
                    !mountedRef.current ||
                    !visibleRef.current ||
                    closingRef.current
                )
                    return;
                const message = error instanceof Error ? error.message : "말한 내용을 불러오지 못했어요.";
                setVoiceStatusMessage(message);
                Alert.alert("음성 입력을 마치지 못했어요", message);
            } finally {
                const ownsStopOperation = liveSpeechStopInFlightRef.current === stopOperation;
                if (ownsStopOperation) {
                    liveSpeechStopInFlightRef.current = null;
                }
                if (!ownsStopOperation || liveSpeechOperationRef.current !== operation) return;
                if (liveSpeechSessionIdRef.current === liveSpeechSessionId) {
                    liveSpeechSessionIdRef.current = null;
                }
                liveSpeechStartingRef.current = false;
                if (!mountedRef.current || !visibleRef.current || closingRef.current) return;
                setIsVoiceRecording(false);
                setIsVoiceFinalizing(false);
                setVoiceMeterHistory(createVoiceMeterHistory());
            }
            return;
        }

        if (!audioRecordingRef.current) return;

        setIsVoiceFinalizing(true);
        const cleanupPromise = stopActiveRecording(true);
        const cleanupOperation = liveSpeechOperationRef.current;
        try {
            await cleanupPromise;
        } catch (error) {
            if (
                liveSpeechOperationRef.current !== cleanupOperation ||
                !mountedRef.current ||
                !visibleRef.current ||
                closingRef.current
            )
                return;
            setVoiceUri(null);
            Alert.alert(
                "녹음 저장 실패",
                error instanceof Error ? error.message : "녹음 파일을 저장하지 못했습니다. 다시 녹음해 주세요.",
            );
        } finally {
            if (
                liveSpeechOperationRef.current === cleanupOperation &&
                mountedRef.current &&
                visibleRef.current &&
                !closingRef.current
            ) {
                setIsVoiceFinalizing(false);
            }
        }
    }, [isVoiceFinalizing, stopActiveRecording]);

    const handleModePress = useCallback(
        (nextMode: InputMode) => {
            if (nextMode === "photo") {
                activatePhotoMode();
                return;
            }

            photoSourceOperationRef.current += 1;
            cancelPendingPhotoAction();
            if (nextMode === "voice") {
                if (inputMode !== "voice") {
                    void stopActiveRecording();
                }
                setInputMode("voice");
                return;
            }

            void stopActiveRecording();
            setInputMode(nextMode);
        },
        [activatePhotoMode, cancelPendingPhotoAction, inputMode, stopActiveRecording],
    );

    useEffect(() => {
        return () => {
            invalidatePendingAnalysis();
            photoSourceOperationRef.current += 1;
            cancelPendingPhotoAction();
            void stopActiveRecording();
            if (closeFinishTimerRef.current) {
                clearTimeout(closeFinishTimerRef.current);
                closeFinishTimerRef.current = null;
            }
        };
    }, [cancelPendingPhotoAction, invalidatePendingAnalysis, stopActiveRecording]);

    useEffect(() => {
        const selectedLayout = modeLayouts[inputMode];
        if (!selectedLayout) return;

        modeIndicatorX.value = withSpring(selectedLayout.x, MODE_PILL_SPRING);
        modeIndicatorWidth.value = withSpring(selectedLayout.width, MODE_PILL_SPRING);
    }, [inputMode, modeIndicatorWidth, modeIndicatorX, modeLayouts]);

    useEffect(() => {
        expandedCardHeight.value = withSpring(cardHeight, CARD_SIZE_SPRING);
    }, [cardHeight, expandedCardHeight]);

    const cardMotionRadiusStyle = useAnimatedStyle(() => {
        const motionProgress = progress.value;
        const finalHeight = expandedCardHeight.value;
        const closing = closingPhase.value >= 0.5;
        const activeSourceRadius = closingPhase.value >= 0.5 ? closeSourceRadius : openSourceRadius;
        const activeSourceHeight = closing ? closeSourceHeight : openSourceHeight;
        const scaleY = lerpAddHandoffValue(activeSourceHeight / finalHeight, 1, motionProgress);
        const visualRadius = lerpAddHandoffValue(activeSourceRadius, EXPANDED_CARD_RADIUS, motionProgress);
        return {
            borderRadius: visualRadius / Math.max(scaleY, 0.01),
        };
    }, [closeSourceHeight, closeSourceRadius, expandedCardHeight, openSourceHeight, openSourceRadius]);

    const cardClipRadiusStyle = useAnimatedStyle(() => {
        const motionProgress = progress.value;
        const finalHeight = expandedCardHeight.value;
        const closing = closingPhase.value >= 0.5;
        const activeSourceRadius = closingPhase.value >= 0.5 ? closeSourceRadius : openSourceRadius;
        const activeSourceHeight = closing ? closeSourceHeight : openSourceHeight;
        const scaleY = lerpAddHandoffValue(activeSourceHeight / finalHeight, 1, motionProgress);
        const visualRadius = lerpAddHandoffValue(activeSourceRadius, EXPANDED_CARD_RADIUS, motionProgress);
        return {
            borderRadius: visualRadius / Math.max(scaleY, 0.01),
        };
    }, [closeSourceHeight, closeSourceRadius, expandedCardHeight, openSourceHeight, openSourceRadius]);

    const cardMotionStyle = useAnimatedStyle(() => {
        const finalHeight = expandedCardHeight.value;
        const motionProgress = progress.value;
        const closing = closingPhase.value >= 0.5;
        const activeSourceLeft = closing ? closeSourceLeft : openSourceLeft;
        const activeSourceWidth = closing ? closeSourceWidth : openSourceWidth;
        const activeSourceHeight = closing ? closeSourceHeight : openSourceHeight;
        const scaleX = lerpAddHandoffValue(activeSourceWidth / cardWidth, 1, motionProgress);
        const scaleY = lerpAddHandoffValue(activeSourceHeight / finalHeight, 1, motionProgress);

        return {
            left: cardLeft,
            top: cardTop,
            width: cardWidth,
            height: finalHeight,
            transform: [
                {
                    translateX: lerpAddHandoffValue(activeSourceLeft - cardLeft, 0, motionProgress),
                },
                {
                    translateY: lerpAddHandoffValue(sourceTop - cardTop, 0, motionProgress),
                },
                { scaleX },
                { scaleY },
            ],
        };
    }, [
        cardLeft,
        cardTop,
        cardWidth,
        closeSourceHeight,
        closeSourceLeft,
        closeSourceWidth,
        openSourceHeight,
        openSourceLeft,
        openSourceWidth,
        sourceTop,
        expandedCardHeight,
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
                [ADD_HANDOFF_MOTION.closeContentParkedOpacity, ADD_HANDOFF_MOTION.closeContentParkedOpacity, 1, 1],
                Extrapolation.CLAMP,
            ),
        };
    });
    const contentRevealCurtainAnimatedStyle = useAnimatedStyle(() => {
        if (closingPhase.value >= 0.5) return { opacity: 0 };

        return {
            opacity: interpolate(
                progress.value,
                [0, ADD_HANDOFF_MOTION.contentRevealStartProgress, ADD_HANDOFF_MOTION.contentRevealEndProgress, 1],
                [1, 1, 0, 0],
                Extrapolation.CLAMP,
            ),
        };
    });
    const modeIndicatorAnimatedStyle = useAnimatedStyle(() => ({
        opacity: modeIndicatorWidth.value > 0 ? 1 : 0,
        width: modeIndicatorWidth.value,
        transform: [
            {
                translateX: modeIndicatorX.value,
            },
        ],
    }));
    const cardBorderColor = colors.border;
    // Keep the scaled layer lightweight. A live native blur is re-rasterized
    // while the card grows and was producing visible 26-35ms frame gaps.
    const cardSurfaceBackground = mode === "dark" ? "#1C1C1E" : "#FFFFFF";
    const segmentedBackground = colors.surface2;
    const selectedModeBackground = colors.surface;
    const inputBackground = colors.inputBackground;
    const mediaPanelBackground = colors.surface2;
    const voiceDurationText = formatVoiceDuration(
        recorderState.isRecording ? recorderState.durationMillis : voiceDurationMillis,
    );
    const voiceSpectrumEnergy = recorderState.isRecording ? voiceMeterHistory[voiceMeterHistory.length - 1] ?? 0 : 0;
    const voiceControlTitle = recorderState.isRecording
        ? "녹음 중"
        : isVoiceFinalizing
        ? "확인 중"
        : voiceTranscript.trim() || voiceUri
        ? "다시 말하기"
        : "말하기";
    const voiceControlMeta = recorderState.isRecording
        ? voiceDurationText
        : isVoiceFinalizing
        ? "잠시만 기다려 주세요"
        : voiceTranscript.trim() || voiceUri
        ? voiceDurationText
        : voiceStatusMessage || "눌러서 시작";
    const selectedPhotoAspectRatio =
        selectedPhoto?.width && selectedPhoto.height ? selectedPhoto.width / selectedPhoto.height : 1;
    const photoPreviewAspectRatio = resolvePhotoPreviewAspectRatio(selectedPhotoAspectRatio);
    const photoPreviewContentWidth = cardWidth - 46;
    const photoScanFrameStyle = {
        width: Math.min(photoPreviewContentWidth, PHOTO_PREVIEW_STAGE_HEIGHT * photoPreviewAspectRatio),
        height: Math.min(PHOTO_PREVIEW_STAGE_HEIGHT, photoPreviewContentWidth / photoPreviewAspectRatio),
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
    const photoErrorSurface = mode === "dark" ? "rgba(255,69,58,0.13)" : "rgba(239,68,68,0.065)";
    const photoErrorBorder = mode === "dark" ? "rgba(255,138,132,0.30)" : "rgba(217,74,74,0.18)";
    const photoErrorTitleColor = mode === "dark" ? "#FF8A84" : "#B42318";
    const photoErrorTextColor = mode === "dark" ? "#FFB2AD" : "#9F3A36";
    const canSubmit =
        (inputMode === "text"
            ? text.trim().length > 0
            : inputMode === "photo"
            ? Boolean(selectedPhoto?.uri && photoTranscript.trim())
            : Boolean(voiceTranscript.trim() || voiceUri)) &&
        !submitting &&
        !recorderState.isRecording &&
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
    const warningBackground = mode === "dark" ? "rgba(255,176,32,0.18)" : "rgba(255,176,32,0.16)";
    const warningTextColor = mode === "dark" ? "#FFD27A" : "#A45B00";
    const successColor = "#22C55E";
    const previewIconBackground = mode === "dark" ? "rgba(36,107,254,0.14)" : "rgba(36,107,254,0.09)";
    const previewDividerColor = mode === "dark" ? "rgba(84,84,88,0.65)" : "rgba(60,60,67,0.12)";
    const previewLabelColor = mode === "dark" ? "rgba(235,235,245,0.60)" : "rgba(60,60,67,0.60)";
    const previewChevronColor = mode === "dark" ? "#AEAEB2" : "#8E8E93";

    const getPreviewValue = useCallback((draft: PreviewDraft, field: PreviewField) => {
        switch (field) {
            case "date":
                return formatKoreanDate(draft.date);
            case "time":
                if (draft.hasExplicitEndTime) {
                    const startAt = dateFromDraftTime(draft.date, draft.time);
                    const endAt = new Date(startAt.getTime() + draft.durationMinutes * 60_000);
                    const endTime = formatKoreanTime(toHm(endAt));
                    return toYmd(startAt) === toYmd(endAt)
                        ? `${formatKoreanTime(draft.time)} ~ ${endTime}`
                        : `${formatKoreanTime(draft.time)} ~ ${formatKoreanDate(toYmd(endAt))} ${endTime}`;
                }
                return formatKoreanTime(draft.time);
            case "notification":
                if (!canUseRouteNotification(draft) || draft.notificationLeadMinutes === undefined) return "없음";
                return `${formatNotification(draft.notificationLeadMinutes)} · ${getScheduleAlertModeLabel(
                    draft.alertMode,
                )}`;
            case "location":
                return draft.location === "장소 미정" ? "미정" : draft.location;
            case "memo":
                return draft.memo === "메모 없음" ? "없음" : draft.memo;
            case "title":
            default:
                return draft.title;
        }
    }, []);

    const renderModeSelector = () => (
        <View
            style={[
                styles.modeSelector,
                {
                    backgroundColor: segmentedBackground,
                    borderColor: cardBorderColor,
                },
            ]}
        >
            <Reanimated.View
                pointerEvents="none"
                style={[
                    styles.modeSelectorIndicator,
                    {
                        backgroundColor: selectedModeBackground,
                        borderColor: cardBorderColor,
                    },
                    modeIndicatorAnimatedStyle,
                ]}
            />
            {INPUT_MODES.map(item => {
                const selected = item.key === inputMode;

                return (
                    <Pressable
                        key={item.key}
                        onLayout={handleModeLayout(item.key)}
                        onPress={() => handleModePress(item.key)}
                        disabled={submitting || isVoiceFinalizing || flowStep !== "input"}
                        accessibilityRole="tab"
                        accessibilityLabel={item.accessibilityLabel}
                        accessibilityState={{
                            selected,
                            disabled: submitting || isVoiceFinalizing || flowStep !== "input",
                        }}
                        style={({ pressed }) => [
                            styles.modeButton,
                            selected && styles.modeButtonSelected,
                            { opacity: pressed ? 0.7 : submitting ? 0.48 : 1 },
                        ]}
                    >
                        <Ionicons
                            accessible={false}
                            name={item.icon}
                            size={17}
                            color={selected ? BLUE : colors.textSecondary}
                        />
                        <Text
                            style={[styles.modeText, { color: selected ? colors.textPrimary : colors.textSecondary }]}
                        >
                            {item.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );

    const renderInputStep = () => (
        <View style={styles.inputStep}>
            <ScrollView
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                style={styles.inputStepScroll}
                contentContainerStyle={styles.inputStepScrollContent}
            >
                {renderModeSelector()}

                {inputMode === "text" && (
                    <View style={styles.textModeContent}>
                        <View style={styles.sectionHeader}>
                            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>일정 내용</Text>
                            <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
                                날짜, 시간, 장소를 자유롭게 적어 주세요.
                            </Text>
                        </View>
                        <View
                            style={[
                                styles.inputWrap,
                                {
                                    backgroundColor: inputBackground,
                                    borderColor: text.length > 0 ? colors.inputBorderFocused : colors.inputBorder,
                                },
                            ]}
                        >
                            <TextInput
                                ref={inputRef}
                                accessibilityLabel="빠른 일정 문장"
                                editable={!submitting}
                                multiline
                                maxLength={QUICK_TEXT_LIMIT}
                                value={text}
                                onChangeText={setText}
                                onSubmitEditing={submit}
                                placeholder={placeholderForMode(inputMode)}
                                placeholderTextColor={colors.inputPlaceholder}
                                returnKeyType="done"
                                selectionColor={BLUE}
                                style={[
                                    styles.input,
                                    {
                                        color: colors.textPrimary,
                                    },
                                ]}
                            />
                            <View style={styles.counterPill}>
                                <Text style={[styles.counter, { color: colors.textSecondary }]}>
                                    {text.length}/{QUICK_TEXT_LIMIT}
                                </Text>
                            </View>
                        </View>
                    </View>
                )}

                {inputMode === "photo" && (
                    <View style={styles.photoModeContent}>
                        {selectedPhoto?.uri ? (
                            <View
                                testID="quick-schedule-photo-preview"
                                style={[
                                    styles.photoPreviewButton,
                                    {
                                        backgroundColor: mode === "dark" ? "#060A12" : "#0A1220",
                                        borderColor: isPhotoRecognizing ? "rgba(94,215,247,0.58)" : colors.border,
                                    },
                                ]}
                            >
                                <Image
                                    accessible={false}
                                    source={{ uri: selectedPhoto.uri }}
                                    resizeMode="cover"
                                    style={styles.photoImageBackdrop}
                                />
                                <View pointerEvents="none" style={styles.photoImageBackdropScrim} />
                                <View style={styles.photoImageStage}>
                                    <QuickSchedulePhotoScanEffect
                                        active={isPhotoRecognizing}
                                        accessibilityLabel={
                                            isPhotoRecognizing ? "사진에서 일정 내용 읽는 중" : undefined
                                        }
                                        borderRadius={14}
                                        style={[styles.photoScanFrame, photoScanFrameStyle]}
                                    >
                                        <Image
                                            source={{ uri: selectedPhoto.uri }}
                                            resizeMode="contain"
                                            style={styles.photoImage}
                                        />
                                    </QuickSchedulePhotoScanEffect>
                                </View>

                                <View
                                    pointerEvents="none"
                                    testID="quick-schedule-photo-status"
                                    accessible={!isPhotoRecognizing}
                                    accessibilityLabel={!isPhotoRecognizing ? photoStatusAccessibilityLabel : undefined}
                                    accessibilityLiveRegion={
                                        photoRecognitionState === "ready" || photoRecognitionState === "error"
                                            ? "polite"
                                            : undefined
                                    }
                                    style={[styles.photoStatusPill, { backgroundColor: photoStatusBackground }]}
                                >
                                    {isPhotoRecognizing ? (
                                        <ActivityIndicator color={photoStatusColor} size="small" />
                                    ) : (
                                        <Ionicons
                                            accessible={false}
                                            name={photoStatusIcon}
                                            size={15}
                                            color={photoStatusColor}
                                        />
                                    )}
                                    <Text
                                        numberOfLines={1}
                                        style={[styles.photoStatusText, { color: photoStatusColor }]}
                                    >
                                        {photoStatusText}
                                    </Text>
                                </View>

                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="선택한 사진 변경"
                                    accessibilityState={{
                                        disabled: submitting || isVoiceFinalizing,
                                    }}
                                    disabled={submitting || isVoiceFinalizing}
                                    onPress={() => void openPhotoActionSheet()}
                                    hitSlop={4}
                                    style={({ pressed }) => [styles.photoChangeButton, { opacity: pressed ? 0.72 : 1 }]}
                                >
                                    <Ionicons accessible={false} name="images-outline" size={15} color="#FFFFFF" />
                                    <Text style={styles.photoChangeButtonText}>사진 바꾸기</Text>
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="선택한 사진 제거"
                                    onPress={() => selectPhotoForRecognition(null)}
                                    hitSlop={10}
                                    style={({ pressed }) => [styles.photoRemoveButton, { opacity: pressed ? 0.72 : 1 }]}
                                >
                                    <Ionicons accessible={false} name="trash-outline" size={17} color="#FFFFFF" />
                                </Pressable>
                            </View>
                        ) : (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="사진 선택"
                                accessibilityHint="사진 촬영 또는 사진 앱 선택 메뉴가 열립니다"
                                accessibilityState={{
                                    disabled: submitting || isVoiceFinalizing,
                                }}
                                disabled={submitting || isVoiceFinalizing}
                                onPress={() => void openPhotoActionSheet()}
                                style={({ pressed }) => [
                                    styles.photoEmptyPanel,
                                    {
                                        backgroundColor: mediaPanelBackground,
                                        borderColor: colors.border,
                                        opacity: pressed ? 0.82 : 1,
                                    },
                                ]}
                            >
                                <View
                                    style={[
                                        styles.photoEmptyIcon,
                                        {
                                            backgroundColor:
                                                mode === "dark" ? "rgba(36,107,254,0.16)" : "rgba(36,107,254,0.09)",
                                        },
                                    ]}
                                >
                                    <Ionicons accessible={false} name="image-outline" size={23} color={BLUE} />
                                </View>
                                <Text style={[styles.photoEmptyTitle, { color: colors.textPrimary }]}>
                                    일정이 담긴 사진을 추가하세요
                                </Text>
                                <Text style={[styles.photoEmptyMeta, { color: colors.textSecondary }]}>
                                    촬영하거나 사진 앱에서 선택하면 바로 읽습니다.
                                </Text>
                            </Pressable>
                        )}

                        {selectedPhoto && (
                            <View
                                style={[
                                    styles.photoTranscriptWrap,
                                    {
                                        backgroundColor: mode === "dark" ? "#151821" : "#F8FAFD",
                                        borderColor: colors.inputBorder,
                                    },
                                ]}
                            >
                                <View style={styles.photoTranscriptHeader}>
                                    <View
                                        style={[
                                            styles.photoResultIcon,
                                            {
                                                backgroundColor: isPhotoRecognizing
                                                    ? "rgba(36,107,254,0.12)"
                                                    : photoRecognitionError
                                                    ? "rgba(239,68,68,0.10)"
                                                    : "rgba(16,185,129,0.10)",
                                            },
                                        ]}
                                    >
                                        <Ionicons
                                            accessible={false}
                                            name={
                                                isPhotoRecognizing
                                                    ? "scan-outline"
                                                    : photoRecognitionError
                                                    ? "alert-circle-outline"
                                                    : "document-text-outline"
                                            }
                                            size={18}
                                            color={
                                                isPhotoRecognizing
                                                    ? BLUE
                                                    : photoRecognitionError
                                                    ? "#D94A4A"
                                                    : "#0D9F6E"
                                            }
                                        />
                                    </View>
                                    <View style={styles.photoResultTitleWrap}>
                                        <Text style={[styles.photoTranscriptLabel, { color: colors.textPrimary }]}>
                                            {isPhotoRecognizing ? "사진을 읽고 있어요" : "읽어온 내용"}
                                        </Text>
                                        {isPhotoRecognizing && (
                                            <Text style={[styles.photoResultMeta, { color: colors.textSecondary }]}>
                                                날짜·시간·장소를 찾고 있어요
                                            </Text>
                                        )}
                                    </View>
                                    {photoTranscriptTruncated ? (
                                        <View style={styles.truncatedRecognitionBadge}>
                                            <Text style={[styles.photoConfidence, styles.truncatedRecognitionText]}>
                                                일부만 표시
                                            </Text>
                                        </View>
                                    ) : (
                                        photoNeedsReview && (
                                            <View style={styles.photoReviewBadge}>
                                                <Text style={styles.photoReviewBadgeText}>확인 필요</Text>
                                            </View>
                                        )
                                    )}
                                </View>

                                {isPhotoRecognizing ? (
                                    <View
                                        pointerEvents="none"
                                        testID="quick-schedule-photo-reading-placeholder"
                                        style={styles.photoReadingPlaceholder}
                                    >
                                        <View style={[styles.photoReadingLine, styles.photoReadingLineLong]} />
                                        <View style={[styles.photoReadingLine, styles.photoReadingLineMedium]} />
                                        <View style={[styles.photoReadingLine, styles.photoReadingLineShort]} />
                                    </View>
                                ) : (
                                    <>
                                        {photoRecognitionError && (
                                            <View
                                                style={[
                                                    styles.photoRecognitionErrorWrap,
                                                    {
                                                        backgroundColor: photoErrorSurface,
                                                        borderColor: photoErrorBorder,
                                                    },
                                                ]}
                                            >
                                                <Text
                                                    style={[
                                                        styles.photoRecognitionErrorTitle,
                                                        { color: photoErrorTitleColor },
                                                    ]}
                                                >
                                                    일정 내용을 찾지 못했어요
                                                </Text>
                                                <Text
                                                    style={[
                                                        styles.photoRecognitionErrorText,
                                                        { color: photoErrorTextColor },
                                                    ]}
                                                >
                                                    날짜나 시간이 선명한 사진으로 바꾸거나 직접 입력해 주세요.
                                                </Text>
                                                <Pressable
                                                    accessibilityRole="button"
                                                    accessibilityLabel="사진 내용 다시 읽기"
                                                    onPress={() => setPhotoRecognitionAttempt(current => current + 1)}
                                                    style={({ pressed }) => [
                                                        styles.photoRecognitionRetry,
                                                        { opacity: pressed ? 0.72 : 1 },
                                                    ]}
                                                >
                                                    <Ionicons
                                                        accessible={false}
                                                        name="refresh"
                                                        size={15}
                                                        color={BLUE}
                                                    />
                                                    <Text style={styles.photoRecognitionRetryText}>다시 읽기</Text>
                                                </Pressable>
                                            </View>
                                        )}

                                        <View style={styles.photoTranscriptInputWrap}>
                                            <Text
                                                style={[
                                                    styles.photoTranscriptInputLabel,
                                                    { color: colors.textSecondary },
                                                ]}
                                            >
                                                {photoRecognitionError ? "직접 입력" : "일정 문장"}
                                            </Text>
                                            <TextInput
                                                accessibilityLabel="사진에서 읽은 내용"
                                                editable={!submitting}
                                                multiline
                                                maxLength={QUICK_TEXT_LIMIT}
                                                value={photoTranscript}
                                                onChangeText={value => {
                                                    setPhotoTranscript(value);
                                                    setPhotoTranscriptTruncated(false);
                                                    setPhotoRecognitionConfidence(undefined);
                                                    setPhotoRecognitionError("");
                                                }}
                                                placeholder={
                                                    photoRecognitionError
                                                        ? "읽지 못한 내용을 직접 입력해 주세요."
                                                        : "읽은 내용을 확인하고 수정할 수 있어요."
                                                }
                                                placeholderTextColor={colors.inputPlaceholder}
                                                selectionColor={BLUE}
                                                style={[styles.photoTranscriptInput, { color: colors.textPrimary }]}
                                            />
                                        </View>

                                        {photoNeedsReview && (
                                            <View style={styles.lowConfidenceNotice}>
                                                <Ionicons
                                                    accessible={false}
                                                    name="alert-circle-outline"
                                                    size={14}
                                                    color="#F59E0B"
                                                />
                                                <Text style={styles.lowConfidenceNoticeText}>
                                                    일부 내용을 정확히 읽지 못했어요. 날짜·시간·장소를 확인해 주세요.
                                                </Text>
                                            </View>
                                        )}
                                    </>
                                )}
                            </View>
                        )}
                    </View>
                )}

                {inputMode === "voice" && (
                    <View
                        style={[
                            styles.voicePanel,
                            {
                                backgroundColor: mediaPanelBackground,
                                borderColor: colors.border,
                            },
                        ]}
                    >
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={
                                recorderState.isRecording
                                    ? "실시간 음성 인식 중지"
                                    : voiceTranscript.trim() || voiceUri
                                    ? "음성 다시 인식"
                                    : "실시간 음성 인식 시작"
                            }
                            accessibilityState={{ disabled: submitting || isVoiceFinalizing }}
                            onPress={() => {
                                if (recorderState.isRecording) {
                                    void stopVoiceRecording();
                                    return;
                                }

                                void startVoiceRecording();
                            }}
                            disabled={submitting || isVoiceFinalizing}
                            style={({ pressed }) => [
                                styles.voiceRecordControl,
                                { opacity: pressed ? 0.78 : isVoiceFinalizing ? 0.5 : 1 },
                            ]}
                        >
                            <View style={styles.voiceOrbWrap}>
                                <VoiceSpectrumHalo energy={voiceSpectrumEnergy} />
                                <View
                                    pointerEvents="none"
                                    testID="quick-schedule-voice-spectrum"
                                    style={styles.voiceSpectrum}
                                >
                                    {VOICE_SPECTRUM_BARS.map(barIndex => {
                                        const angle = `${(360 / VOICE_SPECTRUM_BAR_COUNT) * barIndex}deg`;
                                        const historyIndex =
                                            barIndex < VOICE_SPECTRUM_SAMPLE_COUNT
                                                ? barIndex
                                                : VOICE_SPECTRUM_BAR_COUNT - 1 - barIndex;
                                        const texture = 0.78 + ((Math.sin(barIndex * 1.73) + 1) / 2) * 0.22;
                                        const level = recorderState.isRecording
                                            ? (voiceMeterHistory[historyIndex] ?? 0) * texture
                                            : 0;
                                        const colorIndex = Math.min(
                                            VOICE_SPECTRUM_COLORS.length - 1,
                                            Math.floor(
                                                (historyIndex / VOICE_SPECTRUM_SAMPLE_COUNT) *
                                                    VOICE_SPECTRUM_COLORS.length,
                                            ),
                                        );

                                        return (
                                            <VoiceSpectrumBar
                                                key={barIndex}
                                                angle={angle}
                                                color={VOICE_SPECTRUM_COLORS[colorIndex]}
                                                level={level}
                                            />
                                        );
                                    })}
                                </View>
                                <View
                                    style={[
                                        styles.voiceOrb,
                                        {
                                            backgroundColor: recorderState.isRecording ? BLUE : colors.surface,
                                            borderColor:
                                                recorderState.isRecording || voiceTranscript.trim() || voiceUri
                                                    ? BLUE
                                                    : colors.border,
                                        },
                                    ]}
                                >
                                    <Ionicons
                                        accessible={false}
                                        name={recorderState.isRecording ? "stop" : "mic-outline"}
                                        size={30}
                                        color={recorderState.isRecording ? "#FFFFFF" : BLUE}
                                    />
                                </View>
                            </View>
                            <Text style={[styles.voiceTitle, { color: colors.textPrimary }]}>{voiceControlTitle}</Text>
                            <Text numberOfLines={2} style={[styles.voiceMeta, { color: colors.textSecondary }]}>
                                {voiceControlMeta}
                            </Text>
                        </Pressable>

                        <View
                            style={[
                                styles.voiceTranscriptWrap,
                                {
                                    backgroundColor: inputBackground,
                                    borderColor: colors.inputBorder,
                                },
                            ]}
                        >
                            <View style={styles.voiceTranscriptHeader}>
                                <Text style={[styles.voiceTranscriptLabel, { color: colors.textSecondary }]}>
                                    말한 내용
                                </Text>
                                {voiceTranscriptTruncated && (
                                    <Text style={[styles.voiceConfidence, styles.truncatedRecognitionText]}>
                                        앞 300자만 표시
                                    </Text>
                                )}
                            </View>
                            <TextInput
                                accessibilityLabel="실시간 음성 인식 텍스트"
                                editable={!submitting && !recorderState.isRecording && !isVoiceFinalizing}
                                multiline
                                maxLength={QUICK_TEXT_LIMIT}
                                value={voiceTranscript}
                                onChangeText={value => {
                                    voiceTranscriptRef.current = value;
                                    liveSpeechTranscriptBufferRef.current = createLiveSpeechTranscriptBuffer(value);
                                    setVoiceTranscript(value);
                                    setVoiceTranscriptTruncated(false);
                                    setVoiceRecognitionConfidence(undefined);
                                    setVoiceRecognitionAlternatives([]);
                                    setVoiceStatusMessage("");
                                }}
                                placeholder={
                                    recorderState.isRecording
                                        ? "말한 내용이 여기에 표시됩니다."
                                        : voiceUri
                                        ? "필요하면 내용을 직접 적어 주세요."
                                        : "직접 입력해도 됩니다."
                                }
                                placeholderTextColor={colors.inputPlaceholder}
                                selectionColor={BLUE}
                                style={[styles.voiceTranscriptInput, { color: colors.textPrimary }]}
                            />
                        </View>
                    </View>
                )}
            </ScrollView>

            <Pressable
                accessibilityRole="button"
                accessibilityLabel="입력 내용으로 일정 미리보기"
                accessibilityState={{ disabled: !canSubmit, busy: submitting }}
                disabled={!canSubmit}
                onPress={submit}
                style={({ pressed }) => [
                    styles.submitButton,
                    {
                        opacity: !canSubmit ? 0.45 : pressed ? 0.78 : 1,
                    },
                ]}
            >
                {submitting ? (
                    <BrandedLoader size="button" variant="schedule" accessibilityLabel="일정을 만들고 있어요" />
                ) : (
                    <>
                        <Ionicons accessible={false} name="calendar-outline" size={17} color="#fff" />
                        <Text style={styles.submitText}>일정 미리보기</Text>
                    </>
                )}
            </Pressable>
        </View>
    );

    const renderLoadingStep = () => {
        const isSaving = flowStep === "saving";
        const loadingHeadline = isSaving ? "일정을 저장하고 있어요" : "일정 초안을 만들고 있어요";
        const loadingCaption = isSaving
            ? "일정과 이동 정보를 정리하고 있어요"
            : inputMode === "photo"
            ? "사진 속 날짜와 장소를 확인하고 있어요"
            : inputMode === "voice"
            ? "말한 내용에서 일정 정보를 찾고 있어요"
            : "입력한 내용에서 일정 정보를 찾고 있어요";

        return (
            <View style={styles.centerFlow}>
                <QuickScheduleLogoLoader accessibilityLabel={`${loadingHeadline}. ${loadingCaption}`} />
                <Text style={[styles.flowHeadline, { color: colors.textPrimary }]}>{loadingHeadline}</Text>
                <Text style={[styles.flowCaption, { color: colors.textSecondary }]}>{loadingCaption}</Text>
            </View>
        );
    };

    const renderErrorStep = () => (
        <View style={styles.centerFlow}>
            <View style={[styles.statusIconWrap, { backgroundColor: warningBackground }]}>
                <Ionicons accessible={false} name="warning-outline" size={42} color={warningTextColor} />
            </View>
            <Text style={[styles.flowHeadline, { color: colors.textPrimary }]}>일정을 만들지 못했어요</Text>
            <Text numberOfLines={2} style={[styles.flowCaption, { color: colors.textSecondary }]}>
                {analysisError || "입력 내용을 확인한 뒤 다시 시도해 주세요"}
            </Text>
            <View style={styles.savedButtonStack}>
                <Pressable
                    onPress={() => setFlowStep("input")}
                    disabled={submitting}
                    accessibilityRole="button"
                    accessibilityLabel="빠른 일정 입력 수정"
                    style={({ pressed }) => [
                        styles.secondaryButton,
                        {
                            flex: 0,
                            alignSelf: "stretch",
                            backgroundColor: inputBackground,
                            borderColor: cardBorderColor,
                            opacity: pressed ? 0.72 : 1,
                        },
                    ]}
                >
                    <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>입력 수정</Text>
                </Pressable>
                <Pressable
                    onPress={submit}
                    disabled={submitting}
                    accessibilityRole="button"
                    accessibilityLabel="일정 만들기 다시 시도"
                    style={({ pressed }) => [
                        styles.submitButton,
                        { alignSelf: "stretch", opacity: pressed ? 0.78 : 1 },
                    ]}
                >
                    <Text style={styles.submitText}>다시 시도</Text>
                </Pressable>
            </View>
        </View>
    );

    const renderPreviewStep = () => {
        if (!previewDraft) return null;
        const blockingReviewField = getQuickScheduleBlockingReviewField(previewDraft);
        const confirmGlobalReview = () => {
            setPreviewDraft(current => (current ? confirmQuickScheduleGlobalReview(current) : current));
        };
        const getPreviewBadge = (field: PreviewField) =>
            field === "notification" && !canUseRouteNotification(previewDraft)
                ? "경로 설정 필요"
                : previewDraft.badges[field];
        const getPreviewAccessibilityValue = (field: PreviewField) =>
            [getPreviewValue(previewDraft, field), getPreviewBadge(field)].filter(Boolean).join(", ");
        const renderPreviewBadge = (field: PreviewField) => {
            const badge = getPreviewBadge(field);
            if (!badge) return null;

            return (
                <View style={[styles.warningBadge, { backgroundColor: warningBackground }]}>
                    <Text style={[styles.warningBadgeText, { color: warningTextColor }]}>{badge}</Text>
                </View>
            );
        };
        const primaryActionLabel = blockingReviewField
            ? blockingReviewField === "review"
                ? "확인했어요"
                : `${FIELD_LABEL[blockingReviewField]} 확인하기`
            : "일정 저장";
        const displayedSourceText = previewSourceText || "입력한 내용";
        const stackedDateTimeHitSlop = previewDraft.hasExplicitEndTime
            ? { top: 6, bottom: 6, left: 4, right: 4 }
            : undefined;

        return (
            <View style={styles.previewStep}>
                <ScrollView
                    style={styles.previewScroll}
                    contentContainerStyle={styles.previewScrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    <Pressable
                        onPress={() => setFlowStep("input")}
                        disabled={submitting}
                        accessibilityRole="button"
                        accessibilityLabel="입력 내용 수정"
                        accessibilityValue={{ text: displayedSourceText }}
                        accessibilityState={{ disabled: submitting }}
                        style={({ pressed }) => [
                            styles.previewSourceStrip,
                            {
                                borderBottomColor: previewDividerColor,
                                opacity: pressed ? 0.82 : submitting ? 0.42 : 1,
                            },
                        ]}
                    >
                        <View style={styles.previewSourceCopy}>
                            <Text style={[styles.previewSourceLabel, { color: previewLabelColor }]}>
                                입력한 내용
                            </Text>
                            <Text
                                numberOfLines={1}
                                style={[styles.previewSourceValue, { color: colors.textSecondary }]}
                            >
                                {displayedSourceText}
                            </Text>
                        </View>
                        <Text style={styles.previewSourceAction}>수정</Text>
                    </Pressable>

                    <Pressable
                        onPress={() => openEditField("title")}
                        disabled={submitting}
                        accessibilityRole="button"
                        accessibilityLabel="제목 수정"
                        accessibilityValue={{ text: getPreviewAccessibilityValue("title") }}
                        accessibilityState={{ disabled: submitting }}
                        style={({ pressed }) => [
                            styles.previewTitleRow,
                            { opacity: pressed ? 0.82 : submitting ? 0.42 : 1 },
                        ]}
                    >
                        <Text style={[styles.previewLabel, { color: previewLabelColor }]}>제목</Text>
                        <View style={styles.previewTitleValueRow}>
                            <Text numberOfLines={2} style={[styles.previewTitleValue, { color: colors.textPrimary }]}>
                                {getPreviewValue(previewDraft, "title")}
                            </Text>
                            {renderPreviewBadge("title")}
                            <Ionicons
                                testID="quick-schedule-preview-title-chevron"
                                accessible={false}
                                name="chevron-forward"
                                size={14}
                                color={previewChevronColor}
                                style={styles.previewValueChevron}
                            />
                        </View>
                    </Pressable>

                    <View style={styles.previewInfoRow}>
                        <View style={[styles.previewInfoIcon, { backgroundColor: previewIconBackground }]}>
                            <Ionicons accessible={false} name="calendar-outline" size={16} color={BLUE} />
                        </View>
                        <View style={styles.previewInfoCopy}>
                            <Text style={[styles.previewLabel, { color: previewLabelColor }]}>일시</Text>
                            <View
                                testID="quick-schedule-preview-date-time"
                                style={[
                                    styles.previewDateTimeValue,
                                    previewDraft.hasExplicitEndTime && styles.previewDateTimeValueStacked,
                                ]}
                            >
                                <Pressable
                                    onPress={() => openEditField("date")}
                                    disabled={submitting}
                                    hitSlop={stackedDateTimeHitSlop}
                                    accessibilityRole="button"
                                    accessibilityLabel="날짜 수정"
                                    accessibilityValue={{
                                        text: getPreviewAccessibilityValue("date"),
                                    }}
                                    accessibilityState={{ disabled: submitting }}
                                    style={({ pressed }) => [
                                        styles.previewInlineField,
                                        previewDraft.hasExplicitEndTime && styles.previewInlineFieldStacked,
                                        { opacity: pressed ? 0.82 : submitting ? 0.42 : 1 },
                                    ]}
                                >
                                    <View style={styles.previewInlineContent}>
                                        <Text style={[styles.previewInlineValue, { color: colors.textPrimary }]}>
                                            {getPreviewValue(previewDraft, "date")}
                                        </Text>
                                        {renderPreviewBadge("date")}
                                        <Ionicons
                                            testID="quick-schedule-preview-date-chevron"
                                            accessible={false}
                                            name="chevron-forward"
                                            size={14}
                                            color={previewChevronColor}
                                            style={styles.previewValueChevron}
                                        />
                                    </View>
                                </Pressable>
                                {!previewDraft.hasExplicitEndTime && (
                                    <Text
                                        accessible={false}
                                        style={[styles.previewDateTimeSeparator, { color: previewLabelColor }]}
                                    >
                                        ·
                                    </Text>
                                )}
                                <Pressable
                                    onPress={() => openEditField("time")}
                                    disabled={submitting}
                                    hitSlop={stackedDateTimeHitSlop}
                                    accessibilityRole="button"
                                    accessibilityLabel="시간 수정"
                                    accessibilityValue={{
                                        text: getPreviewAccessibilityValue("time"),
                                    }}
                                    accessibilityState={{ disabled: submitting }}
                                    style={({ pressed }) => [
                                        styles.previewInlineField,
                                        previewDraft.hasExplicitEndTime && styles.previewInlineFieldStacked,
                                        { opacity: pressed ? 0.82 : submitting ? 0.42 : 1 },
                                    ]}
                                >
                                    <View style={styles.previewInlineContent}>
                                        <Text style={[styles.previewInlineValue, { color: colors.textPrimary }]}>
                                            {getPreviewValue(previewDraft, "time")}
                                        </Text>
                                        {renderPreviewBadge("time")}
                                        <Ionicons
                                            testID="quick-schedule-preview-time-chevron"
                                            accessible={false}
                                            name="chevron-forward"
                                            size={14}
                                            color={previewChevronColor}
                                            style={styles.previewValueChevron}
                                        />
                                    </View>
                                </Pressable>
                            </View>
                        </View>
                    </View>

                    <Pressable
                        onPress={() => openEditField("location")}
                        disabled={submitting}
                        accessibilityRole="button"
                        accessibilityLabel="장소 수정"
                        accessibilityValue={{
                            text: getPreviewAccessibilityValue("location"),
                        }}
                        accessibilityState={{ disabled: submitting }}
                        style={({ pressed }) => [
                            styles.previewInfoRow,
                            styles.previewPlaceRow,
                            {
                                borderTopColor: previewDividerColor,
                                opacity: pressed ? 0.82 : submitting ? 0.42 : 1,
                            },
                        ]}
                    >
                        <View style={[styles.previewInfoIcon, { backgroundColor: previewIconBackground }]}>
                            <Ionicons accessible={false} name="location-outline" size={16} color={BLUE} />
                        </View>
                        <View style={styles.previewInfoCopy}>
                            <Text style={[styles.previewLabel, { color: previewLabelColor }]}>장소</Text>
                            <View style={styles.previewInfoValueRow}>
                                <Text
                                    numberOfLines={1}
                                    style={[styles.previewInfoValue, { color: colors.textPrimary }]}
                                >
                                    {getPreviewValue(previewDraft, "location")}
                                </Text>
                                {renderPreviewBadge("location")}
                            </View>
                        </View>
                        <Ionicons accessible={false} name="chevron-forward" size={15} color={previewChevronColor} />
                    </Pressable>

                    <View style={[styles.previewOptional, { borderTopColor: previewDividerColor }]}>
                        <Pressable
                            onPress={() => openEditField("notification")}
                            disabled={submitting}
                            accessibilityRole="button"
                            accessibilityLabel="알림 수정"
                            accessibilityValue={{
                                text: getPreviewAccessibilityValue("notification"),
                            }}
                            accessibilityState={{ disabled: submitting }}
                            style={({ pressed }) => [
                                styles.previewOptionalItem,
                                { opacity: pressed ? 0.82 : submitting ? 0.42 : 1 },
                            ]}
                        >
                            <View style={styles.previewOptionalCopy}>
                                <Text style={[styles.previewLabel, { color: previewLabelColor }]}>알림</Text>
                                <View style={styles.previewOptionalValueRow}>
                                    <Text
                                        numberOfLines={1}
                                        style={[styles.previewOptionalValue, { color: colors.textPrimary }]}
                                    >
                                        {getPreviewValue(previewDraft, "notification")}
                                    </Text>
                                    {renderPreviewBadge("notification")}
                                </View>
                            </View>
                            <Ionicons
                                accessible={false}
                                name="chevron-forward"
                                size={14}
                                color={previewChevronColor}
                            />
                        </Pressable>
                        <View style={[styles.previewOptionalDivider, { backgroundColor: previewDividerColor }]} />
                        <Pressable
                            onPress={() => openEditField("memo")}
                            disabled={submitting}
                            accessibilityRole="button"
                            accessibilityLabel="메모 수정"
                            accessibilityValue={{
                                text: getPreviewAccessibilityValue("memo"),
                            }}
                            accessibilityState={{ disabled: submitting }}
                            style={({ pressed }) => [
                                styles.previewOptionalItem,
                                styles.previewOptionalItemTrailing,
                                { opacity: pressed ? 0.82 : submitting ? 0.42 : 1 },
                            ]}
                        >
                            <View style={styles.previewOptionalCopy}>
                                <Text style={[styles.previewLabel, { color: previewLabelColor }]}>메모</Text>
                                <View style={styles.previewOptionalValueRow}>
                                    <Text
                                        numberOfLines={1}
                                        style={[styles.previewOptionalValue, { color: colors.textPrimary }]}
                                    >
                                        {getPreviewValue(previewDraft, "memo")}
                                    </Text>
                                    {renderPreviewBadge("memo")}
                                </View>
                            </View>
                            <Ionicons
                                accessible={false}
                                name="chevron-forward"
                                size={14}
                                color={previewChevronColor}
                            />
                        </Pressable>
                    </View>
                </ScrollView>
                <View style={styles.previewButtons}>
                    <Pressable
                        onPress={() => setFlowStep("input")}
                        accessibilityRole="button"
                        accessibilityLabel="빠른 일정 입력 수정"
                        accessibilityState={{ disabled: submitting }}
                        disabled={submitting}
                        style={({ pressed }) => [
                            styles.secondaryButton,
                            styles.previewSecondaryButton,
                            {
                                backgroundColor: "transparent",
                                borderColor: previewDividerColor,
                                opacity: pressed ? 0.72 : submitting ? 0.42 : 1,
                            },
                        ]}
                    >
                        <Text
                            style={[
                                styles.secondaryButtonText,
                                styles.previewSecondaryButtonText,
                                { color: colors.textPrimary },
                            ]}
                        >
                            입력 수정
                        </Text>
                    </Pressable>
                    <Pressable
                        onPress={
                            blockingReviewField === "review"
                                ? confirmGlobalReview
                                : blockingReviewField
                                ? () => openEditField(blockingReviewField)
                                : savePreview
                        }
                        accessibilityRole="button"
                        accessibilityLabel={primaryActionLabel}
                        accessibilityState={{ disabled: submitting, busy: submitting }}
                        disabled={submitting}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            styles.previewPrimaryButton,
                            { opacity: pressed ? 0.78 : 1 },
                        ]}
                    >
                        <Text style={[styles.primaryButtonText, styles.previewPrimaryButtonText]}>
                            {primaryActionLabel}
                        </Text>
                    </Pressable>
                </View>
            </View>
        );
    };

    const renderEditStep = () => {
        if (!editingField || !previewDraft) return null;
        const isTextEdit = editingField === "title" || editingField === "memo";
        const isLocationEdit = editingField === "location";
        const isNotificationEdit = editingField === "notification";
        const notificationNeedsRoute = isNotificationEdit && !notificationRouteReady;
        const notificationEnabled = isNotificationEdit && editingValue !== "none";
        const notificationRouteInfo = isNotificationEdit ? getQuickSchedulePreviewRouteInfo(previewDraft) : undefined;
        const pickerDateValue =
            editingField === "date"
                ? dateFromYmd(editingValue || previewDraft.date)
                : dateFromDraftTime(previewDraft.date, editingValue || previewDraft.time);
        const handlePickerChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
            if (!selectedDate) return;
            setEditingValue(editingField === "date" ? toYmd(selectedDate) : toHm(selectedDate));
        };

        return (
            <View style={styles.editStep}>
                {isTextEdit && (
                    <TextInput
                        value={editingValue}
                        onChangeText={setEditingValue}
                        multiline={editingField === "memo"}
                        autoFocus
                        placeholder={`${FIELD_LABEL[editingField]} 입력`}
                        placeholderTextColor={colors.inputPlaceholder}
                        selectionColor={BLUE}
                        style={[
                            styles.editInput,
                            editingField === "memo" && styles.editInputMemo,
                            {
                                color: colors.textPrimary,
                                backgroundColor: inputBackground,
                                borderColor: previewDividerColor,
                            },
                        ]}
                    />
                )}
                {isLocationEdit && (
                    <View style={styles.routeEditPanel}>
                        <TextInput
                            accessibilityLabel="빠른 일정 목적지"
                            value={editingValue === "장소 미정" ? "" : editingValue}
                            onChangeText={setEditingValue}
                            autoFocus
                            placeholder="목적지 입력"
                            placeholderTextColor={colors.inputPlaceholder}
                            selectionColor={BLUE}
                            style={[
                                styles.editInput,
                                styles.locationEditInput,
                                {
                                    color: colors.textPrimary,
                                    backgroundColor: inputBackground,
                                    borderColor: previewDividerColor,
                                },
                            ]}
                        />
                        <View
                            style={[
                                styles.routeEditNotice,
                                {
                                    backgroundColor: inputBackground,
                                    borderColor: previewDividerColor,
                                },
                            ]}
                        >
                            <Ionicons accessible={false} name="location-outline" size={17} color={BLUE} />
                            <Text style={[styles.routeEditNoticeText, { color: colors.textSecondary }]}>
                                목적지만 바꿀 수 있어요. 이동 경로와 출발 알림은 알림에서 설정해 주세요.
                            </Text>
                        </View>
                    </View>
                )}
                {editingField === "time" && (
                    <View
                        style={[
                            styles.editSegmented,
                            {
                                backgroundColor: mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.045)",
                            },
                        ]}
                    >
                        {(["picker", "manual"] as const).map(item => {
                            const selected = timeEditMode === item;
                            return (
                                <Pressable
                                    key={item}
                                    onPress={() => setTimeEditMode(item)}
                                    accessibilityRole="radio"
                                    accessibilityLabel={item === "picker" ? "시간 선택" : "직접 입력"}
                                    accessibilityState={{ selected }}
                                    style={[
                                        styles.editSegment,
                                        selected && {
                                            backgroundColor: mode === "dark" ? "rgba(255,255,255,0.14)" : "#FFFFFF",
                                        },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.editSegmentText,
                                            { color: selected ? BLUE : colors.textSecondary },
                                        ]}
                                    >
                                        {item === "picker" ? "시간 선택" : "직접 입력"}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                )}
                {(editingField === "date" || (editingField === "time" && timeEditMode === "picker")) && (
                    <View
                        style={[
                            styles.pickerPanel,
                            {
                                backgroundColor: inputBackground,
                                borderColor: previewDividerColor,
                            },
                        ]}
                    >
                        <DateTimePicker
                            value={pickerDateValue}
                            mode={editingField === "date" ? "date" : "time"}
                            display={Platform.OS === "ios" ? "spinner" : "default"}
                            onChange={handlePickerChange}
                            locale="ko-KR"
                            style={styles.dateTimePicker}
                        />
                        {editingField === "time" && (
                            <View style={[styles.aiHint, { backgroundColor: warningBackground }]}>
                                <Ionicons
                                    accessible={false}
                                    name="information-circle-outline"
                                    size={15}
                                    color={warningTextColor}
                                />
                                <Text style={[styles.aiHintText, { color: warningTextColor }]}>
                                    현재 선택: {formatKoreanTime(previewDraft.time)}
                                </Text>
                            </View>
                        )}
                    </View>
                )}
                {editingField === "time" && timeEditMode === "manual" && (
                    <TextInput
                        value={editingValue}
                        onChangeText={setEditingValue}
                        autoFocus
                        placeholder="예) 오후 7:00"
                        placeholderTextColor={colors.inputPlaceholder}
                        selectionColor={BLUE}
                        style={[
                            styles.editInput,
                            {
                                color: colors.textPrimary,
                                backgroundColor: inputBackground,
                                borderColor: previewDividerColor,
                            },
                        ]}
                    />
                )}
                {notificationNeedsRoute && (
                    <View style={styles.notificationRouteRequired}>
                        <View style={[styles.notificationRouteIcon, { backgroundColor: selectedModeBackground }]}>
                            <Ionicons accessible={false} name="navigate-outline" size={26} color={BLUE} />
                        </View>
                        <Text style={[styles.notificationRouteTitle, { color: colors.textPrimary }]}>
                            경로를 설정하면 출발 시각을 알려드려요
                        </Text>
                        <Text style={[styles.notificationRouteBody, { color: colors.textSecondary }]}>
                            실시간 교통 상황을 확인하려면 출발지와 이동 경로가 필요해요.
                        </Text>
                        <View
                            style={[
                                styles.notificationFeatureList,
                                {
                                    backgroundColor: inputBackground,
                                    borderColor: previewDividerColor,
                                },
                            ]}
                        >
                            <View style={styles.notificationFeatureRow}>
                                <Ionicons accessible={false} name="pulse-outline" size={17} color={BLUE} />
                                <Text style={[styles.notificationFeatureText, { color: colors.textPrimary }]}>
                                    교통 변화에 맞춰 추천 출발 시각 계산
                                </Text>
                            </View>
                            <View
                                style={[styles.notificationFeatureDivider, { backgroundColor: previewDividerColor }]}
                            />
                            <View style={styles.notificationFeatureRow}>
                                <Ionicons accessible={false} name="notifications-outline" size={17} color={BLUE} />
                                <Text style={[styles.notificationFeatureText, { color: colors.textPrimary }]}>
                                    출발 준비부터 지금 출발할 때까지 안내
                                </Text>
                            </View>
                        </View>
                        <View style={styles.notificationOptionalNotice}>
                            <Ionicons accessible={false} name="checkmark-circle" size={16} color={successColor} />
                            <Text style={[styles.notificationOptionalText, { color: colors.textSecondary }]}>
                                일정은 경로 없이도 저장할 수 있어요
                            </Text>
                        </View>
                    </View>
                )}
                {isNotificationEdit && notificationRouteReady && (
                    <ScrollView
                        style={styles.notificationEditor}
                        contentContainerStyle={styles.notificationEditorContent}
                        showsVerticalScrollIndicator={false}
                    >
                        <View
                            style={[
                                styles.notificationHero,
                                {
                                    backgroundColor: selectedModeBackground,
                                    borderColor: "rgba(36,107,254,0.21)",
                                },
                            ]}
                        >
                            <View style={styles.notificationHeroHeader}>
                                <View
                                    style={[
                                        styles.notificationHeroIcon,
                                        {
                                            backgroundColor:
                                                mode === "dark" ? "rgba(36,107,254,0.22)" : "rgba(255,255,255,0.76)",
                                        },
                                    ]}
                                >
                                    <Ionicons accessible={false} name="navigate" size={20} color={BLUE} />
                                </View>
                                <View style={styles.notificationHeroText}>
                                    <Text style={[styles.notificationHeroTitle, { color: colors.textPrimary }]}>
                                        실시간 교통을 반영해요
                                    </Text>
                                    <Text style={[styles.notificationHeroBody, { color: colors.textSecondary }]}>
                                        이동 시간이 바뀌면 출발 시각을 다시 계산해 알려드려요.
                                    </Text>
                                </View>
                            </View>
                            <View
                                style={[styles.notificationRouteSummary, { borderTopColor: "rgba(36,107,254,0.16)" }]}
                            >
                                <View style={styles.notificationRouteMetric}>
                                    <Text
                                        style={[styles.notificationRouteMetricLabel, { color: colors.textSecondary }]}
                                    >
                                        추천 출발
                                    </Text>
                                    <Text style={[styles.notificationRouteMetricValue, { color: colors.textPrimary }]}>
                                        {formatRouteClock(notificationRouteInfo?.departureTime)}
                                    </Text>
                                </View>
                                <View
                                    style={[
                                        styles.notificationRouteMetricDivider,
                                        { backgroundColor: "rgba(36,107,254,0.16)" },
                                    ]}
                                />
                                <View style={styles.notificationRouteMetric}>
                                    <Text
                                        style={[styles.notificationRouteMetricLabel, { color: colors.textSecondary }]}
                                    >
                                        도착 예정
                                    </Text>
                                    <Text style={[styles.notificationRouteMetricValue, { color: colors.textPrimary }]}>
                                        {formatRouteClock(notificationRouteInfo?.arrivalTime)}
                                    </Text>
                                </View>
                                <View
                                    style={[
                                        styles.notificationRouteMetricDivider,
                                        { backgroundColor: "rgba(36,107,254,0.16)" },
                                    ]}
                                />
                                <View style={styles.notificationRouteMetric}>
                                    <Text
                                        style={[styles.notificationRouteMetricLabel, { color: colors.textSecondary }]}
                                    >
                                        예상 이동
                                    </Text>
                                    <Text style={[styles.notificationRouteMetricValue, { color: colors.textPrimary }]}>
                                        {formatRouteDuration(notificationRouteInfo?.totalDurationMinutes)}
                                    </Text>
                                </View>
                            </View>
                        </View>

                        <View
                            style={[
                                styles.notificationControlCard,
                                {
                                    backgroundColor: inputBackground,
                                    borderColor: previewDividerColor,
                                },
                            ]}
                        >
                            <View style={styles.notificationToggleRow}>
                                <View style={styles.notificationToggleText}>
                                    <Text style={[styles.notificationToggleTitle, { color: colors.textPrimary }]}>
                                        출발 알림 받기
                                    </Text>
                                    <Text style={[styles.notificationToggleBody, { color: colors.textSecondary }]}>
                                        교통 확인과 출발 안내를 켭니다
                                    </Text>
                                </View>
                                <Switch
                                    accessibilityLabel="출발 알림 받기"
                                    accessibilityHint="실시간 교통 기반 출발 알림을 켜거나 끕니다"
                                    value={notificationEnabled}
                                    onValueChange={enabled =>
                                        setEditingValue(
                                            enabled ? String(previewDraft.notificationLeadMinutes ?? 60) : "none",
                                        )
                                    }
                                    trackColor={{ false: colors.border, true: BLUE }}
                                    ios_backgroundColor={colors.border}
                                    thumbColor="#FFFFFF"
                                />
                            </View>

                            {notificationEnabled ? (
                                <View
                                    style={[styles.notificationLeadSection, { borderTopColor: previewDividerColor }]}
                                >
                                    <View style={styles.notificationLeadHeading}>
                                        <Text style={[styles.notificationLeadTitle, { color: colors.textPrimary }]}>
                                            교통 확인 시작
                                        </Text>
                                        <Text style={[styles.notificationLeadCaption, { color: colors.textSecondary }]}>
                                            추천 출발 시각 기준
                                        </Text>
                                    </View>
                                    <View
                                        accessibilityRole="radiogroup"
                                        accessibilityLabel="교통 확인 시작 시점"
                                        style={styles.notificationOptions}
                                    >
                                        {NOTIFICATION_OPTIONS.map(option => {
                                            const selected = editingValue === option.value;
                                            return (
                                                <Pressable
                                                    key={option.value}
                                                    accessibilityRole="radio"
                                                    accessibilityLabel={"출발 " + option.label + " 전부터 교통 확인"}
                                                    accessibilityState={{ checked: selected }}
                                                    onPress={() => setEditingValue(option.value)}
                                                    style={({ pressed }) => [
                                                        styles.notificationChip,
                                                        {
                                                            backgroundColor: selected
                                                                ? selectedModeBackground
                                                                : "transparent",
                                                            borderColor: selected ? BLUE : previewDividerColor,
                                                            opacity: pressed ? 0.72 : 1,
                                                        },
                                                    ]}
                                                >
                                                    {selected && (
                                                        <Ionicons
                                                            accessible={false}
                                                            name="checkmark-circle"
                                                            size={15}
                                                            color={BLUE}
                                                        />
                                                    )}
                                                    <Text
                                                        style={[
                                                            styles.notificationChipText,
                                                            { color: selected ? BLUE : colors.textPrimary },
                                                        ]}
                                                    >
                                                        {option.label}
                                                    </Text>
                                                </Pressable>
                                            );
                                        })}
                                    </View>
                                    <View
                                        style={[styles.notificationModeSection, { borderTopColor: previewDividerColor }]}
                                    >
                                        <Text style={[styles.notificationLeadTitle, { color: colors.textPrimary }]}>
                                            알림 방식
                                        </Text>
                                        <View
                                            accessibilityRole="radiogroup"
                                            accessibilityLabel="출발 알림 방식"
                                            style={styles.notificationModeOptions}
                                        >
                                            {(
                                                [
                                                    {
                                                        value: "STANDARD",
                                                        icon: "notifications-outline",
                                                    },
                                                    {
                                                        value: "ALARM",
                                                        icon: "alarm-outline",
                                                    },
                                                ] as const
                                            ).map(option => {
                                                const checked = editingAlertMode === option.value;
                                                const presentation = SCHEDULE_ALERT_MODE_PRESENTATION[option.value];
                                                return (
                                                    <Pressable
                                                        key={option.value}
                                                        accessibilityRole="radio"
                                                        accessibilityLabel={presentation.accessibilityLabel}
                                                        accessibilityHint={presentation.description}
                                                        accessibilityState={{ checked }}
                                                        onPress={() => setEditingAlertMode(option.value)}
                                                        style={({ pressed }) => [
                                                            styles.notificationModeButton,
                                                            {
                                                                backgroundColor: checked
                                                                    ? selectedModeBackground
                                                                    : "transparent",
                                                                borderColor: checked ? BLUE : previewDividerColor,
                                                                opacity: pressed ? 0.72 : 1,
                                                            },
                                                        ]}
                                                    >
                                                        <View
                                                            style={[
                                                                styles.notificationModeIcon,
                                                                {
                                                                    backgroundColor: checked ? BLUE : previewDividerColor,
                                                                },
                                                            ]}
                                                        >
                                                            <Ionicons
                                                                accessible={false}
                                                                name={option.icon}
                                                                size={17}
                                                                color={checked ? "#FFFFFF" : colors.textSecondary}
                                                            />
                                                        </View>
                                                        <View style={styles.notificationModeCopy}>
                                                        <Text
                                                            style={[
                                                                styles.notificationModeText,
                                                                {
                                                                    color: checked ? BLUE : colors.textPrimary,
                                                                },
                                                            ]}
                                                        >
                                                            {presentation.label}
                                                        </Text>
                                                            <Text
                                                                style={[
                                                                    styles.notificationModeDescription,
                                                                    { color: colors.textSecondary },
                                                                ]}
                                                            >
                                                                {presentation.description}
                                                            </Text>
                                                        </View>
                                                        <Ionicons
                                                            accessible={false}
                                                            name={checked ? "checkmark-circle" : "ellipse-outline"}
                                                            size={20}
                                                            color={checked ? BLUE : previewChevronColor}
                                                        />
                                                    </Pressable>
                                                );
                                            })}
                                        </View>
                                        {editingAlertMode === "ALARM" ? (
                                            <View
                                                accessible
                                                accessibilityLabel="교통 상황이 바뀌면 푸시로 알려드려요"
                                                style={styles.notificationModeNote}
                                            >
                                                <Ionicons
                                                    accessible={false}
                                                    name="notifications-outline"
                                                    size={16}
                                                    color={BLUE}
                                                />
                                                <Text
                                                    style={[
                                                        styles.notificationModeNoteText,
                                                        { color: colors.textSecondary },
                                                    ]}
                                                >
                                                    교통 상황이 바뀌면 푸시로 알려드려요.
                                                </Text>
                                            </View>
                                        ) : null}
                                    </View>
                                </View>
                            ) : (
                                <View
                                    style={[styles.notificationOffState, { borderTopColor: previewDividerColor }]}
                                >
                                    <Ionicons
                                        accessible={false}
                                        name="notifications-off-outline"
                                        size={17}
                                        color={colors.textSecondary}
                                    />
                                    <Text style={[styles.notificationOffText, { color: colors.textSecondary }]}>
                                        일정은 저장하고 출발 알림만 사용하지 않아요.
                                    </Text>
                                </View>
                            )}
                        </View>

                        {notificationEnabled && (
                            <View style={styles.notificationBehaviorNote}>
                                <Ionicons accessible={false} name="information-circle-outline" size={17} color={BLUE} />
                                <Text style={[styles.notificationBehaviorText, { color: colors.textSecondary }]}>
                                    <Text style={[styles.notificationBehaviorStrong, { color: colors.textPrimary }]}>
                                        {formatNotification(Number(editingValue))}부터 확인해요.{" "}
                                    </Text>
                                    교통이 느려지면 바로, 출발 시간이 가까워지면 준비 알림을 보내드려요.
                                </Text>
                            </View>
                        )}
                    </ScrollView>
                )}
                <View style={styles.editButtons}>
                    <Pressable
                        onPress={cancelEditField}
                        accessibilityRole="button"
                        style={({ pressed }) => [
                            styles.secondaryButton,
                            styles.editSecondaryButton,
                            {
                                backgroundColor: "transparent",
                                borderColor: previewDividerColor,
                                opacity: pressed ? 0.72 : 1,
                            },
                        ]}
                    >
                        <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>
                            {notificationNeedsRoute ? "지금은 안 함" : "취소"}
                        </Text>
                    </Pressable>
                    <Pressable
                        onPress={notificationNeedsRoute ? openRoutePlannerFromPreview : confirmEditField}
                        accessibilityRole="button"
                        accessibilityLabel={notificationNeedsRoute ? "빠른 일정 경로 설정" : "수정 확인"}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            styles.editPrimaryButton,
                            { opacity: pressed ? 0.78 : 1 },
                        ]}
                    >
                        <Text style={styles.primaryButtonText}>
                            {notificationNeedsRoute ? "경로 설정하기" : "적용"}
                        </Text>
                    </Pressable>
                </View>
            </View>
        );
    };

    const renderSavedStep = () => (
        <View style={styles.centerFlow}>
            <View style={[styles.statusIconWrap, { backgroundColor: "rgba(34,197,94,0.15)" }]}>
                <Ionicons accessible={false} name="checkmark" size={46} color={successColor} />
            </View>
            <Text style={[styles.flowHeadline, { color: colors.textPrimary }]}>일정이 저장됐어요</Text>
            <View style={styles.savedButtonStack}>
                <Pressable
                    onPress={requestClose}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                        styles.submitButton,
                        { alignSelf: "stretch", opacity: pressed ? 0.78 : 1 },
                    ]}
                >
                    <Text style={styles.submitText}>
                        {previewDraft ? `${formatKoreanDate(previewDraft.date)} 일정 보기` : "캘린더에서 보기"}
                    </Text>
                </Pressable>
            </View>
        </View>
    );

    const renderCurrentStep = () => {
        switch (flowStep) {
            case "analyzing":
            case "saving":
                return renderLoadingStep();
            case "analysisError":
                return renderErrorStep();
            case "preview":
                return renderPreviewStep();
            case "edit":
                return renderEditStep();
            case "saved":
                return renderSavedStep();
            case "input":
            default:
                return renderInputStep();
        }
    };

    // `finishClose` clears the local closing state before the parent's
    // `visible=false` prop is guaranteed to commit. Key visibility off the
    // local render lifecycle so the reset add-menu seed cannot flash for an
    // intermediate frame after the surface has finished closing.
    if (!rendered || routePlannerHidden) {
        return null;
    }

    const isPrewarmOnly = prewarm && !visible && !openStartedRef.current && !closingRef.current;

    return (
        <Reanimated.View pointerEvents={isPrewarmOnly ? "none" : "box-none"} style={[styles.screen, presentationStyle]}>
            <KeyboardAvoidingView
                accessibilityViewIsModal
                accessibilityElementsHidden={isPrewarmOnly}
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                importantForAccessibility={isPrewarmOnly ? "no-hide-descendants" : "auto"}
                pointerEvents={isPrewarmOnly ? "none" : "box-none"}
                style={styles.screenContent}
            >
                <Reanimated.View
                    pointerEvents="none"
                    style={[
                        styles.backdrop,
                        backdropAnimatedStyle,
                        {
                            backgroundColor: mode === "dark" ? "rgba(0,0,0,0.58)" : "rgba(0,0,0,0.30)",
                        },
                    ]}
                />
                <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={requestClose} />

                <Reanimated.View
                    collapsable={false}
                    onLayout={handleSeedLayout}
                    style={[styles.cardMotion, cardMotionStyle, cardMotionRadiusStyle]}
                >
                    <Reanimated.View
                        style={[
                            styles.cardClip,
                            cardClipRadiusStyle,
                            {
                                backgroundColor: "transparent",
                            },
                        ]}
                    >
                        <Reanimated.View
                            collapsable={false}
                            shouldRasterizeIOS={Platform.OS === "ios" && cardRasterized}
                            style={[
                                styles.card,
                                cardDenseCloseStyle,
                                {
                                    backgroundColor: cardSurfaceBackground,
                                    borderColor: cardBorderColor,
                                },
                            ]}
                        >
                            <View style={styles.content}>
                                {contentMounted && (
                                    <>
                                        <View style={[styles.closeButton, { backgroundColor: colors.surface2 }]}>
                                            <Pressable
                                                accessibilityRole="button"
                                                accessibilityLabel="빠른 일정 등록 닫기"
                                                accessibilityState={{
                                                    disabled: submitting && flowStep !== "analyzing",
                                                    busy: submitting,
                                                }}
                                                disabled={submitting && flowStep !== "analyzing"}
                                                onPress={requestClose}
                                                hitSlop={10}
                                                style={({ pressed }) => [
                                                    styles.closeButtonPressable,
                                                    { opacity: pressed ? 0.58 : 1 },
                                                ]}
                                            >
                                                <Ionicons
                                                    accessible={false}
                                                    name="close"
                                                    size={22}
                                                    color={colors.textSecondary}
                                                />
                                            </Pressable>
                                        </View>

                                        <View
                                            style={[
                                                styles.header,
                                                flowStep !== "input" && styles.headerCentered,
                                                (flowStep === "preview" || flowStep === "edit") && styles.flowHeader,
                                            ]}
                                        >
                                            {flowStep === "edit" && (
                                                <Pressable
                                                    accessibilityRole="button"
                                                    accessibilityLabel="일정 미리보기로 돌아가기"
                                                    onPress={cancelEditField}
                                                    hitSlop={10}
                                                    style={({ pressed }) => [
                                                        styles.backButton,
                                                        { opacity: pressed ? 0.58 : 1 },
                                                    ]}
                                                >
                                                    <Ionicons
                                                        accessible={false}
                                                        name="chevron-back"
                                                        size={22}
                                                        color={colors.textSecondary}
                                                    />
                                                </Pressable>
                                            )}
                                            <Text
                                                style={[
                                                    styles.title,
                                                    (flowStep === "preview" || flowStep === "edit") &&
                                                        styles.flowHeaderTitle,
                                                    { color: colors.textPrimary },
                                                ]}
                                            >
                                                {flowTitle}
                                            </Text>
                                            {flowStep === "input" && (
                                                <Text
                                                    style={[styles.headerDescription, { color: colors.textSecondary }]}
                                                >
                                                    {inputModeDescription}
                                                </Text>
                                            )}
                                        </View>

                                        {categoryError && onRetryCategories ? (
                                            <CategoryLoadErrorBanner
                                                compact
                                                retrying={categoryLoading}
                                                onRetry={onRetryCategories}
                                            />
                                        ) : null}

                                        <View style={styles.handoffBody}>{renderCurrentStep()}</View>
                                    </>
                                )}
                            </View>
                        </Reanimated.View>
                        <Reanimated.View
                            pointerEvents="none"
                            style={[
                                styles.contentRevealCurtain,
                                contentRevealCurtainAnimatedStyle,
                                { backgroundColor: cardSurfaceBackground },
                            ]}
                        />
                    </Reanimated.View>
                </Reanimated.View>
            </KeyboardAvoidingView>
        </Reanimated.View>
    );
}

const styles = StyleSheet.create({
    screen: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 80,
        elevation: 80,
    },
    screenContent: {
        flex: 1,
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    cardMotion: {
        position: "absolute",
        transformOrigin: [0, 0, 0],
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.16,
        shadowRadius: 22,
        elevation: 16,
    },
    cardClip: {
        width: "100%",
        height: "100%",
        borderRadius: EXPANDED_CARD_RADIUS,
        overflow: "hidden",
    },
    card: {
        width: "100%",
        height: "100%",
        borderWidth: 1,
        zIndex: 1,
    },
    content: {
        flex: 1,
        transformOrigin: [0, 0, 0],
        paddingHorizontal: 18,
        paddingTop: 24,
        paddingBottom: 15,
    },
    closeButton: {
        position: "absolute",
        top: 16,
        right: 16,
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2,
    },
    closeButtonPressable: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "center",
        justifyContent: "center",
    },
    handoffBody: {
        flex: 1,
    },
    inputStep: {
        flex: 1,
        minHeight: 0,
    },
    inputStepScroll: {
        flex: 1,
        minHeight: 0,
    },
    inputStepScrollContent: {
        paddingBottom: 10,
    },
    contentRevealCurtain: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 2,
    },
    backButton: {
        position: "absolute",
        left: 0,
        top: -4,
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2,
    },
    header: {
        alignItems: "flex-start",
        paddingRight: 42,
        marginBottom: 16,
    },
    headerCentered: {
        alignItems: "center",
        paddingHorizontal: 36,
    },
    flowHeader: {
        marginBottom: 12,
    },
    title: {
        fontSize: 20,
        lineHeight: 25,
        fontWeight: "800",
        letterSpacing: -0.3,
    },
    flowHeaderTitle: {
        fontSize: 19,
        lineHeight: 24,
        fontWeight: "700",
        letterSpacing: -0.2,
    },
    headerDescription: {
        marginTop: 4,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "500",
    },
    modeSelector: {
        height: 44,
        borderRadius: 13,
        borderWidth: 1,
        alignSelf: "stretch",
        flexDirection: "row",
        padding: 3,
        marginBottom: 16,
        overflow: "hidden",
    },
    modeSelectorIndicator: {
        position: "absolute",
        top: 3,
        bottom: 3,
        left: 0,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
    },
    modeButton: {
        flex: 1,
        minWidth: 0,
        borderRadius: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingHorizontal: 8,
        zIndex: 1,
    },
    modeButtonSelected: {
        shadowColor: "transparent",
    },
    modeText: {
        fontSize: 13,
        fontWeight: "700",
    },
    textModeContent: {
        marginBottom: 16,
    },
    sectionHeader: {
        marginBottom: 9,
    },
    sectionTitle: {
        fontSize: 14,
        lineHeight: 19,
        fontWeight: "800",
    },
    sectionDescription: {
        marginTop: 2,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "500",
    },
    inputWrap: {
        minHeight: 142,
        borderRadius: 14,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingTop: 13,
        paddingBottom: 29,
    },
    input: {
        flex: 1,
        minHeight: 96,
        fontSize: 15,
        lineHeight: 22,
        fontWeight: "400",
        textAlignVertical: "top",
        padding: 0,
    },
    counterPill: {
        position: "absolute",
        right: 14,
        bottom: 10,
    },
    counter: {
        fontSize: 11,
        fontWeight: "600",
    },
    photoModeContent: {
        marginBottom: 14,
    },
    photoPreviewButton: {
        height: 190,
        borderRadius: 18,
        borderWidth: 1,
        overflow: "hidden",
    },
    photoImageBackdrop: {
        ...StyleSheet.absoluteFillObject,
        width: "100%",
        height: "100%",
        opacity: 0.32,
        transform: [{ scale: 1.08 }],
    },
    photoImageBackdropScrim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(5,10,18,0.50)",
    },
    photoImageStage: {
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1,
    },
    photoScanFrame: {
        alignSelf: "center",
        backgroundColor: "#070B13",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255,255,255,0.16)",
    },
    photoImage: {
        width: "100%",
        height: "100%",
    },
    photoStatusPill: {
        position: "absolute",
        top: 12,
        left: 12,
        maxWidth: 186,
        minHeight: 34,
        borderRadius: 17,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        paddingHorizontal: 11,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255,255,255,0.16)",
        zIndex: 3,
    },
    photoStatusText: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "800",
    },
    photoChangeButton: {
        position: "absolute",
        right: 12,
        bottom: 12,
        minHeight: 44,
        borderRadius: 22,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingHorizontal: 13,
        backgroundColor: "rgba(8,13,22,0.80)",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255,255,255,0.18)",
        zIndex: 3,
    },
    photoChangeButtonText: {
        color: "#FFFFFF",
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "800",
    },
    photoEmptyPanel: {
        minHeight: 144,
        borderRadius: 15,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 22,
        paddingVertical: 18,
    },
    photoEmptyIcon: {
        width: 44,
        height: 44,
        borderRadius: 13,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 11,
    },
    photoEmptyTitle: {
        fontSize: 15,
        lineHeight: 20,
        fontWeight: "800",
        textAlign: "center",
    },
    photoEmptyMeta: {
        marginTop: 4,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "500",
        textAlign: "center",
    },
    photoRemoveButton: {
        position: "absolute",
        top: 12,
        right: 12,
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(8,13,22,0.78)",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255,255,255,0.18)",
        zIndex: 3,
    },
    photoTranscriptWrap: {
        minHeight: 128,
        marginTop: 12,
        borderRadius: 16,
        borderWidth: 1,
        paddingHorizontal: 13,
        paddingTop: 12,
        paddingBottom: 12,
    },
    photoTranscriptHeader: {
        minHeight: 38,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    photoResultIcon: {
        width: 36,
        height: 36,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    photoResultTitleWrap: {
        flex: 1,
        minWidth: 0,
    },
    photoTranscriptLabel: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "800",
    },
    photoResultMeta: {
        marginTop: 1,
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "600",
    },
    photoConfidence: {
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "800",
    },
    truncatedRecognitionBadge: {
        minHeight: 26,
        borderRadius: 13,
        justifyContent: "center",
        paddingHorizontal: 9,
        backgroundColor: "rgba(245,158,11,0.11)",
    },
    truncatedRecognitionText: {
        color: "#F59E0B",
    },
    photoReviewBadge: {
        minHeight: 26,
        borderRadius: 13,
        justifyContent: "center",
        paddingHorizontal: 9,
        backgroundColor: "rgba(245,158,11,0.12)",
    },
    photoReviewBadgeText: {
        color: "#D97706",
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "800",
    },
    photoReadingPlaceholder: {
        minHeight: 72,
        justifyContent: "center",
        gap: 9,
        marginTop: 10,
        paddingHorizontal: 3,
    },
    photoReadingLine: {
        height: 8,
        borderRadius: 4,
        backgroundColor: "rgba(126,145,171,0.14)",
    },
    photoReadingLineLong: {
        width: "92%",
    },
    photoReadingLineMedium: {
        width: "72%",
    },
    photoReadingLineShort: {
        width: "46%",
    },
    photoTranscriptInputWrap: {
        marginTop: 10,
        paddingTop: 9,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: "rgba(126,145,171,0.22)",
    },
    photoTranscriptInputLabel: {
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "800",
    },
    photoTranscriptInput: {
        minHeight: 54,
        maxHeight: 92,
        padding: 0,
        marginTop: 5,
        fontSize: 14,
        lineHeight: 20,
        fontWeight: "400",
        textAlignVertical: "top",
    },
    photoRecognitionErrorWrap: {
        marginTop: 10,
        alignItems: "flex-start",
        justifyContent: "center",
        gap: 4,
        borderRadius: 13,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 11,
        paddingTop: 10,
        paddingBottom: 9,
    },
    photoRecognitionErrorTitle: {
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "800",
    },
    photoRecognitionErrorText: {
        fontSize: 11,
        lineHeight: 16,
        fontWeight: "600",
    },
    photoRecognitionRetry: {
        minHeight: 44,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        marginTop: 4,
        paddingHorizontal: 12,
        backgroundColor: "rgba(36,107,254,0.12)",
    },
    photoRecognitionRetryText: {
        color: BLUE,
        fontSize: 12,
        fontWeight: "800",
    },
    lowConfidenceNotice: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 5,
        marginTop: 5,
        paddingTop: 7,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: "rgba(245,158,11,0.32)",
    },
    lowConfidenceNoticeText: {
        flex: 1,
        color: "#D97706",
        fontSize: 11,
        lineHeight: 16,
        fontWeight: "700",
    },
    voicePanel: {
        minHeight: 322,
        borderRadius: 15,
        borderWidth: 1,
        paddingHorizontal: 13,
        paddingVertical: 13,
        marginBottom: 14,
        overflow: "hidden",
    },
    voiceRecordControl: {
        width: "100%",
        alignItems: "center",
    },
    voiceOrbWrap: {
        width: 150,
        height: 146,
        alignItems: "center",
        justifyContent: "center",
    },
    voiceSpectrum: {
        position: "absolute",
        width: VOICE_SPECTRUM_SIZE,
        height: VOICE_SPECTRUM_SIZE,
        borderRadius: VOICE_SPECTRUM_SIZE / 2,
    },
    voiceSpectrumHaloOuter: {
        position: "absolute",
        width: 112,
        height: 112,
        borderRadius: 56,
        borderWidth: 1,
        borderColor: "rgba(88,215,247,0.48)",
    },
    voiceSpectrumHaloInner: {
        position: "absolute",
        width: 88,
        height: 88,
        borderRadius: 44,
        borderWidth: 1,
        borderColor: "rgba(36,107,254,0.38)",
        backgroundColor: "rgba(36,107,254,0.13)",
        shadowColor: BLUE,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.24,
        shadowRadius: 20,
    },
    voiceSpectrumBarSlot: {
        position: "absolute",
        left: VOICE_SPECTRUM_SIZE / 2 - 1,
        top: 0,
        width: 2,
        height: VOICE_SPECTRUM_SIZE,
        alignItems: "center",
    },
    voiceSpectrumBar: {
        position: "absolute",
        bottom: VOICE_SPECTRUM_SIZE / 2 + VOICE_SPECTRUM_INNER_RADIUS,
        width: 2,
        minHeight: 3,
        borderRadius: 1,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
    },
    voiceOrb: {
        width: 62,
        height: 62,
        borderRadius: 31,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: BLUE,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.14,
        shadowRadius: 18,
    },
    voiceTitle: {
        fontSize: 16,
        lineHeight: 21,
        fontWeight: "800",
        textAlign: "center",
    },
    voiceMeta: {
        marginTop: 3,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "500",
        textAlign: "center",
    },
    voiceTranscriptWrap: {
        minHeight: 96,
        marginTop: 10,
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingTop: 9,
        paddingBottom: 8,
    },
    voiceTranscriptHeader: {
        minHeight: 18,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    voiceTranscriptLabel: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "800",
    },
    voiceConfidence: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "700",
    },
    voiceTranscriptInput: {
        minHeight: 50,
        maxHeight: 70,
        padding: 0,
        marginTop: 3,
        fontSize: 14,
        lineHeight: 20,
        fontWeight: "400",
        textAlignVertical: "top",
    },
    centerFlow: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 8,
        gap: 10,
    },
    statusIconWrap: {
        width: 72,
        height: 72,
        borderRadius: 36,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 4,
    },
    flowHeadline: {
        fontSize: 17,
        lineHeight: 23,
        fontWeight: "900",
        textAlign: "center",
    },
    flowCaption: {
        fontSize: 13,
        lineHeight: 19,
        fontWeight: "600",
        textAlign: "center",
    },
    previewStep: {
        flex: 1,
        minHeight: 0,
    },
    previewScroll: {
        flex: 1,
        minHeight: 0,
    },
    previewScrollContent: {
        paddingBottom: 4,
    },
    previewSourceStrip: {
        minHeight: 46,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        paddingHorizontal: 2,
        paddingVertical: 5,
    },
    previewSourceCopy: {
        flex: 1,
        minWidth: 0,
    },
    previewSourceLabel: {
        marginBottom: 3,
        fontSize: 10.5,
        lineHeight: 14,
        fontWeight: "500",
    },
    previewSourceValue: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "500",
    },
    previewSourceAction: {
        color: BLUE,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "600",
        alignSelf: "flex-end",
        marginBottom: 2,
    },
    previewTitleRow: {
        minHeight: 54,
        justifyContent: "center",
        paddingHorizontal: 3,
        paddingVertical: 6,
    },
    previewLabel: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "500",
        marginBottom: 2,
    },
    previewTitleValueRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
    },
    previewTitleValue: {
        fontSize: 18,
        lineHeight: 23,
        fontWeight: "700",
        letterSpacing: -0.35,
        flexShrink: 1,
    },
    previewInfoRow: {
        minHeight: 54,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 2,
        paddingVertical: 6,
    },
    previewPlaceRow: {
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    previewInfoIcon: {
        width: 26,
        height: 26,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    previewInfoCopy: {
        flex: 1,
        minWidth: 0,
    },
    previewDateTimeValue: {
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        columnGap: 4,
    },
    previewDateTimeValueStacked: {
        minHeight: 64,
        flexDirection: "column",
        alignItems: "flex-start",
        flexWrap: "nowrap",
        rowGap: 0,
    },
    previewInlineField: {
        minHeight: 44,
        flexShrink: 1,
        justifyContent: "center",
    },
    previewInlineFieldStacked: {
        minHeight: 32,
    },
    previewInlineContent: {
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 5,
    },
    previewValueChevron: {
        flexShrink: 0,
    },
    previewInlineValue: {
        fontSize: 14,
        lineHeight: 19,
        fontWeight: "600",
        flexShrink: 1,
    },
    previewDateTimeSeparator: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "600",
    },
    previewInfoValueRow: {
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 6,
    },
    previewInfoValue: {
        fontSize: 14.5,
        lineHeight: 20,
        fontWeight: "600",
        flexShrink: 1,
    },
    previewOptional: {
        minHeight: 52,
        marginHorizontal: 2,
        marginTop: 2,
        paddingTop: 6,
        borderTopWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "stretch",
    },
    previewOptionalItem: {
        flex: 1,
        minWidth: 0,
        minHeight: 44,
        paddingRight: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 6,
    },
    previewOptionalItemTrailing: {
        paddingLeft: 14,
        paddingRight: 0,
    },
    previewOptionalDivider: {
        width: StyleSheet.hairlineWidth,
        marginVertical: 8,
    },
    previewOptionalCopy: {
        flex: 1,
        minWidth: 0,
    },
    previewOptionalValueRow: {
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 5,
    },
    previewOptionalValue: {
        fontSize: 14,
        lineHeight: 19,
        fontWeight: "600",
        flexShrink: 1,
    },
    warningBadge: {
        borderRadius: 7,
        paddingHorizontal: 6,
        paddingVertical: 2.5,
    },
    warningBadgeText: {
        fontSize: 9.5,
        fontWeight: "900",
    },
    previewButtons: {
        flexDirection: "row",
        gap: 8,
        paddingTop: 6,
    },
    previewSecondaryButton: {
        height: 46,
        borderRadius: 14,
    },
    previewPrimaryButton: {
        flex: 1.55,
        height: 46,
        borderRadius: 14,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 10,
        elevation: 3,
    },
    previewSecondaryButtonText: {
        fontWeight: "700",
    },
    previewPrimaryButtonText: {
        fontWeight: "700",
    },
    secondaryButton: {
        flex: 1,
        height: 44,
        borderRadius: 15,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    secondaryButtonText: {
        fontSize: 14,
        fontWeight: "700",
    },
    primaryButton: {
        flex: 1.22,
        height: 44,
        borderRadius: 15,
        backgroundColor: BLUE,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: BLUE,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.2,
        shadowRadius: 18,
    },
    primaryButtonText: {
        color: "#fff",
        fontSize: 14,
        fontWeight: "700",
    },
    editStep: {
        flex: 1,
        justifyContent: "space-between",
        gap: 12,
    },
    editInput: {
        minHeight: 88,
        borderRadius: 16,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 15,
        lineHeight: 22,
        fontWeight: "600",
        textAlignVertical: "top",
    },
    editInputMemo: {
        minHeight: 132,
    },
    locationEditInput: {
        minHeight: 54,
        textAlignVertical: "center",
    },
    routeEditPanel: {
        flex: 1,
        justifyContent: "flex-start",
        paddingTop: 2,
    },
    routeEditNotice: {
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 11,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    routeEditNoticeText: {
        flex: 1,
        fontSize: 11.5,
        lineHeight: 17,
        fontWeight: "600",
    },
    pickerPanel: {
        borderRadius: 16,
        borderWidth: 1,
        overflow: "hidden",
        paddingBottom: 10,
    },
    editSegmented: {
        height: 36,
        borderRadius: 9,
        padding: 3,
        flexDirection: "row",
        gap: 3,
    },
    editSegment: {
        flex: 1,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
    },
    editSegmentText: {
        fontSize: 12,
        fontWeight: "600",
    },
    dateTimePicker: {
        alignSelf: "stretch",
        height: 180,
    },
    aiHint: {
        marginHorizontal: 12,
        minHeight: 34,
        borderRadius: 12,
        paddingHorizontal: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    aiHintText: {
        flex: 1,
        fontSize: 11,
        lineHeight: 16,
        fontWeight: "600",
    },
    notificationEditor: {
        flex: 1,
        minHeight: 0,
    },
    notificationEditorContent: {
        gap: 9,
        paddingBottom: 2,
    },
    notificationHero: {
        borderWidth: 1,
        borderRadius: 16,
        padding: 12,
    },
    notificationHeroHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    notificationHeroIcon: {
        width: 40,
        height: 40,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    notificationHeroText: {
        flex: 1,
        minWidth: 0,
    },
    notificationHeroTitle: {
        fontSize: 14,
        lineHeight: 19,
        fontWeight: "700",
    },
    notificationHeroBody: {
        marginTop: 2,
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "600",
    },
    notificationRouteSummary: {
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
    },
    notificationRouteMetric: {
        flex: 1,
        alignItems: "center",
    },
    notificationRouteMetricLabel: {
        fontSize: 9.5,
        lineHeight: 13,
        fontWeight: "600",
    },
    notificationRouteMetricValue: {
        marginTop: 2,
        fontSize: 12.5,
        lineHeight: 17,
        fontWeight: "700",
    },
    notificationRouteMetricDivider: {
        width: StyleSheet.hairlineWidth,
        height: 28,
    },
    notificationControlCard: {
        borderWidth: 1,
        borderRadius: 16,
        padding: 12,
    },
    notificationToggleRow: {
        minHeight: 38,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    notificationToggleText: {
        flex: 1,
        minWidth: 0,
    },
    notificationToggleTitle: {
        fontSize: 13.5,
        lineHeight: 18,
        fontWeight: "700",
    },
    notificationToggleBody: {
        marginTop: 2,
        fontSize: 10.5,
        lineHeight: 14,
        fontWeight: "600",
    },
    notificationLeadSection: {
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    notificationLeadHeading: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    notificationLeadTitle: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "700",
    },
    notificationLeadCaption: {
        fontSize: 9.5,
        lineHeight: 13,
        fontWeight: "600",
    },
    notificationOptions: {
        marginTop: 8,
        flexDirection: "row",
        gap: 7,
    },
    notificationChip: {
        flex: 1,
        minWidth: 0,
        minHeight: 40,
        borderRadius: 12,
        borderWidth: 1,
        flexDirection: "row",
        gap: 4,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 6,
    },
    notificationChipText: {
        fontSize: 12,
        fontWeight: "700",
    },
    notificationModeSection: {
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    notificationModeOptions: {
        marginTop: 8,
        gap: 7,
    },
    notificationModeButton: {
        minWidth: 0,
        minHeight: 76,
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
    notificationModeIcon: {
        width: 34,
        height: 34,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
    },
    notificationModeCopy: {
        flex: 1,
        minWidth: 0,
    },
    notificationModeText: {
        fontSize: 11.5,
        fontWeight: "700",
    },
    notificationModeDescription: {
        marginTop: 3,
        fontSize: 9.5,
        lineHeight: 14,
        fontWeight: "600",
    },
    notificationModeNote: {
        marginTop: 8,
        paddingHorizontal: 2,
        paddingVertical: 5,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 7,
    },
    notificationModeNoteText: {
        flex: 1,
        fontSize: 9.5,
        lineHeight: 14,
        fontWeight: "600",
    },
    notificationOffState: {
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
        minHeight: 34,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
    notificationOffText: {
        flex: 1,
        fontSize: 10.5,
        lineHeight: 15,
        fontWeight: "600",
    },
    notificationBehaviorNote: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 7,
        paddingHorizontal: 4,
    },
    notificationBehaviorText: {
        flex: 1,
        fontSize: 10.5,
        lineHeight: 15,
        fontWeight: "600",
    },
    notificationBehaviorStrong: {
        fontWeight: "700",
    },
    notificationRouteRequired: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 8,
        gap: 8,
    },
    notificationRouteIcon: {
        width: 58,
        height: 58,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 2,
    },
    notificationRouteTitle: {
        fontSize: 16,
        lineHeight: 22,
        fontWeight: "700",
        textAlign: "center",
    },
    notificationRouteBody: {
        maxWidth: 270,
        fontSize: 11.5,
        lineHeight: 17,
        fontWeight: "600",
        textAlign: "center",
    },
    notificationFeatureList: {
        alignSelf: "stretch",
        marginTop: 5,
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 12,
    },
    notificationFeatureRow: {
        minHeight: 37,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
    notificationFeatureDivider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 26,
    },
    notificationFeatureText: {
        flex: 1,
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "600",
    },
    notificationOptionalNotice: {
        minHeight: 22,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    notificationOptionalText: {
        fontSize: 10.5,
        lineHeight: 15,
        fontWeight: "600",
    },
    editButtons: {
        flexDirection: "row",
        gap: 8,
    },
    editSecondaryButton: {
        height: 46,
        borderRadius: 14,
    },
    editPrimaryButton: {
        height: 46,
        borderRadius: 14,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 10,
        elevation: 3,
    },
    savedSummary: {
        alignSelf: "stretch",
        borderRadius: 18,
        borderWidth: 1,
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 5,
        marginVertical: 4,
    },
    savedTitle: {
        fontSize: 15,
        fontWeight: "900",
    },
    savedMeta: {
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "700",
    },
    savedButtonStack: {
        alignSelf: "stretch",
        gap: 8,
        marginTop: 18,
    },
    submitButton: {
        height: 50,
        borderRadius: 13,
        backgroundColor: BLUE,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
    },
    submitText: {
        color: "#fff",
        fontSize: 15,
        fontWeight: "800",
    },
});
