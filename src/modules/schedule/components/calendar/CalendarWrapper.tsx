import React from "react";
import { StyleSheet, View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import ScheduleCalendar from "./ScheduleCalendar";
import type { ScheduleItem } from "../../types";
import type { CalendarViewMode } from "./viewMode";

export type DayTransitionContext = "idle" | "yearToMonth" | "monthToDay" | "dayToMonth";

type Props = {
    selectedDay: string;
    focusedMonth?: string;
    items: ScheduleItem[];
    onSelectDay: (day: string) => void;
    onOpenDay: (day: string) => void;
    viewMode: CalendarViewMode;
    firstDay: 0 | 1;
    scrollRequest: number;
    onVisibleMonthChange: (month: string) => void;
    headerOffset?: number;
    transitionMonthKey?: string;
    transitionActive?: boolean;
    transitionContext?: DayTransitionContext;
    animatedDayHeight?: SharedValue<number>;
};

// 일정 캘린더에 선택 날짜와 일정 목록을 연결한다.
export default function CalendarWrapper({
    selectedDay,
    focusedMonth,
    items,
    onSelectDay,
    onOpenDay,
    viewMode,
    firstDay,
    scrollRequest,
    onVisibleMonthChange,
    headerOffset,
    transitionMonthKey,
    transitionActive = false,
    transitionContext = "idle",
    animatedDayHeight,
}: Props) {
    const shouldUseCompactHeight =
        viewMode === "detail" || viewMode === "list" || viewMode === "week";

    return (
        <View style={shouldUseCompactHeight ? styles.compact : styles.full}>
            <ScheduleCalendar
                selectedDay={selectedDay}
                focusedMonth={focusedMonth}
                items={items}
                onSelectDay={onSelectDay}
                onOpenDay={onOpenDay}
                viewMode={viewMode}
                firstDay={firstDay}
                scrollRequest={scrollRequest}
                onVisibleMonthChange={onVisibleMonthChange}
                headerOffset={headerOffset}
                transitionMonthKey={transitionMonthKey}
                transitionActive={transitionActive}
                transitionContext={transitionContext}
                animatedDayHeight={animatedDayHeight}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    full: {
        flex: 1,
    },
    compact: {
        flexShrink: 0,
    },
});
