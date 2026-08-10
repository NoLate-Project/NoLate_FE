import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getSchedules } from '../../src/api/schedule';
import {
  getScheduleCalendars,
  removeScheduleCalendarMember,
  type ScheduleCalendar,
} from '../../src/api/scheduleCalendars';
import {
  getShareInbox,
  getShareOutbox,
  revokeCalendarShareInvitation,
  revokeCategoryShare,
  revokeCategoryShareInvitation,
  revokeScheduleShare,
  revokeScheduleShareInvitation,
  type ShareInbox,
  type ShareInvitationSummary,
  type ShareOutbox,
  type ShareResourceType,
  type ScheduleShare,
} from '../../src/api/scheduleSharing';
import {
  blockSharingMember,
  createSharingReport,
  type SharingReportReason,
} from '../../src/api/sharingSafety';
import { recoverDepartureAlarmsAfterMutation } from '../../src/modules/notification/departureAlarmMutationRecovery';
import { updateCalendarContentModeWithAlarmRecovery } from '../../src/modules/share/calendarContentModeAlarmRecovery';
import { createLatestAsyncRequestGuard } from '../../src/modules/share/latestAsyncRequest';
import {
  ShareInboxButton,
  ShareInboxDecoration,
} from '../../src/modules/share/ShareInboxAccessibility';
import {
  markShareInboxSeen,
  readSeenShareAttentionKeys,
} from '../../src/modules/share/shareAttention';
import {
  buildShareLibraryItems,
  countActiveShareFilters,
  filterShareLibraryItems,
  getScheduleGroupLabel,
  getUnseenShareCounts,
  type ShareLibraryFilter,
  type ShareLibraryItem,
  type ShareLibraryRelation,
  type ShareLibrarySort,
  type ShareLibraryStatus,
  type ShareLibraryTab,
} from '../../src/modules/share/shareInboxPresentation';
import CalendarGlassSurface from '../../src/modules/schedule/components/calendar/CalendarGlassSurface';
import ShareInvitationSheet from '../../src/modules/schedule/components/share/ShareInvitationSheet';
import type {
  ScheduleItem,
  ScheduleShareContentMode,
  ScheduleSharePermission,
} from '../../src/modules/schedule/types';
import { useTheme, type AppColors } from '../../src/modules/theme/ThemeContext';
import BrandedLoader from '../../src/ui/BrandedLoader';
import SharingReportModal from '../../src/modules/share/SharingReportModal';

type ShareInboxViewData = {
  inbox: ShareInbox;
  outbox: ShareOutbox;
  schedules: ScheduleItem[];
  calendars: ScheduleCalendar[];
  seenKeys: string[];
  loadedAt: Date;
};

const BRAND_BLUE = '#2F80FF';
const ROUTE_AMBER = '#D78400';
const DEPARTURE_GREEN = '#18A558';

const DEFAULT_FILTER: ShareLibraryFilter = {
  query: '',
  relation: 'all',
  status: 'all',
  sort: 'upcoming',
};

const GROUP_ORDER = ['오늘', '다가오는 일정', '지난 일정', '일정 정보'];

function normalizeTab(value?: string): ShareLibraryTab {
  if (value === 'calendar') return 'calendar';
  return 'schedule';
}

function getErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : '공유함을 불러오지 못했습니다.';
  if (/403|forbidden|status code/i.test(message)) {
    return '공유함을 불러올 권한을 확인할 수 없어요.';
  }
  if (/network|timeout/i.test(message)) {
    return '네트워크 상태를 확인한 뒤 다시 시도해 주세요.';
  }
  return message;
}

function permissionLabel(permission: ScheduleSharePermission) {
  if (permission === 'OWNER') return '소유자';
  if (permission === 'EDITOR') return '편집';
  // COMMENTER는 현재 제품에 댓글 화면이 없으므로 보기 권한으로 안내한다.
  return '보기';
}

function contentModeLabel(mode?: ScheduleShareContentMode) {
  return mode === 'SCHEDULE_AND_TRAVEL' ? '일정 + 각자 경로' : '일정만';
}

function ownerLabel(item: ShareLibraryItem) {
  return (
    item.ownerEmail?.trim() ||
    (Number.isSafeInteger(item.ownerMemberId)
      ? `회원 #${item.ownerMemberId}`
      : '알 수 없는 사용자')
  );
}

function sharingSafetyOwnerId(item: ShareLibraryItem) {
  const ownerMemberId = item.ownerMemberId;
  if (!Number.isSafeInteger(ownerMemberId) || !ownerMemberId || ownerMemberId <= 0) {
    return null;
  }
  return ownerMemberId;
}

function toDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatScheduleDate(item?: ScheduleItem) {
  const date = toDate(item?.startAt);
  if (!date) return '날짜 미정';
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${date.getMonth() + 1}월 ${date.getDate()}일(${
    dayNames[date.getDay()]
  })`;
}

function formatScheduleTimeRange(item?: ScheduleItem) {
  if (!item) return '시간 미정';
  if (item.allDay) return '종일';

  const start = toDate(item.startAt);
  if (!start) return '시간 미정';
  const startText = `${String(start.getHours()).padStart(2, '0')}:${String(
    start.getMinutes(),
  ).padStart(2, '0')}`;
  if (item.hasEndTime === false) return startText;

  const end = toDate(item.endAt);
  if (!end) return startText;
  const endText = `${String(end.getHours()).padStart(2, '0')}:${String(
    end.getMinutes(),
  ).padStart(2, '0')}`;
  return `${startText}-${endText}`;
}

function scheduleLocationLabel(item?: ScheduleItem) {
  if (!item) return '';
  if (item.origin?.name && item.destination?.name) {
    return `${item.origin.name} → ${item.destination.name}`;
  }
  return item.destination?.name || item.locationName || '';
}

function shareItemColor(item: ShareLibraryItem, fallback: string) {
  return item.schedule?.category?.color || item.color || fallback;
}

function formatShortDate(value?: string | null) {
  const date = toDate(value);
  if (!date) return '';
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function formatExpiration(value: string) {
  const date = toDate(value);
  if (!date) return '만료일 확인';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}.${day} ${hour}:${minute}까지`;
}

function resourceLabel(type: ShareResourceType) {
  if (type === 'SCHEDULE') return '일정';
  return type === 'CALENDAR' ? '공유 캘린더' : '캘린더';
}

function resourceTypeForComposer(type: ShareResourceType) {
  if (type === 'SCHEDULE') return 'schedule' as const;
  if (type === 'CALENDAR') return 'calendar' as const;
  return 'category' as const;
}

