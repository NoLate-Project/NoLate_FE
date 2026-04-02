import React, { useMemo, useState, useRef } from "react";
import { View, Pressable, Text, StatusBar, Animated, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import CalendarWrapper from "./components/calendar/CalendarWrapper";
import ScheduleList from "./components/list/ScheduleList";
import FloatingButton from "./components/shared/FloatingButton";
import ScheduleNewModal from "./components/form/ScheduleAddModal";

import { useScheduleStore } from "../../src/modules/schedule/store";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { clearAuthTokens } from "../../src/modules/auth/authStorage";
import { isOverlappingDay } from "../../lib/util/data";
import type { ScheduleItem } from "../../src/modules/schedule/types";

export default function ScheduleIndex() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { mode, colors, toggleMode } = useTheme();
    const { state, dispatch } = useScheduleStore();
    const [modalVisible, setModalVisible] = useState(false);

    const fadeAnim = useRef(new Animated.Value(1)).current;
    const btnScale = useRef(new Animated.Value(1)).current;

    const selectedDay = state.selectedDay;

    const itemsArray = useMemo(
        () => Object.values(state.itemsById),
        [state.itemsById]
    );

    const list = useMemo(() => {
        return itemsArray
            .filter((it) => isOverlappingDay(it.startAt, it.endAt, selectedDay))
            .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    }, [itemsArray, selectedDay]);

    const addItem = (payload: Omit<ScheduleItem, "id">) => {
        const id = String(Date.now());
        dispatch({ type: "ADD_ITEM", item: { id, ...payload } });
    };

    const handleToggle = () => {
        Animated.sequence([
            Animated.timing(btnScale, { toValue: 0.8, duration: 80, useNativeDriver: true }),
            Animated.spring(btnScale, { toValue: 1, friction: 4, useNativeDriver: true }),
        ]).start();

        Animated.timing(fadeAnim, {
            toValue: 0.08,
            duration: 140,
            useNativeDriver: true,
        }).start(({ finished }) => {
            if (finished) {
                toggleMode();
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 280,
                    useNativeDriver: true,
                }).start();
            }
        });
    };

    const onLogout = () => {
        Alert.alert("로그아웃", "로그아웃 하시겠어요?", [
            { text: "취소", style: "cancel" },
            {
                text: "로그아웃",
                style: "destructive",
                onPress: async () => {
                    await clearAuthTokens();
                    router.replace("/auth/login");
                },
            },
        ]);
    };

    return (
        <Animated.View style={{ flex: 1, backgroundColor: colors.background, opacity: fadeAnim }}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />

            <View style={{ paddingTop: insets.top }}>
                {/* 상단 액션 버튼 */}
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 6 }}>
                    <Pressable
                        onPress={onLogout}
                        style={{
                            minHeight: 34,
                            borderRadius: 17,
                            borderWidth: 1,
                            borderColor: colors.border,
                            backgroundColor: colors.surface2,
                            alignItems: "center",
                            justifyContent: "center",
                            paddingHorizontal: 12,
                        }}
                    >
                        <Text style={{ color: colors.textPrimary, fontWeight: "700", fontSize: 12 }}>로그아웃</Text>
                    </Pressable>

                    <Animated.View style={{ transform: [{ scale: btnScale }] }}>
                        <Pressable
                            onPress={handleToggle}
                            style={{
                                width: 34,
                                height: 34,
                                borderRadius: 17,
                                backgroundColor: colors.surface2,
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            <Text style={{ fontSize: 17 }}>{mode === "dark" ? "☀️" : "🌙"}</Text>
                        </Pressable>
                    </Animated.View>
                </View>

                <CalendarWrapper
                    selectedDay={selectedDay}
                    items={itemsArray}
                    onSelectDay={(day) => dispatch({ type: "SET_SELECTED_DAY", day })}
                    onPressEvent={(id) => router.push(`/schedule/${id}`)}
                />
            </View>

            <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 20 }}>
                <ScheduleList
                    selectedDay={selectedDay}
                    items={list}
                    onPressAdd={() => setModalVisible(true)}
                />
            </View>

            <ScheduleNewModal
                visible={modalVisible}
                onClose={() => setModalVisible(false)}
                onSubmit={addItem}
                categories={state.categories}
                defaultDay={selectedDay}
            />

            <FloatingButton onPress={() => setModalVisible(true)} />
        </Animated.View>
    );
}
