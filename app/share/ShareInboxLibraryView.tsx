import { Ionicons } from '@expo/vector-icons';
import React, { type RefObject } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import CalendarGlassSurface from '../../src/modules/schedule/components/calendar/CalendarGlassSurface';
import type {
  ShareLibraryFilter,
  ShareLibraryItem,
  ShareLibraryTab,
} from '../../src/modules/share/shareInboxPresentation';
import type { AppColors } from '../../src/modules/theme/ThemeContext';
import styles from './inbox.styles';
import { EmptyState, InlineErrorCard, StateView } from './ShareInboxManage';
import {
  CalendarShareRow,
  ScheduleShareRow,
  ShareTabButton,
} from './ShareInboxRows';

type ShareInboxLibraryViewProps = {
  colors: AppColors;
  accent: string;
  topInset: number;
  bottomInset: number;
  hasModal: boolean;
  refreshing: boolean;
  unseenCounts: { schedule: number; calendar: number };
  selectedTab: ShareLibraryTab;
  selectedFilter: ShareLibraryFilter;
  activeFilterCount: number;
  resultCount: number;
  loading: boolean;
  error: string | null;
  hasData: boolean;
  visibleItems: ShareLibraryItem[];
  scheduleGroups: Array<{ label: string; items: ShareLibraryItem[] }>;
  safetyPendingKey: string | null;
  searchInputRef: RefObject<TextInput | null>;
  onGoBack: () => void;
  onOpenReports: () => void;
  onOpenBlocked: () => void;
  onOpenCalendarManager: () => void;
  onRefresh: () => void;
  onSelectTab: (tab: ShareLibraryTab) => void;
  onUpdateQuery: (query: string) => void;
  onOpenFilters: () => void;
  onOpenItem: (item: ShareLibraryItem) => void;
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
  unseenCounts,
  selectedTab,
  selectedFilter,
  activeFilterCount,
  resultCount,
  loading,
  error,
  hasData,
  visibleItems,
  scheduleGroups,
  safetyPendingKey,
  searchInputRef,
  onGoBack,
  onOpenReports,
  onOpenBlocked,
  onOpenCalendarManager,
  onRefresh,
  onSelectTab,
  onUpdateQuery,
  onOpenFilters,
  onOpenItem,
  onManageItem,
  onSafetyItem,
}: ShareInboxLibraryViewProps) {
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
              onPress={onOpenReports}
              style={({ pressed }) => [
                styles.headerButton,
                { opacity: pressed ? 0.62 : 1 },
              ]}
            >
              <Ionicons
                name="flag-outline"
                size={20}
                color={colors.textPrimary}
              />
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
              onPress={onOpenBlocked}
              style={({ pressed }) => [
                styles.headerButton,
                { opacity: pressed ? 0.62 : 1 },
              ]}
            >
              <Ionicons
                name="shield-checkmark-outline"
                size={20}
                color={colors.textPrimary}
              />
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
              onPress={onRefresh}
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
            onPress={() => onSelectTab('schedule')}
          />
          <ShareTabButton
            label="캘린더"
            count={unseenCounts.calendar}
            selected={selectedTab === 'calendar'}
            accent={accent}
            colors={colors}
            onPress={() => onSelectTab('calendar')}
          />
        </View>
      </CalendarGlassSurface>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={accent}
          />
        }
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(bottomInset, 18) + 24 },
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
              onChangeText={onUpdateQuery}
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
                activeFilterCount > 0 ? `, ${activeFilterCount}개 적용됨` : ''
              }`}
              onPress={onOpenFilters}
              style={({ pressed }) => [
                styles.filterIconButton,
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
              onPress={onOpenCalendarManager}
              style={({ pressed }) => [
                styles.calendarManageAction,
                { borderColor: colors.border, opacity: pressed ? 0.62 : 1 },
              ]}
            >
              <Ionicons name="add" size={16} color={accent} />
              <Text
                style={[styles.calendarManageActionText, { color: accent }]}
              >
                캘린더 관리
              </Text>
            </Pressable>
          ) : null}
        </View>

        {error && hasData ? (
          <InlineErrorCard colors={colors} text={error} onRetry={onRefresh} />
        ) : null}

        {loading ? (
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
                      onOpen={() => onOpenItem(item)}
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
          <View style={styles.calendarList}>
            {visibleItems.map(item => (
              <CalendarShareRow
                key={item.key}
                item={item}
                colors={colors}
                accent={accent}
                onOpen={() => onOpenItem(item)}
                onManage={() => onManageItem(item)}
                onSafety={() => onSafetyItem(item)}
                safetyPending={safetyPendingKey === item.key}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
