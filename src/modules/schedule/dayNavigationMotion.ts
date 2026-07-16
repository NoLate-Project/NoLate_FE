import { CALENDAR_TRANSITION_DURATION_MS } from "./calendarMotionBudget";

const DAY_NAVIGATION_BEZIER = Object.freeze([0.25, 0.1, 0.25, 1] as const);

export const DAY_NAVIGATION_MOTION = Object.freeze({
    durationMs: CALENDAR_TRANSITION_DURATION_MS,
    bezier: DAY_NAVIGATION_BEZIER,
});

export const DAY_NAVIGATION_RETARGET_MOTION = Object.freeze({
    settleDurationMs: Math.round(CALENDAR_TRANSITION_DURATION_MS * 0.25),
    followDurationMs: Math.round(CALENDAR_TRANSITION_DURATION_MS * 0.75),
});

export function clampDayNavigationProgress(progress: number): number {
    if (Number.isNaN(progress)) return 0;
    return Math.min(1, Math.max(0, progress));
}

function getScaledDayNavigationDuration(progress: number): number {
    const clampedProgress = clampDayNavigationProgress(progress);
    if (clampedProgress <= 0) return 0;

    return Math.max(1, Math.round(DAY_NAVIGATION_MOTION.durationMs * clampedProgress));
}

export function getDayNavigationRemainingDuration(progress: number): number {
    const clampedProgress = clampDayNavigationProgress(progress);
    if (clampedProgress >= 1) return 0;

    return getScaledDayNavigationDuration(1 - clampedProgress);
}

export function getDayNavigationRetargetSettleDuration(progress: number): number {
    const remainingProgress = 1 - clampDayNavigationProgress(progress);
    return Math.max(
        1,
        Math.round(DAY_NAVIGATION_RETARGET_MOTION.settleDurationMs * remainingProgress)
    );
}

export function getDayNavigationResetDuration(
    distancePx: number,
    viewportWidthPx: number
): number {
    if (!Number.isFinite(viewportWidthPx) || viewportWidthPx <= 0) return 0;

    const distanceProgress = clampDayNavigationProgress(
        Math.abs(distancePx) / viewportWidthPx
    );

    return getScaledDayNavigationDuration(distanceProgress);
}

export function queueLatestDayNavigation(
    activeTarget: string | null,
    currentQueuedTarget: string | null,
    requestedTarget: string
): string | null {
    if (activeTarget === null || requestedTarget === activeTarget) return null;
    if (requestedTarget === currentQueuedTarget) return currentQueuedTarget;

    return requestedTarget;
}

export function consumeQueuedDayNavigation(
    completedTarget: string,
    queuedTarget: string | null
): string | null {
    if (queuedTarget === null || queuedTarget === completedTarget) return null;
    return queuedTarget;
}
