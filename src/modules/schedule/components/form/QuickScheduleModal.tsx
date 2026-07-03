import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    AppState,
    ActionSheetIOS,
    type EmitterSubscription,
    Image,
    Keyboard,
    KeyboardAvoidingView,
    LayoutChangeEvent,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Audio } from "expo-av";
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

import {
    addNoLateAudioSpectrumListener,
    startNoLateAudioSpectrum,
    stopNoLateAudioSpectrum,
} from "../../../audio/NoLateAudioSpectrum";
import { useTheme } from "../../../theme/ThemeContext";
import type { QuickScheduleMediaInput } from "../../quickInputExtraction";
import type { Place, ScheduleCategory, ScheduleItem, ScheduleParseResult, TravelMode } from "../../types";
import { consumeRoutePlannerResult, setRoutePlannerInitial, type RoutePlannerPayload } from "../../routePlannerSession";
import { getRouteInfoFromRoute } from "../../routeInfo";
import CalendarGlassSurface from "../calendar/CalendarGlassSurface";
import LocationInputRow from "./LocationInputRow";

type Props = {
    visible: boolean;
    onClose: () => void;
    onCloseStart?: () => void;
    onAnalyze: (text: string, media?: QuickScheduleMediaInput) => Promise<ScheduleParseResult>;
    onSave: (payload: Omit<ScheduleItem, "id">) => void | Promise<void>;
    defaultDay: string;
    defaultCategory?: ScheduleCategory;
    sourceTopOffset?: number;
    sourceWidth?: number;
    sourceHeight?: number;
    sourceContent?: "toolbar" | "addMenu";
    qaInitialFlowStep?: FlowStep;
    qaInitialPreviewDraft?: PreviewDraft | null;
    qaInitialEditingField?: PreviewField | null;
    qaInitialInputMode?: InputMode;
    qaInitialAnalysisProgress?: number;
    qaInitialVoiceRecording?: boolean;
    qaInitialVoiceDurationMillis?: number;
    qaInitialVoiceMeterLevel?: number;
    qaAutoCloseAfterMs?: number;
};

type InputMode = "text" | "photo" | "voice";
type FlowStep = "input" | "analyzing" | "analysisError" | "preview" | "edit" | "saving" | "saved";
type PreviewField = "title" | "date" | "time" | "location" | "notification" | "memo";
type TimeEditMode = "picker" | "manual";
type TabLayout = {
    x: number;
    width: number;
};
type PreviewDraft = {
    title: string;
    date: string;
    time: string;
    location: string;
    origin?: Place;
    destination?: Place;
    travelMode?: TravelMode;
    travelMinutes?: number;
    route?: unknown;
    notificationLeadMinutes?: number;
    memo: string;
    badges: Partial<Record<PreviewField, string>>;
    parsed?: ScheduleParseResult;
};

const QUICK_TEXT_LIMIT = 300;
const BLUE = "#246BFE";
const OPEN_START_PROGRESS = 0;
const OPEN_DURATION_MS = 420;
const CLOSE_DURATION_MS = 300;
const CLOSE_SURFACE_DELAY_MS = 0;
const COLLAPSED_TOOLBAR_WIDTH = 150;
const COLLAPSED_TOOLBAR_HEIGHT = 44;
const EXPANDED_CARD_RADIUS = 38;
const OPEN_EASING = ReanimatedEasing.bezier(0.18, 0.82, 0.2, 1);
const CLOSE_EASING = ReanimatedEasing.bezier(0.3, 0, 0.16, 1);
const CONTENT_EASING = ReanimatedEasing.bezier(0.2, 0, 0.16, 1);
const CONTENT_MOUNT_DELAY_MS = 220;
const CONTENT_OPEN_DELAY_MS = 260;
const CONTENT_OPEN_DURATION_MS = 120;
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
    photo: 410,
    voice: 430,
};
const VOICE_SPECTRUM_BAR_COUNT = 36;
const VOICE_SPECTRUM_BARS = Array.from({ length: VOICE_SPECTRUM_BAR_COUNT }, (_, index) => index);
const VOICE_SPECTRUM_SIZE = 132;
const FLOW_CARD_HEIGHT_BY_STEP: Record<Exclude<FlowStep, "input">, number> = {
    analyzing: 360,
    analysisError: 368,
    preview: 456,
    edit: 456,
    saving: 368,
    saved: 368,
};
const FALLBACK_CATEGORY: ScheduleCategory = {
    id: "1",
    title: "업무",
    color: "#FF3B30",
};
const INPUT_MODES: Array<{
    key: InputMode;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
}> = [
    { key: "text", label: "텍스트", icon: "text-outline" },
    { key: "photo", label: "사진", icon: "image-outline" },
    { key: "voice", label: "음성", icon: "mic-outline" },
];

function normalizeVoiceMetering(metering?: number | null) {
    if (typeof metering !== "number" || Number.isNaN(metering)) return null;

    const clamped = Math.max(-60, Math.min(0, metering));
    const linear = (clamped + 60) / 60;
    return Math.max(0, Math.min(1, Math.pow(linear, 1.28)));
}

function createVoiceMeterHistory(level = 0) {
    return Array.from({ length: VOICE_SPECTRUM_BAR_COUNT }, (_, index) => {
        if (level <= 0) return 0;

        const speechEnvelope = 0.52
            + Math.sin(index * 0.57) * 0.24
            + Math.sin(index * 1.31 + 0.8) * 0.16;
        return Math.max(0.04, Math.min(1, level * Math.max(0.2, speechEnvelope)));
    });
}

function appendVoiceMeterHistory(history: number[], level: number) {
    const source = history.length === VOICE_SPECTRUM_BAR_COUNT
        ? history
        : createVoiceMeterHistory();
    const normalized = Math.max(0, Math.min(1, level));

    return [...source.slice(1), normalized];
}

function sanitizeVoiceSpectrumLevels(levels?: number[] | null) {
    const source = Array.isArray(levels) && levels.length > 0
        ? levels
        : createVoiceMeterHistory();

    return Array.from({ length: VOICE_SPECTRUM_BAR_COUNT }, (_, index) => {
        const sourceIndex = Math.min(source.length - 1, Math.floor(index * source.length / VOICE_SPECTRUM_BAR_COUNT));
        const value = Number(source[sourceIndex]);
        if (!Number.isFinite(value)) return 0;
        return Math.max(0, Math.min(1, value));
    });
}

function getVoiceWaveformBarHeight(level: number) {
    return Math.max(4, Math.min(30, 4 + level * 26));
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
    { label: "미설정", value: "none" },
    { label: "10분 전", value: "10" },
    { label: "30분 전", value: "30" },
    { label: "1시간 전", value: "60" },
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
    if (minutes === undefined) return "미설정";
    if (minutes < 60) return `${minutes}분 전`;
    if (minutes % 60 === 0) return `${minutes / 60}시간 전`;
    return `${minutes}분 전`;
}

function includesAny(values: string[], needles: string[]) {
    const normalized = values.join(" ").toLowerCase();
    return needles.some((needle) => normalized.includes(needle.toLowerCase()));
}

function displayPlaceName(place?: { name?: string; address?: string }) {
    return place?.name?.trim() || place?.address?.trim() || "";
}

function getPreviewDraftRouteInfo(draft: PreviewDraft | null | undefined) {
    if (!draft) return undefined;
    const destination = draft.destination ?? placeFromDraftLocation(draft.location);
    return getRouteInfoFromRoute(draft.route, {
        origin: draft.origin,
        destination,
        travelMode: draft.travelMode,
        travelMinutes: draft.travelMinutes,
    });
}

function canUseRouteNotification(draft: PreviewDraft | null | undefined) {
    return !!getPreviewDraftRouteInfo(draft);
}

