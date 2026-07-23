import type { ShareInbox, ShareOutbox } from '../src/api/scheduleSharing';
import type { ScheduleCalendar } from '../src/api/scheduleCalendars';
import type { ScheduleItem } from '../src/modules/schedule/types';
import {
  buildShareLibraryItems,
  countActiveShareFilters,
  filterShareLibraryItems,
  getScheduleGroupLabel,
  getUnseenShareCounts,
} from '../src/modules/share/shareInboxPresentation';

const NOW = new Date('2026-07-23T09:00:00+09:00');

const baseSchedule: ScheduleItem = {
  id: 'schedule-1',
  title: '클라이언트 미팅',
  startAt: '2026-07-25T14:30:00+09:00',
  endAt: '2026-07-25T15:30:00+09:00',
  scheduleType: 'ROUTE',
  category: {
    id: 'category-1',
    title: '업무',
    color: '#2F80FF',
  },
};

function createInbox(): ShareInbox {
  return {
    pendingInvitations: [],
    receivedShares: [
      {
        shareId: 'received-schedule',
        resourceType: 'SCHEDULE',
        resourceId: 'schedule-1',
        title: '클라이언트 미팅',
        ownerMemberId: 11,
        ownerEmail: 'owner@example.com',
        permission: 'VIEWER',
        contentMode: 'SCHEDULE_AND_TRAVEL',
        sharedAt: '2026-07-22T10:00:00+09:00',
      },
      {
        shareId: 'received-calendar',
        resourceType: 'CALENDAR',
        resourceId: '1',
        title: '프로젝트 일정',
        ownerMemberId: 12,
        ownerEmail: 'minji@example.com',
        permission: 'EDITOR',
        contentMode: 'SCHEDULE_AND_TRAVEL',
        sharedAt: '2026-07-21T10:00:00+09:00',
      },
    ],
  };
}

function createOutbox(): ShareOutbox {
  return {
    sharedResources: [
      {
        resourceType: 'SCHEDULE',
        resourceId: 'schedule-2',
        title: '나사연 리뷰',
        shareCount: 2,
        shares: [
          {
            id: 'share-1',
            resourceId: 'schedule-2',
            ownerMemberId: 1,
            targetMemberId: 21,
            targetEmail: 'one@example.com',
            permission: 'VIEWER',
            contentMode: 'SCHEDULE_AND_TRAVEL',
            status: 'ACTIVE',
            createdAt: '2026-07-20T10:00:00+09:00',
          },
          {
            id: 'share-2',
            resourceId: 'schedule-2',
            ownerMemberId: 1,
            targetMemberId: 22,
            targetEmail: 'two@example.com',
            permission: 'EDITOR',
            contentMode: 'SCHEDULE_AND_TRAVEL',
            status: 'ACTIVE',
            createdAt: '2026-07-21T10:00:00+09:00',
          },
        ],
      },
    ],
    activeInvitations: [
      {
        id: 'invitation-1',
        resourceType: 'SCHEDULE',
        resourceId: 'schedule-2',
        title: '나사연 리뷰',
        permission: 'VIEWER',
        status: 'PENDING',
        expiresAt: '2026-07-26T10:00:00+09:00',
        maxAcceptCount: 5,
        acceptedCount: 1,
      },
    ],
  };
}

