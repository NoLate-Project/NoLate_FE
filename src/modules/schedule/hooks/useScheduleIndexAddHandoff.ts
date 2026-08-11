import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { Animated, Easing, unstable_batchedUpdates } from 'react-native';
import {
  ADD_HANDOFF_MOTION,
  shouldRestoreAddHandoffToolbar,
} from '../addHandoffMotion';
import type { ScheduleParseResult } from '../types';

type UseScheduleIndexAddHandoffParams = {
  addHandoffClosingRef: MutableRefObject<boolean>;
  addHandoffNativeResetRef: MutableRefObject<boolean>;
  addHandoffPendingRef: MutableRefObject<boolean>;
  addHandoffToolbarOpacity: Animated.Value;
  isFocused: boolean;
  liquidPrototypeOpen: boolean;
  modalVisible: boolean;
  quickHandoffTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  quickModalVisible: boolean;
  requestCloseLiquidPrototype: () => void;
  setFormInitialValues: Dispatch<SetStateAction<ScheduleParseResult | null>>;
  setModalVisible: Dispatch<SetStateAction<boolean>>;
  setQuickHandoffHidden: Dispatch<SetStateAction<boolean>>;
  setQuickModalVisible: Dispatch<SetStateAction<boolean>>;
  usesLiquidViewModeControl: boolean;
};

/**
 * 툴바의 일정 추가 버튼에서 빠른 추가·직접 추가 모달로 이어지는 소유권 전환을
 * 관리한다. 네이티브 액체형 메뉴와 React 모달이 동시에 보이지 않도록 투명도와
 * 닫힘 시점을 조율하고, 중단된 전환에서도 툴바 표시 상태를 복구한다.
 */
