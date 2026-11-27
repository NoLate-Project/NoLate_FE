import {
  useCallback,
  type Dispatch,
  type SetStateAction,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import {
  updateScheduleCalendar,
  type ScheduleCalendar,
} from '../../../api/scheduleCalendars';
import { buildRouteSetupEntryRoute } from '../routeSetupNavigation';
import { useImmediateNavigationTransition } from '../../performance/ImmediateNavigationTransition';

type UseScheduleIndexCalendarActionsParams = {
  calendarShareTarget: ScheduleCalendar | null;
  closeToolbarMenu: (onClosed?: () => void) => void;
  firstDayStorageKey: string;
  setCalendarScopeSelectorVisible: Dispatch<SetStateAction<boolean>>;
  setCalendarShareTarget: Dispatch<SetStateAction<ScheduleCalendar | null>>;
  setFirstDay: Dispatch<SetStateAction<0 | 1>>;
  setScheduleCalendars: Dispatch<SetStateAction<ScheduleCalendar[]>>;
};

/**
 * 캘린더 선택기에서 실행되는 설정·공유·경로 설정 이동 동작을 제공한다.
 */
export function useScheduleIndexCalendarActions({
  calendarShareTarget,
  closeToolbarMenu,
  firstDayStorageKey,
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

  const openRouteSetupTarget = useCallback((id: string) => {
    router.push(buildRouteSetupEntryRoute(id));
  }, [router]);

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
    handleFirstDayChange,
    openAccountSettings,
    openCalendarScopeSelector,
    openRouteSetupTarget,
    updateSharedCalendarContentMode,
  };
}
