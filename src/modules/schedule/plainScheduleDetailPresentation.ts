import { fromISO } from "../../../lib/util/data";

import { getScheduleAllDayFormEndDay } from "./scheduleFormDate";
import { formatRouteDuration } from "./routeInfo";
import {
    getScheduleAlertModeLabel,
    normalizeScheduleAlertMode,
} from "./scheduleAlertMode";
import type { ScheduleItem } from "./types";
import { getUserVisibleScheduleNotes } from "./calendarImportNotes";

const pad2 = (value: number) => String(value).padStart(2, "0");
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function formatScheduleDetailTime(date: Date): string {
    const hour = date.getHours();
    return `${hour < 12 ? "오전" : "오후"} ${hour % 12 || 12}:${pad2(date.getMinutes())}`;
}

function formatScheduleDetailDate(date: Date): string {
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAYS[date.getDay()]})`;
}

function isSameLocalDay(left: Date, right: Date): boolean {
    return left.getFullYear() === right.getFullYear()
        && left.getMonth() === right.getMonth()
        && left.getDate() === right.getDate();
}

function formatDateRange(startAt: Date, endAt?: Date): string {
    if (!endAt || isSameLocalDay(startAt, endAt)) return formatScheduleDetailDate(startAt);
    return `${formatScheduleDetailDate(startAt)} – ${formatScheduleDetailDate(endAt)}`;
}

function formatTimeRange(startAt: Date, endAt?: Date): string {
    const start = formatScheduleDetailTime(startAt);
    if (!endAt) return start;

    const end = formatScheduleDetailTime(endAt);
    const startPeriod = startAt.getHours() < 12 ? "오전" : "오후";
    const endPeriod = endAt.getHours() < 12 ? "오전" : "오후";
    const compactEnd = startPeriod === endPeriod ? end.replace(`${endPeriod} `, "") : end;
    return `${start} – ${compactEnd}`;
}

function formatNotificationLead(minutes: number): string {
    const normalized = Math.max(0, Math.round(minutes));
    if (normalized >= 60 && normalized % 60 === 0) return `${normalized / 60}시간 전`;
    return `${normalized}분 전`;
}

function getNotificationLabel(item: ScheduleItem): string {
    if (item.notificationEnabled !== true) return "없음";

    const modeLabel = getScheduleAlertModeLabel(normalizeScheduleAlertMode(item.alertMode));
    return typeof item.notificationLeadMinutes === "number" && Number.isFinite(item.notificationLeadMinutes)
        ? `${formatNotificationLead(item.notificationLeadMinutes)} · ${modeLabel}`
        : modeLabel;
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
    dateLabel: string;
    timeRangeLabel: string;
    durationLabel?: string;
    notificationLabel: string;
};

/** 일반 일정 상세의 핵심 정보를 짧은 읽기 전용 문구로 만든다. */
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
    const durationMinutes = hasEndTime
        ? Math.round((endAt.getTime() - startAt.getTime()) / 60_000)
        : undefined;

    return {
        title: item.title.trim(),
        categoryTitle: item.category.title,
        categoryColor: item.category.color,
        location: getPlainScheduleLocation(item),
        notes: getUserVisibleScheduleNotes(item.notes),
        dateLabel: formatDateRange(
            startAt,
            allDay || hasEndTime ? displayEndDay : undefined,
        ),
        timeRangeLabel: allDay
            ? "종일"
            : formatTimeRange(startAt, hasEndTime ? endAt : undefined),
        durationLabel: typeof durationMinutes === "number" && durationMinutes > 0
            ? formatRouteDuration(durationMinutes)
            : undefined,
        notificationLabel: getNotificationLabel(item),
    };
}
