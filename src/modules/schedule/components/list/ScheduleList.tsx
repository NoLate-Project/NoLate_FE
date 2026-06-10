import React, { useRef, useEffect } from "react";
import { Pressable, Text, View, Animated, StyleSheet } from "react-native";
import { useTheme } from "../../../theme/ThemeContext";
import ScheduleItemList from "./ScheduleItemList";
import type { ScheduleItem } from "../../types";

type Props = {
    selectedDay: string;
    items: ScheduleItem[];
    loading?: boolean;
    error?: string | null;
    onPressRetry?: () => void;
};

// YYYY-MM-DD 문자열을 일정 목록 헤더용 날짜 문구로 바꾼다.
function formatDateLabel(ymd: string): string {
    const d = new Date(ymd + "T00:00:00");
    const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
    const month = d.getMonth() + 1;
    const day = d.getDate();
    return `${month}월 ${day}일 ${dayNames[d.getDay()]}요일`;
}

// 선택 날짜의 일정 목록을 표시한다.
export default function ScheduleList({ selectedDay, items, loading = false, error, onPressRetry }: Props) {
    const { colors } = useTheme();

    const listOpacity = useRef(new Animated.Value(1)).current;
    const listTranslate = useRef(new Animated.Value(0)).current;
    const prevDayRef = useRef(selectedDay);

    useEffect(() => {
        if (prevDayRef.current === selectedDay) return;
        prevDayRef.current = selectedDay;

        // 선택 날짜가 바뀌면 일정 리스트를 짧게 전환한다.
        listOpacity.setValue(0);
        listTranslate.setValue(18);

        Animated.parallel([
            Animated.timing(listOpacity, {
                toValue: 1,
                duration: 240,
                useNativeDriver: true,
            }),
            Animated.spring(listTranslate, {
                toValue: 0,
                tension: 130,
                friction: 9,
                useNativeDriver: true,
            }),
        ]).start();
    }, [selectedDay, listOpacity, listTranslate]);

    return (
        <View style={styles.container}>
            <View
                style={styles.header}
            >
                <Text
                    style={[styles.dateTitle, { color: colors.textPrimary }]}
                >
                    {formatDateLabel(selectedDay)}
                </Text>
            </View>

            <Animated.View
                style={{
                    flex: 1,
                    opacity: listOpacity,
                    transform: [{ translateY: listTranslate }],
                }}
            >
                {loading ? (
                    <View
                        style={[styles.stateCard, { backgroundColor: colors.surface }]}
                    >
                        <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                            일정을 불러오는 중이에요
                        </Text>
                    </View>
                ) : error ? (
                    <View
                        style={[styles.stateCard, { backgroundColor: colors.surface }]}
                    >
                        <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: "center" }}>
                            {error}
                        </Text>
                        <Pressable
                            onPress={onPressRetry}
                            style={({ pressed }) => ({
                                paddingVertical: 7,
                                paddingHorizontal: 14,
                                borderRadius: 18,
                                backgroundColor: pressed ? colors.surface2 : colors.selectedDayBg,
                            })}
                        >
                            <Text style={{ color: colors.selectedDayText, fontWeight: "700", fontSize: 13 }}>
                                다시 조회
                            </Text>
                        </Pressable>
                    </View>
                ) : (
                    items.length === 0 ? (
                        <View style={[styles.stateCard, { backgroundColor: colors.surface }]}>
                            <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                                일정이 없어요
                            </Text>
                        </View>
                    ) : (
                        <ScheduleItemList items={items} />
                    )
                )}
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 14,
    },
    dateTitle: {
        fontSize: 21,
        fontWeight: "800",
        letterSpacing: -0.6,
    },
    stateCard: {
        minHeight: 108,
        padding: 20,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
});
