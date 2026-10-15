import React from 'react';
import ScheduleIcon from '../shared/ScheduleIcon';
import {
  INPUT_DESIGN_ACCENT,
  inputDesignPreviewStyles,
  useScheduleInputDesignPreview,
} from '../form/ScheduleInputDesignPreviewContext';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CalendarGlassSurface from '../calendar/CalendarGlassSurface';
import { useTheme } from '../../../theme/ThemeContext';
import type { ScheduleItem } from '../../types';

type Props = {
  searchResults: ScheduleItem[];
  searchLoading: boolean;
  searchError: string | null;
  searchKeywordLength: number;
  onRetry: () => void;
  onOpenSchedule: (id: string) => void;
};
const SEARCH_MIN_QUERY_LENGTH = 2;

function formatScheduleDateTitle(startAt: string) {
  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) return '';

  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${
    weekdays[date.getDay()]
  })`;
}

function formatScheduleTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, '0');
  const meridiem = hour < 12 ? '오전' : '오후';
  const hour12 = hour % 12 || 12;
  return `${meridiem} ${hour12}:${minute}`;
}

/** Original search presentation shared with the development review route. */
export default function CalendarSearchResults({
  searchResults,
  searchLoading,
  searchError,
  searchKeywordLength,
  onRetry,
  onOpenSchedule,
}: Props) {
  const { colors, mode } = useTheme();
  const isTossPreview = useScheduleInputDesignPreview();
  return (
    <CalendarGlassSurface
      interactive
      prominent
      style={[styles.searchResultsGlass, isTossPreview && inputDesignPreviewStyles.searchSurface, { borderColor: colors.border }]}
    >
      {isTossPreview &&
        !searchLoading &&
        !searchError &&
        searchKeywordLength >= SEARCH_MIN_QUERY_LENGTH &&
        searchResults.length > 0 && (
          <View style={inputDesignPreviewStyles.searchHeader}>
            <Text
              style={[
                inputDesignPreviewStyles.searchHeaderText,
                { color: colors.textSecondary },
              ]}
            >
              검색 결과
            </Text>
            <Text
              style={[
                inputDesignPreviewStyles.searchHeaderText,
                { color: mode === 'dark' ? '#72ADFF' : INPUT_DESIGN_ACCENT },
              ]}
            >
              {searchResults.length}개
            </Text>
          </View>
        )}
      {searchLoading ? (
        <View style={styles.dropdownEmpty}>
          <ActivityIndicator color={colors.textSecondary} />
          <Text
            style={[styles.dropdownEmptyText, { color: colors.textSecondary }]}
          >
            전체 일정 검색 중
          </Text>
        </View>
      ) : searchError ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="일정 검색 다시 시도"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.dropdownEmpty,
            { opacity: pressed ? 0.62 : 1 },
          ]}
        >
          <Ionicons
            accessible={false}
            name="refresh-outline"
            size={20}
            color={colors.textSecondary}
          />
          <Text
            style={[styles.dropdownEmptyText, { color: colors.textSecondary }]}
          >
            검색에 실패했어요. 눌러서 다시 시도해 주세요.
          </Text>
        </Pressable>
      ) : searchKeywordLength < SEARCH_MIN_QUERY_LENGTH ? (
        <View style={styles.dropdownEmpty}>
          <Text
            style={[styles.dropdownEmptyText, { color: colors.textSecondary }]}
          >
            두 글자 이상 입력해 주세요
          </Text>
        </View>
      ) : searchResults.length === 0 ? (
        <View style={styles.dropdownEmpty}>
          <Text
            style={[styles.dropdownEmptyText, { color: colors.textSecondary }]}
          >
            검색 결과가 없어요
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.searchResultScroll}
          contentContainerStyle={styles.searchResultList}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {searchResults.map(item => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${formatScheduleDateTitle(
                item.startAt,
              )}, ${item.allDay ? '종일' : formatScheduleTime(item.startAt)}`}
              onPress={() => onOpenSchedule(item.id)}
              style={({ pressed }) => [
                styles.searchResultRow,
                {
                  borderBottomColor: colors.border,
                  backgroundColor: pressed
                    ? mode === 'dark'
                      ? 'rgba(255,255,255,0.08)'
                      : 'rgba(0,0,0,0.05)'
                    : 'transparent',
                },
              ]}
            >
              <View
                style={[
                  styles.searchResultBar,
                  {
                    backgroundColor: item.category?.color ?? '#8e8e93',
                  },
                ]}
              />
              <View style={styles.searchResultBody}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.searchResultTitle,
                    isTossPreview && inputDesignPreviewStyles.searchTitle,
                    { color: colors.textPrimary },
                  ]}
                >
                  {item.title}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.searchResultMeta,
                    isTossPreview && inputDesignPreviewStyles.searchMeta,
                    { color: colors.textSecondary },
                  ]}
                >
                  {formatScheduleDateTitle(item.startAt)}
                </Text>
              </View>
              <Text
                style={[
                  styles.searchResultTime,
                  isTossPreview && inputDesignPreviewStyles.searchTime,
                  { color: colors.textSecondary },
                ]}
              >
                {item.allDay ? '종일' : formatScheduleTime(item.startAt)}
              </Text>
              {isTossPreview && (
                <View style={inputDesignPreviewStyles.searchArrow}>
                  <ScheduleIcon name="forward" color={colors.textSecondary} />
                </View>
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </CalendarGlassSurface>
  );
}

const styles = StyleSheet.create({
  searchResultsGlass: {
    marginTop: 8,
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    maxHeight: 260,
  },
  dropdownEmpty: {
    minHeight: 74,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 18,
  },
  dropdownEmptyText: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  searchResultList: {
    paddingTop: 8,
    paddingBottom: 8,
  },
  searchResultScroll: {
    maxHeight: 252,
  },
  searchResultRow: {
    minHeight: 58,
    marginHorizontal: 10,
    borderRadius: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchResultBar: {
    width: 4,
    height: 34,
    borderRadius: 2,
    marginLeft: 8,
  },
  searchResultBody: {
    flex: 1,
    paddingLeft: 10,
    paddingRight: 10,
  },
  searchResultTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  searchResultMeta: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
  },
  searchResultTime: {
    minWidth: 68,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
