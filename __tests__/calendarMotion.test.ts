import {
    CALENDAR_DEPTH_MOTION,
    CALENDAR_PILL_MOTION,
    CURRENT_TIME_MOTION,
    MONTH_AGENDA_GESTURE,
    MONTH_AGENDA_MOTION,
    formatCalendarCurrentTime,
    getMonthAgendaGestureTarget,
    getMonthAgendaPanelKind,
    getMonthAgendaSteppedTarget,
    getMonthAgendaTransition,
    resolveMonthAgendaViewportLayout,
    shouldClaimMonthAgendaGesture,
    shouldAnimateCurrentTimeStep,
} from "../src/modules/schedule/calendarMotion";

describe("calendar depth motion", () => {
    test("연·월·일 전환이 하나의 속도와 easing을 공유한다", () => {
        expect(CALENDAR_DEPTH_MOTION.depthSlideDurationMs).toBe(320);
        expect(CALENDAR_DEPTH_MOTION.modeChangeDurationMs).toBe(220);
        expect(CALENDAR_DEPTH_MOTION.reduceMotionDurationMs).toBe(160);
        expect(CALENDAR_DEPTH_MOTION.bezier).toEqual([0.25, 0.1, 0.25, 1]);
        expect(Object.isFrozen(CALENDAR_DEPTH_MOTION)).toBe(true);
        expect(Object.isFrozen(CALENDAR_DEPTH_MOTION.bezier)).toBe(true);
    });

    test("상단 pill 모션은 깊이 전환에 맞춘 작은 변형만 사용한다", () => {
        expect(CALENDAR_PILL_MOTION).toEqual({
            bloomScaleX: 1.035,
            bloomScaleY: 1.018,
            contentTravel: 9,
        });
        expect(CALENDAR_PILL_MOTION.bloomScaleX).toBeLessThanOrEqual(1.04);
        expect(CALENDAR_PILL_MOTION.contentTravel).toBeLessThanOrEqual(10);
        expect(Object.isFrozen(CALENDAR_PILL_MOTION)).toBe(true);
    });

    test("앞으로 이동할 때 두 화면의 경계가 모든 프레임에서 맞닿는다", () => {
        const width = 402;
        for (let index = 0; index <= 1000; index += 1) {
            const progress = index / 1000;
            const sourceRight = -progress * width + width;
            const destinationLeft = (1 - progress) * width;
            expect(sourceRight).toBeCloseTo(destinationLeft, 10);
        }
    });

    test("뒤로 이동할 때 두 화면의 경계가 모든 프레임에서 맞닿는다", () => {
        const width = 402;
        for (let index = 0; index <= 1000; index += 1) {
            const progress = index / 1000;
            const destinationRight = -(1 - progress) * width + width;
            const sourceLeft = progress * width;
            expect(destinationRight).toBeCloseTo(sourceLeft, 10);
        }
    });
});

