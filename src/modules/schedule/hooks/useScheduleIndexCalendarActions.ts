import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
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

type UseScheduleIndexCalendarActionsParams = {
  calendarShareFallbackTimeoutRef: MutableRefObject<ReturnType<
    typeof setTimeout
  > | null>;
  calendarShareTarget: ScheduleCalendar | null;
  closeToolbarMenu: (onClosed?: () => void) => void;
  firstDayStorageKey: string;
  pendingCalendarShareTargetRef: MutableRefObject<ScheduleCalendar | null>;
  routeSetupItems: ScheduleItem[];
  setCalendarScopeSelectorVisible: Dispatch<SetStateAction<boolean>>;
  setCalendarSettingsVisible: Dispatch<SetStateAction<boolean>>;
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
  calendarShareFallbackTimeoutRef,
  calendarShareTarget,
  closeToolbarMenu,
  firstDayStorageKey,
  pendingCalendarShareTargetRef,
  routeSetupItems,
  setCalendarScopeSelectorVisible,
  setCalendarSettingsVisible,
  setCalendarShareTarget,
  setFirstDay,
  setScheduleCalendars,
}: UseScheduleIndexCalendarActionsParams) {
  const router = useRouter();

  /** 프로필과 사용자 설정 화면으로 이동한다. */
  const openAccountSettings = useCallback(() => {
    router.push('/profile');
  }, [router]);

  /** 현재 툴바 메뉴가 닫힌 뒤 캘린더 범위 선택기를 표시한다. */
  const openCalendarScopeSelector = useCallback(() => {
    closeToolbarMenu(() => setCalendarScopeSelectorVisible(true));
  }, [closeToolbarMenu, setCalendarScopeSelectorVisible]);

  /** 선택기 닫힘 애니메이션 다음 프레임에 캘린더 설정 화면을 표시한다. */
  const openCalendarSettingsFromSelector = useCallback(() => {
    requestAnimationFrame(() => setCalendarSettingsVisible(true));
  }, [setCalendarSettingsVisible]);

  /**
   * 선택기에서 보류한 공유 대상 캘린더를 실제 공유 모달 상태로 확정한다.
   * Android 폴백 타이머가 남아 있으면 먼저 해제해 모달이 중복 표시되지 않게 한다.
   */
  const flushPendingCalendarShare = useCallback(() => {
    if (calendarShareFallbackTimeoutRef.current) {
      clearTimeout(calendarShareFallbackTimeoutRef.current);
      calendarShareFallbackTimeoutRef.current = null;
    }
    const pendingCalendar = pendingCalendarShareTargetRef.current;
    pendingCalendarShareTargetRef.current = null;
    if (pendingCalendar) setCalendarShareTarget(pendingCalendar);
  }, [
    calendarShareFallbackTimeoutRef,
    pendingCalendarShareTargetRef,
    setCalendarShareTarget,
  ]);

  /**
   * 선택기에서 공유 버튼을 누른 캘린더를 보류한다.
   * Android는 선택기 닫힘 콜백이 누락되는 상황에 대비해 짧은 폴백 타이머를 둔다.
   */
  const openCalendarShareFromSelector = useCallback(
    (calendar: ScheduleCalendar) => {
      pendingCalendarShareTargetRef.current = calendar;
      if (Platform.OS !== 'ios') {
        calendarShareFallbackTimeoutRef.current = setTimeout(
          flushPendingCalendarShare,
          360,
        );
      }
    },
    [
      calendarShareFallbackTimeoutRef,
      flushPendingCalendarShare,
      pendingCalendarShareTargetRef,
    ],
  );

  useEffect(
    () => () => {
      if (calendarShareFallbackTimeoutRef.current) {
        clearTimeout(calendarShareFallbackTimeoutRef.current);
      }
    },
    [calendarShareFallbackTimeoutRef],
  );

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
      setCalendarShareTarget(updated);
    },
    [calendarShareTarget, setCalendarShareTarget, setScheduleCalendars],
  );

  /** 선택기가 닫힌 다음 공유 캘린더 관리 화면으로 이동한다. */
  const openSharedCalendarManagerFromSelector = useCallback(() => {
    requestAnimationFrame(() => router.push('/schedule/calendars'));
  }, [router]);

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
    flushPendingCalendarShare,
    handleFirstDayChange,
    openAccountSettings,
    openCalendarScopeSelector,
    openCalendarSettingsFromSelector,
    openCalendarShareFromSelector,
    openRouteSetupTarget,
    openSharedCalendarManagerFromSelector,
    updateSharedCalendarContentMode,
  };
}
