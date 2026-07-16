import type { CalendarViewMode } from "./components/calendar/viewMode";
import {
    CALENDAR_TRANSITION_DURATION_MS,
} from "./calendarMotionBudget";

export {
    CALENDAR_INTERACTION_BUDGET_MS,
    CALENDAR_TRANSITION_DURATION_MS,
} from "./calendarMotionBudget";

const CALENDAR_DEPTH_BEZIER = Object.freeze([0.25, 0.1, 0.25, 1] as const);

export const CALENDAR_DEPTH_MOTION = Object.freeze({
    depthSlideDurationMs: CALENDAR_TRANSITION_DURATION_MS,
    modeChangeDurationMs: CALENDAR_TRANSITION_DURATION_MS,
    reduceMotionDurationMs: CALENDAR_TRANSITION_DURATION_MS,
    bezier: CALENDAR_DEPTH_BEZIER,
});

export type DetailMonthSwipeDirection = -1 | 1;

/**
 * 상세형 월 스와이프는 달력 셀을 한 벌만 유지한 채 midpoint에서 월을 교체한다.
 * React commit을 위한 한 프레임까지 포함해 160ms 전환 예산 안에 정착한다.
 */
export const DETAIL_MONTH_SWIPE_MOTION = Object.freeze({
    exitDurationMs: 48,
    commitFrameBudgetMs: 16,
    commitWatchdogMs: 120,
    enterDurationMs: 96,
    travel: 24,
    reduceMotionExitDurationMs: 24,
    reduceMotionEnterDurationMs: 40,
    reduceMotionTravel: 0,
    bezier: CALENDAR_DEPTH_BEZIER,
});

/** 상세형 월간 달력이 손가락을 따라가는 가로 드래그 판정값. */
export const DETAIL_MONTH_SWIPE_GESTURE = Object.freeze({
    activationDistance: 8,
    directionDominance: 1.2,
    distanceThreshold: 36,
    velocityThreshold: 0.35,
    velocityProjection: 80,
    followRatio: 0.55,
    cancelDurationMs: 80,
    maxOpacityLoss: 0.08,
});

export function shouldClaimDetailMonthSwipeGesture(
    dx: number,
    dy: number
): boolean {
    if (![dx, dy].every(Number.isFinite)) return false;

    const horizontalDistance = Math.abs(dx);
    const verticalDistance = Math.abs(dy);
    return horizontalDistance >= DETAIL_MONTH_SWIPE_GESTURE.activationDistance
        && horizontalDistance
            >= verticalDistance * DETAIL_MONTH_SWIPE_GESTURE.directionDominance;
}

export function getDetailMonthSwipeGestureDirection(
    dx: number,
    vx: number
): DetailMonthSwipeDirection | null {
    if (![dx, vx].every(Number.isFinite)) return null;

    if (Math.abs(dx) >= DETAIL_MONTH_SWIPE_GESTURE.distanceThreshold) {
        return dx > 0 ? -1 : 1;
    }

    if (Math.abs(vx) >= DETAIL_MONTH_SWIPE_GESTURE.velocityThreshold) {
        return vx > 0 ? -1 : 1;
    }

    const projectedDistance = dx
        + vx * DETAIL_MONTH_SWIPE_GESTURE.velocityProjection;
    if (Math.abs(projectedDistance)
        >= DETAIL_MONTH_SWIPE_GESTURE.distanceThreshold) {
        return projectedDistance > 0 ? -1 : 1;
    }

    return null;
}

export function getDetailMonthSwipeFollowOffset(
    dx: number,
    reduceMotion = false,
    travel: number = DETAIL_MONTH_SWIPE_MOTION.travel
): number {
    if (reduceMotion || !Number.isFinite(dx) || !Number.isFinite(travel)) {
        return 0;
    }

    const safeTravel = Math.max(0, travel);
    const followedOffset = dx * DETAIL_MONTH_SWIPE_GESTURE.followRatio;
    return Math.max(-safeTravel, Math.min(safeTravel, followedOffset));
}

