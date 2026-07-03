import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
    Platform,
    StyleSheet,
    Animated,
    Easing,
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
import { Calendar } from "react-native-calendars";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Place, ScheduleCategory, ScheduleItem, ScheduleParseResult, TravelMode } from "../../types";
import { searchAddressByKeyword } from "../../../map/tmapApi";
import { useTheme } from "../../../theme/ThemeContext";
import CalendarGlassSurface from "../calendar/CalendarGlassSurface";
import { consumeRoutePlannerResult, setRoutePlannerInitial } from "../../routePlannerSession";
import { getRouteInfoFromRoute } from "../../routeInfo";
import CategoryPickerRow from "./CategorySelectBox";
import LocationInputRow from "./LocationInputRow";
import NotificationSettingsCard from "./NotificationSettingsCard";
import {
    FREE_SUBSCRIPTION_POLICY,
    getMySubscriptionPolicy,
    type SubscriptionPolicy,
} from "../../../../api/subscription";

type Props = {
    visible: boolean;
    onClose: () => void;
    onSubmit: (payload: Omit<ScheduleItem, "id">) => void | Promise<void>;
    categories: ScheduleCategory[];
    defaultDay: string;
    initialValues?: ScheduleParseResult | null;
    onManageCategories?: () => void;
    autoFocusTitle?: boolean;
    onCloseStart?: () => void;
    presentation?: "sheet" | "morph";
    sourceTopOffset?: number;
    sourceWidth?: number;
    sourceHeight?: number;
    sourceContent?: "toolbar" | "addMenu";
    qaAutoCloseAfterMs?: number;
};

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

