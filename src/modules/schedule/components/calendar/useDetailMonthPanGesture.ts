import { useMemo } from "react";
import { Gesture } from "react-native-gesture-handler";
import {
    cancelAnimation as cancelReanimatedAnimation,
    runOnJS,
    type SharedValue,
} from "react-native-reanimated";
import { DETAIL_MONTH_SWIPE_GESTURE } from "../../calendarMotion";
import type { CalendarViewMode } from "./viewMode";
import type { TodayFocusTarget } from "./scheduleCalendarModel";
import type { ScheduleCalendarState } from "./useScheduleCalendarState";
import type { useDetailMonthCommitController } from "./useDetailMonthCommitController";
import type { useDetailMonthPanWorklets } from "./useDetailMonthPanWorklets";

type DetailMonthCommitController = ReturnType<
    typeof useDetailMonthCommitController
>;
type DetailMonthPanWorklets = ReturnType<typeof useDetailMonthPanWorklets>;

type UseDetailMonthPanGestureParams = {
    calendarState: ScheduleCalendarState;
    commitController: DetailMonthCommitController;
    panWorklets: DetailMonthPanWorklets;
    viewMode: CalendarViewMode;
    transitionActive: boolean;
    todayFocusTarget?: TodayFocusTarget | null;
    detailMonthPageWidth: number;
    animatedCalendarHeight?: SharedValue<number>;
    animatedDayHeight?: SharedValue<number>;
};

/**
 * RNGH 팬 이벤트의 시작·업데이트·종료·취소 순서를 상세 월 worklet과 연결한다.
 * 다중 터치와 부모 전환 중 입력을 즉시 실패시키고, 진행 중 정착 애니메이션을 새
 * 손가락이 이어받을 때는 현재 표시 오프셋을 보존한다.
 */
