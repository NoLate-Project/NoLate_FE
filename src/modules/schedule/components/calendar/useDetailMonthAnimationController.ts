/* eslint-disable react-hooks/exhaustive-deps -- calendarState에서 받은 ref와 setter는 훅 수명 동안 안정적이며 배열 확장은 핵심 전환 흐름을 가린다. */
import {
    useCallback,
    useEffect,
    useLayoutEffect,
} from "react";
import { Animated } from "react-native";
import type { DateData } from "react-native-calendars";
import {
    cancelAnimation as cancelReanimatedAnimation,
    Easing as ReanimatedEasing,
    runOnJS,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";
import {
    CALENDAR_INTERACTION_BUDGET_MS,
    DETAIL_MONTH_SWIPE_GESTURE,
    DETAIL_MONTH_SWIPE_MOTION,
} from "../../calendarMotion";
import {
    DETAIL_MONTH_SWIPE_EASING,
    DETAIL_MONTH_SWIPE_REANIMATED_EASING,
    getCalendarDaySelectionKey,
    resolveDetailMonthAnchor,
    type TodayFocusTarget,
} from "./scheduleCalendarModel";
import type { ScheduleCalendarState } from "./useScheduleCalendarState";
import type { useDetailMonthCommitController } from "./useDetailMonthCommitController";

type DetailMonthCommitController = ReturnType<
    typeof useDetailMonthCommitController
>;

type UseDetailMonthAnimationControllerParams = {
    calendarState: ScheduleCalendarState;
    commitController: DetailMonthCommitController;
    animatedCalendarHeight?: SharedValue<number>;
    animatedDayHeight?: SharedValue<number>;
    detailMonthMotionActive?: SharedValue<boolean>;
    onRegisterDetailMonthMotionCancel?: (
        cancel: (() => void) | null
    ) => void;
    todayFocusTarget?: TodayFocusTarget | null;
};

/**
 * 상세 월 전환의 취소·초기화·진입 애니메이션과 페이저 커밋 순서를 관리한다.
 * 애니메이션 세대와 감시 타이머를 검증해 취소된 콜백이 최신 월의 시각 상태나
 * 제어형 날짜 커밋을 덮어쓰지 않도록 한다.
 */
export function useDetailMonthAnimationController({
    calendarState,
    commitController,
    animatedCalendarHeight,
    animatedDayHeight,
    detailMonthMotionActive,
    onRegisterDetailMonthMotionCancel,
    todayFocusTarget,
}: UseDetailMonthAnimationControllerParams) {
    const {
        setDetailMonthPagerAnchorDay,
        setDetailMonthPagerHandoffDay,
        detailMonthTranslateX,
        detailMonthTranslateY,
        detailMonthOpacity,
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
        detailMonthVisualSelectedDayKey,
        detailMonthAnimationRef,
        detailMonthAnimationFrameRef,
        detailMonthPagerHandoffFrameRef,
        detailMonthPagerRebaseFrameRef,
        detailMonthPagerRebasePendingRef,
        detailMonthCommitWatchdogRef,
        detailMonthDeadlineWatchdogRef,
        detailMonthAnimationActiveRef,
        detailMonthAnimationPhaseRef,
        detailMonthAnimationGenerationRef,
        detailMonthAnimationSourceDayRef,
        detailMonthAnimationExpectedDayRef,
        detailMonthPreviewedDayRef,
        detailMonthSuppressedCommitRef,
        detailMonthAnimationPendingCommandsRef,
        detailMonthAnimationEnterDurationRef,
        detailMonthAnimationStartedAtRef,
        detailMonthAnimationUsesPagerRef,
        detailMonthAnimationUsesGestureLayerRef,
        detailMonthAnimationAxisRef,
        detailMonthGestureResetAnimationRef,
        detailMonthLatestSelectedDayRef,
        detailMonthLatestVisibleMonthRef,
        detailMonthLatestViewModeRef,
        detailMonthLatestReduceMotionRef,
        todayFocusTargetRef,
        acknowledgedTodayFocusTargetRef,
        startDetailMonthAnimationRef,
        detailMonthPageLayoutsRef,
    } = calendarState;
    const {
        setDetailMonthMotionOwnershipActive,
        emitDetailMonthPreview,
        commitDetailMonthControlledState,
        discardDetailMonthContinuousCommit,
        acknowledgeTodayFocusTarget,
    } = commitController;
    /** 현재 세대의 타이머와 애니메이션을 모두 취소하고 제어형 날짜를 기준으로 시각 상태를 복원한다. */
    const invalidateDetailMonthAnimation = useCallback((
        clearPending = true,
        keepGestureBlocked = false,
        keepMotionOwnershipActive = false
    ) => {
        detailMonthAnimationGenerationRef.current += 1;
        const activeAnimation = detailMonthAnimationRef.current;
        const activeGestureResetAnimation = detailMonthGestureResetAnimationRef.current;
        const activeFrame = detailMonthAnimationFrameRef.current;
        const activeHandoffFrame = detailMonthPagerHandoffFrameRef.current;
        const activeRebaseFrame = detailMonthPagerRebaseFrameRef.current;
        const activeWatchdog = detailMonthCommitWatchdogRef.current;
        const activeDeadlineWatchdog = detailMonthDeadlineWatchdogRef.current;
        const expectedMonth = detailMonthAnimationExpectedDayRef.current?.slice(0, 7);
        if (expectedMonth) detailMonthSuppressedCommitRef.current = expectedMonth;
        detailMonthAnimationRef.current = null;
        detailMonthAnimationFrameRef.current = null;
        detailMonthPagerHandoffFrameRef.current = null;
        detailMonthPagerRebaseFrameRef.current = null;
        detailMonthPagerRebasePendingRef.current = null;
        detailMonthCommitWatchdogRef.current = null;
        detailMonthDeadlineWatchdogRef.current = null;
        detailMonthGestureResetAnimationRef.current = null;
        detailMonthAnimationPhaseRef.current = "idle";
        detailMonthAnimationSourceDayRef.current = null;
        detailMonthAnimationExpectedDayRef.current = null;
        detailMonthAnimationActiveRef.current = false;
        detailMonthAnimationUsesPagerRef.current = false;
        detailMonthAnimationUsesGestureLayerRef.current = false;
        const controlledAnchor = resolveDetailMonthAnchor(
            detailMonthLatestSelectedDayRef.current,
            detailMonthLatestVisibleMonthRef.current
        );
        detailMonthVisualSelectedDayKey.value =
            getCalendarDaySelectionKey(controlledAnchor);
        const previewedDay = detailMonthPreviewedDayRef.current;
        detailMonthPreviewedDayRef.current = null;
        if (
            previewedDay
            && previewedDay.slice(0, 7) !== controlledAnchor.slice(0, 7)
        ) {
            emitDetailMonthPreview(controlledAnchor);
        }
        setDetailMonthPagerAnchorDay((current) => (
            current === controlledAnchor ? current : controlledAnchor
        ));
        setDetailMonthPagerHandoffDay((current) => (
            current === null ? current : null
        ));
        detailMonthAnimationAxisRef.current = "horizontal";
        detailMonthAnimationStartedAtRef.current = 0;
        if (clearPending) {
            detailMonthAnimationPendingCommandsRef.current = [];
        }
        detailMonthGestureSettleGeneration.value += 1;
        detailMonthGestureActiveSettleDirection.value = 0;
        detailMonthGestureActiveSettleAxis.value = 0;
        detailMonthGestureActiveSettleTargetOffset.value = 0;
        detailMonthGestureAdoptionReady.value = false;
        detailMonthGestureAdoptedPresentation.value = false;
        detailMonthGestureQueuedDirection.value = 0;
        detailMonthGestureQueuedAxis.value = 0;
        detailMonthGestureBlocked.value = keepGestureBlocked;
        detailMonthGestureRejected.value = false;
        detailMonthGestureAxis.value = 0;
        detailMonthGestureCommitted.value = false;
        detailMonthGestureBaseTranslateX.value = 0;
        detailMonthGestureBaseTranslateY.value = 0;

        if (activeFrame !== null) cancelAnimationFrame(activeFrame);
        if (activeHandoffFrame !== null) {
            cancelAnimationFrame(activeHandoffFrame);
        }
        if (activeRebaseFrame !== null) {
            cancelAnimationFrame(activeRebaseFrame);
        }
        if (activeWatchdog !== null) clearTimeout(activeWatchdog);
        if (activeDeadlineWatchdog !== null) clearTimeout(activeDeadlineWatchdog);
        activeAnimation?.stop();
        activeGestureResetAnimation?.stop();
        cancelReanimatedAnimation(detailMonthGestureTranslateX);
        cancelReanimatedAnimation(detailMonthGestureTranslateY);
        cancelReanimatedAnimation(detailMonthGestureOpacity);
        if (detailMonthLatestViewModeRef.current === "detail") {
            const currentLayout = detailMonthPageLayoutsRef.current?.current;
            if (currentLayout && animatedCalendarHeight) {
                cancelReanimatedAnimation(animatedCalendarHeight);
                animatedCalendarHeight.value = currentLayout.calendarHeight;
            }
            if (currentLayout && animatedDayHeight) {
                cancelReanimatedAnimation(animatedDayHeight);
                animatedDayHeight.value = currentLayout.dayHeight;
            }
        }
        detailMonthGestureTranslateX.value = 0;
        detailMonthGestureTranslateY.value = 0;
        detailMonthGestureOpacity.value = 1;
        detailMonthTranslateX.stopAnimation();
        detailMonthTranslateY.stopAnimation();
        detailMonthOpacity.stopAnimation();
        detailMonthTranslateX.setValue(0);
        detailMonthTranslateY.setValue(0);
        detailMonthOpacity.setValue(1);
        if (!keepMotionOwnershipActive) {
            if (detailMonthMotionActive) {
                detailMonthMotionActive.value = false;
            }
            setDetailMonthMotionOwnershipActive(false);
        }
    }, [
        animatedCalendarHeight,
        animatedDayHeight,
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
        detailMonthGestureBlocked,
        detailMonthGestureCommitted,
        detailMonthGestureQueuedAxis,
        detailMonthGestureQueuedDirection,
        detailMonthGestureRejected,
        detailMonthGestureSettleGeneration,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthTranslateX,
        detailMonthTranslateY,
        detailMonthMotionActive,
        detailMonthVisualSelectedDayKey,
        emitDetailMonthPreview,
        setDetailMonthMotionOwnershipActive,
    ]);

    /** 외부 취소 요청이 오면 대기 커밋과 진행 중인 상세 월 전환을 함께 종료한다. */
    const cancelDetailMonthMotion = useCallback(() => {
        discardDetailMonthContinuousCommit();
        invalidateDetailMonthAnimation(true);
    }, [
        discardDetailMonthContinuousCommit,
        invalidateDetailMonthAnimation,
    ]);

    /** 거절되거나 중단된 제스처의 이동·투명도·높이를 현재 월의 안정 상태로 되돌린다. */
    const resetDetailMonthGesture = useCallback((
        durationMs: number = DETAIL_MONTH_SWIPE_GESTURE.cancelDurationMs
    ) => {
        detailMonthGestureResetAnimationRef.current?.stop();
        detailMonthGestureResetAnimationRef.current = null;
        detailMonthGestureSettleGeneration.value += 1;
        detailMonthGestureActiveSettleDirection.value = 0;
        detailMonthGestureActiveSettleAxis.value = 0;
        detailMonthGestureActiveSettleTargetOffset.value = 0;
        detailMonthGestureAdoptionReady.value = false;
        detailMonthGestureAdoptedPresentation.value = false;
        detailMonthGestureQueuedDirection.value = 0;
        detailMonthGestureQueuedAxis.value = 0;
        detailMonthGestureBlocked.value = false;
        detailMonthGestureRejected.value = false;
        detailMonthGestureAxis.value = 0;
        detailMonthGestureCommitted.value = false;
        detailMonthGestureBaseTranslateX.value = 0;
        detailMonthGestureBaseTranslateY.value = 0;
        cancelReanimatedAnimation(detailMonthGestureTranslateX);
        cancelReanimatedAnimation(detailMonthGestureTranslateY);
        cancelReanimatedAnimation(detailMonthGestureOpacity);
        const safeDurationMs = Number.isFinite(durationMs)
            ? Math.max(0, durationMs)
            : 0;
        const layoutResetDurationMs =
            detailMonthLatestReduceMotionRef.current ? 0 : safeDurationMs;
        const currentLayout = detailMonthPageLayoutsRef.current?.current;
        if (currentLayout && animatedCalendarHeight) {
            cancelReanimatedAnimation(animatedCalendarHeight);
            animatedCalendarHeight.value = layoutResetDurationMs > 0
                ? withTiming(currentLayout.calendarHeight, {
                    duration: layoutResetDurationMs,
                    easing: ReanimatedEasing.bezier(
                        ...DETAIL_MONTH_SWIPE_MOTION.bezier
                    ),
                })
                : currentLayout.calendarHeight;
        }
        if (currentLayout && animatedDayHeight) {
            cancelReanimatedAnimation(animatedDayHeight);
            animatedDayHeight.value = layoutResetDurationMs > 0
                ? withTiming(currentLayout.dayHeight, {
                    duration: layoutResetDurationMs,
                    easing: ReanimatedEasing.bezier(
                        ...DETAIL_MONTH_SWIPE_MOTION.bezier
                    ),
                })
                : currentLayout.dayHeight;
        }

        if (
            detailMonthLatestReduceMotionRef.current
            || safeDurationMs === 0
        ) {
            detailMonthGestureTranslateX.value = 0;
            detailMonthGestureTranslateY.value = 0;
            detailMonthGestureOpacity.value = 1;
            detailMonthTranslateX.setValue(0);
            detailMonthTranslateY.setValue(0);
            detailMonthOpacity.setValue(1);
            if (detailMonthMotionActive) {
                detailMonthMotionActive.value = false;
            }
            setDetailMonthMotionOwnershipActive(false);
            return;
        }

        detailMonthGestureTranslateX.value = withTiming(0, {
            duration: safeDurationMs,
            easing: ReanimatedEasing.bezier(...DETAIL_MONTH_SWIPE_MOTION.bezier),
        });
        detailMonthGestureTranslateY.value = withTiming(0, {
            duration: safeDurationMs,
            easing: ReanimatedEasing.bezier(...DETAIL_MONTH_SWIPE_MOTION.bezier),
        });
        detailMonthGestureOpacity.value = withTiming(1, {
            duration: safeDurationMs,
            easing: ReanimatedEasing.bezier(...DETAIL_MONTH_SWIPE_MOTION.bezier),
        });

        const resetAnimation = Animated.parallel([
            Animated.timing(detailMonthTranslateX, {
                toValue: 0,
                duration: safeDurationMs,
                easing: DETAIL_MONTH_SWIPE_EASING,
                useNativeDriver: true,
                isInteraction: false,
            }),
            Animated.timing(detailMonthTranslateY, {
                toValue: 0,
                duration: safeDurationMs,
                easing: DETAIL_MONTH_SWIPE_EASING,
                useNativeDriver: true,
                isInteraction: false,
            }),
            Animated.timing(detailMonthOpacity, {
                toValue: 1,
                duration: safeDurationMs,
                easing: DETAIL_MONTH_SWIPE_EASING,
                useNativeDriver: true,
                isInteraction: false,
            }),
        ]);
        detailMonthGestureResetAnimationRef.current = resetAnimation;
        resetAnimation.start(() => {
            if (detailMonthGestureResetAnimationRef.current === resetAnimation) {
                detailMonthGestureResetAnimationRef.current = null;
            }
            if (detailMonthMotionActive) {
                detailMonthMotionActive.value = false;
            }
            setDetailMonthMotionOwnershipActive(false);
        });
    }, [
        animatedCalendarHeight,
        animatedDayHeight,
        detailMonthGestureActiveSettleAxis,
        detailMonthGestureActiveSettleDirection,
        detailMonthGestureActiveSettleTargetOffset,
        detailMonthGestureOpacity,
        detailMonthGestureAxis,
        detailMonthGestureAdoptionReady,
        detailMonthGestureAdoptedPresentation,
        detailMonthGestureBaseTranslateX,
        detailMonthGestureBaseTranslateY,
        detailMonthGestureBlocked,
        detailMonthGestureCommitted,
        detailMonthGestureQueuedAxis,
        detailMonthGestureQueuedDirection,
        detailMonthGestureRejected,
        detailMonthGestureSettleGeneration,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthOpacity,
        detailMonthTranslateX,
        detailMonthTranslateY,
        detailMonthMotionActive,
        setDetailMonthMotionOwnershipActive,
    ]);

    useLayoutEffect(() => {
        if (!onRegisterDetailMonthMotionCancel) return undefined;

        onRegisterDetailMonthMotionCancel(cancelDetailMonthMotion);
        return () => onRegisterDetailMonthMotionCancel(null);
    }, [cancelDetailMonthMotion, onRegisterDetailMonthMotionCancel]);

    useEffect(() => {
        if (!todayFocusTarget) acknowledgedTodayFocusTargetRef.current = null;
    }, [todayFocusTarget]);

    useEffect(() => (
        () => invalidateDetailMonthAnimation(true)
    ), [invalidateDetailMonthAnimation]);

    /** 한 전환 세대를 종료하고 보류 명령 또는 눌린 채 대기하던 다음 제스처를 인계한다. */
    const completeDetailMonthAnimation = useCallback((
        generation: number,
        allowGestureAdoption = false
    ) => {
        if (generation !== detailMonthAnimationGenerationRef.current) return;

        const [pendingCommand, ...remainingCommands] =
            detailMonthAnimationPendingCommandsRef.current;
        detailMonthAnimationPendingCommandsRef.current = remainingCommands;
        const shouldStartPending = Boolean(
            pendingCommand
            && detailMonthLatestViewModeRef.current === "detail"
        );
        const shouldAdoptHeldGesture = Boolean(
            allowGestureAdoption
            && !shouldStartPending
            && detailMonthGestureStartedBlocked.value
        );
        invalidateDetailMonthAnimation(
            false,
            shouldStartPending,
            shouldAdoptHeldGesture
        );
        if (allowGestureAdoption && !shouldStartPending) {
            detailMonthGestureBlocked.value = false;
            detailMonthGestureAdoptionReady.value = true;
        }
        if (
            !pendingCommand ||
            detailMonthLatestViewModeRef.current !== "detail"
        ) {
            if (detailMonthLatestViewModeRef.current !== "detail") {
                detailMonthAnimationPendingCommandsRef.current = [];
            }
            return;
        }

        startDetailMonthAnimationRef.current(pendingCommand.direction, {
            gestureAxis: pendingCommand.axis,
        });
    }, [
        detailMonthGestureAdoptionReady,
        detailMonthGestureBlocked,
        detailMonthGestureStartedBlocked,
        invalidateDetailMonthAnimation,
    ]);

    /** UI 스레드 진입 애니메이션 결과를 세대 검증 후 완료 또는 전체 복구로 연결한다. */
    const finishDetailMonthGestureLayerEnter = useCallback((
        generation: number,
        finished: boolean
    ) => {
        if (
            generation !== detailMonthAnimationGenerationRef.current
            || detailMonthAnimationPhaseRef.current !== "enter"
            || !detailMonthAnimationUsesGestureLayerRef.current
        ) return;

        if (finished) {
            completeDetailMonthAnimation(generation);
            return;
        }
        invalidateDetailMonthAnimation(true);
    }, [completeDetailMonthAnimation, invalidateDetailMonthAnimation]);

    /** 부모 커밋 ACK 뒤 남은 상호작용 예산 안에서 새 월의 진입 애니메이션을 실행한다. */
    const startDetailMonthEnterAnimation = useCallback((generation: number) => {
        if (
            generation !== detailMonthAnimationGenerationRef.current ||
            detailMonthAnimationPhaseRef.current !== "awaitingCommit"
        ) return;

        if (detailMonthCommitWatchdogRef.current !== null) {
            clearTimeout(detailMonthCommitWatchdogRef.current);
            detailMonthCommitWatchdogRef.current = null;
        }
        detailMonthAnimationPhaseRef.current = "enter";
        detailMonthAnimationFrameRef.current = requestAnimationFrame(() => {
            detailMonthAnimationFrameRef.current = null;
            if (
                generation !== detailMonthAnimationGenerationRef.current ||
                detailMonthAnimationPhaseRef.current !== "enter"
            ) return;

            const elapsedMs = Math.max(
                0,
                Date.now() - detailMonthAnimationStartedAtRef.current
            );
            const remainingBudgetMs = Math.max(
                0,
                CALENDAR_INTERACTION_BUDGET_MS - elapsedMs
                    - DETAIL_MONTH_SWIPE_MOTION.commitFrameBudgetMs / 2
            );
            const enterDurationMs = Math.min(
                detailMonthAnimationEnterDurationRef.current,
                remainingBudgetMs
            );
            if (detailMonthAnimationUsesGestureLayerRef.current) {
                detailMonthGestureTranslateX.value = 0;
                if (enterDurationMs === 0) {
                    detailMonthGestureTranslateY.value = 0;
                    detailMonthGestureOpacity.value = 1;
                    completeDetailMonthAnimation(generation);
                    return;
                }

                const enterConfig = {
                    duration: enterDurationMs,
                    easing: DETAIL_MONTH_SWIPE_REANIMATED_EASING,
                };
                detailMonthGestureOpacity.value = withTiming(1, enterConfig);
                detailMonthGestureTranslateY.value = withTiming(
                    0,
                    enterConfig,
                    (finished) => {
                        runOnJS(finishDetailMonthGestureLayerEnter)(
                            generation,
                            Boolean(finished)
                        );
                    }
                );
                return;
            }

            const detailMonthActiveTranslation =
                detailMonthAnimationAxisRef.current === "vertical"
                    ? detailMonthTranslateY
                    : detailMonthTranslateX;
            if (enterDurationMs === 0) {
                detailMonthTranslateX.setValue(0);
                detailMonthTranslateY.setValue(0);
                detailMonthOpacity.setValue(1);
                completeDetailMonthAnimation(generation);
                return;
            }

            const enterAnimation = Animated.parallel([
                Animated.timing(detailMonthActiveTranslation, {
                    toValue: 0,
                    duration: enterDurationMs,
                    easing: DETAIL_MONTH_SWIPE_EASING,
                    useNativeDriver: true,
                    isInteraction: false,
                }),
                Animated.timing(detailMonthOpacity, {
                    toValue: 1,
                    duration: enterDurationMs,
                    easing: DETAIL_MONTH_SWIPE_EASING,
                    useNativeDriver: true,
                    isInteraction: false,
                }),
            ]);
            detailMonthAnimationRef.current = enterAnimation;
            enterAnimation.start(({ finished }) => {
                if (detailMonthAnimationRef.current === enterAnimation) {
                    detailMonthAnimationRef.current = null;
                }
                if (generation !== detailMonthAnimationGenerationRef.current) return;
                if (!finished) {
                    invalidateDetailMonthAnimation(true);
                    return;
                }
                completeDetailMonthAnimation(generation);
            });
        });
    }, [
        completeDetailMonthAnimation,
        detailMonthGestureOpacity,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthOpacity,
        detailMonthTranslateX,
        detailMonthTranslateY,
        finishDetailMonthGestureLayerEnter,
        invalidateDetailMonthAnimation,
    ]);

    /** 달력의 월 변경 콜백을 전환 단계와 오늘 이동 상태에 맞춰 중복 없이 커밋한다. */
    const handleDetailMonthChange = useCallback((month: DateData) => {
        const incomingMonth = month.dateString.slice(0, 7);
        const todayTarget = todayFocusTargetRef.current;
        if (
            todayTarget?.requiresMonthChange &&
            incomingMonth === todayTarget.day.slice(0, 7)
        ) {
            // The parent has already committed the exact today key. Consume
            // react-native-calendars' month ACK so its preserved day-of-month
            // (for example Aug 29 -> Jul 29) cannot overwrite today (Jul 27).
            detailMonthSuppressedCommitRef.current = null;
            acknowledgeTodayFocusTarget(todayTarget.day);
            return;
        }
        const suppressedCommit = detailMonthSuppressedCommitRef.current;
        if (suppressedCommit) {
            detailMonthSuppressedCommitRef.current = null;
            if (incomingMonth === suppressedCommit) return;
        }
        if (detailMonthAnimationActiveRef.current) {
            const phase = detailMonthAnimationPhaseRef.current;
            const sourceMonth = detailMonthAnimationSourceDayRef.current?.slice(0, 7);
            const expectedMonth = detailMonthAnimationExpectedDayRef.current?.slice(0, 7);

            if (phase === "awaitingCommit" && incomingMonth === expectedMonth) {
                // The controlled props/layout ACK owns a pager rebase. A
                // react-native-calendars callback can arrive during the single
                // paint frame before that rebase; letting it start the legacy
                // enter animation would cancel the deferred handoff.
                if (detailMonthAnimationUsesPagerRef.current) return;
                startDetailMonthEnterAnimation(
                    detailMonthAnimationGenerationRef.current
                );
                return;
            }

            // The controlled initialDate update can emit the source month once
            // more while the target commit is pending. Neither source nor the
            // expected target should be forwarded back to the parent twice.
            if (incomingMonth === sourceMonth || incomingMonth === expectedMonth) {
                return;
            }

            invalidateDetailMonthAnimation(true);
        }

        commitDetailMonthControlledState(month.dateString);
    }, [
        acknowledgeTodayFocusTarget,
        commitDetailMonthControlledState,
        invalidateDetailMonthAnimation,
        startDetailMonthEnterAnimation,
    ]);

    /** 페이저 끝점의 목표 일자를 기록하고 제어 상태 ACK를 기다리는 단계로 전환한다. */
    const commitDetailMonthPagerSwipe = useCallback((
        generation: number,
        targetDay: string,
        emitControlledState = true
    ) => {
        const phase = detailMonthAnimationPhaseRef.current;
        if (
            generation !== detailMonthAnimationGenerationRef.current
            || (phase !== "exit" && phase !== "settling")
            || !detailMonthAnimationUsesPagerRef.current
        ) return;

        detailMonthAnimationPhaseRef.current = "awaitingCommit";
        detailMonthAnimationExpectedDayRef.current = targetDay;
        const controlledAnchor = resolveDetailMonthAnchor(
            detailMonthLatestSelectedDayRef.current,
            detailMonthLatestVisibleMonthRef.current
        );
        if (phase === "exit" || controlledAnchor !== targetDay) {
            detailMonthCommitWatchdogRef.current = setTimeout(() => {
                detailMonthCommitWatchdogRef.current = null;
                if (
                    generation !== detailMonthAnimationGenerationRef.current
                    || detailMonthAnimationPhaseRef.current !== "awaitingCommit"
                    || detailMonthAnimationExpectedDayRef.current !== targetDay
                    || !detailMonthAnimationUsesPagerRef.current
                ) return;

                // The target is already visible at the pager endpoint. A slow
                // controlled React/Fabric ACK must never reset that translation
                // onto the source month. Pin every structural slot to target
                // and let the normal ACK path perform the safe rebase.
                setDetailMonthPagerAnchorDay(targetDay);
                setDetailMonthPagerHandoffDay(targetDay);
            }, DETAIL_MONTH_SWIPE_MOTION.commitWatchdogMs);
        }
        if (emitControlledState) {
            commitDetailMonthControlledState(targetDay);
        }
    }, [commitDetailMonthControlledState]);

    /** ACK가 반영된 다음 프레임에 목표 월 앵커와 임시 핸드오프 페이지를 함께 승격한다. */
    const scheduleDetailMonthPagerHandoff = useCallback((
        generation: number,
        expectedDay: string
    ) => {
        const pendingFrame = detailMonthPagerHandoffFrameRef.current;
        if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
        if (detailMonthCommitWatchdogRef.current !== null) {
            clearTimeout(detailMonthCommitWatchdogRef.current);
            detailMonthCommitWatchdogRef.current = null;
        }

        const frame = requestAnimationFrame(() => {
            if (detailMonthPagerHandoffFrameRef.current === frame) {
                detailMonthPagerHandoffFrameRef.current = null;
            }
            if (
                generation !== detailMonthAnimationGenerationRef.current
                || detailMonthAnimationPhaseRef.current !== "awaitingCommit"
                || detailMonthAnimationExpectedDayRef.current !== expectedDay
                || !detailMonthAnimationUsesPagerRef.current
            ) return;

            // Promote the structural anchor in the same React batch that
            // mounts the target-only handoff. Doing these as two consecutive
            // layout commits makes Fabric build the calendar grid twice and
            // keeps the next gesture blocked long after the visible page has
            // reached its endpoint.
            setDetailMonthPagerAnchorDay(expectedDay);
            setDetailMonthPagerHandoffDay(expectedDay);
        });
        detailMonthPagerHandoffFrameRef.current = frame;
    }, []);

    /** 종료 애니메이션이 그려진 다음 프레임으로 실제 날짜 커밋을 지연해 프레임 경합을 줄인다. */
    const scheduleDetailMonthPagerCommit = useCallback((
        generation: number,
        targetDay: string
    ) => {
        if (
            generation !== detailMonthAnimationGenerationRef.current
            || detailMonthAnimationPhaseRef.current !== "exit"
            || !detailMonthAnimationUsesPagerRef.current
        ) return;

        detailMonthAnimationFrameRef.current = requestAnimationFrame(() => {
            detailMonthAnimationFrameRef.current = null;
            commitDetailMonthPagerSwipe(generation, targetDay);
        });
    }, [commitDetailMonthPagerSwipe]);

    return {
        invalidateDetailMonthAnimation,
        cancelDetailMonthMotion,
        resetDetailMonthGesture,
        completeDetailMonthAnimation,
        finishDetailMonthGestureLayerEnter,
        startDetailMonthEnterAnimation,
        handleDetailMonthChange,
        commitDetailMonthPagerSwipe,
        scheduleDetailMonthPagerHandoff,
        scheduleDetailMonthPagerCommit,
    };
}
