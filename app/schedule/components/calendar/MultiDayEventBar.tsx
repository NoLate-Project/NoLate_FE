import React, { useMemo } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import type { ScheduleItem } from "../../../../src/modules/schedule/types";
import { toYmd, fromISO } from "../../../../lib/util/data";

type Props = {
    events: ScheduleItem[];
    selectedMonth: string; // "2026-02" 형식
    onPressEvent?: (id: string) => void;
};

export default function MultiDayEventBar({ events, selectedMonth, onPressEvent }: Props) {
    // 현재 월에 해당하는 이벤트만 필터링
    const filteredEvents = useMemo(() => {
        return events.filter((event) => {
            const startYM = event.startAt.substring(0, 7);
            const endYM = event.endAt.substring(0, 7);
            // 이벤트의 시작 또는 종료가 현재 월에 포함되면 표시
            return startYM <= selectedMonth && endYM >= selectedMonth;
        });
    }, [events, selectedMonth]);

    if (filteredEvents.length === 0) return null;

    return (
        <View style={{ marginTop: 12, paddingHorizontal: 4 }}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: "#666", marginBottom: 8 }}>
                이어지는 일정
            </Text>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
            >
                {filteredEvents.map((event) => {
                    const startDate = fromISO(event.startAt);
                    const endDate = fromISO(event.endAt);
                    const startDay = toYmd(startDate);
                    const endDay = toYmd(endDate);

                    return (
                        <Pressable
                            key={event.id}
                            onPress={() => onPressEvent?.(event.id)}
                            style={{
                                backgroundColor: event.category.color,
                                paddingVertical: 10,
                                paddingHorizontal: 14,
                                borderRadius: 12,
                                minWidth: 150,
                                maxWidth: 250,
                            }}
                        >
                            <Text
                                style={{
                                    color: "#fff",
                                    fontWeight: "800",
                                    fontSize: 14,
                                    marginBottom: 4,
                                }}
                                numberOfLines={1}
                            >
                                {event.title}
                            </Text>
                            <Text style={{ color: "#fff", fontSize: 11, opacity: 0.9 }}>
                                {startDay} ~ {endDay}
                            </Text>
                        </Pressable>
                    );
                })}
            </ScrollView>
        </View>
    );
}
