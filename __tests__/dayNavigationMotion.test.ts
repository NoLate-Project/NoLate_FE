import {
    DAY_NAVIGATION_MOTION,
    clampDayNavigationProgress,
    consumeQueuedDayNavigation,
    getDayNavigationRemainingDuration,
    getDayNavigationResetDuration,
    queueLatestDayNavigation,
} from "../src/modules/schedule/dayNavigationMotion";

describe("day navigation motion", () => {
    test("모든 일자 이동이 공유할 고정 프로필을 제공한다", () => {
        expect(DAY_NAVIGATION_MOTION).toEqual({
            durationMs: 420,
            bezier: [0.25, 0.1, 0.25, 1],
        });
        expect(Object.isFrozen(DAY_NAVIGATION_MOTION)).toBe(true);
        expect(Object.isFrozen(DAY_NAVIGATION_MOTION.bezier)).toBe(true);
    });

    test.each([
        [-1, 0],
        [0, 0],
        [0.5, 0.5],
        [1, 1],
        [2, 1],
        [Number.NEGATIVE_INFINITY, 0],
        [Number.POSITIVE_INFINITY, 1],
        [Number.NaN, 0],
    ])("진행률 %p를 %p로 제한한다", (progress, expected) => {
        expect(clampDayNavigationProgress(progress)).toBe(expected);
    });

    test.each([
        [0, 420],
        [0.25, 315],
        [0.5, 210],
        [0.82, 76],
        [1, 0],
    ])("진행률 %p 이후 남은 시간을 %pms로 비례 계산한다", (progress, expected) => {
        expect(getDayNavigationRemainingDuration(progress)).toBe(expected);
    });

    test("남은 거리가 있으면 170ms 하한 없이 최소 1ms만 보장한다", () => {
        expect(getDayNavigationRemainingDuration(0.9999)).toBe(1);
        expect(getDayNavigationRemainingDuration(1)).toBe(0);
    });

    test.each([
        [0, 400, 0],
        [100, 400, 105],
        [-200, 400, 210],
        [400, 400, 420],
        [800, 400, 420],
        [100, 0, 0],
    ])("%ppx 이동을 %ppx 화면에서 %pms 동안 원위치시킨다", (distance, width, expected) => {
        expect(getDayNavigationResetDuration(distance, width)).toBe(expected);
    });
});

describe("queued day navigation", () => {
    const activeTarget = "2026-07-13";

    test("전환 중 연속 탭에서는 마지막 요청만 유지한다", () => {
        let queuedTarget = queueLatestDayNavigation(
            activeTarget,
            null,
            "2026-07-14"
        );
        queuedTarget = queueLatestDayNavigation(
            activeTarget,
            queuedTarget,
            "2026-07-15"
        );

        expect(queuedTarget).toBe("2026-07-15");
    });

    test("대기 요청이 있어도 현재 활성 목적지를 다시 탭하면 취소한다", () => {
        const queuedTarget = queueLatestDayNavigation(
            activeTarget,
            "2026-07-14",
            activeTarget
        );

        expect(queuedTarget).toBeNull();
    });

    test("활성 전환이 없으면 요청을 큐에 남기지 않는다", () => {
        expect(queueLatestDayNavigation(null, null, "2026-07-14")).toBeNull();
    });

    test("완료 목적지와 다른 마지막 요청만 다음 전환으로 소비한다", () => {
        expect(consumeQueuedDayNavigation(activeTarget, "2026-07-15"))
            .toBe("2026-07-15");
        expect(consumeQueuedDayNavigation(activeTarget, activeTarget)).toBeNull();
        expect(consumeQueuedDayNavigation(activeTarget, null)).toBeNull();
    });
});