export function getDetailMonthSwipeFollowOpacity(
    offset: number,
    travel: number = DETAIL_MONTH_SWIPE_MOTION.travel
): number {
    if (!Number.isFinite(offset) || !Number.isFinite(travel) || travel <= 0) {
        return 1;
    }

    const progress = Math.min(1, Math.abs(offset) / travel);
    return Math.max(
        1 - DETAIL_MONTH_SWIPE_GESTURE.maxOpacityLoss,
        1 - progress * DETAIL_MONTH_SWIPE_GESTURE.maxOpacityLoss
    );
}

/**
 * Today는 현재 월을 위로 보낸 뒤 오늘이 포함된 월을 아래에서 올린다.
 * 상태 교체를 위한 한 프레임까지 포함해 기존 160ms 상호작용 리듬을 유지한다.
 */
export const CALENDAR_TODAY_FOCUS_MOTION = Object.freeze({
    exitDurationMs: 44,
    commitFrameBudgetMs: 16,
    enterDurationMs: 100,
    outgoingTravel: 10,
    incomingTravel: 24,
    reduceMotionExitDurationMs: 24,
    reduceMotionEnterDurationMs: 40,
    reduceMotionTravel: 0,
    bezier: CALENDAR_DEPTH_BEZIER,
});

export function getDetailMonthSwipeOffsets(
    direction: DetailMonthSwipeDirection,
    travel: number = DETAIL_MONTH_SWIPE_MOTION.travel
) {
    const normalizedDirection = direction < 0 ? -1 : 1;
    const safeTravel = Number.isFinite(travel) ? Math.max(0, travel) : 0;
    if (safeTravel === 0) {
        return { outgoing: 0, incoming: 0 };
    }

    return {
        outgoing: -normalizedDirection * safeTravel,
        incoming: normalizedDirection * safeTravel,
    };
}

export const CALENDAR_PILL_MOTION = Object.freeze({
    bloomScaleX: 1.035,
    bloomScaleY: 1.018,
    contentTravel: 9,
    yearHiddenTranslateX: -10,
    yearHiddenScale: 0.94,
});

export type CalendarPrimaryPillDepth = "year" | "month" | "day";

export type CalendarPrimaryPillLayout = {
    visible: boolean;
    width: number;
};

export const CALENDAR_PRIMARY_PILL_LAYOUT = Object.freeze({
    chromeWidth: 48,
    estimatedCharacterWidth: 18,
    monthMinWidth: 132,
    dayMinWidth: 84,
    viewportReservedWidth: 172,
    minimumSafeWidth: 44,
});

/**
 * 날짜 pill의 시각 폭을 라벨 내용에 맞춰 계산한다.
 * 연 화면은 역방향 전환을 위해 컴포넌트만 유지하고 시각·입력에서는 숨긴다.
 */
export function resolveCalendarPrimaryPillLayout(
    depth: CalendarPrimaryPillDepth,
    label: string,
    viewportWidth: number
): CalendarPrimaryPillLayout {
    if (depth === "year") {
        return { visible: false, width: 0 };
    }

    const characterCount = Array.from(label.trim()).length;
    const contentWidth = Math.ceil(
        characterCount * CALENDAR_PRIMARY_PILL_LAYOUT.estimatedCharacterWidth
    ) + CALENDAR_PRIMARY_PILL_LAYOUT.chromeWidth;
    const minimumWidth = depth === "day"
        ? CALENDAR_PRIMARY_PILL_LAYOUT.dayMinWidth
        : CALENDAR_PRIMARY_PILL_LAYOUT.monthMinWidth;
    const desiredWidth = Math.max(minimumWidth, contentWidth);
    const maximumWidth = Number.isFinite(viewportWidth)
        ? Math.max(
            CALENDAR_PRIMARY_PILL_LAYOUT.minimumSafeWidth,
            viewportWidth - CALENDAR_PRIMARY_PILL_LAYOUT.viewportReservedWidth
        )
        : desiredWidth;

    return {
        visible: true,
        width: Math.min(desiredWidth, maximumWidth),
    };
}

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
