import type { ScheduleItem } from "./types";

export function dedupeCalendarSchedules(items: ScheduleItem[]): ScheduleItem[] {
    const seenAllDay = new Set<string>();
    return items.filter((item) => {
        if (!item.allDay) return true;

        const key = [
            item.title.trim().toLocaleLowerCase("ko-KR"),
            item.startAt.slice(0, 10),
            item.endAt.slice(0, 10),
            item.category?.id ?? "",
        ].join("|");
        if (seenAllDay.has(key)) return false;
        seenAllDay.add(key);
        return true;
    });
}
