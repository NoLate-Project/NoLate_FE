import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Easing,
  PanResponder,
  Platform,
  ScrollView,
  UIManager,
  type LayoutChangeEvent,
} from "react-native";

import { getScheduleDetailSheetHeights } from "../../modules/schedule/detailPresentation";
import {
  IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
  SHEET_HANDLE_HEIGHT,
  SHEET_SNAP_VELOCITY_PROJECTION,
  clamp,
  configureParticipantDisclosureAnimation,
} from "./ScheduleDetailChrome";
import type { SheetSnapMode } from "./scheduleDetailModel";

type ScheduleDetailSheetControllerOptions = {
  windowHeight: number;
  bottomInset: number;
  previewEnabled: boolean;
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
  initialSheetMode,
  initialParticipantsExpanded,
}: ScheduleDetailSheetControllerOptions) {
  const sheetScrollRef = useRef<ScrollView>(null);
  const sheetStartOffsetRef = useRef(0);
  const sheetSnapModeRef = useRef<SheetSnapMode>(
    previewEnabled ? initialSheetMode : "compact",
  );
  const baseSheetHeights = getScheduleDetailSheetHeights(windowHeight);
  const sheetMaxHeight = baseSheetHeights.maxHeight;
  const sheetMinHeight = Math.min(
    sheetMaxHeight - 1,
    Math.max(
      baseSheetHeights.minHeight,
      IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT + bottomInset,
    ),
  );
  const sheetBottomPadding = Math.max(bottomInset, 14);
  const [expandedContentHeight, setExpandedContentHeight] = useState(0);
  const desiredExpandedHeight =
    expandedContentHeight > 0
      ? SHEET_HANDLE_HEIGHT + expandedContentHeight + sheetBottomPadding
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
    sheetMinHeight - SHEET_HANDLE_HEIGHT,
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

  const sheetQuickSummaryAnimatedStyle = useMemo(
    () => ({
      height: sheetTranslateY.interpolate({
        inputRange: [sheetExpandedOffset, sheetCollapsedOffset],
        outputRange: [0, sheetCompactContentHeight],
        extrapolate: "clamp",
      }),
      opacity: sheetTranslateY.interpolate({
        inputRange: [sheetExpandedOffset, sheetCollapsedOffset],
        outputRange: [0, 1],
        extrapolate: "clamp",
      }),
    }),
    [
      sheetCollapsedOffset,
      sheetCompactContentHeight,
      sheetExpandedOffset,
      sheetTranslateY,
    ],
  );

  useEffect(() => {
    sheetTranslateY.stopAnimation(() => {
      const nextOffset =
        sheetSnapModeRef.current === "expanded"
          ? sheetExpandedOffset
          : sheetCollapsedOffset;
      sheetTranslateY.setValue(nextOffset);
    });
  }, [sheetCollapsedOffset, sheetExpandedOffset, sheetTranslateY]);

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

  /** 지정한 모드로 시트를 스프링 이동하고 축소 시 내부 스크롤과 참여자 펼침을 초기화한다. */
  const snapSheet = useCallback(
    (nextMode: SheetSnapMode) => {
      sheetSnapModeRef.current = nextMode;
      setSheetMode(nextMode);
      if (nextMode === "compact") {
        setParticipantsExpanded(false);
        participantDisclosureProgress.setValue(0);
        sheetScrollRef.current?.scrollTo({ y: 0, animated: false });
      }
      Animated.spring(sheetTranslateY, {
        toValue:
          nextMode === "expanded" ? sheetExpandedOffset : sheetCollapsedOffset,
        damping: 26,
        stiffness: 210,
        mass: 0.92,
        restDisplacementThreshold: 0.35,
        restSpeedThreshold: 0.35,
        useNativeDriver: false,
      }).start();
    },
    [
      participantDisclosureProgress,
      sheetCollapsedOffset,
      sheetExpandedOffset,
      sheetTranslateY,
    ],
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
  }, [participantDisclosureProgress, participantsExpanded]);

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
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) > 2 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
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
          const currentOffset = clamp(
            sheetStartOffsetRef.current + gesture.dy,
            sheetExpandedOffset,
            sheetCollapsedOffset,
          );
          snapSheet(getSheetSnapMode(currentOffset, gesture.vy));
        },
        onPanResponderTerminate: (_event, gesture) => {
          const currentOffset = clamp(
            sheetStartOffsetRef.current + gesture.dy,
            sheetExpandedOffset,
            sheetCollapsedOffset,
          );
          snapSheet(getSheetSnapMode(currentOffset, gesture.vy));
        },
      }),
    [
      getSheetSnapMode,
      sheetCollapsedOffset,
      sheetExpandedOffset,
      sheetTranslateY,
      snapSheet,
    ],
  );

  return {
    handleExpandedContentLayout,
    participantDisclosureAnimatedStyle,
    participantDisclosureProgress,
    participantsExpanded,
    previewParticipantsExpanded,
    setExpandedContentHeight,
    setParticipantsExpanded,
    sheetBottomPadding,
    sheetMaxHeight,
    sheetMinHeight,
    sheetMode,
    sheetPanResponder,
    sheetQuickSummaryAnimatedStyle,
    sheetScrollRef,
    sheetTranslateY,
    snapSheet,
    toggleParticipantsExpanded,
  };
}
