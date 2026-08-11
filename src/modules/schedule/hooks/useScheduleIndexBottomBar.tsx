import React, { useCallback, useMemo } from 'react';
import { useRouter } from 'expo-router';
import type { FloatingBarAction } from '../components/shared/GlobalFloatingActionBar';
import {
  MonthAgendaList,
  SelectedDayAgendaPanel,
} from '../components/list/ScheduleAgendaViews';
import type { ScheduleItem } from '../types';
import type { ScheduleCalendar } from '../../../api/scheduleCalendars';
import { hasCalendarScheduleMonthCache } from '../calendarScheduleCache';
import {
  getCalendarScopePresentation,
  type CalendarScope,
} from '../calendarScope';
import type { CalendarViewMode } from '../components/calendar/viewMode';
import type { MonthAgendaPanelKind } from '../calendarMotion';
import { sanitizeCalendarTransitionError } from './scheduleIndexControllerModel';

const MemoizedSelectedDayAgendaPanel = React.memo(SelectedDayAgendaPanel);
const MemoizedMonthAgendaList = React.memo(MonthAgendaList);

type UseScheduleIndexBottomBarParams = {
  activeCalendarScope: CalendarScope;
  bottomInset: number;
  calendarScopeSelectorVisible: boolean;
  handleCalendarViewModeChange: (mode: CalendarViewMode) => void;
  handleGoToday: () => void;
  handleOpenScheduleFromDayDisplay: (scheduleId: string) => void;
  itemsArray: ScheduleItem[];
  loadSchedules: () => void | Promise<void>;
  monthDisplayFocusedMonth: string;
  monthDisplaySelectedDay: string;
  notificationUnreadCount: number;
  openAccountSettings: () => void;
  openCalendarScopeSelector: () => void;
  openRouteSetupTarget: () => void;
  routeSetupRequiredCount: number;
  scheduleCalendars: ScheduleCalendar[];
  scheduleError: string | null;
  scheduleLoading: boolean;
  shareBadgeCount: number;
  textSecondaryColor: string;
};

/**
 * 일정 화면 하단 액션 바와 월 일정 패널 렌더러를 구성한다.
 * 배지·캘린더 범위·일정 로딩 상태를 접근성 문구와 함께 조립해 메인 컨트롤러가
 * 화면별 버튼 정의나 패널 JSX를 직접 소유하지 않도록 한다.
 */
