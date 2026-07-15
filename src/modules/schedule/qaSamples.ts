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
        route: {
            // 실제 경로 선택 화면이 저장하는 대안 경로 + routeInfo 결합 구조를 재현한다.
            id: "qa-seoul-to-gangnam",
            mode: "TRANSIT",
            minutes: 32,
            distanceMeters: 14500,
            transferCount: 1,
            walkMeters: 420,
            fareWon: 1550,
            source: "api",
            transitModeSummary: "4호선 · 2호선",
            pathCoords: [
                { lat: 37.5559, lng: 126.9723 },
                { lat: 37.5445, lng: 126.9720 },
                { lat: 37.5348, lng: 126.9720 },
                { lat: 37.5225, lng: 126.9730 },
                { lat: 37.5029, lng: 126.9800 },
                { lat: 37.4765, lng: 126.9816 },
                { lat: 37.4919, lng: 126.9900 },
                { lat: 37.4934, lng: 127.0140 },
                { lat: 37.4979, lng: 127.0276 },
            ],
            transitLegs: [
                {
                    kind: "WALK",
                    label: "서울역 승강장까지 도보",
                    durationMinutes: 3,
                    distanceMeters: 220,
                    startName: "서울역",
                    endName: "서울역 4호선",
                    startCoord: { lat: 37.5559, lng: 126.9723 },
                    endCoord: { lat: 37.5547, lng: 126.9726 },
                    pathCoords: [
                        { lat: 37.5559, lng: 126.9723 },
                        { lat: 37.5553, lng: 126.9725 },
                        { lat: 37.5547, lng: 126.9726 },
                    ],
                },
                {
                    kind: "SUBWAY",
                    label: "4호선",
                    lineName: "4호선",
                    lineColor: "00A4E3",
                    durationMinutes: 16,
                    stationCount: 8,
                    startName: "서울역",
                    endName: "사당역",
                    startCoord: { lat: 37.5559, lng: 126.9723 },
                    endCoord: { lat: 37.4765, lng: 126.9816 },
                    passStops: [
                        { name: "숙대입구역", sequence: 1, coord: { lat: 37.5445, lng: 126.9720 } },
                        { name: "삼각지역", sequence: 2, coord: { lat: 37.5348, lng: 126.9720 } },
                        { name: "이촌역", sequence: 3, coord: { lat: 37.5225, lng: 126.9730 } },
                        { name: "동작역", sequence: 4, coord: { lat: 37.5029, lng: 126.9800 } },
                        { name: "사당역", sequence: 5, coord: { lat: 37.4765, lng: 126.9816 } },
                    ],
                    pathCoords: [
                        { lat: 37.5559, lng: 126.9723 },
                        { lat: 37.5445, lng: 126.9720 },
                        { lat: 37.5348, lng: 126.9720 },
                        { lat: 37.5225, lng: 126.9730 },
                        { lat: 37.5029, lng: 126.9800 },
                        { lat: 37.4765, lng: 126.9816 },
                    ],
                },
                {
                    kind: "SUBWAY",
                    label: "2호선",
                    lineName: "2호선",
                    lineColor: "00B140",
                    durationMinutes: 8,
                    stationCount: 4,
                    startName: "사당역",
                    endName: "강남역",
                    startCoord: { lat: 37.4765, lng: 126.9816 },
                    endCoord: { lat: 37.4979, lng: 127.0276 },
                    passStops: [
                        { name: "방배역", sequence: 1, coord: { lat: 37.4814, lng: 126.9976 } },
                        { name: "서초역", sequence: 2, coord: { lat: 37.4919, lng: 127.0079 } },
                        { name: "교대역", sequence: 3, coord: { lat: 37.4934, lng: 127.0140 } },
                        { name: "강남역", sequence: 4, coord: { lat: 37.4979, lng: 127.0276 } },
                    ],
                    pathCoords: [
                        { lat: 37.4765, lng: 126.9816 },
                        { lat: 37.4814, lng: 126.9976 },
                        { lat: 37.4919, lng: 127.0079 },
                        { lat: 37.4934, lng: 127.0140 },
                        { lat: 37.4979, lng: 127.0276 },
                    ],
                },
                {
                    kind: "WALK",
                    label: "미팅 장소까지 도보",
                    durationMinutes: 4,
                    distanceMeters: 200,
                    startName: "강남역",
                    endName: "미팅 장소",
                    startCoord: { lat: 37.4979, lng: 127.0276 },
                    endCoord: { lat: 37.4987, lng: 127.0290 },
                    pathCoords: [
                        { lat: 37.4979, lng: 127.0276 },
                        { lat: 37.4983, lng: 127.0282 },
                        { lat: 37.4987, lng: 127.0290 },
                    ],
                },
            ],
            routeInfo: {
                id: "qa-seoul-to-gangnam",
                originName: "서울역",
                destinationName: "강남역",
                totalDurationMinutes: 32,
                departureTime: depart.toISOString(),
                arrivalTime: start.toISOString(),
                fare: 1550,
                transferCount: 1,
                walkingDistanceMeters: 420,
                totalDistanceMeters: 14500,
                timeBasis: "estimated",
                steps: [
                    {
                        id: "origin",
                        type: "ORIGIN",
                        title: "서울역",
                        coordinates: [{ latitude: 37.5559, longitude: 126.9723 }],
                    },
                    {
                        id: "walk-1",
                        type: "WALK",
                        title: "도보",
                        description: "220m · 3분",
                        durationMinutes: 3,
                        distanceMeters: 220,
                    },
                    {
                        id: "subway-4",
                        type: "SUBWAY",
                        title: "4호선 서울역 승차 → 사당 하차",
                        description: "8정거장 · 16분",
                        durationMinutes: 16,
                        stationCount: 8,
                        lineName: "4호선",
                        lineColor: "#00A4E3",
                        badgeText: "4호선",
                    },
                    {
                        id: "subway-2",
                        type: "SUBWAY",
                        title: "2호선 사당 승차 → 강남 하차",
                        description: "4정거장 · 8분",
                        durationMinutes: 8,
                        stationCount: 4,
                        lineName: "2호선",
                        lineColor: "#00B140",
                        badgeText: "2호선",
                    },
                    {
                        id: "walk-2",
                        type: "WALK",
                        title: "도보",
                        description: "200m · 4분",
                        durationMinutes: 4,
                        distanceMeters: 200,
                    },
                    {
                        id: "destination",
                        type: "DESTINATION",
                        title: "강남역",
                        coordinates: [{ latitude: 37.4979, longitude: 127.0276 }],
                    },
                ],
            },
        },
        category: {
            id: "1",
            title: "업무",
            color: "#f44336",
        },
        departureParticipants: [
            {
                memberId: 101,
                email: "owner@nolate.test",
                role: "OWNER",
                departed: false,
            },
            {
                memberId: 202,
                email: "yuna@nolate.test",
                role: "SHARED",
                departed: true,
                departedAt: new Date(depart.getTime() + (4 * 60 * 1000)).toISOString(),
            },
            {
                memberId: 203,
                email: "minsu@nolate.test",
                role: "SHARED",
                departed: false,
            },
            {
                memberId: 204,
                email: "jiyoon@nolate.test",
                role: "SHARED",
                departed: false,
            },
        ],
        notes: "도착 전 자료 확인",
        notificationEnabled: true,
        notificationLeadMinutes: 30,
        notificationIntervalMinutes: 10,
    };
}

