import React from "react";
import { StyleSheet, View } from "react-native";
import ScheduleCalendar from "./ScheduleCalendar";
import type { ScheduleItem } from "../../types";
import type { CalendarViewMode } from "./viewMode";

type Props = {
    selectedDay: string;
    items: ScheduleItem[];
    onSelectDay: (day: string) => void;
    onOpenDay: (day: string) => void;
    viewMode: CalendarViewMode;
    firstDay: 0 | 1;
    scrollRequest: number;
    onVisibleMonthChange: (month: string) => void;
};

// 일정 캘린더에 선택 날짜와 일정 목록을 연결한다.
export default function CalendarWrapper({
    selectedDay,
    items,
    onSelectDay,
    onOpenDay,
    viewMode,
    firstDay,
    scrollRequest,
    onVisibleMonthChange,
}: Props) {
    return (
        <View style={viewMode === "list" ? undefined : styles.full}>
            <ScheduleCalendar
                selectedDay={selectedDay}
                items={items}
                onSelectDay={onSelectDay}
                onOpenDay={onOpenDay}
                viewMode={viewMode}
                firstDay={firstDay}
                scrollRequest={scrollRequest}
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
