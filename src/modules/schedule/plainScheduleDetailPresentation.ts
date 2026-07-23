import { fromISO } from "../../../lib/util/data";

import {
    formatScheduleFormDate,
    getScheduleAllDayFormEndDay,
} from "./scheduleFormDate";
import type { ScheduleItem } from "./types";

const pad2 = (value: number) => String(value).padStart(2, "0");

function formatScheduleFormTime(date: Date): string {
    const hour = date.getHours();
    return `${hour < 12 ? "오전" : "오후"} ${hour % 12 || 12}:${pad2(date.getMinutes())}`;
}

function getPlainScheduleLocation(item: ScheduleItem): string | undefined {
    return [
        item.locationName,
        item.destination?.name,
        item.destination?.address,
        item.origin?.name,
        item.origin?.address,
    ].find((value) => Boolean(value?.trim()))?.trim();
}

export type PlainScheduleDetailPresentation = {
    title: string;
    categoryTitle: string;
    categoryColor: string;
    location?: string;
    notes?: string;
    allDay: boolean;
    hasEndTime: boolean;
    startDate: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
};

/** 일반 일정을 수정 폼과 같은 순서로 읽어 줄 표시 전용 데이터다. */
export function buildPlainScheduleDetailPresentation(
    item: ScheduleItem
): PlainScheduleDetailPresentation {
    const startAt = fromISO(item.startAt);
    const endAt = fromISO(item.endAt);
    const allDay = item.allDay === true;
    const hasEndTime = !allDay && item.hasEndTime !== false;
    const displayEndDay = allDay
        ? getScheduleAllDayFormEndDay(startAt, endAt)
        : endAt;

    return {
        title: item.title.trim(),
        categoryTitle: item.category.title,
        categoryColor: item.category.color,
        location: getPlainScheduleLocation(item),
        notes: item.notes?.trim() || undefined,
        allDay,
        hasEndTime,
        startDate: formatScheduleFormDate(startAt),
        startTime: allDay ? undefined : formatScheduleFormTime(startAt),
        endDate: allDay || hasEndTime
            ? formatScheduleFormDate(displayEndDay)
            : undefined,
        endTime: hasEndTime ? formatScheduleFormTime(endAt) : undefined,
    };
}
