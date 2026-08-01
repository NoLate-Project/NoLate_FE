import {
    applyQuickScheduleRouteResult,
    buildQuickSchedulePayload,
    buildQuickScheduleReliabilityFeedback,
    buildQuickSchedulePreviewDraft,
    confirmQuickScheduleGlobalReview,
    getQuickScheduleBlockingReviewField,
    isQuickScheduleRouteReady,
    isValidQuickScheduleDate,
    isValidQuickScheduleTime,
    quickScheduleDateFromDraftTime,
    updateQuickSchedulePreviewDraft,
    type QuickSchedulePreviewDraft,
} from "../src/modules/schedule/quickScheduleDraft";
import type { RouteInfo } from "../src/modules/schedule/routeInfo";
import type { ScheduleParseResult } from "../src/modules/schedule/types";

const category = { id: "1", title: "업무", color: "#f00" };
const origin = { name: "집", lat: 37.501, lng: 127.001 };
const destination = { name: "서울역", lat: 37.555, lng: 126.97 };

function parseResult(
    overrides: Partial<ScheduleParseResult> = {}
): ScheduleParseResult {
    return {
        originSource: "REQUIRED",
        originRequired: false,
        parseSource: "RULE",
        aiAttempted: false,
        needsReview: false,
        warnings: [],
        missingFields: [],
        confidence: {
            overall: 0.97,
            level: "HIGH",
            fields: { date: 0.98, time: 0.98, destination: 0.94 },
            reasons: [],
        },
        ...overrides,
    };
}

function routeInfo(overrides: Partial<RouteInfo> = {}): RouteInfo {
    return {
        id: "route-1",
        originName: "집",
        destinationName: "서울역",
        totalDurationMinutes: 30,
        departureTime: "2026-07-17T10:30:00.000Z",
        arrivalTime: "2026-07-17T11:00:00.000Z",
        timeBasis: "estimated",
        steps: [{
            id: "bus-1",
            type: "BUS",
            title: "버스 이동",
            coordinates: [
                { latitude: origin.lat!, longitude: origin.lng! },
                { latitude: destination.lat!, longitude: destination.lng! },
            ],
        }],
        ...overrides,
    };
}

function completeDraft(
    overrides: Partial<QuickSchedulePreviewDraft> = {}
): QuickSchedulePreviewDraft {
    return {
        title: "회의",
        date: "2026-07-17",
        time: "20:00",
        durationMinutes: 60,
        hasExplicitEndTime: false,
        location: "서울역",
        origin,
        destination,
        travelMode: "TRANSIT",
        travelMinutes: 30,
        route: { routeInfo: routeInfo() },
        departAt: "2026-07-17T10:30:00.000Z",
        notificationLeadMinutes: 30,
        memo: "메모 없음",
        badges: {},
        parsed: parseResult(),
        ...overrides,
    };
}

