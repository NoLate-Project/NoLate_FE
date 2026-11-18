import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Easing,
  PanResponder,
  Platform,
  ScrollView,
  UIManager,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";

import { getScheduleDetailSheetHeights } from "../../modules/schedule/detailPresentation";
import { useSystemReduceMotion } from "../../modules/performance/useSystemReduceMotion";
import { SAVED_JOURNEY_MOTION } from "../../modules/journey/savedJourneyMotion";
import {
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
  SHEET_SNAP_VELOCITY_PROJECTION,
  clamp,
  configureParticipantDisclosureAnimation,
} from "./ScheduleDetailChrome";
import type { SheetSnapMode } from "./scheduleDetailModel";

const SHEET_DRAG_SNAP_THRESHOLD = 24;

type ScheduleDetailSheetControllerOptions = {
  windowHeight: number;
  bottomInset: number;
  previewEnabled: boolean;
  guidanceNavigation?: boolean;
  inspectingCompanion?: boolean;
  initialSheetMode: SheetSnapMode;
  initialParticipantsExpanded: boolean;
};

/**
 * 일정 상세 하단 시트의 높이, 스냅 위치, 드래그 제스처와 참여자 펼침 상태를 관리한다.
 * 화면 크기가 바뀌면 현재 모드를 유지한 채 오프셋을 다시 맞추고 Android 뒤로가기는 펼친 시트를 먼저 접는다.
 */
