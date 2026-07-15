import React, { useRef, useEffect } from "react";
import { Pressable, Text, View, Animated, StyleSheet } from "react-native";
import { useTheme } from "../../../theme/ThemeContext";
import ScheduleItemList from "./ScheduleItemList";
import type { ScheduleItem } from "../../types";
import CalendarGlassSurface from "../calendar/CalendarGlassSurface";

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

function formatDisplayError(error?: string | null): string | null {
    if (!error) return null;
    if (/403|forbidden|status code/i.test(error)) {
        return "일정을 불러오지 못했습니다";
    }
    if (/network|timeout/i.test(error)) {
        return "네트워크 상태를 확인한 뒤 다시 시도해 주세요";
    }
    return error;
}

// 선택 날짜의 일정 목록을 표시한다.
export default function ScheduleList({ selectedDay, items, loading = false, error, onPressRetry }: Props) {
    const { colors } = useTheme();

    const listOpacity = useRef(new Animated.Value(1)).current;
    const listTranslate = useRef(new Animated.Value(0)).current;
    const prevDayRef = useRef(selectedDay);
    const displayError = formatDisplayError(error);

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
                    <CalendarGlassSurface
                        variant="card"
                        style={[styles.stateCard, { borderColor: colors.border }]}
                    >
                        <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                            일정을 불러오는 중이에요
                        </Text>
                    </CalendarGlassSurface>
                ) : displayError ? (
                    <CalendarGlassSurface
                        prominent
                        variant="card"
                        style={[styles.stateCard, { borderColor: colors.border }]}
                    >
                        <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: "center" }}>
                            {displayError}
                        </Text>
                        <CalendarGlassSurface
                            interactive
                            clear
                            glow
                            variant="bottomBar"
                            tone="softGlass"
                            style={[
                                styles.retryGlass,
                                { borderColor: colors.border },
                            ]}
                        >
                            <Pressable
                                onPress={onPressRetry}
                                style={({ pressed }) => [
                                    styles.retryButton,
                                    {
                                        opacity: pressed ? 0.74 : 1,
                                        transform: [{ scale: pressed ? 0.94 : 1 }],
                                    },
                                ]}
                            >
                                <Text style={[styles.retryText, { color: colors.textPrimary }]}>
                                    다시 조회
                                </Text>
                            </Pressable>
                        </CalendarGlassSurface>
                    </CalendarGlassSurface>
                ) : (
                    items.length === 0 ? (
                        <CalendarGlassSurface
                            variant="card"
                            style={[styles.stateCard, { borderColor: colors.border }]}
                        >
                            <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                                일정이 없어요
                            </Text>
                        </CalendarGlassSurface>
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
        letterSpacing: 0,
    },
    stateCard: {
        minHeight: 108,
        padding: 20,
        borderRadius: 20,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    retryGlass: {
        height: 44,
        borderRadius: 22,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: "hidden",
    },
    retryButton: {
        height: 44,
        borderRadius: 22,
        paddingHorizontal: 18,
        alignItems: "center",
        justifyContent: "center",
    },
    retryText: {
        fontWeight: "800",
        fontSize: 14,
        letterSpacing: 0,
    },
});