export function useScheduleIndexBottomBar({
  activeCalendarScope,
  bottomInset,
  calendarScopeSelectorVisible,
  handleCalendarViewModeChange,
  handleGoToday,
  handleOpenScheduleFromDayDisplay,
  itemsArray,
  loadSchedules,
  monthDisplayFocusedMonth,
  monthDisplaySelectedDay,
  notificationUnreadCount,
  openAccountSettings,
  openCalendarScopeSelector,
  openRouteSetupTarget,
  routeSetupRequiredCount,
  scheduleCalendars,
  scheduleError,
  scheduleLoading,
  shareBadgeCount,
  textSecondaryColor,
}: UseScheduleIndexBottomBarParams) {
  const router = useRouter();
  const activeCalendarPresentation = useMemo(
    () => getCalendarScopePresentation(activeCalendarScope, scheduleCalendars),
    [activeCalendarScope, scheduleCalendars],
  );
  const activeCalendarIconColor =
    activeCalendarPresentation.color ??
    (activeCalendarScope === 'personal' ? '#8E8E93' : textSecondaryColor);
  const hasMonthAgendaCache = hasCalendarScheduleMonthCache(
    monthDisplayFocusedMonth,
  );
  const monthAgendaLoading =
    !hasMonthAgendaCache && (scheduleLoading || scheduleError === null);

  /** 공유 초대와 수신 일정이 모인 공유함의 전체 탭으로 이동한다. */
  const openInvitesShortcut = useCallback(() => {
    router.push({ pathname: '/share/inbox', params: { tab: 'all' } });
  }, [router]);

  /** 읽지 않은 앱 알림을 확인할 수 있는 알림함으로 이동한다. */
  const openNotificationInbox = useCallback(() => {
    router.push('/notifications');
  }, [router]);

  const bottomLeftActions = useMemo<FloatingBarAction[]>(
    () => [
      {
        key: 'today',
        label: '오늘',
        accessibilityLabel: '오늘 날짜로 이동',
        onPress: handleGoToday,
      },
    ],
    [handleGoToday],
  );

  const bottomRightActions = useMemo<FloatingBarAction[]>(
    () => [
      {
        key: 'calendar-scope-selector',
        icon: 'calendar-outline',
        accessibilityLabel: `현재 ${activeCalendarPresentation.title}, 캘린더 선택`,
        accessibilityState: { expanded: calendarScopeSelectorVisible },
        onPress: openCalendarScopeSelector,
      },
      {
        key: 'notification-inbox-shortcut',
        icon: 'notifications-outline',
        badgeCount: notificationUnreadCount,
        emphasized: notificationUnreadCount > 0,
        accessibilityLabel:
          notificationUnreadCount > 0
            ? `알림함, 읽지 않은 알림 ${notificationUnreadCount}개`
            : '알림함',
        onPress: openNotificationInbox,
      },
      {
        key: 'share-inbox-shortcut',
        icon: 'mail-unread-outline',
        badgeCount: shareBadgeCount,
        emphasized: shareBadgeCount > 0,
        accessibilityLabel:
          shareBadgeCount > 0
            ? `공유함, 새 공유 또는 초대 ${shareBadgeCount}개`
            : '공유함',
        onPress: openInvitesShortcut,
      },
      {
        key: 'account-settings-shortcut',
        icon: 'person-circle-outline',
        accessibilityLabel: '내 정보 및 설정',
        onPress: openAccountSettings,
      },
    ],
    [
      activeCalendarPresentation.title,
      calendarScopeSelectorVisible,
      notificationUnreadCount,
      openAccountSettings,
      openCalendarScopeSelector,
      openInvitesShortcut,
      openNotificationInbox,
      shareBadgeCount,
    ],
  );

  /**
   * 월 보기 모드에 맞는 상세 일자 패널 또는 월 전체 일정 목록을 렌더링한다.
   * 두 패널에 동일한 오류 정제·재시도·경로 설정 동작을 전달해 표시 방식만 달라진다.
   */
  const renderMonthAgendaPanelContent = useCallback(
    (panelKind: MonthAgendaPanelKind) =>
      panelKind === 'detail' ? (
        <MemoizedSelectedDayAgendaPanel
          selectedDay={monthDisplaySelectedDay}
          items={itemsArray}
          loading={monthAgendaLoading}
          error={sanitizeCalendarTransitionError(scheduleError)}
          bottomInset={bottomInset}
          onPressRetry={loadSchedules}
          onOpenSchedule={handleOpenScheduleFromDayDisplay}
          routeSetupRequiredCount={routeSetupRequiredCount}
          onOpenRouteSetup={openRouteSetupTarget}
          onRequestViewMode={handleCalendarViewModeChange}
        />
      ) : (
        <MemoizedMonthAgendaList
          visibleMonth={monthDisplayFocusedMonth}
          items={itemsArray}
          loading={monthAgendaLoading}
          error={sanitizeCalendarTransitionError(scheduleError)}
          bottomInset={bottomInset}
          onPressRetry={loadSchedules}
          onOpenSchedule={handleOpenScheduleFromDayDisplay}
          routeSetupRequiredCount={routeSetupRequiredCount}
          onOpenRouteSetup={openRouteSetupTarget}
          onRequestViewMode={handleCalendarViewModeChange}
        />
      ),
    [
      bottomInset,
      handleCalendarViewModeChange,
      handleOpenScheduleFromDayDisplay,
      itemsArray,
      loadSchedules,
      monthAgendaLoading,
      monthDisplayFocusedMonth,
      monthDisplaySelectedDay,
      openRouteSetupTarget,
      routeSetupRequiredCount,
      scheduleError,
    ],
  );

  return {
    activeCalendarIconColor,
    activeCalendarPresentation,
    bottomLeftActions,
    bottomRightActions,
    renderMonthAgendaPanelContent,
  };
}
