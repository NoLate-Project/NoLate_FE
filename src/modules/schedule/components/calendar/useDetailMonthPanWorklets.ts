import {
    cancelAnimation as cancelReanimatedAnimation,
    runOnJS,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";
import {
    DETAIL_MONTH_SWIPE_GESTURE,
    DETAIL_MONTH_SWIPE_MOTION,
} from "../../calendarMotion";
import { CALENDAR_DAY_HEIGHTS } from "./viewMode";
import {
    DETAIL_MONTH_SWIPE_REANIMATED_EASING,
    DETAIL_MONTH_SWIPE_SETTLE_REANIMATED_EASING,
    shiftCalendarDaySelectionKeyOnUI,
} from "./scheduleCalendarModel";
import type { ScheduleCalendarState } from "./useScheduleCalendarState";
import type { useDetailMonthCommitController } from "./useDetailMonthCommitController";
import type { useDetailMonthGestureSettling } from "./useDetailMonthGestureSettling";

type DetailMonthCommitController = ReturnType<
    typeof useDetailMonthCommitController
>;
type DetailMonthGestureSettling = ReturnType<
    typeof useDetailMonthGestureSettling
>;

type UseDetailMonthPanWorkletsParams = {
    calendarState: ScheduleCalendarState;
    commitController: DetailMonthCommitController;
    gestureSettling: DetailMonthGestureSettling;
    detailMonthPageWidth: number;
    headerOffset: number;
    reduceMotionEnabled: boolean;
    animatedCalendarHeight?: SharedValue<number>;
    animatedDayHeight?: SharedValue<number>;
    detailMonthMotionActive?: SharedValue<boolean>;
};

/**
 * 상세 월 팬 제스처가 UI 스레드에서 사용할 방향 판정·이동·정착 worklet을 만든다.
 * 모든 SharedValue와 JS 커밋 경계를 한 묶음으로 고정해 제스처 빌더는 이벤트 순서만
 * 선언하고 월 이동 계산은 이 모듈에 위임한다.
 */
export function useDetailMonthPanWorklets({
    calendarState,
    commitController,
    gestureSettling,
    detailMonthPageWidth,
    headerOffset,
    reduceMotionEnabled,
    animatedCalendarHeight,
    animatedDayHeight,
    detailMonthMotionActive,
}: UseDetailMonthPanWorkletsParams) {
    const {
        detailMonthViewportHeight,
        detailMonthGesturePageHeight,
        detailMonthGesturePreviousPageHeight,
        detailMonthGestureSourceCalendarHeight,
        detailMonthGestureSourceDayHeight,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthGestureBaseTranslateX,
        detailMonthGestureBaseTranslateY,
        detailMonthGestureOpacity,
        detailMonthGestureAxis,
        detailMonthGestureCommitted,
        detailMonthGestureBlocked,
        detailMonthGestureRejected,
        detailMonthGestureStartedBlocked,
        detailMonthGestureAdoptionReady,
        detailMonthGestureAdoptedPresentation,
        detailMonthGestureSettleGeneration,
        detailMonthGestureActiveSettleDirection,
        detailMonthGestureActiveSettleAxis,
        detailMonthGestureActiveSettleTargetOffset,
        detailMonthGestureQueuedDirection,
        detailMonthGestureQueuedAxis,
        detailMonthVisualMonthOrdinal,
        detailMonthPagerWindowStartOrdinal,
        detailMonthPagerSlotCalendarHeights,
        detailMonthPagerSlotPageHeights,
        detailMonthPagerSlotDayHeights,
        detailMonthVisualSelectedDayKey,
        detailMonthContinuousCommitPending,
        detailMonthContinuousCommitGeneration,
    } = calendarState;
    const {
        setDetailMonthMotionOwnershipActive,
        holdDetailMonthContinuousCommit,
        scheduleDetailMonthContinuousCommit,
    } = commitController;
    const {
        beginDetailMonthGestureSettle,
        completeDetailMonthGestureSettle,
    } = gestureSettling;
    /** 이동량·속도·페이지 크기를 함께 평가해 일반 스와이프의 월 이동 방향을 결정한다. */
    const resolveSwipeDirection = (
        translation: number,
        velocity: number
    ) => {
        "worklet";

        if (
            Math.abs(translation)
                >= DETAIL_MONTH_SWIPE_GESTURE.distanceThreshold
        ) {
            return translation > 0 ? -1 : 1;
        }
        if (
            Math.abs(velocity)
                >= DETAIL_MONTH_SWIPE_GESTURE.velocityThreshold
        ) {
            return velocity > 0 ? -1 : 1;
        }

        const projectedDistance = translation
            + velocity * DETAIL_MONTH_SWIPE_GESTURE.velocityProjection;
        if (
            Math.abs(projectedDistance)
                >= DETAIL_MONTH_SWIPE_GESTURE.distanceThreshold
        ) {
            return projectedDistance > 0 ? -1 : 1;
        }
        return 0;
    };

    /** 이전 전환에서 이어받은 제스처가 기존 방향을 유지할지 반전할지 판정한다. */
    const resolveAdoptedSwipeDirection = (
        presentationOffset: number,
        velocity: number,
        previousPageDistance: number,
        nextPageDistance: number
    ) => {
        "worklet";

        if (
            Math.abs(velocity)
                >= DETAIL_MONTH_SWIPE_GESTURE.velocityThreshold
        ) {
            return velocity > 0 ? -1 : 1;
        }

        const projectedOffset = presentationOffset
            + velocity * DETAIL_MONTH_SWIPE_GESTURE.velocityProjection;
        const originDistance = Math.abs(projectedOffset);
        const previousDistance = Math.abs(
            projectedOffset - previousPageDistance
        );
        const nextDistance = Math.abs(
            projectedOffset + nextPageDistance
        );
        if (
            previousDistance < originDistance
            && previousDistance <= nextDistance
        ) {
            return -1;
        }
        if (
            nextDistance < originDistance
            && nextDistance < previousDistance
        ) {
            return 1;
        }
        return 0;
    };

    /** 취소된 제스처를 현재 페이지 원점과 현재 레이아웃 높이로 부드럽게 복원한다. */
    const resetGestureOnUI = (velocityTowardOrigin = 0) => {
        "worklet";

        const axis = detailMonthGestureAxis.value;
        const offset = axis === 1
            ? detailMonthGestureTranslateX.value
            : detailMonthGestureTranslateY.value;
        const pageDistance = axis === 1
            ? detailMonthPageWidth
            : offset > 0
                ? detailMonthGesturePreviousPageHeight.value
                : detailMonthGesturePageHeight.value;
        const maximumDuration =
            DETAIL_MONTH_SWIPE_GESTURE.cancelDurationMs;
        const baselineVelocity = pageDistance > 0
            ? pageDistance / maximumDuration
            : 0;
        const effectiveVelocity = Math.max(
            baselineVelocity,
            Math.max(0, velocityTowardOrigin)
        );
        const duration = (
            pageDistance > 0
            && effectiveVelocity > 0
            && Math.abs(offset) > 0
        )
            ? Math.min(
                maximumDuration,
                Math.abs(offset) / effectiveVelocity
            )
            : 0;

        const resetConfig = {
            duration,
            easing: DETAIL_MONTH_SWIPE_REANIMATED_EASING,
        };
        const finishReset = (finished?: boolean) => {
            "worklet";

            if (!finished || detailMonthGestureBlocked.value) return;

            detailMonthGestureBaseTranslateX.value = 0;
            detailMonthGestureBaseTranslateY.value = 0;
            detailMonthGestureAdoptedPresentation.value = false;
            detailMonthGestureAxis.value = 0;
            if (detailMonthContinuousCommitPending.value) {
                runOnJS(scheduleDetailMonthContinuousCommit)();
                return;
            }
            if (detailMonthMotionActive) {
                detailMonthMotionActive.value = false;
            }
            runOnJS(setDetailMonthMotionOwnershipActive)(false);
        };
        detailMonthGestureTranslateX.value = withTiming(
            0,
            resetConfig,
            axis === 2 ? undefined : finishReset
        );
        detailMonthGestureTranslateY.value = withTiming(
            0,
            resetConfig,
            axis === 2 ? finishReset : undefined
        );
        detailMonthGestureOpacity.value = withTiming(1, {
            duration,
            easing: DETAIL_MONTH_SWIPE_REANIMATED_EASING,
        });
        if (
            animatedCalendarHeight
            && detailMonthGestureSourceCalendarHeight.value > 0
        ) {
            animatedCalendarHeight.value = withTiming(
                detailMonthGestureSourceCalendarHeight.value,
                resetConfig
            );
        }
        if (
            animatedDayHeight
            && detailMonthGestureSourceDayHeight.value > 0
        ) {
            animatedDayHeight.value = withTiming(
                detailMonthGestureSourceDayHeight.value,
                resetConfig
            );
        }
    };

    /** 새 입력 또는 보류 입력을 위해 공유값을 초기화하고 기준 페이지의 표시 상태를 고정한다. */
    const prepareGestureOnUI = (
        preservePresentation = false
    ) => {
        "worklet";

        detailMonthGestureRejected.value = false;
        detailMonthGestureCommitted.value = false;
        const presentationX = detailMonthGestureTranslateX.value;
        const presentationY = detailMonthGestureTranslateY.value;
        const previousAxis = detailMonthGestureAxis.value;
        const hasPresentation = preservePresentation
            || Math.abs(presentationX) > 0.5
            || Math.abs(presentationY) > 0.5;
        if (hasPresentation) {
            const lockedAxis = previousAxis !== 0
                ? previousAxis
                : Math.abs(presentationX) >= Math.abs(presentationY)
                    ? 1
                    : 2;
            detailMonthGestureAxis.value = lockedAxis;
            detailMonthGestureBaseTranslateX.value =
                lockedAxis === 1 ? presentationX : 0;
            detailMonthGestureBaseTranslateY.value =
                lockedAxis === 2 ? presentationY : 0;
            detailMonthGestureAdoptedPresentation.value = true;
        } else {
            detailMonthGestureAxis.value = 0;
            detailMonthGestureBaseTranslateX.value = 0;
            detailMonthGestureBaseTranslateY.value = 0;
            detailMonthGestureAdoptedPresentation.value = false;
        }
        const slotPageHeights =
            detailMonthPagerSlotPageHeights.value;
        const slotCalendarHeights =
            detailMonthPagerSlotCalendarHeights.value;
        const slotDayHeights = detailMonthPagerSlotDayHeights.value;
        const currentSlotId = detailMonthVisualMonthOrdinal.value
            - detailMonthPagerWindowStartOrdinal.value;
        const previousSlotId = currentSlotId - 1;
        const currentPageHeight = Math.max(
            1,
            currentSlotId >= 0
                ? slotPageHeights[currentSlotId]
                : detailMonthViewportHeight.value
        );
        detailMonthGesturePageHeight.value = currentPageHeight;
        detailMonthGesturePreviousPageHeight.value = Math.max(
            1,
            previousSlotId >= 0
                ? slotPageHeights[previousSlotId]
                : currentPageHeight
        );
        detailMonthGestureSourceCalendarHeight.value = Math.max(
            1,
            currentSlotId >= 0
                ? slotCalendarHeights[currentSlotId]
                : animatedCalendarHeight?.value
                    ?? currentPageHeight + Math.max(0, headerOffset)
        );
        detailMonthGestureSourceDayHeight.value = Math.max(
            1,
            currentSlotId >= 0
                ? slotDayHeights[currentSlotId]
                : animatedDayHeight?.value
                    ?? CALENDAR_DAY_HEIGHTS.detail
        );
        cancelReanimatedAnimation(detailMonthGestureTranslateX);
        cancelReanimatedAnimation(detailMonthGestureTranslateY);
        cancelReanimatedAnimation(detailMonthGestureOpacity);
    };

    /** 손가락 이동을 선택 축에 투영해 페이지 위치·높이·선택 일자를 매 프레임 갱신한다. */
    const updateGestureOnUI = (
        translationX: number,
        translationY: number
    ) => {
        "worklet";

        if (detailMonthGestureAxis.value === 0) {
            const horizontalDistance = Math.abs(translationX);
            const verticalDistance = Math.abs(translationY);
            if (
                horizontalDistance
                    >= DETAIL_MONTH_SWIPE_GESTURE.activationDistance
                && horizontalDistance
                    >= verticalDistance
                        * DETAIL_MONTH_SWIPE_GESTURE.directionDominance
            ) {
                detailMonthGestureAxis.value = 1;
                detailMonthContinuousCommitGeneration.value += 1;
                runOnJS(holdDetailMonthContinuousCommit)();
                if (detailMonthMotionActive) {
                    detailMonthMotionActive.value = true;
                }
                runOnJS(setDetailMonthMotionOwnershipActive)(true);
            } else if (
                verticalDistance
                    >= DETAIL_MONTH_SWIPE_GESTURE.activationDistance
                && verticalDistance
                    >= horizontalDistance
                        * DETAIL_MONTH_SWIPE_GESTURE.directionDominance
            ) {
                detailMonthGestureAxis.value = 2;
                detailMonthContinuousCommitGeneration.value += 1;
                runOnJS(holdDetailMonthContinuousCommit)();
                if (detailMonthMotionActive) {
                    detailMonthMotionActive.value = true;
                }
                runOnJS(setDetailMonthMotionOwnershipActive)(true);
            } else {
                return;
            }
        }

        const axis = detailMonthGestureAxis.value;
        const translation = axis === 1
            ? detailMonthGestureBaseTranslateX.value + translationX
            : detailMonthGestureBaseTranslateY.value + translationY;
        const previousPageDistance = axis === 1
            ? detailMonthPageWidth
            : detailMonthGesturePreviousPageHeight.value;
        const nextPageDistance = axis === 1
            ? detailMonthPageWidth
            : detailMonthGesturePageHeight.value;
        if (
            previousPageDistance <= 0
            || nextPageDistance <= 0
        ) return;

        const offset = reduceMotionEnabled
            ? 0
            : Math.max(
                -nextPageDistance,
                Math.min(previousPageDistance, translation)
            );
        detailMonthGestureTranslateX.value = axis === 1 ? offset : 0;
        detailMonthGestureTranslateY.value = axis === 2 ? offset : 0;
        detailMonthGestureOpacity.value = 1;
        const targetPosition = offset < 0 ? 1 : -1;
        const pageDistance = offset < 0
            ? nextPageDistance
            : previousPageDistance;
        const targetSlotId = detailMonthVisualMonthOrdinal.value
            - detailMonthPagerWindowStartOrdinal.value
            + targetPosition;
        if (
            targetSlotId >= 0
            && targetSlotId
                < detailMonthPagerSlotCalendarHeights.value.length
            && pageDistance > 0
        ) {
            const progress = Math.min(
                1,
                Math.abs(offset) / pageDistance
            );
            const sourceCalendarHeight =
                detailMonthGestureSourceCalendarHeight.value;
            const sourceDayHeight =
                detailMonthGestureSourceDayHeight.value;
            if (
                animatedCalendarHeight
                && sourceCalendarHeight > 0
            ) {
                animatedCalendarHeight.value = sourceCalendarHeight
                    + (
                        detailMonthPagerSlotCalendarHeights.value[
                            targetSlotId
                        ]
                        - sourceCalendarHeight
                    ) * progress;
            }
            if (animatedDayHeight && sourceDayHeight > 0) {
                animatedDayHeight.value = sourceDayHeight
                    + (
                        detailMonthPagerSlotDayHeights.value[targetSlotId]
                        - sourceDayHeight
                    ) * progress;
            }
        }
    };

    /** 확정 방향의 목표 페이지로 정착시키고 완료 시 JS 커밋과 다음 입력 인계를 예약한다. */
    function startPagerSettleOnUI(
        direction: -1 | 1,
        axis: 1 | 2,
        gestureOffset: number,
        velocity: number
    ) {
        "worklet";

        const settleGeneration =
            detailMonthGestureSettleGeneration.value + 1;
        const targetOrdinal = detailMonthVisualMonthOrdinal.value
            + direction;
        const windowStartOrdinal =
            detailMonthPagerWindowStartOrdinal.value;
        const targetSlotId = targetOrdinal - windowStartOrdinal;
        if (
            targetSlotId < 0
            || targetSlotId
                >= detailMonthPagerSlotPageHeights.value.length
        ) {
            resetGestureOnUI();
            return;
        }
        detailMonthGestureSettleGeneration.value = settleGeneration;
        detailMonthGestureBlocked.value = true;
        detailMonthGestureAxis.value = axis;
        detailMonthGestureBaseTranslateX.value = 0;
        detailMonthGestureBaseTranslateY.value = 0;
        detailMonthGestureAdoptedPresentation.value = false;
        detailMonthContinuousCommitPending.value = true;
        const targetSelectedDayKey =
            shiftCalendarDaySelectionKeyOnUI(
                detailMonthVisualSelectedDayKey.value,
                direction
            );
        detailMonthVisualSelectedDayKey.value = targetSelectedDayKey;
        runOnJS(beginDetailMonthGestureSettle)(
            direction,
            gestureOffset,
            velocity,
            axis,
            targetSelectedDayKey
        );

        const visualSlotId = detailMonthVisualMonthOrdinal.value
            - windowStartOrdinal;
        const distanceSlotId = visualSlotId
            + (direction < 0 ? -1 : 0);
        const pageDistance = axis === 1
            ? detailMonthPageWidth
            : Math.max(
                1,
                distanceSlotId >= 0
                    ? detailMonthPagerSlotPageHeights.value[
                        distanceSlotId
                    ]
                    : direction < 0
                        ? detailMonthGesturePreviousPageHeight.value
                        : detailMonthGesturePageHeight.value
            );
        const activeGestureTranslation = axis === 1
            ? detailMonthGestureTranslateX
            : detailMonthGestureTranslateY;
        const inactiveGestureTranslation = axis === 1
            ? detailMonthGestureTranslateY
            : detailMonthGestureTranslateX;
        const targetOffset = -direction * pageDistance;
        detailMonthGestureActiveSettleDirection.value = direction;
        detailMonthGestureActiveSettleAxis.value = axis;
        detailMonthGestureActiveSettleTargetOffset.value = targetOffset;
        const targetDirection = Math.sign(
            targetOffset - gestureOffset
        );
        const velocityTowardTarget = Math.max(
            0,
            velocity * targetDirection
        );
        const remainingDistance = Math.min(
            pageDistance,
            Math.max(0, Math.abs(targetOffset - gestureOffset))
        );
        const maximumDuration =
            DETAIL_MONTH_SWIPE_MOTION.maxGestureSettleDurationMs;
        const baselineVelocity = pageDistance / maximumDuration;
        const effectiveVelocity = Math.max(
            baselineVelocity,
            velocityTowardTarget
        );
        const settleDurationMs = reduceMotionEnabled
            ? 0
            : remainingDistance > 0
                ? Math.min(
                    maximumDuration,
                    remainingDistance / effectiveVelocity
                )
                : 0;
        const targetCalendarHeight = targetSlotId >= 0
            ? detailMonthPagerSlotCalendarHeights.value[targetSlotId]
            : 0;
        const targetDayHeight = targetSlotId >= 0
            ? detailMonthPagerSlotDayHeights.value[targetSlotId]
            : 0;
        const settleConfig = {
            duration: settleDurationMs,
            easing: DETAIL_MONTH_SWIPE_SETTLE_REANIMATED_EASING,
        };
        if (targetCalendarHeight > 0 && animatedCalendarHeight) {
            animatedCalendarHeight.value = withTiming(
                targetCalendarHeight,
                settleConfig
            );
        }
        if (targetDayHeight > 0 && animatedDayHeight) {
            animatedDayHeight.value = withTiming(
                targetDayHeight,
                settleConfig
            );
        }
        inactiveGestureTranslation.value = 0;
        activeGestureTranslation.value = withTiming(
            targetOffset,
            settleConfig,
            (finished) => {
                if (
                    detailMonthGestureSettleGeneration.value
                    !== settleGeneration
                ) return;
                detailMonthGestureActiveSettleDirection.value = 0;
                detailMonthGestureActiveSettleAxis.value = 0;
                detailMonthGestureActiveSettleTargetOffset.value = 0;
                if (!finished && !detailMonthGestureBlocked.value) return;
                const interruptedOffset =
                    activeGestureTranslation.value;
                const queuedDirection =
                    detailMonthGestureQueuedDirection.value;
                const queuedAxis = detailMonthGestureQueuedAxis.value;
                const heldGesture = (
                    !finished
                    && queuedDirection === 0
                    && detailMonthGestureStartedBlocked.value
                );
                if (!finished && !heldGesture) {
                    inactiveGestureTranslation.value = 0;
                    activeGestureTranslation.value = targetOffset;
                    if (
                        targetCalendarHeight > 0
                        && animatedCalendarHeight
                    ) {
                        animatedCalendarHeight.value =
                            targetCalendarHeight;
                    }
                    if (targetDayHeight > 0 && animatedDayHeight) {
                        animatedDayHeight.value = targetDayHeight;
                    }
                }

                detailMonthVisualMonthOrdinal.value += direction;
                inactiveGestureTranslation.value = 0;
                if (heldGesture) {
                    const residualOffset =
                        interruptedOffset - targetOffset;
                    activeGestureTranslation.value = residualOffset;
                    detailMonthGestureBaseTranslateX.value =
                        axis === 1 ? residualOffset : 0;
                    detailMonthGestureBaseTranslateY.value =
                        axis === 2 ? residualOffset : 0;
                    detailMonthGestureAdoptedPresentation.value = true;
                } else {
                    activeGestureTranslation.value = 0;
                    detailMonthGestureBaseTranslateX.value = 0;
                    detailMonthGestureBaseTranslateY.value = 0;
                    detailMonthGestureAdoptedPresentation.value = false;
                }
                detailMonthGestureSettleGeneration.value =
                    settleGeneration + 1;

                const keepMotionActive =
                    queuedDirection !== 0 || heldGesture;
                runOnJS(completeDetailMonthGestureSettle)(
                    direction,
                    axis,
                    keepMotionActive
                );

                if (queuedDirection !== 0 && queuedAxis !== 0) {
                    detailMonthGestureQueuedDirection.value = 0;
                    detailMonthGestureQueuedAxis.value = 0;
                    detailMonthGestureStartedBlocked.value = false;
                    detailMonthGestureAdoptionReady.value = false;
                    detailMonthGestureAdoptedPresentation.value = false;
                    startPagerSettleOnUI(
                        queuedDirection,
                        queuedAxis,
                        0,
                        0
                    );
                    return;
                }

                detailMonthGestureBlocked.value = false;
                detailMonthGestureAdoptionReady.value = heldGesture;
                if (!heldGesture) {
                    detailMonthGestureAxis.value = 0;
                    if (
                        detailMonthMotionActive
                        && !detailMonthContinuousCommitPending.value
                    ) {
                        detailMonthMotionActive.value = false;
                    }
                }
            }
        );
    }

    /** 진행 중인 정착을 끊은 입력이 임계값을 넘으면 해당 끝점을 새 기준 페이지로 승격한다. */
    function promoteInterruptedSettleOnUI() {
        "worklet";

        const direction =
            detailMonthGestureActiveSettleDirection.value;
        const axis = detailMonthGestureActiveSettleAxis.value;
        const targetOffset =
            detailMonthGestureActiveSettleTargetOffset.value;
        if (
            direction === 0
            || (axis !== 1 && axis !== 2)
            || !Number.isFinite(targetOffset)
        ) return false;

        const activeGestureTranslation = axis === 1
            ? detailMonthGestureTranslateX
            : detailMonthGestureTranslateY;
        const inactiveGestureTranslation = axis === 1
            ? detailMonthGestureTranslateY
            : detailMonthGestureTranslateX;
        const interruptedOffset = activeGestureTranslation.value;

        // Invalidate first: cancelAnimation may synchronously invoke the
        // old timing callback on the UI runtime. That callback must not
        // promote or complete the same page a second time.
        detailMonthGestureSettleGeneration.value += 1;
        detailMonthGestureActiveSettleDirection.value = 0;
        detailMonthGestureActiveSettleAxis.value = 0;
        detailMonthGestureActiveSettleTargetOffset.value = 0;
        detailMonthGestureQueuedDirection.value = 0;
        detailMonthGestureQueuedAxis.value = 0;
        cancelReanimatedAnimation(detailMonthGestureTranslateX);
        cancelReanimatedAnimation(detailMonthGestureTranslateY);
        cancelReanimatedAnimation(detailMonthGestureOpacity);
        if (animatedCalendarHeight) {
            cancelReanimatedAnimation(animatedCalendarHeight);
        }
        if (animatedDayHeight) {
            cancelReanimatedAnimation(animatedDayHeight);
        }

        // Promote the target page immediately while preserving its exact
        // presentation offset. The same finger can now take ownership on
        // its first update instead of waiting for a cancelled callback.
        detailMonthVisualMonthOrdinal.value += direction;
        const residualOffset = interruptedOffset - targetOffset;
        inactiveGestureTranslation.value = 0;
        activeGestureTranslation.value = residualOffset;
        detailMonthGestureBaseTranslateX.value =
            axis === 1 ? residualOffset : 0;
        detailMonthGestureBaseTranslateY.value =
            axis === 2 ? residualOffset : 0;
        detailMonthGestureAxis.value = axis;
        detailMonthGestureAdoptedPresentation.value = true;
        detailMonthGestureCommitted.value = false;
        detailMonthGestureBlocked.value = false;
        detailMonthGestureAdoptionReady.value = true;
        runOnJS(completeDetailMonthGestureSettle)(
            direction,
            axis,
            true
        );
        return true;
    }

    return {
        resolveSwipeDirection,
        resolveAdoptedSwipeDirection,
        resetGestureOnUI,
        prepareGestureOnUI,
        updateGestureOnUI,
        startPagerSettleOnUI,
        promoteInterruptedSettleOnUI,
    };
}
