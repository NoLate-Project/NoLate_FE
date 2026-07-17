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

    // 운영 카테고리는 계정별 서버 데이터다. 임시 ID를 넣으면 조회 실패가
    // 정상 빈 목록처럼 보이고 존재하지 않는 카테고리로 저장을 시도할 수 있다.
    const categories: ScheduleCategory[] = [];

    const itemsById: Record<string, ScheduleItem> = {};

    return {
        selectedDay: today,
        categories,
        itemsById,
        loading: false,
        error: null,
    };
}
