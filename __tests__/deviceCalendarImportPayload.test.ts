import {
    buildCalendarImportSource,
    buildSchedulePayloadFromCandidate,
    type DeviceCalendarCandidate,
} from "../src/modules/onboarding/deviceCalendarImport";

const CANDIDATE: DeviceCalendarCandidate = {
    id: "APPLE_DEVICE:calendar:event:2099-01-02T12:00:00.000Z",
    provider: "APPLE_DEVICE",
    eventId: "event",
    calendarId: "calendar",
    calendarTitle: "개인",
    title: "미래 일정",
    startAt: "2099-01-02T12:00:00.000Z",
    endAt: "2099-01-02T13:00:00.000Z",
    allDay: false,
    locationName: "서울역",
    requiresTimeReview: false,
    recommended: true,
};

const SETTINGS = {
    category: { id: "1", title: "개인", color: "#2196f3" },
    travelMode: "TRANSIT" as const,
    travelMinutes: 30,
    prepareDepartureAlert: true,
};

describe("calendar import schedule payload", () => {
    test("원본 캘린더 발생 건 식별자를 반복 가져오기 API 형식으로 보존한다", () => {
        expect(buildCalendarImportSource(CANDIDATE)).toEqual({
            provider: "APPLE_DEVICE",
            calendarId: "calendar",
            eventId: "event",
            occurrenceStartAt: "2099-01-02T12:00:00.000Z",
        });
    });

    test("원본 event id가 없으면 중복 방지가 불가능하므로 가져오기를 중단한다", () => {
        expect(() => buildCalendarImportSource({ ...CANDIDATE, eventId: "  " }))
            .toThrow("이 일정을 가져올 수 없어요. 캘린더에서 일정을 다시 확인해 주세요.");
    });

    test("가져온 일정의 메모에는 사용자가 작성한 내용만 보존한다", () => {
        const payload = buildSchedulePayloadFromCandidate(
            { ...CANDIDATE, notes: "준비물 확인" },
            SETTINGS
        );

        expect(payload.notes).toBe("준비물 확인");
    });

    test("경로가 없는 외부 일정은 예상 출발값만 저장하고 실시간 알림은 끈다", () => {
        const payload = buildSchedulePayloadFromCandidate(CANDIDATE, SETTINGS);

        expect(payload).toMatchObject({
            title: "미래 일정",
            travelMinutes: 30,
            departAt: "2099-01-02T11:30:00.000Z",
            travelMode: "TRANSIT",
            locationName: "서울역",
            destination: {
                name: "서울역",
                address: "서울역",
            },
            notificationEnabled: false,
        });
        expect(payload.notificationLeadMinutes).toBeUndefined();
        expect(payload.notificationIntervalMinutes).toBeUndefined();
    });

    test("출발 준비를 끄면 이동 관련 공통값을 일정에 넣지 않는다", () => {
        const payload = buildSchedulePayloadFromCandidate(CANDIDATE, {
            ...SETTINGS,
            prepareDepartureAlert: false,
        });

        expect(payload.travelMinutes).toBeUndefined();
        expect(payload.departAt).toBeUndefined();
        expect(payload.travelMode).toBeUndefined();
        expect(payload.notificationEnabled).toBe(false);
    });

    test("종일 일정에는 임의 출발 시간을 만들지 않는다", () => {
        const payload = buildSchedulePayloadFromCandidate(
            { ...CANDIDATE, allDay: true, requiresTimeReview: true },
            SETTINGS
        );

        expect(payload.travelMinutes).toBeUndefined();
        expect(payload.departAt).toBeUndefined();
        expect(payload.travelMode).toBeUndefined();
        expect(payload.notificationEnabled).toBe(false);
    });
});
