import React, { useEffect, useMemo, useRef } from "react";
import {
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import CalendarGlassSurface from "../../src/modules/schedule/components/calendar/CalendarGlassSurface";
import { useScheduleStore } from "../../src/modules/schedule/store";
import type { ScheduleItem } from "../../src/modules/schedule/types";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import { formatHHmm, isOverlappingDay, startOfDay } from "../../lib/util/data";

const HOUR_HEIGHT = 72;
const TIMELINE_GUTTER = 58;
const MIN_EVENT_HEIGHT = 44;
const DAY_MINUTES = 24 * 60;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

type PositionedEvent = {
    item: ScheduleItem;
    startMinute: number;
    endMinute: number;
    lane: number;
    laneCount: number;
};

function colorWithOpacity(color: string, opacity: number) {
    const normalized = color.replace("#", "");
    if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
        const r = Number.parseInt(normalized.slice(0, 2), 16);
        const g = Number.parseInt(normalized.slice(2, 4), 16);
        const b = Number.parseInt(normalized.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    return color;
}

function formatDateTitle(ymd: string) {
    const date = new Date(`${ymd}T00:00:00`);
    return `${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAYS[date.getDay()]}요일`;
}

function minuteOfDay(date: Date) {
    return date.getHours() * 60 + date.getMinutes();
}

function buildPositionedEvents(items: ScheduleItem[], day: string): PositionedEvent[] {
    const dayStart = startOfDay(day).getTime();
    const nextDay = dayStart + 24 * 60 * 60 * 1000;
    const events = items
        .filter((item) => !item.allDay)
        .map((item) => {
            const rawStart = new Date(item.startAt).getTime();
            const rawEnd = new Date(item.endAt).getTime();
            const clippedStart = new Date(Math.max(rawStart, dayStart));
            const clippedEnd = new Date(Math.min(Math.max(rawEnd, rawStart + 30 * 60 * 1000), nextDay));
            const startMinute = rawStart < dayStart ? 0 : minuteOfDay(clippedStart);
            const endMinute = rawEnd >= nextDay ? DAY_MINUTES : minuteOfDay(clippedEnd);

            return {
                item,
                startMinute,
                endMinute: Math.max(startMinute + 30, endMinute),
                lane: 0,
                laneCount: 1,
            };
        })
        .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);

    let groupStart = 0;
    while (groupStart < events.length) {
        let groupEnd = groupStart + 1;
        let latestEnd = events[groupStart].endMinute;

        while (groupEnd < events.length && events[groupEnd].startMinute < latestEnd) {
            latestEnd = Math.max(latestEnd, events[groupEnd].endMinute);
            groupEnd += 1;
        }

        const laneEnds: number[] = [];
        for (let index = groupStart; index < groupEnd; index += 1) {
            const event = events[index];
            let lane = laneEnds.findIndex((endMinute) => endMinute <= event.startMinute);
            if (lane < 0) lane = laneEnds.length;
            laneEnds[lane] = event.endMinute;
            event.lane = lane;
        }

        const laneCount = Math.max(1, laneEnds.length);
        for (let index = groupStart; index < groupEnd; index += 1) {
            events[index].laneCount = laneCount;
        }
        groupStart = groupEnd;
    }

    return events;
}

export default function ScheduleTimetable() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams<{ date?: string | string[] }>();
    const { colors, mode } = useTheme();
    const { state } = useScheduleStore();
    const timelineRef = useRef<ScrollView>(null);
    const dateParam = Array.isArray(params.date) ? params.date[0] : params.date;
    const day = dateParam || state.selectedDay;

    const items = useMemo(
        () => Object.values(state.itemsById)
            .filter((item) => isOverlappingDay(item.startAt, item.endAt, day))
            .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
        [day, state.itemsById]
    );
    const allDayItems = useMemo(() => items.filter((item) => item.allDay), [items]);
    const positionedEvents = useMemo(() => buildPositionedEvents(items, day), [day, items]);
    const firstEventMinute = positionedEvents[0]?.startMinute ?? 8 * 60;

    useEffect(() => {
        const timer = setTimeout(() => {
            timelineRef.current?.scrollTo({
                y: Math.max(0, ((firstEventMinute - 60) / 60) * HOUR_HEIGHT),
                animated: false,
            });
        }, 80);
        return () => clearTimeout(timer);
    }, [firstEventMinute]);

    const openSchedule = (id: string) => {
        router.push({
            pathname: "/schedule/[id]",
            params: { id },
        });
    };

    return (
        <View style={[styles.root, { backgroundColor: colors.background }]}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                <CalendarGlassSurface
                    interactive
                    style={[styles.backGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        onPress={() => router.back()}
                        accessibilityLabel="캘린더로 돌아가기"
                        style={({ pressed }) => [
                            styles.backButton,
                            { opacity: pressed ? 0.55 : 1 },
                        ]}
                    >
                        <Ionicons name="chevron-back" size={23} color={colors.textPrimary} />
                    </Pressable>
                </CalendarGlassSurface>

                <View style={styles.titleBlock}>
                    <Text style={[styles.title, { color: colors.textPrimary }]}>
                        {formatDateTitle(day)}
                    </Text>
                </View>
            </View>

            {allDayItems.length > 0 && (
                <View style={[styles.allDaySection, { borderColor: colors.border }]}>
                    <Text style={[styles.allDayLabel, { color: colors.textSecondary }]}>
                        종일
                    </Text>
                    <View style={styles.allDayItems}>
                        {allDayItems.map((item) => {
                            const color = item.category?.color ?? "#8e8e93";
                            return (
                                <Pressable
                                    key={item.id}
                                    onPress={() => openSchedule(item.id)}
                                    style={({ pressed }) => [
                                        styles.allDayEvent,
                                        {
                                            backgroundColor: colorWithOpacity(color, mode === "dark" ? 0.28 : 0.16),
                                            borderLeftColor: color,
                                            opacity: pressed ? 0.58 : 1,
                                        },
                                    ]}
                                >
                                    <Text numberOfLines={1} style={[styles.allDayTitle, { color }]}>
                                        {item.title}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>
            )}

            <ScrollView
                ref={timelineRef}
                style={styles.timelineScroll}
                contentContainerStyle={styles.timelineContent}
                showsVerticalScrollIndicator={false}
            >
                <View style={{ height: DAY_MINUTES / 60 * HOUR_HEIGHT }}>
                    {Array.from({ length: 25 }, (_, hour) => (
                        <View
                            key={hour}
                            style={[
                                styles.hourRow,
                                {
                                    top: hour * HOUR_HEIGHT,
                                    borderTopColor: colors.border,
                                },
                            ]}
                        >
                            {hour < 24 && (
                                <Text style={[styles.hourText, { color: colors.textSecondary }]}>
                                    {String(hour).padStart(2, "0")}:00
                                </Text>
                            )}
                        </View>
                    ))}

                    <View style={styles.eventLayer}>
                        {positionedEvents.map(({ item, startMinute, endMinute, lane, laneCount }) => {
                            const color = item.category?.color ?? "#8e8e93";
                            const top = startMinute / 60 * HOUR_HEIGHT;
                            const height = Math.max(
                                MIN_EVENT_HEIGHT,
                                (endMinute - startMinute) / 60 * HOUR_HEIGHT - 3
                            );
                            const laneWidth = 100 / laneCount;

                            return (
                                <Pressable
                                    key={item.id}
                                    onPress={() => openSchedule(item.id)}
                                    style={({ pressed }) => [
                                        styles.timelineEvent,
                                        {
                                            top,
                                            height,
                                            left: `${lane * laneWidth}%`,
                                            width: `${laneWidth}%`,
                                            backgroundColor: colorWithOpacity(
                                                color,
                                                mode === "dark" ? 0.3 : 0.16
                                            ),
                                            borderLeftColor: color,
                                            opacity: pressed ? 0.58 : 1,
                                        },
                                    ]}
                                >
                                    <Text
                                        numberOfLines={1}
                                        style={[styles.eventTitle, { color: colors.textPrimary }]}
                                    >
                                        {item.title}
                                    </Text>
                                    <Text numberOfLines={1} style={[styles.eventTime, { color }]}>
                                        {item.hasEndTime === false
                                            ? formatHHmm(item.startAt)
                                            : `${formatHHmm(item.startAt)}–${formatHHmm(item.endAt)}`}
                                    </Text>
                                    {!!item.category?.title && height >= 62 && (
                                        <Text
                                            numberOfLines={1}
                                            style={[styles.eventCategory, { color: colors.textSecondary }]}
                                        >
                                            {item.category.title}
                                        </Text>
                                    )}
                                </Pressable>
                            );
                        })}
                    </View>

                    {positionedEvents.length === 0 && allDayItems.length === 0 && (
                        <View style={styles.emptyState}>
                            <Ionicons
                                name="calendar-clear-outline"
                                size={30}
                                color={colors.textSecondary}
                            />
                            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                                이 날짜에는 일정이 없어요
                            </Text>
                        </View>
                    )}
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    header: {
        minHeight: 110,
        paddingHorizontal: 18,
        paddingBottom: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
    },
    backGlass: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        overflow: "hidden",
    },
    backButton: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    titleBlock: {
        flex: 1,
        justifyContent: "center",
    },
    title: {
        fontSize: 25,
        fontWeight: "800",
        letterSpacing: -0.8,
    },
    allDaySection: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: StyleSheet.hairlineWidth,
        paddingVertical: 9,
        paddingHorizontal: 18,
        flexDirection: "row",
        gap: 12,
    },
    allDayLabel: {
        width: 40,
        paddingTop: 7,
        fontSize: 12,
        fontWeight: "800",
    },
    allDayItems: {
        flex: 1,
        gap: 5,
    },
    allDayEvent: {
        minHeight: 34,
        borderRadius: 9,
        borderLeftWidth: 4,
        paddingHorizontal: 10,
        justifyContent: "center",
    },
    allDayTitle: {
        fontSize: 14,
        fontWeight: "800",
    },
    timelineScroll: {
        flex: 1,
    },
    timelineContent: {
        paddingHorizontal: 18,
        paddingBottom: 36,
    },
    hourRow: {
        position: "absolute",
        left: 0,
        right: 0,
        height: HOUR_HEIGHT,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    hourText: {
        position: "absolute",
        top: -8,
        width: TIMELINE_GUTTER - 8,
        fontSize: 11,
        fontWeight: "700",
        textAlign: "right",
    },
    eventLayer: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: TIMELINE_GUTTER,
        right: 0,
    },
    timelineEvent: {
        position: "absolute",
        borderRadius: 10,
        borderLeftWidth: 4,
        paddingHorizontal: 8,
        paddingVertical: 6,
        overflow: "hidden",
    },
    eventTitle: {
        fontSize: 14,
        fontWeight: "800",
    },
    eventTime: {
        marginTop: 1,
        fontSize: 11,
        fontWeight: "800",
    },
    eventCategory: {
        marginTop: 2,
        fontSize: 10,
        fontWeight: "700",
    },
    emptyState: {
        marginLeft: TIMELINE_GUTTER,
        paddingTop: HOUR_HEIGHT * 2,
        alignItems: "center",
        gap: 8,
    },
    emptyText: {
        fontSize: 14,
        fontWeight: "700",
    },
});
