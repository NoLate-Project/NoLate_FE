import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import {
  updateScheduleCalendar,
  type ScheduleCalendar,
} from '../../../api/scheduleCalendars';
import { buildRouteSetupEntryRoute } from '../routeSetupNavigation';
import type { ScheduleItem } from '../types';
import { useImmediateNavigationTransition } from '../../performance/ImmediateNavigationTransition';

type UseScheduleIndexCalendarActionsParams = {
  isFocused: boolean;
  calendarScopeSelectorVisible: boolean;
  calendarShareTarget: ScheduleCalendar | null;
  closeToolbarMenu: (onClosed?: () => void) => void;
  firstDayStorageKey: string;
  routeSetupItems: ScheduleItem[];
  setCalendarScopeSelectorVisible: Dispatch<SetStateAction<boolean>>;
  setCalendarShareTarget: Dispatch<SetStateAction<ScheduleCalendar | null>>;
  setFirstDay: Dispatch<SetStateAction<0 | 1>>;
  setScheduleCalendars: Dispatch<SetStateAction<ScheduleCalendar[]>>;
};

/**
 * 캘린더 선택기에서 실행되는 설정·공유·경로 설정 이동 동작을 제공한다.
 * 선택기 닫힘 시점과 iOS/Android 모달 표시 차이를 흡수해 화면 컴포넌트가
 * 플랫폼별 타이밍을 직접 다루지 않도록 한다.
 */
export function useScheduleIndexCalendarActions({
  isFocused,
  calendarScopeSelectorVisible,
  calendarShareTarget,
  closeToolbarMenu,
  firstDayStorageKey,
  routeSetupItems,
  setCalendarScopeSelectorVisible,
  setCalendarShareTarget,
  setFirstDay,
  setScheduleCalendars,
}: UseScheduleIndexCalendarActionsParams) {
  const router = useRouter();
  const { runWithTransitionShell } = useImmediateNavigationTransition();

  /** 프로필과 사용자 설정 화면으로 이동한다. */
  const openAccountSettings = useCallback(() => {
    runWithTransitionShell(
      {
        route: '/profile',
        title: '프로필',
        backAccessibilityLabel: '일정 목록으로 돌아가기',
      },
      () => router.push('/profile'),
    );
  }, [router, runWithTransitionShell]);

  /** 현재 툴바 메뉴가 닫힌 뒤 캘린더 범위 선택기를 표시한다. */
  const openCalendarScopeSelector = useCallback(() => {
    closeToolbarMenu(() => setCalendarScopeSelectorVisible(true));
  }, [closeToolbarMenu, setCalendarScopeSelectorVisible]);

  const managePending = useRef(false);
  const managerOpened = useRef(false);
  const [returningFromManager, setReturningFromManager] = useState(false);

  const openCalendarManagerAfterDismiss = useCallback(() => {
    if (!managePending.current) return;
    managePending.current = false;
    router.push({ pathname: '/schedule/calendars', params: { from: 'calendar-scope' } });
  }, [router]);

  const openCalendarManagerFromSelector = useCallback(() => {
    managePending.current = true;
    setReturningFromManager(true);
    setCalendarScopeSelectorVisible(false);
  }, [setCalendarScopeSelectorVisible]);

  useEffect(() => {
    if (Platform.OS === 'ios' || calendarScopeSelectorVisible || !returningFromManager) return;
    const task = setTimeout(openCalendarManagerAfterDismiss, 360);
    return () => clearTimeout(task);
  }, [calendarScopeSelectorVisible, openCalendarManagerAfterDismiss, returningFromManager]);

  useEffect(() => {
    if (!returningFromManager) return;
    if (!isFocused) {
      managerOpened.current = true;
    } else if (managerOpened.current) {
      managerOpened.current = false;
      setCalendarScopeSelectorVisible(true);
      setReturningFromManager(false);
    }
  }, [isFocused, returningFromManager, setCalendarScopeSelectorVisible]);

  /** 공유 캘린더의 기본 공개 범위를 서버와 로컬 목록에 동시에 반영한다. */
  const updateSharedCalendarContentMode = useCallback(
    async (nextMode: ScheduleCalendar['defaultContentMode']) => {
      if (!calendarShareTarget) return;
      const updated = await updateScheduleCalendar(calendarShareTarget.id, {
        defaultContentMode: nextMode,
      });
      setScheduleCalendars(current =>
        current.map(calendar =>
          calendar.id === updated.id ? updated : calendar,
        ),
      );
      setCalendarShareTarget(current => current?.id === updated.id ? updated : current);
    },
    [calendarShareTarget, setCalendarShareTarget, setScheduleCalendars],
  );

  const routeSetupTarget = useMemo(() => {
    const now = Date.now();
    return [...routeSetupItems].sort((a, b) => {
      const aTime = new Date(a.startAt).getTime();
      const bTime = new Date(b.startAt).getTime();
      const aFuture = aTime >= now;
      const bFuture = bTime >= now;
      if (aFuture !== bFuture) return aFuture ? -1 : 1;
      return aFuture ? aTime - bTime : bTime - aTime;
    })[0];
  }, [routeSetupItems]);

  /** 경로 설정이 필요한 일정 중 현재 시점과 가장 가까운 일정으로 이동한다. */
  const openRouteSetupTarget = useCallback(() => {
    if (!routeSetupTarget) return;
    router.push(buildRouteSetupEntryRoute(routeSetupTarget.id));
  }, [routeSetupTarget, router]);

  /** 주 시작 요일을 즉시 반영하고 다음 실행에도 유지되도록 로컬 저장소에 기록한다. */
  const handleFirstDayChange = useCallback(
    (nextFirstDay: 0 | 1) => {
      setFirstDay(nextFirstDay);
      AsyncStorage.setItem(firstDayStorageKey, String(nextFirstDay)).catch(
        () => undefined,
      );
    },
    [firstDayStorageKey, setFirstDay],
  );

  return {
    openCalendarManagerAfterDismiss,
    openCalendarManagerFromSelector,
    returningFromManager,
    handleFirstDayChange,
    openAccountSettings,
    openCalendarScopeSelector,
    openRouteSetupTarget,
    updateSharedCalendarContentMode,
  };
}