describe("quick schedule draft", () => {
    test("완전한 분석 결과는 바로 검토 가능한 초안이 된다", () => {
        const draft = buildQuickSchedulePreviewDraft(parseResult({
            title: "저녁 약속",
            startAt: "2026-07-17T20:00:00+09:00",
            origin,
            destination,
            travelMode: "TRANSIT",
            travelMinutes: 30,
            route: { routeInfo: routeInfo() },
        }), "금요일 저녁 약속", "2026-07-17");

        expect(draft.title).toBe("저녁 약속");
        expect(draft.location).toBe("서울역");
        expect(getQuickScheduleBlockingReviewField(draft)).toBeNull();
    });

    test("날짜 누락을 선택일로 조용히 확정하지 않는다", () => {
        const draft = buildQuickSchedulePreviewDraft(parseResult({
            title: "저녁 약속",
            time: "19:00",
        }), "저녁 약속", "2026-07-20");

        expect(draft.date).toBe("2026-07-20");
        expect(draft.badges.date).toBe("날짜 미확정");
        expect(getQuickScheduleBlockingReviewField(draft)).toBe("date");
    });

    test("시간 누락은 기본값을 보여주되 확인 전 저장을 막는다", () => {
        const draft = buildQuickSchedulePreviewDraft(parseResult({
            title: "저녁 약속",
            date: "2026-07-20",
        }), "저녁 약속", "2026-07-17");

        expect(draft.time).toBe("19:00");
        expect(draft.badges.time).toBe("시간 미확정");
        expect(getQuickScheduleBlockingReviewField(draft)).toBe("time");
    });

    test("오전·오후 모호성 경고를 시간 확인으로 분류한다", () => {
        const draft = buildQuickSchedulePreviewDraft(parseResult({
            date: "2026-07-20",
            time: "07:00",
            needsReview: true,
            warnings: ["오전/오후를 확인해 주세요"],
        }), "7시 약속", "2026-07-17");

        expect(draft.badges.time).toBe("시간 확인 필요");
        expect(getQuickScheduleBlockingReviewField(draft)).toBe("time");
    });

    test("90% 미만 핵심 필드는 저장을 막고 사용자 확인을 분석 점수와 분리해 기록한다", () => {
        const draft = buildQuickSchedulePreviewDraft(parseResult({
            title: "서울역 회의",
            date: "2026-07-20",
            time: "15:00",
            destination,
            confidence: {
                overall: 0.86,
                level: "MEDIUM",
                fields: { date: 0.98, time: 0.86, destination: 0.82 },
                reasons: ["음성 인식 결과를 확인해 주세요."],
            },
        }), "월요일 오후 3시 서울역 회의", "2026-07-17");

        expect(draft.badges.time).toBe("신뢰도 확인 필요");
        expect(draft.badges.location).toBe("장소 확인 필요");
        expect(getQuickScheduleBlockingReviewField(draft)).toBe("time");

        const timeConfirmed = updateQuickSchedulePreviewDraft(draft, "time", draft.time);
        expect(timeConfirmed.parsed?.confidence?.fields.time).toBe(0.86);
        expect(timeConfirmed.parsed?.confidence?.level).toBe("MEDIUM");
        expect(timeConfirmed.verification?.fields.time).toBe("USER_CONFIRMED");
        expect(getQuickScheduleBlockingReviewField(timeConfirmed)).toBe("location");

        const locationConfirmed = updateQuickSchedulePreviewDraft(
            timeConfirmed,
            "location",
            timeConfirmed.location
        );
        expect(locationConfirmed.parsed?.confidence).toEqual(expect.objectContaining({
            overall: 0.86,
            level: "MEDIUM",
        }));
        expect(locationConfirmed.verification?.fields.destination).toBe("USER_CONFIRMED");
        expect(getQuickScheduleBlockingReviewField(locationConfirmed)).toBeNull();
    });

    test("신뢰도 계약이 없는 구버전 응답은 세 핵심 필드 확인 전 저장할 수 없다", () => {
        const draft = buildQuickSchedulePreviewDraft(parseResult({
            title: "서울역 회의",
            date: "2026-07-20",
            time: "15:00",
            destination,
            confidence: undefined,
        }), "월요일 오후 3시 서울역 회의", "2026-07-17");

        expect(draft.badges).toEqual(expect.objectContaining({
            date: "신뢰도 계산 불가",
            time: "신뢰도 계산 불가",
            location: "신뢰도 계산 불가",
        }));
        expect(getQuickScheduleBlockingReviewField(draft)).toBe("date");

        const dateConfirmed = updateQuickSchedulePreviewDraft(draft, "date", draft.date);
        const timeConfirmed = updateQuickSchedulePreviewDraft(dateConfirmed, "time", draft.time);
        const locationConfirmed = updateQuickSchedulePreviewDraft(
            timeConfirmed,
            "location",
            draft.location
        );

        expect(locationConfirmed.verification?.fields).toEqual({
            date: "USER_CONFIRMED",
            time: "USER_CONFIRMED",
            destination: "USER_CONFIRMED",
        });
        expect(getQuickScheduleBlockingReviewField(locationConfirmed)).toBeNull();
    });

    test("범위를 벗어난 신뢰도 응답도 계산 실패로 보고 저장을 막는다", () => {
        const draft = buildQuickSchedulePreviewDraft(parseResult({
            date: "2026-07-20",
            time: "15:00",
            destination,
            confidence: {
                overall: 1.2,
                level: "HIGH",
                fields: { date: 0.98, time: 0.98, destination: 0.94 },
                reasons: [],
            },
        }), "월요일 오후 3시 서울역 회의", "2026-07-17");

        expect(draft.parsed?.confidence).toBeUndefined();
        expect(draft.badges.date).toBe("신뢰도 계산 불가");
        expect(getQuickScheduleBlockingReviewField(draft)).toBe("date");
    });

    test("필드로 특정할 수 없는 서버 검토 요청은 전체 내용 확인을 요구한다", () => {
        const draft = buildQuickSchedulePreviewDraft(parseResult({
            title: "서울역 회의",
            date: "2026-07-20",
            time: "15:00",
            destination,
            needsReview: true,
            warnings: ["분석 결과 전체를 원문과 비교해 주세요."],
        }), "월요일 오후 3시 서울역 회의", "2026-07-17");

        expect(getQuickScheduleBlockingReviewField(draft)).toBe("review");
        expect(
            getQuickScheduleBlockingReviewField(confirmQuickScheduleGlobalReview(draft))
        ).toBeNull();
    });

    test("원본 인식률이 높아도 장소 필드가 90% 미만이면 장소 확인을 요구한다", () => {
        const draft = buildQuickSchedulePreviewDraft(parseResult({
            title: "회의",
            date: "2026-07-20",
            time: "15:00",
            destination,
            confidence: {
                overall: 0.91,
                level: "HIGH",
                recognition: 0.97,
                fields: { date: 0.98, time: 0.98, destination: 0.89 },
                reasons: [],
            },
        }), "월요일 오후 3시 서울역 회의", "2026-07-17");

        expect(draft.badges.location).toBe("장소 확인 필요");
        expect(getQuickScheduleBlockingReviewField(draft)).toBe("location");
    });

    test("존재하지 않는 날짜와 24시는 유효하지 않다", () => {
        expect(isValidQuickScheduleDate("2026-02-30")).toBe(false);
        expect(isValidQuickScheduleDate("2026-02-28")).toBe(true);
        expect(isValidQuickScheduleTime("24:00")).toBe(false);
        expect(isValidQuickScheduleTime("23:59")).toBe(true);

        const draft = buildQuickSchedulePreviewDraft(parseResult({
            startAt: "2026-02-30T24:00:00+09:00",
            date: "2026-02-30",
            time: "24:00",
        }), "잘못된 일정", "2026-02-28");
        expect(draft.date).toBe("2026-02-28");
        expect(getQuickScheduleBlockingReviewField(draft)).toBe("date");
    });

    test("명시적인 종료 시각과 일정 길이를 저장 payload까지 보존한다", () => {
        const draft = buildQuickSchedulePreviewDraft(parseResult({
            title: "두 시간 회의",
            startAt: "2026-07-17T15:00:00+09:00",
            endAt: "2026-07-17T17:00:00+09:00",
            hasExplicitEndTime: true,
        }), "3시부터 5시 회의", "2026-07-17");
        const confirmed = updateQuickSchedulePreviewDraft(
            updateQuickSchedulePreviewDraft(draft, "date", draft.date),
            "time",
            draft.time
        );
        const payload = buildQuickSchedulePayload(confirmed, category);

        expect(draft.hasExplicitEndTime).toBe(true);
        expect(draft.durationMinutes).toBe(120);
        expect(payload.hasEndTime).toBe(true);
        expect(new Date(payload.endAt).getTime() - new Date(payload.startAt).getTime())
            .toBe(120 * 60_000);
    });

    test("구버전 parse 응답의 endAt을 명시적 종료 시각으로 오인하지 않는다", () => {
        const draft = buildQuickSchedulePreviewDraft(parseResult({
            title: "약속",
            startAt: "2026-07-17T15:00:00+09:00",
            // 구버전 서버는 기본 지속 시간으로 계산한 endAt만 반환했다.
            endAt: "2026-07-17T17:00:00+09:00",
        }), "3시 약속", "2026-07-17");
        const payload = buildQuickSchedulePayload(draft, category);

        expect(draft.hasExplicitEndTime).toBe(false);
        expect(draft.durationMinutes).toBe(60);
        expect(payload.hasEndTime).toBe(false);
        expect(new Date(payload.endAt).getTime() - new Date(payload.startAt).getTime())
            .toBe(60 * 60_000);
    });

    test("날짜 확인만 한 경우 기존 경로를 지우지 않는다", () => {
        const draft = completeDraft({ badges: { date: "날짜 확인 필요" } });
        const next = updateQuickSchedulePreviewDraft(draft, "date", draft.date);

        expect(next.badges.date).toBeUndefined();
        expect(next.route).toBe(draft.route);
        expect(next.departAt).toBe(draft.departAt);
    });

    test("경로 설정 후 날짜나 시간을 바꿔도 선택 경로를 새 도착 시각에 맞춰 보존한다", () => {
        const dateChanged = updateQuickSchedulePreviewDraft(
            completeDraft(),
            "date",
            "2026-07-18"
        );
        const timeChanged = updateQuickSchedulePreviewDraft(
            completeDraft(),
            "time",
            "21:00"
        );

        for (const next of [dateChanged, timeChanged]) {
            expect(next.route).toBeDefined();
            expect(next.travelMinutes).toBe(30);
            expect(next.departAt).toBeDefined();
            expect(next.notificationLeadMinutes).toBe(30);
            expect(next.badges.notification).toBeUndefined();
            expect(isQuickScheduleRouteReady(next)).toBe(true);

            const nextRouteInfo = (next.route as { routeInfo: RouteInfo }).routeInfo;
            const nextArrivalAt = quickScheduleDateFromDraftTime(next.date, next.time);
            expect(nextRouteInfo.arrivalTime).toBe(nextArrivalAt.toISOString());
            expect(nextRouteInfo.departureTime).toBe(next.departAt);
            expect(nextRouteInfo.timeBasis).toBe("estimated");

            const payload = buildQuickSchedulePayload(next, category);
            expect(payload.travelMode).toBe("TRANSIT");
            expect(payload.travelMinutes).toBe(30);
            expect(payload.route).toEqual(next.route);
        }
    });

    test("유효하지 않은 일정 시각으로 바꾸면 과거 경로를 저장하지 않는다", () => {
        const next = updateQuickSchedulePreviewDraft(completeDraft(), "time", "24:00");

        expect(next.route).toBeUndefined();
        expect(next.travelMinutes).toBeUndefined();
        expect(next.departAt).toBeUndefined();
        expect(next.notificationLeadMinutes).toBeUndefined();
        expect(next.badges.notification).toBe("경로 다시 확인");
    });

    test("목적지를 비우면 장소 경고를 복원하고 기존 경로를 지운다", () => {
        const next = updateQuickSchedulePreviewDraft(completeDraft(), "location", "  ");

        expect(next.location).toBe("장소 미정");
        expect(next.badges.location).toBe("장소 확인 필요");
        expect(next.route).toBeUndefined();
        expect(next.departAt).toBeUndefined();
    });

    test("좌표와 양수 소요시간이 없는 이름-only 경로는 알림 경로가 아니다", () => {
        const draft = completeDraft({
            origin: { name: "집" },
            destination: { name: "서울역" },
            travelMinutes: 30,
            route: undefined,
        });

        expect(isQuickScheduleRouteReady(draft)).toBe(false);
        const payload = buildQuickSchedulePayload(draft, category);
        expect(payload.notificationEnabled).toBe(false);
        expect(payload.route).toBeUndefined();
        expect(payload.departAt).toBeUndefined();

        expect(isQuickScheduleRouteReady(completeDraft({
            route: { id: "incomplete", mode: "TRANSIT", minutes: 30 },
        }))).toBe(false);
    });

    test("완전한 경로 결과는 초안에 적용되고 알림을 선택할 수 있다", () => {
        const initial = completeDraft({
            origin: undefined,
            destination: { name: "서울역" },
            route: undefined,
            travelMinutes: undefined,
            departAt: undefined,
            notificationLeadMinutes: undefined,
            badges: { notification: "선택 설정" },
        });
        const next = applyQuickScheduleRouteResult(initial, {
            origin,
            destination,
            travelMode: "TRANSIT",
            travelMinutes: 30,
            departureAt: "2026-07-17T10:30:00.000Z",
            route: { routeInfo: routeInfo() },
        });

        expect(isQuickScheduleRouteReady(next)).toBe(true);
        expect(next.departAt).toBe("2026-07-17T10:30:00.000Z");
        expect(next.badges.notification).toBe("알림 미설정");
    });

    test("경로가 없어도 일정은 저장하고 경로 알림만 끈다", () => {
        const draft = completeDraft({
            origin: undefined,
            route: undefined,
            travelMinutes: undefined,
            departAt: undefined,
            notificationLeadMinutes: 30,
        });
        const payload = buildQuickSchedulePayload(draft, category);

        expect(payload.title).toBe("회의");
        expect(payload.destination).toEqual(destination);
        expect(payload.notificationEnabled).toBe(false);
        expect(payload.notificationLeadMinutes).toBeUndefined();
    });

    test("경로 준비가 끝난 경우에만 route와 출발 알림을 저장한다", () => {
        const payload = buildQuickSchedulePayload(completeDraft(), category);

        expect(payload.route).toEqual({ routeInfo: routeInfo() });
        expect(payload.departAt).toBe("2026-07-17T10:30:00.000Z");
        expect(payload.notificationEnabled).toBe(true);
        expect(payload.notificationLeadMinutes).toBe(30);
    });

    test("top-level 출발 시각이 없으면 검증된 routeInfo 시각을 단일 소스로 사용한다", () => {
        const payload = buildQuickSchedulePayload(
            completeDraft({ departAt: undefined }),
            category
        );

        expect(payload.departAt).toBe(routeInfo().departureTime);
    });
});

