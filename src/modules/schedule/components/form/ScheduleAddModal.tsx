import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
    ActivityIndicator,
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

import type { ScheduleCategory, ScheduleItem, ScheduleParseResult, TravelMode } from "../../types";
import { useTheme } from "../../../theme/ThemeContext";
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
    onQuickParse?: (text: string) => void | Promise<void>;
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
const DATE_H         = 312;
const TIME_H         = 216;

type PickerType = "startDate" | "endDate" | "startTime" | "endTime";

const isDateType = (t: PickerType | null): boolean =>
    t === "startDate" || t === "endDate";

const pickerTargetH = (t: PickerType | null): number =>
    t !== null && isDateType(t) ? DATE_H : TIME_H;

// 새 일정을 입력하고 저장하는 바텀시트 화면을 렌더링한다.
export default function ScheduleNewModal({
    visible,
    onClose,
    onSubmit,
    categories,
    defaultDay,
    initialValues,
    onQuickParse,
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
    const [quickExpanded, setQuickExpanded]           = useState(false);
    const [quickText, setQuickText]                   = useState("");
    const [quickParsing, setQuickParsing]             = useState(false);

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
            setQuickExpanded(false);
            setQuickText("");
            setQuickParsing(false);
        }
    }, [visible]);

    useEffect(() => {
        if (!visible || !initialValues) return;

        setTitle(initialValues.title ?? "");
        setNotes(initialValues.notes ?? "");

        setOriginText(initialValues.origin?.name ?? "");
        setOriginAddress(initialValues.origin?.address);
        setOriginLat(initialValues.origin?.lat);
        setOriginLng(initialValues.origin?.lng);
        setDestinationText(initialValues.destination?.name ?? "");
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

    const applyQuickSchedule = async () => {
        const normalized = quickText.trim();
        if (!normalized || quickParsing || !onQuickParse) return;

        try {
            setQuickParsing(true);
            await onQuickParse(normalized);
            setQuickExpanded(false);
            setQuickText("");
        } catch {
            // 상위 화면에서 오류 안내를 표시하고 입력값은 유지한다.
        } finally {
            setQuickParsing(false);
        }
    };

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
            toValue: 0, useNativeDriver: true, damping: 18, stiffness: 180, mass: 1,
        }).start();
    }, [posY]);

    const closeSheet = useCallback((after?: () => void) => {
        Animated.timing(posY, {
            toValue: SHEET_HIDDEN_Y, duration: 280, useNativeDriver: true,
        }).start(({ finished }) => { if (finished) after?.(); });
    }, [posY]);

    useEffect(() => {
        if (visible) { posY.setValue(SHEET_HIDDEN_Y); openSheet(); }
    }, [visible, openSheet, posY]);

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

    // 현재 입력된 출발/도착 정보를 경로 선택 화면으로 전달한다.
    const openRoutePlanner = useCallback(() => {
        const normalizedOriginName = originText.trim();
        const normalizedDestinationName = destinationText.trim();
        const sessionId = `route-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        setRoutePlannerInitial(sessionId, {
            origin: normalizedOriginName
                ? { name: normalizedOriginName, address: originAddress, lat: originLat, lng: originLng }
                : undefined,
            destination: normalizedDestinationName
                ? { name: normalizedDestinationName, address: destinationAddress, lat: destinationLat, lng: destinationLng }
                : undefined,
            travelMode,
            travelMinutes,
            route,
            locationName: normalizedOriginName && normalizedDestinationName
                ? `${normalizedOriginName} → ${normalizedDestinationName}`
                : normalizedDestinationName || normalizedOriginName || undefined,
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
        originAddress,
        originLat,
        originLng,
        originText,
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
            onMoveShouldSetPanResponder: (_, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
            onMoveShouldSetPanResponderCapture:  () => false,
            onPanResponderMove: (_, g) => { posY.setValue(Math.max(0, g.dy)); },
            onPanResponderRelease: (_, g) => {
                if (g.dy > 100 || g.vy > 0.8) {
                    Animated.timing(posY, {
                        toValue: SHEET_HIDDEN_Y, duration: 220, useNativeDriver: true,
                    }).start(({ finished }) => { if (finished) onCloseRef.current(); });
                } else {
                    Animated.spring(posY, {
                        toValue: 0, useNativeDriver: true, damping: 18, stiffness: 180, mass: 1,
                    }).start();
                }
            },
            onPanResponderTerminate: () => {
                Animated.spring(posY, {
                    toValue: 0, useNativeDriver: true, damping: 18, stiffness: 180, mass: 1,
                }).start();
            },
        }), [posY]);

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
        const locationName = normalizedOriginName && normalizedDestinationName
            ? `${normalizedOriginName} → ${normalizedDestinationName}`
            : normalizedDestinationName || normalizedOriginName || undefined;

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
                origin: normalizedOriginName
                    ? { name: normalizedOriginName, address: originAddress, lat: originLat, lng: originLng }
                    : undefined,
                destination: normalizedDestinationName
                    ? { name: normalizedDestinationName, address: destinationAddress, lat: destinationLat, lng: destinationLng }
                    : undefined,
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

    const fieldStyle = (type: PickerType) => [
        styles.fieldBase,
        { borderColor: picker === type ? colors.selectedDayBg : colors.border, backgroundColor: colors.surface2 },
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

            <Animated.View style={[styles.sheet, {
                backgroundColor: colors.surface,
                borderTopColor:  colors.border,
                transform: [{ translateY: posY }],
            }]}>
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
                                style={[styles.closeBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
                            >
                                <Text style={[styles.closeBtnText, { color: colors.textPrimary }]}>닫기</Text>
                            </Pressable>
                        </View>

                        <View
                            style={[
                                styles.quickSection,
                                { borderColor: colors.border, backgroundColor: colors.surface2 },
                            ]}
                        >
                            <Pressable
                                onPress={() => setQuickExpanded((expanded) => !expanded)}
                                style={styles.quickHeader}
                            >
                                <View style={styles.quickHeaderTitle}>
                                    {/*<Ionicons name="flash-outline" size={18} color={colors.textPrimary} />*/}
                                    <Text style={[styles.quickTitle, { color: colors.textPrimary }]}>
                                        빠른 일정 생성
                                    </Text>
                                </View>
                                <Ionicons
                                    name={quickExpanded ? "chevron-up" : "chevron-down"}
                                    size={18}
                                    color={colors.textSecondary}
                                />
                            </Pressable>

                            {quickExpanded && (
                                <View style={[styles.quickBody, { borderTopColor: colors.border }]}>
                                    <TextInput
                                        autoFocus
                                        editable={!quickParsing}
                                        value={quickText}
                                        onChangeText={setQuickText}
                                        onSubmitEditing={applyQuickSchedule}
                                        placeholder="예) 금요일 오후 7시 강남역에서 저녁"
                                        placeholderTextColor={colors.textDisabled}
                                        returnKeyType="done"
                                        style={[
                                            styles.quickInput,
                                            {
                                                borderColor: colors.border,
                                                backgroundColor: colors.surface,
                                                color: colors.textPrimary,
                                            },
                                        ]}
                                    />
                                    <Pressable
                                        disabled={!quickText.trim() || quickParsing}
                                        onPress={applyQuickSchedule}
                                        style={({ pressed }) => [
                                            styles.quickApplyButton,
                                            {
                                                backgroundColor: colors.selectedDayBg,
                                                opacity: !quickText.trim() || quickParsing ? 0.4 : pressed ? 0.75 : 1,
                                            },
                                        ]}
                                    >
                                        {quickParsing ? (
                                            <ActivityIndicator size="small" color={colors.selectedDayText} />
                                        ) : (
                                            <Text style={[styles.quickApplyText, { color: colors.selectedDayText }]}>
                                                적용
                                            </Text>
                                        )}
                                    </Pressable>
                                </View>
                            )}
                        </View>

                        <Text style={[styles.label, { color: colors.textSecondary }]}>제목</Text>
                        <TextInput
                            value={title}
                            onChangeText={setTitle}
                            placeholder="예) 회의"
                            placeholderTextColor={colors.textDisabled}
                            style={[styles.input, { borderColor: colors.border, backgroundColor: colors.surface2, color: colors.textPrimary }]}
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
                                { borderColor: colors.border, backgroundColor: colors.surface2, color: colors.textPrimary },
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
                            style={[styles.saveBtn, { backgroundColor: colors.selectedDayBg, opacity: submitting ? 0.6 : 1 }]}
                        >
                            <Text style={[styles.saveBtnText, { color: colors.selectedDayText }]}>
                                {submitting ? "저장 중" : "저장"}
                            </Text>
                        </Pressable>
                </ScrollView>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper:  {
        ...StyleSheet.absoluteFillObject,
        justifyContent: "flex-end",
        zIndex: 20,
        elevation: 20,
    },
    dim:      { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
    sheet: {
        maxHeight: "90%",
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        borderTopWidth: 1, overflow: "hidden",
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
    quickSection: {
        borderWidth: 1,
        borderRadius: 14,
        overflow: "hidden",
        marginBottom: 18,
    },
    quickHeader: {
        minHeight: 50,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    quickHeaderTitle: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    quickTitle: {
        fontSize: 14,
        fontWeight: "800",
    },
    quickBody: {
        borderTopWidth: StyleSheet.hairlineWidth,
        padding: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    quickInput: {
        flex: 1,
        height: 44,
        borderWidth: 1,
        borderRadius: 11,
        paddingHorizontal: 12,
        fontSize: 14,
    },
    quickApplyButton: {
        width: 58,
        height: 44,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
    },
    quickApplyText: {
        fontSize: 13,
        fontWeight: "800",
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
    },
    saveBtnText: { fontWeight: "700", fontSize: 15 },
});
