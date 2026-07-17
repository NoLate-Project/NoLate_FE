
export type ScheduleSharePermission = "VIEWER" | "COMMENTER" | "EDITOR" | "OWNER";

export type ScheduleCategory = {
    id: string;
    title: string;
    color: string;
    ownerMemberId?: number;
    shared?: boolean;
    sharePermission?: ScheduleSharePermission;
}

export type Place = {
    name?: string;          // "회사", "집", "강남역"
    address?: string;       // 텍스트 주소
    lat?: number;
    lng?: number;
    provider?: string;      // 장소를 찾은 검색 공급자
    providerPlaceId?: string;
};

export type ScheduleParseResult = {
    title?: string;
    notes?: string;
    date?: string;
    time?: string;
    startAt?: string;
    endAt?: string;
    /**
     * True only when the parser found an explicit end-time expression in the source text.
     * Older API versions omit this field, so consumers must treat undefined as false.
     */
    hasExplicitEndTime?: boolean;
    origin?: Place;
    originSource: "TEXT" | "FAVORITE_DEFAULT" | "REQUIRED";
    originRequired: boolean;
    destination?: Place;
    parseSource: "RULE" | "AI_ASSISTED" | "RULE_FALLBACK";
    aiAttempted: boolean;
    needsReview: boolean;
    warnings: string[];
    missingFields: string[];
    travelMinutes?: number;
    travelMode?: TravelMode;
    route?: unknown;
    notificationEnabled?: boolean;
    notificationLeadMinutes?: number;
    notificationIntervalMinutes?: number;
};

export type TravelMode = "CAR" | "TRANSIT" | "WALK" | "BIKE" | "ETC";

export type ScheduleDepartureParticipantRole = "OWNER" | "SHARED";

export type ScheduleDepartureParticipant = {
    memberId: number;
    email?: string | null;
    role: ScheduleDepartureParticipantRole;
    departed: boolean;
    departedAt?: string | null;
};

export type ScheduleItem = {
    id: string;
    ownerMemberId?: number;
    title: string;

    // ✅ 애플 캘린더 핵심: DateTime 기반
    startAt: string; // ISO
    endAt: string;   // ISO
    hasEndTime?: boolean;
    allDay?: boolean;

    // ✅ 이동시간(Travel Time)
    travelMinutes?: number;     // 0, 5, 10, 15, 30, 45, 60...
    departAt?: string;          // 선택: 서버 저장 or 프론트에서 계산(= startAt - travelMinutes)
    departedAt?: string;        // 사용자가 출발 완료 처리한 시각
    myDepartedAt?: string;      // 공유 일정에서 현재 로그인 사용자의 출발 완료 시각
    departureParticipants?: ScheduleDepartureParticipant[];
    travelMode?: TravelMode;

    // ✅ 장소(현재/추후 확장)
    origin?: Place;             // 출발 위치(나중)
    destination?: Place;        // 도착 위치(나중)
    locationName?: string;      // 지금은 문자열만 저장해도 OK (destination.name 역할)

    category: ScheduleCategory;

    notes?: string;
    /** 공유 확장에서 빠르게 저장되어 앱에서 이동 경로를 마저 설정해야 하는 일정 */
    routeSetupRequired?: boolean;
    route?: unknown;
    notificationEnabled?: boolean;
    notificationLeadMinutes?: number;
    notificationIntervalMinutes?: number;
    sharePermission?: ScheduleSharePermission;
    updatedAt?: string;
};
