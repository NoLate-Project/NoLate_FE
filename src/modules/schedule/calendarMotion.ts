import type { CalendarViewMode } from "./components/calendar/viewMode";
import {
    CALENDAR_TRANSITION_DURATION_MS,
} from "./calendarMotionBudget";

export {
    CALENDAR_INTERACTION_BUDGET_MS,
    CALENDAR_TRANSITION_DURATION_MS,
} from "./calendarMotionBudget";

const CALENDAR_DEPTH_BEZIER = Object.freeze([0.25, 0.1, 0.25, 1] as const);
const DETAIL_MONTH_SWIPE_SETTLE_BEZIER = Object.freeze(
    [0, 0, 0.58, 1] as const
);
const DETAIL_MONTH_HEIGHT_BEZIER = Object.freeze([0.2, 0, 0, 1] as const);
const DETAIL_MONTH_COMMIT_FRAME_BUDGET_MS = 16;

export const CALENDAR_DEPTH_MOTION = Object.freeze({
    depthSlideDurationMs: CALENDAR_TRANSITION_DURATION_MS,
    modeChangeDurationMs: CALENDAR_TRANSITION_DURATION_MS,
    reduceMotionDurationMs: CALENDAR_TRANSITION_DURATION_MS,
    bezier: CALENDAR_DEPTH_BEZIER,
});

export type DetailMonthSwipeDirection = -1 | 1;

/**
 * 상세형 월 제스처는 남은 거리·릴리스 속도에 따라 마무리한다. 최소 시간은
 * 두지 않는다. Apple Calendar에서 관측한 320~417ms는 손가락을 끄는 시간까지
 * 포함하므로 release settle에는 그보다 짧은 220ms 상한을 적용한다. 두 축 모두
 * 미리 렌더한 pager와 실제 측정한 viewport를 사용한다.
 */
export const DETAIL_MONTH_SWIPE_MOTION = Object.freeze({
    exitDurationMs: 48,
    commitFrameBudgetMs: DETAIL_MONTH_COMMIT_FRAME_BUDGET_MS,
    commitWatchdogMs: 120,
    // Legacy controlled/button-transition recovery ceiling. Continuous
    // gestures do not wait for this acknowledgement.
    pagerAckWatchdogMs: 1_200,
    enterDurationMs: 96,
    maxGestureSettleDurationMs: 220,
    // Keep controlled React/store updates out of a rapid swipe burst. The
    // native pager and month pill already show the target immediately; the
    // authoritative state is coalesced once the user's hand is briefly idle.
    continuousCommitIdleMs: 600,
    // A committed vertical gesture must still have visible travel after the
    // 36pt threshold. The previous 24pt distance completed the crossfade before
    // release, so the month appeared to dissolve instead of paging.
    // Layout measurement is authoritative; this value is the pre-layout fallback.
    travel: 320,
    // Button-driven month changes swap the controlled Calendar at the motion
    // midpoint. Keeping a visible floor prevents a delayed ACK (or a queued
    // second press) from ever leaving the whole month grid fully transparent.
    buttonOpacityFloor: 0.72,
    reduceMotionExitDurationMs: 24,
    reduceMotionEnterDurationMs: 40,
    reduceMotionTravel: 0,
    bezier: CALENDAR_DEPTH_BEZIER,
    // Direct drag remains 1:1. This moderate ease-out is only for the
    // release-to-page-end settle and mirrors Apple Calendar's measured
    // deceleration without the abrupt braking of stronger cubic ease-outs.
    settleBezier: DETAIL_MONTH_SWIPE_SETTLE_BEZIER,
});

/**
 * 5주↔6주 월 전환의 외곽 높이와 날짜 셀 높이를 함께 보간한다.
 * 스와이프 settle과 분리해 빠른 flick에도 레이아웃 경계가 갑자기 점프하지 않는다.
 */
export const DETAIL_MONTH_HEIGHT_MOTION = Object.freeze({
    durationMs: 220,
    reduceMotionDurationMs: 80,
    bezier: DETAIL_MONTH_HEIGHT_BEZIER,
});

