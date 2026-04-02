
export type ScheduleCategory = {
    id: string;
    title: string;
    color: string;
}

export type Place = {
    name?: string;          // "회사", "집", "강남역"
    address?: string;       // 텍스트 주소
    lat?: number;           // 나중에 지도 붙일 때
    lng?: number;
};

export type TravelMode = "CAR" | "TRANSIT" | "WALK" | "BIKE" | "ETC";

export type ScheduleItem = {
    id: string;
    title: string;

    // ✅ 애플 캘린더 핵심: DateTime 기반
    startAt: string; // ISO
    endAt: string;   // ISO
    allDay?: boolean;

    // ✅ 이동시간(Travel Time)
    travelMinutes?: number;     // 0, 5, 10, 15, 30, 45, 60...
    departAt?: string;          // 선택: 서버 저장 or 프론트에서 계산(= startAt - travelMinutes)
    travelMode?: TravelMode;

    // ✅ 장소(현재/추후 확장)
    origin?: Place;             // 출발 위치(나중)
    destination?: Place;        // 도착 위치(나중)
    locationName?: string;      // 지금은 문자열만 저장해도 OK (destination.name 역할)

    category: ScheduleCategory;

    notes?: string;
    updatedAt?: string;
};
