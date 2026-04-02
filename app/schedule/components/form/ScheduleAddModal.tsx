import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Modal,
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

import type { ScheduleCategory, ScheduleItem, TravelMode } from "../../../../src/modules/schedule/types";
import { useTheme } from "../../../../src/modules/theme/ThemeContext";
import { consumeRoutePlannerResult, setRoutePlannerInitial } from "../../../../src/modules/schedule/routePlannerSession";
import CategoryPickerRow from "./CategorySelectBox";
import LocationInputRow from "./LocationInputRow";

type Props = {
    visible: boolean;
    onClose: () => void;
    onSubmit: (payload: Omit<ScheduleItem, "id">) => void;
    categories: ScheduleCategory[];
    defaultDay: string;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

function setYmd(base: Date, ymd: string) {
    const [y, m, d] = ymd.split("-").map(Number);
    const next = new Date(base);
    next.setFullYear(y, m - 1, d);
    return next;
}

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
const DATE_H         = 312; // Calendar 영역 높이 (헤더 44 + 요일행 32 + 주행 6×36 = ~292, 여유 20)
const TIME_H         = 216; // DateTimePicker spinner 영역 높이

type PickerType = "startDate" | "endDate" | "startTime" | "endTime";

const isDateType = (t: PickerType | null): boolean =>
    t === "startDate" || t === "endDate";

const pickerTargetH = (t: PickerType | null): number =>
    t !== null && isDateType(t) ? DATE_H : TIME_H;

export default function ScheduleNewModal({
    visible,
    onClose,
    onSubmit,
    categories,
    defaultDay,
}: Props) {
    const router = useRouter();
    const pathname = usePathname();
    const { colors, mode } = useTheme();
    const now = useMemo(() => new Date(), []);

    const [title, setTitle]                           = useState("");
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
    const [routePlannerSessionId, setRoutePlannerSessionId] = useState<string | undefined>();

    const [startDay,  setStartDay]  = useState(() => new Date(`${defaultDay}T00:00:00`));
    const [endDay,    setEndDay]    = useState(() => new Date(`${defaultDay}T00:00:00`));
    const [startTime, setStartTime] = useState(() => {
        const d = new Date(now); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 30); return d;
    });
    const [endTime, setEndTime] = useState(() => {
        const d = new Date(now); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 60); return d;
    });

    // picker  : 실제 선택 상태 (로직)
    // displayPicker : UI 에 렌더링할 타입 (fade 후 교체)
    const [picker,        setPicker]        = useState<PickerType | null>(null);
    const [displayPicker, setDisplayPicker] = useState<PickerType | null>(null);

    useEffect(() => {
        setStartDay((prev) => setYmd(prev, defaultDay));
        setEndDay((prev)   => setYmd(prev, defaultDay));
    }, [defaultDay]);

    useEffect(() => {
        if (!visible) {
            setTitle(""); setOriginText(""); setDestinationText(""); setPicker(null);
            setOriginLat(undefined); setOriginLng(undefined);
            setDestinationLat(undefined); setDestinationLng(undefined);
            setOriginAddress(undefined); setDestinationAddress(undefined);
            setTravelMode("CAR"); setTravelMinutes(undefined);
            setRoutePlannerSessionId(undefined);
        }
    }, [visible]);

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
            locationName: normalizedOriginName && normalizedDestinationName
                ? `${normalizedOriginName} → ${normalizedDestinationName}`
                : normalizedDestinationName || normalizedOriginName || undefined,
        });

        setRoutePlannerSessionId(sessionId);
        router.push({ pathname: "/schedule/route-planner", params: { sessionId } });
    }, [
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
    ]);

    useEffect(() => {
        if (!visible || !routePlannerSessionId || pathname === "/schedule/route-planner") return;
        const result = consumeRoutePlannerResult(routePlannerSessionId);
        if (!result) return;

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
        setRoutePlannerSessionId(undefined);
    }, [pathname, routePlannerSessionId, visible]);

    const category = useMemo(
        () => categories.find((c) => c.id === selectedCategoryId) ?? categories[0],
        [categories, selectedCategoryId]
    );

    /** 같은 필드 탭 → 토글 닫기 */
    const togglePicker = useCallback((type: PickerType) => {
        setPicker((prev) => (prev === type ? null : type));
    }, []);

    /**
     * ──────────────────────────────────────────────────────────
     *  Picker 애니메이션
     *  heightAnim   : 컨테이너 높이 (px)
     *  outerOpacity : 컨테이너 투명도 (열기/닫기)
     *  contentFade  : 내부 콘텐츠 투명도 (타입 전환 시 크로스페이드)
     * ──────────────────────────────────────────────────────────
     */
    const heightAnim   = useRef(new Animated.Value(0)).current;
    const outerOpacity = useRef(new Animated.Value(0)).current;
    const contentFade  = useRef(new Animated.Value(1)).current;
    const prevPickerRef = useRef<PickerType | null>(null);

    useEffect(() => {
        const prev = prevPickerRef.current;
        prevPickerRef.current = picker;

        if (picker !== null && prev === null) {
            // ── 열기 ────────────────────────────────────────
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
            // ── 닫기 ────────────────────────────────────────
            Animated.parallel([
                Animated.timing(heightAnim,   { toValue: 0, duration: 220, useNativeDriver: false }),
                Animated.timing(outerOpacity, { toValue: 0, duration: 180, useNativeDriver: false }),
            ]).start(({ finished }) => {
                if (finished) setDisplayPicker(null);
            });

        } else if (picker !== null && prev !== null) {
            if (isDateType(picker) !== isDateType(prev)) {
                // ── 날짜 ↔ 시간 전환: fade out → 교체 → height + fade in ──
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
                // ── 같은 카테고리 전환 (시작↔종료): 높이 변화 없음, 즉시 교체 ──
                setDisplayPicker(picker);
            }
        }
    }, [picker, contentFade, heightAnim, outerOpacity]);

    /**
     * ──────────────────────────────
     *  Bottom Sheet — 단일 posY
     * ──────────────────────────────
     */
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

    /** PanResponder — 핸들바 전용 */
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

    /** Submit */
    const submit = () => {
        const t = title.trim();
        if (!t || !category) return;

        const s = mergeDateTime(startDay, startTime);
        let   e = mergeDateTime(endDay, endTime);
        if (e.getTime() <= s.getTime()) { e = new Date(s); e.setMinutes(e.getMinutes() + 30); }
        const normalizedOriginName = originText.trim();
        const normalizedDestinationName = destinationText.trim();
        const locationName = normalizedOriginName && normalizedDestinationName
            ? `${normalizedOriginName} → ${normalizedDestinationName}`
            : normalizedDestinationName || normalizedOriginName || undefined;

        onSubmit({
            title: t, startAt: s.toISOString(), endAt: e.toISOString(), category,
            travelMode,
            travelMinutes,
            locationName,
            origin: normalizedOriginName
                ? { name: normalizedOriginName, address: originAddress, lat: originLat, lng: originLng }
                : undefined,
            destination: normalizedDestinationName
                ? { name: normalizedDestinationName, address: destinationAddress, lat: destinationLat, lng: destinationLng }
                : undefined,
        });
        closeSheet(() => onCloseRef.current());
    };

    /**
     * 날짜 선택 — outFocus 시 닫힘 (Apple Calendar 동작)
     */
    const onDayPress = useCallback((day: { dateString: string }) => {
        const selected = new Date(`${day.dateString}T00:00:00`);
        if (picker === "startDate") {
            setStartDay(selected);
            if (selected.getTime() > endDay.getTime()) setEndDay(selected);
        } else if (picker === "endDate") {
            setEndDay(selected);
            if (selected.getTime() < startDay.getTime()) setStartDay(selected);
        }
    }, [picker, startDay, endDay]);

    /** 시간 — 완료 버튼 없이 즉시 반영 */
    const onTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
        if (Platform.OS === "android" && event.type === "dismissed") { setPicker(null); return; }
        if (!selected) return;
        if (picker === "startTime") setStartTime(selected);
        else if (picker === "endTime") setEndTime(selected);
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

    return (
        <Modal
            visible={visible}
            animationType="none"
            transparent
            presentationStyle="overFullScreen"
            onRequestClose={() => closeSheet(() => onCloseRef.current())}
        >
            <View style={styles.wrapper} pointerEvents="box-none">
                <Pressable style={styles.dim} onPress={() => closeSheet(() => onCloseRef.current())} />

                <Animated.View style={[styles.sheet, {
                    backgroundColor: colors.surface,
                    borderTopColor:  colors.border,
                    transform: [{ translateY: posY }],
                }]}>
                    {/* 핸들바 — PanResponder 전용 */}
                    <View {...panResponder.panHandlers} style={styles.handleWrap}>
                        <View style={[styles.handle, { backgroundColor: colors.border }]} />
                    </View>

                    <ScrollView
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={styles.scrollContent}
                    >
                        {/* 헤더 */}
                        <View style={styles.headerRow}>
                            <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>새 일정</Text>
                            <Pressable
                                onPress={() => closeSheet(() => onCloseRef.current())}
                                style={[styles.closeBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
                            >
                                <Text style={[styles.closeBtnText, { color: colors.textPrimary }]}>닫기</Text>
                            </Pressable>
                        </View>

                        {/* 제목 */}
                        <Text style={[styles.label, { color: colors.textSecondary }]}>제목</Text>
                        <TextInput
                            value={title}
                            onChangeText={setTitle}
                            placeholder="예) 회의"
                            placeholderTextColor={colors.textDisabled}
                            style={[styles.input, { borderColor: colors.border, backgroundColor: colors.surface2, color: colors.textPrimary }]}
                        />

                        {/* 출발지 / 도착지 — 1행 */}
                        <LocationInputRow
                            originValue={originText}
                            destinationValue={destinationText}
                            travelMode={travelMode}
                            travelMinutes={travelMinutes}
                            onPress={openRoutePlanner}
                        />

                        {/* 시작 날짜 / 시간 */}
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

                        {/* 종료 날짜 / 시간 */}
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

                        {/* 피커 영역 */}
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

                        {/* 카테고리 */}
                        <CategoryPickerRow
                            categories={categories}
                            value={selectedCategoryId}
                            onChange={setSelectedCategoryId}
                        />

                        {/* 저장 */}
                        <Pressable
                            onPress={submit}
                            style={[styles.saveBtn, { backgroundColor: colors.selectedDayBg }]}
                        >
                            <Text style={[styles.saveBtnText, { color: colors.selectedDayText }]}>저장</Text>
                        </Pressable>
                    </ScrollView>
                </Animated.View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    wrapper:  { flex: 1, justifyContent: "flex-end" },
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
    label:        { marginBottom: 6, fontSize: 13 },
    input: {
        borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14,
    },
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
