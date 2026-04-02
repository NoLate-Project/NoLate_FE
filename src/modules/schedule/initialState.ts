import type { ScheduleCategory, ScheduleItem } from "./types";

const toYmd = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
};

// 특정 날짜에 시간 붙여 ISO 만들기 (로컬 타임 기준)
const isoAt = (ymd: string, hhmm: string) => {
    const [hh, mm] = hhmm.split(":").map(Number);
    const d = new Date(`${ymd}T00:00:00`);
    d.setHours(hh, mm, 0, 0);
    return d.toISOString();
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

    const itemsById: Record<string, ScheduleItem> = {
        "1": {
            id: "1",
            title: "회의",
            startAt: isoAt(today, "10:00"),
            endAt: isoAt(today, "11:00"),
            travelMinutes: 10,
            travelMode: "WALK",
            origin: { name: "사무실", lat: 37.5665, lng: 126.978 },
            destination: { name: "회의실 A", lat: 37.5672, lng: 126.982 },
            locationName: "사무실 → 회의실 A",
            category: categories[0],
        },
        "2": {
            id: "2",
            title: "운동",
            startAt: isoAt(today, "19:30"),
            endAt: isoAt(today, "20:30"),
            travelMinutes: 0,
            travelMode: "CAR",
            locationName: "집 → 헬스장",
            category: categories[1],
        },
        // ✅ 멀티데이 예시도 하나 넣어둘 수 있음
        "3": {
            id: "3",
            title: "출장",
            startAt: isoAt(today, "09:00"),
            endAt: isoAt(toYmd(new Date(now.getTime() + 24 * 60 * 60 * 1000)), "18:00"), // 내일 18:00
            travelMinutes: 60,
            travelMode: "TRANSIT",
            locationName: "서울역 → 부산역",
            category: categories[0],
        },
    };

    return {
        selectedDay: today,
        categories,
        itemsById,
        loading: false,
        error: null,
    };
}