describe("빠른 일정 신뢰도 피드백", () => {
    test("모델 점수는 바꾸지 않고 사용자 확인과 수정을 별도 신호로 만든다", () => {
        const parsed = parseResult({
            analysisId: "analysis-1",
            startAt: "2026-07-17T11:00:00.000Z",
            destination,
            confidence: {
                overall: 0.86,
                level: "MEDIUM",
                fields: { date: 0.86, time: 0.86, destination: 0.86 },
                reasons: [],
            },
        });
        let draft = buildQuickSchedulePreviewDraft(parsed, "회의", "2026-07-17");
        draft = updateQuickSchedulePreviewDraft(draft, "date", draft.date);
        draft = updateQuickSchedulePreviewDraft(draft, "time", "20:30");
        draft = updateQuickSchedulePreviewDraft(draft, "location", "용산역");

        expect(buildQuickScheduleReliabilityFeedback(draft, "SAVED")).toEqual({
            analysisId: "analysis-1",
            outcome: "SAVED",
            date: "USER_CONFIRMED",
            time: "USER_CORRECTED",
            destination: "USER_CORRECTED",
            globalConfirmed: false,
        });
        expect(draft.parsed?.confidence?.overall).toBe(0.86);
    });

    test("분석 ID가 없는 구버전 응답은 피드백을 만들지 않는다", () => {
        expect(buildQuickScheduleReliabilityFeedback(completeDraft(), "CANCELLED")).toBeNull();
    });
});
