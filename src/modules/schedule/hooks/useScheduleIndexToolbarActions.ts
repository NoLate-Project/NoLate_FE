import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import {
  Alert,
  Animated,
  Easing,
  Keyboard,
  Platform,
  type TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';

import { parseScheduleText } from '../../../api/schedule';
import type { ScheduleCalendar } from '../../../api/scheduleCalendars';
import {
  hasCalendarScheduleMonthCache,
  readCalendarScheduleCache,
} from '../calendarScheduleCache';
import { getScheduleTargetCalendarId, type CalendarScope } from '../calendarScope';
import type { QuickScheduleMorphPresenter } from '../components/form/QuickScheduleModal';
import type { ScheduleAddMorphPresenter } from '../components/form/ScheduleAddModal';
import { createScheduleForAddItem } from '../scheduleCreateMutation';
import { useScheduleStore } from '../store';
import type { ScheduleItem, ScheduleParseResult } from '../types';
import {
  resolveQuickScheduleParseInput,
  type QuickScheduleMediaInput,
} from '../quickInputExtraction';

const SEARCH_TOOLBAR_OPEN_DURATION_MS = 120;

export type ToolbarMenu = 'view' | 'search' | 'add';
export type AddItemOptions = {
  showErrorAlert?: boolean;
};

type SetValue<T> = Dispatch<SetStateAction<T>>;

type Options = {
  activeCalendarScope: CalendarScope;
  activeToolbarMenu: ToolbarMenu | null;
  applyScheduleItemsToStore: (items: ScheduleItem[]) => void;
  commitAddHandoffPresentation: (kind: 'manual' | 'quick') => void;
  dispatch: ReturnType<typeof useScheduleStore>['dispatch'];
  fetchVisibleMonth: string;
  getErrorMessage: (error: unknown) => string;
  isSearchToolbarOpen: boolean;
  loadSchedules: () => void;
  manualMorphPresenterRef: MutableRefObject<ScheduleAddMorphPresenter | null>;
  nativeSearchGenerationRef: MutableRefObject<number>;
  nativeSearchSessionRef: MutableRefObject<string | null>;
  pendingScheduleSnapshotRef: MutableRefObject<{
    requestSequence: number;
    items: ScheduleItem[];
  } | null>;
  prepareAddHandoff: () => void;
  quickMorphPresenterRef: MutableRefObject<QuickScheduleMorphPresenter | null>;
  requestCloseLiquidPrototype: () => void;
  requireActiveCalendarWriteAccess: () => boolean;
  router: ReturnType<typeof useRouter>;
  scheduleCalendars: ScheduleCalendar[];
  scheduleFetchEndAt: string;
  scheduleFetchStartAt: string;
  scheduleLoadSequenceRef: MutableRefObject<number>;
  searchInputRef: MutableRefObject<TextInput | null>;
  searchToolbarProgress: Animated.Value;
  setActiveToolbarMenu: SetValue<ToolbarMenu | null>;
  setFormInitialValues: SetValue<ScheduleParseResult | null>;
  setLiquidPrototypeOpen: SetValue<boolean>;
  setModalVisible: SetValue<boolean>;
  setQuickHandoffHidden: SetValue<boolean>;
  setQuickModalVisible: SetValue<boolean>;
  setSearchQuery: SetValue<string>;
  setToolbarMenuClosing: SetValue<boolean>;
  todayKey: string;
  toolbarDropdownProgress: Animated.Value;
  usesLiquidViewModeControl: boolean;
};

/**
 * 일정 생성과 상단 도구 메뉴·검색창·빠른 일정 진입 동작을 관리한다.
 * 네이티브 liquid control과 JS 애니메이션의 닫힘 순서를 통일해 모달 전환 중 입력 충돌을 막는다.
 */
export function useScheduleIndexToolbarActions({
  activeCalendarScope,
  activeToolbarMenu,
  applyScheduleItemsToStore,
  commitAddHandoffPresentation,
  dispatch,
  fetchVisibleMonth,
  getErrorMessage,
  isSearchToolbarOpen,
  loadSchedules,
  manualMorphPresenterRef,
  nativeSearchGenerationRef,
  nativeSearchSessionRef,
  pendingScheduleSnapshotRef,
  prepareAddHandoff,
  quickMorphPresenterRef,
  requestCloseLiquidPrototype,
  requireActiveCalendarWriteAccess,
  router,
  scheduleCalendars,
  scheduleFetchEndAt,
  scheduleFetchStartAt,
  scheduleLoadSequenceRef,
  searchInputRef,
  searchToolbarProgress,
  setActiveToolbarMenu,
  setFormInitialValues,
  setLiquidPrototypeOpen,
  setModalVisible,
  setQuickHandoffHidden,
  setQuickModalVisible,
  setSearchQuery,
  setToolbarMenuClosing,
  todayKey,
  toolbarDropdownProgress,
  usesLiquidViewModeControl,
}: Options) {
  // 새 일정 payload를 백엔드에 저장한 뒤 응답 값을 일정 저장소에 추가한다.
  const addItem = async (
    payload: Omit<ScheduleItem, 'id'>,
    { showErrorAlert = true }: AddItemOptions = {},
  ) => {
    // Fence an already-running range GET before the POST can advance the
    // cache revision. Otherwise that GET can complete during alarm
    // recovery and publish an empty pre-mutation snapshot.
    const scheduleSequenceBeforeMutation = scheduleLoadSequenceRef.current;
    const mutationFenceSequence = scheduleSequenceBeforeMutation + 1;
    scheduleLoadSequenceRef.current = mutationFenceSequence;
    pendingScheduleSnapshotRef.current = null;
    try {
      const item = await createScheduleForAddItem({
        ...payload,
        calendarId: getScheduleTargetCalendarId(activeCalendarScope),
      });
      dispatch({ type: 'ADD_ITEM', item });
      dispatch({ type: 'SET_LOADING', loading: false });
      // Existing month entries were updated optimistically by the API
      // layer, so this usually hydrates from memory without a request.
      // An uncached month performs the one authoritative fetch needed to
      // restore the rest of that month's schedules.
      loadSchedules();
    } catch (error) {
      const message = getErrorMessage(error);
      dispatch({ type: 'SET_LOADING', loading: false });
      // If no newer range owns the screen, let the request that was in
      // flight before the POST publish when it eventually completes.
      if (scheduleLoadSequenceRef.current === mutationFenceSequence) {
        scheduleLoadSequenceRef.current = scheduleSequenceBeforeMutation;
      }
      // A failed POST must not add a calendar GET while the server is
      // already unhealthy. Reuse only a snapshot that an earlier range
      // request managed to cache in the meantime.
      if (hasCalendarScheduleMonthCache(fetchVisibleMonth)) {
        applyScheduleItemsToStore(
          readCalendarScheduleCache(scheduleFetchStartAt, scheduleFetchEndAt)
            .items,
        );
      }
      if (showErrorAlert) {
        Alert.alert('일정 등록 실패', message);
      }
      throw error;
    }
  };

  /** 열린 툴바 메뉴를 플랫폼별 애니메이션으로 닫고 완료 뒤 선택적 후속 작업을 실행한다. */
  const closeToolbarMenu = useCallback(
    (afterClose?: () => void) => {
      if (activeToolbarMenu === 'search' && usesLiquidViewModeControl) {
        setSearchQuery('');
        setToolbarMenuClosing(true);
        requestCloseLiquidPrototype();
        afterClose?.();
        return;
      }

      Keyboard.dismiss();
      requestCloseLiquidPrototype();

      if (!activeToolbarMenu) {
        afterClose?.();
        return;
      }

      setToolbarMenuClosing(true);
      const closingMenu = activeToolbarMenu;
      const closingProgress =
        closingMenu === 'search'
          ? searchToolbarProgress
          : toolbarDropdownProgress;

      closingProgress.stopAnimation();
      Animated.timing(closingProgress, {
        toValue: 0,
        duration: closingMenu === 'search' ? 95 : 153,
        easing:
          closingMenu === 'search'
            ? Easing.out(Easing.cubic)
            : Easing.inOut(Easing.cubic),
        useNativeDriver: closingMenu !== 'search',
      }).start(({ finished }) => {
        if (!finished) return;

        setActiveToolbarMenu(null);
        setToolbarMenuClosing(false);
        afterClose?.();
      });
    },
    [
      activeToolbarMenu,
      requestCloseLiquidPrototype,
      searchToolbarProgress,
      setActiveToolbarMenu,
      setSearchQuery,
      setToolbarMenuClosing,
      toolbarDropdownProgress,
      usesLiquidViewModeControl,
    ],
  );

  /** 드롭다운 닫힘을 먼저 확정한 다음 전달받은 툴바 작업을 다음 프레임에 실행한다. */
  const runToolbarAction = useCallback(
    (action: () => void) => {
      if (activeToolbarMenu === 'search' && usesLiquidViewModeControl) {
        requestCloseLiquidPrototype();
        setActiveToolbarMenu(null);
        setToolbarMenuClosing(false);
        requestAnimationFrame(action);
        return;
      }

      Keyboard.dismiss();
      setToolbarMenuClosing(true);
      toolbarDropdownProgress.stopAnimation();
      Animated.timing(toolbarDropdownProgress, {
        toValue: 0,
        duration: 108,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        setActiveToolbarMenu(null);
        setToolbarMenuClosing(false);
        requestAnimationFrame(action);
      });
    },
    [
      activeToolbarMenu,
      requestCloseLiquidPrototype,
      setActiveToolbarMenu,
      setToolbarMenuClosing,
      toolbarDropdownProgress,
      usesLiquidViewModeControl,
    ],
  );

  /** 기존 메뉴를 정리하고 검색 또는 일반 드롭다운에 맞는 진입 애니메이션을 시작한다. */
  const openToolbarMenu = useCallback(
    (menu: ToolbarMenu) => {
      if (activeToolbarMenu === menu) {
        closeToolbarMenu();
        return;
      }

      Keyboard.dismiss();
      setToolbarMenuClosing(false);
      toolbarDropdownProgress.stopAnimation();
      searchToolbarProgress.stopAnimation();
      toolbarDropdownProgress.setValue(0);
      searchToolbarProgress.setValue(0);
      setActiveToolbarMenu(menu);

      requestAnimationFrame(() => {
        if (menu === 'search') {
          Animated.timing(searchToolbarProgress, {
            toValue: 1,
            duration: SEARCH_TOOLBAR_OPEN_DURATION_MS,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: false,
          }).start();
          return;
        }

        Animated.spring(toolbarDropdownProgress, {
          toValue: 1,
          speed: 24.2,
          bounciness: 7,
          useNativeDriver: true,
        }).start();
      });
    },
    [
      activeToolbarMenu,
      closeToolbarMenu,
      searchToolbarProgress,
      setActiveToolbarMenu,
      setToolbarMenuClosing,
      toolbarDropdownProgress,
    ],
  );

  /** 네이티브 검색 세대를 동기화하고 검색어를 초기화한 뒤 검색 메뉴를 연다. */
  const openSearchToolbar = useCallback(
    (nativeContext?: { generation: number; session: string }) => {
      if (nativeContext) {
        if (
          nativeContext.session &&
          nativeSearchSessionRef.current !== nativeContext.session
        ) {
          nativeSearchSessionRef.current = nativeContext.session;
          nativeSearchGenerationRef.current = nativeContext.generation;
        } else {
          nativeSearchGenerationRef.current = Math.max(
            nativeSearchGenerationRef.current,
            nativeContext.generation,
          );
        }
      }
      setSearchQuery('');
      if (usesLiquidViewModeControl) {
        setToolbarMenuClosing(false);
        setActiveToolbarMenu('search');
        return;
      }
      openToolbarMenu('search');
    },
    [
      nativeSearchGenerationRef,
      nativeSearchSessionRef,
      openToolbarMenu,
      setActiveToolbarMenu,
      setSearchQuery,
      setToolbarMenuClosing,
      usesLiquidViewModeControl,
    ],
  );

  /** 플랫폼이 닫힘 모핑을 소유하지 않을 때 검색어를 비우고 검색 툴바를 닫는다. */
  const closeSearchToolbar = useCallback(() => {
    if (usesLiquidViewModeControl) {
      // Swift owns the reverse morph. Do not enqueue calendar state work
      // ahead of its close-complete event; that previously stalled the
      // next search tap for more than a second under repeated input.
      return;
    }
    setSearchQuery('');
    closeToolbarMenu();
  }, [closeToolbarMenu, setSearchQuery, usesLiquidViewModeControl]);

  /** 네이티브 liquid 메뉴의 세대·세션을 검증한 뒤 JS 메뉴 상태와 검색어를 동기화한다. */
  const handleLiquidPrototypeOpenChange = useCallback(
    (
      open: boolean,
      context: {
        search: boolean;
        generation: number;
        session: string;
      },
    ) => {
      if (context.search && context.session) {
        const currentSession = nativeSearchSessionRef.current;
        if (currentSession && currentSession !== context.session) {
          return;
        }
        if (!currentSession) {
          nativeSearchGenerationRef.current = context.generation;
          nativeSearchSessionRef.current = context.session;
        }
      }

      if (
        !open &&
        context.search &&
        context.generation < nativeSearchGenerationRef.current
      ) {
        return;
      }

      setLiquidPrototypeOpen(open);
      if (open) return;

      setSearchQuery('');
      setToolbarMenuClosing(false);
      setActiveToolbarMenu(currentMenu =>
        currentMenu === 'search' ? null : currentMenu,
      );
    },
    [
      nativeSearchGenerationRef,
      nativeSearchSessionRef,
      setActiveToolbarMenu,
      setLiquidPrototypeOpen,
      setSearchQuery,
      setToolbarMenuClosing,
    ],
  );

  useEffect(() => {
    if (!isSearchToolbarOpen || usesLiquidViewModeControl) return;

    const focusFrame = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });

    return () => cancelAnimationFrame(focusFrame);
  }, [isSearchToolbarOpen, searchInputRef, usesLiquidViewModeControl]);

  /** 쓰기 권한을 확인하고 사전 준비된 직접 추가 모달 또는 JS 폴백을 표시한다. */
  const openBlankSchedule = useCallback(() => {
    if (!requireActiveCalendarWriteAccess()) return;
    prepareAddHandoff();
    if (usesLiquidViewModeControl) {
      const startedPrewarmedMorph =
        manualMorphPresenterRef.current?.() ?? false;
      if (startedPrewarmedMorph) {
        commitAddHandoffPresentation('manual');
        return;
      }

      setQuickHandoffHidden(true);
      setFormInitialValues(null);
      setModalVisible(true);
      return;
    }

    runToolbarAction(() => {
      setFormInitialValues(null);
      setModalVisible(true);
    });
  }, [
    commitAddHandoffPresentation,
    manualMorphPresenterRef,
    prepareAddHandoff,
    requireActiveCalendarWriteAccess,
    runToolbarAction,
    setFormInitialValues,
    setModalVisible,
    setQuickHandoffHidden,
    usesLiquidViewModeControl,
  ]);

  /** 쓰기 권한을 확인하고 사전 준비된 빠른 추가 모달 또는 JS 폴백을 표시한다. */
  const openQuickSchedule = useCallback(() => {
    if (!requireActiveCalendarWriteAccess()) return;
    prepareAddHandoff();
    if (usesLiquidViewModeControl) {
      const startedPrewarmedMorph = quickMorphPresenterRef.current?.() ?? false;
      if (startedPrewarmedMorph) {
        commitAddHandoffPresentation('quick');
        return;
      }

      setQuickHandoffHidden(true);
      setQuickModalVisible(true);
      return;
    }

    runToolbarAction(() => {
      setQuickModalVisible(true);
    });
  }, [
    commitAddHandoffPresentation,
    prepareAddHandoff,
    quickMorphPresenterRef,
    requireActiveCalendarWriteAccess,
    runToolbarAction,
    setQuickHandoffHidden,
    setQuickModalVisible,
    usesLiquidViewModeControl,
  ]);

  /** 활성 캘린더 정보를 라우트 파라미터로 전달해 카테고리 관리 화면을 연다. */
  const openCategoryManager = () => {
    runToolbarAction(() => {
      const calendar =
        typeof activeCalendarScope === 'number'
          ? scheduleCalendars.find(item => item.id === activeCalendarScope)
          : null;
      router.push(
        calendar
          ? {
              pathname: '/schedule/categories',
              params: {
                calendarId: String(calendar.id),
                calendarTitle: calendar.title,
              },
            }
          : '/schedule/categories',
      );
    });
  };

  /** 현재 툴바를 닫은 뒤 공유 캘린더 관리 화면으로 이동한다. */
  const openSharedCalendarManager = () => {
    runToolbarAction(() => {
      router.push('/schedule/calendars');
    });
  };

  /** 검색 UI를 닫고 선택한 일정 상세 화면으로 이동한다. */
  const openScheduleFromSearch = (id: string) => {
    setSearchQuery('');
    runToolbarAction(() => {
      router.push({
        pathname: '/schedule/[id]',
        params: { id },
      });
    });
  };

  /** 자연어·음성·사진 입력을 분석해 빠른 일정 초안을 만들고 모달의 분석 상태를 관리한다. */
  const handleQuickAnalyze = async (
    text: string,
    media?: QuickScheduleMediaInput,
  ) => {
    // 사진/음성은 서버로 파일을 보내지 않는다. iOS 네이티브에서 텍스트를 먼저 추출하고,
    // 기존 빠른일정 파서가 이해하는 텍스트와 인식 신뢰도·음성 후보만 백엔드에 전달한다.
    const parseInput = await resolveQuickScheduleParseInput(text, media);

    return parseScheduleText({
      text: parseInput.text,
      inputType: parseInput.inputType,
      recognitionConfidence: parseInput.recognitionConfidence,
      recognitionAlternatives: parseInput.recognitionAlternatives,
      // `referenceDate`는 "오늘", "내일" 같은 상대 날짜 표현의 기준이다.
      // 캘린더에서 보고 있는 날짜는 다른 달일 수 있으므로, 빠른 자연어 입력은
      // 앱이 주기적으로 갱신하는 실제 오늘 날짜를 기준으로 분석한다.
      referenceDate: todayKey,
      defaultDurationMinutes: 60,
      clientPlatform:
        Platform.OS === 'android'
          ? 'ANDROID'
          : Platform.OS === 'ios'
          ? 'IOS'
          : 'UNKNOWN',
    });
  };


  return {
    addItem,
    closeSearchToolbar,
    closeToolbarMenu,
    handleLiquidPrototypeOpenChange,
    handleQuickAnalyze,
    openBlankSchedule,
    openCategoryManager,
    openQuickSchedule,
    openScheduleFromSearch,
    openSearchToolbar,
    openSharedCalendarManager,
    openToolbarMenu,
    runToolbarAction,
  };
}
