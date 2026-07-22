import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    AppState,
    ActionSheetIOS,
    BackHandler,
    Image,
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
    recognizeQuickSchedulePhoto,
    type QuickScheduleMediaInput,
} from "../../quickInputExtraction";
import { finalizeQuickScheduleRecording } from "../../quickInputRecording";
import {
    canScanDocuments,
    discardDocumentScanPages,
    scanDocuments,
} from "../../documentScanner";
import {
    addLiveSpeechLevelListener,
    addLiveSpeechStateListener,
    addLiveSpeechTranscriptListener,
    cancelLiveSpeechRecognition,
    createLiveSpeechSessionId,
    isLiveSpeechRecognitionAvailable,
    startLiveSpeechRecognition,
    stopLiveSpeechRecognition,
} from "../../liveSpeechRecognition";
import type { ScheduleCategory, ScheduleItem, ScheduleParseResult } from "../../types";
import { canWriteScheduleCategory } from "../../categoryPermissions";
import { formatRouteClock, formatRouteDuration } from "../../routeInfo";
import { consumeRoutePlannerResult, setRoutePlannerInitial } from "../../routePlannerSession";
import {
    applyQuickScheduleRouteResult as applyRouteResultToPreviewDraft,
    buildQuickSchedulePayload,
    buildQuickSchedulePreviewDraft as buildPreviewDraft,
    getQuickSchedulePreviewRouteInfo,
    getQuickScheduleBlockingReviewField,
    isQuickScheduleRouteReady as canUseRouteNotification,
    quickSchedulePlaceFromLocation as placeFromDraftLocation,
    updateQuickSchedulePreviewDraft,
    type QuickSchedulePreviewDraft as PreviewDraft,
    type QuickSchedulePreviewField as PreviewField,
} from "../../quickScheduleDraft";
import QuickScheduleLogoLoader from "./QuickScheduleLogoLoader";
import BrandedLoader from "../../../../ui/BrandedLoader";
import CategoryLoadErrorBanner from "./CategoryLoadErrorBanner";

type Props = {
    visible: boolean;
    prewarm?: boolean;
    initialText?: string;
    initialRequestId?: string;
    initialInputType?: QuickScheduleMediaInput["inputTypeOverride"];
    onClose: () => void;
    onCloseStart?: () => void;
    onAnalyze: (text: string, media?: QuickScheduleMediaInput) => Promise<ScheduleParseResult>;
    onSave: (payload: Omit<ScheduleItem, "id">) => void | Promise<void>;
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

function limitRecognizedText(value: string) {
    return {
        text: value.slice(0, QUICK_TEXT_LIMIT),
        truncated: value.length > QUICK_TEXT_LIMIT,
    };
}

const BLUE = "#246BFE";
const OPEN_START_PROGRESS = 0;
const PREWARM_PRESENTATION_OPACITY = 0.001;
const OPEN_DURATION_MS = ADD_HANDOFF_MOTION.quickOpenMs;
const CLOSE_SURFACE_DELAY_MS = 0;
const CLOSE_TARGET_WIDTH = 150;
const CLOSE_TARGET_HEIGHT = 44;
const EXPANDED_CARD_RADIUS = 38;
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
    overshootClamping: false,
};
const CARD_HEIGHT_BY_MODE: Record<InputMode, number> = {
    text: 368,
    photo: 600,
    voice: 600,
};
const LOW_RECOGNITION_CONFIDENCE = 0.65;
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
    preview: 456,
    edit: 456,
    saving: 368,
    saved: 368,
};
const INPUT_MODES: Array<{
    key: InputMode;
    label: string;
    accessibilityLabel: string;
    icon: keyof typeof Ionicons.glyphMap;
}> = [
    { key: "text", label: "텍스트", accessibilityLabel: "텍스트로 빠른 일정 만들기", icon: "text-outline" },
    { key: "photo", label: "사진", accessibilityLabel: "사진으로 빠른 일정 만들기", icon: "image-outline" },
    { key: "voice", label: "음성", accessibilityLabel: "음성으로 빠른 일정 만들기", icon: "mic-outline" },
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

        const speechEnvelope = 0.52
            + Math.sin(index * 0.57) * 0.24
            + Math.sin(index * 1.31 + 0.8) * 0.16;
        return Math.max(0.04, Math.min(1, level * Math.max(0.2, speechEnvelope)));
    });
}

function appendVoiceMeterHistory(history: number[], level: number) {
    const source = history.length === VOICE_SPECTRUM_SAMPLE_COUNT
        ? history
        : createVoiceMeterHistory();
    const normalized = Math.max(0, Math.min(1, level));
    const previous = source[source.length - 1] ?? 0;

    // 미터링 값은 프레임마다 편차가 크다. 상승은 빠르게 따라가고 하강은 천천히
    // 놓아주는 필터로 말소리의 박자는 살리면서 막대가 덜컥거리는 느낌을 줄인다.
    const smoothed = normalized >= previous
        ? previous * 0.18 + normalized * 0.82
        : previous * 0.72 + normalized * 0.28;

    return [...source.slice(1), smoothed];
}

