import type { CalendarViewMode } from "./components/calendar/viewMode";

const CALENDAR_DEPTH_BEZIER = Object.freeze([0.25, 0.1, 0.25, 1] as const);

export const CALENDAR_DEPTH_MOTION = Object.freeze({
    depthSlideDurationMs: 320,
    modeChangeDurationMs: 220,
    reduceMotionDurationMs: 160,
    bezier: CALENDAR_DEPTH_BEZIER,
});

export const CALENDAR_PILL_MOTION = Object.freeze({
    bloomScaleX: 1.035,
    bloomScaleY: 1.018,
    contentTravel: 9,
});

export type MonthAgendaPanelKind = "detail" | "list";
export type MonthAgendaTransition = "enter" | "exit" | "swap" | "none";
export type MonthAgendaGestureTarget = "stack" | "list";
export type MonthAgendaSteppedTarget = "stack" | "detail" | "list";

export type MonthAgendaViewportLayout = {
    panelKind: MonthAgendaPanelKind | null;
    calendarVisible: boolean;
    calendarTargetHeight: number;
};

export type MonthAgendaViewportMetrics = {
    fullCalendarHeight: number;
    panelCalendarHeight: number;
    expandedListTop: number;
};

/** 월간 달력과 하단 일정 패널이 한 덩어리처럼 움직이도록 공유하는 모션 값. */
export const MONTH_AGENDA_MOTION = Object.freeze({
    durationMs: CALENDAR_DEPTH_MOTION.modeChangeDurationMs,
    reduceMotionDurationMs: CALENDAR_DEPTH_MOTION.reduceMotionDurationMs,
    panelTravel: 0,
    reduceMotionPanelTravel: 0,
    fadeInStart: 0,
    fadeInEnd: 0.12,
    bezier: CALENDAR_DEPTH_BEZIER,
});

/** 상세형 패널 손잡이의 세로 드래그 판정값. */
export const MONTH_AGENDA_GESTURE = Object.freeze({
    activationDistance: 8,
    directionDominance: 1.2,
    distanceThreshold: 36,
    velocityThreshold: 0.45,
    velocityProjection: 100,
    handleTravel: 10,
});

export function shouldClaimMonthAgendaGesture(dx: number, dy: number): boolean {
    if (![dx, dy].every(Number.isFinite)) return false;

    const horizontalDistance = Math.abs(dx);
    const verticalDistance = Math.abs(dy);
    return verticalDistance >= MONTH_AGENDA_GESTURE.activationDistance
        && verticalDistance >= horizontalDistance * MONTH_AGENDA_GESTURE.directionDominance;
}

export function getMonthAgendaGestureTarget(
    dy: number,
    vy: number
): MonthAgendaGestureTarget | null {
    if (![dy, vy].every(Number.isFinite)) return null;

    if (Math.abs(dy) >= MONTH_AGENDA_GESTURE.distanceThreshold) {
        return dy > 0 ? "stack" : "list";
    }

    if (Math.abs(vy) >= MONTH_AGENDA_GESTURE.velocityThreshold) {
        return vy > 0 ? "stack" : "list";
    }

    const projectedDistance = dy + vy * MONTH_AGENDA_GESTURE.velocityProjection;
    if (Math.abs(projectedDistance) >= MONTH_AGENDA_GESTURE.distanceThreshold) {
        return projectedDistance > 0 ? "stack" : "list";
    }

    return null;
}

/**
 * Resolves a handle drag one presentation step at a time.
 * The raw direction resolver stays shared, while the current panel decides
 * which adjacent mode exists in that direction.
 */
export function getMonthAgendaSteppedTarget(
    panelKind: MonthAgendaPanelKind,
    dy: number,
    vy: number
): MonthAgendaSteppedTarget | null {
    const directionTarget = getMonthAgendaGestureTarget(dy, vy);
    if (!directionTarget) return null;

    if (panelKind === "detail") {
        return directionTarget;
    }

    return directionTarget === "stack" ? "detail" : null;
}

export function getMonthAgendaPanelKind(
    mode: CalendarViewMode
): MonthAgendaPanelKind | null {
    if (mode === "detail") return "detail";
    if (mode === "list" || mode === "week") return "list";
    return null;
}

/**
 * Resolves the stable month viewport endpoint for each presentation mode.
 * List mode is a fully expanded sheet: the calendar is clipped at the global
 * toolbar bottom instead of retaining a shorter copy of the month grid.
 */
export function resolveMonthAgendaViewportLayout(
    mode: CalendarViewMode,
    metrics: MonthAgendaViewportMetrics
): MonthAgendaViewportLayout {
    const fullCalendarHeight = Number.isFinite(metrics.fullCalendarHeight)
        && metrics.fullCalendarHeight > 0
        ? metrics.fullCalendarHeight
        : 0;
    const panelCalendarHeight = Number.isFinite(metrics.panelCalendarHeight)
        && metrics.panelCalendarHeight > 0
        ? metrics.panelCalendarHeight
        : fullCalendarHeight;
    const expandedListTop = Number.isFinite(metrics.expandedListTop)
        && metrics.expandedListTop > 0
        ? metrics.expandedListTop
        : fullCalendarHeight;
    const panelKind = getMonthAgendaPanelKind(mode);

    if (mode === "list") {
        return {
            panelKind: "list",
            calendarVisible: false,
            calendarTargetHeight: expandedListTop,
        };
    }

    if (panelKind) {
        return {
            panelKind,
            calendarVisible: true,
            calendarTargetHeight: panelCalendarHeight,
        };
    }

    return {
        panelKind: null,
        calendarVisible: true,
        calendarTargetHeight: fullCalendarHeight,
    };
}

export function getMonthAgendaTransition(
    from: CalendarViewMode,
    to: CalendarViewMode
): MonthAgendaTransition {
    if (from === to) return "none";

    const fromPanel = getMonthAgendaPanelKind(from);
    const toPanel = getMonthAgendaPanelKind(to);

    if (!fromPanel && toPanel) return "enter";
    if (fromPanel && !toPanel) return "exit";
    if (fromPanel && toPanel) return "swap";
    return "none";
}

export const CURRENT_TIME_MOTION = Object.freeze({
    minuteStepDurationMs: 240,
    maxAnimatedGapMinutes: 1.5,
    initialLeadHours: 11.75,
    todayTargetLeadHours: 9.75,
});

export function shouldAnimateCurrentTimeStep(
    previousY: number,
    nextY: number,
    hourHeight: number,
    visible: boolean,
    reduceMotionEnabled: boolean
): boolean {
    if (reduceMotionEnabled || !visible) return false;
    if (![previousY, nextY, hourHeight].every(Number.isFinite) || hourHeight <= 0) {
        return false;
    }

    const maxAnimatedDistance = (
        CURRENT_TIME_MOTION.maxAnimatedGapMinutes / 60
    ) * hourHeight;
    const distance = Math.abs(nextY - previousY);

    return distance > 0 && distance <= maxAnimatedDistance;
}

export function formatCalendarCurrentTime(date: Date): string {
    const hour = date.getHours() % 12 || 12;
    return `${hour}:${String(date.getMinutes()).padStart(2, "0")}`;
}
