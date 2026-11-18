import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { Easing, FadeIn, interpolateColor, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import CalendarGlassSurface from '../../modules/schedule/components/calendar/CalendarGlassSurface';
import type {
  ShareLibraryFilter,
  ShareLibraryItem,
  ShareLibraryTab,
} from '../../modules/share/shareInboxPresentation';
import type { AppColors } from '../../modules/theme/ThemeContext';
import styles from './inbox.styles';
import { EmptyState, InlineErrorCard, StateView } from './ShareInboxManage';
import {
  CalendarShareRow,
  ScheduleShareRow,
  ShareTabButton,
} from './ShareInboxRows';

const tabContentEntry = FadeIn.duration(140).reduceMotion(ReduceMotion.System);

type ShareInboxLibraryViewProps = {
  colors: AppColors;
  accent: string;
  topInset: number;
  bottomInset: number;
  hasModal: boolean;
  refreshing: boolean;
  pullRefreshing: boolean;
  unseenCounts: { schedule: number; calendar: number };
  selectedTab: ShareLibraryTab;
  selectedFilter: ShareLibraryFilter;
  activeFilterCount: number;
  resultCount: number;
  loading: boolean;
  error: string | null;
  hasData: boolean;
  visibleItems: ShareLibraryItem[];
  invitationRowKey?: string;
  reduceMotion: boolean;
  scheduleGroups: Array<{ label: string; items: ShareLibraryItem[] }>;
  safetyPendingKey: string | null;
  searchInputRef: RefObject<TextInput | null>;
  calendarManagerButtonRef?: RefObject<View | null>;
  safetyButtonRef?: RefObject<View | null>;
  onGoBack: () => void;
  onOpenSafetyManagement: () => void;
  onOpenCalendarManager: () => void;
  onRefresh: () => void;
  onPullRefresh: () => void;
  onSelectTab: (tab: ShareLibraryTab) => void;
  onUpdateQuery: (query: string) => void;
  onOpenFilters: () => void;
  onClearFilters: () => void;
  onOpenItem: (item: ShareLibraryItem) => void;
  onResourceRowRef?: (key: string, node: View | null) => void;
  onManageItem: (item: ShareLibraryItem) => void;
  onSafetyItem: (item: ShareLibraryItem) => void;
};

/**
 * 공유함의 헤더, 탭, 검색 도구와 공유 목록을 렌더링합니다.
 * 데이터 조회·변경 로직은 상위 화면에 남기고 표시와 사용자 이벤트 전달만 담당합니다.
 */
export default function ShareInboxLibraryView({
  colors,
  accent,
  topInset,
  bottomInset,
  hasModal,
  refreshing,
  pullRefreshing,
  unseenCounts,
  selectedTab,
  selectedFilter,
  activeFilterCount,
  resultCount,
  loading,
  error,
  hasData,
  visibleItems,
  invitationRowKey,
  reduceMotion,
  scheduleGroups,
  safetyPendingKey,
  searchInputRef,
  safetyButtonRef,
  calendarManagerButtonRef,
  onGoBack,
  onOpenSafetyManagement,
  onOpenCalendarManager,
  onRefresh,
  onPullRefresh,
  onSelectTab,
  onUpdateQuery,
  onOpenFilters,
  onClearFilters,
  onOpenItem,
  onResourceRowRef,
  onManageItem,
  onSafetyItem,
}: ShareInboxLibraryViewProps) {
  const largeText = useWindowDimensions().fontScale > 1.35;
  const pinnedError = !largeText && hasData ? error : null;
  const filterButton = useRef<View>(null);
  const recoveryFocus = useRef<'search' | 'filters' | null>(null);
  const [recoveryCount, setRecoveryCount] = React.useState(0);
  useEffect(() => {
    const target = recoveryFocus.current;
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      recoveryFocus.current = null;
      if (target === 'search') searchInputRef.current?.focus();
      else if (filterButton.current) AccessibilityInfo.sendAccessibilityEvent?.(filterButton.current, 'focus');
    });
    return () => cancelAnimationFrame(frame);
  }, [recoveryCount, searchInputRef]);
  const recover = (target: 'search' | 'filters', action: () => void) => {
    recoveryFocus.current = target;
    action();
    setRecoveryCount(count => count + 1);
  };
  const hasQuery = Boolean(selectedFilter.query.trim());
  const hasResettableFilters = selectedFilter.relation !== 'all'
    || (selectedTab === 'schedule' && selectedFilter.status !== 'all');
  const tabScrollOffsets = useRef<Record<ShareLibraryTab, number>>({ schedule: 0, calendar: 0 });
  const list = useRef<ScrollView>(null);
  const previousTabFilters = useRef<Partial<Record<ShareLibraryTab, ShareLibraryFilter>>>({});
  useLayoutEffect(() => {
    const { relation, status, sort } = selectedFilter;
    const previous = previousTabFilters.current[selectedTab];
    previousTabFilters.current[selectedTab] = selectedFilter;
    if (largeText || !previous || (
      previous.relation === relation && previous.status === status && previous.sort === sort
    )) return;

    tabScrollOffsets.current[selectedTab] = 0;
    list.current?.scrollTo({ y: 0, animated: false });
  }, [largeText, selectedFilter, selectedTab]);
  const listContent = useRef<View>(null);
  const invitationRow = useRef<View | null>(null);
  const revealedInvitation = useRef<string | undefined>(undefined);
  const invitationHighlight = useSharedValue(0);
  const invitationHighlightStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(invitationHighlight.value, [0, 1], ['transparent', `${accent}1F`]),
  }));
  useEffect(() => {
    if (!invitationRowKey || revealedInvitation.current === invitationRowKey) return;
    let cancelled = false;
    let focusFrame: number | undefined;
    const frame = requestAnimationFrame(() => {
      const row = invitationRow.current;
      const content = listContent.current;
      if (!row || !content) return;
      const reveal = (y?: number) => {
        if (cancelled) return;
        revealedInvitation.current = invitationRowKey;
        if (y !== undefined) list.current?.scrollTo({ y: Math.max(0, y - 12), animated: false });
        focusFrame = requestAnimationFrame(() => AccessibilityInfo.sendAccessibilityEvent?.(row, 'focus'));
        if (!reduceMotion) {
          invitationHighlight.value = 1;
          invitationHighlight.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.System });
        }
      };
      row.measureLayout(content, (_x, y) => reveal(y), () => reveal());
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
    };
  }, [invitationHighlight, invitationRowKey, reduceMotion]);
  const firstTab = useRef(selectedTab);
  const hasSwitchedTab = useRef(false);
  const initialTabOffset = useMemo(() => {
    return { x: 0, y: tabScrollOffsets.current[selectedTab] };
  }, [selectedTab]);
  if (selectedTab !== firstTab.current) hasSwitchedTab.current = true;

  const searchLabel = selectedTab === 'schedule' ? '일정 또는 공유자 검색' : '캘린더 또는 소유자 검색';
  const searchPlaceholder = largeText ? `${selectedTab === 'schedule' ? '일정' : '캘린더'} 검색` : searchLabel;
  const updateSearchQuery = (query: string) => {
    if (!largeText && tabScrollOffsets.current[selectedTab] > 0) {
      tabScrollOffsets.current[selectedTab] = 0;
      list.current?.scrollTo({ y: 0, animated: false });
    }
    onUpdateQuery(query);
  };

  const filterAction = (
    <Pressable
      ref={filterButton}
      accessibilityRole="button"
      accessibilityLabel={`공유 목록 필터${
        activeFilterCount > 0 ? `, ${activeFilterCount}개 적용됨` : ''
      }`}
      onPress={onOpenFilters}
      style={({ pressed }) => [
        styles.filterIconButton,
        !largeText && styles.filterButtonStandard,
        !largeText && { backgroundColor: colors.surface, borderColor: colors.border },
        { opacity: pressed ? 0.62 : 1 },
      ]}
    >
      <Ionicons
        name="options-outline"
        size={20}
        color={activeFilterCount > 0 ? accent : colors.textPrimary}
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
  );
  const searchTools = (
    <View style={[styles.searchTools, !largeText && styles.pinnedSearchTools]}>
      <View
        style={[
          styles.searchField,
          largeText
            ? { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }
            : [styles.searchFieldStandard, { backgroundColor: colors.surface2 }],
        ]}
      >
        <Ionicons name="search-outline" size={19} color={colors.textSecondary} />
        <TextInput
          ref={searchInputRef}
          value={selectedFilter.query}
          onChangeText={updateSearchQuery}
          accessibilityLabel={searchLabel}
          maxFontSizeMultiplier={1.65}
          placeholder={searchPlaceholder}
          placeholderTextColor={largeText ? colors.inputPlaceholder : colors.textSecondary}
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={[styles.searchInput, { color: colors.textPrimary }]}
        />
      </View>
      {largeText ? (
        <CalendarGlassSurface
          interactive clear variant="bottomBar" tone="softGlass"
          style={[styles.filterSurface, { borderColor: colors.border }]}
        >
          {filterAction}
        </CalendarGlassSurface>
      ) : filterAction}
    </View>
  );
  const tabBar = (
    <View accessibilityRole="tablist" style={[styles.tabBar, !largeText && styles.tabBarStandard]}>
      <ShareTabButton
        label="일정"
        count={unseenCounts.schedule}
        selected={selectedTab === 'schedule'}
        accent={accent}
        colors={colors}
        standardText={!largeText}
        onPress={() => onSelectTab('schedule')}
      />
      <ShareTabButton
        label="캘린더"
        count={unseenCounts.calendar}
        selected={selectedTab === 'calendar'}
        accent={accent}
        colors={colors}
        standardText={!largeText}
        onPress={() => onSelectTab('calendar')}
      />
    </View>
  );

  return (
    <View
      style={[styles.screen, { paddingTop: topInset }]}
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
            onPress={onGoBack}
            style={({ pressed }) => [
              styles.headerButton,
              { opacity: pressed ? 0.62 : 1 },
            ]}
          >
            <Ionicons
              name="chevron-back-outline"
              size={24}
              color={colors.textPrimary}
            />
          </Pressable>
        </CalendarGlassSurface>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.65} style={[styles.headerTitle, { color: colors.textPrimary }]}>
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
              ref={safetyButtonRef}
              accessibilityRole="button"
              accessibilityLabel="공유 안전 관리"
              onPress={onOpenSafetyManagement}
              style={({ pressed }) => [
                styles.headerButton,
                { opacity: pressed ? 0.62 : 1 },
              ]}
            >
              <Ionicons name="shield-checkmark-outline" size={22} color={colors.textPrimary} />
            </Pressable>
          </CalendarGlassSurface>
          <Pressable accessibilityRole="button" accessibilityLabel="공유함 새로고침"
            accessibilityState={{ disabled: refreshing, busy: refreshing }}
            disabled={refreshing} onPress={onRefresh}
            style={({ pressed }) => [styles.headerButton, { opacity: refreshing || pressed ? 0.55 : 1 }]}>
            <Ionicons name="refresh-outline" size={21} color={colors.textPrimary} />
          </Pressable>
        </View>
      </View>

      {largeText ? (
        <CalendarGlassSurface
          clear variant="bottomBar" tone="softGlass"
          style={[styles.tabSurface, { borderColor: colors.border }]}
        >
          {tabBar}
        </CalendarGlassSurface>
      ) : (
        <View style={[styles.tabSurface, styles.tabSurfaceStandard, { backgroundColor: colors.surface2 }]}>
          {tabBar}
        </View>
      )}

      {!largeText && searchTools}

      <ScrollView
        ref={list}
        innerViewRef={listContent as RefObject<View>}
        testID="share-inbox-results"
        key={selectedTab}
        contentOffset={initialTabOffset}
        onScroll={({ nativeEvent }) => {
          tabScrollOffsets.current[selectedTab] = Math.max(0, nativeEvent.contentOffset.y);
        }}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={largeText ? refreshing : pullRefreshing}
            onRefresh={onPullRefresh}
            tintColor={accent}
          />
        }
        contentContainerStyle={[
          styles.content,
          !largeText && styles.contentBelowSearch,
          { paddingBottom: Math.max(bottomInset, 18) + (pinnedError ? 68 : 24) },
        ]}
      >
        {largeText && searchTools}

        <View style={[styles.listToolbar, largeText && selectedTab === "calendar" && styles.listToolbarLarge]}>
          <Text maxFontSizeMultiplier={1.8} style={[styles.resultLabel, { color: colors.textSecondary }]}>
            {selectedTab === 'schedule' ? '공유 일정' : '공유 캘린더'}
            {hasData || largeText ? ` · ${resultCount}개` : null}
          </Text>
          {selectedTab === 'calendar' ? (
            <Pressable
              accessibilityRole="button"
              ref={calendarManagerButtonRef}
              accessibilityLabel="공유 캘린더 만들기 및 관리"
              onPress={onOpenCalendarManager}
              style={({ pressed }) => [
                styles.calendarManageAction,
                { opacity: pressed ? 0.62 : 1 },
              ]}
            >
              <Text
                maxFontSizeMultiplier={1.8}
                style={[styles.calendarManageActionText, { color: accent }]}
              >
                전체 관리
              </Text>
            </Pressable>
          ) : null}
        </View>

        <Animated.View key={recoveryCount} entering={hasSwitchedTab.current || recoveryCount > 0 ? tabContentEntry : undefined}>
          {largeText && error && hasData && !refreshing ? (
            <InlineErrorCard colors={colors} text={error} onRetry={onRefresh} />
          ) : null}

          {loading || (refreshing && !hasData) ? (
            <StateView
              colors={colors}
              text="공유함을 불러오는 중이에요"
              loading
            />
          ) : error && !hasData ? (
            <StateView colors={colors} text={error} onRetry={onRefresh} />
          ) : visibleItems.length === 0 ? (
            <EmptyState
              colors={colors}
              accent={accent}
              tab={selectedTab}
              standardText={!largeText}
              onClearSearch={hasQuery ? () => recover('search', () => updateSearchQuery('')) : undefined}
              onClearFilters={hasResettableFilters ? () => recover('filters', onClearFilters) : undefined}
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
                  <View>
                    {group.items.map(item => (
                      <ScheduleShareRow
                        key={item.key}
                        item={item}
                        colors={colors}
                        accent={accent}
                        arrivalStyle={item.key === invitationRowKey && invitationHighlightStyle}
                        onOpen={() => onOpenItem(item)}
                        openButtonRef={node => {
                          onResourceRowRef?.(item.key, node);
                          if (item.key === invitationRowKey) invitationRow.current = node;
                        }}
                        onManage={() => onManageItem(item)}
                        onSafety={() => onSafetyItem(item)}
                        safetyPending={safetyPendingKey === item.key}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View>
              {visibleItems.map(item => (
                <CalendarShareRow
                  key={item.key}
                  item={item}
                  colors={colors}
                  accent={accent}
                  onOpen={() => onOpenItem(item)}
                  openButtonRef={onResourceRowRef ? node => onResourceRowRef(item.key, node) : undefined}
                  onManage={() => onManageItem(item)}
                  onSafety={() => onSafetyItem(item)}
                  safetyPending={safetyPendingKey === item.key}
                />
              ))}
            </View>
          )}
        </Animated.View>
      </ScrollView>
      {pinnedError ? (
        <View pointerEvents="box-none" style={[styles.pinnedErrorPosition, { bottom: Math.max(bottomInset, 18) }]}>
          <InlineErrorCard
            colors={colors}
            text={refreshing ? '공유함을 확인하고 있어요.' : pinnedError}
            onRetry={onRefresh}
            pinned
            refreshing={refreshing}
          />
        </View>
      ) : null}
    </View>
  );
}