/** Deterministic, development-only month density used by simulator visual QA. */
export function createQaMonthScheduleItems(now = new Date()): ScheduleItem[] {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);

    const categories = [
        { id: "qa-work", title: "업무", color: "#2f80ed" },
        { id: "qa-personal", title: "개인", color: "#34c759" },
        { id: "qa-appointment", title: "약속", color: "#ff3b30" },
        { id: "qa-family", title: "가족", color: "#af52de" },
    ];
    const specs = [
        { offset: 0, hour: 0, title: "김유나 · 정지훈 생일", category: 2, allDay: true },
        { offset: 0, hour: 9, title: "팀 주간 회의", category: 0 },
        { offset: 0, hour: 11, title: "디자인 검토", category: 3 },
        { offset: 0, hour: 14, title: "강남역 클라이언트 미팅", category: 2, travelMode: "TRANSIT" as const },
        { offset: 0, hour: 18, title: "저녁 약속", category: 1 },
        { offset: 2, hour: 10, title: "프로젝트 리뷰", category: 0 },
        { offset: 3, hour: 0, title: "부모님 결혼기념일", category: 3, allDay: true },
        { offset: 3, hour: 16, title: "치과 예약", category: 2 },
        { offset: 6, hour: 13, title: "개인 운동", category: 1 },
        { offset: 9, hour: 8, title: "분기 계획 워크숍", category: 0 },
    ];

    return specs.map((spec, index) => {
        const start = new Date(day);
        start.setDate(day.getDate() + spec.offset);
        start.setHours(spec.hour, 0, 0, 0);
        const end = new Date(start);
        if (spec.allDay) {
            end.setDate(end.getDate() + 1);
        } else {
            end.setHours(end.getHours() + 1);
        }

        return {
            id: `qa-month-${index}`,
            title: spec.title,
            startAt: start.toISOString(),
            endAt: end.toISOString(),
            hasEndTime: !spec.allDay,
            allDay: spec.allDay,
            travelMode: spec.travelMode,
            category: categories[spec.category],
        };
    });
}
