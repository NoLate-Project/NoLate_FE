import React from "react";
import ScheduleCalendar from "./ScheduleCalendar";
import type { ScheduleItem } from "../../types";

type Props = {
    selectedDay: string;
    items: ScheduleItem[];
    onSelectDay: (day: string) => void;
};

// 일정 캘린더에 선택 날짜와 일정 목록을 연결한다.
export default function CalendarWrapper({ selectedDay, items, onSelectDay }: Props) {
    return (
        <ScheduleCalendar
            selectedDay={selectedDay}
            items={items}
            onSelectDay={onSelectDay}
        />
    );
}
