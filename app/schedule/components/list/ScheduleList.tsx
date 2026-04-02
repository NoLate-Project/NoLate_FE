import React, { useRef, useEffect } from "react";
import { Pressable, Text, View, Animated } from "react-native";
import { useTheme } from "../../../../src/modules/theme/ThemeContext";
import ScheduleItemList from "./ScheduleItemList";
import type { ScheduleItem } from "../../../../src/modules/schedule/types";

type Props = {
    selectedDay: string;
    items: ScheduleItem[];
    onPressAdd?: () => void;
};

function formatDateLabel(ymd: string): string {
    const d = new Date(ymd + "T00:00:00");
    const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
    const month = d.getMonth() + 1;
    const day = d.getDate();
    return `${month}월 ${day}일 ${dayNames[d.getDay()]}요일`;
}

export default function ScheduleList({ selectedDay, items, onPressAdd }: Props) {
    const { colors } = useTheme();

    const listOpacity = useRef(new Animated.Value(1)).current;
    const listTranslate = useRef(new Animated.Value(0)).current;
    const prevDayRef = useRef(selectedDay);

    useEffect(() => {
        if (prevDayRef.current === selectedDay) return;
        prevDayRef.current = selectedDay;

        // 새 날짜로 전환 시 슬라이드업 + 페이드인
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
        <View style={{ flex: 1 }}>
            {/* 날짜 헤더 */}
            <View
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 14,
                }}
            >
                <Text
                    style={{
                        fontSize: 15,
                        fontWeight: "600",
                        color: colors.textPrimary,
                        letterSpacing: -0.3,
                    }}
                >
                    {formatDateLabel(selectedDay)}
                </Text>

                <Pressable
                    onPress={onPressAdd}
                    style={({ pressed }) => ({
                        paddingVertical: 6,
                        paddingHorizontal: 14,
                        borderRadius: 20,
                        backgroundColor: pressed ? colors.surface2 : colors.surface,
                        borderWidth: 1,
                        borderColor: colors.border,
                    })}
                >
                    <Text style={{ color: colors.textPrimary, fontWeight: "600", fontSize: 13 }}>
                        + 추가
                    </Text>
                </Pressable>
            </View>

            {/* 애니메이션 적용 리스트 영역 */}
            <Animated.View
                style={{
                    flex: 1,
                    opacity: listOpacity,
                    transform: [{ translateY: listTranslate }],
                }}
            >
                {items.length === 0 ? (
                    <View
                        style={{
                            padding: 20,
                            borderRadius: 14,
                            backgroundColor: colors.surface,
                            alignItems: "center",
                        }}
                    >
                        <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                            일정이 없어요
                        </Text>
                    </View>
                ) : (
                    <ScheduleItemList items={items} />
                )}
            </Animated.View>
        </View>
    );
}