export function useScheduleDetailSheetController({
  windowHeight,
  bottomInset,
  previewEnabled,
  guidanceNavigation = false,
  inspectingCompanion = false,
  initialSheetMode,
  initialParticipantsExpanded,
}: ScheduleDetailSheetControllerOptions) {
  const sheetScrollRef = useRef<ScrollView>(null);
  const reduceMotion = useSystemReduceMotion();
  const sheetStartOffsetRef = useRef(0);
  const sheetDragging = useRef(false);
  const activeSnap = useRef<{ target: number; reason?: 'live-activity' }>(undefined);
  const sheetSnapModeRef = useRef<SheetSnapMode>(
    previewEnabled ? initialSheetMode : "compact",
  );
  const baseSheetHeights = getScheduleDetailSheetHeights(windowHeight);
  const { fontScale } = useWindowDimensions();
  const [routeHeaderLayout, setRouteHeaderLayout] = useState({ height: 0, statusClearance: 0 });
  const routeHeaderHeight = routeHeaderLayout.height + routeHeaderLayout.statusClearance;
  const setRouteHeaderHeight = useCallback((height: number, statusClearance: number) => {
    setRouteHeaderLayout(previous => previous.height === height && previous.statusClearance === statusClearance
      ? previous
      : { height, statusClearance });
  }, []);
  const largeRouteHeader = fontScale > 1.35;
  const sheetMaxHeight = routeHeaderHeight > 0
    ? Math.min(baseSheetHeights.maxHeight, Math.max(160, windowHeight - routeHeaderHeight - 32))
    : baseSheetHeights.maxHeight;
  const handleHeight = SHEET_HANDLE_HEIGHT;
  const [sheetHeaderHeight, setSheetHeaderHeight] = useState(handleHeight);
  const handleSheetHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    setSheetHeaderHeight(Math.ceil(event.nativeEvent.layout.height));
  }, []);
  // Keep the compact route summary below the companion heading and above the safe area.
  const companionHeaderHeight = inspectingCompanion && !largeRouteHeader
    ? Math.max(0, sheetHeaderHeight - handleHeight)
    : 0;
  const [compactSummaryHeight, setCompactSummaryHeight] = useState(0);
  const handleCompactContentSizeChange = useCallback((_width: number, height: number) => {
    const measuredHeight = Math.ceil(height);
    setCompactSummaryHeight(current => Math.abs(current - measuredHeight) > 1 ? measuredHeight : current);
  }, []);
  const compactMinimumHeight = Math.max(
    baseSheetHeights.minHeight,
    Math.ceil(IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT * Math.max(1, fontScale)) + bottomInset,
  ) + companionHeaderHeight;
  const fittedCompactHeight = largeRouteHeader || compactSummaryHeight === 0
    ? compactMinimumHeight
    : Math.max(compactMinimumHeight, Math.min(
        baseSheetHeights.midHeight,
        sheetHeaderHeight + compactSummaryHeight + bottomInset,
      ));
  const sheetMinHeight = Math.min(
    sheetMaxHeight - (largeRouteHeader ? Math.min(80, Math.round(sheetMaxHeight * 0.22)) : 1),
    fittedCompactHeight,
  );
  const sheetBottomPadding = Math.max(bottomInset, 14);
  const [expandedContentHeight, setExpandedContentHeight] = useState(0);
  const desiredExpandedHeight =
    expandedContentHeight > 0
      ? sheetHeaderHeight + expandedContentHeight + sheetBottomPadding
      : sheetMaxHeight;
  const expandedVisibleHeight = clamp(
    desiredExpandedHeight,
    Math.min(sheetMaxHeight, sheetMinHeight + 1),
    sheetMaxHeight,
  );
  const sheetCollapsedOffset = sheetMaxHeight - sheetMinHeight;
  const sheetExpandedOffset = Math.min(
    sheetMaxHeight - expandedVisibleHeight,
    Math.max(0, sheetCollapsedOffset - 1),
  );
  const sheetCompactContentHeight = Math.max(
    92,
    sheetMinHeight - sheetHeaderHeight,
  );
  const sheetTranslateY = useRef(
    new Animated.Value(
      previewEnabled && initialSheetMode === "expanded"
        ? sheetExpandedOffset
        : sheetCollapsedOffset,
    ),
  ).current;
  const [sheetMode, setSheetMode] = useState<SheetSnapMode>(
    previewEnabled ? initialSheetMode : "compact",
  );
  const previewParticipantsExpanded = Boolean(
    previewEnabled && initialParticipantsExpanded,
  );
  const [participantsExpanded, setParticipantsExpanded] = useState(
    previewParticipantsExpanded,
  );
  const participantDisclosureProgress = useRef(
    new Animated.Value(previewParticipantsExpanded ? 1 : 0),
  ).current;

  useEffect(() => {
    if (
      Platform.OS === "android" &&
      UIManager.setLayoutAnimationEnabledExperimental
    ) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  const sheetContentStyles = useMemo(() => {
    const travel = sheetCollapsedOffset - sheetExpandedOffset;
    const handoffOffset = sheetCollapsedOffset - travel * 0.26;
    const detailFadeEnd = sheetCollapsedOffset - travel * 0.60;
    const quickSummary = {
      height: sheetCompactContentHeight,
      opacity: sheetTranslateY.interpolate({
        inputRange: [handoffOffset, sheetCollapsedOffset],
        outputRange: [0, 1],
        extrapolate: "clamp",
      }),
    };
    const detailProgress = sheetTranslateY.interpolate({
      inputRange: [detailFadeEnd, handoffOffset],
      outputRange: [1, 0],
      extrapolate: "clamp",
    });
    const expanded = {
      opacity: detailProgress,
      ...(reduceMotion ? {} : {
        transform: [{
          translateY: detailProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [8, 0],
          }),
        }],
      }),
    };
    const handle = reduceMotion ? undefined : {
      transform: [{
        rotate: sheetTranslateY.interpolate({
          inputRange: [sheetExpandedOffset, sheetCollapsedOffset],
          outputRange: ["180deg", "0deg"],
          extrapolate: "clamp",
        }),
      }],
    };
    return { quickSummary, expanded, handle };
  },
    [
      reduceMotion,
      sheetCollapsedOffset,
      sheetCompactContentHeight,
      sheetExpandedOffset,
      sheetTranslateY,
    ],
  );

  /** 드래그 종료 위치와 속도를 투영해 가장 가까운 시트 스냅 모드를 결정한다. */
  const getSheetSnapMode = useCallback(
    (current: number, velocityY: number): SheetSnapMode => {
      const projectedOffset = clamp(
        current + velocityY * SHEET_SNAP_VELOCITY_PROJECTION,
        sheetExpandedOffset,
        sheetCollapsedOffset,
      );
      return Math.abs(projectedOffset - sheetExpandedOffset) <
        Math.abs(projectedOffset - sheetCollapsedOffset)
        ? "expanded"
        : "compact";
    },
    [sheetCollapsedOffset, sheetExpandedOffset],
  );

  const animateSheetSnap = useCallback(
    (nextMode: SheetSnapMode, toValue: number, reason?: "live-activity") => {
      if (reduceMotion) {
        activeSnap.current = undefined;
        sheetTranslateY.setValue(toValue);
        return;
      }
      const snap = { target: toValue, reason };
      activeSnap.current = snap;
      const expandingGuidance = guidanceNavigation && !largeRouteHeader && nextMode === "expanded";
      const animation = reason === "live-activity" || expandingGuidance || previewEnabled
        ? Animated.timing(sheetTranslateY, {
          toValue,
          duration: reason === "live-activity" ? SAVED_JOURNEY_MOTION.activityHandoffMs
            : expandingGuidance ? SAVED_JOURNEY_MOTION.expandMs : nextMode === "expanded" ? 300 : 240,
          easing: expandingGuidance && !reason
            ? Easing.bezier(...SAVED_JOURNEY_MOTION.routeCurve) : Easing.out(Easing.cubic),
          useNativeDriver: false,
        })
        : Animated.spring(sheetTranslateY, {
          toValue,
          damping: 26,
          stiffness: 210,
          mass: 0.92,
          restDisplacementThreshold: 0.35,
          restSpeedThreshold: 0.35,
          useNativeDriver: false,
        });
      animation.start(() => {
        if (activeSnap.current === snap) activeSnap.current = undefined;
      });
    },
    [previewEnabled, guidanceNavigation, largeRouteHeader, reduceMotion, sheetTranslateY],
  );

  useEffect(() => {
    if (sheetDragging.current) return;
    const mode = sheetSnapModeRef.current;
    const target = mode === "expanded" ? sheetExpandedOffset : sheetCollapsedOffset;
    const snap = activeSnap.current;
    if (snap && !reduceMotion) {
      // The departure header changes height during expansion. Keep moving from
      // the current position if measurement changes the endpoint.
      if (snap.target !== target) animateSheetSnap(mode, target, snap.reason);
      return;
    }
    activeSnap.current = undefined;
    sheetTranslateY.setValue(target);
  }, [animateSheetSnap, reduceMotion, sheetCollapsedOffset, sheetExpandedOffset, sheetTranslateY]);

  /** 요약과 상세의 위치만 바꿔 상세 스크롤과 펼침 상태를 유지한다. */
  const snapSheet = useCallback(
    (nextMode: SheetSnapMode, reason?: "live-activity") => {
      sheetDragging.current = false;
      sheetSnapModeRef.current = nextMode;
      setSheetMode(nextMode);
      animateSheetSnap(nextMode, nextMode === "expanded" ? sheetExpandedOffset : sheetCollapsedOffset, reason);
    },
    [animateSheetSnap, sheetCollapsedOffset, sheetExpandedOffset],
  );

  const participantDisclosureAnimatedStyle = useMemo(
    () => ({
      transform: [
        {
          rotate: participantDisclosureProgress.interpolate({
            inputRange: [0, 1],
            outputRange: ["0deg", "180deg"],
          }),
        },
      ],
    }),
    [participantDisclosureProgress],
  );

  /** 참여자 목록의 펼침 상태와 화살표 회전을 같은 타이밍으로 전환한다. */
  const toggleParticipantsExpanded = useCallback(() => {
    const nextExpanded = !participantsExpanded;
    if (reduceMotion) {
      participantDisclosureProgress.setValue(nextExpanded ? 1 : 0);
      setParticipantsExpanded(nextExpanded);
      return;
    }
    configureParticipantDisclosureAnimation(nextExpanded);
    participantDisclosureProgress.stopAnimation();
    Animated.timing(participantDisclosureProgress, {
      toValue: nextExpanded ? 1 : 0,
      duration: nextExpanded ? 200 : 170,
      easing: nextExpanded
        ? Easing.out(Easing.cubic)
        : Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
    setParticipantsExpanded(nextExpanded);
  }, [participantDisclosureProgress, participantsExpanded, reduceMotion]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (sheetSnapModeRef.current !== "expanded") return false;
        snapSheet("compact");
        return true;
      },
    );
    return () => subscription.remove();
  }, [snapSheet]);

  /** 펼친 시트의 실제 콘텐츠 높이를 반올림해 저장하고 미세한 레이아웃 흔들림은 무시한다. */
  const handleExpandedContentLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const nextHeight = Math.ceil(event.nativeEvent.layout.height);
      setExpandedContentHeight(current =>
        Math.abs(current - nextHeight) > 1 ? nextHeight : current,
      );
    },
    [],
  );

  const sheetPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) > 2 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          sheetDragging.current = true;
          activeSnap.current = undefined;
          sheetTranslateY.stopAnimation(current => {
            sheetStartOffsetRef.current = current;
          });
        },
        onPanResponderMove: (_event, gesture) => {
          sheetTranslateY.setValue(
            clamp(
              sheetStartOffsetRef.current + gesture.dy,
              sheetExpandedOffset,
              sheetCollapsedOffset,
            ),
          );
        },
        onPanResponderRelease: (_event, gesture) => {
          if (Math.abs(gesture.dy) < SHEET_DRAG_SNAP_THRESHOLD) {
            snapSheet(sheetSnapModeRef.current);
            return;
          }
          if (previewEnabled) {
            const nextMode = gesture.dy <= -36 ? "expanded"
              : gesture.dy >= 36 ? "compact" : sheetSnapModeRef.current;
            snapSheet(nextMode);
            return;
          }
          const currentOffset = clamp(
            sheetStartOffsetRef.current + gesture.dy,
            sheetExpandedOffset,
            sheetCollapsedOffset,
          );
          snapSheet(getSheetSnapMode(currentOffset, gesture.vy));
        },
        onPanResponderTerminate: () => snapSheet(sheetSnapModeRef.current),
      }),
    [
      getSheetSnapMode,
      previewEnabled,
      sheetCollapsedOffset,
      sheetExpandedOffset,
      sheetTranslateY,
      snapSheet,
    ],
  );

  return {
    compactSummaryScrollable: !largeRouteHeader && compactSummaryHeight > sheetCompactContentHeight,
    handleCompactContentSizeChange,
    handleExpandedContentLayout,
    handleSheetHeaderLayout,
    largeRouteHeader,
    participantDisclosureAnimatedStyle,
    participantDisclosureProgress,
    participantsExpanded,
    previewParticipantsExpanded,
    reduceMotion,
    routeMapHeaderHeight: routeHeaderLayout.height,
    setExpandedContentHeight,
    setParticipantsExpanded,
    setRouteHeaderHeight,
    sheetBottomPadding,
    sheetMaxHeight,
    sheetMinHeight,
    sheetMode,
    sheetPanResponder,
    sheetQuickSummaryAnimatedStyle: sheetContentStyles.quickSummary,
    sheetExpandedContentAnimatedStyle: sheetContentStyles.expanded,
    sheetHandleAnimatedStyle: sheetContentStyles.handle,
    sheetScrollRef,
    sheetTranslateY,
    snapSheet,
    toggleParticipantsExpanded,
  };
}