describe("month agenda panel motion", () => {
    const viewportMetrics = {
        fullCalendarHeight: 911,
        panelCalendarHeight: 433,
        expandedListTop: 127,
    };

    test("상세형과 목록형만 월간 하단 패널을 연다", () => {
        expect(getMonthAgendaPanelKind("detail")).toBe("detail");
        expect(getMonthAgendaPanelKind("list")).toBe("list");
        expect(getMonthAgendaPanelKind("week")).toBe("list");
        expect(getMonthAgendaPanelKind("compact")).toBeNull();
        expect(getMonthAgendaPanelKind("stack")).toBeNull();
    });

    test.each([
        ["list", false, 127, "list"],
        ["detail", true, 433, "detail"],
        ["week", true, 433, "list"],
        ["stack", true, 911, null],
        ["compact", true, 911, null],
    ] as const)(
        "%s 모드의 안정 viewport는 달력 노출=%s, 높이=%s, 패널=%s이다",
        (mode, calendarVisible, calendarTargetHeight, panelKind) => {
            expect(resolveMonthAgendaViewportLayout(mode, viewportMetrics)).toEqual({
                panelKind,
                calendarVisible,
                calendarTargetHeight,
            });
        }
    );

    test("비정상 패널·목록 높이는 유효한 전체 높이로 폴백한다", () => {
        const invalidPanelMetrics = {
            fullCalendarHeight: 911,
            panelCalendarHeight: Number.NaN,
            expandedListTop: Number.POSITIVE_INFINITY,
        };

        expect(resolveMonthAgendaViewportLayout("detail", invalidPanelMetrics))
            .toEqual({
                panelKind: "detail",
                calendarVisible: true,
                calendarTargetHeight: 911,
            });
        expect(resolveMonthAgendaViewportLayout("list", invalidPanelMetrics))
            .toEqual({
                panelKind: "list",
                calendarVisible: false,
                calendarTargetHeight: 911,
            });
    });

    test("전체 높이까지 비정상이면 안전한 0 높이로 폴백한다", () => {
        const invalidMetrics = {
            fullCalendarHeight: Number.NaN,
            panelCalendarHeight: -1,
            expandedListTop: 0,
        };

        expect(resolveMonthAgendaViewportLayout("stack", invalidMetrics))
            .toEqual({
                panelKind: null,
                calendarVisible: true,
                calendarTargetHeight: 0,
            });
        expect(resolveMonthAgendaViewportLayout("detail", invalidMetrics))
            .toEqual({
                panelKind: "detail",
                calendarVisible: true,
                calendarTargetHeight: 0,
            });
        expect(resolveMonthAgendaViewportLayout("list", invalidMetrics))
            .toEqual({
                panelKind: "list",
                calendarVisible: false,
                calendarTargetHeight: 0,
            });
    });

    test.each([
        ["compact", "detail", "enter"],
        ["stack", "list", "enter"],
        ["list", "compact", "exit"],
        ["detail", "stack", "exit"],
        ["detail", "list", "swap"],
        ["list", "detail", "swap"],
        ["compact", "stack", "none"],
        ["detail", "detail", "none"],
    ] as const)("%s -> %s 전환을 %s으로 분류한다", (from, to, expected) => {
        expect(getMonthAgendaTransition(from, to)).toBe(expected);
    });

    test("달력 축소와 패널 상승은 같은 속도와 easing을 공유한다", () => {
        expect(MONTH_AGENDA_MOTION.durationMs).toBe(CALENDAR_DEPTH_MOTION.modeChangeDurationMs);
        expect(MONTH_AGENDA_MOTION.reduceMotionDurationMs)
            .toBe(CALENDAR_DEPTH_MOTION.reduceMotionDurationMs);
        expect(MONTH_AGENDA_MOTION.bezier).toBe(CALENDAR_DEPTH_MOTION.bezier);
        expect(MONTH_AGENDA_MOTION.panelTravel).toBeLessThanOrEqual(72);
        expect(MONTH_AGENDA_MOTION.fadeInStart).toBe(0);
        expect(MONTH_AGENDA_MOTION.fadeInEnd).toBeLessThanOrEqual(0.15);
        expect(Object.isFrozen(MONTH_AGENDA_MOTION)).toBe(true);
    });

    test.each([
        [0, 36, "stack"],
        [0, -36, "list"],
        [0.45, 4, "stack"],
        [-0.45, -4, "list"],
        [0.2, 20, "stack"],
        [-0.2, -20, "list"],
    ] as const)("vy=%s, dy=%s 드래그를 %s으로 판정한다", (vy, dy, expected) => {
        expect(getMonthAgendaGestureTarget(dy, vy)).toBe(expected);
    });

    test("짧고 느린 드래그는 현재 상세형을 유지한다", () => {
        expect(getMonthAgendaGestureTarget(20, 0.1)).toBeNull();
        expect(getMonthAgendaGestureTarget(-20, -0.1)).toBeNull();
    });

    test("충분히 이동한 드래그는 릴리스 순간의 반대 속도보다 이동 방향을 우선한다", () => {
        expect(getMonthAgendaGestureTarget(48, -0.6)).toBe("stack");
        expect(getMonthAgendaGestureTarget(-48, 0.6)).toBe("list");
    });

    test.each([
        ["detail", 52, 0.1, "stack"],
        ["detail", -52, -0.1, "list"],
        ["list", 52, 0.1, "detail"],
        ["list", -52, -0.1, null],
        ["detail", 20, 0.1, null],
        ["list", 20, 0.1, null],
    ] as const)(
        "%s 패널에서 dy=%s, vy=%s 드래그의 단계 전환은 %s이다",
        (panelKind, dy, vy, expected) => {
            expect(getMonthAgendaSteppedTarget(panelKind, dy, vy)).toBe(expected);
        }
    );

    test("단계형 전환도 비정상 드래그 값을 무시한다", () => {
        expect(getMonthAgendaSteppedTarget("detail", Number.NaN, 0)).toBeNull();
        expect(getMonthAgendaSteppedTarget(
            "list",
            0,
            Number.POSITIVE_INFINITY
        )).toBeNull();
    });

    test("수직 우세 드래그만 손잡이 제스처로 점유한다", () => {
        expect(shouldClaimMonthAgendaGesture(4, 8)).toBe(true);
        expect(shouldClaimMonthAgendaGesture(8, 8)).toBe(false);
        expect(shouldClaimMonthAgendaGesture(1, 7.9)).toBe(false);
        expect(shouldClaimMonthAgendaGesture(Number.NaN, 40)).toBe(false);
        expect(shouldClaimMonthAgendaGesture(0, Number.POSITIVE_INFINITY)).toBe(false);
        expect(Object.isFrozen(MONTH_AGENDA_GESTURE)).toBe(true);
    });

    test("비정상 드래그 값은 화면 모드를 변경하지 않는다", () => {
        expect(getMonthAgendaGestureTarget(Number.NaN, 0)).toBeNull();
        expect(getMonthAgendaGestureTarget(0, Number.NEGATIVE_INFINITY)).toBeNull();
    });
});

describe("current time indicator motion", () => {
    test("일반적인 1분 이동만 짧게 보간한다", () => {
        const hourHeight = 50;
        expect(shouldAnimateCurrentTimeStep(500, 500 + hourHeight / 60, hourHeight, true, false))
            .toBe(true);
        expect(shouldAnimateCurrentTimeStep(500, 500 + hourHeight / 30 * 2, hourHeight, true, false))
            .toBe(false);
    });

    test("숨김 상태와 모션 줄이기에서는 즉시 위치를 맞춘다", () => {
        expect(shouldAnimateCurrentTimeStep(500, 501, 50, false, false)).toBe(false);
        expect(shouldAnimateCurrentTimeStep(500, 501, 50, true, true)).toBe(false);
    });

    test("Apple Calendar처럼 현재 시간을 12시간제로 표시한다", () => {
        expect(formatCalendarCurrentTime(new Date(2026, 6, 12, 0, 5))).toBe("12:05");
        expect(formatCalendarCurrentTime(new Date(2026, 6, 12, 15, 43))).toBe("3:43");
    });

    test("Today 이동과 초기 진입의 세로 기준을 분리한다", () => {
        expect(CURRENT_TIME_MOTION.initialLeadHours).toBe(11.75);
        expect(CURRENT_TIME_MOTION.todayTargetLeadHours).toBe(9.75);
        expect(CURRENT_TIME_MOTION.minuteStepDurationMs).toBe(240);
    });
});
