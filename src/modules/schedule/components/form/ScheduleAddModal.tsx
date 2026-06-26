import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
    Platform,
    StyleSheet,
    Animated,
    PanResponder,
} from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Calendar } from "react-native-calendars";
import { usePathname, useRouter } from "expo-router";

import type { Place, ScheduleCategory, ScheduleItem, ScheduleParseResult, TravelMode } from "../../types";
import { searchAddressByKeyword } from "../../../map/tmapApi";
import { useTheme } from "../../../theme/ThemeContext";
import CalendarGlassSurface from "../calendar/CalendarGlassSurface";
import { consumeRoutePlannerResult, setRoutePlannerInitial } from "../../routePlannerSession";
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

const SHEET_HIDDEN_Y = 620;
const SHEET_CLOSE_DISTANCE = 118;
const SHEET_CLOSE_VELOCITY = 0.85;
const SHEET_VELOCITY_PROJECTION = 120;
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
}: Props) {
    const router = useRouter();
    const pathname = usePathname();
    const { colors, mode } = useTheme();
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
    const titleInputRef = useRef<TextInput>(null);

    const [startDay,  setStartDay]  = useState(() => new Date(`${defaultDay}T00:00:00`));
    const [endDay,    setEndDay]    = useState(() => new Date(`${defaultDay}T00:00:00`));
    const [startTime, setStartTime] = useState(() => new Date(initialStartTime));
    const [endTime, setEndTime] = useState(() => new Date(initialStartTime));

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
            setTitle(""); setNotes("");
            setOriginText(""); setDestinationText(""); setPicker(null);
            setOriginLat(undefined); setOriginLng(undefined);
            setDestinationLat(undefined); setDestinationLng(undefined);
            setOriginAddress(undefined); setDestinationAddress(undefined);
            setTravelMode("CAR"); setTravelMinutes(undefined);
            setRoute(undefined);
            setHasEndTime(false);
            setNotificationEnabled(false);
            setNotificationLeadMinutes(60);
            setNotificationIntervalMinutes(30);
            setRoutePlannerSessionId(undefined);
            setSubmitting(false);
            setRoutePlannerHidden(false);
        }
    }, [visible]);

    useEffect(() => {
        if (!visible || !initialValues) return;

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
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    const openSheet = useCallback(() => {
        Animated.spring(posY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 24,
            stiffness: 230,
            mass: 0.9,
            restDisplacementThreshold: 0.35,
            restSpeedThreshold: 0.35,
        }).start();
    }, [posY]);

    const closeSheet = useCallback((after?: () => void) => {
        Animated.spring(posY, {
            toValue: SHEET_HIDDEN_Y,
            useNativeDriver: true,
            damping: 28,
            stiffness: 240,
            mass: 0.95,
            restDisplacementThreshold: 0.45,
            restSpeedThreshold: 0.45,
        }).start(({ finished }) => { if (finished) after?.(); });
    }, [posY]);

    useEffect(() => {
        if (visible) { posY.setValue(SHEET_HIDDEN_Y); openSheet(); }
    }, [visible, openSheet, posY]);

    useEffect(() => {
        if (!visible || !autoFocusTitle) return;
        const timer = setTimeout(() => titleInputRef.current?.focus(), 420);
        return () => clearTimeout(timer);
    }, [autoFocusTitle, visible]);

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
            posY.setValue(SHEET_HIDDEN_Y);
            openSheet();
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
        posY.setValue(SHEET_HIDDEN_Y);
        openSheet();
    }, [openSheet, pathname, posY, routePlannerSessionId, visible]);

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
                    closeSheet(() => onCloseRef.current());
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
            closeSheet(() => onCloseRef.current());
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
    const previewTitle = title.trim() || "새 일정";
    const previewTime = hasEndTime
        ? `${ymdText(startDay)} ${hhmmText(startTime)} - ${hhmmText(endTime)}`
        : `${ymdText(startDay)} ${hhmmText(startTime)}`;
    const previewLocation = destinationText.trim() || originText.trim() || "장소 미정";
    const previewEta = typeof travelMinutes === "number"
        ? `${travelMinutes}분 이동 · ${travelMode}`
        : "ETA 미계산";
    const previewNotification = notificationEnabled
        ? `${notificationLeadMinutes}분 전 알림`
        : "알림 꺼짐";

    const fieldStyle = (type: PickerType) => [
        styles.fieldBase,
        {
            borderColor: picker === type ? colors.selectedDayBg : colors.border,
            backgroundColor: mode === "dark"
                ? "rgba(255,255,255,0.07)"
                : "rgba(118,118,128,0.10)",
        },
    ];

    if (!visible || routePlannerHidden) {
        return null;
    }

    return (
        <View
            style={styles.wrapper}
            pointerEvents="box-none"
        >
            <Pressable style={styles.dim} onPress={() => closeSheet(() => onCloseRef.current())} />

            <Animated.View style={[styles.sheetMotion, {
                transform: [{ translateY: posY }],
            }]}>
            <CalendarGlassSurface
                prominent
                variant="sheet"
                style={[styles.sheet, { borderColor: colors.border }]}
            >
                <View {...panResponder.panHandlers} style={styles.handleWrap}>
                    <View style={[styles.handle, { backgroundColor: colors.border }]} />
                </View>

                <ScrollView
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.scrollContent}
                >
                        <View style={styles.headerRow}>
                            <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>새 일정</Text>
                            <Pressable
                                onPress={() => closeSheet(() => onCloseRef.current())}
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

                        <CalendarGlassSurface
                            variant="card"
                            style={[styles.previewCard, { borderColor: colors.border }]}
                        >
                            <View style={[styles.previewColorBar, { backgroundColor: category?.color ?? "#8E8E93" }]} />
                            <View style={styles.previewBody}>
                                <Text numberOfLines={1} style={[styles.previewTitle, { color: colors.textPrimary }]}>
                                    {previewTitle}
                                </Text>
                                <Text numberOfLines={1} style={[styles.previewMeta, { color: colors.textSecondary }]}>
                                    {previewTime}
                                </Text>
                                <View style={styles.previewChipRow}>
                                    <View style={[styles.previewChip, { borderColor: colors.border }]}>
                                        <Text numberOfLines={1} style={[styles.previewChipText, { color: colors.textPrimary }]}>
                                            {previewLocation}
                                        </Text>
                                    </View>
                                    <View style={[styles.previewChip, { borderColor: colors.border }]}>
                                        <Text numberOfLines={1} style={[styles.previewChipText, { color: colors.textPrimary }]}>
                                            {previewEta}
                                        </Text>
                                    </View>
                                </View>
                                <Text numberOfLines={1} style={[styles.previewSub, { color: colors.textSecondary }]}>
                                    {category?.title ?? "캘린더"} · {previewNotification}
                                </Text>
                            </View>
                        </CalendarGlassSurface>

                        <Text style={[styles.label, { color: colors.textSecondary }]}>제목</Text>
                        <TextInput
                            ref={titleInputRef}
                            value={title}
                            onChangeText={setTitle}
                            placeholder="예) 회의"
                            placeholderTextColor={colors.textDisabled}
                            style={[
                                styles.input,
                                {
                                    borderColor: colors.border,
                                    backgroundColor: mode === "dark"
                                        ? "rgba(255,255,255,0.07)"
                                        : "rgba(118,118,128,0.10)",
                                    color: colors.textPrimary,
                                },
                            ]}
                        />

                        <LocationInputRow
                            originValue={originText}
                            destinationValue={destinationText}
                            travelMode={travelMode}
                            travelMinutes={travelMinutes}
                            onPress={openRoutePlanner}
                        />

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
                            borderColor:  colors.border,
                            backgroundColor: mode === "dark"
                                ? "rgba(255,255,255,0.045)"
                                : "rgba(255,255,255,0.34)",
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

                        <CategoryPickerRow
                            categories={categories}
                            value={selectedCategoryId}
                            onChange={setSelectedCategoryId}
                            onManageCategories={onManageCategories}
                        />

                        <Text style={[styles.label, { color: colors.textSecondary }]}>메모</Text>
                        <TextInput
                            value={notes}
                            onChangeText={setNotes}
                            multiline
                            placeholder="추가로 기억할 내용을 입력하세요"
                            placeholderTextColor={colors.textDisabled}
                            style={[
                                styles.input,
                                styles.notesInput,
                                {
                                    borderColor: colors.border,
                                    backgroundColor: mode === "dark"
                                        ? "rgba(255,255,255,0.07)"
                                        : "rgba(118,118,128,0.10)",
                                    color: colors.textPrimary,
                                },
                            ]}
                        />

                        <NotificationSettingsCard
                            routeReady={
                                typeof originLat === "number" &&
                                typeof originLng === "number" &&
                                typeof destinationLat === "number" &&
                                typeof destinationLng === "number"
                            }
                            enabled={notificationEnabled}
                            leadMinutes={notificationLeadMinutes}
                            intervalMinutes={notificationIntervalMinutes}
                            policy={subscriptionPolicy}
                            onEnabledChange={setNotificationEnabled}
                            onLeadMinutesChange={setNotificationLeadMinutes}
                            onIntervalMinutesChange={setNotificationIntervalMinutes}
                        />

                        <Pressable
                            disabled={submitting}
                            onPress={submit}
                            style={[
                                styles.saveBtn,
                                {
                                    backgroundColor: mode === "dark"
                                        ? "rgba(33,184,90,0.20)"
                                        : "rgba(33,184,90,0.14)",
                                    borderColor: "rgba(33,184,90,0.44)",
                                    opacity: submitting ? 0.6 : 1,
                                },
                            ]}
                        >
                            <Text style={[
                                styles.saveBtnText,
                                { color: mode === "dark" ? "#41D879" : "#0F7A38" },
                            ]}>
                                {submitting ? "저장 중" : "저장"}
                            </Text>
                        </Pressable>
                </ScrollView>
            </CalendarGlassSurface>
            </Animated.View>
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
    dim:      { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
    sheetMotion: {
        maxHeight: "90%",
    },
    sheet: {
        maxHeight: "90%",
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        borderWidth: 1, overflow: "hidden",
    },
    handleWrap:    { alignItems: "center", paddingVertical: 14 },
    handle:        { width: 44, height: 5, borderRadius: 3 },
    scrollContent: { paddingHorizontal: 20, paddingBottom: 16 },
    headerRow: {
        flexDirection: "row", alignItems: "center",
        justifyContent: "space-between", marginBottom: 20,
    },
    headerTitle:  { fontSize: 18, fontWeight: "700" },
    closeBtn:     { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1 },
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
    label:        { marginBottom: 6, fontSize: 13 },
    input: {
        borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14,
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
        paddingVertical: 14, borderRadius: 14,
        alignItems: "center", marginTop: 8,
        borderWidth: 1,
    },
    saveBtnText: { fontWeight: "700", fontSize: 15 },
});
