import React from "react";
import { StyleSheet, View } from "react-native";
import ScheduleCalendar from "./ScheduleCalendar";
import type { ScheduleItem } from "../../types";
import type { CalendarViewMode } from "./viewMode";

type Props = {
    selectedDay: string;
    items: ScheduleItem[];
    onSelectDay: (day: string) => void;
    viewMode: CalendarViewMode;
    firstDay: 0 | 1;
    onVisibleMonthChange: (month: string) => void;
};

// 일정 캘린더에 선택 날짜와 일정 목록을 연결한다.
export default function CalendarWrapper({
    selectedDay,
    items,
    onSelectDay,
    viewMode,
    firstDay,
    onVisibleMonthChange,
}: Props) {
    return (
        <View style={viewMode === "list" ? undefined : styles.full}>
            <ScheduleCalendar
                selectedDay={selectedDay}
                items={items}
                onSelectDay={onSelectDay}
                viewMode={viewMode}
                firstDay={firstDay}
                onVisibleMonthChange={onVisibleMonthChange}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    full: {
        flex: 1,
    },
});