export function useDetailMonthPanGesture({
    calendarState,
    commitController,
    panWorklets,
    viewMode,
    transitionActive,
    todayFocusTarget,
    detailMonthPageWidth,
    animatedCalendarHeight,
    animatedDayHeight,
}: UseDetailMonthPanGestureParams) {
    const {
        detailMonthGesturePageHeight,
        detailMonthGesturePreviousPageHeight,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthGestureAxis,
        detailMonthGestureCommitted,
        detailMonthGestureBlocked,
        detailMonthGestureRejected,
        detailMonthGestureStartedBlocked,
        detailMonthGestureAdoptionReady,
        detailMonthGestureAdoptedPresentation,
        detailMonthGestureQueuedDirection,
        detailMonthGestureQueuedAxis,
        detailMonthContinuousCommitPending,
        detailMonthContinuousCommitGeneration,
    } = calendarState;
    const {
        holdDetailMonthContinuousCommit,
    } = commitController;
    const {
        resolveSwipeDirection,
        resolveAdoptedSwipeDirection,
        resetGestureOnUI,
        prepareGestureOnUI,
        updateGestureOnUI,
        startPagerSettleOnUI,
        promoteInterruptedSettleOnUI,
    } = panWorklets;
    const detailMonthPanGesture = useMemo(() => {
        return Gesture.Pan()
            .enabled(
                viewMode === "detail"
                && !transitionActive
                && !todayFocusTarget
                && detailMonthPageWidth > 0
            )
            .minDistance(DETAIL_MONTH_SWIPE_GESTURE.activationDistance)
            .maxPointers(1)
            .cancelsTouchesInView(true)
            .withTestId("detail-month-pan-gesture")
            .onTouchesDown((event, stateManager) => {
                if (detailMonthContinuousCommitPending.value) {
                    // A finger already on the calendar owns the next frame.
                    // Do not let the idle controlled commit and its Fabric
                    // work land in the middle of a slowly-started drag.
                    detailMonthContinuousCommitGeneration.value += 1;
                    runOnJS(holdDetailMonthContinuousCommit)();
                }
                if (event.numberOfTouches > 1) {
                    detailMonthGestureAdoptionReady.value = false;
                    detailMonthGestureRejected.value = true;
                    detailMonthGestureStartedBlocked.value = false;
                    stateManager.fail();
                    return;
                }
                if (detailMonthGestureBlocked.value) {
                    detailMonthGestureStartedBlocked.value = true;
                    if (promoteInterruptedSettleOnUI()) return;
                    // Legacy JS-driven transitions have no UI settle metadata.
                    // Keep their existing cancellation callback handoff.
                    cancelReanimatedAnimation(
                        detailMonthGestureTranslateX
                    );
                    cancelReanimatedAnimation(
                        detailMonthGestureTranslateY
                    );
                    if (animatedCalendarHeight) {
                        cancelReanimatedAnimation(animatedCalendarHeight);
                    }
                    if (animatedDayHeight) {
                        cancelReanimatedAnimation(animatedDayHeight);
                    }
                    return;
                }
                detailMonthGestureAdoptionReady.value = false;
                detailMonthGestureRejected.value = false;
                detailMonthGestureStartedBlocked.value = false;
            })
            .onBegin(() => {
                if (detailMonthGestureStartedBlocked.value) return;
                if (detailMonthGestureBlocked.value) {
                    detailMonthGestureStartedBlocked.value = true;
                    return;
                }
                prepareGestureOnUI();
            })
            .onUpdate((event) => {
                if (detailMonthGestureRejected.value) return;
                if (detailMonthGestureStartedBlocked.value) {
                    if (
                        detailMonthGestureBlocked.value
                        || !detailMonthGestureAdoptionReady.value
                    ) return;

                    detailMonthGestureAdoptionReady.value = false;
                    detailMonthGestureStartedBlocked.value = false;
                    prepareGestureOnUI(true);
                }
                if (detailMonthGestureBlocked.value) return;

                updateGestureOnUI(
                    event.translationX,
                    event.translationY
                );
            })
            .onEnd((event) => {
                if (
                    detailMonthGestureStartedBlocked.value
                    && !detailMonthGestureBlocked.value
                    && detailMonthGestureAdoptionReady.value
                ) {
                    // The prior transition unlocked between the final update
                    // and release. Seed the pager from the finger endpoint so
                    // this edge case still settles from the visible drag
                    // distance instead of restarting at zero.
                    detailMonthGestureAdoptionReady.value = false;
                    detailMonthGestureStartedBlocked.value = false;
                    prepareGestureOnUI(true);
                    updateGestureOnUI(
                        event.translationX,
                        event.translationY
                    );
                }
                if (detailMonthGestureStartedBlocked.value) {
                    const horizontalDistance = Math.abs(event.translationX);
                    const verticalDistance = Math.abs(event.translationY);
                    let queuedAxis: 0 | 1 | 2 = 0;
                    if (
                        horizontalDistance
                            >= DETAIL_MONTH_SWIPE_GESTURE.activationDistance
                        && horizontalDistance
                            >= verticalDistance
                                * DETAIL_MONTH_SWIPE_GESTURE.directionDominance
                    ) {
                        queuedAxis = 1;
                    } else if (
                        verticalDistance
                            >= DETAIL_MONTH_SWIPE_GESTURE.activationDistance
                        && verticalDistance
                            >= horizontalDistance
                                * DETAIL_MONTH_SWIPE_GESTURE.directionDominance
                    ) {
                        queuedAxis = 2;
                    }
                    if (queuedAxis === 0) return;

                    const queuedTranslation = queuedAxis === 1
                        ? event.translationX
                        : event.translationY;
                    const queuedVelocity = (
                        queuedAxis === 1 ? event.velocityX : event.velocityY
                    ) / 1_000;
                    const queuedDirection = resolveSwipeDirection(
                        queuedTranslation,
                        queuedVelocity
                    );
                    if (queuedDirection !== 0) {
                        detailMonthGestureQueuedDirection.value =
                            queuedDirection < 0 ? -1 : 1;
                        detailMonthGestureQueuedAxis.value = queuedAxis;
                    }
                    return;
                }
                if (detailMonthGestureBlocked.value) return;

                if (detailMonthGestureAxis.value === 0) {
                    // A short, fast flick can reach onEnd before RNGH emits an
                    // onUpdate frame. Classify that endpoint here so it still
                    // participates in the pager instead of falling through as
                    // a tap on an overflow date.
                    updateGestureOnUI(
                        event.translationX,
                        event.translationY
                    );
                }
                const axis = detailMonthGestureAxis.value;
                if (axis === 0) return;
                detailMonthGestureCommitted.value = true;

                // Gesture Handler reports points/second while the calendar
                // motion contract uses points/millisecond.
                const velocity = (
                    axis === 1 ? event.velocityX : event.velocityY
                ) / 1_000;
                const gestureOffset = axis === 1
                    ? detailMonthGestureTranslateX.value
                    : detailMonthGestureTranslateY.value;
                const previousPageDistance = axis === 1
                    ? detailMonthPageWidth
                    : detailMonthGesturePreviousPageHeight.value;
                const nextPageDistance = axis === 1
                    ? detailMonthPageWidth
                    : detailMonthGesturePageHeight.value;
                const direction =
                    detailMonthGestureAdoptedPresentation.value
                        ? resolveAdoptedSwipeDirection(
                            gestureOffset,
                            velocity,
                            previousPageDistance,
                            nextPageDistance
                        )
                        : resolveSwipeDirection(
                            gestureOffset,
                            velocity
                        );

                const pageDistance = axis === 1
                    ? detailMonthPageWidth
                    : direction < 0
                        ? detailMonthGesturePreviousPageHeight.value
                        : detailMonthGesturePageHeight.value;
                if (direction === 0 || pageDistance <= 0) {
                    const velocityTowardOrigin = Math.max(
                        0,
                        -Math.sign(gestureOffset) * velocity
                    );
                    resetGestureOnUI(velocityTowardOrigin);
                    return;
                }

                startPagerSettleOnUI(
                    direction < 0 ? -1 : 1,
                    axis,
                    gestureOffset,
                    velocity
                );
            })
            .onFinalize(() => {
                const adoptionReady =
                    detailMonthGestureAdoptionReady.value;
                detailMonthGestureAdoptionReady.value = false;
                if (detailMonthGestureStartedBlocked.value) {
                    detailMonthGestureStartedBlocked.value = false;
                    if (!detailMonthGestureBlocked.value) {
                        if (adoptionReady) {
                            prepareGestureOnUI(true);
                        }
                        resetGestureOnUI();
                    }
                    return;
                }
                if (detailMonthGestureRejected.value) {
                    detailMonthGestureRejected.value = false;
                    if (!detailMonthGestureCommitted.value) {
                        resetGestureOnUI();
                    }
                    detailMonthGestureCommitted.value = false;
                    return;
                }
                if (!detailMonthGestureCommitted.value) {
                    resetGestureOnUI();
                }
                detailMonthGestureCommitted.value = false;
            });
    }, [
        animatedCalendarHeight,
        animatedDayHeight,
        detailMonthContinuousCommitPending,
        detailMonthGestureAdoptionReady,
        detailMonthGestureAdoptedPresentation,
        detailMonthGestureAxis,
        detailMonthGestureBlocked,
        detailMonthGestureCommitted,
        detailMonthGesturePageHeight,
        detailMonthGesturePreviousPageHeight,
        detailMonthGestureQueuedAxis,
        detailMonthGestureQueuedDirection,
        detailMonthGestureRejected,
        detailMonthGestureStartedBlocked,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthPageWidth,
        detailMonthContinuousCommitGeneration,
        holdDetailMonthContinuousCommit,
        prepareGestureOnUI,
        promoteInterruptedSettleOnUI,
        resetGestureOnUI,
        resolveAdoptedSwipeDirection,
        resolveSwipeDirection,
        startPagerSettleOnUI,
        todayFocusTarget,
        transitionActive,
        updateGestureOnUI,
        viewMode,
    ]);

    return detailMonthPanGesture;
}
