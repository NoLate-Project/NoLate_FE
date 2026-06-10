import type { ScheduleCategory, ScheduleItem } from "./types";

const toYmd = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
};

export type ScheduleState = {
    selectedDay: string; // "YYYY-MM-DD"
    categories: ScheduleCategory[];
    itemsById: Record<string, ScheduleItem>;
    loading: boolean;
    error: string | null;
};


export function createScheduleInitialState(now = new Date()) {
    const today = toYmd(now);

    const categories: ScheduleCategory[] = [
        { id: "1", title: "업무", color: "#f44336" },
        { id: "2", title: "개인", color: "#2196f3" },
        { id: "3", title: "기타", color: "#4caf50" },
    ];

    const itemsById: Record<string, ScheduleItem> = {};

    return {
        selectedDay: today,
        categories,
        itemsById,
        loading: false,
        error: null,
    };
}
