import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    BackHandler,
    Pressable,
    ScrollView,
    Switch,
    Text,
    TextInput,
    View,
    Platform,
    StyleSheet,
    Animated,
    PanResponder,
    useWindowDimensions,
} from "react-native";
import Reanimated, {
    cancelAnimation,
    Easing as ReanimatedEasing,
    Extrapolation,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { Calendar } from "react-native-calendars";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Place, ScheduleCategory, ScheduleItem, ScheduleParseResult, TravelMode } from "../../types";
import { getWritableScheduleCategories } from "../../categoryPermissions";
import { searchAddressByKeyword } from "../../../map/tmapApi";
import { useTheme } from "../../../theme/ThemeContext";
import CalendarGlassSurface from "../calendar/CalendarGlassSurface";
import {
    buildRoutePlannerPlace,
    buildScheduleRoutePlannerInitial,
    consumeRoutePlannerResult,
    observeRoutePlannerReturn,
    setRoutePlannerInitial,
} from "../../routePlannerSession";
import { getRouteInfoFromRoute } from "../../routeInfo";
import {
    hasPersistableScheduleRoute,
    reconcileScheduleRouteTiming,
} from "../../scheduleRouteTiming";
import CategoryPickerRow from "./CategorySelectBox";
import LocationInputRow from "./LocationInputRow";
import NotificationSettingsCard from "./NotificationSettingsCard";
import CategoryLoadErrorBanner from "./CategoryLoadErrorBanner";
import {
    ADD_HANDOFF_MOTION,
    ADD_MENU_SOURCE,
    lerpAddHandoffValue,
    resolveAddHandoffCloseDuration,
} from "../../addHandoffMotion";
import {
    FREE_SUBSCRIPTION_POLICY,
    getMySubscriptionPolicy,
    type SubscriptionPolicy,
} from "../../../../api/subscription";
import {
    formatScheduleFormDate,
    getDefaultScheduleFormStart,
    getDefaultScheduleStartTime,
    getScheduleCalendarDateKey,
    normalizeScheduleFormRange,
    startOfLocalScheduleDay,
} from "../../scheduleFormDate";
import { getScheduleAddCloseAction } from "../../scheduleAddCloseGuard";
import {
    buildScheduleFormLocationName,
    buildScheduleFormPlace,
} from "../../scheduleFormPlace";

type Props = {
    visible: boolean;
    prewarm?: boolean;
    onClose: () => void;
    onSubmit: (payload: Omit<ScheduleItem, "id">) => void | Promise<void>;
    categories: ScheduleCategory[];
    defaultDay: string;
    initialValues?: ScheduleParseResult | null;
    categoryError?: string | null;
    categoryLoading?: boolean;
    onRetryCategories?: () => void;
    onManageCategories?: () => void;
    onCloseStart?: () => void;
    presentation?: "sheet" | "morph";
    sourceTopOffset?: number;
    sourceWidth?: number;
    sourceHeight?: number;
    sourceRightOffset?: number;
    closeTargetWidth?: number;
    onMorphReady?: () => void;
    morphPresenterRef?: React.MutableRefObject<ScheduleAddMorphPresenter | null>;
};

export type ScheduleAddMorphPresenter = () => boolean;

type CloseSheetOptions = {
    notifyCloseStart?: boolean;
};

const PREWARM_PRESENTATION_OPACITY = 0.001;

const pad2 = (n: number) => String(n).padStart(2, "0");

// 기준 날짜 객체의 연월일을 입력 문자열로 교체한다.
function setYmd(base: Date, ymd: string) {
    const [y, m, d] = ymd.split("-").map(Number);
    const next = new Date(base);
    next.setFullYear(y, m - 1, d);
    return next;
}

// 날짜 객체와 시간 객체를 하나의 일정 시각으로 합친다.
function mergeDateTime(datePart: Date, timePart: Date) {
    const d = new Date(datePart);
    d.setHours(timePart.getHours(), timePart.getMinutes(), 0, 0);
    return d;
}

function hhmmText(d: Date) {
    const hour = d.getHours();
    return `${hour < 12 ? "오전" : "오후"} ${hour % 12 || 12}:${pad2(d.getMinutes())}`;
}

const SHEET_HIDDEN_Y = 900;
const SHEET_CLOSE_DISTANCE = 118;
const SHEET_CLOSE_VELOCITY = 0.85;
const SHEET_VELOCITY_PROJECTION = 120;
const MORPH_OPEN_START_PROGRESS = 0;
const MORPH_OPEN_DURATION_MS = ADD_HANDOFF_MOTION.manualOpenMs;
const MORPH_SOURCE_WIDTH = 238;
const MORPH_SOURCE_HEIGHT = 164;
const MORPH_CLOSE_TARGET_WIDTH = 150;
const MORPH_CLOSE_TARGET_HEIGHT = 44;
const MORPH_TARGET_HEIGHT_RATIO = 0.58;
const MORPH_TARGET_MIN_HEIGHT = 520;
const MORPH_TARGET_MAX_HEIGHT = 580;
const SHEET_TARGET_HEIGHT_RATIO = 0.7;
const SHEET_TARGET_MAX_HEIGHT = 600;
const DATE_H         = 312;
const TIME_H         = 216;

type PickerType = "startDate" | "endDate" | "startTime" | "endTime";

const isDateType = (t: PickerType | null): boolean =>
    t === "startDate" || t === "endDate";

const pickerTargetH = (t: PickerType | null): number =>
    t !== null && isDateType(t) ? DATE_H : TIME_H;

const clampSheetY = (value: number) => Math.min(Math.max(value, 0), SHEET_HIDDEN_Y);

const hasPlaceCoords = (place: Place | null | undefined) =>
    typeof place?.lat === "number" && Number.isFinite(place.lat) &&
    typeof place.lng === "number" && Number.isFinite(place.lng);

function cleanOptionalText(value?: string | null) {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}

function getDisplayPlaceText(place?: Place | null) {
    return cleanOptionalText(place?.name) ?? cleanOptionalText(place?.address) ?? "";
}

function uniqueNonBlank(values: Array<string | undefined | null>) {
    return Array.from(
        new Set(
            values
                .map((value) => value?.trim())
                .filter((value): value is string => Boolean(value))
        )
    );
}

