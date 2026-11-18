import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { SCHEDULE_ICONS } from '../components/shared/ScheduleIcon';
import type { FloatingBarAction } from '../components/shared/GlobalFloatingActionBar';
import {
  MonthAgendaList,
  SelectedDayAgendaPanel,
} from '../components/list/ScheduleAgendaViews';
import type { ScheduleItem } from '../types';
import type { ScheduleSwipeActionResolver } from '../components/ScheduleSwipeActions';
import type { ScheduleCalendar } from '../../../api/scheduleCalendars';
import { hasCalendarScheduleMonthCache } from '../calendarScheduleCache';
import {
  getCalendarScopePresentation,
  type CalendarScope,
} from '../calendarScope';
import type { CalendarViewMode } from '../components/calendar/viewMode';
import type { MonthAgendaPanelKind } from '../calendarMotion';
import { sanitizeCalendarTransitionError } from './scheduleIndexControllerModel';
import { useImmediateNavigationTransition } from '../../performance/ImmediateNavigationTransition';
import type { AgendaFocusTarget } from '../components/list/ScheduleAgendaViews';

const MemoizedSelectedDayAgendaPanel = React.memo(SelectedDayAgendaPanel);
const MemoizedMonthAgendaList = React.memo(MonthAgendaList);

type UseScheduleIndexBottomBarParams = {
  agendaReturnHighlight?: React.ComponentProps<typeof MonthAgendaList>['returnHighlight'];
  savedAgendaTarget?: { day: string; itemId: string; categoryId?: string };
  guidanceReturnTarget?: AgendaFocusTarget & { day: string };
  isMonthViewTransitionActive: boolean;
  saveReturnVisible: boolean;
  reduceMotionEnabled: boolean;
  activeCalendarScope: CalendarScope;
  bottomInset: number;
  calendarScopeSelectorVisible: boolean;
  handleCalendarViewModeChange: (mode: CalendarViewMode) => void;
  handleGoToday: () => void;
  handleOpenScheduleFromDayDisplay: (scheduleId: string, restoreFocus?: () => void) => void;
  getScheduleSwipeActions: ScheduleSwipeActionResolver;
  onRequestScheduleActions: (item: ScheduleItem) => void;
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
  agendaReturnHighlight,
  savedAgendaTarget,
  guidanceReturnTarget,
  isMonthViewTransitionActive,
  saveReturnVisible,
  reduceMotionEnabled,
  activeCalendarScope,
  bottomInset,
  calendarScopeSelectorVisible,
  handleCalendarViewModeChange,
  handleGoToday,
  handleOpenScheduleFromDayDisplay,
  getScheduleSwipeActions,
  onRequestScheduleActions,
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
  const { runWithTransitionShell } = useImmediateNavigationTransition();
  const [agendaCategoryId, setAgendaCategoryId] = useState<string | null>(null);
  const [handledAgendaSave, setHandledAgendaSave] = useState<string>();
  const agendaCategoryFilter = useMemo(
    () => ({
      id: agendaCategoryId,
      onChange: setAgendaCategoryId,
      handledSavedItem: handledAgendaSave,
      onHandleSavedItem: setHandledAgendaSave,
    }),
    [agendaCategoryId, handledAgendaSave],
  );
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
  const agendaEntryDate =
    monthDisplaySelectedDay.slice(0, 7) === monthDisplayFocusedMonth.slice(0, 7)
    ? monthDisplaySelectedDay
    : undefined;
  const savedEntry = savedAgendaTarget?.day === agendaEntryDate ? savedAgendaTarget : undefined;
  const guidanceEntry = guidanceReturnTarget?.day === agendaEntryDate ? guidanceReturnTarget : undefined;

  /** 공유 초대와 수신 일정이 모인 공유함의 전체 탭으로 이동한다. */
  const openInvitesShortcut = useCallback(() => {
    runWithTransitionShell(
      { route: '/share/inbox', title: '공유함' },
      () => router.push({ pathname: '/share/inbox', params: { tab: 'all' } }),
    );
  }, [router, runWithTransitionShell]);

  /** 읽지 않은 앱 알림을 확인할 수 있는 알림함으로 이동한다. */
  const openNotificationInbox = useCallback(() => {
    runWithTransitionShell(
      { route: '/notifications', title: '알림' },
      () => router.push('/notifications'),
    );
  }, [router, runWithTransitionShell]);

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
        label: '캘린더',
        icon: SCHEDULE_ICONS.calendar,
        accessibilityLabel: `현재 ${activeCalendarPresentation.title}, 캘린더 선택`,
        accessibilityState: { expanded: calendarScopeSelectorVisible },
        onPress: openCalendarScopeSelector,
      },
      {
        key: 'notification-inbox-shortcut',
        label: '알림',
        icon: SCHEDULE_ICONS.notifications,
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
        label: '공유함',
        icon: SCHEDULE_ICONS.inbox,
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
        label: '프로필',
        icon: SCHEDULE_ICONS.account,
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
          savedItemId={savedEntry?.itemId}
          focusTarget={guidanceEntry}
          saveReturnVisible={saveReturnVisible}
          reduceEntryMotion={reduceMotionEnabled}
          items={itemsArray}
          loading={monthAgendaLoading}
          error={sanitizeCalendarTransitionError(scheduleError)}
          bottomInset={bottomInset}
          onPressRetry={loadSchedules}
          onOpenSchedule={handleOpenScheduleFromDayDisplay}
          returnHighlight={agendaReturnHighlight}
          getScheduleSwipeActions={getScheduleSwipeActions}
          onRequestScheduleActions={onRequestScheduleActions}
          routeSetupRequiredCount={routeSetupRequiredCount}
          onOpenRouteSetup={openRouteSetupTarget}
          onRequestViewMode={handleCalendarViewModeChange}
        />
      ) : (
        <MemoizedMonthAgendaList
          visibleMonth={monthDisplayFocusedMonth}
          calendarScope={activeCalendarScope}
          categoryFilter={agendaCategoryFilter}
          entryDate={agendaEntryDate}
          entryLayoutTransitionActive={isMonthViewTransitionActive}
          savedEntry={savedEntry}
          focusTarget={guidanceEntry}
          saveReturnVisible={saveReturnVisible}
          reduceEntryMotion={reduceMotionEnabled}
          items={itemsArray}
          loading={monthAgendaLoading}
          error={sanitizeCalendarTransitionError(scheduleError)}
          bottomInset={bottomInset}
          onPressRetry={loadSchedules}
          onOpenSchedule={handleOpenScheduleFromDayDisplay}
          returnHighlight={agendaReturnHighlight}
          getScheduleSwipeActions={getScheduleSwipeActions}
          onRequestScheduleActions={onRequestScheduleActions}
          routeSetupRequiredCount={routeSetupRequiredCount}
          onOpenRouteSetup={openRouteSetupTarget}
          onRequestViewMode={handleCalendarViewModeChange}
        />
      ),
    [
      activeCalendarScope,
      agendaCategoryFilter,
      agendaEntryDate,
      agendaReturnHighlight,
      guidanceEntry,
      bottomInset,
      handleCalendarViewModeChange,
      handleOpenScheduleFromDayDisplay,
      getScheduleSwipeActions,
      isMonthViewTransitionActive,
      onRequestScheduleActions,
      itemsArray,
      loadSchedules,
      monthAgendaLoading,
      monthDisplayFocusedMonth,
      monthDisplaySelectedDay,
      reduceMotionEnabled,
      openRouteSetupTarget,
      savedEntry,
      saveReturnVisible,
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