function buildPreviewDraft(
    parsed: ScheduleParseResult,
    fallbackText: string,
    referenceDay: string
): PreviewDraft {
    const startDate = parsed.startAt ? new Date(parsed.startAt) : null;
    const parsedDate = parsed.date?.trim();
    const parsedTime = parsed.time?.trim();
    const missingFields = parsed.missingFields ?? [];
    const warnings = parsed.warnings ?? [];
    const destinationText = displayPlaceName(parsed.destination);
    const routeInfo = getRouteInfoFromRoute(parsed.route, {
        origin: parsed.origin,
        destination: parsed.destination,
        travelMode: parsed.travelMode,
        travelMinutes: parsed.travelMinutes,
    });
    const routeNotificationReady = !!routeInfo;
    const badges: PreviewDraft["badges"] = {};
    const date = startDate && !Number.isNaN(startDate.getTime())
        ? toYmd(startDate)
        : parsedDate && /^\d{4}-\d{2}-\d{2}$/.test(parsedDate)
            ? parsedDate
            : referenceDay;
    const time = startDate && !Number.isNaN(startDate.getTime())
        ? toHm(startDate)
        : parsedTime && /^\d{1,2}:\d{2}$/.test(parsedTime)
            ? parsedTime.padStart(5, "0")
            : "19:00";

    if ((!parsedTime && !parsed.startAt) || includesAny([...missingFields, ...warnings], ["time", "시간"])) {
        badges.time = "시간 미확정";
    }
    if (!destinationText || includesAny([...missingFields, ...warnings], ["place", "location", "destination", "장소", "위치"])) {
        badges.location = "장소 확인 필요";
    }
    if (!routeNotificationReady) {
        badges.notification = "경로 등록 필요";
    } else if (!parsed.notificationEnabled) {
        badges.notification = "알림 미설정";
    }

    return {
        title: parsed.title?.trim() || fallbackText.split(/\n|,/)[0]?.trim() || "새 일정",
        date,
        time,
        location: destinationText || "장소 미정",
        origin: parsed.origin,
        destination: parsed.destination,
        travelMode: parsed.travelMode,
        travelMinutes: parsed.travelMinutes,
        route: parsed.route,
        notificationLeadMinutes: routeNotificationReady && parsed.notificationEnabled ? parsed.notificationLeadMinutes ?? 30 : undefined,
        memo: parsed.notes?.trim() || fallbackText.trim() || "메모 없음",
        badges,
        parsed,
    };
}

function placeFromDraftLocation(location: string): Place | undefined {
    const normalized = location.trim();
    if (!normalized || normalized === "장소 미정") return undefined;
    return { name: normalized };
}

