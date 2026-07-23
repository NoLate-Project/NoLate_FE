import type {
  ShareInbox,
  ShareInvitationSummary,
  ShareOutbox,
  ShareResourceType,
  ScheduleShare,
} from '../../api/scheduleSharing';
import type { ScheduleCalendar } from '../../api/scheduleCalendars';
import type {
  ScheduleItem,
  ScheduleShareContentMode,
  ScheduleSharePermission,
} from '../schedule/types';

export type ShareLibraryTab = 'schedule' | 'calendar';
export type ShareLibraryRelation = 'all' | 'received' | 'owned';
export type ShareLibraryStatus = 'all' | 'routeNeeded' | 'departure';
export type ShareLibrarySort = 'upcoming' | 'recent';

export type ShareLibraryFilter = {
  query: string;
  relation: ShareLibraryRelation;
  status: ShareLibraryStatus;
  sort: ShareLibrarySort;
};

export type ShareRouteState = 'needed' | 'ready' | null;

export type ShareLibraryItem = {
  key: string;
  tab: ShareLibraryTab;
  resourceType: ShareResourceType;
  resourceId: string;
  title: string;
  color?: string | null;
  relation: Exclude<ShareLibraryRelation, 'all'>;
  permission: ScheduleSharePermission;
  contentMode?: ScheduleShareContentMode;
  ownerMemberId?: number;
  ownerEmail?: string | null;
  isPending: boolean;
  isUnseen: boolean;
  sharedAt?: string | null;
  shareCount: number;
  shares: ScheduleShare[];
  activeInvitations: ShareInvitationSummary[];
  schedule?: ScheduleItem;
  nextSchedule?: ScheduleItem;
  memberCount?: number;
  routeState: ShareRouteState;
  departedCount?: number;
  departureParticipantCount?: number;
  departureSummary?: string;
  searchText: string;
};

type BuildShareLibraryItemsInput = {
  inbox: ShareInbox;
  outbox: ShareOutbox;
  schedules?: ScheduleItem[];
  calendars?: ScheduleCalendar[];
  seenKeys?: readonly string[];
  now?: Date;
};

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function resourceKey(type: ShareResourceType, id: string) {
  return `${type}:${id}`;
}

function toTimestamp(value?: string | null) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function getLatestShareTimestamp(shares: ScheduleShare[]) {
  return shares.reduce<number | null>((latest, share) => {
    const timestamp = toTimestamp(share.updatedAt ?? share.createdAt);
    if (timestamp === null) return latest;
    return latest === null ? timestamp : Math.max(latest, timestamp);
  }, null);
}

function getScheduleForResource(
  type: ShareResourceType,
  resourceId: string,
  schedules: ScheduleItem[],
) {
  if (type !== 'SCHEDULE') return undefined;
  return schedules.find(schedule => schedule.id === resourceId);
}

function getNextScheduleForResource(
  type: ShareResourceType,
  resourceId: string,
  schedules: ScheduleItem[],
  now: Date,
) {
  if (type === 'SCHEDULE') return undefined;

  const nowTimestamp = now.getTime();
  return schedules
    .filter(schedule => {
      const belongsToResource =
        type === 'CALENDAR'
          ? String(schedule.calendarId ?? '') === resourceId
          : schedule.category?.id === resourceId;
      const endTimestamp = toTimestamp(schedule.endAt ?? schedule.startAt);
      return (
        belongsToResource &&
        endTimestamp !== null &&
        endTimestamp >= nowTimestamp
      );
    })
    .sort(
      (a, b) =>
        (toTimestamp(a.startAt) ?? Number.MAX_SAFE_INTEGER) -
        (toTimestamp(b.startAt) ?? Number.MAX_SAFE_INTEGER),
    )[0];
}

function getRouteState(
  schedule: ScheduleItem | undefined,
  contentMode: ScheduleShareContentMode | undefined,
  now: Date,
): ShareRouteState {
  if (
    !schedule ||
    schedule.scheduleType !== 'ROUTE' ||
    contentMode === 'SCHEDULE_ONLY'
  ) {
    return null;
  }

  const travelPlanStatus =
    schedule.myTravelPlan?.status ?? schedule.travelPlanStatus;
  if (travelPlanStatus === 'READY') return 'ready';

  const startTimestamp = toTimestamp(schedule.startAt);
  const requiresAttention =
    travelPlanStatus === 'NOT_CONFIGURED' ||
    travelPlanStatus === 'STALE' ||
    schedule.routeSetupRequired === true;
  const isWithinReminderWindow =
    startTimestamp !== null &&
    startTimestamp >= now.getTime() &&
    startTimestamp - now.getTime() <= THREE_DAYS_MS;

  return requiresAttention && isWithinReminderWindow ? 'needed' : null;
}

