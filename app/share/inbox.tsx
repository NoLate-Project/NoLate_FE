import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  StatusBar,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import styles from '../../src/routeSupport/share/inbox.styles';

import { getSchedules } from '../../src/api/schedule';
import {
  getScheduleCalendars,
  removeScheduleCalendarMember,
} from '../../src/api/scheduleCalendars';
import {
  getShareInbox,
  getShareOutbox,
  revokeCalendarShareInvitation,
  revokeCategoryShare,
  revokeCategoryShareInvitation,
  revokeScheduleShare,
  revokeScheduleShareInvitation,
  type ScheduleShare,
  type ShareInvitationSummary,
} from '../../src/api/scheduleSharing';
import {
  blockSharingMember,
  createSharingReport,
  type SharingReportReason,
} from '../../src/api/sharingSafety';
import { recoverDepartureAlarmsAfterMutation } from '../../src/modules/notification/departureAlarmMutationRecovery';
import {
  runAfterScreenTransition,
  type ScreenTransitionTask,
} from '../../src/modules/performance/runAfterScreenTransition';
import ShareInvitationSheet from '../../src/modules/schedule/components/share/ShareInvitationSheet';
import type { ScheduleShareContentMode } from '../../src/modules/schedule/types';
import { updateCalendarContentModeWithAlarmRecovery } from '../../src/modules/share/calendarContentModeAlarmRecovery';
import { createLatestAsyncRequestGuard } from '../../src/modules/share/latestAsyncRequest';
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
  type ShareLibraryTab,
} from '../../src/modules/share/shareInboxPresentation';
import SharingReportModal from '../../src/modules/share/SharingReportModal';
import { useTheme } from '../../src/modules/theme/ThemeContext';

import { FilterSheet } from '../../src/routeSupport/share/ShareInboxFilters';
import ShareInboxLibraryView from '../../src/routeSupport/share/ShareInboxLibraryView';
import { ManageShareSheet } from '../../src/routeSupport/share/ShareInboxManage';
import {
  BRAND_BLUE,
  contentModeLabel,
  DEFAULT_FILTER,
  getErrorMessage,
  GROUP_ORDER,
  normalizeTab,
  ownerLabel,
  resourceLabel,
  resourceTypeForComposer,
  ShareInboxViewData,
  sharingSafetyOwnerId,
} from '../../src/routeSupport/share/shareInboxModel';

/** 공유 데이터 조회, 필터 상태, 회수·신고 동작을 조율하는 공유함 화면 컨트롤러입니다. */
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
    const task = runAfterScreenTransition(() => {
      loadShares();
    });

    return () => {
      task.cancel();
      mountedRef.current = false;
      loadRequestGuard.invalidate();
      if (composerTimerRef.current) clearTimeout(composerTimerRef.current);
    };
  }, [loadShares]);

  useFocusEffect(
    useCallback(() => {
      let task: ScreenTransitionTask | null = null;
      if (hasBlurredRef.current) {
        task = runAfterScreenTransition(() => {
          loadShares('refresh').catch(() => undefined);
        });
      }
      return () => {
        task?.cancel();
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
      if (item.relation !== 'received' || item.isPending || safetyPendingKey)
        return;
      const resourceId = Number(item.resourceId);
      const ownerMemberId = sharingSafetyOwnerId(item);
      if (
        !Number.isSafeInteger(resourceId) ||
        resourceId <= 0 ||
        ownerMemberId === null
      )
        return;
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
        Alert.alert(
          '신고가 접수됐어요',
          '검토가 필요한 공유로 안전하게 접수했습니다.',
        );
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
      if (item.relation !== 'received' || item.isPending || safetyPendingKey)
        return;
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
      if (item.relation !== 'received' || item.isPending || safetyPendingKey)
        return;
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
      <ShareInboxLibraryView
        colors={colors}
        accent={accent}
        topInset={insets.top}
        bottomInset={insets.bottom}
        hasModal={hasModal}
        refreshing={refreshing}
        unseenCounts={unseenCounts}
        selectedTab={selectedTab}
        selectedFilter={selectedFilter}
        activeFilterCount={activeFilterCount}
        resultCount={resultCount}
        loading={loading}
        error={error}
        hasData={Boolean(data)}
        visibleItems={visibleItems}
        scheduleGroups={scheduleGroups}
        safetyPendingKey={safetyPendingKey}
        searchInputRef={searchInputRef}
        onGoBack={goBack}
        onOpenReports={() => router.push('/share/reports')}
        onOpenBlocked={() => router.push('/share/blocked')}
        onOpenCalendarManager={() => router.push('/schedule/calendars')}
        onRefresh={() => loadShares('refresh')}
        onSelectTab={setSelectedTab}
        onUpdateQuery={updateQuery}
        onOpenFilters={() => setFilterSheetOpen(true)}
        onOpenItem={openSharedResource}
        onManageItem={item => setManagedItemKey(item.key)}
        onSafetyItem={openSafetyActions}
      />

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
