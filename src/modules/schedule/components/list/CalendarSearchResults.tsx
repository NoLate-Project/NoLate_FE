import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

type Props = {
  searchResults: ScheduleItem[];
  searchLoading: boolean;
  searchError: string | null;
  searchKeywordLength: number;
  searchQuery?: string;
  isFocused?: boolean;
  reduceMotionEnabled?: boolean;
  onRetry: () => void;
  onOpenSchedule: (id: string) => void;
};
const SEARCH_MIN_QUERY_LENGTH = 2;
const resultListEntry = FadeInDown.duration(160)
  .easing(Easing.out(Easing.cubic))
  .withInitialValues({ transform: [{ translateY: -4 }] })
  .reduceMotion(ReduceMotion.System);

function normalizeSearchText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

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

/** 검색 결과에 일정 제목, 일시와 장소로 일치한 근거를 표시합니다. */
export default function CalendarSearchResults({
  searchResults,
  searchLoading,
  searchError,
  searchKeywordLength,
  searchQuery = '',
  isFocused = true,
  reduceMotionEnabled = false,
  onRetry,
  onOpenSchedule,
}: Props) {
  const { colors, mode } = useTheme();
  const { fontScale, height } = useWindowDimensions();
  const largeText = fontScale > 1.35;
  const resultMaxHeight = largeText ? Math.min(440, Math.round(height * 0.51)) : 260;
  const normalizedQuery = normalizeSearchText(searchQuery);
  const openedResult = useRef<{ id: string; query: string } | null>(null);
  const didLeaveSearch = useRef(false);
  const returnOpacity = useRef(new Animated.Value(0)).current;
  const [returnedId, setReturnedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isFocused) {
      didLeaveSearch.current = true;
      return;
    }
    if (!didLeaveSearch.current) return;
    didLeaveSearch.current = false;
    const opened = openedResult.current;
    openedResult.current = null;
    if (!opened || opened.query !== normalizedQuery || reduceMotionEnabled) return;

    returnOpacity.setValue(0.12);
    setReturnedId(opened.id);
    const fade = Animated.timing(returnOpacity, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    });
    fade.start(({ finished }) => {
      if (finished) setReturnedId(null);
    });
    return () => {
      fade.stop();
      returnOpacity.setValue(0);
    };
  }, [isFocused, normalizedQuery, reduceMotionEnabled, returnOpacity]);

  return (
    <View
      style={[
        styles.searchResultsPanel,
        { backgroundColor: colors.surface, borderColor: colors.border, maxHeight: resultMaxHeight },
      ]}
    >
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
        <Reanimated.View key={normalizedQuery} entering={reduceMotionEnabled ? undefined : resultListEntry}>
          <ScrollView
            testID="calendar-search-result-list"
            style={{ maxHeight: resultMaxHeight - 8 }}
            contentContainerStyle={styles.searchResultList}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            indicatorStyle={mode === 'dark' ? 'white' : 'black'}
          >
            {searchResults.map(item => {
              const date = formatScheduleDateTitle(item.startAt);
              const time = item.allDay ? '종일' : formatScheduleTime(item.startAt);
              const place = normalizedQuery.length >= SEARCH_MIN_QUERY_LENGTH && !normalizeSearchText(item.title).includes(normalizedQuery)
                ? [item.destination?.name, item.locationName, item.origin?.name].find(
                    name => name && normalizeSearchText(name).includes(normalizedQuery),
                  )
                : undefined;
              return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={[item.title, date, time, place].filter(Boolean).join(', ')}
                onPress={() => {
                  openedResult.current = { id: item.id, query: normalizedQuery };
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
                      { backgroundColor: colors.textPrimary, opacity: returnOpacity },
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
                    {item.title}
                  </Text>
                  <Text
                    lineBreakStrategyIOS="hangul-word"
                    style={[
                      styles.searchResultMeta,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {largeText ? [date, time].filter(Boolean).join(' · ') : date}
                  </Text>
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

const styles = StyleSheet.create({
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
