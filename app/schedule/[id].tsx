import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Pressable, Text, TextInput, View,
    Alert, Platform, ScrollView, StyleSheet, Animated,
} from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Calendar } from "react-native-calendars";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useScheduleStore } from "../../src/modules/schedule/store";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { fromISO } from "../../lib/util/data";
import type { ScheduleCategory, TravelMode } from "../../src/modules/schedule/types";
import { consumeRoutePlannerResult, setRoutePlannerInitial } from "../../src/modules/schedule/routePlannerSession";
import CategoryPickerRow from "./components/form/CategorySelectBox";
import LocationInputRow from "./components/form/LocationInputRow";

const pad2    = (n: number) => String(n).padStart(2, "0");
const ymdText = (d: Date)   => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const hhmmText = (d: Date)  => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

function mergeDateTime(datePart: Date, timePart: Date) {
    const d = new Date(datePart);
    d.setHours(timePart.getHours(), timePart.getMinutes(), 0, 0);
    return d;
}

const DATE_H = 312;
const TIME_H = 216;

type PickerType = "startDate" | "endDate" | "startTime" | "endTime";

const isDateType    = (t: PickerType | null): boolean => t === "startDate" || t === "endDate";
const pickerTargetH = (t: PickerType | null): number  => t !== null && isDateType(t) ? DATE_H : TIME_H;