export function useScheduleIndexAddHandoff({
  addHandoffClosingRef,
  addHandoffNativeResetRef,
  addHandoffPendingRef,
  addHandoffToolbarOpacity,
  isFocused,
  liquidPrototypeOpen,
  modalVisible,
  quickHandoffTimerRef,
  quickModalVisible,
  requestCloseLiquidPrototype,
  setFormInitialValues,
  setModalVisible,
  setQuickHandoffHidden,
  setQuickModalVisible,
  usesLiquidViewModeControl,
}: UseScheduleIndexAddHandoffParams) {
  /** 보류 중인 네이티브 메뉴 초기화 타이머를 안전하게 해제한다. */
  const clearQuickHandoffTimer = useCallback(() => {
    if (quickHandoffTimerRef.current) {
      clearTimeout(quickHandoffTimerRef.current);
      quickHandoffTimerRef.current = null;
    }
  }, [quickHandoffTimerRef]);

  /** 추가 모달 전환이 끝난 뒤 툴바 투명도와 React 숨김 상태를 기본값으로 복구한다. */
  const restoreToolbarAfterHandoff = useCallback(() => {
    addHandoffToolbarOpacity.stopAnimation();
    addHandoffToolbarOpacity.setValue(1);
    setQuickHandoffHidden(false);
  }, [addHandoffToolbarOpacity, setQuickHandoffHidden]);

  /** 새 추가 동작을 시작하기 전에 이전 전환 플래그와 애니메이션 값을 초기화한다. */
  const prepareAddHandoff = useCallback(() => {
    clearQuickHandoffTimer();
    addHandoffPendingRef.current = usesLiquidViewModeControl;
    addHandoffClosingRef.current = false;
    addHandoffNativeResetRef.current = false;
    addHandoffToolbarOpacity.stopAnimation();
    addHandoffToolbarOpacity.setValue(1);
  }, [
    addHandoffClosingRef,
    addHandoffNativeResetRef,
    addHandoffPendingRef,
    addHandoffToolbarOpacity,
    clearQuickHandoffTimer,
    usesLiquidViewModeControl,
  ]);

  /**
   * 네이티브 버튼의 모핑이 준비된 순간 해당 React 모달을 표시한다.
   * 모달 가시성과 툴바 숨김 상태를 한 배치에서 확정해 중간 프레임 노출을 막는다.
   */
  const commitAddHandoffPresentation = useCallback(
    (kind: 'quick' | 'manual') => {
      if (!addHandoffPendingRef.current || addHandoffClosingRef.current) return;

      unstable_batchedUpdates(() => {
        setQuickHandoffHidden(true);
        if (kind === 'quick') {
          setQuickModalVisible(true);
        } else {
          setFormInitialValues(null);
          setModalVisible(true);
        }
      });
    },
    [
      addHandoffClosingRef,
      addHandoffPendingRef,
      setFormInitialValues,
      setModalVisible,
      setQuickHandoffHidden,
      setQuickModalVisible,
    ],
  );

  /**
   * 추가 모달의 모핑 준비 완료를 받아 툴바를 주차 투명도로 낮춘다.
   * 소유권 교차 페이드와 컴포지터 안정 시간이 지난 뒤 숨겨진 네이티브 메뉴를 닫는다.
   */
  const handleAddModalMorphReady = useCallback(() => {
    if (
      !usesLiquidViewModeControl ||
      !addHandoffPendingRef.current ||
      addHandoffClosingRef.current
    ) {
      return;
    }

    clearQuickHandoffTimer();
    addHandoffToolbarOpacity.stopAnimation();
    Animated.timing(addHandoffToolbarOpacity, {
      toValue: ADD_HANDOFF_MOTION.toolbarParkedOpacity,
      duration: ADD_HANDOFF_MOTION.ownershipCrossfadeMs,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();

    quickHandoffTimerRef.current = setTimeout(() => {
      quickHandoffTimerRef.current = null;
      if (addHandoffClosingRef.current || !addHandoffPendingRef.current) return;

      addHandoffNativeResetRef.current = true;
      requestCloseLiquidPrototype();
    }, Math.max(ADD_HANDOFF_MOTION.ownershipCrossfadeMs, ADD_HANDOFF_MOTION.quickOpenMs, ADD_HANDOFF_MOTION.manualOpenMs) + ADD_HANDOFF_MOTION.nativeResetSettleMs);
  }, [
    addHandoffClosingRef,
    addHandoffNativeResetRef,
    addHandoffPendingRef,
    addHandoffToolbarOpacity,
    clearQuickHandoffTimer,
    quickHandoffTimerRef,
    requestCloseLiquidPrototype,
    usesLiquidViewModeControl,
  ]);

  /**
   * 빠른 추가 모달 닫힘 시작 시 네이티브 메뉴를 한 번만 접고 툴바 복귀를 예약한다.
   * 네이티브 메뉴를 사용하지 않는 환경은 즉시 기본 툴바 상태로 복구한다.
   */
  const handleQuickModalCloseStart = useCallback(() => {
    addHandoffClosingRef.current = true;
    clearQuickHandoffTimer();

    if (
      usesLiquidViewModeControl &&
      addHandoffPendingRef.current &&
      !addHandoffNativeResetRef.current
    ) {
      addHandoffNativeResetRef.current = true;
      requestCloseLiquidPrototype();
    }

    if (!usesLiquidViewModeControl || !addHandoffPendingRef.current) {
      restoreToolbarAfterHandoff();
      return;
    }

    addHandoffToolbarOpacity.stopAnimation();
    addHandoffToolbarOpacity.setValue(ADD_HANDOFF_MOTION.toolbarParkedOpacity);
    Animated.timing(addHandoffToolbarOpacity, {
      toValue: 1,
      delay: ADD_HANDOFF_MOTION.toolbarReturnDelayMs,
      duration: ADD_HANDOFF_MOTION.toolbarReturnDurationMs,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [
    addHandoffClosingRef,
    addHandoffNativeResetRef,
    addHandoffPendingRef,
    addHandoffToolbarOpacity,
    clearQuickHandoffTimer,
    requestCloseLiquidPrototype,
    restoreToolbarAfterHandoff,
    usesLiquidViewModeControl,
  ]);

  /** 빠른 추가 모달이 완전히 닫히면 전환 플래그와 가시성 상태를 정리한다. */
  const handleQuickModalClosed = useCallback(() => {
    clearQuickHandoffTimer();
    addHandoffPendingRef.current = false;
    addHandoffClosingRef.current = false;
    addHandoffNativeResetRef.current = false;
    restoreToolbarAfterHandoff();
    setQuickModalVisible(false);
  }, [
    addHandoffClosingRef,
    addHandoffNativeResetRef,
    addHandoffPendingRef,
    clearQuickHandoffTimer,
    restoreToolbarAfterHandoff,
    setQuickModalVisible,
  ]);

  /** 직접 추가 모달이 완전히 닫히면 전환 플래그와 가시성 상태를 정리한다. */
  const handleScheduleModalClosed = useCallback(() => {
    clearQuickHandoffTimer();
    addHandoffPendingRef.current = false;
    addHandoffClosingRef.current = false;
    addHandoffNativeResetRef.current = false;
    restoreToolbarAfterHandoff();
    setModalVisible(false);
  }, [
    addHandoffClosingRef,
    addHandoffNativeResetRef,
    addHandoffPendingRef,
    clearQuickHandoffTimer,
    restoreToolbarAfterHandoff,
    setModalVisible,
  ]);

  useEffect(() => {
    if (
      !shouldRestoreAddHandoffToolbar({
        isFocused,
        modalVisible,
        quickModalVisible,
        handoffPending: addHandoffPendingRef.current,
        handoffClosing: addHandoffClosingRef.current,
        liquidMenuOpen: liquidPrototypeOpen,
      })
    )
      return;

    // 전환이 중단되거나 화면이 바뀌더라도 세 개의 툴바 액션이 모두 숨은 채
    // 남지 않도록 유휴 화면의 표시 불변식을 명시적으로 복구한다.
    clearQuickHandoffTimer();
    addHandoffPendingRef.current = false;
    addHandoffClosingRef.current = false;
    restoreToolbarAfterHandoff();
  }, [
    addHandoffClosingRef,
    addHandoffPendingRef,
    clearQuickHandoffTimer,
    isFocused,
    liquidPrototypeOpen,
    modalVisible,
    quickModalVisible,
    restoreToolbarAfterHandoff,
  ]);

  useEffect(
    () => () => {
      clearQuickHandoffTimer();
      addHandoffPendingRef.current = false;
      addHandoffClosingRef.current = false;
      addHandoffToolbarOpacity.stopAnimation();
      // Animated 값은 Fast Refresh 뒤에도 남을 수 있으므로 일시적인 투명도를
      // 보존하지 않고 화면 해제 시 항상 완전 표시 상태로 되돌린다.
      addHandoffToolbarOpacity.setValue(1);
    },
    [
      addHandoffClosingRef,
      addHandoffPendingRef,
      addHandoffToolbarOpacity,
      clearQuickHandoffTimer,
    ],
  );

  return {
    clearQuickHandoffTimer,
    commitAddHandoffPresentation,
    handleAddModalMorphReady,
    handleQuickModalClosed,
    handleQuickModalCloseStart,
    handleScheduleModalClosed,
    prepareAddHandoff,
  };
}