/** 상세형 월간 달력이 손가락을 따라가는 가로 드래그 판정값. */
export const DETAIL_MONTH_SWIPE_GESTURE = Object.freeze({
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
    travel: number = DETAIL_MONTH_SWIPE_GESTURE.maxFollowTravel
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
 * 릴리스 뒤 남은 거리와 목표 방향 속도로 settle 시간을 계산한다.
 * 최소 시간은 두지 않고, 느린 제스처만 최대 시간 안에 끝나도록 기준
 * 속도를 보정한다. velocity는 px/ms 단위의 목표 방향 속도다.
 */
export function getDetailMonthSwipeSettleDuration(
    remainingDistance: number,
    velocityTowardTarget: number,
    referenceDistance: number,
    maxDurationMs: number = DETAIL_MONTH_SWIPE_MOTION.maxGestureSettleDurationMs
): number {
    if (
        ![
            remainingDistance,
            velocityTowardTarget,
            referenceDistance,
            maxDurationMs,
        ].every(Number.isFinite)
        || referenceDistance <= 0
        || maxDurationMs <= 0
    ) {
        return 0;
    }

    const safeRemainingDistance = Math.min(
        referenceDistance,
        Math.max(0, remainingDistance)
    );
    if (safeRemainingDistance === 0) return 0;

    const baselineVelocity = referenceDistance / maxDurationMs;
    const effectiveVelocity = Math.max(
        baselineVelocity,
        Math.max(0, velocityTowardTarget)
    );
    return Math.min(
        maxDurationMs,
        safeRemainingDistance / effectiveVelocity
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
    combinedMonthEstimatedCharacterWidth: 12,
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

    const trimmedLabel = label.trim();
    const characterCount = Array.from(trimmedLabel).length;
    const estimatedCharacterWidth =
        depth === "month" && /년\s+\d{1,2}월$/.test(trimmedLabel)
            ? CALENDAR_PRIMARY_PILL_LAYOUT.combinedMonthEstimatedCharacterWidth
            : CALENDAR_PRIMARY_PILL_LAYOUT.estimatedCharacterWidth;
    const contentWidth = Math.ceil(
        characterCount * estimatedCharacterWidth
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

export type DetailMonthPanelLayout = {
    calendarHeight: number;
    dayHeight: number;
    panelHeight: number;
};

export type DetailMonthPanelMetrics = {
    viewportHeight: number;
    fixedChromeHeight: number;
    weekCount: number;
    defaultDayHeight: number;
};

/** 상세형은 빈 일정에서도 선택일 패널이 실제 월 화면의 45%를 차지한다. */
export const DETAIL_MONTH_PANEL_LAYOUT = Object.freeze({
    minimumPanelRatio: 0.45,
    maximumCalendarRatio: 0.55,
});

/**
 * 월별 주 수에 맞춰 남은 달력 공간을 날짜 행에 균등 배분한다.
 * calendarHeight와 panelHeight의 합은 항상 실제 월 화면 높이와 같다.
 */
export function resolveDetailMonthPanelLayout(
    metrics: DetailMonthPanelMetrics
): DetailMonthPanelLayout {
    const viewportHeight = Number.isFinite(metrics.viewportHeight)
        ? Math.max(0, metrics.viewportHeight)
        : 0;
    const fixedChromeHeight = Number.isFinite(metrics.fixedChromeHeight)
        ? Math.max(0, metrics.fixedChromeHeight)
        : 0;
    const weekCount = Number.isFinite(metrics.weekCount)
        ? Math.max(1, Math.round(metrics.weekCount))
        : 6;
    const defaultDayHeight = Number.isFinite(metrics.defaultDayHeight)
        ? Math.max(0, metrics.defaultDayHeight)
        : 0;

    if (viewportHeight === 0) {
        return { calendarHeight: 0, dayHeight: 0, panelHeight: 0 };
    }

    const maximumCalendarHeight = viewportHeight * Math.min(
        DETAIL_MONTH_PANEL_LAYOUT.maximumCalendarRatio,
        1 - DETAIL_MONTH_PANEL_LAYOUT.minimumPanelRatio
    );
    const naturalCalendarHeight = fixedChromeHeight + weekCount * defaultDayHeight;
    const calendarHeight = Math.min(maximumCalendarHeight, naturalCalendarHeight);
    const panelHeight = viewportHeight - calendarHeight;
    const dayHeight = Math.max(
        0,
        (calendarHeight - fixedChromeHeight) / weekCount
    );

    return { calendarHeight, dayHeight, panelHeight };
}

export function getCalendarMonthWeekCount(
    month: string,
    firstDay: 0 | 1
): number {
    const [yearText, monthText] = month.slice(0, 7).split("-");
    const year = Number(yearText);
    const monthNumber = Number(monthText);
    if (!Number.isFinite(year) || !Number.isFinite(monthNumber)) return 6;

    const monthIndex = monthNumber - 1;
    const leadingBlankCount = (
        new Date(year, monthIndex, 1).getDay() - firstDay + 7
    ) % 7;
    const dayCount = new Date(year, monthIndex + 1, 0).getDate();
    return Math.ceil((leadingBlankCount + dayCount) / 7);
}

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