export default function ScheduleDetail() {
    const { id }     = useLocalSearchParams<{ id: string }>();
    const pathname = usePathname();
    const router     = useRouter();
    const insets     = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const { state, dispatch } = useScheduleStore();

    const item = id ? state.itemsById[id] : undefined;

    const [title,           setTitle]           = useState(item?.title ?? "");
    const [categoryId,      setCategoryId]      = useState(item?.category?.id ?? state.categories[0]?.id ?? "1");
    const [originText,      setOriginText]      = useState(item?.origin?.name ?? "");
    const [destinationText, setDestinationText] = useState(item?.destination?.name ?? "");
    const [originAddress, setOriginAddress]     = useState(item?.origin?.address);
    const [destinationAddress, setDestinationAddress] = useState(item?.destination?.address);
    const [originLat, setOriginLat]             = useState<number | undefined>(item?.origin?.lat);
    const [originLng, setOriginLng]             = useState<number | undefined>(item?.origin?.lng);
    const [destinationLat, setDestinationLat]   = useState<number | undefined>(item?.destination?.lat);
    const [destinationLng, setDestinationLng]   = useState<number | undefined>(item?.destination?.lng);
    const [travelMode, setTravelMode]           = useState<TravelMode>(item?.travelMode ?? "CAR");
    const [travelMinutes, setTravelMinutes]     = useState<number | undefined>(item?.travelMinutes);
    const [routePlannerSessionId, setRoutePlannerSessionId] = useState<string | undefined>();

    const [startDay,  setStartDay]  = useState(() =>
        item ? new Date(fromISO(item.startAt).toISOString().slice(0, 10) + "T00:00:00") : new Date()
    );
    const [endDay,    setEndDay]    = useState(() =>
        item ? new Date(fromISO(item.endAt).toISOString().slice(0, 10)   + "T00:00:00") : new Date()
    );
    const [startTime, setStartTime] = useState(() => item ? fromISO(item.startAt) : new Date());
    const [endTime,   setEndTime]   = useState(() => item ? fromISO(item.endAt)   : new Date());

    // picker  : 로직 상태  |  displayPicker : UI 렌더 상태 (fade 후 교체)
    const [picker,        setPicker]        = useState<PickerType | null>(null);
    const [displayPicker, setDisplayPicker] = useState<PickerType | null>(null);

    const category = useMemo<ScheduleCategory | undefined>(
        () => state.categories.find((c) => c.id === categoryId) ?? state.categories[0],
        [state.categories, categoryId]
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
     *  contentFade  : 내부 콘텐츠 투명도 (타입 전환 크로스페이드)
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
                // ── 같은 카테고리 (시작↔종료): 즉시 교체 ──
                setDisplayPicker(picker);
            }
        }
    }, [picker, contentFade, heightAnim, outerOpacity]);

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
        if (!routePlannerSessionId || pathname === "/schedule/route-planner") return;
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
    }, [pathname, routePlannerSessionId]);

    if (!item) {
        return (
            <View style={{ flex: 1, backgroundColor: colors.background, padding: 20, paddingTop: insets.top + 16 }}>
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.textPrimary }}>일정을 찾을 수 없어요.</Text>
            </View>
        );
    }

    /**
     * 날짜 선택 — outFocus 시 닫힘 (Apple Calendar 동작)
     */
    const onDayPress = (day: { dateString: string }) => {
        const selected = new Date(`${day.dateString}T00:00:00`);
        if (picker === "startDate") {
            setStartDay(selected);
            if (selected.getTime() > endDay.getTime()) setEndDay(selected);
        } else if (picker === "endDate") {
            setEndDay(selected);
            if (selected.getTime() < startDay.getTime()) setStartDay(selected);
        }
    };

    /** 시간 — 완료 버튼 없이 즉시 반영 */
    const onTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
        if (Platform.OS === "android" && event.type === "dismissed") { setPicker(null); return; }
        if (!selected) return;
        if (picker === "startTime") setStartTime(selected);
        else if (picker === "endTime") setEndTime(selected);
        if (Platform.OS === "android") setPicker(null);
    };

    const save = () => {
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

        dispatch({
            type: "UPDATE_ITEM",
            item: {
                ...item, title: t, category,
                startAt: s.toISOString(), endAt: e.toISOString(),
                travelMode,
                travelMinutes,
                locationName,
                destination: normalizedDestinationName
                    ? { name: normalizedDestinationName, address: destinationAddress, lat: destinationLat, lng: destinationLng }
                    : undefined,
                origin: normalizedOriginName
                    ? { name: normalizedOriginName, address: originAddress, lat: originLat, lng: originLng }
                    : undefined,
            },
        });
        router.back();
    };

    const remove = () => {
        Alert.alert("삭제", "이 일정을 삭제할까요?", [
            { text: "취소", style: "cancel" },
            { text: "삭제", style: "destructive", onPress: () => { dispatch({ type: "DELETE_ITEM", id: item.id }); router.back(); } },
        ]);
    };

    const calendarTheme = {
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
    };

    const isDisplayDate = displayPicker === "startDate" || displayPicker === "endDate";
    const isDisplayTime = displayPicker === "startTime" || displayPicker === "endTime";
    const calendarSelected = isDisplayDate
        ? ymdText(displayPicker === "startDate" ? startDay : endDay) : "";

    const fieldStyle = (type: PickerType) => ({
        borderWidth: 1,
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderColor:     picker === type ? colors.selectedDayBg : colors.border,
        backgroundColor: colors.surface2,
    });

    return (
        <>
        <ScrollView
            style={{ flex: 1, backgroundColor: colors.background }}
            contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 16 }]}
            keyboardShouldPersistTaps="handled"
        >
            {/* 헤더 */}
            <View style={styles.headerRow}>
                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>일정 수정</Text>
                <Pressable
                    onPress={() => router.back()}
                    style={[styles.closeBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
                >
                    <Text style={[styles.closeBtnText, { color: colors.textPrimary }]}>뒤로</Text>
                </Pressable>
            </View>

            {/* 제목 */}
            <Text style={[styles.label, { color: colors.textSecondary }]}>제목</Text>
            <TextInput
                value={title}
                onChangeText={setTitle}
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
                categories={state.categories}
                value={categoryId}
                onChange={setCategoryId}
            />

            {/* 저장 */}
            <Pressable
                onPress={save}
                style={[styles.saveBtn, { backgroundColor: colors.selectedDayBg }]}
            >
                <Text style={[styles.saveBtnText, { color: colors.selectedDayText }]}>저장</Text>
            </Pressable>

            {/* 삭제 */}
            <Pressable
                onPress={remove}
                style={[styles.deleteBtn, { backgroundColor: colors.surface2 }]}
            >
                <Text style={styles.deleteBtnText}>삭제</Text>
            </Pressable>
        </ScrollView>
        </>
    );
}

const styles = StyleSheet.create({
    scrollContent: { padding: 20, paddingBottom: 32 },
    headerRow: {
        flexDirection: "row", alignItems: "center",
        justifyContent: "space-between", marginBottom: 20,
    },
    headerTitle:  { fontSize: 20, fontWeight: "700" },
    closeBtn:     { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1 },
    closeBtnText: { fontWeight: "600", fontSize: 13 },
    label:        { marginBottom: 6, fontSize: 13 },
    input: {
        borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14,
    },
    twoColRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
    col:       { flex: 1 },
    fieldText: { fontWeight: "700", fontSize: 13 },
    pickerContainer: {
        borderRadius: 16, borderWidth: 1, overflow: "hidden",
    },
    saveBtn: {
        paddingVertical: 14, borderRadius: 14,
        alignItems: "center", marginBottom: 12, marginTop: 8,
    },
    saveBtnText: { fontWeight: "700", fontSize: 15 },
    deleteBtn: {
        paddingVertical: 14, borderRadius: 14,
        alignItems: "center", borderWidth: 1, borderColor: "#c0392b",
    },
    deleteBtnText: { color: "#e74c3c", fontWeight: "700", fontSize: 15 },
});
