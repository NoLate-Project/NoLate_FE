import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  findNodeHandle,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, { Easing, FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { useTheme } from '../../../theme/ThemeContext';
import type { ScheduleItem } from '../../types';
import { getScheduleCalendarDateKey } from '../../scheduleFormDate';

type Props = {
  searchResults: ScheduleItem[];
  searchLoading: boolean;
  searchError: string | null;
  searchKeywordLength: number;
  searchQuery?: string;
  isFocused?: boolean;
  reduceMotionEnabled?: boolean;
  countInCalendarContext?: boolean;
  onRetry: () => void;
  onOpenSchedule: (id: string) => void;
};
export const SEARCH_MIN_QUERY_LENGTH = 2;
export const CALENDAR_SEARCH_LARGE_FONT_SCALE = 1.35;

/** 기본 글자 크기에서 한 날짜만 검색되면 날짜 제목이 결과 수를 표시한다. */
export function showsSearchResultCountInDateHeading(results: readonly ScheduleItem[], fontScale: number) {
  if (fontScale > 1 || !results.length) return false;
  const firstDate = new Date(results[0].startAt);
  if (Number.isNaN(firstDate.getTime())) return false;
  const dateKey = getScheduleCalendarDateKey(firstDate);
  return results.every(item =>
    getScheduleCalendarDateKey(new Date(item.startAt)) === dateKey
  );
}

const resultListEntry = FadeInDown.duration(160)
  .easing(Easing.out(Easing.cubic))
  .withInitialValues({ transform: [{ translateY: -4 }] })
  .reduceMotion(ReduceMotion.System);

function normalizeSearchText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function formatScheduleDateTitle(date: Date, includeYear: boolean) {
  if (Number.isNaN(date.getTime())) return '';

  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const year = includeYear ? `${date.getFullYear()}년 ` : '';
  return `${year}${date.getMonth() + 1}월 ${date.getDate()}일 (${
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

/** 검색 결과에 일정 제목, 일시와 장소로 일치한 근거를 표시합니다. */
export default function CalendarSearchResults({
  searchResults,
  searchLoading,
  searchError,
  searchKeywordLength,
  searchQuery = '',
  isFocused = true,
  reduceMotionEnabled = false,
  countInCalendarContext = false,
  onRetry,
  onOpenSchedule,
}: Props) {
  const { colors, mode } = useTheme();
  const { fontScale, height } = useWindowDimensions();
  const largeText = fontScale > CALENDAR_SEARCH_LARGE_FONT_SCALE;
  const showCountInDateHeading = showsSearchResultCountInDateHeading(searchResults, fontScale);
  const showCountInPanel = !showCountInDateHeading && (largeText || !countInCalendarContext);
  const resultMaxHeight = largeText ? Math.min(440, Math.round(height * 0.51)) : 260;
  const normalizedQuery = normalizeSearchText(searchQuery);
  const titleMatchPattern = normalizedQuery.length >= SEARCH_MIN_QUERY_LENGTH
    ? new RegExp(normalizedQuery.split(' ').map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'giu')
    : undefined;
  const matchColor = mode === 'dark' ? '#9ABEFF' : '#1959DB';
  const openedResult = useRef<{ id: string; date: string; index: number; query: string; offset: number } | null>(null);
  const listRef = useRef<ScrollView>(null);
  // ScrollView's ref prop types the mounted view, though React also assigns null on detach.
  const contentRef = useRef<View>(null!);
  const offset = useRef(0);
  const remounted = useRef(false);
  const setListRef = useCallback((node: ScrollView | null) => {
    if (node && openedResult.current) remounted.current = true;
    listRef.current = node;
  }, []);
  const dateHeadingHeights = useRef(new Map<string, number>());
  const rowRefs = useRef(new Map<string, View>());
  const [returnNotice, setReturnNotice] = useState('');
  const dates = searchResults.map(item => new Date(item.startAt));
  const includesMultipleYears = new Set(dates.map(date => date.getFullYear()).filter(Number.isFinite)).size > 1;
  const rows = searchResults.flatMap((item, index) => {
    const dateKey = getScheduleCalendarDateKey(dates[index]);
    const date = formatScheduleDateTitle(dates[index], includesMultipleYears);
    const row = { item, dateKey, date, index };
    return !largeText && date && (index === 0 || getScheduleCalendarDateKey(dates[index - 1]) !== dateKey)
      ? [{ dateKey, date }, row]
      : [row];
  });
  const stickyHeaderIndices = rows.flatMap((entry, index) => 'item' in entry ? [] : [index]);
  const didLeaveSearch = useRef(false);
  const returnOpacity = useRef(new Animated.Value(0)).current;
  const [returnedId, setReturnedId] = useState<string | null>(null);

  useEffect(() => {
    offset.current = 0;
    dateHeadingHeights.current.clear();
    setReturnNotice('');
    setReturnedId(null);
  }, [normalizedQuery]);

  useEffect(() => {
    if (!isFocused) {
      didLeaveSearch.current = true;
      return;
    }
    if (!didLeaveSearch.current || searchLoading || searchError) return;
    didLeaveSearch.current = false;
    const opened = openedResult.current;
    openedResult.current = null;
    if (!opened || opened.query !== normalizedQuery) return;
    const resultIndex = searchResults.findIndex(item => item.id === opened.id);
    if (resultIndex < 0) {
      setReturnNotice('방금 본 일정이 현재 검색 결과에서 빠졌어요.');
      return;
    }

    const resultDate = getScheduleCalendarDateKey(new Date(searchResults[resultIndex].startAt));
    const moved = resultDate !== opened.date || resultIndex !== opened.index;
    let cancelled = false;
    const focusRow = () => {
      const target = findNodeHandle(rowRefs.current.get(opened.id) ?? null);
      if (target != null) AccessibilityInfo.setAccessibilityFocus(target);
    };
    const frame = requestAnimationFrame(() => {
      const row = rowRefs.current.get(opened.id);
      const content = contentRef.current;
      if (moved && row && content) {
        // Read the committed position after a date edit, including the new group and font scale.
        row.measureLayout(content, (_x, y) => {
          if (cancelled) return;
          const inset = largeText ? 0 : dateHeadingHeights.current.get(resultDate) ?? 36;
          listRef.current?.scrollTo({ y: Math.max(0, y - inset), animated: false });
          focusRow();
        }, () => {
          if (!cancelled) focusRow();
        });
        return;
      }
      if (remounted.current) listRef.current?.scrollTo({ y: opened.offset, animated: false });
      focusRow();
    });

    if (!reduceMotionEnabled) setReturnedId(opened.id);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [isFocused, largeText, normalizedQuery, reduceMotionEnabled, searchError, searchLoading, searchResults]);

  useEffect(() => {
    if (!returnedId || !isFocused || reduceMotionEnabled) return;
    returnOpacity.setValue(0.12);
    const fade = Animated.timing(returnOpacity, {
      toValue: 0,
      delay: largeText ? 0 : 420,
      duration: largeText ? 180 : 240,
      useNativeDriver: true,
    });
    fade.start(({ finished }) => {
      if (finished) setReturnedId(null);
    });
    return () => {
      fade.stop();
      returnOpacity.setValue(0);
    };
  }, [isFocused, largeText, reduceMotionEnabled, returnedId, returnOpacity]);

  return (
    <View
      style={[
        styles.searchResultsPanel,
        { backgroundColor: colors.surface, borderColor: colors.border, maxHeight: resultMaxHeight },
      ]}
    >
      {returnNotice ? (
        <Text accessibilityLiveRegion="polite" style={[styles.resultStatus, { color: colors.textSecondary }]}>{returnNotice}</Text>
      ) : null}
      {searchLoading ? (
        <View style={[styles.dropdownEmpty, styles.searchLoading]} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.textSecondary} />
          <Text
            style={[styles.dropdownEmptyText, { color: colors.textSecondary }]}
          >
            일정을 찾고 있어요
          </Text>
        </View>
      ) : searchError ? (
        <View style={styles.dropdownEmpty}>
          <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={2} lineBreakStrategyIOS="hangul-word" style={[styles.searchStateTitle, { color: colors.textPrimary }]}>
            일정을 불러오지 못했어요
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="일정 검색 다시 시도"
            onPress={onRetry}
            style={({ pressed }) => [
              styles.searchRetry,
              { backgroundColor: colors.surface2, opacity: pressed ? 0.62 : 1 },
            ]}
          >
            <Ionicons accessible={false} name="refresh-outline" size={16} color={colors.textPrimary} />
            <Text style={[styles.searchStateTitle, { color: colors.textPrimary }]}>다시 시도</Text>
          </Pressable>
        </View>
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
          <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={2} lineBreakStrategyIOS="hangul-word" style={[styles.searchStateTitle, { color: colors.textPrimary }]}>
            일치하는 일정이 없어요
          </Text>
          <Text maxFontSizeMultiplier={2} lineBreakStrategyIOS="hangul-word" style={[styles.dropdownEmptyText, { color: colors.textSecondary }]}>
            다른 제목이나 장소로 검색해 보세요.
          </Text>
        </View>
      ) : (
        <Reanimated.View key={normalizedQuery} style={styles.resultBody} entering={reduceMotionEnabled ? undefined : resultListEntry}>
          {showCountInPanel && (
            <Text style={[styles.resultStatus, { color: colors.textSecondary }]}>{`검색 결과 ${searchResults.length}개`}</Text>
          )}
          <ScrollView
            testID="calendar-search-result-list"
            ref={setListRef}
            innerViewRef={contentRef}
            style={styles.resultBody}
            stickyHeaderIndices={stickyHeaderIndices}
            onScroll={event => { offset.current = event.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={16}
            contentContainerStyle={[styles.searchResultList, !showCountInPanel && styles.searchResultListWithContext]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            indicatorStyle={mode === 'dark' ? 'white' : 'black'}
          >
            {rows.map(entry => {
              if (!('item' in entry)) {
                return (
                  <View key={entry.dateKey} style={{ backgroundColor: colors.surface }}
                    onLayout={event => { dateHeadingHeights.current.set(entry.dateKey, event.nativeEvent.layout.height); }}>
                    {/* ScrollView transfers the sticky child's style to its wrapper. */}
                    <View style={showCountInDateHeading ? styles.dateHeadingWithCount : undefined}>
                      <Text accessibilityRole="header" style={[styles.dateHeading, { color: colors.textSecondary }]}>
                        {entry.date}
                      </Text>
                      {showCountInDateHeading && (
                        <Text
                          testID="calendar-search-result-count"
                          accessibilityLabel={`검색 결과 ${searchResults.length}개`}
                          style={[styles.dateResultCount, { color: colors.textSecondary }]}
                        >
                          {`일정 ${searchResults.length}개`}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              }
              const { item, date, dateKey, index } = entry;
              const time = item.allDay ? '종일' : formatScheduleTime(item.startAt);
              const place = normalizedQuery.length >= SEARCH_MIN_QUERY_LENGTH && !normalizeSearchText(item.title).includes(normalizedQuery)
                ? [item.destination?.name, item.locationName, item.origin?.name].find(
                    name => name && normalizeSearchText(name).includes(normalizedQuery),
                  )
                : undefined;
              return (
              <Pressable
                key={item.id}
                ref={node => {
                  if (node) rowRefs.current.set(item.id, node);
                  else rowRefs.current.delete(item.id);
                }}
                accessibilityRole="button"
                accessibilityLabel={[item.title, date, time, place].filter(Boolean).join(', ')}
                onPress={() => {
                  remounted.current = false;
                  setReturnNotice('');
                  setReturnedId(null);
                  openedResult.current = { id: item.id, date: dateKey, index, query: normalizedQuery, offset: offset.current };
                  onOpenSchedule(item.id);
                }}
                style={({ pressed }) => [
                  styles.searchResultRow,
                  largeText && styles.searchResultRowLarge,
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
                {returnedId === item.id && !reduceMotionEnabled ? (
                  <Animated.View
                    pointerEvents="none"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[
                      StyleSheet.absoluteFillObject,
                      styles.returnHighlight,
                      { backgroundColor: largeText ? colors.textPrimary : matchColor, opacity: returnOpacity },
                    ]}
                  />
                ) : null}
                <View
                  style={[
                    styles.searchResultBar,
                    largeText && styles.searchResultBarLarge,
                    {
                      backgroundColor: item.category?.color ?? '#8e8e93',
                    },
                  ]}
                />
                <View style={styles.searchResultBody}>
                  <Text
                    numberOfLines={largeText ? undefined : 2}
                    lineBreakStrategyIOS="hangul-word"
                    style={[
                      styles.searchResultTitle,
                      { color: colors.textPrimary },
                    ]}
                  >
                    {renderSearchTitle(item.title, titleMatchPattern, matchColor)}
                  </Text>
                  {largeText && <Text
                    lineBreakStrategyIOS="hangul-word"
                    style={[
                      styles.searchResultMeta,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {[date, time].filter(Boolean).join(' · ')}
                  </Text>}
                  {place && (
                    <Text lineBreakStrategyIOS="hangul-word" style={[styles.searchResultMeta, { color: colors.textSecondary }]}>
                      {place}
                    </Text>
                  )}
                </View>
                {!largeText && <Text
                  style={[
                    styles.searchResultTime,
                    { color: colors.textSecondary },
                  ]}
                >
                  {time}
                </Text>}
              </Pressable>
              );
            })}
          </ScrollView>
        </Reanimated.View>
      )}
    </View>
  );
}

function renderSearchTitle(title: string, pattern: RegExp | undefined, color: string) {
  if (!pattern) return title;
  const matches = Array.from(title.matchAll(pattern));
  if (matches.length === 0) return title;

  let cursor = 0;
  return <>{matches.map(match => {
    const prefix = title.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    return <React.Fragment key={match.index}>{prefix}<Text style={{ color }}>{match[0]}</Text></React.Fragment>;
  })}{title.slice(cursor)}</>;
}

const styles = StyleSheet.create({
  resultBody: { flexShrink: 1 },
  resultStatus: { paddingHorizontal: 18, paddingTop: 9, paddingBottom: 5, fontSize: 12, fontWeight: '600' },
  dateHeading: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 6, fontSize: 13, fontWeight: '700' },
  dateHeadingWithCount: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateResultCount: { paddingRight: 18, fontSize: 12, fontWeight: '600' },
  searchResultsPanel: {
    marginTop: 8,
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
  },
  dropdownEmpty: {
    minHeight: 74,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  searchLoading: { flexDirection: 'row', gap: 8 },
  searchStateTitle: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  searchRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  dropdownEmptyText: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  searchResultList: {
    paddingTop: 8,
    paddingBottom: 8,
  },
  searchResultListWithContext: { paddingTop: 3 },
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
  returnHighlight: { borderRadius: 16 },
  searchResultRowLarge: { paddingVertical: 10, alignItems: 'flex-start' },
  searchResultBarLarge: { marginTop: 5 },
  searchResultBody: {
    flex: 1,
    minWidth: 0,
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
    fontWeight: '500',
    letterSpacing: 0,
  },
  searchResultTime: {
    minWidth: 68,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0,
  },
});
