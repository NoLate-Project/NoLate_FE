import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Pressable, Text, TextInput, View,
    Alert, Platform, ScrollView, StyleSheet, Animated,
} from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Calendar } from "react-native-calendars";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useScheduleStore } from "../store";
import { useTheme } from "../../theme/ThemeContext";
import { fromISO } from "../../../../lib/util/data";
import type { ScheduleCategory, TravelMode } from "../types";
import { consumeRoutePlannerResult, setRoutePlannerInitial } from "../routePlannerSession";
import CategoryPickerRow from "../components/form/CategorySelectBox";
import LocationInputRow from "../components/form/LocationInputRow";
import NotificationSettingsCard from "../components/form/NotificationSettingsCard";
import { deleteSchedule, getSchedule, updateSchedule } from "../../../api/schedule";
import {
    FREE_SUBSCRIPTION_POLICY,
    getMySubscriptionPolicy,
    type SubscriptionPolicy,
} from "../../../api/subscription";

const pad2    = (n: number) => String(n).padStart(2, "0");
const ymdText = (d: Date)   => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const hhmmText = (d: Date)  => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

// 날짜 객체와 시간 객체를 하나의 일정 시각으로 합친다.
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

const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "요청 처리에 실패했습니다.";

export default function ScheduleEdit() {
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
    const [route, setRoute]                     = useState<unknown>(item?.route);
    const [hasEndTime, setHasEndTime]           = useState(item?.hasEndTime ?? true);
    const [notificationEnabled, setNotificationEnabled] = useState(item?.notificationEnabled ?? false);
    const [notificationLeadMinutes, setNotificationLeadMinutes] = useState(item?.notificationLeadMinutes ?? 60);
    const [notificationIntervalMinutes, setNotificationIntervalMinutes] = useState(item?.notificationIntervalMinutes ?? 20);
    const [subscriptionPolicy, setSubscriptionPolicy] = useState<SubscriptionPolicy>(FREE_SUBSCRIPTION_POLICY);
    const [routePlannerSessionId, setRoutePlannerSessionId] = useState<string | undefined>();
    const [detailLoading, setDetailLoading] = useState(false);

    const [startDay,  setStartDay]  = useState(() =>
        item ? new Date(fromISO(item.startAt).toISOString().slice(0, 10) + "T00:00:00") : new Date()
    );
    const [endDay,    setEndDay]    = useState(() =>
        item ? new Date(fromISO(item.endAt).toISOString().slice(0, 10)   + "T00:00:00") : new Date()
    );
    const [startTime, setStartTime] = useState(() => item ? fromISO(item.startAt) : new Date());
    const [endTime,   setEndTime]   = useState(() => item ? fromISO(item.endAt)   : new Date());

    // 실제 선택값과 화면 표시값을 분리해 피커 전환 애니메이션을 안정화한다.
    const [picker,        setPicker]        = useState<PickerType | null>(null);
    const [displayPicker, setDisplayPicker] = useState<PickerType | null>(null);

    const category = useMemo<ScheduleCategory | undefined>(
        () => state.categories.find((c) => c.id === categoryId) ?? state.categories[0],
        [state.categories, categoryId]
    );

    useEffect(() => {
        if (!id) return;

        let cancelled = false;
        setDetailLoading(true);

        getSchedule(id)
            .then((detail) => {
                if (cancelled) return;
                dispatch({ type: "UPDATE_ITEM", item: detail });
            })
            .catch((error) => {
                if (cancelled) return;
                Alert.alert("일정 조회 실패", getErrorMessage(error));
            })
            .finally(() => {
                if (!cancelled) setDetailLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [dispatch, id]);

    useEffect(() => {
        let cancelled = false;
        getMySubscriptionPolicy()
            .then((policy) => {
                if (cancelled) return;
                setSubscriptionPolicy(policy);
                if (!item?.notificationEnabled) {
                    setNotificationLeadMinutes((current) =>
                        Math.min(current, policy.maxNotificationLeadMinutes)
                    );
                    setNotificationIntervalMinutes((current) =>
                        Math.max(current, policy.minEtaRefreshIntervalMinutes)
                    );
                }
            })
            .catch(() => {
                if (!cancelled) setSubscriptionPolicy(FREE_SUBSCRIPTION_POLICY);
            });
        return () => {
            cancelled = true;
        };
    }, [item?.notificationEnabled]);

    useEffect(() => {
        if (!item) return;

        setTitle(item.title);
        setCategoryId(item.category?.id ?? state.categories[0]?.id ?? "1");
        setOriginText(item.origin?.name ?? "");
        setDestinationText(item.destination?.name ?? "");
        setOriginAddress(item.origin?.address);
        setDestinationAddress(item.destination?.address);
        setOriginLat(item.origin?.lat);
        setOriginLng(item.origin?.lng);
        setDestinationLat(item.destination?.lat);
        setDestinationLng(item.destination?.lng);
        setTravelMode(item.travelMode ?? "CAR");
        setTravelMinutes(item.travelMinutes);
        setRoute(item.route);
        setHasEndTime(item.hasEndTime ?? fromISO(item.endAt).getTime() > fromISO(item.startAt).getTime());
        setNotificationEnabled(item.notificationEnabled ?? false);
        setNotificationLeadMinutes(item.notificationLeadMinutes ?? 60);
        setNotificationIntervalMinutes(item.notificationIntervalMinutes ?? 20);
        setStartDay(new Date(fromISO(item.startAt).toISOString().slice(0, 10) + "T00:00:00"));
        setEndDay(new Date(fromISO(item.endAt).toISOString().slice(0, 10) + "T00:00:00"));
        setStartTime(fromISO(item.startAt));
        setEndTime(fromISO(item.endAt));
    }, [item, state.categories]);

    useEffect(() => {
        if (hasEndTime) return;
        setEndDay(new Date(startDay));
        setEndTime(new Date(startTime));
    }, [hasEndTime, startDay, startTime]);

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

        setRoutePlannerSessionId(sessionId);
        router.push({ pathname: "/schedule/route-select", params: { sessionId } });
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
        route,
    ]);

    useEffect(() => {
        if (
            !routePlannerSessionId ||
            pathname === "/schedule/route-select" ||
            pathname === "/schedule/route-planner"
        ) return;
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
        setRoute(result.route);
        setRoutePlannerSessionId(undefined);
    }, [pathname, routePlannerSessionId]);

    if (!item) {
        return (
            <View style={{ flex: 1, backgroundColor: colors.background, padding: 20, paddingTop: insets.top + 16 }}>
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.textPrimary }}>
                    {detailLoading ? "일정을 불러오는 중이에요." : "일정을 찾을 수 없어요."}
                </Text>
            </View>
        );
    }

    // 캘린더에서 선택한 날짜를 시작/종료 날짜에 반영한다.
    const onDayPress = (day: { dateString: string }) => {
        const selected = new Date(`${day.dateString}T00:00:00`);
        if (picker === "startDate") {
            setStartDay(selected);
        } else if (picker === "endDate") {
            setHasEndTime(true);
            setEndDay(selected);
            if (selected.getTime() < startDay.getTime()) setStartDay(selected);
        }
    };

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

    // 수정된 입력값을 백엔드에 저장한 뒤 일정 저장소에 반영한다.
    const save = async () => {
        const t = title.trim();
        if (!t || !category) return;

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
            setDetailLoading(true);
            const updated = await updateSchedule(item.id, {
                title: t,
                category,
                startAt: s.toISOString(),
                endAt: e.toISOString(),
                hasEndTime: hasDistinctEndTime,
                travelMode,
                travelMinutes,
                locationName,
                destination: normalizedDestinationName
                    ? { name: normalizedDestinationName, address: destinationAddress, lat: destinationLat, lng: destinationLng }
                    : undefined,
                origin: normalizedOriginName
                    ? { name: normalizedOriginName, address: originAddress, lat: originLat, lng: originLng }
                    : undefined,
                notes: item.notes,
                allDay: item.allDay,
                route,
                notificationEnabled,
                notificationLeadMinutes: notificationEnabled ? notificationLeadMinutes : undefined,
                notificationIntervalMinutes: notificationEnabled ? notificationIntervalMinutes : undefined,
            });
            dispatch({ type: "UPDATE_ITEM", item: updated });
            router.setParams({ mode: undefined });
        } catch (error) {
            Alert.alert("일정 수정 실패", getErrorMessage(error));
        } finally {
            setDetailLoading(false);
        }
    };

    // 현재 일정을 삭제하고 이전 화면으로 돌아간다.
    const remove = () => {
        Alert.alert("삭제", "이 일정을 삭제할까요?", [
            { text: "취소", style: "cancel" },
            {
                text: "삭제",
                style: "destructive",
                onPress: async () => {
                    try {
                        setDetailLoading(true);
                        await deleteSchedule(item.id);
                        router.replace("/schedule");
                        setTimeout(() => {
                            dispatch({ type: "DELETE_ITEM", id: item.id });
                        }, 0);
                    } catch (error) {
                        Alert.alert("일정 삭제 실패", getErrorMessage(error));
                    } finally {
                        setDetailLoading(false);
                    }
                },
            },
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
            <View style={styles.headerRow}>
                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>일정 수정</Text>
                <Pressable
                    onPress={() => router.setParams({ mode: undefined })}
                    style={[styles.closeBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
                >
                    <Text style={[styles.closeBtnText, { color: colors.textPrimary }]}>뒤로</Text>
                </Pressable>
            </View>

            <Text style={[styles.label, { color: colors.textSecondary }]}>제목</Text>
            <TextInput
                value={title}
                onChangeText={setTitle}
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
                categories={state.categories}
                value={categoryId}
                onChange={setCategoryId}
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
                disabled={detailLoading}
                onPress={save}
                style={[styles.saveBtn, { backgroundColor: colors.selectedDayBg, opacity: detailLoading ? 0.6 : 1 }]}
            >
                <Text style={[styles.saveBtnText, { color: colors.selectedDayText }]}>
                    {detailLoading ? "저장 중" : "저장"}
                </Text>
            </Pressable>

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