function getDeparturePresentation(schedule?: ScheduleItem) {
  const participants = schedule?.departureParticipants ?? [];
  if (participants.length === 0) {
    return {
      departedCount: undefined,
      departureParticipantCount: undefined,
      departureSummary: undefined,
    };
  }

  const departedCount = participants.filter(
    participant => participant.departed,
  ).length;
  const departureParticipantCount = participants.length;
  const departureSummary =
    departedCount === 0
      ? '아직 출발 전'
      : departedCount === departureParticipantCount
      ? `${departureParticipantCount}명 모두 출발`
      : `${departedCount}/${departureParticipantCount} 출발`;

  return { departedCount, departureParticipantCount, departureSummary };
}

function calendarMemberCount(
  resourceType: ShareResourceType,
  resourceId: string,
  calendars: ScheduleCalendar[],
) {
  if (resourceType !== 'CALENDAR') return undefined;
  return calendars.find(calendar => String(calendar.id) === resourceId)
    ?.memberCount;
}

function ownerSearchText(shares: ScheduleShare[]) {
  return shares
    .map(share => share.targetEmail?.trim() || `회원 ${share.targetMemberId}`)
    .join(' ');
}

export function buildShareLibraryItems({
  inbox,
  outbox,
  schedules = [],
  calendars = [],
  seenKeys = [],
  now = new Date(),
}: BuildShareLibraryItemsInput): ShareLibraryItem[] {
  const seenKeySet = new Set(seenKeys);
  const invitationsByResource = new Map<string, ShareInvitationSummary[]>();

  outbox.activeInvitations.forEach(invitation => {
    const key = resourceKey(invitation.resourceType, invitation.resourceId);
    invitationsByResource.set(key, [
      ...(invitationsByResource.get(key) ?? []),
      invitation,
    ]);
  });

  const receivedItems: ShareLibraryItem[] = [
    ...inbox.pendingInvitations.map((invitation): ShareLibraryItem => {
      const schedule = getScheduleForResource(
        invitation.resourceType,
        invitation.resourceId,
        schedules,
      );
      const nextSchedule = getNextScheduleForResource(
        invitation.resourceType,
        invitation.resourceId,
        schedules,
        now,
      );
      const departure = getDeparturePresentation(schedule);
      const ownerLabel =
        invitation.ownerEmail?.trim() || `회원 ${invitation.ownerMemberId}`;

      return {
        key: `invitation:${invitation.id}`,
        tab: invitation.resourceType === 'SCHEDULE' ? 'schedule' : 'calendar',
        resourceType: invitation.resourceType,
        resourceId: invitation.resourceId,
        title: invitation.title,
        color: invitation.color,
        relation: 'received',
        permission: invitation.permission,
        contentMode: invitation.contentMode,
        ownerMemberId: invitation.ownerMemberId,
        ownerEmail: invitation.ownerEmail,
        isPending: true,
        isUnseen: !seenKeySet.has(`invitation:${invitation.id}`),
        shareCount: 0,
        shares: [],
        activeInvitations: [],
        schedule,
        nextSchedule,
        memberCount: calendarMemberCount(
          invitation.resourceType,
          invitation.resourceId,
          calendars,
        ),
        routeState: getRouteState(schedule, invitation.contentMode, now),
        ...departure,
        searchText: `${invitation.title} ${ownerLabel}`.toLocaleLowerCase(),
      };
    }),
    ...inbox.receivedShares.map((share): ShareLibraryItem => {
      const schedule = getScheduleForResource(
        share.resourceType,
        share.resourceId,
        schedules,
      );
      const nextSchedule = getNextScheduleForResource(
        share.resourceType,
        share.resourceId,
        schedules,
        now,
      );
      const departure = getDeparturePresentation(schedule);
      const ownerLabel =
        share.ownerEmail?.trim() || `회원 ${share.ownerMemberId}`;

      return {
        key: `share:${share.shareId}`,
        tab: share.resourceType === 'SCHEDULE' ? 'schedule' : 'calendar',
        resourceType: share.resourceType,
        resourceId: share.resourceId,
        title: share.title,
        color: share.color,
        relation: 'received',
        permission: share.permission,
        contentMode: share.contentMode,
        ownerMemberId: share.ownerMemberId,
        ownerEmail: share.ownerEmail,
        isPending: false,
        isUnseen: !seenKeySet.has(`share:${share.shareId}`),
        sharedAt: share.sharedAt,
        shareCount: 0,
        shares: [],
        activeInvitations: [],
        schedule,
        nextSchedule,
        memberCount: calendarMemberCount(
          share.resourceType,
          share.resourceId,
          calendars,
        ),
        routeState: getRouteState(schedule, share.contentMode, now),
        ...departure,
        searchText: `${share.title} ${ownerLabel}`.toLocaleLowerCase(),
      };
    }),
  ];

  const ownedItems = outbox.sharedResources.map(
    (resource): ShareLibraryItem => {
      const schedule = getScheduleForResource(
        resource.resourceType,
        resource.resourceId,
        schedules,
      );
      const nextSchedule = getNextScheduleForResource(
        resource.resourceType,
        resource.resourceId,
        schedules,
        now,
      );
      const contentMode = resource.shares[0]?.contentMode;
      const departure = getDeparturePresentation(schedule);
      const latestShareTimestamp = getLatestShareTimestamp(resource.shares);

      return {
        key: `owned:${resourceKey(resource.resourceType, resource.resourceId)}`,
        tab: resource.resourceType === 'SCHEDULE' ? 'schedule' : 'calendar',
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        title: resource.title,
        color: resource.color,
        relation: 'owned',
        permission: 'OWNER',
        contentMode,
        isPending: false,
        isUnseen: false,
        sharedAt:
          latestShareTimestamp === null
            ? undefined
            : new Date(latestShareTimestamp).toISOString(),
        shareCount: resource.shareCount,
        shares: resource.shares,
        activeInvitations:
          invitationsByResource.get(
            resourceKey(resource.resourceType, resource.resourceId),
          ) ?? [],
        schedule,
        nextSchedule,
        memberCount: calendarMemberCount(
          resource.resourceType,
          resource.resourceId,
          calendars,
        ),
        routeState: getRouteState(schedule, contentMode, now),
        ...departure,
        searchText: `${resource.title} ${ownerSearchText(
          resource.shares,
        )}`.toLocaleLowerCase(),
      };
    },
  );

  const ownedResourceKeys = new Set(
    outbox.sharedResources.map(resource =>
      resourceKey(resource.resourceType, resource.resourceId),
    ),
  );
  const invitationOnlyItems = [...invitationsByResource.entries()]
    .filter(([key]) => !ownedResourceKeys.has(key))
    .map(([, invitations]): ShareLibraryItem => {
      const invitation = invitations[0];
      const schedule = getScheduleForResource(
        invitation.resourceType,
        invitation.resourceId,
        schedules,
      );
      const nextSchedule = getNextScheduleForResource(
        invitation.resourceType,
        invitation.resourceId,
        schedules,
        now,
      );
      const departure = getDeparturePresentation(schedule);

      return {
        key: `owned:${resourceKey(
          invitation.resourceType,
          invitation.resourceId,
        )}`,
        tab: invitation.resourceType === 'SCHEDULE' ? 'schedule' : 'calendar',
        resourceType: invitation.resourceType,
        resourceId: invitation.resourceId,
        title: invitation.title,
        color: invitation.color,
        relation: 'owned',
        permission: 'OWNER',
        contentMode: invitation.contentMode,
        isPending: false,
        isUnseen: false,
        shareCount: 0,
        shares: [],
        activeInvitations: invitations,
        schedule,
        nextSchedule,
        memberCount: calendarMemberCount(
          invitation.resourceType,
          invitation.resourceId,
          calendars,
        ),
        routeState: getRouteState(schedule, invitation.contentMode, now),
        ...departure,
        searchText: invitation.title.toLocaleLowerCase(),
      };
    });

  return [...receivedItems, ...ownedItems, ...invitationOnlyItems];
}

