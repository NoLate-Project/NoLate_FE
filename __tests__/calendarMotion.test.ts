import {
    CALENDAR_DEPTH_MOTION,
    CALENDAR_INTERACTION_BUDGET_MS,
    CALENDAR_PRIMARY_PILL_LAYOUT,
    CALENDAR_PILL_MOTION,
    CALENDAR_TODAY_FOCUS_MOTION,
    CALENDAR_TRANSITION_DURATION_MS,
    CURRENT_TIME_MOTION,
    DETAIL_MONTH_HEIGHT_MOTION,
    DETAIL_MONTH_PANEL_LAYOUT,
    DETAIL_MONTH_SWIPE_GESTURE,
    DETAIL_MONTH_SWIPE_MOTION,
    MONTH_AGENDA_GESTURE,
    MONTH_AGENDA_MOTION,
    formatCalendarCurrentTime,
    getCalendarMonthWeekCount,
    getDetailMonthSwipeFollowOffset,
    getDetailMonthSwipeFollowOpacity,
    getDetailMonthSwipeGestureDirection,
    getDetailMonthSwipeOffsets,
    getDetailMonthSwipeSettleDuration,
    getMonthAgendaGestureTarget,
    getMonthAgendaPanelKind,
    getMonthAgendaSteppedTarget,
    getMonthAgendaTransition,
    resolveMonthAgendaViewportLayout,
    resolveCalendarPrimaryPillLayout,
    resolveDetailMonthPanelLayout,
    shouldClaimDetailMonthSwipeGesture,
    shouldClaimMonthAgendaGesture,
    shouldAnimateCurrentTimeStep,
} from "../src/modules/schedule/calendarMotion";