export default function ShareInboxScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { colors, mode } = useTheme();
  const accent = mode === 'dark' ? '#8BB7FF' : BRAND_BLUE;
  const searchInputRef = useRef<TextInput>(null);
  const loadRequestGuardRef = useRef(
    createLatestAsyncRequestGuard('share-inbox'),
  );
  const mountedRef = useRef(true);
  const hasBlurredRef = useRef(false);
  const revokingInvitationRef = useRef<string | null>(null);
  const revokingShareRef = useRef<string | null>(null);
  const composerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedTab, setSelectedTab] = useState<ShareLibraryTab>(
    normalizeTab(params.tab),
  );
  const [filters, setFilters] = useState<
    Record<ShareLibraryTab, ShareLibraryFilter>
  >({
    schedule: { ...DEFAULT_FILTER },
    calendar: { ...DEFAULT_FILTER },
  });
  const [data, setData] = useState<ShareInboxViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [managedItemKey, setManagedItemKey] = useState<string | null>(null);
  const [composerItem, setComposerItem] = useState<ShareLibraryItem | null>(
    null,
  );
  const [revokingInvitationId, setRevokingInvitationId] = useState<
    string | null
  >(null);
  const [revokingShareId, setRevokingShareId] = useState<string | null>(null);
  const [safetyPendingKey, setSafetyPendingKey] = useState<string | null>(null);
  const [reportItem, setReportItem] = useState<ShareLibraryItem | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/schedule');
  }, [router]);

  const openSharedResource = useCallback(
    (item: ShareLibraryItem) => {
      if (item.isPending) {
        Alert.alert(
          '수락 대기 중',
          '초대 링크에서 공유를 수락하면 이 항목을 열 수 있어요.',
        );
        return;
      }

      if (item.resourceType === 'SCHEDULE') {
        router.push({
          pathname: '/schedule/[id]',
          params: { id: item.resourceId },
        });
      } else if (item.resourceType === 'CALENDAR') {
        router.push({
          pathname: '/schedule/calendars',
          params: { id: item.resourceId },
        });
      } else {
        router.push('/schedule/categories');
      }
    },
    [router],
  );

  const loadShares = useCallback(
    async (loadMode: 'initial' | 'refresh' = 'initial') => {
      if (!mountedRef.current) return;
      const ticket = loadRequestGuardRef.current.begin();

      if (loadMode === 'refresh') setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const [inbox, outbox, schedules, calendars, seenKeys] =
          await Promise.all([
            getShareInbox(),
            getShareOutbox(),
            getSchedules().catch(() => []),
            getScheduleCalendars().catch(() => []),
            readSeenShareAttentionKeys(),
          ]);

        if (
          !mountedRef.current ||
          !loadRequestGuardRef.current.isCurrent(ticket)
        )
          return;
        setData({
          inbox,
          outbox,
          schedules,
          calendars,
          seenKeys,
          loadedAt: new Date(),
        });
        markShareInboxSeen(inbox).catch(() => undefined);
      } catch (loadError) {
        if (
          !mountedRef.current ||
          !loadRequestGuardRef.current.isCurrent(ticket)
        )
          return;
        setError(getErrorMessage(loadError));
      } finally {
        if (
          mountedRef.current &&
          loadRequestGuardRef.current.isCurrent(ticket)
        ) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const loadRequestGuard = loadRequestGuardRef.current;
    mountedRef.current = true;
    loadShares();

    return () => {
      mountedRef.current = false;
      loadRequestGuard.invalidate();
      if (composerTimerRef.current) clearTimeout(composerTimerRef.current);
    };
  }, [loadShares]);

  useFocusEffect(
    useCallback(() => {
      if (hasBlurredRef.current) {
        loadShares('refresh').catch(() => undefined);
      }
      return () => {
        hasBlurredRef.current = true;
      };
    }, [loadShares]),
  );

  useEffect(() => {
    setSelectedTab(normalizeTab(params.tab));
  }, [params.tab]);

  const items = useMemo(() => {
    if (!data) return [];
    return buildShareLibraryItems({
      inbox: data.inbox,
      outbox: data.outbox,
      schedules: data.schedules,
      calendars: data.calendars,
      seenKeys: data.seenKeys,
      now: data.loadedAt,
    });
  }, [data]);

  const unseenCounts = useMemo(() => getUnseenShareCounts(items), [items]);
  const selectedFilter = filters[selectedTab];
  const visibleItems = useMemo(
    () => filterShareLibraryItems(items, selectedTab, selectedFilter),
    [items, selectedFilter, selectedTab],
  );
  const tabTotal = useMemo(
    () => items.filter(item => item.tab === selectedTab).length,
    [items, selectedTab],
  );
  const activeFilterCount = countActiveShareFilters(
    selectedTab,
    selectedFilter,
  );
  const managedItem = useMemo(
    () => items.find(item => item.key === managedItemKey) ?? null,
    [items, managedItemKey],
  );
  const scheduleGroups = useMemo(() => {
    if (selectedTab !== 'schedule') return [];
    const groups = new Map<string, ShareLibraryItem[]>();
    visibleItems.forEach(item => {
      const label = getScheduleGroupLabel(item, data?.loadedAt);
      groups.set(label, [...(groups.get(label) ?? []), item]);
    });
    return GROUP_ORDER.filter(label => groups.has(label)).map(label => ({
      label,
      items: groups.get(label) ?? [],
    }));
  }, [data?.loadedAt, selectedTab, visibleItems]);

  const updateQuery = useCallback(
    (query: string) => {
      setFilters(current => ({
        ...current,
        [selectedTab]: {
          ...current[selectedTab],
          query,
        },
      }));
    },
    [selectedTab],
  );

  const revokeInvitation = useCallback(
    (invitation: ShareInvitationSummary) => {
      if (revokingInvitationRef.current) return;
      Alert.alert(
        '공유 링크 비활성화',
        '이 링크로는 더 이상 공유를 수락할 수 없어요. 비활성화할까요?',
        [
          { text: '취소', style: 'cancel' },
          {
            text: '비활성화',
            style: 'destructive',
            onPress: async () => {
              if (revokingInvitationRef.current) return;
              revokingInvitationRef.current = invitation.id;
              setRevokingInvitationId(invitation.id);
              setError(null);
              try {
                if (invitation.resourceType === 'SCHEDULE') {
                  await revokeScheduleShareInvitation(
                    invitation.resourceId,
                    invitation.id,
                  );
                } else if (invitation.resourceType === 'CALENDAR') {
                  await revokeCalendarShareInvitation(
                    invitation.resourceId,
                    invitation.id,
                  );
                } else {
                  await revokeCategoryShareInvitation(
                    invitation.resourceId,
                    invitation.id,
                  );
                }
                if (mountedRef.current) {
                  setData(current =>
                    current
                      ? {
                          ...current,
                          outbox: {
                            ...current.outbox,
                            activeInvitations:
                              current.outbox.activeInvitations.filter(
                                item => item.id !== invitation.id,
                              ),
                          },
                        }
                      : current,
                  );
                }
                await loadShares('refresh');
              } catch (revokeError) {
                if (mountedRef.current) setError(getErrorMessage(revokeError));
              } finally {
                revokingInvitationRef.current = null;
                if (mountedRef.current) setRevokingInvitationId(null);
              }
            },
          },
        ],
      );
    },
    [loadShares],
  );

  const revokeDirectShare = useCallback(
    (item: ShareLibraryItem, share: ScheduleShare) => {
      if (revokingShareRef.current) return;
      const target =
        share.targetEmail?.trim() || `NoLate ID #${share.targetMemberId}`;

      Alert.alert(
        '공유 해제',
        `${target}님의 ${resourceLabel(item.resourceType)} 공유를 해제할까요?`,
        [
          { text: '취소', style: 'cancel' },
          {
            text: '공유 해제',
            style: 'destructive',
            onPress: async () => {
              if (revokingShareRef.current) return;
              revokingShareRef.current = share.id;
              setRevokingShareId(share.id);
              setError(null);
              try {
                if (item.resourceType === 'SCHEDULE') {
                  await revokeScheduleShare(item.resourceId, share.id);
                } else if (item.resourceType === 'CALENDAR') {
                  await removeScheduleCalendarMember(
                    item.resourceId,
                    share.targetMemberId,
                  );
                } else {
                  await revokeCategoryShare(item.resourceId, share.id);
                }
                if (mountedRef.current) {
                  setData(current =>
                    current
                      ? {
                          ...current,
                          outbox: {
                            ...current.outbox,
                            sharedResources: current.outbox.sharedResources.map(
                              resource => {
                                if (
                                  resource.resourceType !== item.resourceType ||
                                  resource.resourceId !== item.resourceId
                                ) {
                                  return resource;
                                }
                                const shares = resource.shares.filter(
                                  resourceShare =>
                                    resourceShare.id !== share.id,
                                );
                                return {
                                  ...resource,
                                  shares,
                                  shareCount: shares.length,
                                };
                              },
                            ),
                          },
                        }
                      : current,
                  );
                }
                await loadShares('refresh');
              } catch (revokeError) {
                if (mountedRef.current) {
                  Alert.alert('공유 해제 실패', getErrorMessage(revokeError));
                }
              } finally {
                revokingShareRef.current = null;
                if (mountedRef.current) setRevokingShareId(null);
              }
            },
          },
        ],
      );
    },
    [loadShares],
  );

  const submitSafetyReport = useCallback(
    async (
      item: ShareLibraryItem,
      reason: SharingReportReason,
      details: string,
    ) => {
      if (item.relation !== 'received' || item.isPending || safetyPendingKey) return;
      const resourceId = Number(item.resourceId);
      const ownerMemberId = sharingSafetyOwnerId(item);
      if (!Number.isSafeInteger(resourceId) || resourceId <= 0 || ownerMemberId === null) return;
      setSafetyPendingKey(item.key);
      try {
        await createSharingReport({
          reportedMemberId: ownerMemberId,
          resourceType: item.resourceType,
          resourceId,
          reason,
          details: details.trim() || undefined,
        });
        if (mountedRef.current) setReportItem(null);
        Alert.alert('신고가 접수됐어요', '검토가 필요한 공유로 안전하게 접수했습니다.');
      } catch (reportError) {
        Alert.alert('신고 접수 실패', getErrorMessage(reportError));
      } finally {
        if (mountedRef.current) setSafetyPendingKey(null);
      }
    },
    [safetyPendingKey],
  );

  const blockShareOwner = useCallback(
    async (item: ShareLibraryItem) => {
      if (item.relation !== 'received' || item.isPending || safetyPendingKey) return;
      const ownerMemberId = sharingSafetyOwnerId(item);
      if (ownerMemberId === null) return;
      setSafetyPendingKey(item.key);
      try {
        await blockSharingMember(ownerMemberId);
        await recoverDepartureAlarmsAfterMutation();
        await loadShares('refresh');
        Alert.alert(
          '차단했어요',
          '이 사용자의 기존 공유를 숨겼고 새로운 공유와 초대도 받지 않습니다.',
        );
      } catch (blockError) {
        Alert.alert('차단 실패', getErrorMessage(blockError));
      } finally {
        if (mountedRef.current) setSafetyPendingKey(null);
      }
    },
    [loadShares, safetyPendingKey],
  );

  const openSafetyActions = useCallback(
    (item: ShareLibraryItem) => {
      if (item.relation !== 'received' || item.isPending || safetyPendingKey) return;
      Alert.alert(
        '신고 또는 차단',
        `${ownerLabel(item)} 사용자의 공유에 대해 어떤 조치를 할까요?`,
        [
          { text: '취소', style: 'cancel' },
          {
            text: '신고하기',
            onPress: () => setReportItem(item),
          },
          {
            text: '차단하기',
            style: 'destructive',
            onPress: () => {
              Alert.alert(
                '사용자 차단',
                '기존 공유가 즉시 숨겨지고 이 사용자와의 새로운 공유도 차단됩니다.',
                [
                  { text: '취소', style: 'cancel' },
                  {
                    text: '차단',
                    style: 'destructive',
                    onPress: () => blockShareOwner(item).catch(() => undefined),
                  },
                ],
              );
            },
          },
        ],
      );
    },
    [blockShareOwner, safetyPendingKey],
  );

  const openComposer = useCallback((item: ShareLibraryItem) => {
    setManagedItemKey(null);
    if (composerTimerRef.current) clearTimeout(composerTimerRef.current);
    composerTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setComposerItem(item);
    }, 260);
  }, []);

  const updateComposerCalendarMode = useCallback(
    async (nextMode: ScheduleShareContentMode) => {
      if (!composerItem || composerItem.resourceType !== 'CALENDAR') return;
      await updateCalendarContentModeWithAlarmRecovery(
        composerItem.resourceId,
        composerItem.contentMode,
        nextMode,
      );
      setComposerItem(current =>
        current
          ? {
              ...current,
              contentMode: nextMode,
            }
          : current,
      );
    },
    [composerItem],
  );

  const hasModal =
    filterSheetOpen ||
    Boolean(managedItem) ||
    Boolean(composerItem) ||
    Boolean(reportItem);
  const resultCount =
    selectedFilter.query.trim() || activeFilterCount > 0
      ? visibleItems.length
      : tabTotal;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={mode === 'dark' ? 'light-content' : 'dark-content'}
      />
      <View
        style={[styles.screen, { paddingTop: insets.top }]}
        accessibilityElementsHidden={hasModal}
        importantForAccessibility={hasModal ? 'no-hide-descendants' : 'auto'}
      >
        <View style={styles.header}>
          <CalendarGlassSurface
            interactive
            clear
            glow
            variant="bottomBar"
            tone="softGlass"
            style={[styles.headerGlassButton, { borderColor: colors.border }]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="뒤로 가기"
              onPress={goBack}
              style={({ pressed }) => [
                styles.headerButton,
                { opacity: pressed ? 0.62 : 1 },
              ]}
            >
              <Ionicons
                name="chevron-back"
                size={24}
                color={colors.textPrimary}
              />
            </Pressable>
          </CalendarGlassSurface>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
            공유함
          </Text>
          <View style={styles.headerActions}>
            <CalendarGlassSurface
              interactive
              clear
              glow
              variant="bottomBar"
              tone="softGlass"
              style={[styles.headerGlassButton, { borderColor: colors.border }]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="내 신고 내역"
                onPress={() => router.push('/share/reports')}
                style={({ pressed }) => [
                  styles.headerButton,
                  { opacity: pressed ? 0.62 : 1 },
                ]}
              >
                <Ionicons name="flag-outline" size={20} color={colors.textPrimary} />
              </Pressable>
            </CalendarGlassSurface>
            <CalendarGlassSurface
              interactive
              clear
              glow
              variant="bottomBar"
              tone="softGlass"
              style={[styles.headerGlassButton, { borderColor: colors.border }]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="차단한 사용자 관리"
                onPress={() => router.push('/share/blocked')}
                style={({ pressed }) => [
                  styles.headerButton,
                  { opacity: pressed ? 0.62 : 1 },
                ]}
              >
                <Ionicons name="shield-checkmark-outline" size={20} color={colors.textPrimary} />
              </Pressable>
            </CalendarGlassSurface>
            <CalendarGlassSurface
              interactive
              clear
              glow
              variant="bottomBar"
              tone="softGlass"
              style={[styles.headerGlassButton, { borderColor: colors.border }]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="공유함 새로고침"
                disabled={refreshing}
                onPress={() => loadShares('refresh')}
                style={({ pressed }) => [
                  styles.headerButton,
                  { opacity: refreshing ? 0.42 : pressed ? 0.62 : 1 },
                ]}
              >
                <Ionicons name="refresh" size={21} color={colors.textPrimary} />
              </Pressable>
            </CalendarGlassSurface>
          </View>
        </View>

        <CalendarGlassSurface
          clear
          variant="bottomBar"
          tone="softGlass"
          style={[styles.tabSurface, { borderColor: colors.border }]}
        >
          <View accessibilityRole="tablist" style={styles.tabBar}>
            <ShareTabButton
              label="일정"
              count={unseenCounts.schedule}
              selected={selectedTab === 'schedule'}
              accent={accent}
              colors={colors}
              onPress={() => setSelectedTab('schedule')}
            />
            <ShareTabButton
              label="캘린더"
              count={unseenCounts.calendar}
              selected={selectedTab === 'calendar'}
              accent={accent}
              colors={colors}
              onPress={() => setSelectedTab('calendar')}
            />
          </View>
        </CalendarGlassSurface>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadShares('refresh')}
              tintColor={accent}
            />
          }
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom, 18) + 24 },
          ]}
        >
          <View style={styles.searchTools}>
            <View
              style={[
                styles.searchField,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.inputBorder,
                },
              ]}
            >
              <Ionicons name="search" size={19} color={colors.textSecondary} />
              <TextInput
                ref={searchInputRef}
                value={selectedFilter.query}
                onChangeText={updateQuery}
                placeholder={
                  selectedTab === 'schedule'
                    ? '일정 또는 공유자 검색'
                    : '캘린더 또는 소유자 검색'
                }
                placeholderTextColor={colors.inputPlaceholder}
                returnKeyType="search"
                clearButtonMode="while-editing"
                style={[styles.searchInput, { color: colors.textPrimary }]}
              />
            </View>
            <CalendarGlassSurface
              interactive
              clear
              variant="bottomBar"
              tone="softGlass"
              style={[styles.filterSurface, { borderColor: colors.border }]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`공유 목록 필터${
                  activeFilterCount > 0
                    ? `, ${activeFilterCount}개 적용됨`
                    : ''
                }`}
                onPress={() => setFilterSheetOpen(true)}
                style={({ pressed }) => [
                  styles.filterIconButton,
                  { opacity: pressed ? 0.62 : 1 },
                ]}
              >
                <Ionicons
                  name="options-outline"
                  size={20}
                  color={
                    activeFilterCount > 0 ? accent : colors.textPrimary
                  }
                />
                {activeFilterCount > 0 ? (
                  <View
                    style={[
                      styles.filterCount,
                      {
                        backgroundColor: accent,
                        borderColor: colors.background,
                      },
                    ]}
                  >
                    <Text style={styles.filterCountText}>
                      {activeFilterCount}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            </CalendarGlassSurface>
          </View>

          <View style={styles.listToolbar}>
            <Text style={[styles.resultLabel, { color: colors.textSecondary }]}>
              {selectedTab === 'schedule' ? '공유 일정' : '공유 캘린더'}
              {' · '}
              {resultCount}개
            </Text>
            {selectedTab === 'calendar' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="공유 캘린더 만들기 및 관리"
                onPress={() => router.push('/schedule/calendars')}
                style={({ pressed }) => [
                  styles.calendarManageAction,
                  { borderColor: colors.border, opacity: pressed ? 0.62 : 1 },
                ]}
              >
                <Ionicons name="add" size={16} color={accent} />
                <Text style={[styles.calendarManageActionText, { color: accent }]}>캘린더 관리</Text>
              </Pressable>
            ) : null}
          </View>

          {error && data ? (
            <InlineErrorCard
              colors={colors}
              text={error}
              onRetry={() => loadShares('refresh')}
            />
          ) : null}

          {loading ? (
            <StateView
              colors={colors}
              text="공유함을 불러오는 중이에요"
              loading
            />
          ) : error && !data ? (
            <StateView
              colors={colors}
              text={error}
              onRetry={() => loadShares('refresh')}
            />
          ) : visibleItems.length === 0 ? (
            <EmptyState
              colors={colors}
              searching={
                Boolean(selectedFilter.query.trim()) || activeFilterCount > 0
              }
              tab={selectedTab}
            />
          ) : selectedTab === 'schedule' ? (
            <View style={styles.groupStack}>
              {scheduleGroups.map(group => (
                <View key={group.label} style={styles.listGroup}>
                  <Text
                    style={[styles.groupTitle, { color: colors.textSecondary }]}
                  >
                    {group.label}
                  </Text>
                  <View style={styles.shareCardStack}>
                    {group.items.map(item => (
                      <ScheduleShareRow
                        key={item.key}
                        item={item}
                        colors={colors}
                        accent={accent}
                        onOpen={() => openSharedResource(item)}
                        onManage={() => setManagedItemKey(item.key)}
                        onSafety={() => openSafetyActions(item)}
                        safetyPending={safetyPendingKey === item.key}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.calendarList}>
              {visibleItems.map(item => (
                <CalendarShareRow
                  key={item.key}
                  item={item}
                  colors={colors}
                  accent={accent}
                  onOpen={() => openSharedResource(item)}
                  onManage={() => setManagedItemKey(item.key)}
                  onSafety={() => openSafetyActions(item)}
                  safetyPending={safetyPendingKey === item.key}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </View>

      <FilterSheet
        visible={filterSheetOpen}
        tab={selectedTab}
        filter={selectedFilter}
        colors={colors}
        accent={accent}
        bottomInset={insets.bottom}
        onClose={() => setFilterSheetOpen(false)}
        onApply={nextFilter => {
          setFilters(current => ({
            ...current,
            [selectedTab]: {
              ...nextFilter,
              query: current[selectedTab].query,
            },
          }));
          setFilterSheetOpen(false);
        }}
      />

      <ManageShareSheet
        item={managedItem}
        colors={colors}
        accent={accent}
        bottomInset={insets.bottom}
        revokingShareId={revokingShareId}
        revokingInvitationId={revokingInvitationId}
        onClose={() => setManagedItemKey(null)}
        onOpenResource={() => {
          if (!managedItem) return;
          setManagedItemKey(null);
          openSharedResource(managedItem);
        }}
        onOpenComposer={() => {
          if (managedItem) openComposer(managedItem);
        }}
        onRevokeShare={share => {
          if (managedItem) revokeDirectShare(managedItem, share);
        }}
        onRevokeInvitation={revokeInvitation}
      />

      <ShareInvitationSheet
        visible={Boolean(composerItem)}
        resourceType={resourceTypeForComposer(
          composerItem?.resourceType ?? 'SCHEDULE',
        )}
        resourceId={composerItem?.resourceId}
        title={composerItem?.title ?? '공유 항목'}
        subtitle={
          composerItem
            ? `${resourceLabel(composerItem.resourceType)} · ${contentModeLabel(
                composerItem.contentMode,
              )}`
            : undefined
        }
        initialContentMode={composerItem?.contentMode ?? 'SCHEDULE_ONLY'}
        onCalendarContentModeChange={
          composerItem?.resourceType === 'CALENDAR'
            ? updateComposerCalendarMode
            : undefined
        }
        onClose={() => {
          setComposerItem(null);
          loadShares('refresh').catch(() => undefined);
        }}
      />

      <SharingReportModal
        visible={Boolean(reportItem)}
        owner={reportItem ? ownerLabel(reportItem) : '공유자'}
        colors={colors}
        accent={accent}
        pending={Boolean(reportItem && safetyPendingKey === reportItem.key)}
        onClose={() => {
          if (!safetyPendingKey) setReportItem(null);
        }}
        onSubmit={async (reason, details) => {
          if (reportItem) await submitSafetyReport(reportItem, reason, details);
        }}
      />
    </View>
  );
}

function ShareTabButton({
  label,
  count,
  selected,
  accent,
  colors,
  onPress,
}: {
  label: string;
  count: number;
  selected: boolean;
  accent: string;
  colors: AppColors;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}${count > 0 ? `, 미확인 ${count}개` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tabButton,
        selected && {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
        { opacity: pressed ? 0.68 : 1 },
      ]}
    >
      <View style={styles.tabLabelRow}>
        <Text
          style={[
            styles.tabLabel,
            { color: selected ? colors.textPrimary : colors.textSecondary },
          ]}
        >
          {label}
        </Text>
        {count > 0 ? (
          <View
            style={[
              styles.tabCount,
              { backgroundColor: selected ? `${accent}1A` : colors.surface2 },
            ]}
          >
            <Text
              style={[
                styles.tabCountText,
                { color: selected ? accent : colors.textSecondary },
              ]}
            >
              {count > 99 ? '99+' : count}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function ScheduleShareRow({
  item,
  colors,
  accent,
  onOpen,
  onManage,
  onSafety,
  safetyPending,
}: {
  item: ShareLibraryItem;
  colors: AppColors;
  accent: string;
  onOpen: () => void;
  onManage: () => void;
  onSafety: () => void;
  safetyPending: boolean;
}) {
  const itemColor = shareItemColor(item, accent);
  const location = scheduleLocationLabel(item.schedule);
  const dateTime = `${formatScheduleDate(
    item.schedule,
  )} · ${formatScheduleTimeRange(item.schedule)}`;
  const scheduleMeta = [dateTime, location].filter(Boolean).join(' · ');
  const timeRange = formatScheduleTimeRange(item.schedule);
  const relationMeta =
    item.relation === 'owned'
      ? item.shareCount > 0
        ? `내가 공유 · ${item.shareCount}명`
        : `활성 링크 · ${item.activeInvitations.length}개`
      : item.isPending
      ? `${ownerLabel(item)}에게 받음`
      : `${ownerLabel(item)}에게 받음`;
  const departureColor =
    item.departedCount && item.departedCount > 0
      ? DEPARTURE_GREEN
      : colors.textSecondary;
  const cardStatus =
    item.isPending
      ? {
          icon: 'hourglass-outline' as const,
          label: '수락 대기',
          color: colors.textSecondary,
        }
      : item.routeState === 'needed'
      ? {
          icon: 'navigate-outline' as const,
          label: '경로 필요',
          color: ROUTE_AMBER,
        }
      : item.relation === 'owned' && item.departureSummary
      ? {
          icon: 'walk-outline' as const,
          label: item.departureSummary,
          color: departureColor,
        }
      : item.routeState === 'ready'
      ? {
          icon: 'navigate-circle-outline' as const,
          label: '경로 등록',
          color: accent,
        }
      : null;
  const eyebrowMeta = `${formatScheduleDate(item.schedule)} · ${relationMeta}`;

  return (
    <CalendarGlassSurface
      prominent
      variant="card"
      tone="solidCard"
      style={[
        styles.shareCard,
        { borderColor: colors.border },
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.shareCardRail, { backgroundColor: itemColor }]}
      />
      <ShareInboxButton
        accessibilityLabel={`${item.title}, ${scheduleMeta}, ${relationMeta}${
          cardStatus ? `, ${cardStatus.label}` : ''
        }, 열기`}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.shareCardOpenButton,
          { opacity: pressed ? 0.62 : 1 },
        ]}
      >
        <View style={styles.shareCardCopy}>
          <View style={styles.cardEyebrowRow}>
            <Ionicons
              accessible={false}
              name="people-outline"
              size={14}
              color={itemColor}
            />
            <Text
              style={[styles.cardEyebrow, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {eyebrowMeta}
            </Text>
          </View>
          <View style={styles.scheduleTitleTimeRow}>
            <View style={styles.scheduleTitleLine}>
              <Text
                style={[styles.shareCardTitle, { color: colors.textPrimary }]}
                numberOfLines={1}
              >
                {item.title}
              </Text>
              {item.isUnseen ? (
                <View
                  accessibilityLabel="새 공유"
                  style={[styles.unreadDot, { backgroundColor: accent }]}
                />
              ) : null}
            </View>
            <Text
              style={[styles.scheduleTimeRange, { color: colors.textPrimary }]}
              numberOfLines={1}
            >
              {timeRange}
            </Text>
          </View>
          {location || cardStatus ? (
            <View style={styles.scheduleCardBottomLine}>
              {location ? (
                <View style={styles.scheduleCardLocation}>
                  <Ionicons
                    accessible={false}
                    name="location-outline"
                    size={14}
                    color={colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.scheduleCardLocationText,
                      { color: colors.textSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    {location}
                  </Text>
                </View>
              ) : null}
              {cardStatus ? (
                <View style={styles.scheduleCardStatus}>
                  <Ionicons
                    accessible={false}
                    name={cardStatus.icon}
                    size={13}
                    color={cardStatus.color}
                  />
                  <Text
                    style={[
                      styles.scheduleCardStatusText,
                      { color: cardStatus.color },
                    ]}
                    numberOfLines={1}
                  >
                    {cardStatus.label}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </ShareInboxButton>

      <View style={styles.shareCardAction}>
        {item.relation === 'owned' ? (
          <ShareInboxButton
            accessibilityLabel={`${item.title} 공유 관리`}
            onPress={onManage}
            style={({ pressed }) => [
              styles.moreButton,
              { opacity: pressed ? 0.52 : 1 },
            ]}
          >
            <ShareInboxDecoration>
              <Ionicons
                name="ellipsis-horizontal"
                size={20}
                color={colors.textSecondary}
              />
            </ShareInboxDecoration>
          </ShareInboxButton>
        ) : item.isPending ? (
          <ShareInboxDecoration>
            <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
          </ShareInboxDecoration>
        ) : (
          <ShareInboxButton
            accessibilityLabel={`${item.title} 신고 또는 사용자 차단`}
            accessibilityState={{ busy: safetyPending, disabled: safetyPending }}
            disabled={safetyPending}
            onPress={onSafety}
            style={({ pressed }) => [
              styles.moreButton,
              { opacity: safetyPending ? 0.42 : pressed ? 0.52 : 1 },
            ]}
          >
            <ShareInboxDecoration>
              {safetyPending ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
              )}
            </ShareInboxDecoration>
          </ShareInboxButton>
        )}
      </View>
    </CalendarGlassSurface>
  );
}

function CalendarShareRow({
  item,
  colors,
  accent,
  onOpen,
  onManage,
  onSafety,
  safetyPending,
}: {
  item: ShareLibraryItem;
  colors: AppColors;
  accent: string;
  onOpen: () => void;
  onManage: () => void;
  onSafety: () => void;
  safetyPending: boolean;
}) {
  const itemColor = item.color || accent;
  const ownedMemberCount =
    item.shareCount > 0
      ? item.shareCount
      : Math.max(0, (item.memberCount ?? 1) - 1);
  const relationMeta =
    item.relation === 'owned'
      ? ownedMemberCount > 0
        ? `내 캘린더 · ${ownedMemberCount}명과 공유 중`
        : `내 캘린더 · 활성 링크 ${item.activeInvitations.length}개`
      : item.isPending
      ? `${ownerLabel(item)}에게 받음 · 수락 대기`
      : `${ownerLabel(item)}에게 받음 · ${permissionLabel(
          item.permission,
        )} 권한`;
  const nextMeta = item.nextSchedule
    ? `${item.nextSchedule.title} · ${formatShortDate(
        item.nextSchedule.startAt,
      )} ${formatScheduleTimeRange(item.nextSchedule)}`
    : '예정된 다음 일정이 없어요';
  const calendarMode = contentModeLabel(item.contentMode);
  const calendarModeIcon =
    item.contentMode === 'SCHEDULE_AND_TRAVEL'
      ? ('navigate-outline' as const)
      : ('calendar-outline' as const);

  return (
    <CalendarGlassSurface
      prominent
      variant="card"
      tone="solidCard"
      style={[
        styles.shareCard,
        styles.calendarShareCard,
        { borderColor: colors.border },
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.shareCardRail, { backgroundColor: itemColor }]}
      />
      <ShareInboxButton
        accessibilityLabel={`${item.title}, ${relationMeta}, ${calendarMode}, ${nextMeta}, 열기`}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.shareCardOpenButton,
          styles.calendarCardOpenButton,
          { opacity: pressed ? 0.62 : 1 },
        ]}
      >
        <View style={styles.shareCardCopy}>
          <View style={styles.cardEyebrowRow}>
            <Ionicons
              accessible={false}
              name="people-outline"
              size={14}
              color={itemColor}
            />
            <Text
              style={[styles.cardEyebrow, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {relationMeta}
            </Text>
            <View style={styles.cardTopStatus}>
              <Ionicons
                accessible={false}
                name={calendarModeIcon}
                size={13}
                color={itemColor}
              />
              <Text
                style={[styles.cardTopStatusText, { color: itemColor }]}
                numberOfLines={1}
              >
                {calendarMode}
              </Text>
            </View>
          </View>
          <View style={styles.titleLine}>
            <Text
              style={[styles.shareCardTitle, { color: colors.textPrimary }]}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            {item.isUnseen ? (
              <View
                accessibilityLabel="새 공유"
                style={[styles.unreadDot, { backgroundColor: accent }]}
              />
            ) : null}
          </View>
          <View style={styles.cardDetailLine}>
            <Ionicons
              accessible={false}
              name="time-outline"
              size={16}
              color={colors.textSecondary}
            />
            <Text
              style={[styles.cardDetailText, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {nextMeta}
            </Text>
          </View>
        </View>
      </ShareInboxButton>

      <View style={styles.shareCardAction}>
        {item.relation === 'owned' ? (
          <ShareInboxButton
            accessibilityLabel={`${item.title} 공유 관리`}
            onPress={onManage}
            style={({ pressed }) => [
              styles.moreButton,
              { opacity: pressed ? 0.52 : 1 },
            ]}
          >
            <ShareInboxDecoration>
              <Ionicons
                name="ellipsis-horizontal"
                size={20}
                color={colors.textSecondary}
              />
            </ShareInboxDecoration>
          </ShareInboxButton>
        ) : item.isPending ? (
          <ShareInboxDecoration>
            <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
          </ShareInboxDecoration>
        ) : (
          <ShareInboxButton
            accessibilityLabel={`${item.title} 신고 또는 사용자 차단`}
            accessibilityState={{ busy: safetyPending, disabled: safetyPending }}
            disabled={safetyPending}
            onPress={onSafety}
            style={({ pressed }) => [
              styles.moreButton,
              { opacity: safetyPending ? 0.42 : pressed ? 0.52 : 1 },
            ]}
          >
            <ShareInboxDecoration>
              {safetyPending ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
              )}
            </ShareInboxDecoration>
          </ShareInboxButton>
        )}
      </View>
    </CalendarGlassSurface>
  );
}

function FilterSheet({
  visible,
  tab,
  filter,
  colors,
  accent,
  bottomInset,
  onClose,
  onApply,
}: {
  visible: boolean;
  tab: ShareLibraryTab;
  filter: ShareLibraryFilter;
  colors: AppColors;
  accent: string;
  bottomInset: number;
  onClose: () => void;
  onApply: (filter: ShareLibraryFilter) => void;
}) {
  const [draft, setDraft] = useState<ShareLibraryFilter>(filter);

  useEffect(() => {
    if (visible) setDraft(filter);
  }, [filter, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.modalRoot} accessibilityViewIsModal>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="필터 닫기"
          onPress={onClose}
          style={styles.modalBackdrop}
        />
        <View
          style={[
            styles.filterSheet,
            {
              backgroundColor: colors.surface,
              paddingBottom: Math.max(bottomInset, 14) + 12,
            },
          ]}
        >
          <View
            style={[styles.sheetHandle, { backgroundColor: colors.border }]}
          />
          <View style={styles.sheetHeading}>
            <Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>
              목록 필터
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                setDraft({
                  ...DEFAULT_FILTER,
                  query: filter.query,
                })
              }
              style={styles.resetButton}
            >
              <Text style={[styles.resetButtonText, { color: accent }]}>
                초기화
              </Text>
            </Pressable>
          </View>

          <FilterGroup title="공유 관계" colors={colors}>
            <SegmentControl
              value={draft.relation}
              options={[
                ['all', '전체'],
                ['received', '받은 공유'],
                ['owned', '내가 공유'],
              ]}
              colors={colors}
              accent={accent}
              onChange={relation =>
                setDraft(current => ({
                  ...current,
                  relation: relation as ShareLibraryRelation,
                }))
              }
            />
          </FilterGroup>

          {tab === 'schedule' ? (
            <FilterGroup title="일정 상태" colors={colors}>
              <SegmentControl
                value={draft.status}
                options={[
                  ['all', '전체'],
                  ['routeNeeded', '경로 필요'],
                  ['departure', '출발 현황'],
                ]}
                colors={colors}
                accent={accent}
                onChange={status =>
                  setDraft(current => ({
                    ...current,
                    status: status as ShareLibraryStatus,
                  }))
                }
              />
            </FilterGroup>
          ) : null}

          <FilterGroup title="정렬" colors={colors}>
            <SortOption
              selected={draft.sort === 'upcoming'}
              title={tab === 'schedule' ? '가까운 일정순' : '다음 일정순'}
              description="다가오는 공유부터 표시"
              colors={colors}
              accent={accent}
              onPress={() =>
                setDraft(current => ({
                  ...current,
                  sort: 'upcoming',
                }))
              }
            />
            <SortOption
              selected={draft.sort === 'recent'}
              title="최근 공유순"
              description="새로 공유된 항목부터 표시"
              colors={colors}
              accent={accent}
              onPress={() =>
                setDraft(current => ({
                  ...current,
                  sort: 'recent',
                }))
              }
            />
          </FilterGroup>

          <Pressable
            accessibilityRole="button"
            onPress={() =>
              onApply({
                ...draft,
                sort: draft.sort as ShareLibrarySort,
              })
            }
            style={({ pressed }) => [
              styles.applyButton,
              {
                backgroundColor: accent,
                opacity: pressed ? 0.76 : 1,
              },
            ]}
          >
            <Ionicons name="checkmark" size={19} color="#FFFFFF" />
            <Text style={styles.applyButtonText}>적용</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function FilterGroup({
  title,
  colors,
  children,
}: {
  title: string;
  colors: AppColors;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.filterGroup}>
      <Text style={[styles.filterGroupTitle, { color: colors.textPrimary }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function SegmentControl({
  value,
  options,
  colors,
  accent,
  onChange,
}: {
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  colors: AppColors;
  accent: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={[styles.segmentControl, { backgroundColor: colors.surface2 }]}>
      {options.map(([optionValue, label]) => {
        const selected = optionValue === value;
        return (
          <Pressable
            key={optionValue}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(optionValue)}
            style={[
              styles.segmentOption,
              selected && {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.segmentOptionText,
                { color: selected ? accent : colors.textSecondary },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SortOption({
  selected,
  title,
  description,
  colors,
  accent,
  onPress,
}: {
  selected: boolean;
  title: string;
  description: string;
  colors: AppColors;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.sortOption, { borderBottomColor: colors.border }]}
    >
      <View style={styles.sortCopy}>
        <Text style={[styles.sortTitle, { color: colors.textPrimary }]}>
          {title}
        </Text>
        <Text style={[styles.sortDescription, { color: colors.textSecondary }]}>
          {description}
        </Text>
      </View>
      <View
        style={[
          styles.radioCircle,
          {
            borderColor: selected ? accent : colors.border,
            backgroundColor: selected ? accent : undefined,
          },
          !selected && styles.transparentBackground,
        ]}
      >
        {selected ? (
          <Ionicons name="checkmark" size={13} color="#FFFFFF" />
        ) : null}
      </View>
    </Pressable>
  );
}

function ManageShareSheet({
  item,
  colors,
  accent,
  bottomInset,
  revokingShareId,
  revokingInvitationId,
  onClose,
  onOpenResource,
  onOpenComposer,
  onRevokeShare,
  onRevokeInvitation,
}: {
  item: ShareLibraryItem | null;
  colors: AppColors;
  accent: string;
  bottomInset: number;
  revokingShareId: string | null;
  revokingInvitationId: string | null;
  onClose: () => void;
  onOpenResource: () => void;
  onOpenComposer: () => void;
  onRevokeShare: (share: ScheduleShare) => void;
  onRevokeInvitation: (invitation: ShareInvitationSummary) => void;
}) {
  const editorCount =
    item?.shares.filter(share => share.permission === 'EDITOR').length ?? 0;
  const viewerCount = Math.max(0, (item?.shares.length ?? 0) - editorCount);
  const itemColor = item?.color || accent;

  return (
    <Modal
      visible={Boolean(item)}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.modalRoot} accessibilityViewIsModal>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="공유 관리 닫기"
          onPress={onClose}
          style={styles.modalBackdrop}
        />
        {item ? (
          <View
            style={[
              styles.manageSheet,
              {
                backgroundColor: colors.surface,
                paddingBottom: Math.max(bottomInset, 14) + 8,
              },
            ]}
          >
            <View
              style={[styles.sheetHandle, { backgroundColor: colors.border }]}
            />
            <View style={styles.manageHeader}>
              <View
                style={[
                  styles.manageResourceIcon,
                  { backgroundColor: `${itemColor}18` },
                ]}
              >
                <Ionicons
                  name={
                    item.tab === 'schedule'
                      ? 'calendar-outline'
                      : 'calendar-clear-outline'
                  }
                  size={21}
                  color={itemColor}
                />
              </View>
              <View style={styles.manageHeaderCopy}>
                <Text
                  numberOfLines={1}
                  style={[styles.manageTitle, { color: colors.textPrimary }]}
                >
                  {item.title}
                </Text>
                <Text
                  style={[styles.manageMeta, { color: colors.textSecondary }]}
                >
                  내가 공유 · {item.shareCount}명
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="공유 관리 닫기"
                onPress={onClose}
                style={[
                  styles.closeButton,
                  { backgroundColor: colors.surface2 },
                ]}
              >
                <Ionicons name="close" size={21} color={colors.textPrimary} />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.manageContent}
            >
              <ManageAction
                icon="person-add-outline"
                title="공유 대상 추가"
                description="이메일 또는 앱 ID, 링크로 초대"
                colors={colors}
                accent={accent}
                onPress={onOpenComposer}
              />
              <ManageAction
                icon={
                  item.tab === 'schedule'
                    ? 'navigate-outline'
                    : 'options-outline'
                }
                title={item.tab === 'schedule' ? '공유 범위' : '기본 공유 범위'}
                description={contentModeLabel(item.contentMode)}
                colors={colors}
                accent={accent}
                onPress={onOpenResource}
              />

              <View
                style={[
                  styles.manageSection,
                  { borderTopColor: colors.border },
                ]}
              >
                <View style={styles.manageSectionHeading}>
                  <View style={styles.manageSectionTitleRow}>
                    <Ionicons
                      name="people-outline"
                      size={18}
                      color={colors.textPrimary}
                    />
                    <Text
                      style={[
                        styles.manageSectionTitle,
                        { color: colors.textPrimary },
                      ]}
                    >
                      공유 대상
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.manageSectionCount,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {item.shares.length}명 · 편집 {editorCount} · 보기{' '}
                    {viewerCount}
                  </Text>
                </View>

                {item.shares.length === 0 ? (
                  <Text
                    style={[
                      styles.manageEmptyText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    아직 공유를 수락한 사람이 없어요.
                  </Text>
                ) : (
                  item.shares.map((share, index) => {
                    const target =
                      share.targetEmail?.trim() ||
                      `NoLate ID #${share.targetMemberId}`;
                    const revoking = revokingShareId === share.id;
                    return (
                      <View
                        key={share.id}
                        style={[
                          styles.memberRow,
                          index > 0 && styles.memberRowDivider,
                          { borderTopColor: colors.border },
                        ]}
                      >
                        <View
                          style={[
                            styles.memberAvatar,
                            { backgroundColor: `${accent}18` },
                          ]}
                        >
                          <Text
                            style={[styles.memberAvatarText, { color: accent }]}
                          >
                            {target.slice(0, 1).toUpperCase()}
                          </Text>
                        </View>
                        <View style={styles.memberCopy}>
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.memberName,
                              { color: colors.textPrimary },
                            ]}
                          >
                            {target}
                          </Text>
                          <Text
                            style={[
                              styles.memberPermission,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {permissionLabel(share.permission)} 권한
                          </Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${target} 공유 해제`}
                          accessibilityState={{
                            disabled: Boolean(revokingShareId),
                            busy: revoking,
                          }}
                          disabled={Boolean(revokingShareId)}
                          onPress={() => onRevokeShare(share)}
                          style={({ pressed }) => [
                            styles.memberActionButton,
                            { opacity: pressed || revokingShareId ? 0.5 : 1 },
                          ]}
                        >
                          {revoking ? (
                            <ActivityIndicator
                              size="small"
                              color={colors.textSecondary}
                            />
                          ) : (
                            <Ionicons
                              name="person-remove-outline"
                              size={19}
                              color={colors.textSecondary}
                            />
                          )}
                        </Pressable>
                      </View>
                    );
                  })
                )}
              </View>

              {item.activeInvitations.length > 0 ? (
                <View
                  style={[
                    styles.manageSection,
                    { borderTopColor: colors.border },
                  ]}
                >
                  <View style={styles.manageSectionHeading}>
                    <View style={styles.manageSectionTitleRow}>
                      <Ionicons
                        name="link-outline"
                        size={18}
                        color={colors.textPrimary}
                      />
                      <Text
                        style={[
                          styles.manageSectionTitle,
                          { color: colors.textPrimary },
                        ]}
                      >
                        활성 링크
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.manageSectionCount,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {item.activeInvitations.length}개
                    </Text>
                  </View>
                  {item.activeInvitations.map((invitation, index) => {
                    const revoking = revokingInvitationId === invitation.id;
                    return (
                      <View
                        key={invitation.id}
                        style={[
                          styles.linkManageRow,
                          index > 0 && styles.memberRowDivider,
                          { borderTopColor: colors.border },
                        ]}
                      >
                        <View style={styles.memberCopy}>
                          <Text
                            style={[
                              styles.memberName,
                              { color: colors.textPrimary },
                            ]}
                          >
                            {permissionLabel(invitation.permission)} 링크
                          </Text>
                          <Text
                            style={[
                              styles.memberPermission,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {invitation.acceptedCount}/
                            {invitation.maxAcceptCount}명 ·{' '}
                            {formatExpiration(invitation.expiresAt)}
                          </Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${item.title} 공유 링크 비활성화`}
                          accessibilityState={{
                            disabled: Boolean(revokingInvitationId),
                            busy: revoking,
                          }}
                          disabled={Boolean(revokingInvitationId)}
                          onPress={() => onRevokeInvitation(invitation)}
                          style={({ pressed }) => [
                            styles.memberActionButton,
                            {
                              opacity:
                                pressed || revokingInvitationId ? 0.5 : 1,
                            },
                          ]}
                        >
                          {revoking ? (
                            <ActivityIndicator
                              size="small"
                              color={colors.textSecondary}
                            />
                          ) : (
                            <Ionicons
                              name="unlink-outline"
                              size={19}
                              color={colors.textSecondary}
                            />
                          )}
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </ScrollView>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function ManageAction({
  icon,
  title,
  description,
  colors,
  accent,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  colors: AppColors;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${description}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.manageAction,
        {
          borderBottomColor: colors.border,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <View
        style={[styles.manageActionIcon, { backgroundColor: `${accent}16` }]}
      >
        <Ionicons name={icon} size={20} color={accent} />
      </View>
      <View style={styles.manageActionCopy}>
        <Text style={[styles.manageActionTitle, { color: colors.textPrimary }]}>
          {title}
        </Text>
        <Text
          style={[
            styles.manageActionDescription,
            { color: colors.textSecondary },
          ]}
        >
          {description}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={colors.textDisabled} />
    </Pressable>
  );
}

function InlineErrorCard({
  colors,
  text,
  onRetry,
}: {
  colors: AppColors;
  text: string;
  onRetry: () => void;
}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.inlineError,
        { backgroundColor: colors.surface2, borderColor: colors.border },
      ]}
    >
      <Ionicons name="alert-circle-outline" size={18} color={ROUTE_AMBER} />
      <Text
        numberOfLines={2}
        style={[styles.inlineErrorText, { color: colors.textSecondary }]}
      >
        {text}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="공유함 다시 조회"
        onPress={onRetry}
        hitSlop={8}
      >
        <Text style={[styles.inlineRetryText, { color: colors.textPrimary }]}>
          다시 시도
        </Text>
      </Pressable>
    </View>
  );
}

function EmptyState({
  colors,
  searching,
  tab,
}: {
  colors: AppColors;
  searching: boolean;
  tab: ShareLibraryTab;
}) {
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.surface2 }]}>
        <Ionicons
          name={
            searching
              ? 'search-outline'
              : tab === 'schedule'
              ? 'calendar-outline'
              : 'calendar-clear-outline'
          }
          size={25}
          color={colors.textSecondary}
        />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>
        {searching
          ? '검색 결과가 없어요'
          : tab === 'schedule'
          ? '공유 일정이 없어요'
          : '공유 캘린더가 없어요'}
      </Text>
      <Text style={[styles.emptyDescription, { color: colors.textSecondary }]}>
        {searching
          ? '다른 이름이나 공유자를 입력해 보세요.'
          : '공유받거나 내가 공유한 항목이 여기에 모여요.'}
      </Text>
    </View>
  );
}

function StateView({
  colors,
  text,
  loading = false,
  onRetry,
}: {
  colors: AppColors;
  text: string;
  loading?: boolean;
  onRetry?: () => void;
}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole={loading ? 'progressbar' : undefined}
      accessibilityLabel={text}
      style={styles.stateView}
    >
      {loading ? (
        <BrandedLoader
          size="section"
          variant="share"
          accessibilityLabel={text}
        />
      ) : (
        <Ionicons
          name="cloud-offline-outline"
          size={26}
          color={colors.textSecondary}
        />
      )}
      <Text style={[styles.stateText, { color: colors.textSecondary }]}>
        {text}
      </Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={[styles.stateRetryButton, { borderColor: colors.border }]}
        >
          <Text style={[styles.stateRetryText, { color: colors.textPrimary }]}>
            다시 조회
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  header: {
    minHeight: 70,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerGlassButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  headerButton: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    letterSpacing: 0,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tabSurface: {
    height: 50,
    marginHorizontal: 18,
    borderRadius: 25,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  tabBar: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  tabButton: {
    flex: 1,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabLabel: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
    letterSpacing: 0,
  },
  tabCount: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabCountText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 0,
  },
  content: {
    paddingTop: 18,
    paddingHorizontal: 18,
  },
  searchTools: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchField: {
    flex: 1,
    minWidth: 0,
    height: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 46,
    padding: 0,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: 0,
  },
  filterSurface: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  filterIconButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCount: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCountText: {
    color: '#FFFFFF',
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '900',
    letterSpacing: 0,
  },
  listToolbar: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resultLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    letterSpacing: 0,
  },
  calendarManageAction: {
    height: 34,
    borderWidth: 1,
    borderRadius: 17,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  calendarManageActionText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  groupStack: {
    gap: 28,
  },
  listGroup: {
    gap: 12,
  },
  groupTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
    letterSpacing: 0,
  },
  shareCardStack: {
    gap: 10,
  },
  calendarList: {
    gap: 10,
    paddingTop: 4,
  },
  shareCard: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  calendarShareCard: {
    minHeight: 108,
  },
  shareCardRail: {
    position: 'absolute',
    top: 14,
    bottom: 14,
    left: 0,
    width: 4,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  shareCardOpenButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 82,
    justifyContent: 'center',
    paddingVertical: 13,
    paddingLeft: 20,
    paddingRight: 2,
  },
  calendarCardOpenButton: {
    minHeight: 108,
  },
  shareCardCopy: {
    flex: 1,
    minWidth: 0,
  },
  cardEyebrowRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  cardEyebrow: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    letterSpacing: 0,
  },
  cardTopStatus: {
    maxWidth: '48%',
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardTopStatusText: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  shareCardTitle: {
    flexShrink: 1,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '900',
    letterSpacing: 0,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  scheduleTitleTimeRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  scheduleTitleLine: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scheduleTimeRange: {
    flexShrink: 0,
    marginLeft: 12,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '900',
    letterSpacing: 0,
  },
  scheduleCardBottomLine: {
    minWidth: 0,
    minHeight: 18,
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scheduleCardLocation: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  scheduleCardLocationText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    letterSpacing: 0,
  },
  scheduleCardStatus: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  scheduleCardStatusText: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  cardDetailLine: {
    minWidth: 0,
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardDetailText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    letterSpacing: 0,
  },
  shareCardAction: {
    width: 48,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    paddingTop: 5,
    paddingRight: 4,
  },
  moreButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  filterSheet: {
    width: '100%',
    maxHeight: '88%',
    paddingHorizontal: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  manageSheet: {
    width: '100%',
    maxHeight: '84%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  sheetHandle: {
    width: 42,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginTop: 9,
    marginBottom: 13,
  },
  sheetHeading: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '900',
    letterSpacing: 0,
  },
  resetButton: {
    height: 40,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetButtonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    letterSpacing: 0,
  },
  filterGroup: {
    marginTop: 18,
    gap: 9,
  },
  filterGroupTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
    letterSpacing: 0,
  },
  segmentControl: {
    height: 45,
    padding: 3,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 3,
  },
  segmentOption: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOptionText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    letterSpacing: 0,
  },
  sortOption: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sortCopy: {
    flex: 1,
    minWidth: 0,
  },
  sortTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
    letterSpacing: 0,
  },
  sortDescription: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    letterSpacing: 0,
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderWidth: 1.5,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transparentBackground: {
    backgroundColor: 'transparent',
  },
  applyButton: {
    height: 50,
    marginTop: 20,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  applyButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
    letterSpacing: 0,
  },
  manageHeader: {
    minHeight: 68,
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  manageResourceIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  manageTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
    letterSpacing: 0,
  },
  manageMeta: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    letterSpacing: 0,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  manageAction: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  manageActionIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageActionCopy: {
    flex: 1,
    minWidth: 0,
  },
  manageActionTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
    letterSpacing: 0,
  },
  manageActionDescription: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    letterSpacing: 0,
  },
  manageSection: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  manageSectionHeading: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  manageSectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  manageSectionTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
    letterSpacing: 0,
  },
  manageSectionCount: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    letterSpacing: 0,
  },
  manageEmptyText: {
    paddingVertical: 18,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    letterSpacing: 0,
  },
  memberRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  memberRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  memberAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 0,
  },
  memberCopy: {
    flex: 1,
    minWidth: 0,
  },
  memberName: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    letterSpacing: 0,
  },
  memberPermission: {
    marginTop: 1,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    letterSpacing: 0,
  },
  memberActionButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkManageRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inlineError: {
    minHeight: 54,
    marginBottom: 14,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inlineErrorText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    letterSpacing: 0,
  },
  inlineRetryText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
    letterSpacing: 0,
  },
  emptyState: {
    minHeight: 260,
    paddingHorizontal: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    marginTop: 14,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
    letterSpacing: 0,
    textAlign: 'center',
  },
  emptyDescription: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    letterSpacing: 0,
    textAlign: 'center',
  },
  stateView: {
    minHeight: 260,
    paddingHorizontal: 30,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  stateText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: 0,
    textAlign: 'center',
  },
  stateRetryButton: {
    height: 38,
    marginTop: 4,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateRetryText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    letterSpacing: 0,
  },
});