function VoiceSpectrumBar({
    angle,
    color,
    level,
}: {
    angle: string;
    color: string;
    level: number;
}) {
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
            style={[
                styles.voiceSpectrumBarSlot,
                { transform: [{ rotate: angle }] },
            ]}
        >
            <Reanimated.View
                style={[
                    styles.voiceSpectrumBar,
                    { backgroundColor: color, shadowColor: color },
                    animatedStyle,
                ]}
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
            <Reanimated.View
                pointerEvents="none"
                style={[
                    styles.voiceSpectrumHaloOuter,
                    outerAnimatedStyle,
                ]}
            />
            <Reanimated.View
                pointerEvents="none"
                style={[
                    styles.voiceSpectrumHaloInner,
                    innerAnimatedStyle,
                ]}
            />
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
    setTimeout(task, 120);
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
    return new Promise<void>((resolve) => {
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

        subscription = AppState.addEventListener("change", (state) => {
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
    onClose,
    onCloseStart,
    onAnalyze,
    onSave,
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
    const [isDocumentScanning, setIsDocumentScanning] = useState(false);
    const [documentScannerSupported, setDocumentScannerSupported] = useState(false);
    const [voiceUri, setVoiceUri] = useState<string | null>(null);
    const [voiceDurationMillis, setVoiceDurationMillis] = useState(0);
    const [voiceTranscript, setVoiceTranscript] = useState("");
    const [voiceTranscriptTruncated, setVoiceTranscriptTruncated] = useState(false);
    const [voiceRecognitionConfidence, setVoiceRecognitionConfidence] = useState<number>();
    const [voiceStatusMessage, setVoiceStatusMessage] = useState("");
    const [isVoiceRecording, setIsVoiceRecording] = useState(false);
    const [isVoiceFinalizing, setIsVoiceFinalizing] = useState(false);
    const [voiceMeterHistory, setVoiceMeterHistory] = useState(() => (
        createVoiceMeterHistory(0)
    ));
    const [voiceSpectrumEnergy, setVoiceSpectrumEnergy] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [cardRasterized, setCardRasterized] = useState(false);
    const [contentMounted, setContentMounted] = useState(visible || prewarm);
    const [modeLayouts, setModeLayouts] = useState<Partial<Record<InputMode, TabLayout>>>({});
    const [flowStep, setFlowStep] = useState<FlowStep>("input");
    const [analysisError, setAnalysisError] = useState("");
    const [previewDraft, setPreviewDraft] = useState<PreviewDraft | null>(null);
    const [editingField, setEditingField] = useState<PreviewField | null>(null);
    const [editingValue, setEditingValue] = useState("");
    const [timeEditMode, setTimeEditMode] = useState<TimeEditMode>("picker");
    const [routePlannerSessionId, setRoutePlannerSessionId] = useState<string | undefined>();
    const [routePlannerHidden, setRoutePlannerHidden] = useState(false);
    const recorderState = {
        isRecording: isVoiceRecording,
        durationMillis: voiceDurationMillis,
    };
    const progress = useSharedValue(0);
    const closingPhase = useSharedValue(0);
    const presentationOpacity = useSharedValue(
        visible && !prewarm ? 1 : PREWARM_PRESENTATION_OPACITY
    );
    const presentationStyle = useAnimatedStyle(() => ({
        opacity: presentationOpacity.value,
    }));
    const modeIndicatorX = useSharedValue(0);
    const modeIndicatorWidth = useSharedValue(0);
    const inputRef = useRef<TextInput>(null);
    const audioRecordingRef = useRef<Audio.Recording | null>(null);
    const liveSpeechSessionIdRef = useRef<string | null>(null);
    const liveSpeechStartingRef = useRef(false);
    const liveSpeechOperationRef = useRef(0);
    const liveSpeechStopInFlightRef = useRef<{
        operation: number;
        sessionId: string;
    } | null>(null);
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
    const analysisSequenceRef = useRef(0);
    const photoRecognitionSequenceRef = useRef(0);
    const documentScanOperationRef = useRef(0);
    const ownedDocumentScanUrisRef = useRef<string[]>([]);
    const mountedRef = useRef(false);
    const analysisPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const analysisInFlightRef = useRef(false);
    const saveInFlightRef = useRef(false);

    const discardOwnedDocumentScans = useCallback(() => {
        const uris = ownedDocumentScanUrisRef.current;
        ownedDocumentScanUrisRef.current = [];
        if (uris.length > 0) {
            void discardDocumentScanPages(uris).catch(() => undefined);
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            documentScanOperationRef.current += 1;
            discardOwnedDocumentScans();
        };
    }, [discardOwnedDocumentScans]);

    useEffect(() => {
        const belongsToActiveSession = (sessionId: string) => (
            liveSpeechSessionIdRef.current === sessionId
        );

        const transcriptSubscription = addLiveSpeechTranscriptListener((event) => {
            if (!belongsToActiveSession(event.sessionId)) return;
            const limited = limitRecognizedText(event.text);
            setVoiceTranscript(limited.text);
            setVoiceTranscriptTruncated(limited.truncated);
            if (event.confidence !== undefined) {
                setVoiceRecognitionConfidence(event.confidence);
            }
            if (event.elapsedMillis !== undefined) {
                setVoiceDurationMillis(event.elapsedMillis);
            }
        });
        const levelSubscription = addLiveSpeechLevelListener((event) => {
            if (!belongsToActiveSession(event.sessionId)) return;
            const level = Math.max(event.rms, event.peak * 0.72);
            setVoiceMeterHistory((current) => appendVoiceMeterHistory(current, level));
            setVoiceSpectrumEnergy(level);
            if (event.elapsedMillis !== undefined) {
                setVoiceDurationMillis(event.elapsedMillis);
            }
        });
        const stateSubscription = addLiveSpeechStateListener((event) => {
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
                liveSpeechSessionIdRef.current = null;
                liveSpeechStartingRef.current = false;
                setIsVoiceRecording(false);
                setIsVoiceFinalizing(false);
                setVoiceMeterHistory(createVoiceMeterHistory());
                setVoiceSpectrumEnergy(0);
                setVoiceStatusMessage(event.state === "failed"
                    ? event.message ?? "음성을 인식하지 못했습니다. 다시 말해 주세요."
                    : "");
            }
        });

        return () => {
            transcriptSubscription?.remove();
            levelSubscription?.remove();
            stateSubscription?.remove();
        };
    }, []);

    useEffect(() => {
        if (Platform.OS !== "ios" || !visible) return undefined;

        let cancelled = false;
        void canScanDocuments().then((supported) => {
            if (!cancelled) setDocumentScannerSupported(supported);
        });
        return () => {
            cancelled = true;
        };
    }, [visible]);

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
        void recognizeQuickSchedulePhoto(photoUri)
            .then((recognition) => {
                if (photoRecognitionSequenceRef.current !== sequence) return;
                const limited = limitRecognizedText(recognition.text);
                setPhotoTranscript(limited.text);
                setPhotoTranscriptTruncated(limited.truncated);
                setPhotoRecognitionConfidence(recognition.recognitionConfidence);
            })
            .catch((error) => {
                if (photoRecognitionSequenceRef.current !== sequence) return;
                setPhotoRecognitionError(error instanceof Error
                    ? error.message
                    : "사진에서 일정 문장을 인식하지 못했습니다.");
            })
            .finally(() => {
                if (photoRecognitionSequenceRef.current === sequence) {
                    setIsPhotoRecognizing(false);
                }
            });

        return () => {
            if (photoRecognitionSequenceRef.current === sequence) {
                photoRecognitionSequenceRef.current += 1;
            }
        };
    }, [photoRecognitionAttempt, selectedPhoto?.uri]);

    if (
        visible ||
        (!openStartedRef.current && openHandoffFrameRef.current === null)
    ) {
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
    const targetCardHeight = flowStep === "input"
        ? CARD_HEIGHT_BY_MODE[inputMode]
        : FLOW_CARD_HEIGHT_BY_STEP[flowStep];
    const cardHeight = Math.min(
        targetCardHeight,
        height - cardTop - Math.max(insets.bottom, 16) - 12
    );
    const expandedCardHeight = useSharedValue(cardHeight);
    const cardLeft = (width - cardWidth) / 2;
    const openSourceRadius = Math.min(openSourceHeight / 2, ADD_MENU_SOURCE.nativeRadius);
    const closeSourceRadius = Math.min(closeSourceHeight / 2, ADD_MENU_SOURCE.nativeRadius);

    const notificationRouteReady = canUseRouteNotification(previewDraft);

    const handleModeLayout = useCallback((key: InputMode) => (event: LayoutChangeEvent) => {
        const { x, width: measuredWidth } = event.nativeEvent.layout;

        setModeLayouts((current) => {
            const previous = current[key];
            if (
                previous &&
                Math.abs(previous.x - x) < 0.5 &&
                Math.abs(previous.width - measuredWidth) < 0.5
            ) {
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
    }, []);

    const clearVoiceTimer = useCallback(() => {
        if (voiceTimerRef.current) {
            clearInterval(voiceTimerRef.current);
            voiceTimerRef.current = null;
        }
    }, []);

    const stopActiveRecording = useCallback(async (preserveRecording = false): Promise<string | null> => {
        const recorder = audioRecordingRef.current;
        const liveSpeechSessionId = liveSpeechSessionIdRef.current;
        liveSpeechOperationRef.current += 1;
        audioRecordingRef.current = null;
        liveSpeechSessionIdRef.current = null;
        liveSpeechStartingRef.current = false;
        liveSpeechStopInFlightRef.current = null;
        clearVoiceTimer();
        setIsVoiceRecording(false);
        setIsVoiceFinalizing(false);
        setVoiceMeterHistory(createVoiceMeterHistory());
        setVoiceSpectrumEnergy(0);

        if (!preserveRecording) {
            setVoiceUri(null);
            setVoiceDurationMillis(0);
            setVoiceTranscript("");
            setVoiceTranscriptTruncated(false);
            setVoiceRecognitionConfidence(undefined);
            setVoiceStatusMessage("");
        }

        if (liveSpeechSessionId) {
            await cancelLiveSpeechRecognition(liveSpeechSessionId).catch(() => undefined);
        }

        if (!recorder) {
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
            }).catch(() => undefined);
            return null;
        }

        try {
            // stopAndUnloadAsync가 끝나기 전에 getURI를 읽거나 분석 버튼을 활성화하면,
            // Speech가 아직 닫히지 않은 m4a를 읽어 decode 실패가 날 수 있다.
            if (!preserveRecording) {
                await recorder.stopAndUnloadAsync();
                return null;
            }

            const recordedUri = await finalizeQuickScheduleRecording(recorder);
            setVoiceUri(recordedUri);
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
    }, [clearVoiceTimer]);

    const invalidatePendingAnalysis = useCallback(() => {
        analysisSequenceRef.current += 1;
        analysisInFlightRef.current = false;
        if (analysisPreviewTimerRef.current) {
            clearTimeout(analysisPreviewTimerRef.current);
            analysisPreviewTimerRef.current = null;
        }
    }, []);

    const finishClose = useCallback((shouldNotifyClose: boolean) => {
        if (closeFinishedRef.current) return;
        closeFinishedRef.current = true;
        if (closeFinishTimerRef.current) {
            clearTimeout(closeFinishTimerRef.current);
            closeFinishTimerRef.current = null;
        }
        setRendered(prewarm);
        setText("");
        setInputMode("text");
        documentScanOperationRef.current += 1;
        discardOwnedDocumentScans();
        setSelectedPhoto(null);
        setPhotoTranscript("");
        setPhotoTranscriptTruncated(false);
        setPhotoRecognitionConfidence(undefined);
        setPhotoRecognitionError("");
        setPhotoRecognitionAttempt(0);
        setIsPhotoRecognizing(false);
        setIsDocumentScanning(false);
        setVoiceUri(null);
        setVoiceDurationMillis(0);
        setVoiceTranscript("");
        setVoiceTranscriptTruncated(false);
        setVoiceRecognitionConfidence(undefined);
        setVoiceStatusMessage("");
        setIsVoiceRecording(false);
        setIsVoiceFinalizing(false);
        setVoiceMeterHistory(createVoiceMeterHistory());
        setVoiceSpectrumEnergy(0);
        setSubmitting(false);
        setCardRasterized(false);
        setContentMounted(prewarm);
        setFlowStep("input");
        setAnalysisError("");
        setPreviewDraft(null);
        setEditingField(null);
        setEditingValue("");
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
    }, [discardOwnedDocumentScans, invalidatePendingAnalysis, onClose, presentationOpacity, prewarm]);

    const runCloseAnimation = useCallback((shouldNotifyClose = false) => {
        Keyboard.dismiss();
        if (
            audioRecordingRef.current ||
            isVoiceRecording ||
            isVoiceFinalizing ||
            voiceUri
        ) {
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
                (finished) => {
                    if (finished) {
                        runOnJS(finishClose)(shouldNotifyClose);
                    }
                }
            )
        );
        closeFinishTimerRef.current = setTimeout(() => {
            finishClose(shouldNotifyClose);
        }, CLOSE_SURFACE_DELAY_MS + closeDuration + 48);
    }, [
        closingPhase,
        finishClose,
        isVoiceFinalizing,
        isVoiceRecording,
        progress,
        stopActiveRecording,
        voiceUri,
    ]);

    const requestClose = useCallback(() => {
        if ((submitting && flowStep !== "analyzing") || closingRef.current) return;

        if (flowStep === "analyzing") {
            invalidatePendingAnalysis();
            setSubmitting(false);
        }

        closingRef.current = true;
        onCloseStart?.();
        runCloseAnimation(true);
    }, [flowStep, invalidatePendingAnalysis, onCloseStart, runCloseAnimation, submitting]);

    const startOpenAnimation = useCallback((openCycle: number) => {
        if (
            !visibleRef.current ||
            openCycle !== openCycleRef.current ||
            openStartedRef.current ||
            closingRef.current
        ) return;

        openStartedRef.current = true;
        // Let the card leave the menu on the same compositor clock as the
        // ownership crossfade. Holding geometry until the native renderer was
        // gone produced two visibly blank white frames after row selection.
        presentationOpacity.value = withTiming(1, {
            duration: ADD_HANDOFF_MOTION.ownershipCrossfadeMs,
            easing: ReanimatedEasing.linear,
        });
        progress.value = withTiming(
            1,
            {
                duration: Math.round(OPEN_DURATION_MS * (1 - OPEN_START_PROGRESS)),
                easing: OPEN_EASING,
            }
        );
        // Queue both UI-thread animations before asking the native host to
        // retire, so the source can never disappear one compositor tick early.
        onMorphReady?.();
    }, [onMorphReady, presentationOpacity, progress]);

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

    const scheduleOpenAfterPaint = useCallback((openCycle: number) => {
        if (
            !visibleRef.current ||
            openStartedRef.current ||
            closingRef.current ||
            openHandoffFrameRef.current !== null
        ) return;

        const paintFrame = requestAnimationFrame(() => {
            if (openHandoffFrameRef.current !== paintFrame) return;
            openHandoffFrameRef.current = null;
            startOpenAnimation(openCycle);
        });
        openHandoffFrameRef.current = paintFrame;
    }, [startOpenAnimation]);

    const handleSeedLayout = useCallback((event: LayoutChangeEvent) => {
        const { width: layoutWidth, height: layoutHeight } = event.nativeEvent.layout;
        if (layoutWidth <= 0 || layoutHeight <= 0) return;

        seedHasLayoutRef.current = true;
        if (
            !visibleRef.current ||
            openStartedRef.current ||
            closingRef.current ||
            openHandoffFrameRef.current !== null
        ) return;

        const openCycle = openCycleRef.current;

        scheduleOpenAfterPaint(openCycle);
    }, [scheduleOpenAfterPaint]);

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
        presentationOpacity.value = prewarm
            ? PREWARM_PRESENTATION_OPACITY
            : 1;
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

    const startAnalysis = useCallback(async (
        textOverride?: string,
        inputTypeOverride?: QuickScheduleMediaInput["inputTypeOverride"],
    ) => {
        const normalized = (textOverride ?? text).trim();
        const analysisInputMode: InputMode = inputTypeOverride ? "text" : inputMode;
        const hasCurrentInput = analysisInputMode === "text"
            ? normalized.length > 0
            : analysisInputMode === "photo"
                ? Boolean(selectedPhoto?.uri && photoTranscript.trim())
                : Boolean(voiceTranscript.trim() || voiceUri);
        if (
            !hasCurrentInput ||
            submitting ||
            analysisInFlightRef.current ||
            isVoiceRecording ||
            isPhotoRecognizing ||
            isDocumentScanning
        ) return;

        const fallbackText = analysisInputMode === "photo"
            ? "사진으로 입력한 일정"
            : analysisInputMode === "voice"
                ? "음성으로 입력한 일정"
                : "";
        const rawSourceText = analysisInputMode === "voice"
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
                photoTranscript: analysisInputMode === "photo"
                    ? sourceText || undefined
                    : undefined,
                voiceUri: analysisInputMode === "voice" ? voiceUri ?? undefined : undefined,
                voiceDurationMillis: analysisInputMode === "voice" ? voiceDurationMillis : undefined,
                voiceTranscript: analysisInputMode === "voice"
                    ? sourceText || undefined
                    : undefined,
                recognitionConfidence: analysisInputMode === "voice"
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
                setFlowStep("preview");
                setSubmitting(false);
                analysisInFlightRef.current = false;
            }, 220);
        } catch (error) {
            if (analysisSequenceRef.current !== analysisSequence || !visibleRef.current) return;
            setAnalysisError(error instanceof Error ? error.message : "일정 정보를 분석하지 못했어요");
            setFlowStep("analysisError");
            setSubmitting(false);
            analysisInFlightRef.current = false;
        }
    }, [
        defaultDay,
        inputMode,
        isDocumentScanning,
        isPhotoRecognizing,
        isVoiceRecording,
        onAnalyze,
        photoRecognitionConfidence,
        photoTranscript,
        selectedPhoto?.uri,
        submitting,
        text,
        voiceDurationMillis,
        voiceRecognitionConfidence,
        voiceTranscript,
        voiceUri,
    ]);

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
        discardOwnedDocumentScans();
        setSelectedPhoto(null);
        setPhotoTranscript("");
        setPhotoTranscriptTruncated(false);
        setPhotoRecognitionConfidence(undefined);
        setPhotoRecognitionError("");
        setVoiceUri(null);
        setVoiceTranscript("");
        setVoiceTranscriptTruncated(false);
        setVoiceRecognitionConfidence(undefined);
        setVoiceStatusMessage("");
        setAnalysisError("");
        setFlowStep("input");
        void startAnalysis(boundedSeedText, initialInputType);
    }, [discardOwnedDocumentScans, initialInputType, initialRequestId, initialText, startAnalysis, visible]);

    const updatePreviewField = useCallback((field: PreviewField, value: string) => {
        setPreviewDraft((current) => current
            ? updateQuickSchedulePreviewDraft(current, field, value)
            : current);
    }, []);

    const openEditField = useCallback((field: PreviewField) => {
        if (!previewDraft || submitting) return;

        setEditingField(field);
        setEditingValue(
            field === "notification"
                ? String(previewDraft.notificationLeadMinutes ?? "none")
                : String(previewDraft[field] ?? "")
        );
        setTimeEditMode("picker");
        setFlowStep("edit");
    }, [previewDraft, submitting]);

    const confirmEditField = useCallback(() => {
        if (!editingField) return;

        const nextValue = editingField === "time"
            ? normalizeTimeInput(editingValue, previewDraft?.time ?? "09:00")
            : editingValue.trim() || (editingField === "notification"
                ? "none"
                : editingField === "location"
                    ? "장소 미정"
                    : editingField === "title"
                        ? "새 일정"
                        : editingField === "memo" ? "메모 없음" : "");
        updatePreviewField(editingField, nextValue);
        setEditingField(null);
        setEditingValue("");
        setTimeEditMode("picker");
        setFlowStep("preview");
    }, [editingField, editingValue, previewDraft?.time, updatePreviewField]);

    const cancelEditField = useCallback(() => {
        setEditingField(null);
        setEditingValue("");
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
    }, [
        cancelEditField,
        flowStep,
        invalidatePendingAnalysis,
        rendered,
        requestClose,
        routePlannerHidden,
        visible,
    ]);

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
            router.push({ pathname: "/schedule/route-select", params: { sessionId } });
        } catch {
            setRoutePlannerSessionId(undefined);
            setRoutePlannerHidden(false);
            setRendered(true);
            setContentMounted(true);
            progress.value = 1;
            const returnField = routePlannerReturnFieldRef.current;
            setEditingField(returnField);
            setEditingValue(returnField === "notification"
                ? String(previewDraft.notificationLeadMinutes ?? "none")
                : returnField ? String(previewDraft[returnField] ?? "") : "");
            setFlowStep(returnField ? "edit" : "preview");
            routePlannerReturnFieldRef.current = null;
        }
    }, [editingField, previewDraft, progress, router, submitting]);

    useEffect(() => {
        if (
            !visible ||
            !routePlannerSessionId
        ) return;

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
            setEditingValue(returnField === "notification"
                ? String(previewDraft.notificationLeadMinutes ?? "none")
                : String(previewDraft[returnField] ?? ""));
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
                    : "카테고리를 만든 뒤 일정을 저장해 주세요."
            );
            return;
        }

        const blockingReviewField = getQuickScheduleBlockingReviewField(previewDraft);
        if (blockingReviewField) {
            openEditField(blockingReviewField);
            return;
        }

        try {
            saveInFlightRef.current = true;
            setSubmitting(true);
            setFlowStep("saving");
            await onSave(buildQuickSchedulePayload(previewDraft, defaultCategory));
            setFlowStep("saved");
        } catch (error) {
            Alert.alert("일정 저장 실패", error instanceof Error ? error.message : "일정을 저장하지 못했습니다.");
            setFlowStep("preview");
        } finally {
            saveInFlightRef.current = false;
            setSubmitting(false);
        }
    };

    const selectPhotoForRecognition = useCallback((
        asset: ImagePickerAsset | null,
        ownedScanUris: string[] = [],
    ) => {
        discardOwnedDocumentScans();
        ownedDocumentScanUrisRef.current = ownedScanUris;
        setSelectedPhoto(asset);
        setPhotoRecognitionAttempt((current) => current + 1);
    }, [discardOwnedDocumentScans]);

    const pickPhotoFromLibrary = useCallback(async () => {
        if (submitting || isDocumentScanning) return;

        Keyboard.dismiss();
        void stopActiveRecording();
        setInputMode("photo");

        try {
            const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) {
                Alert.alert("사진 권한 필요", "사진으로 빠른 일정을 만들려면 사진 보관함 권한이 필요합니다.");
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images"],
                allowsMultipleSelection: false,
                // 얇은 연필선과 작은 손글씨가 JPEG 재압축에서 뭉개지지 않도록 OCR 입력은
                // 원본 품질과 현재 에셋 표현(HEIC/JPEG 등)을 우선 사용한다.
                quality: 1,
                preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
            });

            if (!result.canceled) {
                selectPhotoForRecognition(result.assets[0] ?? null);
            }
        } catch (error) {
            Alert.alert("사진 선택 실패", error instanceof Error ? error.message : "사진을 불러오지 못했습니다.");
        }
    }, [isDocumentScanning, selectPhotoForRecognition, stopActiveRecording, submitting]);

    const capturePhoto = useCallback(async () => {
        if (submitting || isDocumentScanning) return;

        Keyboard.dismiss();
        void stopActiveRecording();
        setInputMode("photo");

        try {
            const permission = await ImagePicker.requestCameraPermissionsAsync();
            if (!permission.granted) {
                Alert.alert("카메라 권한 필요", "사진을 촬영해 빠른 일정을 만들려면 카메라 권한이 필요합니다.");
                return;
            }

            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ["images"],
                allowsEditing: false,
                // 촬영 직후 압축으로 획이 사라지는 것을 피한다. 네이티브 OCR에서 해상도 상한을
                // 적용하므로 여기서는 인식에 필요한 원본 픽셀을 보존한다.
                quality: 1,
            });

            if (!result.canceled) {
                selectPhotoForRecognition(result.assets[0] ?? null);
            }
        } catch (error) {
            Alert.alert("촬영 실패", error instanceof Error ? error.message : "카메라를 열지 못했습니다.");
        }
    }, [isDocumentScanning, selectPhotoForRecognition, stopActiveRecording, submitting]);

    const scanDocument = useCallback(async () => {
        if (submitting || isDocumentScanning) return;

        const operation = documentScanOperationRef.current + 1;
        documentScanOperationRef.current = operation;
        Keyboard.dismiss();
        void stopActiveRecording();
        setInputMode("photo");
        setIsDocumentScanning(true);
        try {
            const result = await scanDocuments({ maxPages: 1, jpegQuality: 0.94 });
            const ownedScanUris = result?.pages.map(({ uri }) => uri) ?? [];
            const operationIsCurrent = (
                documentScanOperationRef.current === operation
                && mountedRef.current
                && visibleRef.current
                && !closingRef.current
            );
            if (!operationIsCurrent) {
                await discardDocumentScanPages(ownedScanUris).catch(() => undefined);
                return;
            }

            const page = result?.pages[0];
            if (!page) {
                await discardDocumentScanPages(ownedScanUris).catch(() => undefined);
                return;
            }

            if (result.capturedPageCount > 1) {
                Alert.alert("첫 페이지만 사용해요", "빠른 일정에는 스캔한 첫 페이지가 사용됩니다.");
            }

            selectPhotoForRecognition({
                uri: page.uri,
                width: page.width,
                height: page.height,
                fileName: "문서 스캔.jpg",
                mimeType: "image/jpeg",
            }, ownedScanUris);
        } catch (error) {
            if (
                documentScanOperationRef.current !== operation
                || !mountedRef.current
                || !visibleRef.current
                || closingRef.current
            ) return;
            Alert.alert(
                "문서 스캔 실패",
                error instanceof Error ? error.message : "문서를 스캔하지 못했습니다."
            );
        } finally {
            if (documentScanOperationRef.current === operation && mountedRef.current) {
                setIsDocumentScanning(false);
            }
        }
    }, [isDocumentScanning, selectPhotoForRecognition, stopActiveRecording, submitting]);

    const activatePhotoMode = useCallback(() => {
        if (submitting) return;

        Keyboard.dismiss();
        void stopActiveRecording();
        setInputMode("photo");
    }, [stopActiveRecording, submitting]);

    const openPhotoActionSheet = useCallback(() => {
        if (submitting || isDocumentScanning) return;

        Keyboard.dismiss();
        void stopActiveRecording();
        setInputMode("photo");

        if (Platform.OS === "ios") {
            const options = documentScannerSupported
                ? ["문서 스캔", "사진 찍기", "사진 앱에서 선택", "취소"]
                : ["사진 찍기", "사진 앱에서 선택", "취소"];
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    title: "사진으로 일정 만들기",
                    options,
                    cancelButtonIndex: options.length - 1,
                    userInterfaceStyle: mode === "dark" ? "dark" : "light",
                },
                (buttonIndex) => {
                    if (documentScannerSupported && buttonIndex === 0) {
                        runAfterInteraction(() => void scanDocument());
                        return;
                    }
                    const sourceIndex = documentScannerSupported ? buttonIndex - 1 : buttonIndex;
                    if (sourceIndex === 0) {
                        runAfterInteraction(() => void capturePhoto());
                    }
                    if (sourceIndex === 1) {
                        runAfterInteraction(() => void pickPhotoFromLibrary());
                    }
                }
            );
            return;
        }

        void pickPhotoFromLibrary();
    }, [
        capturePhoto,
        documentScannerSupported,
        isDocumentScanning,
        mode,
        pickPhotoFromLibrary,
        scanDocument,
        stopActiveRecording,
        submitting,
    ]);

    const startVoiceRecording = useCallback(async () => {
        if (
            submitting ||
            isVoiceRecording ||
            isVoiceFinalizing ||
            audioRecordingRef.current ||
            liveSpeechSessionIdRef.current ||
            liveSpeechStartingRef.current ||
            liveSpeechStopInFlightRef.current
        ) return;

        Keyboard.dismiss();
        setInputMode("voice");
        discardOwnedDocumentScans();
        setSelectedPhoto(null);
        setVoiceUri(null);
        setVoiceDurationMillis(0);
        setVoiceTranscript("");
        setVoiceTranscriptTruncated(false);
        setVoiceRecognitionConfidence(undefined);
        setVoiceStatusMessage("");
        setVoiceMeterHistory(createVoiceMeterHistory());
        setVoiceSpectrumEnergy(0);
        clearVoiceTimer();

        if (isLiveSpeechRecognitionAvailable) {
            const operation = liveSpeechOperationRef.current + 1;
            liveSpeechOperationRef.current = operation;
            const requestedSessionId = createLiveSpeechSessionId();
            liveSpeechSessionIdRef.current = requestedSessionId;
            liveSpeechStartingRef.current = true;
            setIsVoiceFinalizing(true);
            setVoiceStatusMessage("마이크와 음성 인식 권한을 확인하고 있어요.");

            try {
                const sessionId = await startLiveSpeechRecognition({
                    sessionId: requestedSessionId,
                    localeIdentifier: "ko-KR",
                    contextualStrings: buildScheduleSpeechContext(text),
                    maxDurationMillis: 60_000,
                });
                if (
                    !liveSpeechStartingRef.current ||
                    liveSpeechOperationRef.current !== operation ||
                    liveSpeechSessionIdRef.current !== sessionId ||
                    !visibleRef.current ||
                    closingRef.current
                ) {
                    await cancelLiveSpeechRecognition(sessionId).catch(() => undefined);
                    return;
                }

                liveSpeechSessionIdRef.current = sessionId;
                liveSpeechStartingRef.current = false;
                setIsVoiceFinalizing(false);
                setIsVoiceRecording(true);
                setVoiceStatusMessage("");
            } catch (error) {
                const ownsOperation = liveSpeechOperationRef.current === operation;
                if (!ownsOperation) return;
                if (liveSpeechSessionIdRef.current === requestedSessionId) {
                    liveSpeechSessionIdRef.current = null;
                }
                liveSpeechStartingRef.current = false;
                if (!mountedRef.current || !visibleRef.current || closingRef.current) return;
                setIsVoiceRecording(false);
                setIsVoiceFinalizing(false);
                setVoiceMeterHistory(createVoiceMeterHistory());
                setVoiceSpectrumEnergy(0);
                const message = error instanceof Error
                    ? error.message
                    : "실시간 음성 인식을 시작하지 못했습니다.";
                setVoiceStatusMessage(message);
                Alert.alert("음성 인식 시작 실패", message);
            }
            return;
        }

        try {
            const permission = await Audio.requestPermissionsAsync();
            if (!permission.granted) {
                Alert.alert("마이크 권한 필요", "음성으로 빠른 일정을 만들려면 마이크 권한이 필요합니다.");
                return;
            }

            await waitForAudioForegroundReady();
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
            });

            const prepareAndStartRecording = async () => {
                const recorder = new Audio.Recording();
                await recorder.prepareToRecordAsync({
                    ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
                    isMeteringEnabled: true,
                });
                await recorder.startAsync();
                return recorder;
            };

            let recorder: Audio.Recording;
            try {
                recorder = await prepareAndStartRecording();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (!message.includes("background")) {
                    throw error;
                }

                await waitForAudioForegroundReady();
                recorder = await prepareAndStartRecording();
            }

            audioRecordingRef.current = recorder;
            setIsVoiceRecording(true);
            voiceTimerRef.current = setInterval(() => {
                const activeRecorder = audioRecordingRef.current;
                if (!activeRecorder) return;

                void activeRecorder.getStatusAsync()
                    .then((status) => {
                        if ("durationMillis" in status) {
                            setVoiceDurationMillis(status.durationMillis ?? 0);
                        }
                        const normalizedMetering = normalizeVoiceMetering(status.metering);
                        if (normalizedMetering !== null) {
                            setVoiceMeterHistory((current) => (
                                appendVoiceMeterHistory(current, normalizedMetering)
                            ));
                            setVoiceSpectrumEnergy(normalizedMetering);
                        }
                    })
                    .catch(() => undefined);
            }, 110);
        } catch (error) {
            audioRecordingRef.current = null;
            clearVoiceTimer();
            setIsVoiceRecording(false);
            setVoiceMeterHistory(createVoiceMeterHistory());
            setVoiceSpectrumEnergy(0);
            void Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
            }).catch(() => undefined);
            console.warn("[QuickSchedule] Voice recording failed to start.", error);
            Alert.alert("녹음 시작 실패", "음성 녹음을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
    }, [clearVoiceTimer, discardOwnedDocumentScans, isVoiceFinalizing, isVoiceRecording, submitting, text]);

    const stopVoiceRecording = useCallback(async () => {
        if (isVoiceFinalizing || liveSpeechStopInFlightRef.current) return;

        const liveSpeechSessionId = liveSpeechSessionIdRef.current;
        if (liveSpeechSessionId) {
            const operation = liveSpeechOperationRef.current;
            const stopOperation = { operation, sessionId: liveSpeechSessionId };
            liveSpeechStopInFlightRef.current = stopOperation;
            setIsVoiceRecording(false);
            setIsVoiceFinalizing(true);
            setVoiceStatusMessage("마지막 문장을 정리하고 있어요.");
            setVoiceSpectrumEnergy(0);
            try {
                const result = await stopLiveSpeechRecognition(liveSpeechSessionId);
                if (
                    liveSpeechStopInFlightRef.current !== stopOperation ||
                    liveSpeechOperationRef.current !== operation ||
                    !mountedRef.current ||
                    !visibleRef.current ||
                    closingRef.current
                ) return;
                const limited = limitRecognizedText(result.text);
                setVoiceTranscript(limited.text);
                setVoiceTranscriptTruncated(limited.truncated);
                if (result.confidence !== undefined) {
                    setVoiceRecognitionConfidence(result.confidence);
                }
                if (result.elapsedMillis !== undefined) {
                    setVoiceDurationMillis(result.elapsedMillis);
                }
                setVoiceStatusMessage("");
            } catch (error) {
                if (
                    liveSpeechStopInFlightRef.current !== stopOperation ||
                    liveSpeechOperationRef.current !== operation ||
                    !mountedRef.current ||
                    !visibleRef.current ||
                    closingRef.current
                ) return;
                const message = error instanceof Error
                    ? error.message
                    : "음성 인식 결과를 마무리하지 못했습니다.";
                setVoiceStatusMessage(message);
                Alert.alert("음성 인식 실패", message);
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
                setVoiceSpectrumEnergy(0);
            }
            return;
        }

        if (!audioRecordingRef.current) return;

        setIsVoiceFinalizing(true);
        try {
            await stopActiveRecording(true);
        } catch (error) {
            setVoiceUri(null);
            Alert.alert(
                "녹음 저장 실패",
                error instanceof Error ? error.message : "녹음 파일을 저장하지 못했습니다. 다시 녹음해 주세요."
            );
        } finally {
            setIsVoiceFinalizing(false);
        }
    }, [isVoiceFinalizing, stopActiveRecording]);

    const handleModePress = useCallback((nextMode: InputMode) => {
        if (nextMode === "photo") {
            activatePhotoMode();
            return;
        }

        if (nextMode === "voice") {
            if (inputMode !== "voice") {
                void stopActiveRecording();
            }
            setInputMode("voice");
            return;
        }

        void stopActiveRecording();
        setInputMode(nextMode);
    }, [
        activatePhotoMode,
        inputMode,
        stopActiveRecording,
    ]);

    useEffect(() => {
        return () => {
            invalidatePendingAnalysis();
            void stopActiveRecording();
            if (closeFinishTimerRef.current) {
                clearTimeout(closeFinishTimerRef.current);
                closeFinishTimerRef.current = null;
            }
        };
    }, [invalidatePendingAnalysis, stopActiveRecording]);

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
        const activeSourceRadius = closingPhase.value >= 0.5
            ? closeSourceRadius
            : openSourceRadius;
        const activeSourceHeight = closing ? closeSourceHeight : openSourceHeight;
        const scaleY = lerpAddHandoffValue(
            activeSourceHeight / finalHeight,
            1,
            motionProgress
        );
        const visualRadius = lerpAddHandoffValue(
            activeSourceRadius,
            EXPANDED_CARD_RADIUS,
            motionProgress
        );
        return {
            borderRadius: visualRadius / Math.max(scaleY, 0.01),
        };
    }, [
        closeSourceHeight,
        closeSourceRadius,
        expandedCardHeight,
        openSourceHeight,
        openSourceRadius,
    ]);

    const cardClipRadiusStyle = useAnimatedStyle(() => {
        const motionProgress = progress.value;
        const finalHeight = expandedCardHeight.value;
        const closing = closingPhase.value >= 0.5;
        const activeSourceRadius = closingPhase.value >= 0.5
            ? closeSourceRadius
            : openSourceRadius;
        const activeSourceHeight = closing ? closeSourceHeight : openSourceHeight;
        const scaleY = lerpAddHandoffValue(
            activeSourceHeight / finalHeight,
            1,
            motionProgress
        );
        const visualRadius = lerpAddHandoffValue(
            activeSourceRadius,
            EXPANDED_CARD_RADIUS,
            motionProgress
        );
        return {
            borderRadius: visualRadius / Math.max(scaleY, 0.01),
        };
    }, [
        closeSourceHeight,
        closeSourceRadius,
        expandedCardHeight,
        openSourceHeight,
        openSourceRadius,
    ]);

    const cardMotionStyle = useAnimatedStyle(() => {
        const finalHeight = expandedCardHeight.value;
        const motionProgress = progress.value;
        const closing = closingPhase.value >= 0.5;
        const activeSourceLeft = closing ? closeSourceLeft : openSourceLeft;
        const activeSourceWidth = closing ? closeSourceWidth : openSourceWidth;
        const activeSourceHeight = closing ? closeSourceHeight : openSourceHeight;
        const scaleX = lerpAddHandoffValue(
            activeSourceWidth / cardWidth,
            1,
            motionProgress
        );
        const scaleY = lerpAddHandoffValue(
            activeSourceHeight / finalHeight,
            1,
            motionProgress
        );

        return {
            left: cardLeft,
            top: cardTop,
            width: cardWidth,
            height: finalHeight,
            transform: [
                {
                    translateX: lerpAddHandoffValue(
                        activeSourceLeft - cardLeft,
                        0,
                        motionProgress
                    ),
                },
                {
                    translateY: lerpAddHandoffValue(
                        sourceTop - cardTop,
                        0,
                        motionProgress
                    ),
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
            Extrapolation.CLAMP
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
                Extrapolation.CLAMP
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
                Extrapolation.CLAMP
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
    const cardBorderColor = mode === "dark"
        ? "rgba(255,255,255,0.17)"
        : "rgba(255,255,255,0.86)";
    // Keep the scaled layer lightweight. A live native blur is re-rasterized
    // while the card grows and was producing visible 26-35ms frame gaps.
    const cardSurfaceBackground = mode === "dark" ? "#0E0F12" : "#FFFFFF";
    const segmentedBackground = mode === "dark"
        ? "rgba(255,255,255,0.10)"
        : "rgba(255,255,255,0.56)";
    const selectedModeBackground = mode === "dark"
        ? "rgba(36,107,254,0.20)"
        : "rgba(36,107,254,0.10)";
    const inputBackground = mode === "dark"
        ? "rgba(9,11,16,0.54)"
        : "rgba(255,255,255,0.62)";
    const mediaPanelBackground = mode === "dark"
        ? "rgba(10,12,17,0.50)"
        : "rgba(255,255,255,0.58)";
    const voiceOrbBackground = mode === "dark"
        ? "rgba(36,107,254,0.20)"
        : "rgba(36,107,254,0.11)";
    const voiceDurationText = formatVoiceDuration(
        recorderState.isRecording ? recorderState.durationMillis : voiceDurationMillis
    );
    const photoLabel = selectedPhoto?.fileName ?? selectedPhoto?.uri.split("/").pop();
    const canSubmit = (
        inputMode === "text"
            ? text.trim().length > 0
            : inputMode === "photo"
                ? Boolean(selectedPhoto?.uri && photoTranscript.trim())
                : Boolean(voiceTranscript.trim() || voiceUri)
    ) && !submitting
        && !recorderState.isRecording
        && !isVoiceFinalizing
        && !isPhotoRecognizing
        && !isDocumentScanning;
    const flowTitle = flowStep === "input"
        ? "빠른 일정 생성"
        : flowStep === "analyzing"
            ? "일정 미리보기"
            : flowStep === "saving"
                ? "일정 저장 중"
                : flowStep === "analysisError"
                    ? "분석 실패"
                    : flowStep === "saved"
                        ? "일정 저장 완료"
                        : flowStep === "edit" && editingField
                            ? editingField === "location"
                                ? "장소 수정"
                                : editingField === "notification"
                                    ? "출발 알림"
                                    : `${FIELD_LABEL[editingField]} 수정`
                            : "일정 미리보기";
    const warningBackground = mode === "dark" ? "rgba(255,176,32,0.18)" : "rgba(255,176,32,0.16)";
    const warningTextColor = mode === "dark" ? "#FFD27A" : "#A45B00";
    const successColor = "#22C55E";
    const previewRowBackground = mode === "dark" ? "rgba(18,19,24,0.92)" : "rgba(255,255,255,0.92)";
    const previewIconColor = mode === "dark" ? "#D7D7DC" : "#5F636C";

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
                if (!canUseRouteNotification(draft)) return "사용 안 함 · 나중에 설정 가능";
                return formatNotification(draft.notificationLeadMinutes);
            case "location":
                return draft.location;
            case "memo":
                return draft.memo;
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
            >
                <View style={styles.modeIndicatorUnderline} />
            </Reanimated.View>
            {(Platform.OS === "ios" ? INPUT_MODES : INPUT_MODES.filter((item) => item.key === "text")).map((item) => {
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
                            item.label.length > 2
                                ? styles.modeButtonWide
                                : styles.modeButtonCompact,
                            selected && styles.modeButtonSelected,
                            { opacity: pressed ? 0.7 : submitting ? 0.48 : 1 },
                        ]}
                    >
	                        <Ionicons
	                            accessible={false}
	                            name={item.icon}
	                            size={21}
	                            color={selected ? BLUE : colors.textSecondary}
	                        />
                        <Text
                            style={[
                                styles.modeText,
                                { color: selected ? BLUE : colors.textPrimary },
                            ]}
                        >
	                            {item.label}
	                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );

    const renderInputStep = () => (
        <>
            {renderModeSelector()}

            {inputMode === "text" && (
                <View
                    style={[
                        styles.inputWrap,
                        {
                            backgroundColor: inputBackground,
                            borderColor: text.length > 0
                                ? BLUE
                                : colors.inputBorder,
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
            )}

            {inputMode === "photo" && (
                <View style={styles.photoModeContent}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={selectedPhoto ? "선택한 사진 변경" : "사진 선택"}
                        accessibilityState={{
                            disabled: submitting || isVoiceFinalizing || isDocumentScanning,
                        }}
                        disabled={submitting || isVoiceFinalizing || isDocumentScanning}
                        onPress={openPhotoActionSheet}
                        style={[
                            styles.mediaPanel,
                            styles.photoPreviewPanel,
                            {
                                backgroundColor: mediaPanelBackground,
                                borderColor: selectedPhoto ? BLUE : cardBorderColor,
                            },
                        ]}
                    >
                        {selectedPhoto?.uri ? (
                            <Image source={{ uri: selectedPhoto.uri }} style={styles.photoThumbnail} />
                        ) : (
                            <View
                                style={[
                                    styles.photoIconWrap,
                                    {
                                        backgroundColor: selectedModeBackground,
                                    },
                                ]}
                            >
                                <Ionicons accessible={false} name="scan-outline" size={34} color={BLUE} />
                            </View>
                        )}
                        <Text style={[styles.mediaPanelTitle, { color: colors.textPrimary }]}>
                            {isDocumentScanning
                                ? "문서 스캐너 여는 중"
                                : selectedPhoto
                                    ? "사진 선택됨"
                                    : "문서나 일정 사진 추가"}
                        </Text>
                        {photoLabel && (
                            <Text
                                numberOfLines={1}
                                style={[styles.mediaPanelMeta, { color: colors.textSecondary }]}
                            >
                                {photoLabel}
                            </Text>
                        )}
                        {selectedPhoto && (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="선택한 사진 제거"
                                onPress={(event) => {
                                    event.stopPropagation();
                                    selectPhotoForRecognition(null);
                                }}
                                style={({ pressed }) => [
                                    styles.photoRemoveButton,
                                    { opacity: pressed ? 0.72 : 1 },
                                ]}
                            >
                                <Ionicons accessible={false} name="close" size={16} color="#fff" />
                            </Pressable>
                        )}
                    </Pressable>

                    <View style={styles.photoActions}>
                        {documentScannerSupported ? (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="문서 스캔으로 사진 입력"
                                disabled={submitting || isDocumentScanning}
                                onPress={() => void scanDocument()}
                                style={({ pressed }) => [
                                    styles.photoSourceButton,
                                    {
                                        backgroundColor: selectedModeBackground,
                                        borderColor: BLUE,
                                        opacity: pressed ? 0.72 : 1,
                                    },
                                ]}
                            >
                                <Ionicons accessible={false} name="scan-outline" size={17} color={BLUE} />
                                <Text style={[styles.photoSourceButtonText, { color: BLUE }]}>문서 스캔</Text>
                            </Pressable>
                        ) : (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="카메라로 일정 사진 촬영"
                                disabled={submitting || isDocumentScanning}
                                onPress={() => void capturePhoto()}
                                style={({ pressed }) => [
                                    styles.photoSourceButton,
                                    {
                                        backgroundColor: mediaPanelBackground,
                                        borderColor: cardBorderColor,
                                        opacity: pressed ? 0.72 : 1,
                                    },
                                ]}
                            >
                                <Ionicons accessible={false} name="camera-outline" size={17} color={BLUE} />
                                <Text style={[styles.photoSourceButtonText, { color: colors.textPrimary }]}>촬영</Text>
                            </Pressable>
                        )}
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="사진 앱에서 일정 사진 선택"
                            disabled={submitting || isDocumentScanning}
                            onPress={() => void pickPhotoFromLibrary()}
                            style={({ pressed }) => [
                                styles.photoSourceButton,
                                {
                                    backgroundColor: mediaPanelBackground,
                                    borderColor: cardBorderColor,
                                    opacity: pressed ? 0.72 : 1,
                                },
                            ]}
                        >
                            <Ionicons accessible={false} name="images-outline" size={17} color={BLUE} />
                            <Text style={[styles.photoSourceButtonText, { color: colors.textPrimary }]}>사진 앱</Text>
                        </Pressable>
                    </View>

                    <View
                        style={[
                            styles.photoTranscriptWrap,
                            {
                                backgroundColor: inputBackground,
                                borderColor: photoTranscript.trim() ? BLUE : colors.inputBorder,
                            },
                        ]}
                    >
                        <View style={styles.photoTranscriptHeader}>
                            <Text style={[styles.photoTranscriptLabel, { color: colors.textSecondary }]}>
                                인식된 문장
                            </Text>
                            {photoTranscriptTruncated ? (
                                <Text style={[styles.photoConfidence, styles.truncatedRecognitionText]}>
                                    앞 300자만 표시
                                </Text>
                            ) : photoRecognitionConfidence !== undefined && (
                                <Text style={[styles.photoConfidence, { color: colors.textSecondary }]}>
                                    인식 {Math.round(photoRecognitionConfidence * 100)}%
                                </Text>
                            )}
                        </View>

                        {isPhotoRecognizing ? (
                            <View
                                accessibilityLabel="사진에서 일정 문장 인식 중"
                                style={styles.photoRecognitionStatus}
                            >
                                <ActivityIndicator color={BLUE} size="small" />
                                <Text style={[styles.photoRecognitionStatusText, { color: colors.textSecondary }]}>
                                    사진을 선명하게 보정해 읽고 있어요
                                </Text>
                            </View>
                        ) : photoRecognitionError ? (
                            <View style={styles.photoRecognitionErrorWrap}>
                                <Text style={styles.photoRecognitionErrorText}>{photoRecognitionError}</Text>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="사진 텍스트 다시 인식"
                                    onPress={() => setPhotoRecognitionAttempt((current) => current + 1)}
                                    style={({ pressed }) => [
                                        styles.photoRecognitionRetry,
                                        { opacity: pressed ? 0.72 : 1 },
                                    ]}
                                >
                                    <Ionicons accessible={false} name="refresh" size={14} color={BLUE} />
                                    <Text style={styles.photoRecognitionRetryText}>다시 인식</Text>
                                </Pressable>
                            </View>
                        ) : (
                            <TextInput
                                accessibilityLabel="사진 OCR 인식 텍스트"
                                editable={Boolean(selectedPhoto) && !submitting && !isDocumentScanning}
                                multiline
                                maxLength={QUICK_TEXT_LIMIT}
                                value={photoTranscript}
                                onChangeText={(value) => {
                                    setPhotoTranscript(value);
                                    setPhotoTranscriptTruncated(false);
                                    setPhotoRecognitionConfidence(undefined);
                                    setPhotoRecognitionError("");
                                }}
                                placeholder={selectedPhoto
                                    ? "인식 후 문장을 직접 수정할 수 있어요."
                                    : "문서를 스캔하거나 일정 사진을 선택해 주세요."}
                                placeholderTextColor={colors.inputPlaceholder}
                                selectionColor={BLUE}
                                style={[styles.photoTranscriptInput, { color: colors.textPrimary }]}
                            />
                        )}

                        {!isPhotoRecognizing
                            && photoRecognitionConfidence !== undefined
                            && photoRecognitionConfidence < LOW_RECOGNITION_CONFIDENCE && (
                            <View style={styles.lowConfidenceNotice}>
                                <Ionicons accessible={false} name="alert-circle-outline" size={14} color="#F59E0B" />
                                <Text style={styles.lowConfidenceNoticeText}>
                                    인식이 불확실해요. 날짜·시간·장소를 확인해 주세요.
                                </Text>
                            </View>
                        )}
                    </View>
                </View>
            )}

            {inputMode === "voice" && (
                <View
                    style={[
                        styles.voicePanel,
                        {
                            backgroundColor: mediaPanelBackground,
                            borderColor: recorderState.isRecording || voiceTranscript.trim() || voiceUri
                                ? BLUE
                                : cardBorderColor,
                        },
                    ]}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={recorderState.isRecording
                            ? "실시간 음성 인식 중지"
                            : voiceTranscript.trim() || voiceUri
                                ? "음성 다시 인식"
                                : "실시간 음성 인식 시작"}
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
                            { opacity: pressed ? 0.78 : 1 },
                        ]}
                    >
                        <View style={styles.voiceOrbWrap}>
                            {recorderState.isRecording && (
                                <>
                                    <VoiceSpectrumHalo energy={voiceSpectrumEnergy} />
                                    <View pointerEvents="none" style={styles.voiceSpectrum}>
                                        {VOICE_SPECTRUM_BARS.map((barIndex) => {
                                            const angle = `${(360 / VOICE_SPECTRUM_BAR_COUNT) * barIndex}deg`;
                                            // 두 번째 반원의 인덱스를 뒤집어 첫 번째 반원과 마주 보게 한다.
                                            // 막대마다 미세한 높이 차이를 주어 기계적인 완전 대칭 대신
                                            // 실제 음성이 퍼지는 듯한 부드러운 외곽선을 만든다.
                                            const historyIndex = barIndex < VOICE_SPECTRUM_SAMPLE_COUNT
                                                ? barIndex
                                                : VOICE_SPECTRUM_BAR_COUNT - 1 - barIndex;
                                            const texture = 0.78 + ((Math.sin(barIndex * 1.73) + 1) / 2) * 0.22;
                                            const level = (voiceMeterHistory[historyIndex] ?? 0) * texture;
                                            const colorIndex = Math.min(
                                                VOICE_SPECTRUM_COLORS.length - 1,
                                                Math.floor(
                                                    historyIndex
                                                    / VOICE_SPECTRUM_SAMPLE_COUNT
                                                    * VOICE_SPECTRUM_COLORS.length
                                                )
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
                                </>
                            )}
                            <View
                                style={[
                                    styles.voiceOrb,
                                    {
                                        backgroundColor: voiceOrbBackground,
                                        borderColor: recorderState.isRecording || voiceTranscript.trim() || voiceUri
                                            ? BLUE
                                            : cardBorderColor,
                                    },
                                ]}
                            >
                                <Ionicons
                                    accessible={false}
                                    name={
                                        recorderState.isRecording
                                            ? "stop"
                                            : voiceTranscript.trim() || voiceUri
                                                ? "checkmark"
                                                : "mic-outline"
                                    }
                                    size={34}
                                    color={recorderState.isRecording || voiceTranscript.trim() || voiceUri
                                        ? BLUE
                                        : colors.textPrimary}
                                />
                            </View>
                        </View>
                        <Text style={[styles.voiceTitle, { color: colors.textPrimary }]}>
                            {recorderState.isRecording
                                ? "듣고 있어요"
                                : isVoiceFinalizing
                                    ? "음성을 정리하고 있어요"
                                    : voiceTranscript.trim()
                                        ? "인식 완료"
                                        : voiceUri
                                            ? "녹음 완료"
                                            : "탭해서 말하기 시작"}
                        </Text>
                        <Text style={[styles.voiceMeta, { color: colors.textSecondary }]}>
                            {voiceStatusMessage || (
                                recorderState.isRecording || isVoiceFinalizing || voiceTranscript.trim() || voiceUri
                                    ? voiceDurationText
                                    : "말하는 내용이 아래에 바로 표시됩니다."
                            )}
                        </Text>
                    </Pressable>

                    <View
                        style={[
                            styles.voiceTranscriptWrap,
                            {
                                backgroundColor: inputBackground,
                                borderColor: voiceTranscript.trim() ? BLUE : colors.inputBorder,
                            },
                        ]}
                    >
                        <View style={styles.voiceTranscriptHeader}>
                            <Text style={[styles.voiceTranscriptLabel, { color: colors.textSecondary }]}>
                                인식된 문장
                            </Text>
                            {voiceTranscriptTruncated ? (
                                <Text style={[styles.voiceConfidence, styles.truncatedRecognitionText]}>
                                    앞 300자만 표시
                                </Text>
                            ) : voiceRecognitionConfidence !== undefined && (
                                <Text style={[styles.voiceConfidence, { color: colors.textSecondary }]}>
                                    인식 {Math.round(voiceRecognitionConfidence * 100)}%
                                </Text>
                            )}
                        </View>
                        <TextInput
                            accessibilityLabel="실시간 음성 인식 텍스트"
                            editable={!submitting && !recorderState.isRecording && !isVoiceFinalizing}
                            multiline
                            maxLength={QUICK_TEXT_LIMIT}
                            value={voiceTranscript}
                            onChangeText={(value) => {
                                setVoiceTranscript(value);
                                setVoiceTranscriptTruncated(false);
                                setVoiceRecognitionConfidence(undefined);
                                setVoiceStatusMessage("");
                            }}
                            placeholder={recorderState.isRecording
                                ? "말씀해 주세요…"
                                : voiceUri
                                    ? "일정 만들기를 누르면 녹음을 인식합니다."
                                    : "인식 후 문장을 직접 수정할 수 있어요."}
                            placeholderTextColor={colors.inputPlaceholder}
                            selectionColor={BLUE}
                            style={[styles.voiceTranscriptInput, { color: colors.textPrimary }]}
                        />
                    </View>
                </View>
            )}

            <Pressable
                accessibilityRole="button"
                accessibilityLabel="빠른 일정 문장 분석"
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
                    <BrandedLoader
                        size="button"
                        variant="schedule"
                        accessibilityLabel="일정을 만들고 있어요"
                    />
                ) : (
                    <>
                        <Ionicons accessible={false} name="sparkles-outline" size={17} color="#fff" />
                        <Text style={styles.submitText}>일정 만들기</Text>
                    </>
                )}
            </Pressable>
        </>
    );

    const renderLoadingStep = () => {
        const isSaving = flowStep === "saving";
        const loadingHeadline = isSaving
            ? "일정을 저장하고 있어요"
            : "일정 초안을 만들고 있어요";
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
                <Text style={[styles.flowHeadline, { color: colors.textPrimary }]}>
                    {loadingHeadline}
                </Text>
                <Text style={[styles.flowCaption, { color: colors.textSecondary }]}>
                    {loadingCaption}
                </Text>
            </View>
        );
    };

    const renderErrorStep = () => (
        <View style={styles.centerFlow}>
            <View style={[styles.statusIconWrap, { backgroundColor: warningBackground }]}>
                <Ionicons accessible={false} name="warning-outline" size={42} color={warningTextColor} />
            </View>
            <Text style={[styles.flowHeadline, { color: colors.textPrimary }]}>
                일정 정보를 분석하지 못했어요
            </Text>
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
                    accessibilityLabel="빠른 일정 분석 다시 시도"
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

        return (
            <View style={styles.previewStep}>
                <ScrollView
                    style={styles.previewScroll}
                    contentContainerStyle={styles.previewScrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    {PREVIEW_FIELDS.map((field) => {
                        const badge = field.key === "notification" && !canUseRouteNotification(previewDraft)
                            ? "선택 설정"
                            : previewDraft.badges[field.key];
                        return (
                            <Pressable
                                key={field.key}
                                onPress={() => openEditField(field.key)}
                                disabled={submitting}
	                            accessibilityRole="button"
	                            accessibilityLabel={`${field.label} 수정`}
	                                style={[
	                                    styles.previewRow,
	                                    {
	                                        backgroundColor: previewRowBackground,
	                                        borderColor: cardBorderColor,
	                                    },
	                                ]}
	                            >
	                                <View style={styles.previewIcon}>
	                                    <Ionicons accessible={false} name={field.icon} size={17} color={previewIconColor} />
	                                </View>
                                <View style={styles.previewTextWrap}>
                                    <Text style={[styles.previewLabel, { color: colors.textSecondary }]}>
                                        {field.label}
                                    </Text>
                                    <View style={styles.previewValueRow}>
                                        <Text
                                            numberOfLines={field.key === "memo" ? 2 : 1}
                                            style={[styles.previewValue, { color: colors.textPrimary }]}
                                        >
                                            {getPreviewValue(previewDraft, field.key)}
                                        </Text>
                                        {badge && (
                                            <View style={[styles.warningBadge, { backgroundColor: warningBackground }]}>
                                                <Text style={[styles.warningBadgeText, { color: warningTextColor }]}>
                                                    {badge}
                                                </Text>
                                            </View>
                                        )}
                                    </View>
                                </View>
                                <Ionicons accessible={false} name="create-outline" size={17} color={colors.textSecondary} />
                            </Pressable>
                        );
                    })}
                </ScrollView>
                <View style={styles.previewButtons}>
	                    <Pressable
	                        onPress={() => setFlowStep("input")}
                            accessibilityRole="button"
                        disabled={submitting}
                        style={({ pressed }) => [
                            styles.secondaryButton,
                            {
                                backgroundColor: inputBackground,
                                borderColor: cardBorderColor,
                                opacity: pressed ? 0.72 : 1,
                            },
                        ]}
                    >
                        <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>원문 수정</Text>
                    </Pressable>
	                    <Pressable
	                        onPress={blockingReviewField
                                ? () => openEditField(blockingReviewField)
                                : savePreview}
                            accessibilityRole="button"
                        disabled={submitting}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            { opacity: pressed ? 0.78 : 1 },
                        ]}
                    >
                        <Text style={styles.primaryButtonText}>
                            {blockingReviewField
                                ? `${FIELD_LABEL[blockingReviewField]} 확인하기`
                                : "일정 저장하기"}
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
        const notificationRouteInfo = isNotificationEdit
            ? getQuickSchedulePreviewRouteInfo(previewDraft)
            : undefined;
        const pickerDateValue = editingField === "date"
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
                                borderColor: cardBorderColor,
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
                                    borderColor: cardBorderColor,
                                },
                            ]}
                        />
                        <View style={[styles.routeEditNotice, { backgroundColor: inputBackground, borderColor: cardBorderColor }]}>
                            <Ionicons accessible={false} name="location-outline" size={17} color={BLUE} />
                            <Text style={[styles.routeEditNoticeText, { color: colors.textSecondary }]}>
                                여기서는 목적지만 수정합니다. 이동 경로와 출발 알림은 알림 항목에서 별도로 설정할 수 있어요.
                            </Text>
                        </View>
                    </View>
                )}
                {editingField === "time" && (
                    <View style={[styles.editSegmented, { backgroundColor: mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.045)" }]}>
                        {(["picker", "manual"] as const).map((item) => {
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
                                    <Text style={[
                                        styles.editSegmentText,
                                        { color: selected ? BLUE : colors.textSecondary },
                                    ]}>
                                        {item === "picker" ? "시간 선택" : "직접 입력"}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                )}
                {(editingField === "date" || (editingField === "time" && timeEditMode === "picker")) && (
                    <View style={[styles.pickerPanel, { backgroundColor: inputBackground, borderColor: cardBorderColor }]}>
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
                                <Ionicons accessible={false} name="information-circle-outline" size={15} color={warningTextColor} />
                                <Text style={[styles.aiHintText, { color: warningTextColor }]}>
                                    AI가 추정한 시간: {formatKoreanTime(previewDraft.time)} 전후
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
                                borderColor: cardBorderColor,
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
                        <View style={[styles.notificationFeatureList, { backgroundColor: inputBackground, borderColor: cardBorderColor }]}>
                            <View style={styles.notificationFeatureRow}>
                                <Ionicons accessible={false} name="pulse-outline" size={17} color={BLUE} />
                                <Text style={[styles.notificationFeatureText, { color: colors.textPrimary }]}>
                                    교통 변화에 맞춰 추천 출발 시각 계산
                                </Text>
                            </View>
                            <View style={[styles.notificationFeatureDivider, { backgroundColor: cardBorderColor }]} />
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
                    <View style={styles.notificationEditor}>
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
                                            backgroundColor: mode === "dark"
                                                ? "rgba(36,107,254,0.22)"
                                                : "rgba(255,255,255,0.76)",
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
                                style={[
                                    styles.notificationRouteSummary,
                                    { borderTopColor: "rgba(36,107,254,0.16)" },
                                ]}
                            >
                                <View style={styles.notificationRouteMetric}>
                                    <Text style={[styles.notificationRouteMetricLabel, { color: colors.textSecondary }]}>
                                        추천 출발
                                    </Text>
                                    <Text style={[styles.notificationRouteMetricValue, { color: colors.textPrimary }]}>
                                        {formatRouteClock(notificationRouteInfo?.departureTime)}
                                    </Text>
                                </View>
                                <View style={[styles.notificationRouteMetricDivider, { backgroundColor: "rgba(36,107,254,0.16)" }]} />
                                <View style={styles.notificationRouteMetric}>
                                    <Text style={[styles.notificationRouteMetricLabel, { color: colors.textSecondary }]}>
                                        도착 예정
                                    </Text>
                                    <Text style={[styles.notificationRouteMetricValue, { color: colors.textPrimary }]}>
                                        {formatRouteClock(notificationRouteInfo?.arrivalTime)}
                                    </Text>
                                </View>
                                <View style={[styles.notificationRouteMetricDivider, { backgroundColor: "rgba(36,107,254,0.16)" }]} />
                                <View style={styles.notificationRouteMetric}>
                                    <Text style={[styles.notificationRouteMetricLabel, { color: colors.textSecondary }]}>
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
                                { backgroundColor: inputBackground, borderColor: cardBorderColor },
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
                                    onValueChange={(enabled) => setEditingValue(
                                        enabled
                                            ? String(previewDraft.notificationLeadMinutes ?? 60)
                                            : "none"
                                    )}
                                    trackColor={{ false: colors.border, true: BLUE }}
                                    ios_backgroundColor={colors.border}
                                    thumbColor="#FFFFFF"
                                />
                            </View>

                            {notificationEnabled ? (
                                <View
                                    style={[
                                        styles.notificationLeadSection,
                                        { borderTopColor: cardBorderColor },
                                    ]}
                                >
                                    <View style={styles.notificationLeadHeading}>
                                        <Text style={[styles.notificationLeadTitle, { color: colors.textPrimary }]}>
                                            교통 확인 시작
                                        </Text>
                                        <Text style={[styles.notificationLeadCaption, { color: colors.textSecondary }]}>
                                            추천 출발 시각 기준
                                        </Text>
                                    </View>
                                    <View accessibilityRole="radiogroup" style={styles.notificationOptions}>
                                        {NOTIFICATION_OPTIONS.map((option) => {
                                            const selected = editingValue === option.value;
                                            return (
                                                <Pressable
                                                    key={option.value}
                                                    accessibilityRole="radio"
                                                    accessibilityLabel={"출발 " + option.label + " 전부터 교통 확인"}
                                                    accessibilityState={{ selected }}
                                                    onPress={() => setEditingValue(option.value)}
                                                    style={({ pressed }) => [
                                                        styles.notificationChip,
                                                        {
                                                            backgroundColor: selected ? selectedModeBackground : "transparent",
                                                            borderColor: selected ? BLUE : cardBorderColor,
                                                            opacity: pressed ? 0.72 : 1,
                                                        },
                                                    ]}
                                                >
                                                    {selected && (
                                                        <Ionicons accessible={false} name="checkmark-circle" size={15} color={BLUE} />
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
                                </View>
                            ) : (
                                <View
                                    style={[
                                        styles.notificationOffState,
                                        { borderTopColor: cardBorderColor },
                                    ]}
                                >
                                    <Ionicons accessible={false} name="notifications-off-outline" size={17} color={colors.textSecondary} />
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
                    </View>
                )}
                <View style={styles.editButtons}>
	                    <Pressable
	                        onPress={cancelEditField}
                            accessibilityRole="button"
                        style={({ pressed }) => [
                            styles.secondaryButton,
                            {
                                backgroundColor: inputBackground,
                                borderColor: cardBorderColor,
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
            <Text style={[styles.flowHeadline, { color: colors.textPrimary }]}>
                일정이 저장됐어요
            </Text>
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

    const isPrewarmOnly = prewarm
        && !visible
        && !openStartedRef.current
        && !closingRef.current;

    return (
        <Reanimated.View
            pointerEvents={isPrewarmOnly ? "none" : "box-none"}
            style={[styles.screen, presentationStyle]}
        >
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
                            backgroundColor: mode === "dark"
                                ? "rgba(0,0,0,0.58)"
                                : "rgba(0,0,0,0.24)",
                        },
                    ]}
                />
                <Pressable
                    accessible={false}
                    style={StyleSheet.absoluteFill}
                    onPress={requestClose}
                />

                <Reanimated.View
                    collapsable={false}
                    onLayout={handleSeedLayout}
                    style={[
                        styles.cardMotion,
                        cardMotionStyle,
                        cardMotionRadiusStyle,
                    ]}
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
                            <View
                                pointerEvents="none"
                                style={[
                                    styles.glassMilkyFill,
                                    {
                                        backgroundColor: mode === "dark"
                                            ? "rgba(14,15,18,0.72)"
                                            : "rgba(255,255,255,0.28)",
                                    },
                                ]}
                            />
                            <View
                                pointerEvents="none"
                                style={[
                                    styles.glassTopGlow,
                                    {
                                        backgroundColor: mode === "dark"
                                            ? "rgba(255,255,255,0.055)"
                                            : "rgba(255,255,255,0.82)",
                                        opacity: mode === "dark" ? 0.22 : 0.66,
                                    },
                                ]}
                            />
                            <View
                                pointerEvents="none"
                                style={[
                                    styles.glassRefractionBand,
                                    {
                                        backgroundColor: mode === "dark"
                                            ? "transparent"
                                            : "rgba(255,255,255,0.54)",
                                        opacity: mode === "dark" ? 0 : 0.24,
                                    },
                                ]}
                            />
                            <View
                                pointerEvents="none"
                                style={[
                                    styles.glassLowerShade,
                                    {
                                        backgroundColor: mode === "dark"
                                            ? "transparent"
                                            : "rgba(255,255,255,0.18)",
                                        opacity: mode === "dark" ? 0 : 0.46,
                                    },
                                ]}
                            />
                            <View
                                pointerEvents="none"
                                style={[
                                    styles.cardSheen,
                                    mode === "dark" && styles.cardSheenDark,
                                ]}
                            />
                            <View style={styles.content}>
                                {contentMounted && (
                                    <>
                                        <View style={styles.closeButton}>
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
                                                <Ionicons accessible={false} name="close" size={22} color={colors.textSecondary} />
                                            </Pressable>
                                        </View>

                                        <View style={styles.header}>
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
                                                    <Ionicons accessible={false} name="chevron-back" size={22} color={colors.textSecondary} />
                                                </Pressable>
                                            )}
                                            <Text style={[styles.title, { color: colors.textPrimary }]}>{flowTitle}</Text>
                                        </View>

                                        {categoryError && onRetryCategories ? (
                                            <CategoryLoadErrorBanner
                                                compact
                                                retrying={categoryLoading}
                                                onRetry={onRetryCategories}
                                            />
                                        ) : null}

                                        <View style={styles.handoffBody}>
                                            {renderCurrentStep()}
                                        </View>
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
        shadowOffset: { width: 0, height: 18 },
        shadowOpacity: 0.22,
        shadowRadius: 30,
        elevation: 24,
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
    glassMilkyFill: {
        ...StyleSheet.absoluteFillObject,
    },
    glassTopGlow: {
        position: "absolute",
        top: 0,
        left: 12,
        right: 12,
        height: 58,
        borderRadius: 36,
        opacity: 0.66,
    },
    glassRefractionBand: {
        position: "absolute",
        top: 34,
        left: -34,
        width: "124%",
        height: 56,
        borderRadius: 32,
        opacity: 0.24,
        transform: [{ rotate: "-7deg" }],
    },
    glassLowerShade: {
        position: "absolute",
        left: 14,
        right: 14,
        bottom: -32,
        height: 116,
        borderRadius: 58,
        opacity: 0.46,
    },
    cardSheen: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: EXPANDED_CARD_RADIUS,
        backgroundColor: "rgba(255,255,255,0.025)",
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: "rgba(255,255,255,0.72)",
        borderLeftWidth: StyleSheet.hairlineWidth,
        borderLeftColor: "rgba(255,255,255,0.36)",
    },
    cardSheenDark: {
        backgroundColor: "rgba(255,255,255,0.010)",
        borderTopColor: "rgba(255,255,255,0.26)",
        borderLeftColor: "rgba(255,255,255,0.14)",
    },
    content: {
        flex: 1,
        transformOrigin: [0, 0, 0],
        paddingHorizontal: 18,
        paddingTop: 28,
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
        alignItems: "center",
        paddingHorizontal: 24,
        marginBottom: 14,
    },
    title: {
        fontSize: 19,
        fontWeight: "900",
        letterSpacing: 0,
    },
    modeSelector: {
        height: 58,
        borderRadius: 19,
        borderWidth: 1,
        alignSelf: "stretch",
        flexDirection: "row",
        padding: 4,
        marginBottom: 13,
        shadowColor: "#FFFFFF",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.12,
        shadowRadius: 10,
        overflow: "hidden",
    },
    modeSelectorIndicator: {
        position: "absolute",
        top: 4,
        bottom: 4,
        left: 0,
        borderRadius: 17,
        borderWidth: StyleSheet.hairlineWidth,
        shadowColor: BLUE,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 14,
    },
    modeIndicatorUnderline: {
        position: "absolute",
        left: 13,
        right: 13,
        bottom: 0,
        height: 2.5,
        borderRadius: 1.25,
        backgroundColor: BLUE,
    },
    modeButton: {
        minWidth: 58,
        borderRadius: 17,
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        paddingHorizontal: 12,
        flexGrow: 1,
        zIndex: 1,
    },
    modeButtonCompact: {
        flexBasis: 72,
        paddingHorizontal: 10,
    },
    modeButtonWide: {
        flexBasis: 86,
        paddingHorizontal: 12,
    },
    modeButtonSelected: {
        shadowColor: "transparent",
    },
    modeText: {
        fontSize: 11,
        fontWeight: "700",
    },
    modeUnderline: {
        position: "absolute",
        left: 16,
        right: 16,
        bottom: -4,
        height: 2,
        borderRadius: 1,
        backgroundColor: BLUE,
    },
    inputWrap: {
        minHeight: 132,
        borderRadius: 19,
        borderWidth: 1,
        paddingHorizontal: 15,
        paddingTop: 14,
        paddingBottom: 30,
        marginBottom: 13,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.045,
        shadowRadius: 16,
    },
    input: {
        flex: 1,
        minHeight: 88,
        fontSize: 15,
        lineHeight: 23,
        fontWeight: "500",
        textAlignVertical: "top",
        padding: 0,
    },
    counterPill: {
        position: "absolute",
        right: 14,
        bottom: 10,
    },
    counter: {
        fontSize: 12,
        fontWeight: "600",
    },
    mediaAction: {
        minHeight: 44,
        borderRadius: 18,
        borderWidth: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 12,
        marginBottom: 10,
    },
    mediaActionIcon: {
        width: 24,
        alignItems: "center",
    },
    mediaActionTextWrap: {
        flex: 1,
        minWidth: 0,
    },
    mediaActionTitle: {
        fontSize: 13,
        fontWeight: "800",
    },
    mediaActionMeta: {
        marginTop: 2,
        fontSize: 11,
        fontWeight: "600",
    },
    mediaPanel: {
        minHeight: 166,
        borderRadius: 20,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 17,
        paddingVertical: 15,
        marginBottom: 13,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 9 },
        shadowOpacity: 0.045,
        shadowRadius: 18,
    },
    photoModeContent: {
        marginBottom: 13,
    },
    photoPreviewPanel: {
        minHeight: 142,
        marginBottom: 0,
    },
    photoIconWrap: {
        width: 58,
        height: 58,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 9,
    },
    photoThumbnail: {
        width: 92,
        height: 92,
        borderRadius: 20,
        marginBottom: 10,
        backgroundColor: "rgba(0,0,0,0.08)",
    },
    photoRemoveButton: {
        position: "absolute",
        top: 12,
        right: 12,
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.52)",
    },
    mediaPanelTitle: {
        fontSize: 17,
        fontWeight: "900",
        letterSpacing: 0,
        textAlign: "center",
    },
    mediaPanelMeta: {
        marginTop: 6,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "600",
        textAlign: "center",
    },
    photoActions: {
        width: "100%",
        flexDirection: "row",
        gap: 9,
        marginTop: 10,
    },
    photoSourceButton: {
        flex: 1,
        minHeight: 40,
        borderRadius: 15,
        borderWidth: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        shadowColor: "#FFFFFF",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.12,
        shadowRadius: 9,
    },
    photoSourceButtonText: {
        fontSize: 13,
        fontWeight: "800",
    },
    photoTranscriptWrap: {
        minHeight: 120,
        marginTop: 10,
        borderRadius: 16,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingTop: 9,
        paddingBottom: 9,
    },
    photoTranscriptHeader: {
        minHeight: 18,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    photoTranscriptLabel: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "800",
    },
    photoConfidence: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "700",
    },
    truncatedRecognitionText: {
        color: "#F59E0B",
    },
    photoTranscriptInput: {
        minHeight: 66,
        maxHeight: 92,
        padding: 0,
        marginTop: 4,
        fontSize: 14,
        lineHeight: 20,
        fontWeight: "600",
        textAlignVertical: "top",
    },
    photoRecognitionStatus: {
        minHeight: 78,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 9,
    },
    photoRecognitionStatusText: {
        flexShrink: 1,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "700",
    },
    photoRecognitionErrorWrap: {
        minHeight: 78,
        alignItems: "flex-start",
        justifyContent: "center",
        gap: 8,
    },
    photoRecognitionErrorText: {
        color: "#EF4444",
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "700",
    },
    photoRecognitionRetry: {
        minHeight: 30,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 9,
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
        minHeight: 300,
        borderRadius: 20,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 13,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 9 },
        shadowOpacity: 0.06,
        shadowRadius: 18,
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
        marginBottom: 0,
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
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.16,
        shadowRadius: 22,
    },
    voiceTitle: {
        fontSize: 17,
        fontWeight: "900",
        letterSpacing: 0,
        textAlign: "center",
    },
    voiceMeta: {
        marginTop: 5,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "700",
        textAlign: "center",
    },
    voiceTranscriptWrap: {
        minHeight: 78,
        marginTop: 11,
        borderRadius: 15,
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
        minHeight: 42,
        maxHeight: 70,
        padding: 0,
        marginTop: 3,
        fontSize: 14,
        lineHeight: 20,
        fontWeight: "600",
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
        gap: 7,
        paddingBottom: 8,
    },
    previewRow: {
        minHeight: 47,
        borderRadius: 10,
        borderWidth: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    previewIcon: {
        width: 23,
        height: 23,
        borderRadius: 11.5,
        alignItems: "center",
        justifyContent: "center",
    },
    previewTextWrap: {
        flex: 1,
        minWidth: 0,
    },
    previewLabel: {
        fontSize: 10.5,
        fontWeight: "800",
        marginBottom: 2,
    },
    previewValueRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
    },
    previewValue: {
        fontSize: 12.5,
        lineHeight: 17,
        fontWeight: "800",
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
        paddingTop: 8,
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
        fontWeight: "900",
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
        shadowOpacity: 0.20,
        shadowRadius: 18,
    },
    primaryButtonText: {
        color: "#fff",
        fontSize: 14,
        fontWeight: "900",
    },
    editStep: {
        flex: 1,
        justifyContent: "space-between",
        gap: 12,
    },
    editInput: {
        minHeight: 96,
        borderRadius: 17,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 15,
        lineHeight: 22,
        fontWeight: "700",
        textAlignVertical: "top",
    },
    editInputMemo: {
        minHeight: 150,
    },
    locationEditInput: {
        minHeight: 56,
        textAlignVertical: "center",
    },
    routeEditPanel: {
        flex: 1,
        justifyContent: "flex-start",
        paddingTop: 2,
    },
    routeEditNotice: {
        borderWidth: 1,
        borderRadius: 16,
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
        fontWeight: "800",
    },
    pickerPanel: {
        borderRadius: 18,
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
        fontWeight: "800",
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
        fontWeight: "800",
    },
    notificationEditor: {
        flex: 1,
        gap: 9,
    },
    notificationHero: {
        borderWidth: 1,
        borderRadius: 18,
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
        fontWeight: "900",
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
        fontWeight: "700",
    },
    notificationRouteMetricValue: {
        marginTop: 2,
        fontSize: 12.5,
        lineHeight: 17,
        fontWeight: "900",
    },
    notificationRouteMetricDivider: {
        width: StyleSheet.hairlineWidth,
        height: 28,
    },
    notificationControlCard: {
        borderWidth: 1,
        borderRadius: 17,
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
        fontWeight: "900",
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
        fontWeight: "900",
    },
    notificationLeadCaption: {
        fontSize: 9.5,
        lineHeight: 13,
        fontWeight: "700",
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
        fontWeight: "900",
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
        fontWeight: "700",
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
        fontWeight: "900",
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
        fontWeight: "900",
        textAlign: "center",
    },
    notificationRouteBody: {
        maxWidth: 270,
        fontSize: 11.5,
        lineHeight: 17,
        fontWeight: "700",
        textAlign: "center",
    },
    notificationFeatureList: {
        alignSelf: "stretch",
        marginTop: 5,
        borderWidth: 1,
        borderRadius: 15,
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
        fontWeight: "800",
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
        fontWeight: "700",
    },
    editButtons: {
        flexDirection: "row",
        gap: 8,
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
        height: 46,
        borderRadius: 15,
        backgroundColor: BLUE,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        shadowColor: BLUE,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.22,
        shadowRadius: 20,
    },
    submitText: {
        color: "#fff",
        fontSize: 15,
        fontWeight: "900",
    },
});
