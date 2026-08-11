/* eslint-disable react-hooks/exhaustive-deps -- calendarState의 ref와 setter는 안정적이며 명령 콜백은 최신 ref 값을 의도적으로 읽는다. */
import { useCallback } from "react";
import { Animated } from "react-native";
import {
    cancelAnimation as cancelReanimatedAnimation,
    Easing as ReanimatedEasing,
    runOnJS,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";
import {
    CALENDAR_INTERACTION_BUDGET_MS,
    DETAIL_MONTH_SWIPE_MOTION,
    getDetailMonthSwipeOffsets,
    getDetailMonthSwipeSettleDuration,
    type DetailMonthSwipeDirection,
} from "../../calendarMotion";
import { shiftCalendarMonth } from "../../calendarNavigation";
import {
    DETAIL_MONTH_SWIPE_EASING,
    DETAIL_MONTH_SWIPE_QUEUE_LIMIT,
    resolveDetailMonthAnchor,
    type DetailMonthAnimationOptions,
} from "./scheduleCalendarModel";
import type { ScheduleCalendarState } from "./useScheduleCalendarState";
import type { useDetailMonthCommitController } from "./useDetailMonthCommitController";
import type { useDetailMonthAnimationController } from "./useDetailMonthAnimationController";

type DetailMonthCommitController = ReturnType<
    typeof useDetailMonthCommitController
>;
type DetailMonthAnimationController = ReturnType<
    typeof useDetailMonthAnimationController
>;

type UseDetailMonthChangeAnimationParams = {
    calendarState: ScheduleCalendarState;
    commitController: DetailMonthCommitController;
    animationController: DetailMonthAnimationController;
    animatedCalendarHeight?: SharedValue<number>;
    animatedDayHeight?: SharedValue<number>;
    detailMonthMotionActive?: SharedValue<boolean>;
};

/**
 * 상세 월 이동 명령을 가로·세로 애니메이션과 제어형 날짜 커밋으로 변환한다.
 * 연속 입력은 제한된 큐에 보관하고 현재 전환이 끝난 뒤 실행해 빠른 스와이프에서도
 * 월 순서와 페이저 슬롯이 뒤바뀌지 않도록 한다.
 */
export function useDetailMonthChangeAnimation({
    calendarState,
    commitController,
    animationController,
    animatedCalendarHeight,
    animatedDayHeight,
    detailMonthMotionActive,
}: UseDetailMonthChangeAnimationParams) {
    const {
        setDetailMonthPagerAnchorDay,
        setDetailMonthPagerHandoffDay,
        detailMonthPageWidth,
        detailMonthViewportHeight,
        detailMonthGesturePageHeight,
        detailMonthGesturePreviousPageHeight,
        detailMonthTranslateX,
        detailMonthTranslateY,
        detailMonthOpacity,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthGestureBaseTranslateX,
        detailMonthGestureBaseTranslateY,
        detailMonthGestureOpacity,
        detailMonthGestureAxis,
        detailMonthGestureBlocked,
        detailMonthGestureAdoptionReady,
        detailMonthGestureAdoptedPresentation,
        detailMonthGestureSettleGeneration,
        detailMonthGestureActiveSettleDirection,
        detailMonthGestureActiveSettleAxis,
        detailMonthGestureActiveSettleTargetOffset,
        detailMonthAnimationRef,
        detailMonthCommitWatchdogRef,
        detailMonthDeadlineWatchdogRef,
        detailMonthAnimationActiveRef,
        detailMonthAnimationPhaseRef,
        detailMonthAnimationGenerationRef,
        detailMonthAnimationSourceDayRef,
        detailMonthAnimationExpectedDayRef,
        detailMonthPreviewedDayRef,
        detailMonthAnimationPendingCommandsRef,
        detailMonthAnimationEnterDurationRef,
        detailMonthAnimationStartedAtRef,
        detailMonthAnimationReduceMotionRef,
        detailMonthAnimationUsesPagerRef,
        detailMonthAnimationUsesGestureLayerRef,
        detailMonthAnimationAxisRef,
        detailMonthGestureResetAnimationRef,
        detailMonthLatestSelectedDayRef,
        detailMonthLatestVisibleMonthRef,
        detailMonthLatestViewModeRef,
        detailMonthLatestReduceMotionRef,
        detailMonthLatestTransitionActiveRef,
        startDetailMonthAnimationRef,
        detailMonthPageLayoutsRef,
    } = calendarState;
    const {
        setDetailMonthMotionOwnershipActive,
        emitDetailMonthPreview,
        commitDetailMonthControlledState,
    } = commitController;
    const {
        invalidateDetailMonthAnimation,
        resetDetailMonthGesture,
        completeDetailMonthAnimation,
        commitDetailMonthPagerSwipe,
        scheduleDetailMonthPagerCommit,
    } = animationController;
    /** 이동 방향과 축을 해석해 소스/목표 월을 준비하고 종료·정착·커밋 단계를 한 세대로 실행한다. */
    const animateDetailMonthChange = useCallback((
        direction: DetailMonthSwipeDirection,
        options: DetailMonthAnimationOptions = {}
    ) => {
        if (
            detailMonthLatestViewModeRef.current !== "detail" ||
            detailMonthLatestTransitionActiveRef.current
        ) {
            resetDetailMonthGesture();
            return;
        }
        const normalizedDirection: DetailMonthSwipeDirection = direction < 0 ? -1 : 1;
        if (detailMonthAnimationActiveRef.current) {
            const pendingCommands =
                detailMonthAnimationPendingCommandsRef.current;
            if (pendingCommands.length < DETAIL_MONTH_SWIPE_QUEUE_LIMIT) {
                pendingCommands.push({
                    direction: normalizedDirection,
                    axis: options.gestureAxis ?? "horizontal",
                });
            }
            return;
        }

        const sourceDay = resolveDetailMonthAnchor(
            detailMonthLatestSelectedDayRef.current,
            detailMonthLatestVisibleMonthRef.current
        );
        const targetDay = options.targetDay
            ?? shiftCalendarMonth(sourceDay, normalizedDirection);
        const reduceMotion = detailMonthLatestReduceMotionRef.current;
        const generation = detailMonthAnimationGenerationRef.current + 1;
        detailMonthGestureResetAnimationRef.current?.stop();
        detailMonthGestureResetAnimationRef.current = null;
        detailMonthAnimationGenerationRef.current = generation;
        detailMonthAnimationActiveRef.current = true;
        if (detailMonthMotionActive) {
            detailMonthMotionActive.value = true;
        }
        setDetailMonthMotionOwnershipActive(true);
        detailMonthAnimationUsesPagerRef.current = false;
        detailMonthAnimationUsesGestureLayerRef.current = false;
        const gestureAxis = options.gestureAxis ?? "horizontal";
        detailMonthAnimationAxisRef.current = gestureAxis;
        detailMonthGestureAxis.value = gestureAxis === "horizontal" ? 1 : 2;
        detailMonthGestureSettleGeneration.value += 1;
        detailMonthGestureActiveSettleDirection.value = 0;
        detailMonthGestureActiveSettleAxis.value = 0;
        detailMonthGestureActiveSettleTargetOffset.value = 0;
        detailMonthGestureBaseTranslateX.value = 0;
        detailMonthGestureBaseTranslateY.value = 0;
        detailMonthGestureAdoptedPresentation.value = false;
        detailMonthAnimationPhaseRef.current = "exit";
        detailMonthAnimationSourceDayRef.current = sourceDay;
        detailMonthAnimationExpectedDayRef.current = null;
        detailMonthAnimationReduceMotionRef.current = reduceMotion;
        detailMonthAnimationStartedAtRef.current = Date.now();
        detailMonthGestureAdoptionReady.value = false;
        detailMonthGestureBlocked.value = true;
        const isGestureTransition = options.gestureOffset !== undefined;
        const travel = reduceMotion
            ? DETAIL_MONTH_SWIPE_MOTION.reduceMotionTravel
            : DETAIL_MONTH_SWIPE_MOTION.travel;
        const measuredVerticalPageDistance = Math.max(
            1,
            isGestureTransition
                ? detailMonthGesturePageHeight.value
                : detailMonthViewportHeight.value
        );
        const currentLayout = detailMonthPageLayoutsRef.current?.current;
        const previousLayout = detailMonthPageLayoutsRef.current?.previous;
        const measuredPreviousVerticalPageDistance = isGestureTransition
            ? detailMonthGesturePreviousPageHeight.value
            : Math.max(
                1,
                measuredVerticalPageDistance
                    + (
                        (previousLayout?.calendarHeight
                            ?? currentLayout?.calendarHeight
                            ?? measuredVerticalPageDistance)
                        - (
                            currentLayout?.calendarHeight
                            ?? measuredVerticalPageDistance
                        )
                    )
            );
        if (gestureAxis === "vertical" && !isGestureTransition) {
            detailMonthGesturePageHeight.value = measuredVerticalPageDistance;
            detailMonthGesturePreviousPageHeight.value =
                measuredPreviousVerticalPageDistance;
        }
        const pagerDistance = gestureAxis === "horizontal"
            ? detailMonthPageWidth
            : normalizedDirection < 0
                ? measuredPreviousVerticalPageDistance
                : measuredVerticalPageDistance;
        // Both axes use pre-rendered adjacent months and their measured page
        // dimensions. The vertical distance is frozen when the gesture starts,
        // so a concurrent 5/6-week height interpolation cannot move the target.
        const isPagerTransition = pagerDistance > 0;
        let exitDuration = reduceMotion
            ? DETAIL_MONTH_SWIPE_MOTION.reduceMotionExitDurationMs
            : DETAIL_MONTH_SWIPE_MOTION.exitDurationMs;
        detailMonthAnimationEnterDurationRef.current = reduceMotion
            ? DETAIL_MONTH_SWIPE_MOTION.reduceMotionEnterDurationMs
            : DETAIL_MONTH_SWIPE_MOTION.enterDurationMs;
        const offsets = getDetailMonthSwipeOffsets(normalizedDirection, travel);

        if (isPagerTransition && !reduceMotion) {
            detailMonthAnimationUsesPagerRef.current = true;
            // The adjacent page already moves on the UI thread. Update the
            // lightweight month chrome before the controlled selection/store
            // commit starts its heavier Fabric reconciliation.
            detailMonthPreviewedDayRef.current = targetDay;
            emitDetailMonthPreview(targetDay);
            detailMonthDeadlineWatchdogRef.current = setTimeout(() => {
                detailMonthDeadlineWatchdogRef.current = null;
                if (generation !== detailMonthAnimationGenerationRef.current) return;
                let expectedDay =
                    detailMonthAnimationExpectedDayRef.current;
                let recoveryPhase =
                    detailMonthAnimationPhaseRef.current;
                if (
                    detailMonthAnimationUsesPagerRef.current
                    && recoveryPhase === "exit"
                    && expectedDay === null
                ) {
                    // The native pager has had enough time to reach its
                    // endpoint, but its completion callback may have been
                    // delayed or lost. Promote through the ordinary commit
                    // path; a stale completion callback will fail its phase
                    // guard and cannot emit the target twice.
                    commitDetailMonthPagerSwipe(generation, targetDay);
                    expectedDay =
                        detailMonthAnimationExpectedDayRef.current;
                    recoveryPhase =
                        detailMonthAnimationPhaseRef.current;
                }
                if (
                    detailMonthAnimationUsesPagerRef.current
                    && expectedDay === targetDay
                    && (
                        recoveryPhase === "settling"
                        || recoveryPhase === "awaitingCommit"
                        || recoveryPhase === "finalizing"
                    )
                ) {
                    // Recover through the same target-only topology as the
                    // normal handoff. Completing immediately would reset the
                    // shared translation while the structural anchor could
                    // still be the source month, recreating the source flash.
                    // Preserve already-guarded handoff/rebase frames. React
                    // can coalesce the idempotent target updates below; if the
                    // pending frame were cancelled there might be no render
                    // left to schedule a replacement, leaving input locked
                    // until the terminal watchdog.
                    detailMonthAnimationPhaseRef.current =
                        recoveryPhase === "finalizing"
                            ? "finalizing"
                            : "awaitingCommit";
                    setDetailMonthPagerAnchorDay(targetDay);
                    setDetailMonthPagerHandoffDay(
                        recoveryPhase === "finalizing"
                            ? null
                            : targetDay
                    );

                    // A longer bounded watchdog only handles a parent that
                    // never acknowledges the target. The short watchdog above
                    // has already requested target-only topology, so a delayed
                    // but valid controlled commit remains visually pinned.
                    detailMonthDeadlineWatchdogRef.current = setTimeout(() => {
                        detailMonthDeadlineWatchdogRef.current = null;
                        if (
                            generation
                                !== detailMonthAnimationGenerationRef.current
                            || (
                                detailMonthAnimationPhaseRef.current
                                    !== "awaitingCommit"
                                && detailMonthAnimationPhaseRef.current
                                    !== "finalizing"
                            )
                            || detailMonthAnimationExpectedDayRef.current
                                !== targetDay
                            || !detailMonthAnimationUsesPagerRef.current
                        ) return;
                        const terminalControlledAnchor =
                            resolveDetailMonthAnchor(
                                detailMonthLatestSelectedDayRef.current,
                                detailMonthLatestVisibleMonthRef.current
                            );
                        if (terminalControlledAnchor === targetDay) {
                            completeDetailMonthAnimation(generation, true);
                            return;
                        }
                        invalidateDetailMonthAnimation(true);
                    }, DETAIL_MONTH_SWIPE_MOTION.pagerAckWatchdogMs);
                    return;
                }
                invalidateDetailMonthAnimation(true);
            }, (
                options.gestureSettleOwnedByUI
                    ? DETAIL_MONTH_SWIPE_MOTION.maxGestureSettleDurationMs
                    : CALENDAR_INTERACTION_BUDGET_MS
            )
                + DETAIL_MONTH_SWIPE_MOTION.commitFrameBudgetMs
                + DETAIL_MONTH_SWIPE_MOTION.commitWatchdogMs);
            if (options.gestureSettleOwnedByUI) {
                // The release worklet already owns the active withTiming.
                // runOnJS arrives asynchronously on device, so touching the
                // shared translations here would cancel that freshly-started
                // settle and visibly snap the source grid back into view.
                detailMonthAnimationPhaseRef.current = "settling";
                detailMonthAnimationExpectedDayRef.current = targetDay;
                // A committed release is authoritative. Emit the controlled
                // month now so the pill, selected day and agenda update while
                // the UI-thread pager is settling instead of hundreds of
                // milliseconds after the target grid has arrived.
                commitDetailMonthControlledState(targetDay);
                return;
            }
            cancelReanimatedAnimation(detailMonthGestureTranslateX);
            cancelReanimatedAnimation(detailMonthGestureTranslateY);
            cancelReanimatedAnimation(detailMonthGestureOpacity);
            detailMonthGestureOpacity.value = 1;
            if (!isGestureTransition) {
                const activeGestureTranslation =
                    gestureAxis === "horizontal"
                        ? detailMonthGestureTranslateX
                        : detailMonthGestureTranslateY;
                const inactiveGestureTranslation =
                    gestureAxis === "horizontal"
                        ? detailMonthGestureTranslateY
                        : detailMonthGestureTranslateX;
                const targetLayout = normalizedDirection < 0
                    ? detailMonthPageLayoutsRef.current?.previous
                    : detailMonthPageLayoutsRef.current?.next;
                detailMonthTranslateX.setValue(0);
                detailMonthTranslateY.setValue(0);
                detailMonthOpacity.setValue(1);
                inactiveGestureTranslation.value = 0;
                activeGestureTranslation.value = 0;
                if (targetLayout && animatedCalendarHeight) {
                    cancelReanimatedAnimation(animatedCalendarHeight);
                    animatedCalendarHeight.value = withTiming(
                        targetLayout.calendarHeight,
                        {
                            duration: CALENDAR_INTERACTION_BUDGET_MS,
                            easing: ReanimatedEasing.bezier(
                                ...DETAIL_MONTH_SWIPE_MOTION.bezier
                            ),
                        }
                    );
                }
                if (targetLayout && animatedDayHeight) {
                    cancelReanimatedAnimation(animatedDayHeight);
                    animatedDayHeight.value = withTiming(
                        targetLayout.dayHeight,
                        {
                            duration: CALENDAR_INTERACTION_BUDGET_MS,
                            easing: ReanimatedEasing.bezier(
                                ...DETAIL_MONTH_SWIPE_MOTION.bezier
                            ),
                        }
                    );
                }
                activeGestureTranslation.value = withTiming(
                    -normalizedDirection * pagerDistance,
                    {
                        duration: CALENDAR_INTERACTION_BUDGET_MS,
                        easing: ReanimatedEasing.bezier(
                            ...DETAIL_MONTH_SWIPE_MOTION.bezier
                        ),
                    },
                    (finished) => {
                        if (finished) {
                            runOnJS(scheduleDetailMonthPagerCommit)(
                                generation,
                                targetDay
                            );
                        }
                    }
                );
                return;
            }
            const activeGestureTranslation = gestureAxis === "horizontal"
                ? detailMonthGestureTranslateX
                : detailMonthGestureTranslateY;
            const inactiveGestureTranslation = gestureAxis === "horizontal"
                ? detailMonthGestureTranslateY
                : detailMonthGestureTranslateX;
            inactiveGestureTranslation.value = 0;
            const targetOffset = -normalizedDirection * pagerDistance;
            if (options.gestureAlreadySettled) {
                // The successful pan already completed this motion on the UI
                // thread. Keep the incoming page at its final position while JS
                // commits the controlled month; restarting withTiming here would
                // reintroduce a release-time JS stall.
                activeGestureTranslation.value = targetOffset;
                const targetLayout = normalizedDirection < 0
                    ? detailMonthPageLayoutsRef.current?.previous
                    : detailMonthPageLayoutsRef.current?.next;
                if (targetLayout && animatedCalendarHeight) {
                    cancelReanimatedAnimation(animatedCalendarHeight);
                    animatedCalendarHeight.value = targetLayout.calendarHeight;
                }
                if (targetLayout && animatedDayHeight) {
                    cancelReanimatedAnimation(animatedDayHeight);
                    animatedDayHeight.value = targetLayout.dayHeight;
                }
                commitDetailMonthPagerSwipe(generation, targetDay);
                return;
            }
            const gestureOffset = options.gestureOffset ?? 0;
            const targetDirection = Math.sign(targetOffset - gestureOffset);
            const velocityTowardTarget = Math.max(
                0,
                (options.gestureVelocity ?? 0) * targetDirection
            );
            const settleDurationMs = getDetailMonthSwipeSettleDuration(
                Math.abs(targetOffset - gestureOffset),
                velocityTowardTarget,
                pagerDistance
            );
            const targetLayout = normalizedDirection < 0
                ? detailMonthPageLayoutsRef.current?.previous
                : detailMonthPageLayoutsRef.current?.next;
            if (targetLayout && animatedCalendarHeight) {
                cancelReanimatedAnimation(animatedCalendarHeight);
                animatedCalendarHeight.value = withTiming(
                    targetLayout.calendarHeight,
                    {
                        duration: settleDurationMs,
                        easing: ReanimatedEasing.bezier(
                            ...DETAIL_MONTH_SWIPE_MOTION.settleBezier
                        ),
                    }
                );
            }
            if (targetLayout && animatedDayHeight) {
                cancelReanimatedAnimation(animatedDayHeight);
                animatedDayHeight.value = withTiming(
                    targetLayout.dayHeight,
                    {
                        duration: settleDurationMs,
                        easing: ReanimatedEasing.bezier(
                            ...DETAIL_MONTH_SWIPE_MOTION.settleBezier
                        ),
                    }
                );
            }
            activeGestureTranslation.value = withTiming(
                targetOffset,
                {
                    duration: settleDurationMs,
                    easing: ReanimatedEasing.bezier(
                        ...DETAIL_MONTH_SWIPE_MOTION.settleBezier
                    ),
                },
                (finished) => {
                    if (finished) {
                        runOnJS(commitDetailMonthPagerSwipe)(generation, targetDay);
                    }
                }
            );
            return;
        }

        const detailMonthActiveTranslation = gestureAxis === "vertical"
            ? detailMonthTranslateY
            : detailMonthTranslateX;
        const detailMonthInactiveTranslation = gestureAxis === "vertical"
            ? detailMonthTranslateX
            : detailMonthTranslateY;
        const gestureOffset = options.gestureOffset ?? 0;
        const gestureFollowProgress = (
            gestureAxis === "vertical"
            && isGestureTransition
            && travel > 0
        )
            ? Math.min(1, Math.abs(gestureOffset) / travel)
            : 0;
        const gestureFollowOpacity = 1
            - gestureFollowProgress
                * (1 - DETAIL_MONTH_SWIPE_MOTION.buttonOpacityFloor);
        if (isGestureTransition && !reduceMotion) {
            const exitRemainingDistance = Math.abs(
                offsets.outgoing - gestureOffset
            );
            const enterDistance = Math.abs(offsets.incoming);
            const totalRemainingDistance =
                exitRemainingDistance + enterDistance;
            const totalReferenceDistance =
                Math.abs(offsets.outgoing) + enterDistance;
            const exitDirection = Math.sign(
                offsets.outgoing - gestureOffset
            ) || Math.sign(offsets.outgoing);
            const velocityTowardTarget = Math.max(
                0,
                (options.gestureVelocity ?? 0) * exitDirection
            );
            const totalSettleDurationMs = getDetailMonthSwipeSettleDuration(
                totalRemainingDistance,
                velocityTowardTarget,
                totalReferenceDistance
            );
            const exitShare = totalRemainingDistance > 0
                ? exitRemainingDistance / totalRemainingDistance
                : 0;
            exitDuration = totalSettleDurationMs * exitShare;
            detailMonthAnimationEnterDurationRef.current =
                totalSettleDurationMs - exitDuration;
        }
        detailMonthActiveTranslation.setValue(gestureOffset);
        detailMonthInactiveTranslation.setValue(0);
        detailMonthOpacity.setValue(gestureFollowOpacity);
        cancelReanimatedAnimation(detailMonthGestureTranslateX);
        cancelReanimatedAnimation(detailMonthGestureTranslateY);
        cancelReanimatedAnimation(detailMonthGestureOpacity);
        detailMonthGestureTranslateX.value = 0;
        detailMonthGestureTranslateY.value = 0;
        detailMonthGestureOpacity.value = 1;
        detailMonthDeadlineWatchdogRef.current = setTimeout(() => {
            detailMonthDeadlineWatchdogRef.current = null;
            if (generation !== detailMonthAnimationGenerationRef.current) return;
            invalidateDetailMonthAnimation(true);
        }, DETAIL_MONTH_SWIPE_MOTION.maxGestureSettleDurationMs
            + DETAIL_MONTH_SWIPE_MOTION.commitFrameBudgetMs
            + DETAIL_MONTH_SWIPE_MOTION.commitWatchdogMs);
        const exitAnimation = Animated.parallel([
            Animated.timing(detailMonthActiveTranslation, {
                toValue: offsets.outgoing,
                duration: exitDuration,
                easing: DETAIL_MONTH_SWIPE_EASING,
                useNativeDriver: true,
                isInteraction: false,
            }),
            Animated.timing(detailMonthOpacity, {
                toValue: DETAIL_MONTH_SWIPE_MOTION.buttonOpacityFloor,
                duration: exitDuration,
                easing: DETAIL_MONTH_SWIPE_EASING,
                useNativeDriver: true,
                isInteraction: false,
            }),
        ]);
        detailMonthAnimationRef.current = exitAnimation;
        exitAnimation.start(({ finished }) => {
            if (detailMonthAnimationRef.current === exitAnimation) {
                detailMonthAnimationRef.current = null;
            }
            if (generation !== detailMonthAnimationGenerationRef.current) return;
            if (!finished) {
                invalidateDetailMonthAnimation(true);
                return;
            }

            const currentAnchor = resolveDetailMonthAnchor(
                detailMonthLatestSelectedDayRef.current,
                detailMonthLatestVisibleMonthRef.current
            );
            if (
                detailMonthLatestViewModeRef.current !== "detail" ||
                detailMonthLatestReduceMotionRef.current !== reduceMotion ||
                currentAnchor !== sourceDay
            ) {
                invalidateDetailMonthAnimation(true);
                return;
            }

            detailMonthAnimationPhaseRef.current = "awaitingCommit";
            detailMonthAnimationExpectedDayRef.current = targetDay;
            detailMonthActiveTranslation.setValue(offsets.incoming);
            detailMonthOpacity.setValue(
                DETAIL_MONTH_SWIPE_MOTION.buttonOpacityFloor
            );
            detailMonthCommitWatchdogRef.current = setTimeout(() => {
                detailMonthCommitWatchdogRef.current = null;
                if (
                    generation !== detailMonthAnimationGenerationRef.current ||
                    detailMonthAnimationPhaseRef.current !== "awaitingCommit"
                ) return;
                invalidateDetailMonthAnimation(true);
            }, DETAIL_MONTH_SWIPE_MOTION.commitWatchdogMs);
            commitDetailMonthControlledState(targetDay);
        });
    }, [
        detailMonthOpacity,
        detailMonthGestureActiveSettleAxis,
        detailMonthGestureActiveSettleDirection,
        detailMonthGestureActiveSettleTargetOffset,
        detailMonthGestureAdoptionReady,
        detailMonthGestureAdoptedPresentation,
        detailMonthGestureOpacity,
        detailMonthGestureAxis,
        detailMonthGestureBaseTranslateX,
        detailMonthGestureBaseTranslateY,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthTranslateX,
        detailMonthTranslateY,
        detailMonthGestureBlocked,
        detailMonthGesturePageHeight,
        detailMonthGesturePreviousPageHeight,
        detailMonthGestureSettleGeneration,
        detailMonthViewportHeight,
        detailMonthMotionActive,
        detailMonthPageWidth,
        animatedCalendarHeight,
        animatedDayHeight,
        commitDetailMonthControlledState,
        completeDetailMonthAnimation,
        commitDetailMonthPagerSwipe,
        emitDetailMonthPreview,
        invalidateDetailMonthAnimation,
        resetDetailMonthGesture,
        scheduleDetailMonthPagerCommit,
        setDetailMonthMotionOwnershipActive,
    ]);

    startDetailMonthAnimationRef.current = animateDetailMonthChange;

    return { animateDetailMonthChange };
}