describe('share inbox presentation', () => {
  test('일정과 캘린더 공유를 탭별 항목으로 만들고 미확인 수를 계산한다', () => {
    const items = buildShareLibraryItems({
      inbox: createInbox(),
      outbox: createOutbox(),
      schedules: [baseSchedule],
      seenKeys: ['share:received-calendar'],
      now: NOW,
    });

    expect(items.map(item => [item.title, item.tab, item.relation])).toEqual([
      ['클라이언트 미팅', 'schedule', 'received'],
      ['프로젝트 일정', 'calendar', 'received'],
      ['나사연 리뷰', 'schedule', 'owned'],
    ]);
    expect(getUnseenShareCounts(items)).toEqual({ schedule: 1, calendar: 0 });
    expect(
      items.find(item => item.title === '나사연 리뷰')?.activeInvitations,
    ).toHaveLength(1);
  });

  test('아직 수락자가 없는 활성 링크도 소유 항목에서 관리할 수 있다', () => {
    const outbox = createOutbox();
    outbox.sharedResources = [];

    const items = buildShareLibraryItems({
      inbox: { pendingInvitations: [], receivedShares: [] },
      outbox,
      now: NOW,
    });

    expect(items).toEqual([
      expect.objectContaining({
        title: '나사연 리뷰',
        relation: 'owned',
        shareCount: 0,
        activeInvitations: [expect.objectContaining({ id: 'invitation-1' })],
      }),
    ]);
  });

  test('경로 일정은 3일 이내 미설정일 때만 경로 필요로 표시한다', () => {
    const needsRoute: ScheduleItem = {
      ...baseSchedule,
      travelPlanStatus: 'NOT_CONFIGURED',
    };
    const readyRoute: ScheduleItem = {
      ...baseSchedule,
      id: 'schedule-ready',
      startAt: '2026-07-30T14:30:00+09:00',
      travelPlanStatus: 'READY',
    };
    const inbox = createInbox();
    inbox.receivedShares.push({
      ...inbox.receivedShares[0],
      shareId: 'received-ready',
      resourceId: 'schedule-ready',
      title: '경로 등록 일정',
    });

    const items = buildShareLibraryItems({
      inbox,
      outbox: { sharedResources: [], activeInvitations: [] },
      schedules: [needsRoute, readyRoute],
      now: NOW,
    });

    expect(
      items.find(item => item.resourceId === 'schedule-1')?.routeState,
    ).toBe('needed');
    expect(
      items.find(item => item.resourceId === 'schedule-ready')?.routeState,
    ).toBe('ready');
    expect(
      filterShareLibraryItems(items, 'schedule', {
        query: '',
        relation: 'all',
        status: 'routeNeeded',
        sort: 'upcoming',
      }).map(item => item.resourceId),
    ).toEqual(['schedule-1']);
  });

  test('소유 일정은 참여자 출발 현황과 공유 대상 검색을 제공한다', () => {
    const ownerSchedule: ScheduleItem = {
      ...baseSchedule,
      id: 'schedule-2',
      title: '나사연 리뷰',
      departureParticipants: [
        { memberId: 1, role: 'OWNER', departed: true },
        { memberId: 21, role: 'SHARED', departed: true },
        { memberId: 22, role: 'SHARED', departed: false },
      ],
    };
    const items = buildShareLibraryItems({
      inbox: { pendingInvitations: [], receivedShares: [] },
      outbox: createOutbox(),
      schedules: [ownerSchedule],
      now: NOW,
    });

    expect(items[0].departureSummary).toBe('2/3 출발');
    expect(
      filterShareLibraryItems(items, 'schedule', {
        query: 'two@example.com',
        relation: 'owned',
        status: 'departure',
        sort: 'recent',
      }),
    ).toHaveLength(1);
  });

  test('캘린더 행에는 가장 가까운 다음 일정과 실제 멤버 수를 붙인다', () => {
    const calendar: ScheduleCalendar = {
      id: 1,
      title: '프로젝트 일정',
      color: '#34C759',
      defaultContentMode: 'SCHEDULE_AND_TRAVEL',
      status: 'ACTIVE',
      ownerMemberId: 12,
      myRole: 'EDITOR',
      memberCount: 4,
      routeReminderEnabled: true,
    };
    const calendarSchedules: ScheduleItem[] = [
      {
        ...baseSchedule,
        id: 'later',
        calendarId: 1,
        startAt: '2026-08-02T10:00:00+09:00',
        endAt: '2026-08-02T11:00:00+09:00',
      },
      {
        ...baseSchedule,
        id: 'next',
        calendarId: 1,
        title: '팀 워크숍',
        startAt: '2026-07-27T10:00:00+09:00',
        endAt: '2026-07-27T11:00:00+09:00',
      },
    ];

    const items = buildShareLibraryItems({
      inbox: createInbox(),
      outbox: { sharedResources: [], activeInvitations: [] },
      schedules: calendarSchedules,
      calendars: [calendar],
      now: NOW,
    });
    const calendarItem = items.find(item => item.tab === 'calendar');

    expect(calendarItem?.nextSchedule?.title).toBe('팀 워크숍');
    expect(calendarItem?.memberCount).toBe(4);
  });

  test('날짜 그룹과 활성 필터 수를 탭 규칙에 맞게 계산한다', () => {
    const item = buildShareLibraryItems({
      inbox: createInbox(),
      outbox: { sharedResources: [], activeInvitations: [] },
      schedules: [{ ...baseSchedule, startAt: '2026-07-23T14:30:00+09:00' }],
      now: NOW,
    })[0];

    expect(getScheduleGroupLabel(item, NOW)).toBe('오늘');
    expect(
      countActiveShareFilters('schedule', {
        query: '',
        relation: 'received',
        status: 'routeNeeded',
        sort: 'recent',
      }),
    ).toBe(3);
    expect(
      countActiveShareFilters('calendar', {
        query: '',
        relation: 'received',
        status: 'routeNeeded',
        sort: 'recent',
      }),
    ).toBe(2);
  });
});