function upcomingTimestamp(item: ShareLibraryItem) {
  return (
    toTimestamp(item.schedule?.startAt ?? item.nextSchedule?.startAt) ??
    Number.MAX_SAFE_INTEGER
  );
}

function recentTimestamp(item: ShareLibraryItem) {
  return toTimestamp(item.sharedAt) ?? 0;
}

export function filterShareLibraryItems(
  items: readonly ShareLibraryItem[],
  tab: ShareLibraryTab,
  filter: ShareLibraryFilter,
) {
  const normalizedQuery = filter.query.trim().toLocaleLowerCase();

  return items
    .filter(item => item.tab === tab)
    .filter(
      item => filter.relation === 'all' || item.relation === filter.relation,
    )
    .filter(item => {
      if (tab !== 'schedule' || filter.status === 'all') return true;
      if (filter.status === 'routeNeeded') return item.routeState === 'needed';
      return item.departureSummary !== undefined;
    })
    .filter(
      item => !normalizedQuery || item.searchText.includes(normalizedQuery),
    )
    .sort((a, b) => {
      if (filter.sort === 'recent') {
        return (
          recentTimestamp(b) - recentTimestamp(a) ||
          upcomingTimestamp(a) - upcomingTimestamp(b)
        );
      }
      return (
        upcomingTimestamp(a) - upcomingTimestamp(b) ||
        recentTimestamp(b) - recentTimestamp(a)
      );
    });
}

export function getUnseenShareCounts(items: readonly ShareLibraryItem[]) {
  return items.reduce(
    (counts, item) => {
      if (item.isUnseen) counts[item.tab] += 1;
      return counts;
    },
    { schedule: 0, calendar: 0 },
  );
}

export function getScheduleGroupLabel(
  item: ShareLibraryItem,
  now = new Date(),
) {
  const value = item.schedule?.startAt;
  const timestamp = toTimestamp(value);
  if (timestamp === null) return '일정 정보';

  const date = new Date(timestamp);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  if (date >= todayStart && date < tomorrowStart) return '오늘';
  if (date >= tomorrowStart) return '다가오는 일정';
  return '지난 일정';
}

export function countActiveShareFilters(
  tab: ShareLibraryTab,
  filter: ShareLibraryFilter,
) {
  return (
    Number(filter.relation !== 'all') +
    Number(tab === 'schedule' && filter.status !== 'all') +
    Number(filter.sort !== 'upcoming')
  );
}