// 새 일정을 입력하고 저장하는 바텀시트 화면을 렌더링한다.
export default function ScheduleNewModal({
    visible,
    prewarm = false,
    onClose,
    onSubmit,
    categories,
    defaultDay,
    initialValues,
    categoryError,
    categoryLoading = false,
    onRetryCategories,
    onManageCategories,
    onCloseStart,
    presentation = "sheet",
    sourceTopOffset = 4,
    sourceWidth = MORPH_SOURCE_WIDTH,
    sourceHeight = MORPH_SOURCE_HEIGHT,
    sourceRightOffset = 16,
    closeTargetWidth = MORPH_CLOSE_TARGET_WIDTH,
    onMorphReady,
    morphPresenterRef,
}: Props) {
    const router = useRouter();
    const pathname = usePathname();
    const { colors, mode } = useTheme();
    const insets = useSafeAreaInsets();
    const { width: screenWidth, height: screenHeight } = useWindowDimensions();
    const isMorphPresentation = presentation === "morph";
    const writableCategories = useMemo(
        () => getWritableScheduleCategories(categories),
        [categories]
    );
    const [title, setTitle]                           = useState("");
    const [notes, setNotes]                           = useState("");
    const [selectedCategoryId, setSelectedCategoryId] = useState(writableCategories[0]?.id ?? "");
    const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
    const [originText, setOriginText]                 = useState("");
    const [destinationText, setDestinationText]       = useState("");
    const [originAddress, setOriginAddress]           = useState<string | undefined>();
    const [destinationAddress, setDestinationAddress] = useState<string | undefined>();
    const [originLat, setOriginLat]                   = useState<number | undefined>();
    const [originLng, setOriginLng]                   = useState<number | undefined>();
    const [destinationLat, setDestinationLat]         = useState<number | undefined>();
    const [destinationLng, setDestinationLng]         = useState<number | undefined>();
    const [travelMode, setTravelMode]                 = useState<TravelMode>("CAR");
    const [travelMinutes, setTravelMinutes]           = useState<number | undefined>();
    const [departAt, setDepartAt]                     = useState<string | undefined>();
    const [route, setRoute]                           = useState<unknown>();
    const [allDay, setAllDay]                         = useState(false);
    const [hasEndTime, setHasEndTime]                 = useState(false);
    const [notificationEnabled, setNotificationEnabled] = useState(false);
    const [notificationLeadMinutes, setNotificationLeadMinutes] = useState(60);
    const [notificationIntervalMinutes, setNotificationIntervalMinutes] = useState(20);
    const [subscriptionPolicy, setSubscriptionPolicy] = useState<SubscriptionPolicy>(FREE_SUBSCRIPTION_POLICY);
    const [routePlannerSessionId, setRoutePlannerSessionId] = useState<string | undefined>();
    const routePlannerAwayRef = useRef(false);
    const routeTimingTargetArrivalRef = useRef<string | undefined>(undefined);
    const pendingRouteTimingTargetArrivalRef = useRef<string | undefined>(undefined);
    const [submitting, setSubmitting]                 = useState(false);
    const [formError, setFormError]                   = useState<string | null>(null);
    const [routePlannerHidden, setRoutePlannerHidden] = useState(false);
    const [rendered, setRendered] = useState(visible || prewarm);
    const [morphContentMounted, setMorphContentMounted] = useState(
        !isMorphPresentation || visible || prewarm
    );
    const [morphSheetRasterized, setMorphSheetRasterized] = useState(
        isMorphPresentation && (visible || prewarm)
    );
    const formDirtyRef = useRef(false);
    const closePromptVisibleRef = useRef(false);
    const submitInFlightRef = useRef(false);

    const markFormDirty = useCallback(() => {
        formDirtyRef.current = true;
    }, []);

    const discardDraft = useCallback(() => {
        formDirtyRef.current = false;
        closePromptVisibleRef.current = false;
    }, []);

    const [startDay,  setStartDay]  = useState(() => new Date(`${defaultDay}T00:00:00`));
    const [endDay,    setEndDay]    = useState(() => new Date(`${defaultDay}T00:00:00`));
    const [startTime, setStartTime] = useState(() => getDefaultScheduleStartTime());
    const [endTime, setEndTime] = useState(() => getDefaultScheduleStartTime());
    const wasVisibleRef = useRef(false);
    const destinationResolutionSequenceRef = useRef(0);

    const resetFormForNewSchedule = useCallback(() => {
        discardDraft();
        const defaultStart = getDefaultScheduleFormStart(defaultDay);
        setTitle("");
        setNotes("");
        setSelectedCategoryId(writableCategories[0]?.id ?? "");
        setCategoryPickerOpen(false);
        setOriginText("");
        setDestinationText("");
        setOriginAddress(undefined);
        setDestinationAddress(undefined);
        setOriginLat(undefined);
        setOriginLng(undefined);
        setDestinationLat(undefined);
        setDestinationLng(undefined);
        setTravelMode("CAR");
        setTravelMinutes(undefined);
        setDepartAt(undefined);
        setRoute(undefined);
        routeTimingTargetArrivalRef.current = undefined;
        pendingRouteTimingTargetArrivalRef.current = undefined;
        setAllDay(false);
        setHasEndTime(false);
        setNotificationEnabled(false);
        setNotificationLeadMinutes(60);
        setNotificationIntervalMinutes(30);
        setRoutePlannerSessionId(undefined);
        setSubmitting(false);
        submitInFlightRef.current = false;
        setFormError(null);
        setRoutePlannerHidden(false);
        setPicker(null);
        setDisplayPicker(null);
        setStartDay(defaultStart.startDay);
        setEndDay(new Date(defaultStart.startDay));
        setStartTime(defaultStart.startTime);
        setEndTime(new Date(defaultStart.startTime));
    }, [defaultDay, discardDraft, writableCategories]);

    // 실제 선택값과 화면 표시값을 분리해 피커 전환 애니메이션을 안정화한다.
    const [picker,        setPicker]        = useState<PickerType | null>(null);
    const [displayPicker, setDisplayPicker] = useState<PickerType | null>(null);

    useEffect(() => {
        setStartDay((prev) => setYmd(prev, defaultDay));
        setEndDay((prev)   => setYmd(prev, defaultDay));
    }, [defaultDay]);

    useEffect(() => {
        if (writableCategories.length === 0) return;
        setSelectedCategoryId((current) =>
            writableCategories.some((categoryItem) => categoryItem.id === current)
                ? current
                : writableCategories[0].id
        );
    }, [writableCategories]);

    useEffect(() => {
        if (hasEndTime || allDay) return;
        setEndDay(new Date(startDay));
        setEndTime(new Date(startTime));
    }, [allDay, hasEndTime, startDay, startTime]);

    const handleEndTimeEnabledChange = useCallback((enabled: boolean) => {
        markFormDirty();
        setHasEndTime(enabled);

        if (!enabled) {
            setPicker((current) => (
                current === "endDate" || current === "endTime" ? null : current
            ));
            setEndDay(new Date(startDay));
            setEndTime(new Date(startTime));
            return;
        }

        const nextEnd = mergeDateTime(startDay, startTime);
        nextEnd.setMinutes(nextEnd.getMinutes() + 60);
        setEndDay(nextEnd);
        setEndTime(nextEnd);
    }, [markFormDirty, startDay, startTime]);

    const handleAllDayChange = useCallback((enabled: boolean) => {
        markFormDirty();
        setAllDay(enabled);
        setHasEndTime(false);
        setPicker((current) => (
            current === "startTime" || current === "endTime" ? null : current
        ));
        setEndDay(new Date(startDay));
        setEndTime(new Date(startTime));
    }, [markFormDirty, startDay, startTime]);

    useEffect(() => {
        const opening = visible && !wasVisibleRef.current;
        wasVisibleRef.current = visible;

        if (!visible || (opening && !initialValues)) {
            resetFormForNewSchedule();
        }
    }, [initialValues, resetFormForNewSchedule, visible]);

    useEffect(() => {
        if (!visible) return;

        if (!initialValues) {
            return;
        }

        markFormDirty();
        setAllDay(false);
        setTitle(initialValues.title ?? "");
        setNotes(initialValues.notes ?? "");

        const parsedOrigin = initialValues.origin;
        setOriginText(getDisplayPlaceText(parsedOrigin));
        setOriginAddress(parsedOrigin?.address);
        setOriginLat(parsedOrigin?.lat);
        setOriginLng(parsedOrigin?.lng);
        setDestinationText(getDisplayPlaceText(initialValues.destination));
        setDestinationAddress(initialValues.destination?.address);
        setDestinationLat(initialValues.destination?.lat);
        setDestinationLng(initialValues.destination?.lng);
        setTravelMinutes(initialValues.travelMinutes);
        setTravelMode(initialValues.travelMode ?? "CAR");
        setDepartAt(undefined);
        setRoute(initialValues.route);
        setNotificationEnabled(Boolean(initialValues.notificationEnabled));
        if (typeof initialValues.notificationLeadMinutes === "number") {
            setNotificationLeadMinutes(initialValues.notificationLeadMinutes);
        }
        if (typeof initialValues.notificationIntervalMinutes === "number") {
            setNotificationIntervalMinutes(initialValues.notificationIntervalMinutes);
        }

        const parsedStart = initialValues.startAt ? new Date(initialValues.startAt) : null;
        if (parsedStart && !Number.isNaN(parsedStart.getTime())) {
            setStartDay(parsedStart);
            setStartTime(parsedStart);
            routeTimingTargetArrivalRef.current = initialValues.route
                ? parsedStart.toISOString()
                : undefined;
        } else {
            routeTimingTargetArrivalRef.current = undefined;
        }
        pendingRouteTimingTargetArrivalRef.current = undefined;

        const parsedEnd = initialValues.endAt ? new Date(initialValues.endAt) : null;
        if (parsedEnd && !Number.isNaN(parsedEnd.getTime())) {
            setEndDay(parsedEnd);
            setEndTime(parsedEnd);
            // Parse API v1 generated endAt from the default duration even when the
            // user never entered an end. Missing explicit-end metadata is therefore
            // a backward-compatible false, not something inferred from timestamps.
            setHasEndTime(Boolean(initialValues.hasExplicitEndTime));
        } else {
            setHasEndTime(false);
        }
    }, [initialValues, markFormDirty, visible]);

    useEffect(() => {
        const resolutionSequence = destinationResolutionSequenceRef.current + 1;
        destinationResolutionSequenceRef.current = resolutionSequence;
        if (!visible || !initialValues?.destination || hasPlaceCoords(initialValues.destination)) return;

        const parsedDestinationName = cleanOptionalText(initialValues.destination.name);
        const parsedDestinationAddress = cleanOptionalText(initialValues.destination.address);
        const queries = uniqueNonBlank([parsedDestinationAddress, parsedDestinationName]);
        if (queries.length === 0) return;

        let cancelled = false;
        const resolveDestination = async () => {
            for (const query of queries) {
                const items = await searchAddressByKeyword(query).catch(() => []);
                if (cancelled || destinationResolutionSequenceRef.current !== resolutionSequence) return;

                const match = items[0];
                if (!match) continue;

                setDestinationText((current) =>
                    current.trim() || parsedDestinationName || match.name || parsedDestinationAddress || ""
                );
                setDestinationAddress(parsedDestinationAddress || match.address);
                setDestinationLat(match.lat);
                setDestinationLng(match.lng);
                return;
            }
        };

        resolveDestination();

        return () => {
            cancelled = true;
            if (destinationResolutionSequenceRef.current === resolutionSequence) {
                destinationResolutionSequenceRef.current += 1;
            }
        };
    }, [
        initialValues?.destination,
        initialValues?.destination?.address,
        initialValues?.destination?.lat,
        initialValues?.destination?.lng,
        initialValues?.destination?.name,
        visible,
    ]);

    useEffect(() => {
        let cancelled = false;
        getMySubscriptionPolicy()
            .then((policy) => {
                if (cancelled) return;
                setSubscriptionPolicy(policy);
                setNotificationLeadMinutes((current) =>
                    Math.min(current, policy.maxNotificationLeadMinutes)
                );
                setNotificationIntervalMinutes((current) =>
                    Math.max(current, policy.minEtaRefreshIntervalMinutes)
                );
            })
            .catch(() => {
                if (!cancelled) setSubscriptionPolicy(FREE_SUBSCRIPTION_POLICY);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const category = useMemo(
        () => writableCategories.find((c) => c.id === selectedCategoryId) ?? writableCategories[0],
        [selectedCategoryId, writableCategories]
    );
    const routeInfo = useMemo(() => getRouteInfoFromRoute(route, {
        origin: originText.trim() || originAddress || typeof originLat === "number"
            ? { name: originText.trim() || originAddress || "출발지", address: originAddress, lat: originLat, lng: originLng }
            : undefined,
        destination: destinationText.trim() || destinationAddress || typeof destinationLat === "number"
            ? { name: destinationText.trim() || destinationAddress || "도착지", address: destinationAddress, lat: destinationLat, lng: destinationLng }
            : undefined,
        travelMode,
        travelMinutes,
    }), [
        destinationAddress,
        destinationLat,
        destinationLng,
        destinationText,
        originAddress,
        originLat,
        originLng,
        originText,
        route,
        travelMinutes,
        travelMode,
    ]);
    const routeReady = !!routeInfo;

    // 날짜/시간 필드를 열거나 같은 필드를 다시 눌러 닫는다.
    const togglePicker = useCallback((type: PickerType) => {
        setPicker((prev) => (prev === type ? null : type));
    }, []);

    // 날짜/시간 피커의 높이와 투명도 전환을 관리한다.
    const heightAnim   = useRef(new Animated.Value(0)).current;
    const outerOpacity = useRef(new Animated.Value(0)).current;
    const contentFade  = useRef(new Animated.Value(1)).current;
    const prevPickerRef = useRef<PickerType | null>(null);

    useEffect(() => {
        const prev = prevPickerRef.current;
        prevPickerRef.current = picker;

        if (picker !== null && prev === null) {
            // 피커를 처음 열 때 높이와 투명도를 함께 올린다.
            setDisplayPicker(picker);
            Animated.parallel([
                Animated.spring(heightAnim, {
                    toValue: pickerTargetH(picker),
                    useNativeDriver: false,
                    damping: 18, stiffness: 160, mass: 0.8,
                }),
                Animated.timing(outerOpacity, {
                    toValue: 1, duration: 200, useNativeDriver: false,
                }),
            ]).start();

        } else if (picker === null && prev !== null) {
            // 피커를 닫을 때 컨테이너 높이를 접는다.
            Animated.parallel([
                Animated.timing(heightAnim,   { toValue: 0, duration: 220, useNativeDriver: false }),
                Animated.timing(outerOpacity, { toValue: 0, duration: 180, useNativeDriver: false }),
            ]).start(({ finished }) => {
                if (finished) setDisplayPicker(null);
            });

        } else if (picker !== null && prev !== null) {
            if (isDateType(picker) !== isDateType(prev)) {
                // 날짜 피커와 시간 피커가 바뀔 때 콘텐츠를 페이드 전환한다.
                Animated.timing(contentFade, {
                    toValue: 0, duration: 120, useNativeDriver: false,
                }).start(({ finished }) => {
                    if (!finished) return;
                    setDisplayPicker(picker);
                    Animated.parallel([
                        Animated.spring(heightAnim, {
                            toValue: pickerTargetH(picker),
                            useNativeDriver: false,
                            damping: 18, stiffness: 160, mass: 0.8,
                        }),
                        Animated.timing(contentFade, {
                            toValue: 1, duration: 220, useNativeDriver: false,
                        }),
                    ]).start();
                });
            } else {
                // 시작/종료처럼 같은 타입끼리는 내용만 교체한다.
                setDisplayPicker(picker);
            }
        }
    }, [picker, contentFade, heightAnim, outerOpacity]);

    // 새 일정 바텀시트의 열림/닫힘 위치를 관리한다.
    const posY       = useRef(new Animated.Value(SHEET_HIDDEN_Y)).current;
    const morphProgress = useSharedValue(0);
    const morphClosingPhase = useSharedValue(0);
    const morphPresentationOpacity = useSharedValue(
        isMorphPresentation && visible && !prewarm
            ? 1
            : PREWARM_PRESENTATION_OPACITY
    );
    const morphPresentationStyle = useAnimatedStyle(() => ({
        opacity: morphPresentationOpacity.value,
    }));
    const morphSeedPaintFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
    const morphCloseFinishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

    const startMorphOpenAnimation = useCallback((openCycle: number) => {
        if (
            !isMorphPresentation ||
            !visibleRef.current ||
            openCycle !== morphOpenCycleRef.current ||
            morphOpenStartedRef.current ||
            closingRef.current
        ) return;

        morphOpenStartedRef.current = true;
        // Start geometry and ownership on the same UI-thread clock, matching
        // quick create and avoiding a stationary blank surface after selection.
        morphPresentationOpacity.value = withTiming(1, {
            duration: ADD_HANDOFF_MOTION.ownershipCrossfadeMs,
            easing: ReanimatedEasing.linear,
        });
        morphProgress.value = withTiming(1, {
            duration: Math.round(MORPH_OPEN_DURATION_MS * (1 - MORPH_OPEN_START_PROGRESS)),
            easing: ReanimatedEasing.bezier(...ADD_HANDOFF_MOTION.openBezier),
        });
        onMorphReadyRef.current?.();
    }, [
        isMorphPresentation,
        morphPresentationOpacity,
        morphProgress,
    ]);

    const presentPrewarmedMorph = useCallback(() => {
        if (
            !isMorphPresentation ||
            !prewarm ||
            !rendered ||
            !morphContentMounted ||
            routePlannerHidden ||
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

    const scheduleMorphOpenAfterPaint = useCallback((openCycle: number) => {
        if (
            !visibleRef.current ||
            morphOpenStartedRef.current ||
            closingRef.current ||
            morphSeedPaintFrameRef.current !== null
        ) return;

        const paintFrame = requestAnimationFrame(() => {
            if (morphSeedPaintFrameRef.current !== paintFrame) return;
            morphSeedPaintFrameRef.current = null;
            startMorphOpenAnimation(openCycle);
        });
        morphSeedPaintFrameRef.current = paintFrame;
    }, [startMorphOpenAnimation]);

    const handleMorphSeedLayout = useCallback((width: number, height: number) => {
        if (!isMorphPresentation || width <= 0 || height <= 0) return;

        morphSeedHasLayoutRef.current = true;
        if (
            !visibleRef.current ||
            morphOpenStartedRef.current ||
            closingRef.current ||
            morphSeedPaintFrameRef.current !== null
        ) return;

        scheduleMorphOpenAfterPaint(morphOpenCycleRef.current);
    }, [isMorphPresentation, scheduleMorphOpenAfterPaint]);

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
            if (morphSeedHasLayoutRef.current) {
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
        morphPresentationOpacity,
        morphProgress,
        posY,
        prewarm,
        resetCloseLifecycle,
        scheduleMorphOpenAfterPaint,
    ]);

    const closeSheet = useCallback((
        after?: () => void,
        { notifyCloseStart = true }: CloseSheetOptions = {}
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
            const closeDuration = resolveAddHandoffCloseDuration(morphProgress.value);
            cancelAnimation(morphProgress);
            morphProgress.value = withTiming(0, {
                duration: closeDuration,
                easing: ReanimatedEasing.bezier(...ADD_HANDOFF_MOTION.closeBezier),
            });
            morphCloseFinishTimerRef.current = setTimeout(() => {
                morphCloseFinishTimerRef.current = null;
                if (closeCycle !== closeCycleRef.current || !closingRef.current) return;

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
            if (!finished || closeCycle !== closeCycleRef.current || !closingRef.current) return;

            closingRef.current = false;
            morphWasPresentedRef.current = false;
            setRendered(prewarm);
            after?.();
        });
    }, [
        isMorphPresentation,
        morphClosingPhase,
        morphPresentationOpacity,
        morphProgress,
        onCloseStart,
        posY,
        prewarm,
    ]);

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

    const closeWithoutPrompt = useCallback(() => {
        discardDraft();
        closeSheet(onClose);
    }, [closeSheet, discardDraft, onClose]);

    const requestClose = useCallback((restoreBeforePrompt = false) => {
        const action = getScheduleAddCloseAction({
            dirty: formDirtyRef.current,
            submitting: submitting || submitInFlightRef.current,
        });
        if (action === "ignore") return;
        if (action === "close") {
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
            "작성 중인 일정을 닫을까요?",
            "입력한 내용은 저장되지 않고 사라집니다.",
            [
                { text: "계속 작성", style: "cancel", onPress: keepEditing },
                { text: "버리기", style: "destructive", onPress: closeWithoutPrompt },
            ],
            { cancelable: true, onDismiss: keepEditing }
        );
    }, [closeWithoutPrompt, restoreSheetPosition, submitting]);

    useEffect(() => {
        if (
            Platform.OS !== "android" ||
            !visible ||
            !rendered ||
            routePlannerHidden
        ) return undefined;

        const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
            requestClose();
            return true;
        });
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
    }, [isMorphPresentation, morphPresentationOpacity, prewarm, visible]);

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
    }, [isMorphPresentation, visible, openSheet, posY]);

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
    }, [closeSheet, isMorphPresentation, prewarm, rendered, visible]);

    useEffect(() => () => {
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
    }, [morphProgress, posY]);

    useEffect(() => {
        if (!visible || !routePlannerSessionId) return;
        const observation = observeRoutePlannerReturn(pathname, routePlannerAwayRef.current);
        routePlannerAwayRef.current = observation.hasVisitedRouteFlow;
        if (!observation.shouldConsumeResult) return;

        const result = consumeRoutePlannerResult(routePlannerSessionId);
        const selectedTargetArrivalAt = pendingRouteTimingTargetArrivalRef.current;
        pendingRouteTimingTargetArrivalRef.current = undefined;
        setRoutePlannerSessionId(undefined);
        if (!result) {
            setRoutePlannerHidden(false);
            setRendered(true);
            if (isMorphPresentation) {
                resetCloseLifecycle();
                cancelAnimation(morphProgress);
                morphProgress.value = 1;
                setMorphContentMounted(true);
                setMorphSheetRasterized(true);
            } else {
                posY.setValue(SHEET_HIDDEN_Y);
                openSheet();
            }
            return;
        }

        setOriginText(result.origin?.name ?? "");
        setOriginAddress(result.origin?.address);
        setOriginLat(result.origin?.lat);
        setOriginLng(result.origin?.lng);
        setDestinationText(result.destination?.name ?? "");
        setDestinationAddress(result.destination?.address);
        setDestinationLat(result.destination?.lat);
        setDestinationLng(result.destination?.lng);
        setTravelMode(result.travelMode);
        setTravelMinutes(result.travelMinutes);
        setDepartAt(result.departureAt);
        setRoute(result.route);
        routeTimingTargetArrivalRef.current = selectedTargetArrivalAt ?? result.targetArrivalAt;
        markFormDirty();
        setRoutePlannerHidden(false);
        setRendered(true);
        if (isMorphPresentation) {
            resetCloseLifecycle();
            cancelAnimation(morphProgress);
            morphProgress.value = 1;
            setMorphContentMounted(true);
            setMorphSheetRasterized(true);
        } else {
            posY.setValue(SHEET_HIDDEN_Y);
            openSheet();
        }
    }, [
        isMorphPresentation,
        morphProgress,
        openSheet,
        pathname,
        posY,
        resetCloseLifecycle,
        routePlannerSessionId,
        visible,
        markFormDirty,
    ]);

    // 현재 입력한 장소와 일정 시작 시각을 경로 선택 화면에 그대로 전달한다.
    const openRoutePlanner = useCallback(() => {
        if (submitInFlightRef.current) return;
        // 파서 목적지를 좌표로 보강하던 느린 응답이 사용자가 경로 화면에서
        // 직접 고른 장소를 뒤늦게 덮지 못하도록 먼저 무효화한다.
        destinationResolutionSequenceRef.current += 1;
        const nextOrigin = buildRoutePlannerPlace({
            name: originText,
            address: originAddress,
            lat: originLat,
            lng: originLng,
        }, "출발지");
        const nextDestination = buildRoutePlannerPlace({
            name: destinationText,
            address: destinationAddress,
            lat: destinationLat,
            lng: destinationLng,
        }, "도착지");
        const sessionId = `route-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        const targetArrivalAt = allDay
            ? startOfLocalScheduleDay(startDay)
            : mergeDateTime(startDay, startTime);
        pendingRouteTimingTargetArrivalRef.current = targetArrivalAt.toISOString();
        setRoutePlannerInitial(sessionId, buildScheduleRoutePlannerInitial({
            origin: nextOrigin,
            destination: nextDestination,
            travelMode,
            travelMinutes,
            departureAt: departAt,
            route,
            locationName: nextOrigin?.name && nextDestination?.name
                ? `${nextOrigin.name} → ${nextDestination.name}`
                : nextDestination?.name ?? nextOrigin?.name,
            targetArrivalAt,
        }));

        setPicker(null);
        // 모달 state가 먼저 갱신돼도 경로 화면을 실제로 다녀오기 전에는 빈 결과를 소비하지 않는다.
        routePlannerAwayRef.current = false;
        setRoutePlannerSessionId(sessionId);
        setRoutePlannerHidden(true);
        closeSheet(undefined, { notifyCloseStart: false });
        router.push({ pathname: "/schedule/route-select", params: { sessionId } });
    }, [
        closeSheet,
        allDay,
        destinationAddress,
        destinationLat,
        destinationLng,
        destinationText,
        departAt,
        originAddress,
        originLat,
        originLng,
        originText,
        router,
        startDay,
        startTime,
        travelMinutes,
        travelMode,
        route,
    ]);

    const clearRoute = useCallback(() => {
        destinationResolutionSequenceRef.current += 1;
        markFormDirty();
        setOriginText("");
        setDestinationText("");
        setOriginAddress(undefined);
        setDestinationAddress(undefined);
        setOriginLat(undefined);
        setOriginLng(undefined);
        setDestinationLat(undefined);
        setDestinationLng(undefined);
        setTravelMinutes(undefined);
        setDepartAt(undefined);
        setRoute(undefined);
        routeTimingTargetArrivalRef.current = undefined;
        pendingRouteTimingTargetArrivalRef.current = undefined;
        setNotificationEnabled(false);
    }, [markFormDirty]);

    // 핸들바 드래그로 바텀시트를 닫거나 원위치한다.
    const panResponder = useMemo(() =>
        PanResponder.create({
            onStartShouldSetPanResponder:        () => true,
            onStartShouldSetPanResponderCapture: () => false,
            onMoveShouldSetPanResponder: (_, g) => g.dy > 2 && Math.abs(g.dy) > Math.abs(g.dx),
            onMoveShouldSetPanResponderCapture:  () => false,
            onPanResponderMove: (_, g) => { posY.setValue(clampSheetY(g.dy)); },
            onPanResponderRelease: (_, g) => {
                const projectedY = clampSheetY(g.dy + (g.vy * SHEET_VELOCITY_PROJECTION));
                if (projectedY > SHEET_CLOSE_DISTANCE || g.vy > SHEET_CLOSE_VELOCITY) {
                    requestClose(true);
                } else {
                    Animated.spring(posY, {
                        toValue: 0,
                        useNativeDriver: true,
                        damping: 24,
                        stiffness: 230,
                        mass: 0.9,
                        restDisplacementThreshold: 0.35,
                        restSpeedThreshold: 0.35,
                    }).start();
                }
            },
            onPanResponderTerminate: () => {
                Animated.spring(posY, {
                    toValue: 0,
                    useNativeDriver: true,
                    damping: 24,
                    stiffness: 230,
                    mass: 0.9,
                    restDisplacementThreshold: 0.35,
                    restSpeedThreshold: 0.35,
                }).start();
            },
        }), [posY, requestClose]);

    // 입력값을 일정 저장 payload로 변환해 상위 화면에 전달한다.
    const submit = async () => {
        const t = title.trim();
        if (!t) {
            setFormError("일정 제목을 입력해 주세요.");
            return;
        }
        if (!category) {
            setFormError("일정을 저장할 카테고리를 먼저 만들어 주세요.");
            return;
        }
        if (submitting || submitInFlightRef.current) return;

        const normalizedRange = normalizeScheduleFormRange({
            startDay,
            startTime,
            endDay,
            endTime,
            allDay,
            hasEndTime,
        });
        const nextOrigin = buildScheduleFormPlace({
            name: originText,
            address: originAddress,
            lat: originLat,
            lng: originLng,
        });
        const nextDestination = buildScheduleFormPlace({
            name: destinationText,
            address: destinationAddress,
            lat: destinationLat,
            lng: destinationLng,
        });
        const locationName = buildScheduleFormLocationName(nextOrigin, nextDestination);
        const nextStartAt = normalizedRange.startAt.toISOString();
        const reconciledRouteTiming = reconcileScheduleRouteTiming({
            departAt,
            route,
            travelMinutes,
            plannedArrivalAt: routeTimingTargetArrivalRef.current,
            nextArrivalAt: nextStartAt,
        });
        const hasRoutePlan = hasPersistableScheduleRoute(
            reconciledRouteTiming.route,
            travelMinutes,
            nextOrigin,
            nextDestination
        );

        try {
            submitInFlightRef.current = true;
            setSubmitting(true);
            setFormError(null);
            await onSubmit({
                title: t,
                startAt: nextStartAt,
                endAt: normalizedRange.endAt.toISOString(),
                hasEndTime: normalizedRange.hasEndTime,
                allDay: normalizedRange.allDay,
                category,
                travelMode: hasRoutePlan ? travelMode : undefined,
                travelMinutes: hasRoutePlan ? travelMinutes : undefined,
                departAt: hasRoutePlan ? reconciledRouteTiming.departAt : undefined,
                route: hasRoutePlan ? reconciledRouteTiming.route : undefined,
                notificationEnabled: hasRoutePlan && notificationEnabled,
                notificationLeadMinutes: hasRoutePlan && notificationEnabled
                    ? notificationLeadMinutes
                    : undefined,
                notificationIntervalMinutes: hasRoutePlan && notificationEnabled
                    ? notificationIntervalMinutes
                    : undefined,
                locationName,
                origin: hasRoutePlan ? nextOrigin : undefined,
                destination: nextDestination,
                notes: notes.trim() || undefined,
            });
            closeWithoutPrompt();
        } catch (error) {
            setFormError(error instanceof Error ? error.message : "일정을 저장하지 못했습니다. 다시 시도해 주세요.");
        } finally {
            submitInFlightRef.current = false;
            setSubmitting(false);
        }
    };

    // 캘린더에서 선택한 날짜를 시작/종료 날짜에 반영한다.
    const onDayPress = useCallback((day: { dateString: string }) => {
        const selected = new Date(`${day.dateString}T00:00:00`);
        markFormDirty();
        if (picker === "startDate") {
            setStartDay(selected);
            if (allDay && selected.getTime() > endDay.getTime()) setEndDay(selected);
        } else if (picker === "endDate") {
            if (!allDay) setHasEndTime(true);
            setEndDay(selected);
            if (selected.getTime() < startDay.getTime()) setStartDay(selected);
        }
    }, [allDay, endDay, markFormDirty, picker, startDay]);

    // 시간 피커에서 선택한 시간을 시작/종료 시간에 반영한다.
    const onTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
        if (Platform.OS === "android" && event.type === "dismissed") { setPicker(null); return; }
        if (!selected) return;
        markFormDirty();
        if (picker === "startTime") setStartTime(selected);
        else if (picker === "endTime") {
            setHasEndTime(true);
            setEndTime(selected);
        }
        if (Platform.OS === "android") setPicker(null);
    };

    const calendarTheme = useMemo(() => ({
        calendarBackground:         colors.surface,
        textSectionTitleColor:      colors.textSecondary,
        selectedDayBackgroundColor: colors.selectedDayBg,
        selectedDayTextColor:       colors.selectedDayText,
        todayTextColor:             colors.todayBorderColor,
        dayTextColor:               colors.textPrimary,
        textDisabledColor:          colors.textDisabled,
        arrowColor:                 colors.arrowColor,
        monthTextColor:             colors.monthTextColor,
        textDayFontWeight:          "600" as const,
        textMonthFontWeight:        "700" as const,
        textDayHeaderFontWeight:    "500" as const,
    }), [colors]);

    const isDisplayDate = displayPicker === "startDate" || displayPicker === "endDate";
    const isDisplayTime = displayPicker === "startTime" || displayPicker === "endTime";
    const calendarSelected = isDisplayDate
        ? getScheduleCalendarDateKey(displayPicker === "startDate" ? startDay : endDay)
        : "";
    const fieldStyle = (type: PickerType) => [
        styles.fieldBase,
        {
            borderColor: picker === type ? colors.inputBorderFocused : colors.inputBorder,
            backgroundColor: colors.inputBackground,
        },
    ];
    const morphOpenSourceWidth = Math.max(44, sourceWidth);
    const morphOpenSourceHeight = Math.max(44, sourceHeight);
    const morphCloseSourceWidth = Math.max(44, closeTargetWidth);
    const morphCloseSourceHeight = MORPH_CLOSE_TARGET_HEIGHT;
    const morphOpenSourceRadius = Math.min(
        morphOpenSourceHeight / 2,
        ADD_MENU_SOURCE.nativeRadius
    );
    const morphCloseSourceRadius = Math.min(
        morphCloseSourceHeight / 2,
        ADD_MENU_SOURCE.nativeRadius
    );
    const morphSourceRight = screenWidth - sourceRightOffset;
    const morphOpenSourceLeft = morphSourceRight - morphOpenSourceWidth;
    const morphCloseSourceLeft = morphSourceRight - morphCloseSourceWidth;
    const morphSourceTop = insets.top + sourceTopOffset;
    const morphTargetWidth = Math.min(screenWidth - 28, 390);
    const morphTargetLeft = (screenWidth - morphTargetWidth) / 2;
    const morphTargetTop = morphSourceTop;
    const morphAvailableHeight = screenHeight - morphTargetTop - Math.max(insets.bottom, 14) - 10;
    const morphDesiredHeight = Math.min(
        MORPH_TARGET_MAX_HEIGHT,
        Math.max(MORPH_TARGET_MIN_HEIGHT, screenHeight * MORPH_TARGET_HEIGHT_RATIO)
    );
    const morphTargetHeight = Math.min(morphDesiredHeight, morphAvailableHeight);
    const sheetTargetHeight = Math.min(
        SHEET_TARGET_MAX_HEIGHT,
        screenHeight * SHEET_TARGET_HEIGHT_RATIO
    );
    const morphSheetStyle = useAnimatedStyle(() => {
        const motionProgress = morphProgress.value;
        const closing = morphClosingPhase.value >= 0.5;
        const activeSourceLeft = closing ? morphCloseSourceLeft : morphOpenSourceLeft;
        const activeSourceWidth = closing ? morphCloseSourceWidth : morphOpenSourceWidth;
        const activeSourceHeight = closing ? morphCloseSourceHeight : morphOpenSourceHeight;
        const scaleX = lerpAddHandoffValue(
            activeSourceWidth / morphTargetWidth,
            1,
            motionProgress
        );
        const scaleY = lerpAddHandoffValue(
            activeSourceHeight / morphTargetHeight,
            1,
            motionProgress
        );
        return {
            left: morphTargetLeft,
            top: morphTargetTop,
            width: morphTargetWidth,
            height: morphTargetHeight,
            transform: [
                {
                    translateX: lerpAddHandoffValue(
                        activeSourceLeft - morphTargetLeft,
                        0,
                        motionProgress
                    ),
                },
                {
                    translateY: lerpAddHandoffValue(
                        morphSourceTop - morphTargetTop,
                        0,
                        motionProgress
                    ),
                },
                { scaleX },
                { scaleY },
            ],
        };
    }, [
        morphCloseSourceHeight,
        morphCloseSourceLeft,
        morphCloseSourceWidth,
        morphOpenSourceHeight,
        morphOpenSourceLeft,
        morphOpenSourceWidth,
        morphTargetLeft,
        morphSourceTop,
        morphTargetTop,
        morphTargetWidth,
        morphTargetHeight,
    ]);
    const morphSurfaceRadiusStyle = useAnimatedStyle(() => {
        const motionProgress = morphProgress.value;
        const closing = morphClosingPhase.value >= 0.5;
        const activeSourceHeight = closing
            ? morphCloseSourceHeight
            : morphOpenSourceHeight;
        const activeSourceRadius = closing
            ? morphCloseSourceRadius
            : morphOpenSourceRadius;
        const scaleY = lerpAddHandoffValue(
            activeSourceHeight / morphTargetHeight,
            1,
            motionProgress
        );
        const visualRadius = lerpAddHandoffValue(
            activeSourceRadius,
            ADD_MENU_SOURCE.nativeRadius,
            motionProgress
        );

        return {
            borderRadius: visualRadius / Math.max(scaleY, 0.01),
        };
    }, [
        morphCloseSourceHeight,
        morphCloseSourceRadius,
        morphOpenSourceHeight,
        morphOpenSourceRadius,
        morphTargetHeight,
    ]);
    const morphDimStyle = useAnimatedStyle(() => ({
        opacity: interpolate(
            morphProgress.value,
            ADD_HANDOFF_MOTION.backdropInputRange,
            ADD_HANDOFF_MOTION.backdropOutputRange,
            Extrapolation.CLAMP
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
                Extrapolation.CLAMP
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
                Extrapolation.CLAMP
            ),
        };
    }, [isMorphPresentation]);

    // Keep teardown symmetric with QuickScheduleModal: once the local close
    // lifecycle finishes, do not render a reset source seed while the parent
    // visibility update is still crossing the React commit boundary.
    if (!rendered || routePlannerHidden) {
        return null;
    }

    const isPrewarmOnly = prewarm
        && !visible
        && !morphWasPresentedRef.current
        && !morphClosingRef.current;

    const SheetMotionView = (isMorphPresentation
        ? Reanimated.View
        : Animated.View) as React.ComponentType<any>;
    const SheetContentView = (isMorphPresentation
        ? Reanimated.View
        : Animated.View) as React.ComponentType<any>;
    // Avoid re-rasterizing a native GlassView while its parent is scaled. The
    // regular bottom sheet still uses native glass; only the morph uses this
    // lightweight, visually matching surface.
    const SheetSurfaceView = (isMorphPresentation
        ? View
        : CalendarGlassSurface) as React.ComponentType<any>;
    const sheetSurfaceProps = isMorphPresentation
        ? {}
        : {
            prominent: true,
            variant: "sheet",
            tone: "solidCard",
        };
    const sheetMotionStyle = isMorphPresentation
        ? [styles.morphSheetMotion, morphSheetStyle]
        : [styles.sheetMotion, { maxHeight: sheetTargetHeight, transform: [{ translateY: posY }] }];

    return (
        <Reanimated.View
            accessibilityViewIsModal={!isPrewarmOnly}
            accessibilityElementsHidden={isPrewarmOnly}
            importantForAccessibility={isPrewarmOnly ? "no-hide-descendants" : "auto"}
            style={[
                styles.wrapper,
                isMorphPresentation && styles.morphWrapper,
                isPrewarmOnly && !isMorphPresentation && styles.prewarmHidden,
                isMorphPresentation && morphPresentationStyle,
            ]}
            pointerEvents={isPrewarmOnly ? "none" : "box-none"}
        >
            <Reanimated.View
                pointerEvents="auto"
                style={[styles.dim, isMorphPresentation && morphDimStyle]}
            >
                <Pressable
                    accessible={false}
                    style={StyleSheet.absoluteFill}
                    onPress={() => requestClose()}
                />
            </Reanimated.View>

            <SheetMotionView
                collapsable={false}
                onLayout={({ nativeEvent: { layout } }: {
                    nativeEvent: { layout: { width: number; height: number } };
                }) => {
                    handleMorphSeedLayout(layout.width, layout.height);
                }}
                style={sheetMotionStyle}
            >
            <SheetSurfaceView
                {...sheetSurfaceProps}
                collapsable={false}
                style={[
                    styles.sheet,
                    isMorphPresentation && styles.morphSheet,
                    {
                        borderColor: colors.border,
                        backgroundColor: isMorphPresentation
                            ? "transparent"
                            : undefined,
                        borderWidth: isMorphPresentation ? 0 : 1,
                    },
                ]}
            >
                <Reanimated.View
                    collapsable={false}
                    shouldRasterizeIOS={Platform.OS === "ios" && isMorphPresentation && morphSheetRasterized}
                    style={[
                        isMorphPresentation && styles.morphDenseSurface,
                        isMorphPresentation && morphDenseCloseStyle,
                        isMorphPresentation && morphSurfaceRadiusStyle,
                        isMorphPresentation && {
                            backgroundColor: mode === "dark" ? "#0E0F12" : "#FFFFFF",
                            borderColor: colors.border,
                        },
                    ]}
                >
                {(!isMorphPresentation || morphContentMounted) && (
                    <SheetContentView style={[
                        isMorphPresentation ? styles.morphInnerContent : styles.sheetInnerContent,
                    ]}>
                    <View
                        testID="schedule-add-drag-handle"
                        {...(!isMorphPresentation ? panResponder.panHandlers : {})}
                        style={styles.handleWrap}
                    >
                        <View style={[styles.handle, { backgroundColor: colors.border }]} />
                    </View>

                    <ScrollView
                        style={styles.scrollView}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={styles.scrollContent}
                    >
                        <View style={styles.headerRow}>
                            <View style={styles.headerTitleGroup}>
                                <Ionicons accessible={false} name="create-outline" size={17} color={colors.textPrimary} />
                                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>일정 생성</Text>
                            </View>
                            <View>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="일정 생성 닫기"
                                    accessibilityHint="작성 중인 내용이 있으면 확인 후 닫습니다"
                                    onPress={() => requestClose()}
                                    style={[
                                        styles.closeBtn,
                                        {
                                            backgroundColor: mode === "dark"
                                                ? "rgba(255,255,255,0.08)"
                                                : "rgba(118,118,128,0.12)",
                                            borderColor: colors.border,
                                        },
                                    ]}
                                >
                                    <Text style={[styles.closeBtnText, { color: colors.textPrimary }]}>닫기</Text>
                                </Pressable>
                            </View>
                        </View>

                        {categoryError && onRetryCategories ? (
                            <CategoryLoadErrorBanner
                                compact
                                retrying={categoryLoading}
                                onRetry={onRetryCategories}
                            />
                        ) : null}

                        <View style={isMorphPresentation ? styles.morphBodyContent : undefined}>
                        <Text style={[styles.label, { color: colors.textSecondary }]}>제목</Text>
                        <View
                            style={[
                                styles.titleInputWrap,
                                {
                                    borderColor: colors.inputBorder,
                                    backgroundColor: colors.inputBackground,
                                },
                            ]}
                        >
                            <TextInput
                                value={title}
                                onChangeText={(value) => {
                                    markFormDirty();
                                    setTitle(value);
                                    if (value.trim()) setFormError(null);
                                }}
                                accessibilityLabel="일정 제목"
                                maxLength={120}
                                placeholder="예) 회의"
                                placeholderTextColor={colors.inputPlaceholder}
                                style={[styles.titleInput, { color: colors.textPrimary }]}
                            />
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`카테고리 선택, 현재 ${category?.title ?? "없음"}`}
                                accessibilityState={{ expanded: categoryPickerOpen, disabled: writableCategories.length === 0 }}
                                onPress={() => setCategoryPickerOpen((current) => !current)}
                                disabled={writableCategories.length === 0}
                                style={[styles.categoryInlineChip, { borderColor: colors.border }]}
                            >
                                <View style={[styles.categoryInlineDot, { backgroundColor: category?.color ?? "#8E8E93" }]} />
                                <Text numberOfLines={1} style={[styles.categoryInlineText, { color: colors.textPrimary }]}>
                                    {category?.title ?? "카테고리"}
                                </Text>
                            </Pressable>
                        </View>

                        <Text
                            accessibilityLiveRegion="polite"
                            style={[
                                styles.formHint,
                                { color: formError ? "#D70015" : colors.textSecondary },
                            ]}
                        >
                            {formError ?? (!title.trim()
                                ? "제목을 입력하면 저장할 수 있어요."
                                : !category
                                    ? "카테고리를 만든 뒤 저장할 수 있어요."
                                    : " ")}
                        </Text>

                        {categoryPickerOpen && (
                            <CategoryPickerRow
                                categories={writableCategories}
                                value={selectedCategoryId}
                                onChange={(nextCategoryId) => {
                                    markFormDirty();
                                    setSelectedCategoryId(nextCategoryId);
                                    setCategoryPickerOpen(false);
                                }}
                                onManageCategories={onManageCategories}
                            />
                        )}

                        <LocationInputRow
                            originValue={originText}
                            destinationValue={destinationText}
                            travelMode={travelMode}
                            travelMinutes={travelMinutes}
                            routeInfo={routeInfo}
                            onPress={openRoutePlanner}
                            onClear={routeInfo ? clearRoute : undefined}
                        />

                        {!!routeInfo && (
                            <NotificationSettingsCard
                                routeReady={routeReady}
                                enabled={notificationEnabled}
                                leadMinutes={notificationLeadMinutes}
                                intervalMinutes={notificationIntervalMinutes}
                                routeInfo={routeInfo}
                                startAt={allDay
                                    ? startOfLocalScheduleDay(startDay)
                                    : mergeDateTime(startDay, startTime)}
                                policy={subscriptionPolicy}
                                onEnabledChange={(value) => {
                                    markFormDirty();
                                    setNotificationEnabled(value);
                                }}
                                onLeadMinutesChange={(value) => {
                                    markFormDirty();
                                    setNotificationLeadMinutes(value);
                                }}
                                onIntervalMinutesChange={(value) => {
                                    markFormDirty();
                                    setNotificationIntervalMinutes(value);
                                }}
                            />
                        )}

                        <View
                            style={[
                                styles.endTimeToggleRow,
                                {
                                    borderColor: colors.inputBorder,
                                    backgroundColor: colors.inputBackground,
                                },
                            ]}
                        >
                            <View style={styles.endTimeToggleCopy}>
                                <Text style={[styles.endTimeToggleTitle, { color: colors.textPrimary }]}>종일</Text>
                                <Text style={[styles.endTimeToggleHint, { color: colors.textSecondary }]}>시간 없이 날짜로만 일정을 표시해요.</Text>
                            </View>
                            <Switch
                                accessibilityLabel="종일 일정"
                                value={allDay}
                                onValueChange={handleAllDayChange}
                                trackColor={{ false: colors.border, true: mode === "dark" ? "#4B9DFF" : "#2979FF" }}
                                thumbColor="#FFFFFF"
                                style={styles.toggleSwitch}
                            />
                        </View>

                        <View style={styles.twoColRow}>
                            <View style={styles.col}>
                                <Text style={[styles.label, { color: colors.textSecondary }]}>시작 날짜</Text>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`시작 날짜 ${formatScheduleFormDate(startDay)}`}
                                    accessibilityState={{ expanded: picker === "startDate" }}
                                    onPress={() => togglePicker("startDate")}
                                    style={fieldStyle("startDate")}
                                >
                                    <Text style={[styles.fieldText, { color: colors.textPrimary }]}>{formatScheduleFormDate(startDay)}</Text>
                                </Pressable>
                            </View>
                            <View style={styles.col}>
                                <Text style={[styles.label, { color: colors.textSecondary }]}>
                                    {allDay ? "마지막 날" : "시작 시간"}
                                </Text>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={allDay
                                        ? `마지막 날 ${formatScheduleFormDate(endDay)}`
                                        : `시작 시간 ${hhmmText(startTime)}`}
                                    accessibilityState={{ expanded: picker === (allDay ? "endDate" : "startTime") }}
                                    onPress={() => togglePicker(allDay ? "endDate" : "startTime")}
                                    style={fieldStyle(allDay ? "endDate" : "startTime")}
                                >
                                    <Text style={[styles.fieldText, { color: colors.textPrimary }]}>
                                        {allDay ? formatScheduleFormDate(endDay) : hhmmText(startTime)}
                                    </Text>
                                </Pressable>
                            </View>
                        </View>

                        {!allDay ? <View
                            style={[
                                styles.endTimeToggleRow,
                                {
                                    borderColor: colors.inputBorder,
                                    backgroundColor: colors.inputBackground,
                                },
                            ]}
                        >
                            <View style={styles.endTimeToggleCopy}>
                                <Text style={[styles.endTimeToggleTitle, { color: colors.textPrimary }]}>종료 시각 설정</Text>
                                <Text style={[styles.endTimeToggleHint, { color: colors.textSecondary }]}>끄면 시작 시각만 일정에 표시돼요.</Text>
                            </View>
                            <Switch
                                accessibilityLabel="종료 시각 설정"
                                value={hasEndTime}
                                onValueChange={handleEndTimeEnabledChange}
                                trackColor={{ false: colors.border, true: mode === "dark" ? "#4B9DFF" : "#2979FF" }}
                                thumbColor="#FFFFFF"
                                style={styles.toggleSwitch}
                            />
                        </View> : null}

                        {!allDay && hasEndTime ? (
                            <View style={styles.twoColRow}>
                                <View style={styles.col}>
                                    <Text style={[styles.label, { color: colors.textSecondary }]}>종료 날짜</Text>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={`종료 날짜 ${formatScheduleFormDate(endDay)}`}
                                        accessibilityState={{ expanded: picker === "endDate" }}
                                        onPress={() => togglePicker("endDate")}
                                        style={fieldStyle("endDate")}
                                    >
                                        <Text style={[styles.fieldText, { color: colors.textPrimary }]}>{formatScheduleFormDate(endDay)}</Text>
                                    </Pressable>
                                </View>
                                <View style={styles.col}>
                                    <Text style={[styles.label, { color: colors.textSecondary }]}>종료 시간</Text>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={`종료 시간 ${hhmmText(endTime)}`}
                                        accessibilityState={{ expanded: picker === "endTime" }}
                                        onPress={() => togglePicker("endTime")}
                                        style={fieldStyle("endTime")}
                                    >
                                        <Text style={[styles.fieldText, { color: colors.textPrimary }]}>{hhmmText(endTime)}</Text>
                                    </Pressable>
                                </View>
                            </View>
                        ) : null}

                        <Animated.View style={[styles.pickerContainer, {
                            borderColor:  colors.inputBorder,
                            backgroundColor: colors.inputBackground,
                            maxHeight:    heightAnim,
                            opacity:      outerOpacity,
                            marginBottom: outerOpacity.interpolate({ inputRange: [0, 1], outputRange: [0, 14] }),
                        }]}>
                            <Animated.View style={{ opacity: contentFade }}>
                                {isDisplayDate && (
                                    <Calendar
                                        key={mode}
                                        current={calendarSelected}
                                        onDayPress={onDayPress}
                                        markedDates={{
                                            [calendarSelected]: {
                                                selected: true,
                                                selectedColor:     colors.selectedDayBg,
                                                selectedTextColor: colors.selectedDayText,
                                            },
                                        }}
                                        theme={calendarTheme}
                                    />
                                )}
                                {isDisplayTime && (
                                    <DateTimePicker
                                        value={displayPicker === "startTime" ? startTime : endTime}
                                        mode="time"
                                        display={Platform.OS === "ios" ? "spinner" : "default"}
                                        themeVariant={mode === "dark" ? "dark" : "light"}
                                        is24Hour
                                        onChange={onTimeChange}
                                    />
                                )}
                            </Animated.View>
                        </Animated.View>

                        <Text style={[styles.label, { color: colors.textSecondary }]}>메모</Text>
                        <TextInput
                            value={notes}
                            onChangeText={(value) => {
                                markFormDirty();
                                setNotes(value);
                            }}
                            multiline
                            maxLength={2000}
                            accessibilityLabel="일정 메모"
                            placeholder="추가로 기억할 내용을 입력하세요"
                            placeholderTextColor={colors.inputPlaceholder}
                            style={[
                                styles.input,
                                styles.notesInput,
                                {
                                    borderColor: colors.inputBorder,
                                    backgroundColor: colors.inputBackground,
                                    color: colors.textPrimary,
                                },
                            ]}
                        />

                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="일정 저장"
                            accessibilityState={{ disabled: submitting || !title.trim() || !category, busy: submitting }}
                            disabled={submitting || !title.trim() || !category}
                            onPress={submit}
                            style={[
                                styles.saveBtn,
                                {
                                    backgroundColor: mode === "dark"
                                        ? "#1E68FF"
                                        : "#2979FF",
                                    borderColor: mode === "dark" ? "#4B9DFF" : "#1E68FF",
                                    opacity: submitting || !title.trim() || !category ? 0.42 : 1,
                                },
                            ]}
                        >
                            <Text style={[
                                styles.saveBtnText,
                                { color: "#FFFFFF" },
                            ]}>
                                {submitting ? "저장 중" : "저장"}
                            </Text>
                        </Pressable>
                        </View>
                    </ScrollView>
                    </SheetContentView>
                )}
                </Reanimated.View>
                {isMorphPresentation && (
                    <Reanimated.View
                        pointerEvents="none"
                        style={[
                            styles.morphContentRevealCurtain,
                            morphContentRevealCurtainStyle,
                            morphSurfaceRadiusStyle,
                            { backgroundColor: mode === "dark" ? "#0E0F12" : "#FFFFFF" },
                        ]}
                    />
                )}
            </SheetSurfaceView>
            </SheetMotionView>
        </Reanimated.View>
    );
}

const styles = StyleSheet.create({
    wrapper:  {
        ...StyleSheet.absoluteFillObject,
        justifyContent: "flex-end",
        zIndex: 80,
        elevation: 80,
    },
    morphWrapper: {
        justifyContent: "flex-start",
    },
    prewarmHidden: {
        opacity: 0,
        zIndex: -1,
        elevation: 0,
    },
    dim:      { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0, 0, 0, 0.58)" },
    sheetMotion: {
        width: "100%",
        maxHeight: "92%",
        paddingHorizontal: 14,
        paddingBottom: 10,
    },
    morphSheetMotion: {
        position: "absolute",
        overflow: "visible",
        transformOrigin: [0, 0, 0],
    },
    sheet: {
        maxHeight: "100%",
        borderRadius: 26,
        borderWidth: 1,
        overflow: "hidden",
        zIndex: 1,
    },
    morphSheet: {
        position: "relative",
        width: "100%",
        height: "100%",
        maxHeight: undefined,
        overflow: "visible",
    },
    morphDenseSurface: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 26,
        borderWidth: 1,
        overflow: "hidden",
        zIndex: 1,
    },
    sheetInnerContent: { maxHeight: "100%" },
    morphInnerContent: {
        flex: 1,
        transformOrigin: [0, 0, 0],
    },
    morphContentRevealCurtain: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 26,
        zIndex: 2,
    },
    morphBodyContent: {
        position: "relative",
    },
    handleWrap:    { alignItems: "center", paddingTop: 9, paddingBottom: 6 },
    handle:        { width: 44, height: 5, borderRadius: 3, opacity: 0.45 },
    scrollView: { maxHeight: "100%" },
    scrollContent: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 18 },
    headerRow: {
        flexDirection: "row", alignItems: "center",
        justifyContent: "flex-end", marginBottom: 6,
    },
    headerTitleGroup: {
        flex: 1,
        marginLeft: 20,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    headerTitle:  { fontSize: 16, fontWeight: "600" },
    closeBtn:     { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1 },
    closeBtnText: { fontWeight: "600", fontSize: 13 },
    previewCard: {
        borderWidth: 1,
        borderRadius: 18,
        minHeight: 116,
        marginBottom: 18,
        padding: 14,
        flexDirection: "row",
        gap: 12,
    },
    previewColorBar: {
        width: 5,
        borderRadius: 999,
        alignSelf: "stretch",
    },
    previewBody: {
        flex: 1,
        minWidth: 0,
    },
    previewTitle: {
        fontSize: 20,
        fontWeight: "900",
        letterSpacing: 0,
    },
    previewMeta: {
        marginTop: 4,
        fontSize: 13,
        fontWeight: "800",
    },
    previewChipRow: {
        marginTop: 10,
        flexDirection: "row",
        gap: 7,
    },
    previewChip: {
        minWidth: 0,
        maxWidth: "50%",
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 5,
        backgroundColor: "rgba(255,255,255,0.055)",
    },
    previewChipText: {
        fontSize: 11,
        fontWeight: "800",
    },
    previewSub: {
        marginTop: 10,
        fontSize: 12,
        fontWeight: "700",
    },
    label:        { marginBottom: 7, fontSize: 12, fontWeight: "700" },
    formHint: {
        minHeight: 18,
        marginTop: -7,
        marginBottom: 8,
        fontSize: 12,
        fontWeight: "600",
    },
    input: {
        borderWidth: 1, borderRadius: 12, padding: 11, marginBottom: 10,
    },
    titleInputWrap: {
        minHeight: 42,
        borderWidth: 1,
        borderRadius: 12,
        paddingLeft: 12,
        paddingRight: 8,
        marginBottom: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    titleInput: {
        flex: 1,
        minWidth: 0,
        paddingVertical: 10,
        fontSize: 14,
        fontWeight: "700",
    },
    categoryInlineChip: {
        maxWidth: 116,
        height: 30,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 9,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    categoryInlineDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    categoryInlineText: {
        flexShrink: 1,
        fontSize: 12,
        fontWeight: "800",
    },
    notesInput: { minHeight: 62, textAlignVertical: "top" },
    twoColRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
    col:       { flex: 1 },
    endTimeToggleRow: {
        minHeight: 54,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 12,
        marginBottom: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    endTimeToggleCopy: {
        flex: 1,
        minWidth: 0,
        paddingVertical: 9,
    },
    endTimeToggleTitle: {
        fontSize: 13,
        fontWeight: "800",
    },
    endTimeToggleHint: {
        marginTop: 2,
        fontSize: 11,
        fontWeight: "600",
    },
    toggleSwitch: {
        alignSelf: "center",
    },
    fieldBase: {
        borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
    },
    fieldText:       { fontWeight: "700", fontSize: 13 },
    pickerContainer: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
    saveBtn: {
        paddingVertical: 13, borderRadius: 12,
        alignItems: "center", marginTop: 4,
        borderWidth: 1,
    },
    saveBtnText: { fontWeight: "700", fontSize: 15 },
});