describe("calendar depth motion", () => {
    test("연·월·일 전환이 하나의 속도와 easing을 공유한다", () => {
        expect(CALENDAR_DEPTH_MOTION.depthSlideDurationMs)
            .toBe(CALENDAR_TRANSITION_DURATION_MS);
        expect(CALENDAR_DEPTH_MOTION.modeChangeDurationMs)
            .toBe(CALENDAR_TRANSITION_DURATION_MS);
        expect(CALENDAR_DEPTH_MOTION.reduceMotionDurationMs)
            .toBe(CALENDAR_TRANSITION_DURATION_MS);
        expect(CALENDAR_DEPTH_MOTION.bezier).toEqual([0.25, 0.1, 0.25, 1]);
        expect(Object.isFrozen(CALENDAR_DEPTH_MOTION)).toBe(true);
        expect(Object.isFrozen(CALENDAR_DEPTH_MOTION.bezier)).toBe(true);
    });

    test("캘린더 깊이·모드 전환은 200ms 상호작용 예산 안에 끝난다", () => {
        expect(CALENDAR_INTERACTION_BUDGET_MS).toBe(200);
        expect(CALENDAR_TRANSITION_DURATION_MS).toBe(160);
        expect(CALENDAR_TRANSITION_DURATION_MS)
            .toBeLessThan(CALENDAR_INTERACTION_BUDGET_MS);

        for (const durationMs of [
            CALENDAR_DEPTH_MOTION.depthSlideDurationMs,
            CALENDAR_DEPTH_MOTION.modeChangeDurationMs,
            CALENDAR_DEPTH_MOTION.reduceMotionDurationMs,
            MONTH_AGENDA_MOTION.durationMs,
            MONTH_AGENDA_MOTION.reduceMotionDurationMs,
        ]) {
            expect(durationMs).toBeLessThanOrEqual(CALENDAR_INTERACTION_BUDGET_MS);
        }
    });

    test("상세형 월 스와이프는 commit 프레임을 포함해 160ms 안에 끝난다", () => {
        const duration = DETAIL_MONTH_SWIPE_MOTION.exitDurationMs
            + DETAIL_MONTH_SWIPE_MOTION.commitFrameBudgetMs
            + DETAIL_MONTH_SWIPE_MOTION.enterDurationMs;
        const reduceMotionDuration = DETAIL_MONTH_SWIPE_MOTION.reduceMotionExitDurationMs
            + DETAIL_MONTH_SWIPE_MOTION.commitFrameBudgetMs
            + DETAIL_MONTH_SWIPE_MOTION.reduceMotionEnterDurationMs;
        const watchdogRecoveryDuration = DETAIL_MONTH_SWIPE_MOTION.exitDurationMs
            + DETAIL_MONTH_SWIPE_MOTION.commitWatchdogMs;

        expect(duration).toBe(CALENDAR_TRANSITION_DURATION_MS);
        expect(reduceMotionDuration).toBeLessThan(duration);
        expect(watchdogRecoveryDuration).toBeLessThanOrEqual(
            CALENDAR_INTERACTION_BUDGET_MS
        );
        expect(DETAIL_MONTH_SWIPE_MOTION.reduceMotionTravel).toBe(0);
        expect(Object.isFrozen(DETAIL_MONTH_SWIPE_MOTION)).toBe(true);
    });

    test("5주↔6주 월 높이는 스와이프와 독립된 easing으로 보간한다", () => {
        expect(DETAIL_MONTH_HEIGHT_MOTION.durationMs).toBe(220);
        expect(DETAIL_MONTH_HEIGHT_MOTION.reduceMotionDurationMs).toBe(80);
        expect(DETAIL_MONTH_HEIGHT_MOTION.bezier).toEqual([0.2, 0, 0, 1]);
        expect(Object.isFrozen(DETAIL_MONTH_HEIGHT_MOTION)).toBe(true);
        expect(Object.isFrozen(DETAIL_MONTH_HEIGHT_MOTION.bezier)).toBe(true);
    });

    test("Today 세로 전환도 commit 프레임을 포함해 160ms 안에 끝난다", () => {
        const duration = CALENDAR_TODAY_FOCUS_MOTION.exitDurationMs
            + CALENDAR_TODAY_FOCUS_MOTION.commitFrameBudgetMs
            + CALENDAR_TODAY_FOCUS_MOTION.enterDurationMs;
        const reduceMotionDuration = CALENDAR_TODAY_FOCUS_MOTION.reduceMotionExitDurationMs
            + CALENDAR_TODAY_FOCUS_MOTION.commitFrameBudgetMs
            + CALENDAR_TODAY_FOCUS_MOTION.reduceMotionEnterDurationMs;

        expect(duration).toBe(CALENDAR_TRANSITION_DURATION_MS);
        expect(reduceMotionDuration).toBeLessThan(duration);
        expect(CALENDAR_TODAY_FOCUS_MOTION.outgoingTravel).toBeLessThan(
            CALENDAR_TODAY_FOCUS_MOTION.incomingTravel
        );
        expect(CALENDAR_TODAY_FOCUS_MOTION.reduceMotionTravel).toBe(0);
        expect(Object.isFrozen(CALENDAR_TODAY_FOCUS_MOTION)).toBe(true);
    });

    test.each([
        [1, -320, 320],
        [-1, 320, -320],
    ] as const)(
        "상세형 월 이동 방향 %s는 outgoing=%s, incoming=%s이다",
        (direction, outgoing, incoming) => {
            expect(getDetailMonthSwipeOffsets(direction)).toEqual({
                outgoing,
                incoming,
            });
        }
    );

    test("상세형 월 스와이프는 비정상 travel을 움직임 없는 값으로 보정한다", () => {
        expect(getDetailMonthSwipeOffsets(1, Number.NaN)).toEqual({
            outgoing: 0,
            incoming: 0,
        });
        expect(getDetailMonthSwipeOffsets(-1, -24)).toEqual({
            outgoing: 0,
            incoming: 0,
        });
    });

    test("상세형 월 드래그 판정값은 짧은 상호작용 예산 안에 있다", () => {
        expect(DETAIL_MONTH_SWIPE_GESTURE).toEqual({
            activationDistance: 8,
            directionDominance: 1.2,
            distanceThreshold: 36,
            velocityThreshold: 0.35,
            velocityProjection: 80,
            followRatio: 1,
            maxFollowTravel: 320,
            cancelDurationMs: 110,
            maxOpacityLoss: 0,
        });
        expect(DETAIL_MONTH_SWIPE_GESTURE.cancelDurationMs).toBeLessThanOrEqual(120);
        expect(Object.isFrozen(DETAIL_MONTH_SWIPE_GESTURE)).toBe(true);
    });

    test("상세형 월 settle은 최소 시간 없이 거리·속도에 따라 줄어든다", () => {
        const maximum = DETAIL_MONTH_SWIPE_MOTION.maxGestureSettleDurationMs;

        expect(maximum).toBe(
            CALENDAR_INTERACTION_BUDGET_MS
                - DETAIL_MONTH_SWIPE_MOTION.commitFrameBudgetMs
        );
        expect(getDetailMonthSwipeSettleDuration(400, 0, 400))
            .toBe(maximum);
        expect(getDetailMonthSwipeSettleDuration(200, 0, 400))
            .toBe(maximum / 2);
        expect(getDetailMonthSwipeSettleDuration(400, 4, 400))
            .toBe(100);
        expect(getDetailMonthSwipeSettleDuration(1, 0, 400))
            .toBeLessThan(1);
        expect(getDetailMonthSwipeSettleDuration(0, 0, 400)).toBe(0);
    });

    test("상세형 월 settle은 반대·비정상 속도를 안전하게 보정한다", () => {
        const maximum = DETAIL_MONTH_SWIPE_MOTION.maxGestureSettleDurationMs;

        expect(getDetailMonthSwipeSettleDuration(400, -4, 400))
            .toBe(maximum);
        expect(getDetailMonthSwipeSettleDuration(500, 0, 400))
            .toBe(maximum);
        expect(getDetailMonthSwipeSettleDuration(
            Number.NaN,
            0,
            400
        )).toBe(0);
        expect(getDetailMonthSwipeSettleDuration(100, 0, 0)).toBe(0);
        expect(getDetailMonthSwipeSettleDuration(100, 0, 400, 0)).toBe(0);
    });

    test("가로 우세 드래그만 상세형 월 스와이프로 점유한다", () => {
        expect(shouldClaimDetailMonthSwipeGesture(8, 4)).toBe(true);
        expect(shouldClaimDetailMonthSwipeGesture(-8, 0)).toBe(true);
        expect(shouldClaimDetailMonthSwipeGesture(8, 8)).toBe(false);
        expect(shouldClaimDetailMonthSwipeGesture(7.9, 0)).toBe(false);
        expect(shouldClaimDetailMonthSwipeGesture(Number.NaN, 0)).toBe(false);
        expect(shouldClaimDetailMonthSwipeGesture(
            40,
            Number.POSITIVE_INFINITY
        )).toBe(false);
    });

    test.each([
        [36, 0, -1],
        [-36, 0, 1],
        [4, 0.35, -1],
        [-4, -0.35, 1],
        [20, 0.2, -1],
        [-20, -0.2, 1],
    ] as const)(
        "상세형 dx=%s, vx=%s 드래그를 월 이동 방향 %s로 판정한다",
        (dx, vx, expected) => {
            expect(getDetailMonthSwipeGestureDirection(dx, vx)).toBe(expected);
        }
    );

    test("충분한 이동 거리는 릴리스 순간의 반대 속도보다 우선한다", () => {
        expect(getDetailMonthSwipeGestureDirection(48, -0.8)).toBe(-1);
        expect(getDetailMonthSwipeGestureDirection(-48, 0.8)).toBe(1);
    });

    test("짧고 느린 드래그와 비정상 값은 월을 바꾸지 않는다", () => {
        expect(getDetailMonthSwipeGestureDirection(20, 0.1)).toBeNull();
        expect(getDetailMonthSwipeGestureDirection(-20, -0.1)).toBeNull();
        expect(getDetailMonthSwipeGestureDirection(Number.NaN, 0)).toBeNull();
        expect(getDetailMonthSwipeGestureDirection(
            0,
            Number.NEGATIVE_INFINITY
        )).toBeNull();
    });

    test("상세형 월은 손가락 이동을 page 범위 안에서 그대로 따라간다", () => {
        expect(getDetailMonthSwipeFollowOffset(10)).toBe(10);
        expect(getDetailMonthSwipeFollowOffset(-10)).toBe(-10);
        expect(getDetailMonthSwipeFollowOffset(100)).toBe(100);
        expect(getDetailMonthSwipeFollowOffset(-100)).toBe(-100);
        expect(getDetailMonthSwipeFollowOffset(400)).toBe(320);
        expect(getDetailMonthSwipeFollowOffset(-400)).toBe(-320);
        expect(getDetailMonthSwipeFollowOffset(100, false, 12)).toBe(12);
    });

    test("모션 줄이기와 비정상 follow 값은 이동시키지 않는다", () => {
        expect(getDetailMonthSwipeFollowOffset(100, true)).toBe(0);
        expect(getDetailMonthSwipeFollowOffset(Number.NaN)).toBe(0);
        expect(getDetailMonthSwipeFollowOffset(20, false, Number.NaN)).toBe(0);
        expect(getDetailMonthSwipeFollowOffset(20, false, -1)).toBe(0);
    });

    test("page swipe 중에는 달력을 흐리게 만들지 않는다", () => {
        expect(getDetailMonthSwipeFollowOpacity(0)).toBe(1);
        expect(getDetailMonthSwipeFollowOpacity(12)).toBe(1);
        expect(getDetailMonthSwipeFollowOpacity(-12)).toBe(1);
        expect(getDetailMonthSwipeFollowOpacity(240)).toBe(1);
    });

    test("비정상 opacity 입력과 움직임 없는 travel은 불투명하게 유지한다", () => {
        expect(getDetailMonthSwipeFollowOpacity(Number.NaN)).toBe(1);
        expect(getDetailMonthSwipeFollowOpacity(12, Number.POSITIVE_INFINITY))
            .toBe(1);
        expect(getDetailMonthSwipeFollowOpacity(12, 0)).toBe(1);
        expect(getDetailMonthSwipeFollowOpacity(12, -24)).toBe(1);
    });

    test("상단 pill 모션은 깊이 전환에 맞춘 작은 변형만 사용한다", () => {
        expect(CALENDAR_PILL_MOTION).toEqual({
            bloomScaleX: 1.035,
            bloomScaleY: 1.018,
            contentTravel: 9,
            yearHiddenTranslateX: -10,
            yearHiddenScale: 0.94,
        });
        expect(CALENDAR_PILL_MOTION.bloomScaleX).toBeLessThanOrEqual(1.04);
        expect(CALENDAR_PILL_MOTION.contentTravel).toBeLessThanOrEqual(10);
        expect(Object.isFrozen(CALENDAR_PILL_MOTION)).toBe(true);
    });

    test.each([
        ["month", "2026년", 138, true],
        ["month", "2026년 7월", 144, true],
        ["month", "2026년 12월", 156, true],
        ["day", "7월", 84, true],
        ["day", "10월", 102, true],
        ["year", "2026년", 0, false],
    ] as const)(
        "%s 화면의 %s pill은 폭 %s, 표시=%s로 계산한다",
        (depth, label, width, visible) => {
            expect(resolveCalendarPrimaryPillLayout(depth, label, 402)).toEqual({
                visible,
                width,
            });
        }
    );

    test("일 화면 pill은 화면이 넓어져도 남는 공간을 채우지 않는다", () => {
        for (const viewportWidth of [320, 402, 430, 1024]) {
            expect(resolveCalendarPrimaryPillLayout("day", "7월", viewportWidth).width)
                .toBe(CALENDAR_PRIMARY_PILL_LAYOUT.dayMinWidth);
        }
    });

    test("아주 좁거나 비정상적인 화면 폭에서도 안전한 폭을 반환한다", () => {
        expect(resolveCalendarPrimaryPillLayout("day", "7월", 180).width)
            .toBe(CALENDAR_PRIMARY_PILL_LAYOUT.minimumSafeWidth);
        expect(resolveCalendarPrimaryPillLayout("month", "2026년", Number.NaN).width)
            .toBe(138);
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

    test("상세형 패널은 5주·6주 달 모두 실제 월 화면의 최소 45%를 확보한다", () => {
        for (const weekCount of [5, 6]) {
            const layout = resolveDetailMonthPanelLayout({
                viewportHeight: 900,
                fixedChromeHeight: 200,
                weekCount,
                defaultDayHeight: 72,
            });

            expect(layout.calendarHeight).toBeCloseTo(495, 10);
            expect(layout.panelHeight).toBeCloseTo(405, 10);
            expect(layout.panelHeight / 900).toBeCloseTo(
                DETAIL_MONTH_PANEL_LAYOUT.minimumPanelRatio
            );
            expect(layout.dayHeight).toBeCloseTo((495 - 200) / weekCount, 10);
            expect(
                200 + layout.dayHeight * weekCount
            ).toBeCloseTo(layout.calendarHeight, 10);
        }
    });

    test("충분히 큰 화면에서는 날짜 행을 불필요하게 확대하지 않는다", () => {
        expect(resolveDetailMonthPanelLayout({
            viewportHeight: 1_400,
            fixedChromeHeight: 200,
            weekCount: 5,
            defaultDayHeight: 72,
        })).toEqual({
            calendarHeight: 560,
            dayHeight: 72,
            panelHeight: 840,
        });
    });

    test("작은 화면의 6주 달도 패널 비율을 지키며 모든 행에 같은 높이를 배분한다", () => {
        const layout = resolveDetailMonthPanelLayout({
            viewportHeight: 667,
            fixedChromeHeight: 170,
            weekCount: 6,
            defaultDayHeight: 72,
        });

        expect(layout.panelHeight).toBeCloseTo(667 * 0.45, 10);
        expect(layout.dayHeight).toBeCloseTo((667 * 0.55 - 170) / 6, 10);
        expect(170 + layout.dayHeight * 6).toBeCloseTo(
            layout.calendarHeight,
            10
        );
    });

    test("월별 주 수는 시작 요일을 반영한다", () => {
        expect(getCalendarMonthWeekCount("2026-07-22", 0)).toBe(5);
        expect(getCalendarMonthWeekCount("2026-08-01", 0)).toBe(6);
        expect(getCalendarMonthWeekCount("invalid", 0)).toBe(6);
    });

    test("상세형과 목록형만 월간 하단 패널을 연다", () => {
        expect(getMonthAgendaPanelKind("detail")).toBe("detail");
        expect(getMonthAgendaPanelKind("list")).toBe("list");
        expect(getMonthAgendaPanelKind("week")).toBe("list");
        expect(getMonthAgendaPanelKind("stack")).toBeNull();
    });

    test.each([
        ["list", false, 127, "list"],
        ["detail", true, 433, "detail"],
        ["week", true, 433, "list"],
        ["stack", true, 911, null],
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
        ["stack", "detail", "enter"],
        ["stack", "list", "enter"],
        ["list", "stack", "exit"],
        ["detail", "stack", "exit"],
        ["detail", "list", "swap"],
        ["list", "detail", "swap"],
        ["stack", "stack", "none"],
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
