
export type ScheduleSharePermission = "VIEWER" | "COMMENTER" | "EDITOR" | "OWNER";
export type ScheduleShareContentMode = "SCHEDULE_ONLY" | "SCHEDULE_AND_TRAVEL";
export type ScheduleType = "NORMAL" | "ROUTE";

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
    /** 원문을 포함하지 않는 품질 피드백 연결용 임의 ID다. */
    analysisId?: string;
    confidenceVersion?: string;
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
    confidence?: {
        overall: number;
        level: "HIGH" | "MEDIUM" | "REVIEW";
        /** OCR/STT 자체의 참고값이며 일정 필드 정확도와 구분한다. */
        recognition?: number;
        fields: {
            date: number;
            time: number;
            destination: number;
        };
        reasons: string[];
    };
    travelMinutes?: number;
    travelMode?: TravelMode;
    route?: unknown;
    notificationEnabled?: boolean;
    notificationLeadMinutes?: number;
    notificationIntervalMinutes?: number;
};

export type QuickScheduleVerificationSignal =
    | "UNTOUCHED"
    | "USER_CONFIRMED"
    | "USER_CORRECTED";

export type QuickScheduleReliabilityFeedback = {
    analysisId: string;
    outcome: "SAVED" | "CANCELLED";
    date: QuickScheduleVerificationSignal;
    time: QuickScheduleVerificationSignal;
    destination: QuickScheduleVerificationSignal;
    globalConfirmed: boolean;
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

export type ScheduleTravelPlanStatus = "NOT_CONFIGURED" | "READY" | "STALE";

export type ScheduleTravelPlan = {
    id?: number | null;
    scheduleId: number;
    memberId: number;
    status: ScheduleTravelPlanStatus;
    canManageSchedule?: boolean;
    travelMinutes?: number | null;
    departAt?: string | null;
    travelMode?: TravelMode | null;
    origin?: Place | null;
    destination?: Place | null;
    route?: unknown;
    notificationEnabled?: boolean;
    notificationLeadMinutes?: number | null;
    notificationIntervalMinutes?: number | null;
    updatedAt?: string | null;
};

export type ScheduleTravelPlanParticipant = {
    memberId: number;
    email?: string | null;
    role: ScheduleDepartureParticipantRole;
    status: ScheduleTravelPlanStatus;
    canViewDetails: boolean;
    originName?: string | null;
    travelMode?: TravelMode | null;
    travelMinutes?: number | null;
    departAt?: string | null;
};

export type ScheduleItem = {
    id: string;
    ownerMemberId?: number;
    calendarId?: number | null;
    scheduleType?: ScheduleType;
    calendarContentModeOverride?: ScheduleShareContentMode | null;
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
    myTravelPlan?: ScheduleTravelPlan | null;
    travelPlanStatus?: ScheduleTravelPlanStatus | null;
    canViewAllTravelPlans?: boolean;
    travelPlanParticipants?: ScheduleTravelPlanParticipant[];
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
    shareContentMode?: ScheduleShareContentMode | null;
    travelCollaborationEnabled?: boolean | null;
    updatedAt?: string;
};