function applyRouteResultToPreviewDraft(
    draft: PreviewDraft,
    result: RoutePlannerPayload
): PreviewDraft {
    const destinationName = displayPlaceName(result.destination) || result.locationName?.split("→").pop()?.trim() || draft.location;
    const nextBadges = { ...draft.badges };
    const hasRoute = !!getRouteInfoFromRoute(result.route, {
        origin: result.origin,
        destination: result.destination,
        travelMode: result.travelMode,
        travelMinutes: result.travelMinutes,
    });
    const nextNotificationLeadMinutes = hasRoute
        ? draft.notificationLeadMinutes ?? (draft.parsed?.notificationEnabled ? draft.parsed.notificationLeadMinutes ?? 30 : undefined)
        : undefined;
    if (destinationName && destinationName !== "장소 미정") {
        delete nextBadges.location;
    }
    if (hasRoute) {
        if (nextNotificationLeadMinutes !== undefined) {
            delete nextBadges.notification;
        } else {
            nextBadges.notification = "알림 미설정";
        }
    } else {
        nextBadges.notification = "경로 등록 필요";
    }

    return {
        ...draft,
        location: destinationName || "장소 미정",
        origin: result.origin,
        destination: result.destination,
        travelMode: result.travelMode,
        travelMinutes: result.travelMinutes,
        route: result.route,
        notificationLeadMinutes: nextNotificationLeadMinutes,
        badges: nextBadges,
        parsed: draft.parsed
            ? {
                ...draft.parsed,
                origin: result.origin,
                destination: result.destination,
                travelMode: result.travelMode,
                travelMinutes: result.travelMinutes,
                route: result.route,
            }
            : draft.parsed,
    };
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
    onClose,
    onCloseStart,
    onAnalyze,
    onSave,
    defaultDay,
    defaultCategory = FALLBACK_CATEGORY,
    sourceTopOffset = 4,
    sourceWidth = 150,
    sourceHeight = 44,
    sourceContent = "toolbar",
    qaInitialFlowStep,
    qaInitialPreviewDraft = null,
    qaInitialEditingField = null,
    qaInitialInputMode = "text",
    qaInitialAnalysisProgress = 0,
    qaInitialVoiceRecording = false,
    qaInitialVoiceDurationMillis = 0,
    qaInitialVoiceMeterLevel = 0,
    qaAutoCloseAfterMs,
}: Props) {
    const router = useRouter();
    const pathname = usePathname();
    const { colors, mode } = useTheme();
    const { width, height } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const [rendered, setRendered] = useState(visible);
    const [text, setText] = useState("");
    const [inputMode, setInputMode] = useState<InputMode>(qaInitialInputMode);
    const [selectedPhoto, setSelectedPhoto] = useState<ImagePickerAsset | null>(null);
    const [voiceUri, setVoiceUri] = useState<string | null>(null);
    const [voiceDurationMillis, setVoiceDurationMillis] = useState(qaInitialVoiceDurationMillis);
    const [isVoiceRecording, setIsVoiceRecording] = useState(qaInitialVoiceRecording);
    const [voiceMeterHistory, setVoiceMeterHistory] = useState(() => (
        createVoiceMeterHistory(qaInitialVoiceRecording ? qaInitialVoiceMeterLevel : 0)
    ));
    const [voiceSpectrumEnergy, setVoiceSpectrumEnergy] = useState(
        qaInitialVoiceRecording ? qaInitialVoiceMeterLevel : 0
    );
    const [submitting, setSubmitting] = useState(qaInitialFlowStep === "analyzing" || qaInitialFlowStep === "saving");
    const [isClosingVisual, setIsClosingVisual] = useState(false);
    const [contentMounted, setContentMounted] = useState(false);
    const [modeLayouts, setModeLayouts] = useState<Partial<Record<InputMode, TabLayout>>>({});
    const [flowStep, setFlowStep] = useState<FlowStep>(qaInitialFlowStep ?? "input");
    const [analysisProgress, setAnalysisProgress] = useState(qaInitialAnalysisProgress);
    const [analysisError, setAnalysisError] = useState("");
    const [previewDraft, setPreviewDraft] = useState<PreviewDraft | null>(qaInitialPreviewDraft);
    const [editingField, setEditingField] = useState<PreviewField | null>(qaInitialEditingField);
    const [editingValue, setEditingValue] = useState("");
    const [timeEditMode, setTimeEditMode] = useState<TimeEditMode>("picker");
    const [routePlannerSessionId, setRoutePlannerSessionId] = useState<string | undefined>();
    const [routePlannerHidden, setRoutePlannerHidden] = useState(false);
    const recorderState = {
        isRecording: isVoiceRecording,
        durationMillis: voiceDurationMillis,
    };
    const progress = useSharedValue(0);
    const contentProgress = useSharedValue(0);
    const modeIndicatorX = useSharedValue(0);
    const modeIndicatorWidth = useSharedValue(0);
    const inputRef = useRef<TextInput>(null);
    const audioRecordingRef = useRef<Audio.Recording | null>(null);
    const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const audioSpectrumSubscriptionRef = useRef<EmitterSubscription | null>(null);
    const nativeSpectrumFrameSeenRef = useRef(false);
    const closingRef = useRef(false);
    const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const analysisTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const routePlannerAwayRef = useRef(false);
    const routePlannerFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cardWidth = Math.min(width - 60, 348);
    const sourceRight = width - 16;
    const isClosingSeedVisual = isClosingVisual || closingRef.current;
    const isClosingToToolbar = isClosingSeedVisual && sourceContent === "addMenu";
    const morphSourceWidth = isClosingToToolbar ? COLLAPSED_TOOLBAR_WIDTH : sourceWidth;
    const morphSourceHeight = isClosingToToolbar ? COLLAPSED_TOOLBAR_HEIGHT : sourceHeight;
    const morphSourceContent = isClosingToToolbar ? "toolbar" : sourceContent;
    const visibleSeedContent: "toolbar" | "addMenu" | "none" =
        isClosingToToolbar
            ? "none"
            : (isClosingSeedVisual ? "none" : (sourceContent === "addMenu" ? "none" : sourceContent));
    const sourceLeft = sourceRight - morphSourceWidth;
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
    const sourceRadius = Math.min(morphSourceHeight / 2, 26);
    const openingFromAddMenu = morphSourceContent === "addMenu";
    const firstStretchWidth = Math.min(cardWidth, morphSourceWidth + (openingFromAddMenu ? 24 : 18));
    const secondStretchWidth = Math.min(cardWidth, morphSourceWidth + (openingFromAddMenu ? 58 : 42));
    const bridgeWidth = Math.min(cardWidth, morphSourceWidth + (openingFromAddMenu ? 92 : 72));
    const bodyWidth = Math.min(cardWidth, Math.max(bridgeWidth, cardWidth - (openingFromAddMenu ? 84 : 112)));
    const nearFinalWidth = Math.min(cardWidth, Math.max(bodyWidth, cardWidth - (openingFromAddMenu ? 30 : 38)));
    const firstStretchHeight = Math.min(cardHeight, morphSourceHeight + (openingFromAddMenu ? 18 : 16));
    const secondStretchHeight = Math.min(cardHeight, morphSourceHeight + (openingFromAddMenu ? 56 : 42));
    const bridgeHeight = Math.min(cardHeight, morphSourceHeight + (openingFromAddMenu ? 116 : 96));
    const bodyHeight = Math.min(cardHeight, Math.max(bridgeHeight, cardHeight * (openingFromAddMenu ? 0.46 : 0.34)));
    const nearFinalHeight = Math.min(cardHeight, Math.max(bodyHeight, cardHeight - (openingFromAddMenu ? 48 : 62)));
    const morphFrameRange = openingFromAddMenu
        ? [0, 0.08, 0.22, 0.44, 0.66, 0.86, 1]
        : [0, 0.16, 0.34, 0.54, 0.72, 0.9, 1];

    const previewRouteInfo = useMemo(() => getPreviewDraftRouteInfo(previewDraft), [previewDraft]);
    const notificationRouteReady = !!previewRouteInfo;

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

    const detachAudioSpectrumListener = useCallback(() => {
        audioSpectrumSubscriptionRef.current?.remove();
        audioSpectrumSubscriptionRef.current = null;
        nativeSpectrumFrameSeenRef.current = false;
    }, []);

    const stopNativeAudioSpectrumSession = useCallback(() => {
        detachAudioSpectrumListener();
        stopNoLateAudioSpectrum();
    }, [detachAudioSpectrumListener]);

    const startNativeAudioSpectrumSession = useCallback(() => {
        detachAudioSpectrumListener();
        nativeSpectrumFrameSeenRef.current = false;

        const subscription = addNoLateAudioSpectrumListener((frame) => {
            nativeSpectrumFrameSeenRef.current = true;
            const preferredLevels = frame.bands && frame.bands.length > 0
                ? frame.bands
                : frame.waveform;
            setVoiceMeterHistory(sanitizeVoiceSpectrumLevels(preferredLevels));
            const rms = typeof frame.rms === "number" ? frame.rms : 0;
            const peak = typeof frame.peak === "number" ? frame.peak : 0;
            setVoiceSpectrumEnergy(Math.max(0, Math.min(1, Math.max(rms, peak * 0.72))));
        });

        if (!subscription) return;

        audioSpectrumSubscriptionRef.current = subscription;
        void startNoLateAudioSpectrum(VOICE_SPECTRUM_BAR_COUNT)
            .then((result) => {
                if (!result.running) {
                    detachAudioSpectrumListener();
                }
            })
            .catch(() => {
                detachAudioSpectrumListener();
            });
    }, [detachAudioSpectrumListener]);

    const stopActiveRecording = useCallback((preserveRecording = false) => {
        const recorder = audioRecordingRef.current;
        audioRecordingRef.current = null;
        clearVoiceTimer();
        stopNativeAudioSpectrumSession();
        setIsVoiceRecording(false);
        setVoiceMeterHistory(createVoiceMeterHistory());
        setVoiceSpectrumEnergy(0);

        if (!preserveRecording) {
            setVoiceUri(null);
            setVoiceDurationMillis(0);
        }

        if (!recorder) {
            void Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
            }).catch(() => undefined);
            return;
        }

        void recorder.stopAndUnloadAsync()
            .then(() => {
                const recordedUri = recorder.getURI();
                if (preserveRecording && recordedUri) {
                    setVoiceUri(recordedUri);
                }
            })
            .catch(() => undefined)
            .finally(() => {
                void Audio.setAudioModeAsync({
                    allowsRecordingIOS: false,
                    playsInSilentModeIOS: true,
                }).catch(() => undefined);
            });
    }, [clearVoiceTimer, stopNativeAudioSpectrumSession]);

    const finishClose = useCallback((shouldNotifyClose: boolean) => {
        if (analysisTimerRef.current) {
            clearInterval(analysisTimerRef.current);
            analysisTimerRef.current = null;
        }
        setRendered(false);
        setText("");
        setInputMode("text");
        setSelectedPhoto(null);
        setVoiceUri(null);
        setVoiceDurationMillis(0);
        setIsVoiceRecording(false);
        setVoiceMeterHistory(createVoiceMeterHistory());
        setVoiceSpectrumEnergy(0);
        setSubmitting(false);
        setIsClosingVisual(false);
        setContentMounted(false);
        setFlowStep("input");
        setAnalysisProgress(0);
        setAnalysisError("");
        setPreviewDraft(null);
        setEditingField(null);
        setEditingValue("");
        setTimeEditMode("picker");
        setRoutePlannerSessionId(undefined);
        setRoutePlannerHidden(false);
        routePlannerAwayRef.current = false;
        if (routePlannerFallbackTimerRef.current) {
            clearTimeout(routePlannerFallbackTimerRef.current);
            routePlannerFallbackTimerRef.current = null;
        }
        closingRef.current = false;
        if (shouldNotifyClose) {
            onClose();
        }
    }, [onClose]);

    const runCloseAnimation = useCallback((shouldNotifyClose = false) => {
        Keyboard.dismiss();
        stopActiveRecording();
        if (openTimerRef.current) {
            clearTimeout(openTimerRef.current);
            openTimerRef.current = null;
        }
        setIsClosingVisual(true);
        cancelAnimation(progress);
        cancelAnimation(contentProgress);
        progress.value = progress.value > 0.08 ? progress.value : 1;
        contentProgress.value = withTiming(0, {
            duration: 120,
            easing: CONTENT_EASING,
        });
        progress.value = withDelay(
            CLOSE_SURFACE_DELAY_MS,
            withTiming(
                0,
                {
                    duration: CLOSE_DURATION_MS,
                    easing: CLOSE_EASING,
                },
                (finished) => {
                    if (finished) {
                        runOnJS(finishClose)(shouldNotifyClose);
                    }
                }
            )
        );
    }, [contentProgress, finishClose, progress, stopActiveRecording]);

    const requestClose = useCallback(() => {
        if (submitting || closingRef.current) return;

        closingRef.current = true;
        setIsClosingVisual(true);
        onCloseStart?.();
        runCloseAnimation(true);
    }, [onCloseStart, runCloseAnimation, submitting]);

    useEffect(() => {
        if (!visible || !qaAutoCloseAfterMs) return undefined;

        const timer = setTimeout(requestClose, qaAutoCloseAfterMs);
        return () => clearTimeout(timer);
    }, [qaAutoCloseAfterMs, requestClose, visible]);

    useLayoutEffect(() => {
        if (!visible) return undefined;

        closingRef.current = false;
        setIsClosingVisual(false);
        setRendered(true);
        cancelAnimation(progress);
        cancelAnimation(contentProgress);
        progress.value = OPEN_START_PROGRESS;
        contentProgress.value = 0;
        if (openTimerRef.current) {
            clearTimeout(openTimerRef.current);
            openTimerRef.current = null;
        }
        progress.value = withTiming(
            1,
            {
                duration: Math.round(OPEN_DURATION_MS * (1 - OPEN_START_PROGRESS)),
                easing: OPEN_EASING,
            }
        );
        openTimerRef.current = setTimeout(() => {
            setContentMounted(true);
            openTimerRef.current = null;
        }, CONTENT_MOUNT_DELAY_MS);
        contentProgress.value = withDelay(
            CONTENT_OPEN_DELAY_MS,
            withTiming(1, {
                duration: CONTENT_OPEN_DURATION_MS,
                easing: CONTENT_EASING,
            })
        );
        return () => {
            if (openTimerRef.current) {
                clearTimeout(openTimerRef.current);
                openTimerRef.current = null;
            }
        };
    }, [contentProgress, progress, visible]);

    useEffect(() => {
        if (visible || !rendered || closingRef.current) return;

        closingRef.current = true;
        setIsClosingVisual(true);
        onCloseStart?.();
        runCloseAnimation(true);
    }, [onCloseStart, rendered, runCloseAnimation, visible]);

    const startAnalysis = async () => {
        const normalized = text.trim();
        const hasCurrentInput = inputMode === "text"
            ? normalized.length > 0
            : inputMode === "photo"
                ? Boolean(selectedPhoto?.uri)
                : Boolean(voiceUri);
        if (!hasCurrentInput || submitting || recorderState.isRecording) return;

        const fallbackText = inputMode === "photo"
            ? "사진으로 입력한 일정"
            : inputMode === "voice"
                ? "음성으로 입력한 일정"
                : "";
        const sourceText = normalized || fallbackText;

        try {
            setSubmitting(true);
            setAnalysisError("");
            setFlowStep("analyzing");
            setAnalysisProgress(8);
            if (analysisTimerRef.current) {
                clearInterval(analysisTimerRef.current);
            }
            analysisTimerRef.current = setInterval(() => {
                setAnalysisProgress((current) => Math.min(88, current + (current < 55 ? 9 : 4)));
            }, 180);

            const parsed = await onAnalyze(sourceText, {
                inputMode,
                photoUri: inputMode === "photo" ? selectedPhoto?.uri : undefined,
                voiceUri: inputMode === "voice" ? voiceUri ?? undefined : undefined,
                voiceDurationMillis: inputMode === "voice" && voiceUri ? voiceDurationMillis : undefined,
            });
            if (analysisTimerRef.current) {
                clearInterval(analysisTimerRef.current);
                analysisTimerRef.current = null;
            }
            setAnalysisProgress(100);
            setTimeout(() => {
                setPreviewDraft(buildPreviewDraft(parsed, sourceText, defaultDay));
                setFlowStep("preview");
                setSubmitting(false);
            }, 220);
        } catch (error) {
            if (analysisTimerRef.current) {
                clearInterval(analysisTimerRef.current);
                analysisTimerRef.current = null;
            }
            setAnalysisProgress(0);
            setAnalysisError(error instanceof Error ? error.message : "일정 정보를 분석하지 못했어요");
            setFlowStep("analysisError");
            setSubmitting(false);
        }
    };

    const submit = startAnalysis;

    const updatePreviewField = useCallback((field: PreviewField, value: string) => {
        setPreviewDraft((current) => {
            if (!current) return current;
            const nextBadges = { ...current.badges };
            delete nextBadges[field];

            if (field === "notification") {
                const minutes = value === "none" ? undefined : Number(value);
                return {
                    ...current,
                    notificationLeadMinutes: Number.isFinite(minutes) ? minutes : undefined,
                    badges: nextBadges,
                };
            }

            return {
                ...current,
                [field]: value,
                ...(field === "location" ? { destination: placeFromDraftLocation(value) } : {}),
                badges: nextBadges,
            };
        });
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
            : editingValue.trim() || (editingField === "notification" ? "none" : "");
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

    const openRoutePlannerFromPreview = useCallback(() => {
        if (!previewDraft || submitting) return;

        const destination = previewDraft.destination ?? placeFromDraftLocation(previewDraft.location);
        const sessionId = `quick-route-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        routePlannerAwayRef.current = false;
        if (routePlannerFallbackTimerRef.current) {
            clearTimeout(routePlannerFallbackTimerRef.current);
            routePlannerFallbackTimerRef.current = null;
        }

        setRoutePlannerInitial(sessionId, {
            origin: previewDraft.origin,
            destination,
            travelMode: previewDraft.travelMode ?? previewDraft.parsed?.travelMode ?? "TRANSIT",
            travelMinutes: previewDraft.travelMinutes ?? previewDraft.parsed?.travelMinutes,
            locationName: destination?.name || destination?.address || undefined,
            route: previewDraft.route ?? previewDraft.parsed?.route,
        });

        Keyboard.dismiss();
        setRoutePlannerSessionId(sessionId);
        setRoutePlannerHidden(true);
        setEditingField(null);
        setEditingValue("");
        setTimeEditMode("picker");
        setFlowStep("preview");
        setRendered(false);
        router.push({ pathname: "/schedule/route-select", params: { sessionId } });

        routePlannerFallbackTimerRef.current = setTimeout(() => {
            routePlannerFallbackTimerRef.current = null;
            if (routePlannerAwayRef.current) return;
            setRoutePlannerSessionId(undefined);
            setRoutePlannerHidden(false);
            setRendered(true);
            setContentMounted(true);
            progress.value = 1;
            contentProgress.value = 1;
            setEditingField("location");
            setFlowStep("edit");
        }, 1400);
    }, [contentProgress, previewDraft, progress, router, submitting]);

    useEffect(() => {
        if (
            !visible ||
            !routePlannerSessionId
        ) return;

        if (pathname === "/schedule/route-select" || pathname === "/schedule/route-planner") {
            routePlannerAwayRef.current = true;
            if (routePlannerFallbackTimerRef.current) {
                clearTimeout(routePlannerFallbackTimerRef.current);
                routePlannerFallbackTimerRef.current = null;
            }
            return;
        }

        if (!routePlannerAwayRef.current) return;

        const result = consumeRoutePlannerResult(routePlannerSessionId);
        routePlannerAwayRef.current = false;
        setRoutePlannerSessionId(undefined);
        setRoutePlannerHidden(false);
        setRendered(true);
        setContentMounted(true);
        closingRef.current = false;
        setIsClosingVisual(false);
        cancelAnimation(progress);
        cancelAnimation(contentProgress);
        progress.value = 1;
        contentProgress.value = 1;
        setEditingField(null);
        setEditingValue("");
        setTimeEditMode("picker");
        setFlowStep("preview");

        if (result) {
            setPreviewDraft((current) => current ? applyRouteResultToPreviewDraft(current, result) : current);
        }
    }, [contentProgress, pathname, progress, routePlannerSessionId, visible]);

    const savePreview = async () => {
        if (!previewDraft || submitting) return;

        const startAtDate = dateFromDraftTime(previewDraft.date, previewDraft.time);
        const endAtDate = new Date(startAtDate.getTime() + 60 * 60 * 1000);
        const routeInfoForNotification = getPreviewDraftRouteInfo(previewDraft);
        const hasNotification = previewDraft.notificationLeadMinutes !== undefined && !!routeInfoForNotification;
        const destination = previewDraft.destination
            ?? placeFromDraftLocation(previewDraft.location)
            ?? previewDraft.parsed?.destination;
        const destinationName = displayPlaceName(destination);

        try {
            setSubmitting(true);
            setFlowStep("saving");
            await onSave({
                title: previewDraft.title.trim() || "새 일정",
                startAt: startAtDate.toISOString(),
                endAt: endAtDate.toISOString(),
                hasEndTime: false,
                allDay: false,
                category: defaultCategory,
                locationName: destinationName || undefined,
                destination,
                origin: previewDraft.origin ?? previewDraft.parsed?.origin,
                notes: previewDraft.memo.trim() && previewDraft.memo !== "메모 없음"
                    ? previewDraft.memo.trim()
                    : undefined,
                travelMinutes: previewDraft.travelMinutes ?? previewDraft.parsed?.travelMinutes,
                travelMode: previewDraft.travelMode ?? previewDraft.parsed?.travelMode,
                route: previewDraft.route ?? previewDraft.parsed?.route,
                notificationEnabled: hasNotification,
                notificationLeadMinutes: hasNotification ? previewDraft.notificationLeadMinutes : undefined,
                notificationIntervalMinutes: hasNotification ? previewDraft.parsed?.notificationIntervalMinutes ?? 20 : undefined,
            });
            setFlowStep("saved");
        } catch (error) {
            Alert.alert("일정 저장 실패", error instanceof Error ? error.message : "일정을 저장하지 못했습니다.");
            setFlowStep("preview");
        } finally {
            setSubmitting(false);
        }
    };

    const pickPhotoFromLibrary = useCallback(async () => {
        if (submitting) return;

        Keyboard.dismiss();
        stopActiveRecording();
        setInputMode("photo");

        try {
            const ImagePicker = await import("expo-image-picker");
            const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) {
                Alert.alert("사진 권한 필요", "사진으로 빠른 일정을 만들려면 사진 보관함 권한이 필요합니다.");
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images"],
                allowsMultipleSelection: false,
                quality: 0.85,
            });

            if (!result.canceled) {
                setSelectedPhoto(result.assets[0] ?? null);
            }
        } catch (error) {
            Alert.alert("사진 선택 실패", error instanceof Error ? error.message : "사진을 불러오지 못했습니다.");
        }
    }, [stopActiveRecording, submitting]);

    const capturePhoto = useCallback(async () => {
        if (submitting) return;

        Keyboard.dismiss();
        stopActiveRecording();
        setInputMode("photo");

        try {
            const ImagePicker = await import("expo-image-picker");
            const permission = await ImagePicker.requestCameraPermissionsAsync();
            if (!permission.granted) {
                Alert.alert("카메라 권한 필요", "사진을 촬영해 빠른 일정을 만들려면 카메라 권한이 필요합니다.");
                return;
            }

            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ["images"],
                allowsEditing: false,
                quality: 0.85,
            });

            if (!result.canceled) {
                setSelectedPhoto(result.assets[0] ?? null);
            }
        } catch (error) {
            Alert.alert("촬영 실패", error instanceof Error ? error.message : "카메라를 열지 못했습니다.");
        }
    }, [stopActiveRecording, submitting]);

    const activatePhotoMode = useCallback(() => {
        if (submitting) return;

        Keyboard.dismiss();
        stopActiveRecording();
        setInputMode("photo");
    }, [stopActiveRecording, submitting]);

    const openPhotoActionSheet = useCallback(() => {
        if (submitting) return;

        Keyboard.dismiss();
        stopActiveRecording();
        setInputMode("photo");

        if (Platform.OS === "ios") {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    title: "사진으로 일정 만들기",
                    options: ["사진 찍기", "사진 앱에서 선택", "취소"],
                    cancelButtonIndex: 2,
                    userInterfaceStyle: mode === "dark" ? "dark" : "light",
                },
                (buttonIndex) => {
                    if (buttonIndex === 0) {
                        runAfterInteraction(() => void capturePhoto());
                    }
                    if (buttonIndex === 1) {
                        runAfterInteraction(() => void pickPhotoFromLibrary());
                    }
                }
            );
            return;
        }

        void pickPhotoFromLibrary();
    }, [capturePhoto, mode, pickPhotoFromLibrary, stopActiveRecording, submitting]);

    const startVoiceRecording = useCallback(async () => {
        if (submitting || isVoiceRecording || audioRecordingRef.current) return;

        Keyboard.dismiss();
        setInputMode("voice");
        setSelectedPhoto(null);
        setVoiceUri(null);
        setVoiceDurationMillis(0);
        setVoiceMeterHistory(createVoiceMeterHistory());
        setVoiceSpectrumEnergy(0);
        clearVoiceTimer();

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
            startNativeAudioSpectrumSession();
            voiceTimerRef.current = setInterval(() => {
                const activeRecorder = audioRecordingRef.current;
                if (!activeRecorder) return;

                void activeRecorder.getStatusAsync()
                    .then((status) => {
                        if ("durationMillis" in status) {
                            setVoiceDurationMillis(status.durationMillis ?? 0);
                        }
                        const normalizedMetering = normalizeVoiceMetering(status.metering);
                        if (normalizedMetering !== null && !nativeSpectrumFrameSeenRef.current) {
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
            stopNativeAudioSpectrumSession();
            void Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
            }).catch(() => undefined);
            Alert.alert("녹음 시작 실패", "음성 녹음을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.");
        }
    }, [clearVoiceTimer, isVoiceRecording, startNativeAudioSpectrumSession, stopNativeAudioSpectrumSession, submitting]);

    const stopVoiceRecording = useCallback(async () => {
        stopActiveRecording(true);
    }, [stopActiveRecording]);

    const handleModePress = useCallback((nextMode: InputMode) => {
        if (nextMode === "photo") {
            activatePhotoMode();
            return;
        }

        if (nextMode === "voice") {
            if (inputMode !== "voice") {
                stopActiveRecording();
            }
            setInputMode("voice");
            return;
        }

        stopActiveRecording();
        setInputMode(nextMode);
    }, [
        activatePhotoMode,
        inputMode,
        stopActiveRecording,
    ]);

    useEffect(() => {
        return () => {
            stopActiveRecording();
            if (analysisTimerRef.current) {
                clearInterval(analysisTimerRef.current);
                analysisTimerRef.current = null;
            }
            if (routePlannerFallbackTimerRef.current) {
                clearTimeout(routePlannerFallbackTimerRef.current);
                routePlannerFallbackTimerRef.current = null;
            }
        };
    }, [stopActiveRecording]);

    useEffect(() => {
        const selectedLayout = modeLayouts[inputMode];
        if (!selectedLayout) return;

        modeIndicatorX.value = withSpring(selectedLayout.x, MODE_PILL_SPRING);
        modeIndicatorWidth.value = withSpring(selectedLayout.width, MODE_PILL_SPRING);
    }, [inputMode, modeIndicatorWidth, modeIndicatorX, modeLayouts]);

    useEffect(() => {
        expandedCardHeight.value = withSpring(cardHeight, CARD_SIZE_SPRING);
    }, [cardHeight, expandedCardHeight]);

    const cardMotionRadiusStyle = useAnimatedStyle(() => ({
        borderRadius: interpolate(
            progress.value,
            [0, 0.34, 0.68, 1],
            [sourceRadius, Math.max(34, sourceRadius + 10), 46, EXPANDED_CARD_RADIUS]
        ),
    }), [sourceRadius]);

    const cardClipRadiusStyle = useAnimatedStyle(() => ({
        borderRadius: interpolate(
            progress.value,
            [0, 0.34, 0.68, 1],
            [sourceRadius, Math.max(34, sourceRadius + 10), 46, EXPANDED_CARD_RADIUS]
        ),
    }), [sourceRadius]);

    const cardMotionStyle = useAnimatedStyle(() => {
        const finalHeight = expandedCardHeight.value;

        return {
            left: interpolate(
                progress.value,
                morphFrameRange,
                [
                    sourceLeft,
                    sourceRight - firstStretchWidth,
                    sourceRight - secondStretchWidth,
                    sourceRight - bridgeWidth,
                    sourceRight - bodyWidth,
                    sourceRight - nearFinalWidth,
                    cardLeft,
                ]
            ),
            top: interpolate(progress.value, [0, 1], [sourceTop, cardTop]),
            width: interpolate(
                progress.value,
                morphFrameRange,
                [
                    morphSourceWidth,
                    firstStretchWidth,
                    secondStretchWidth,
                    bridgeWidth,
                    bodyWidth,
                    nearFinalWidth,
                    cardWidth,
                ]
            ),
            height: interpolate(
                progress.value,
                morphFrameRange,
                [
                    morphSourceHeight,
                    firstStretchHeight,
                    secondStretchHeight,
                    bridgeHeight,
                    bodyHeight,
                    nearFinalHeight,
                    finalHeight,
                ]
            ),
        };
    }, [
        bridgeHeight,
        bridgeWidth,
        bodyHeight,
        bodyWidth,
        cardHeight,
        cardLeft,
        cardTop,
        cardWidth,
        firstStretchHeight,
        firstStretchWidth,
        morphFrameRange,
        nearFinalHeight,
        nearFinalWidth,
        secondStretchHeight,
        secondStretchWidth,
        sourceLeft,
        sourceRight,
        sourceTop,
        morphSourceHeight,
        morphSourceWidth,
        expandedCardHeight,
    ]);
    const backdropAnimatedStyle = useAnimatedStyle(() => ({
        opacity: interpolate(progress.value, [0, 0.62, 1], [0, 0.05, 1]),
    }));
    const seedAnimatedStyle = useAnimatedStyle(() => ({
        opacity: interpolate(
            progress.value,
            isClosingSeedVisual ? [0, 0.08, 0.22, 0.36, 1] : [0, 0.70, 0.88, 1],
            isClosingSeedVisual ? [1, 1, 0.36, 0, 0] : [1, 1, 0.44, 0],
            Extrapolation.CLAMP
        ),
    }), [isClosingSeedVisual]);
    const cardExitOpacityStyle = useAnimatedStyle(() => ({
        opacity: isClosingToToolbar
            ? interpolate(progress.value, [0, 0.08, 0.24], [0, 0.12, 1], Extrapolation.CLAMP)
            : 1,
    }), [isClosingToToolbar]);
    const contentAnimatedStyle = useAnimatedStyle(() => ({
        opacity: contentProgress.value,
        transform: [
            {
                translateY: interpolate(
                    contentProgress.value,
                    [0, 1],
                    [14, 0],
                    Extrapolation.CLAMP
                ),
            },
            {
                scale: interpolate(
                    contentProgress.value,
                    [0, 1],
                    [0.99, 1],
                    Extrapolation.CLAMP
                ),
            },
        ],
    }));
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
        ? "rgba(255,255,255,0.22)"
        : "rgba(255,255,255,0.86)";
    const cardSurfaceBackground = mode === "dark"
        ? "rgba(18,19,24,0.74)"
        : "rgba(255,255,255,0.82)";
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
                ? Boolean(selectedPhoto?.uri)
                : Boolean(voiceUri)
    ) && !submitting && !recorderState.isRecording;
    const flowTitle = flowStep === "input"
        ? "빠른 일정 만들기"
        : flowStep === "analyzing"
            ? "일정 미리보기"
            : flowStep === "saving"
                ? "일정 저장 중"
                : flowStep === "analysisError"
                    ? "분석 실패"
                    : flowStep === "saved"
                        ? "일정 저장 완료"
                        : flowStep === "edit" && editingField
                            ? editingField === "location" ? "이동 경로 설정" : `${FIELD_LABEL[editingField]} 수정`
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
                return formatKoreanTime(draft.time);
            case "notification":
                if (!canUseRouteNotification(draft)) return "경로 등록 후 사용";
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
            {INPUT_MODES.map((item) => {
                const selected = item.key === inputMode;

                return (
                    <Pressable
                        key={item.key}
                        onLayout={handleModeLayout(item.key)}
                        onPress={() => handleModePress(item.key)}
                        disabled={submitting || flowStep !== "input"}
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
                <Pressable
                    disabled={submitting}
                    onPress={openPhotoActionSheet}
                    style={[
                        styles.mediaPanel,
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
                            <Ionicons name="image-outline" size={36} color={BLUE} />
                        </View>
                    )}
                    <Text style={[styles.mediaPanelTitle, { color: colors.textPrimary }]}>
                        {selectedPhoto ? "사진 선택됨" : "사진 선택"}
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
                            accessibilityLabel="선택한 사진 제거"
                            onPress={(event) => {
                                event.stopPropagation();
                                setSelectedPhoto(null);
                            }}
                            style={({ pressed }) => [
                                styles.photoRemoveButton,
                                { opacity: pressed ? 0.72 : 1 },
                            ]}
                        >
                            <Ionicons name="close" size={16} color="#fff" />
                        </Pressable>
                    )}
                </Pressable>
            )}

            {inputMode === "voice" && (
                <Pressable
                    onPress={() => {
                        if (recorderState.isRecording) {
                            void stopVoiceRecording();
                            return;
                        }

                        void startVoiceRecording();
                    }}
                    disabled={submitting}
                    style={({ pressed }) => [
                        styles.voicePanel,
                        {
                            backgroundColor: mediaPanelBackground,
                            borderColor: recorderState.isRecording || voiceUri ? BLUE : cardBorderColor,
                            opacity: pressed ? 0.82 : 1,
                        },
                    ]}
                >
                    <View style={styles.voiceOrbWrap}>
                        {recorderState.isRecording && (
                            <>
                                <View
                                    pointerEvents="none"
                                    style={[
                                        styles.voiceSpectrumHalo,
                                        {
                                            opacity: 0.14 + voiceSpectrumEnergy * 0.22,
                                            transform: [{ scale: 1 + voiceSpectrumEnergy * 0.08 }],
                                        },
                                    ]}
                                />
                                <View pointerEvents="none" style={styles.voiceSpectrum}>
                                    {VOICE_SPECTRUM_BARS.map((barIndex) => {
                                        const angle = `${(360 / VOICE_SPECTRUM_BAR_COUNT) * barIndex}deg`;
                                        const level = voiceMeterHistory[barIndex] ?? 0;
                                        const height = getVoiceWaveformBarHeight(level);

                                        return (
                                            <View
                                                key={barIndex}
                                                style={[
                                                    styles.voiceSpectrumBarSlot,
                                                    { transform: [{ rotate: angle }] },
                                                ]}
                                            >
                                                <View
                                                    style={[
                                                        styles.voiceSpectrumBar,
                                                        {
                                                            height,
                                                            opacity: 0.22 + level * 0.72,
                                                        },
                                                    ]}
                                                />
                                            </View>
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
                                    borderColor: recorderState.isRecording || voiceUri
                                        ? BLUE
                                        : cardBorderColor,
                                },
                            ]}
                        >
                            <Ionicons
                                name={
                                    recorderState.isRecording
                                        ? "stop"
                                        : voiceUri
                                            ? "checkmark"
                                            : "mic-outline"
                                }
                                size={34}
                                color={recorderState.isRecording || voiceUri ? BLUE : colors.textPrimary}
                            />
                        </View>
                    </View>
                    <Text style={[styles.voiceTitle, { color: colors.textPrimary }]}>
                        {recorderState.isRecording
                            ? "듣고 있어요"
                            : voiceUri
                                ? "녹음 완료"
                                : "탭해서 녹음 시작"}
                    </Text>
                    <Text style={[styles.voiceMeta, { color: colors.textSecondary }]}>
                        {recorderState.isRecording || voiceUri
                            ? voiceDurationText
                            : "말로 일정 내용을 알려주세요."}
                    </Text>
                </Pressable>
            )}

            <Pressable
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
                    <ActivityIndicator size="small" color="#fff" />
                ) : (
                    <>
                        <Ionicons name="sparkles-outline" size={17} color="#fff" />
                        <Text style={styles.submitText}>일정 만들기</Text>
                    </>
                )}
            </Pressable>
        </>
    );

    const renderLoadingStep = () => {
        const isSaving = flowStep === "saving";

        return (
            <View style={styles.centerFlow}>
                <View style={[
                    styles.loadingIconWrap,
                    { backgroundColor: isSaving ? "rgba(36,107,254,0.10)" : "transparent" },
                ]}>
                    {isSaving ? (
                        <ActivityIndicator size="large" color={BLUE} />
                    ) : (
                        <Ionicons name="sparkles" size={42} color={BLUE} />
                    )}
                </View>
                <Text style={[styles.flowHeadline, { color: colors.textPrimary }]}>
                    {isSaving ? "일정을 저장하고 있어요" : "일정 정보를 분석하고 있어요"}
                </Text>
                <Text style={[styles.flowCaption, { color: colors.textSecondary }]}>
                    잠시만 기다려 주세요
                </Text>
                {!isSaving && (
                    <>
                        <View style={[styles.progressTrack, { backgroundColor: mode === "dark" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)" }]}>
                            <View style={[styles.progressFill, { width: `${analysisProgress}%` }]} />
                        </View>
                        <Text style={[styles.loadingPercent, { color: colors.textPrimary }]}>
                            {analysisProgress}%
                        </Text>
                    </>
                )}
            </View>
        );
    };

    const renderErrorStep = () => (
        <View style={styles.centerFlow}>
            <View style={[styles.statusIconWrap, { backgroundColor: warningBackground }]}>
                <Ionicons name="warning-outline" size={42} color={warningTextColor} />
            </View>
            <Text style={[styles.flowHeadline, { color: colors.textPrimary }]}>
                일정 정보를 분석하지 못했어요
            </Text>
            <Text numberOfLines={2} style={[styles.flowCaption, { color: colors.textSecondary }]}>
                {analysisError || "입력 내용을 확인한 뒤 다시 시도해 주세요"}
            </Text>
            <Pressable
                onPress={submit}
                disabled={submitting}
                style={({ pressed }) => [
                    styles.submitButton,
                    { alignSelf: "stretch", opacity: pressed ? 0.78 : 1 },
                ]}
            >
                <Text style={styles.submitText}>다시 시도</Text>
            </Pressable>
        </View>
    );

    const renderPreviewStep = () => {
        if (!previewDraft) return null;

        return (
            <View style={styles.previewStep}>
                <ScrollView
                    style={styles.previewScroll}
                    contentContainerStyle={styles.previewScrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    {PREVIEW_FIELDS.map((field) => {
                        const badge = field.key === "notification" && !canUseRouteNotification(previewDraft)
                            ? "경로 등록 필요"
                            : previewDraft.badges[field.key];
                        return (
                            <Pressable
                                key={field.key}
                                onPress={() => openEditField(field.key)}
                                disabled={submitting}
	                                style={[
	                                    styles.previewRow,
	                                    {
	                                        backgroundColor: previewRowBackground,
	                                        borderColor: cardBorderColor,
	                                    },
	                                ]}
	                            >
	                                <View style={styles.previewIcon}>
	                                    <Ionicons name={field.icon} size={17} color={previewIconColor} />
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
                                <Ionicons name="create-outline" size={17} color={colors.textSecondary} />
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
                        <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>수정하기</Text>
                    </Pressable>
	                    <Pressable
	                        onPress={savePreview}
                            accessibilityRole="button"
                        disabled={submitting}
                        style={({ pressed }) => [
                            styles.primaryButton,
                            { opacity: pressed ? 0.78 : 1 },
                        ]}
                    >
                        <Text style={styles.primaryButtonText}>일정 저장하기</Text>
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
        const pickerDateValue = editingField === "date"
            ? dateFromYmd(editingValue || previewDraft.date)
            : dateFromDraftTime(previewDraft.date, editingValue || previewDraft.time);
        const originValue = previewDraft.origin?.name ?? previewDraft.origin?.address ?? "";
        const destination = previewDraft.destination ?? placeFromDraftLocation(previewDraft.location);
        const destinationValue = destination?.name ?? destination?.address ?? previewDraft.location;
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
                        <LocationInputRow
                            originValue={originValue}
                            destinationValue={destinationValue === "장소 미정" ? "" : destinationValue}
                            travelMode={previewDraft.travelMode ?? previewDraft.parsed?.travelMode}
                            travelMinutes={previewDraft.travelMinutes ?? previewDraft.parsed?.travelMinutes}
                            routeInfo={previewRouteInfo}
                            onPress={openRoutePlannerFromPreview}
                        />
                        <View style={[styles.routeEditNotice, { backgroundColor: inputBackground, borderColor: cardBorderColor }]}>
                            <Ionicons name="navigate-outline" size={17} color={BLUE} />
                            <Text style={[styles.routeEditNoticeText, { color: colors.textSecondary }]}>
                                일정 등록과 같은 경로 설정 화면에서 출발지와 도착지를 선택해 주세요.
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
                                <Ionicons name="information-circle-outline" size={15} color={warningTextColor} />
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
                            <Ionicons name="navigate-outline" size={28} color={BLUE} />
                        </View>
                        <Text style={[styles.notificationRouteTitle, { color: colors.textPrimary }]}>
                            경로 등록이 필요해요
                        </Text>
                        <Text style={[styles.notificationRouteBody, { color: colors.textSecondary }]}>
                            NoLate 알림은 이동 경로와 교통 상황을 기준으로 출발 시간을 알려주는 푸시 알림입니다.
                        </Text>
                    </View>
                )}
                {isNotificationEdit && notificationRouteReady && (
                    <View style={styles.notificationOptions}>
                        {NOTIFICATION_OPTIONS.map((option) => {
                            const selected = editingValue === option.value;
                            return (
                                <Pressable
                                    key={option.value}
                                    onPress={() => setEditingValue(option.value)}
                                    style={[
                                        styles.notificationChip,
                                        {
                                            backgroundColor: selected ? selectedModeBackground : inputBackground,
                                            borderColor: selected ? BLUE : cardBorderColor,
                                        },
                                    ]}
                                >
                                    <Text style={[
                                        styles.notificationChipText,
                                        { color: selected ? BLUE : colors.textPrimary },
                                    ]}>
                                        {option.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
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
                        <Text style={[styles.secondaryButtonText, { color: colors.textPrimary }]}>취소</Text>
                    </Pressable>
	                    <Pressable
	                        onPress={isLocationEdit || notificationNeedsRoute ? openRoutePlannerFromPreview : confirmEditField}
                            accessibilityRole="button"
                        style={({ pressed }) => [
                            styles.primaryButton,
                            { opacity: pressed ? 0.78 : 1 },
                        ]}
                    >
                        <Text style={styles.primaryButtonText}>
                            {isLocationEdit ? "경로 등록 열기" : notificationNeedsRoute ? "경로 등록하기" : "확인"}
                        </Text>
                    </Pressable>
                </View>
            </View>
        );
    };

    const renderSavedStep = () => (
        <View style={styles.centerFlow}>
            <View style={[styles.statusIconWrap, { backgroundColor: "rgba(34,197,94,0.15)" }]}>
                <Ionicons name="checkmark" size={46} color={successColor} />
            </View>
            <Text style={[styles.flowHeadline, { color: colors.textPrimary }]}>
                일정이 저장되었습니다!
            </Text>
            <View style={styles.savedButtonStack}>
                <Pressable
                    onPress={requestClose}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                        styles.secondaryButton,
                        {
                            alignSelf: "stretch",
                            flex: 0,
                            backgroundColor: inputBackground,
                            borderColor: cardBorderColor,
                            opacity: pressed ? 0.72 : 1,
                        },
                    ]}
                >
                    <Text style={[styles.secondaryButtonText, { color: colors.textSecondary }]}>
                        캘린더에서 보기
                    </Text>
                </Pressable>
                <Pressable
                    onPress={requestClose}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                        styles.submitButton,
                        { alignSelf: "stretch", opacity: pressed ? 0.78 : 1 },
                    ]}
                >
                    <Text style={styles.submitText}>확인</Text>
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

    if (routePlannerHidden) {
        return null;
    }

    return (
        <Modal visible={visible || rendered} transparent animationType="none" onRequestClose={requestClose}>
            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                style={styles.screen}
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
                <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} />

                <Reanimated.View
                    style={[
                        styles.cardMotion,
                        cardMotionStyle,
                        cardMotionRadiusStyle,
                        cardExitOpacityStyle,
                    ]}
                >
                    <Reanimated.View
                        style={[
                            styles.cardClip,
                            cardClipRadiusStyle,
                            {
                                backgroundColor: cardSurfaceBackground,
                                borderColor: cardBorderColor,
                            },
                        ]}
                    >
                        <View style={styles.card}>
                            <CalendarGlassSurface
                                pointerEvents="none"
                                variant="bottomBar"
                                tone="softGlass"
                                clear
                                prominent
                                glow
                                style={styles.nativeGlassFill}
                            />
                            <View
                                pointerEvents="none"
                                style={[
                                    styles.glassMilkyFill,
                                    {
                                        backgroundColor: mode === "dark"
                                            ? "rgba(20,21,26,0.20)"
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
                                            ? "rgba(255,255,255,0.20)"
                                            : "rgba(255,255,255,0.82)",
                                    },
                                ]}
                            />
                            <View
                                pointerEvents="none"
                                style={[
                                    styles.glassRefractionBand,
                                    {
                                        backgroundColor: mode === "dark"
                                            ? "rgba(255,255,255,0.12)"
                                            : "rgba(255,255,255,0.54)",
                                    },
                                ]}
                            />
                            <View
                                pointerEvents="none"
                                style={[
                                    styles.glassLowerShade,
                                    {
                                        backgroundColor: mode === "dark"
                                            ? "rgba(0,0,0,0.14)"
                                            : "rgba(255,255,255,0.18)",
                                    },
                                ]}
                            />
                            <View pointerEvents="none" style={styles.cardSheen} />
                            <Reanimated.View
                                pointerEvents="none"
                                style={[
                                    styles.seedContent,
                                    seedAnimatedStyle,
                                ]}
                            >
                                {visibleSeedContent === "toolbar" ? (
                                    <>
                                        <Ionicons name="reorder-two-outline" size={26} color={colors.textPrimary} />
                                        <Ionicons name="search" size={23} color={colors.textPrimary} />
                                        <Ionicons name="add" size={27} color={colors.textPrimary} />
                                    </>
                                ) : null}
                            </Reanimated.View>
                            <Reanimated.View
                                style={[
                                    styles.content,
                                    contentAnimatedStyle,
                                ]}
                            >
                                {contentMounted && (
                                    <>
                                        <Pressable
                                            accessibilityLabel="빠른 일정 등록 닫기"
                                            disabled={submitting}
                                            onPress={requestClose}
                                            hitSlop={10}
                                            style={({ pressed }) => [
                                                styles.closeButton,
                                                { opacity: pressed ? 0.58 : 1 },
                                            ]}
                                        >
                                            <Ionicons name="close" size={22} color={colors.textSecondary} />
                                        </Pressable>

                                        <View style={styles.header}>
                                            {flowStep === "edit" && (
                                                <Pressable
                                                    accessibilityLabel="일정 미리보기로 돌아가기"
                                                    onPress={cancelEditField}
                                                    hitSlop={10}
                                                    style={({ pressed }) => [
                                                        styles.backButton,
                                                        { opacity: pressed ? 0.58 : 1 },
                                                    ]}
                                                >
                                                    <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
                                                </Pressable>
                                            )}
                                            <Text style={[styles.title, { color: colors.textPrimary }]}>{flowTitle}</Text>
                                        </View>

                                        {renderCurrentStep()}
                                    </>
                                )}
	                        </Reanimated.View>
	                    </View>
	                </Reanimated.View>
                </Reanimated.View>
	            </KeyboardAvoidingView>
	        </Modal>
	    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        zIndex: 80,
        elevation: 80,
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    cardMotion: {
        position: "absolute",
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
        borderWidth: 1,
        overflow: "hidden",
    },
    card: {
        width: "100%",
        height: "100%",
    },
    nativeGlassFill: {
        ...StyleSheet.absoluteFillObject,
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
    seedContent: {
        ...StyleSheet.absoluteFillObject,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-around",
        paddingHorizontal: 13,
    },
    addMenuSeed: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "flex-end",
        justifyContent: "flex-start",
        paddingHorizontal: 10,
        paddingVertical: 12,
        gap: 4,
    },
    addMenuSeedRow: {
        width: 218,
        maxWidth: "100%",
        height: 43,
        borderRadius: 18,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 12,
    },
    addMenuSeedText: {
        fontSize: 16,
        fontWeight: "700",
    },
    hiddenContent: {
        opacity: 0,
    },
    content: {
        flex: 1,
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
        marginTop: 13,
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
    voicePanel: {
        minHeight: 176,
        borderRadius: 20,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 20,
        paddingVertical: 14,
        marginBottom: 13,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 9 },
        shadowOpacity: 0.06,
        shadowRadius: 18,
    },
    voiceOrbWrap: {
        width: 138,
        height: 138,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 2,
    },
    voiceSpectrum: {
        position: "absolute",
        width: VOICE_SPECTRUM_SIZE,
        height: VOICE_SPECTRUM_SIZE,
        borderRadius: VOICE_SPECTRUM_SIZE / 2,
    },
    voiceSpectrumHalo: {
        position: "absolute",
        width: 106,
        height: 106,
        borderRadius: 53,
        backgroundColor: "rgba(36,107,254,0.26)",
        shadowColor: BLUE,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.34,
        shadowRadius: 24,
    },
    voiceSpectrumBarSlot: {
        position: "absolute",
        left: VOICE_SPECTRUM_SIZE / 2 - 1.5,
        top: 0,
        width: 3,
        height: VOICE_SPECTRUM_SIZE,
        alignItems: "center",
    },
    voiceSpectrumBar: {
        width: 3,
        minHeight: 5,
        borderRadius: 2,
        backgroundColor: BLUE,
        shadowColor: BLUE,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.22,
        shadowRadius: 5,
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
    centerFlow: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 8,
        gap: 10,
    },
    loadingIconWrap: {
        width: 82,
        height: 82,
        borderRadius: 41,
        alignItems: "center",
        justifyContent: "center",
    },
    loadingPercent: {
        marginTop: 2,
        fontSize: 12,
        fontWeight: "900",
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
    progressTrack: {
        width: "82%",
        height: 6,
        borderRadius: 3,
        overflow: "hidden",
        marginTop: 16,
    },
    progressFill: {
        height: "100%",
        borderRadius: 3,
        backgroundColor: BLUE,
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
    notificationOptions: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 9,
    },
    notificationChip: {
        minHeight: 42,
        borderRadius: 15,
        borderWidth: 1,
        paddingHorizontal: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    notificationChipText: {
        fontSize: 13,
        fontWeight: "900",
    },
    notificationRouteRequired: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 22,
        gap: 10,
    },
    notificationRouteIcon: {
        width: 70,
        height: 70,
        borderRadius: 35,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 4,
    },
    notificationRouteTitle: {
        fontSize: 17,
        fontWeight: "900",
        textAlign: "center",
    },
    notificationRouteBody: {
        fontSize: 12.5,
        lineHeight: 18,
        fontWeight: "700",
        textAlign: "center",
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
