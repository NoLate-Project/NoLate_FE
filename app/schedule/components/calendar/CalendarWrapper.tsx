import React from "react";
import ScheduleCalendar from "./ScheduleCalendar";
import type { ScheduleItem } from "../../../../src/modules/schedule/types";

type Props = {
    selectedDay: string;
    items: ScheduleItem[];
    onSelectDay: (day: string) => void;
    onPressEvent?: (id: string) => void;
};

export default function CalendarWrapper({ selectedDay, items, onSelectDay }: Props) {
    return (
        <ScheduleCalendar
            selectedDay={selectedDay}
            items={items}
            onSelectDay={onSelectDay}
        />
    );
}
