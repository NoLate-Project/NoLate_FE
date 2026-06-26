import type { ScheduleItem } from "./types";

export const QA_SCHEDULE_ID = "qa-event-final";

export function createQaScheduleItem(now = new Date()): ScheduleItem {
    const start = new Date(now);
    start.setHours(14, 30, 0, 0);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + 45);
    const depart = new Date(start);
    depart.setMinutes(depart.getMinutes() - 32);

    return {
        id: QA_SCHEDULE_ID,
        title: "클라이언트 미팅",
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        hasEndTime: true,
        travelMinutes: 32,
        departAt: depart.toISOString(),
        travelMode: "TRANSIT",
        origin: {
            name: "서울역",
            address: "서울 중구 한강대로 405",
            lat: 37.5559,
            lng: 126.9723,
        },
        destination: {
            name: "강남역",
            address: "서울 강남구 강남대로 396",
            lat: 37.4979,
            lng: 127.0276,
        },
        locationName: "서울역 → 강남역",
        category: {
            id: "1",
            title: "업무",
            color: "#f44336",
        },
        notes: "도착 전 자료 확인",
        notificationEnabled: true,
        notificationLeadMinutes: 30,
        notificationIntervalMinutes: 10,
    };
}