function ymdText(d: Date) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function hhmmText(d: Date) {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const SHEET_HIDDEN_Y = 900;
const SHEET_CLOSE_DISTANCE = 118;
const SHEET_CLOSE_VELOCITY = 0.85;
const SHEET_VELOCITY_PROJECTION = 120;
const MORPH_OPEN_START_PROGRESS = 0;
const MORPH_OPEN_DURATION_MS = 420;
const MORPH_CLOSE_DURATION_MS = 340;
const MORPH_SOURCE_WIDTH = 238;
const MORPH_SOURCE_HEIGHT = 164;
const MORPH_TOOLBAR_WIDTH = 150;
const MORPH_TOOLBAR_HEIGHT = 44;
const MORPH_CONTENT_MOUNT_DELAY_MS = 240;
const MORPH_TARGET_HEIGHT_RATIO = 0.64;
const MORPH_TARGET_MIN_HEIGHT = 540;
const MORPH_TARGET_MAX_HEIGHT = 620;
const SHEET_TARGET_HEIGHT_RATIO = 0.78;
const SHEET_TARGET_MAX_HEIGHT = 680;
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
    onClose,
    onSubmit,
    categories,
    defaultDay,
    initialValues,
    onManageCategories,
    autoFocusTitle = false,
    onCloseStart,
    presentation = "sheet",
    sourceTopOffset = 4,
    sourceWidth = MORPH_SOURCE_WIDTH,
    sourceHeight = MORPH_SOURCE_HEIGHT,
    sourceContent = "addMenu",
    qaAutoCloseAfterMs,
}: Props) {
    const router = useRouter();
    const pathname = usePathname();
    const { colors, mode } = useTheme();
    const insets = useSafeAreaInsets();
    const { width: screenWidth, height: screenHeight } = useWindowDimensions();
    const isMorphPresentation = presentation === "morph";
    const now = useMemo(() => new Date(), []);
    const initialStartTime = useMemo(() => {
        const d = new Date(now);
        d.setSeconds(0, 0);
        d.setMinutes(d.getMinutes() + 30);
        return d;
    }, [now]);

    const [title, setTitle]                           = useState("");
    const [notes, setNotes]                           = useState("");
    const [selectedCategoryId, setSelectedCategoryId] = useState(categories[0]?.id ?? "1");
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
    const [route, setRoute]                           = useState<unknown>();
    const [hasEndTime, setHasEndTime]                 = useState(false);
    const [notificationEnabled, setNotificationEnabled] = useState(false);
    const [notificationLeadMinutes, setNotificationLeadMinutes] = useState(60);
    const [notificationIntervalMinutes, setNotificationIntervalMinutes] = useState(20);
    const [subscriptionPolicy, setSubscriptionPolicy] = useState<SubscriptionPolicy>(FREE_SUBSCRIPTION_POLICY);
    const [routePlannerSessionId, setRoutePlannerSessionId] = useState<string | undefined>();
    const [submitting, setSubmitting]                 = useState(false);
    const [routePlannerHidden, setRoutePlannerHidden] = useState(false);
    const [rendered, setRendered] = useState(visible);
    const [morphContentMounted, setMorphContentMounted] = useState(!isMorphPresentation);
    const [morphClosing, setMorphClosing] = useState(false);
    const titleInputRef = useRef<TextInput>(null);

    const [startDay,  setStartDay]  = useState(() => new Date(`${defaultDay}T00:00:00`));
    const [endDay,    setEndDay]    = useState(() => new Date(`${defaultDay}T00:00:00`));
    const [startTime, setStartTime] = useState(() => new Date(initialStartTime));
    const [endTime, setEndTime] = useState(() => new Date(initialStartTime));

    const resetFormForNewSchedule = useCallback(() => {
        const defaultDate = new Date(`${defaultDay}T00:00:00`);
        setTitle("");
        setNotes("");
        setSelectedCategoryId(categories[0]?.id ?? "1");
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
        setRoute(undefined);
        setHasEndTime(false);
        setNotificationEnabled(false);
        setNotificationLeadMinutes(60);
        setNotificationIntervalMinutes(30);
        setRoutePlannerSessionId(undefined);
        setSubmitting(false);
        setRoutePlannerHidden(false);
        setPicker(null);
        setDisplayPicker(null);
        setStartDay(defaultDate);
        setEndDay(defaultDate);
        setStartTime(new Date(initialStartTime));
        setEndTime(new Date(initialStartTime));
    }, [categories, defaultDay, initialStartTime]);

    // 실제 선택값과 화면 표시값을 분리해 피커 전환 애니메이션을 안정화한다.
    const [picker,        setPicker]        = useState<PickerType | null>(null);
    const [displayPicker, setDisplayPicker] = useState<PickerType | null>(null);

    useEffect(() => {
        setStartDay((prev) => setYmd(prev, defaultDay));
        setEndDay((prev)   => setYmd(prev, defaultDay));
    }, [defaultDay]);

    useEffect(() => {
        if (categories.length === 0) return;
        setSelectedCategoryId((current) =>
            categories.some((categoryItem) => categoryItem.id === current)
                ? current
                : categories[0].id
        );
    }, [categories]);

    useEffect(() => {
        if (hasEndTime) return;
        setEndDay(new Date(startDay));
        setEndTime(new Date(startTime));
    }, [hasEndTime, startDay, startTime]);

    useEffect(() => {
        if (!visible) {
            resetFormForNewSchedule();
        }
    }, [resetFormForNewSchedule, visible]);

    useEffect(() => {
        if (!visible) return;

        if (!initialValues) {
            resetFormForNewSchedule();
            return;
        }

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
        }

        const parsedEnd = initialValues.endAt ? new Date(initialValues.endAt) : null;
        if (parsedEnd && !Number.isNaN(parsedEnd.getTime())) {
            setEndDay(parsedEnd);
            setEndTime(parsedEnd);
            setHasEndTime(
                Boolean(parsedStart) && parsedEnd.getTime() !== parsedStart?.getTime()
            );
        } else {
            setHasEndTime(false);
        }
    }, [initialValues, visible]);

    useEffect(() => {
        if (!visible || !initialValues?.destination || hasPlaceCoords(initialValues.destination)) return;

        const parsedDestinationName = cleanOptionalText(initialValues.destination.name);
        const parsedDestinationAddress = cleanOptionalText(initialValues.destination.address);
        const queries = uniqueNonBlank([parsedDestinationAddress, parsedDestinationName]);
        if (queries.length === 0) return;

        let cancelled = false;
        const resolveDestination = async () => {
            for (const query of queries) {
                const items = await searchAddressByKeyword(query).catch(() => []);
                if (cancelled) return;

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
        if (!visible) return;
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
    }, [visible]);

    const category = useMemo(
        () => categories.find((c) => c.id === selectedCategoryId) ?? categories[0],
        [categories, selectedCategoryId]
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
    const morphContentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const morphCloseFinishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const morphClosingRef = useRef(false);

    const openSheet = useCallback(() => {
        if (isMorphPresentation) {
            if (morphContentTimerRef.current) {
                clearTimeout(morphContentTimerRef.current);
                morphContentTimerRef.current = null;
            }
            setMorphContentMounted(false);
            morphClosingRef.current = false;
            setMorphClosing(false);
            if (morphCloseFinishTimerRef.current) {
                clearTimeout(morphCloseFinishTimerRef.current);
                morphCloseFinishTimerRef.current = null;
            }
            cancelAnimation(morphProgress);
            morphProgress.value = MORPH_OPEN_START_PROGRESS;
            morphProgress.value = withTiming(1, {
                duration: Math.round(MORPH_OPEN_DURATION_MS * (1 - MORPH_OPEN_START_PROGRESS)),
                easing: ReanimatedEasing.bezier(0.18, 0.82, 0.2, 1),
            });
            morphContentTimerRef.current = setTimeout(() => {
                setMorphContentMounted(true);
                morphContentTimerRef.current = null;
            }, MORPH_CONTENT_MOUNT_DELAY_MS);
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
    }, [isMorphPresentation, morphProgress, posY]);

    const closeSheet = useCallback((after?: () => void) => {
        if (isMorphPresentation) {
            morphClosingRef.current = true;
            setMorphClosing(true);
            onCloseStart?.();
            if (morphContentTimerRef.current) {
                clearTimeout(morphContentTimerRef.current);
                morphContentTimerRef.current = null;
            }
            if (morphCloseFinishTimerRef.current) {
                clearTimeout(morphCloseFinishTimerRef.current);
                morphCloseFinishTimerRef.current = null;
            }
            cancelAnimation(morphProgress);
            morphProgress.value = withTiming(0, {
                duration: MORPH_CLOSE_DURATION_MS,
                easing: ReanimatedEasing.bezier(0.3, 0, 0.16, 1),
            });
            morphCloseFinishTimerRef.current = setTimeout(() => {
                setMorphContentMounted(false);
                morphClosingRef.current = false;
                setMorphClosing(false);
                setRendered(false);
                morphCloseFinishTimerRef.current = null;
                after?.();
            }, MORPH_CLOSE_DURATION_MS);
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
            if (!finished) return;
            setRendered(false);
            after?.();
        });
    }, [isMorphPresentation, morphProgress, onCloseStart, posY]);

    useEffect(() => {
        if (!visible || !qaAutoCloseAfterMs) return undefined;

        const timer = setTimeout(() => {
            closeSheet(onClose);
        }, qaAutoCloseAfterMs);
        return () => clearTimeout(timer);
    }, [closeSheet, onClose, qaAutoCloseAfterMs, visible]);

    useLayoutEffect(() => {
        if (visible) {
            setRendered(true);
            if (isMorphPresentation) {
                posY.setValue(0);
            } else {
                posY.setValue(SHEET_HIDDEN_Y);
            }
            openSheet();
        }
    }, [isMorphPresentation, visible, openSheet, posY]);

    useEffect(() => {
        if (visible || !rendered || morphClosing) return;

        closeSheet();
    }, [closeSheet, morphClosing, rendered, visible]);

    useEffect(() => {
        if (!visible || !autoFocusTitle) return;
        const timer = setTimeout(() => titleInputRef.current?.focus(), 420);
        return () => clearTimeout(timer);
    }, [autoFocusTitle, visible]);

    useEffect(() => () => {
        if (morphContentTimerRef.current) {
            clearTimeout(morphContentTimerRef.current);
            morphContentTimerRef.current = null;
        }
        if (morphCloseFinishTimerRef.current) {
            clearTimeout(morphCloseFinishTimerRef.current);
            morphCloseFinishTimerRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (
            !visible ||
            !routePlannerSessionId ||
            pathname === "/schedule/route-select" ||
            pathname === "/schedule/route-planner"
        ) return;
        const result = consumeRoutePlannerResult(routePlannerSessionId);
        if (!result) {
            setRoutePlannerHidden(false);
            if (isMorphPresentation) {
                cancelAnimation(morphProgress);
                morphProgress.value = 1;
                setMorphContentMounted(true);
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
        setRoute(result.route);
        setRoutePlannerSessionId(undefined);
        setRoutePlannerHidden(false);
        if (isMorphPresentation) {
            cancelAnimation(morphProgress);
            morphProgress.value = 1;
            setMorphContentMounted(true);
        } else {
            posY.setValue(SHEET_HIDDEN_Y);
            openSheet();
        }
    }, [isMorphPresentation, morphProgress, openSheet, pathname, posY, routePlannerSessionId, visible]);

    // 출발지는 경로 선택 화면에서 직접 고르게 두고, 도착지만 초기값으로 전달한다.
    const openRoutePlanner = useCallback(() => {
        const normalizedDestinationName = destinationText.trim();
        const normalizedDestinationAddress = cleanOptionalText(destinationAddress);
        const nextDestination = normalizedDestinationName || normalizedDestinationAddress
            ? {
                name: normalizedDestinationName || normalizedDestinationAddress,
                address: normalizedDestinationAddress,
                lat: destinationLat,
                lng: destinationLng,
            }
            : undefined;
        const sessionId = `route-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        setRoutePlannerInitial(sessionId, {
            origin: undefined,
            destination: nextDestination,
            travelMode,
            travelMinutes,
            route,
            locationName: nextDestination?.name || undefined,
        });

        setPicker(null);
        setRoutePlannerSessionId(sessionId);
        setRoutePlannerHidden(true);
        closeSheet();
        router.push({ pathname: "/schedule/route-select", params: { sessionId } });
    }, [
        closeSheet,
        destinationAddress,
        destinationLat,
        destinationLng,
        destinationText,
        router,
        travelMinutes,
        travelMode,
        route,
    ]);

    const clearRoute = useCallback(() => {
        setOriginText("");
        setDestinationText("");
        setOriginAddress(undefined);
        setDestinationAddress(undefined);
        setOriginLat(undefined);
        setOriginLng(undefined);
        setDestinationLat(undefined);
        setDestinationLng(undefined);
        setTravelMinutes(undefined);
        setRoute(undefined);
        setNotificationEnabled(false);
    }, []);

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
                    closeSheet(onClose);
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
        }), [closeSheet, posY]);

    // 입력값을 일정 저장 payload로 변환해 상위 화면에 전달한다.
    const submit = async () => {
        const t = title.trim();
        if (!t || !category || submitting) return;

        const s = mergeDateTime(startDay, startTime);
        let e = hasEndTime ? mergeDateTime(endDay, endTime) : new Date(s);
        if (hasEndTime && e.getTime() < s.getTime()) {
            e = new Date(s);
            e.setMinutes(e.getMinutes() + 30);
        }
        const hasDistinctEndTime = e.getTime() !== s.getTime();
        const normalizedOriginName = originText.trim();
        const normalizedDestinationName = destinationText.trim();
        const normalizedOriginAddress = cleanOptionalText(originAddress);
        const normalizedDestinationAddress = cleanOptionalText(destinationAddress);
        const nextOrigin = normalizedOriginName || normalizedOriginAddress
            ? {
                name: normalizedOriginName || normalizedOriginAddress,
                address: normalizedOriginAddress,
                lat: originLat,
                lng: originLng,
            }
            : undefined;
        const nextDestination = normalizedDestinationName || normalizedDestinationAddress
            ? {
                name: normalizedDestinationName || normalizedDestinationAddress,
                address: normalizedDestinationAddress,
                lat: destinationLat,
                lng: destinationLng,
            }
            : undefined;
        const locationName = nextOrigin?.name && nextDestination?.name
            ? `${nextOrigin.name} → ${nextDestination.name}`
            : nextDestination?.name || nextOrigin?.name || undefined;

        try {
            setSubmitting(true);
            await onSubmit({
                title: t,
                startAt: s.toISOString(),
                endAt: e.toISOString(),
                hasEndTime: hasDistinctEndTime,
                category,
                travelMode,
                travelMinutes,
                route,
                notificationEnabled,
                notificationLeadMinutes: notificationEnabled ? notificationLeadMinutes : undefined,
                notificationIntervalMinutes: notificationEnabled ? notificationIntervalMinutes : undefined,
                locationName,
                origin: nextOrigin,
                destination: nextDestination,
                notes: notes.trim() || undefined,
            });
            closeSheet(onClose);
        } finally {
            setSubmitting(false);
        }
    };

    // 캘린더에서 선택한 날짜를 시작/종료 날짜에 반영한다.
    const onDayPress = useCallback((day: { dateString: string }) => {
        const selected = new Date(`${day.dateString}T00:00:00`);
        if (picker === "startDate") {
            setStartDay(selected);
        } else if (picker === "endDate") {
            setHasEndTime(true);
            setEndDay(selected);
            if (selected.getTime() < startDay.getTime()) setStartDay(selected);
        }
    }, [picker, startDay]);

    // 시간 피커에서 선택한 시간을 시작/종료 시간에 반영한다.
    const onTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
        if (Platform.OS === "android" && event.type === "dismissed") { setPicker(null); return; }
        if (!selected) return;
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
        ? ymdText(displayPicker === "startDate" ? startDay : endDay) : "";
    const fieldStyle = (type: PickerType) => [
        styles.fieldBase,
        {
            borderColor: picker === type ? colors.inputBorderFocused : colors.inputBorder,
            backgroundColor: colors.inputBackground,
        },
    ];
    const isMorphClosingVisual = morphClosing || morphClosingRef.current;
    const morphSourceContent = isMorphClosingVisual && sourceContent === "addMenu" ? "toolbar" : sourceContent;
    const morphVisibleSeedContent: "toolbar" | "addMenu" | "none" =
        isMorphClosingVisual && sourceContent === "addMenu"
            ? "none"
            : (isMorphClosingVisual ? "none" : (morphSourceContent === "addMenu" ? "none" : morphSourceContent));
    const morphSourceWidth = Math.max(
        44,
        morphSourceContent === "toolbar" ? MORPH_TOOLBAR_WIDTH : sourceWidth
    );
    const morphSourceHeight = Math.max(
        44,
        morphSourceContent === "toolbar" ? MORPH_TOOLBAR_HEIGHT : sourceHeight
    );
    const morphSourceRight = screenWidth - 16;
    const morphSourceLeft = screenWidth - 16 - morphSourceWidth;
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
    const morphInputRange = isMorphClosingVisual
        ? [0, 0.14, 0.3, 0.5, 0.68, 0.88, 1]
        : (morphSourceContent === "addMenu"
            ? [0, 0.08, 0.22, 0.44, 0.66, 0.86, 1]
            : [0, 0.16, 0.34, 0.54, 0.72, 0.9, 1]);
    const morphStageWidth1 = Math.min(morphTargetWidth, morphSourceWidth + (morphSourceContent === "addMenu" ? 24 : 18));
    const morphStageWidth2 = Math.min(morphTargetWidth, morphSourceWidth + (morphSourceContent === "addMenu" ? 58 : 42));
    const morphStageWidth3 = Math.min(morphTargetWidth, morphSourceWidth + (morphSourceContent === "addMenu" ? 92 : 72));
    const morphStageWidth4 = Math.min(
        morphTargetWidth,
        Math.max(
            morphStageWidth3,
            morphTargetWidth - (isMorphClosingVisual ? 190 : (morphSourceContent === "addMenu" ? 96 : 138))
        )
    );
    const morphStageWidth5 = Math.min(
        morphTargetWidth,
        Math.max(
            morphStageWidth4,
            morphTargetWidth - (isMorphClosingVisual ? 112 : (morphSourceContent === "addMenu" ? 32 : 44))
        )
    );
    const morphStageHeight1 = Math.min(morphTargetHeight, morphSourceHeight + (morphSourceContent === "addMenu" ? 18 : 16));
    const morphStageHeight2 = Math.min(morphTargetHeight, morphSourceHeight + (morphSourceContent === "addMenu" ? 56 : 44));
    const morphStageHeight3 = Math.min(morphTargetHeight, morphSourceHeight + (morphSourceContent === "addMenu" ? 116 : 98));
    const morphStageHeight4 = Math.min(
        morphTargetHeight,
        Math.max(
            morphStageHeight3,
            morphTargetHeight * (isMorphClosingVisual ? 0.36 : (morphSourceContent === "addMenu" ? 0.44 : 0.30))
        )
    );
    const morphStageHeight5 = Math.min(
        morphTargetHeight,
        Math.max(
            morphStageHeight4,
            isMorphClosingVisual ? morphTargetHeight * 0.72 : morphTargetHeight - (morphSourceContent === "addMenu" ? 62 : 86)
        )
    );
    const morphSourceRadius = Math.min(morphSourceHeight / 2, 32);
    const morphSheetStyle = useAnimatedStyle(() => ({
        left: interpolate(
            morphProgress.value,
            morphInputRange,
            [
                morphSourceLeft,
                morphSourceRight - morphStageWidth1,
                morphSourceRight - morphStageWidth2,
                morphSourceRight - morphStageWidth3,
                morphSourceRight - morphStageWidth4,
                morphSourceRight - morphStageWidth5,
                morphTargetLeft,
            ],
            Extrapolation.CLAMP
        ),
        top: interpolate(
            morphProgress.value,
            [0, 1],
            [morphSourceTop, morphTargetTop],
            Extrapolation.CLAMP
        ),
        width: interpolate(
            morphProgress.value,
            morphInputRange,
            [
                morphSourceWidth,
                morphStageWidth1,
                morphStageWidth2,
                morphStageWidth3,
                morphStageWidth4,
                morphStageWidth5,
                morphTargetWidth,
            ],
            Extrapolation.CLAMP
        ),
        height: interpolate(
            morphProgress.value,
            morphInputRange,
            [
                morphSourceHeight,
                morphStageHeight1,
                morphStageHeight2,
                morphStageHeight3,
                morphStageHeight4,
                morphStageHeight5,
                morphTargetHeight,
            ],
            Extrapolation.CLAMP
        ),
        borderRadius: interpolate(
            morphProgress.value,
            morphInputRange,
            [morphSourceRadius, morphSourceRadius + 4, 32, 38, 36, 31, 28],
            Extrapolation.CLAMP
        ),
    }), [
        morphInputRange,
        morphSourceLeft,
        morphSourceRight,
        morphStageWidth1,
        morphStageWidth2,
        morphStageWidth3,
        morphStageWidth4,
        morphStageWidth5,
        morphTargetLeft,
        morphSourceTop,
        morphTargetTop,
        morphSourceWidth,
        morphTargetWidth,
        morphSourceHeight,
        morphStageHeight1,
        morphStageHeight2,
        morphStageHeight3,
        morphStageHeight4,
        morphStageHeight5,
        morphTargetHeight,
        morphSourceRadius,
    ]);
    const morphDimStyle = useAnimatedStyle(() => ({
        opacity: interpolate(
            morphProgress.value,
            [0, 0.48, 1],
            [0, 0.04, 1],
            Extrapolation.CLAMP
        ),
    }));
    const morphSeedStyle = useAnimatedStyle(() => ({
        opacity: interpolate(
            morphProgress.value,
            isMorphClosingVisual ? [0, 0.08, 0.22, 0.36, 1] : [0, 0.70, 0.88, 1],
            isMorphClosingVisual ? [1, 1, 0.36, 0, 0] : [1, 1, 0.42, 0],
            Extrapolation.CLAMP
        ),
        transform: [
            {
                translateY: isMorphClosingVisual
                    ? 0
                    : interpolate(
                        morphProgress.value,
                        [0, 0.72],
                        [0, -3],
                        Extrapolation.CLAMP
                    ),
            },
        ],
    }), [isMorphClosingVisual]);
    const morphExitOpacityStyle = useAnimatedStyle(() => ({
        opacity: isMorphClosingVisual && sourceContent === "addMenu"
            ? interpolate(morphProgress.value, [0, 0.08, 0.24], [0, 0.12, 1], Extrapolation.CLAMP)
            : 1,
    }), [isMorphClosingVisual, sourceContent]);
    const morphContentStyle = useAnimatedStyle(() => ({
        opacity: interpolate(
            morphProgress.value,
            [0, 0.72, 1],
            [0, 0, 1],
            Extrapolation.CLAMP
        ),
        transform: [
            {
                translateY: interpolate(
                    morphProgress.value,
                    [0, 0.72, 1],
                    [10, 10, 0],
                    Extrapolation.CLAMP
                ),
            },
        ],
    }));

    if ((!visible && !rendered) || routePlannerHidden) {
        return null;
    }

    const SheetMotionView = (isMorphPresentation
        ? Reanimated.View
        : Animated.View) as React.ComponentType<any>;
    const SheetContentView = (isMorphPresentation
        ? Reanimated.View
        : Animated.View) as React.ComponentType<any>;
    const sheetMotionStyle = isMorphPresentation
        ? [styles.morphSheetMotion, morphSheetStyle, morphExitOpacityStyle]
        : [styles.sheetMotion, { maxHeight: sheetTargetHeight, transform: [{ translateY: posY }] }];

    return (
        <View
            style={[styles.wrapper, isMorphPresentation && styles.morphWrapper]}
            pointerEvents="box-none"
        >
            <Reanimated.View
                pointerEvents="auto"
                style={[styles.dim, isMorphPresentation && morphDimStyle]}
            >
                <Pressable
                    style={StyleSheet.absoluteFill}
                    onPress={() => closeSheet(onClose)}
                />
            </Reanimated.View>

            <SheetMotionView style={sheetMotionStyle}>
            <CalendarGlassSurface
                prominent
                variant="sheet"
                tone={isMorphPresentation ? "softGlass" : "solidCard"}
                clear={isMorphPresentation}
                style={[
                    styles.sheet,
                    isMorphPresentation && styles.morphSheet,
                    { borderColor: colors.border },
                ]}
            >
                {isMorphPresentation && (
                    <Reanimated.View
                        pointerEvents="none"
                        style={[styles.morphSeedContent, morphSeedStyle]}
                    >
                        {morphVisibleSeedContent === "toolbar" ? (
                            <View style={styles.morphToolbarSeedRow}>
                                <Ionicons name="reorder-two-outline" size={26} color={colors.textPrimary} />
                                <Ionicons name="search" size={23} color={colors.textPrimary} />
                                <Ionicons name="add" size={27} color={colors.textPrimary} />
                            </View>
                        ) : null}
                    </Reanimated.View>
                )}

                {(!isMorphPresentation || morphContentMounted) && (
                    <SheetContentView style={[
                        isMorphPresentation ? styles.morphInnerContent : styles.sheetInnerContent,
                        isMorphPresentation && morphContentStyle,
                    ]}>
                    <View
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
                            <View style={styles.headerTitleSpacer} />
                            <Pressable
                                onPress={() => closeSheet(onClose)}
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
                                ref={autoFocusTitle ? titleInputRef : undefined}
                                value={title}
                                onChangeText={setTitle}
                                placeholder="예) 회의"
                                placeholderTextColor={colors.inputPlaceholder}
                                style={[styles.titleInput, { color: colors.textPrimary }]}
                            />
                            <Pressable
                                onPress={() => setCategoryPickerOpen((current) => !current)}
                                disabled={categories.length === 0}
                                style={[styles.categoryInlineChip, { borderColor: colors.border }]}
                            >
                                <View style={[styles.categoryInlineDot, { backgroundColor: category?.color ?? "#8E8E93" }]} />
                                <Text numberOfLines={1} style={[styles.categoryInlineText, { color: colors.textPrimary }]}>
                                    {category?.title ?? "카테고리"}
                                </Text>
                            </Pressable>
                        </View>

                        {categoryPickerOpen && (
                            <CategoryPickerRow
                                categories={categories}
                                value={selectedCategoryId}
                                onChange={(nextCategoryId) => {
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
                                startAt={mergeDateTime(startDay, startTime)}
                                policy={subscriptionPolicy}
                                onEnabledChange={setNotificationEnabled}
                                onLeadMinutesChange={setNotificationLeadMinutes}
                                onIntervalMinutesChange={setNotificationIntervalMinutes}
                            />
                        )}

                        <View style={styles.twoColRow}>
                            <View style={styles.col}>
                                <Text style={[styles.label, { color: colors.textSecondary }]}>시작 날짜</Text>
                                <Pressable onPress={() => togglePicker("startDate")} style={fieldStyle("startDate")}>
                                    <Text style={[styles.fieldText, { color: colors.textPrimary }]}>{ymdText(startDay)}</Text>
                                </Pressable>
                            </View>
                            <View style={styles.col}>
                                <Text style={[styles.label, { color: colors.textSecondary }]}>시작 시간</Text>
                                <Pressable onPress={() => togglePicker("startTime")} style={fieldStyle("startTime")}>
                                    <Text style={[styles.fieldText, { color: colors.textPrimary }]}>{hhmmText(startTime)}</Text>
                                </Pressable>
                            </View>
                        </View>

                        <View style={styles.twoColRow}>
                            <View style={styles.col}>
                                <Text style={[styles.label, { color: colors.textSecondary }]}>종료 날짜</Text>
                                <Pressable onPress={() => togglePicker("endDate")} style={fieldStyle("endDate")}>
                                    <Text style={[styles.fieldText, { color: colors.textPrimary }]}>{ymdText(endDay)}</Text>
                                </Pressable>
                            </View>
                            <View style={styles.col}>
                                <Text style={[styles.label, { color: colors.textSecondary }]}>종료 시간</Text>
                                <Pressable onPress={() => togglePicker("endTime")} style={fieldStyle("endTime")}>
                                    <Text style={[styles.fieldText, { color: colors.textPrimary }]}>{hhmmText(endTime)}</Text>
                                </Pressable>
                            </View>
                        </View>

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
                            onChangeText={setNotes}
                            multiline
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
                            disabled={submitting}
                            onPress={submit}
                            style={[
                                styles.saveBtn,
                                {
                                    backgroundColor: mode === "dark"
                                        ? "#1E68FF"
                                        : "#2979FF",
                                    borderColor: mode === "dark" ? "#4B9DFF" : "#1E68FF",
                                    opacity: submitting ? 0.6 : 1,
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
                    </ScrollView>
                    </SheetContentView>
                )}
            </CalendarGlassSurface>
            </SheetMotionView>
        </View>
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
    },
    sheet: {
        maxHeight: "100%",
        borderRadius: 26,
        borderWidth: 1,
        overflow: "hidden",
    },
    morphSheet: {
        width: "100%",
        height: "100%",
        maxHeight: undefined,
    },
    morphSeedContent: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "flex-end",
        justifyContent: "flex-start",
        paddingHorizontal: 10,
        paddingVertical: 12,
        gap: 4,
    },
    morphSeedRow: {
        width: 218,
        maxWidth: "100%",
        height: 43,
        borderRadius: 18,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 12,
    },
    morphSeedText: {
        fontSize: 16,
        fontWeight: "700",
    },
    morphToolbarSeedRow: {
        width: "100%",
        height: "100%",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-around",
        paddingHorizontal: 13,
    },
    sheetInnerContent: { maxHeight: "100%" },
    morphInnerContent: { flex: 1 },
    handleWrap:    { alignItems: "center", paddingTop: 12, paddingBottom: 8 },
    handle:        { width: 44, height: 5, borderRadius: 3, opacity: 0.45 },
    scrollView: { maxHeight: "100%" },
    scrollContent: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24 },
    headerRow: {
        flexDirection: "row", alignItems: "center",
        justifyContent: "flex-end", marginBottom: 10,
    },
    headerTitle:  { fontSize: 18, fontWeight: "700" },
    headerTitleSpacer: { flex: 1 },
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
    input: {
        borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14,
    },
    titleInputWrap: {
        minHeight: 44,
        borderWidth: 1,
        borderRadius: 12,
        paddingLeft: 12,
        paddingRight: 8,
        marginBottom: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    titleInput: {
        flex: 1,
        minWidth: 0,
        paddingVertical: 11,
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
    notesInput: { minHeight: 84, textAlignVertical: "top" },
    twoColRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
    col:       { flex: 1 },
    fieldBase: {
        borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12,
    },
    fieldText:       { fontWeight: "700", fontSize: 13 },
    pickerContainer: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
    saveBtn: {
        paddingVertical: 15, borderRadius: 12,
        alignItems: "center", marginTop: 4,
        borderWidth: 1,
    },
    saveBtnText: { fontWeight: "700", fontSize: 15 },
});
