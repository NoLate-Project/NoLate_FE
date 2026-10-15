import React, { useMemo, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSharedValue } from 'react-native-reanimated';

import CalendarWrapper from '../../modules/schedule/components/calendar/CalendarWrapper';
import LiquidCalendarMenuPrototype from '../../modules/schedule/components/calendar/LiquidCalendarMenuPrototype';
import LiquidGlassIconButton from '../../modules/schedule/components/calendar/LiquidGlassIconButton';
import { type DetailMonthPageLayouts } from '../../modules/schedule/components/calendar/ScheduleCalendar';
import {
  getPrimaryPillWeekdayGap,
  type CalendarViewModePreference,
} from '../../modules/schedule/components/calendar/viewMode';
import {
  MonthAgendaList,
  SelectedDayAgendaPanel,
} from '../../modules/schedule/components/list/ScheduleAgendaViews';
import GlobalFloatingActionBar from '../../modules/schedule/components/shared/GlobalFloatingActionBar';
import { SCHEDULE_ICONS } from '../../modules/schedule/components/shared/ScheduleIcon';
import {
  getCalendarMonthWeekCount,
  resolveDetailMonthPanelLayout,
} from '../../modules/schedule/calendarMotion';
import { useTheme } from '../../modules/theme/ThemeContext';
import CalendarSearchResults from '../../modules/schedule/components/list/CalendarSearchResults';
import type { ScheduleItem } from '../../modules/schedule/types';

const DAY = '2026-10-12';
const work = { id: 'main-preview-work', title: '업무', color: '#4C88FF' };
const personal = {
  id: 'main-preview-personal',
  title: '개인',
  color: '#FF7181',
};
const exercise = {
  id: 'main-preview-exercise',
  title: '운동',
  color: '#48BE8B',
};
const items: ScheduleItem[] = [
  {
    id: 'main-preview-meeting',
    title: '프로덕트 주간 회의',
    startAt: `${DAY}T09:30:00+09:00`,
    endAt: `${DAY}T10:30:00+09:00`,
    category: work,
    locationName: '회의실 A',
  },
  {
    id: 'main-preview-dentist',
    title: '치과 정기 검진',
    startAt: `${DAY}T13:00:00+09:00`,
    endAt: `${DAY}T14:00:00+09:00`,
    category: personal,
    locationName: '연세미소치과',
    travelMode: 'TRANSIT',
    travelMinutes: 28,
    departAt: `${DAY}T12:32:00+09:00`,
  },
  {
    id: 'main-preview-running',
    title: '저녁 러닝 5km',
    startAt: `${DAY}T19:30:00+09:00`,
    endAt: `${DAY}T20:20:00+09:00`,
    category: exercise,
    locationName: '한강공원',
  },
  {
    id: 'main-preview-workshop',
    title: '분기 OKR 워크숍',
    startAt: '2026-10-15T10:00:00+09:00',
    endAt: '2026-10-15T16:30:00+09:00',
    category: work,
    locationName: '성수 오피스',
  },
  {
    id: 'main-preview-trip',
    title: '부산 가족 여행',
    startAt: '2026-10-18T00:00:00+09:00',
    endAt: '2026-10-21T00:00:00+09:00',
    allDay: true,
    category: personal,
  },
  {
    id: 'main-preview-design',
    title: '디자인 시스템 싱크',
    startAt: '2026-10-22T15:00:00+09:00',
    endAt: '2026-10-22T16:00:00+09:00',
    category: work,
    locationName: 'Google Meet',
  },
];

const denseItems: ScheduleItem[] = [
  ...items,
  {
    id: 'main-preview-cross-week',
    title: '가을 휴가 · 주 경계를 넘는 일정',
    startAt: '2026-10-08T00:00:00+09:00',
    endAt: '2026-10-14T00:00:00+09:00',
    allDay: true,
    category: personal,
  },
  ...Array.from({ length: 5 }, (_, index) => ({
    id: `main-preview-holiday-${index}`,
    title: [
      '한글날 전시 관람',
      '점심 약속',
      '친구와 산책',
      '카페 방문',
      '저녁 식사',
    ][index],
    startAt: `2026-10-09T${String(10 + index).padStart(2, '0')}:00:00+09:00`,
    endAt: `2026-10-09T${String(11 + index).padStart(2, '0')}:00:00+09:00`,
    category: index % 2 === 0 ? work : exercise,
    travelMode: index === 0 ? ('TRANSIT' as const) : undefined,
  })),
];

const denseCalendarDays = {
  '2026-10-09': {
    date: '2026-10-09',
    holidays: [{ name: '한글날', type: 'PUBLIC_HOLIDAY' }],
  },
};

/** Development-only fixture: real calendar, agenda and native glass; no API writes. */
export default function CalendarMainPreview({
  initialMode = 'detail',
  scenario = 'normal',
  searchPreview = false,
}: {
  initialMode?: CalendarViewModePreference;
  scenario?: 'normal' | 'stress' | 'empty' | 'error' | 'dense';
  searchPreview?: boolean;
}) {
  const { colors, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState(initialMode);
  const [selectedDay, setSelectedDay] = useState(DAY);
  const [visibleMonth, setVisibleMonth] = useState(DAY);
  const fixtureItems = useMemo(
    () =>
      scenario === 'empty'
        ? []
        : scenario === 'dense'
        ? denseItems
        : scenario === 'stress'
        ? items.map((item, index) =>
            index === 0
              ? {
                  ...item,
                  title:
                    '출시 전 모든 화면의 디자인과 접근성을 함께 검토하는 프로덕트 회의',
                  category: {
                    ...work,
                    shared: true,
                    sharePermission: 'EDITOR' as const,
                  },
                  routeSetupRequired: true,
                  departAt: `${DAY}T08:50:00+09:00`,
                  travelMinutes: 40,
                }
              : item,
          )
        : items,
    [scenario],
  );
  const headerOffset =
    insets.top + 56 + 24 + 18 + getPrimaryPillWeekdayGap('detail');
  const layout = useMemo(
    () =>
      resolveDetailMonthPanelLayout({
        viewportHeight: height,
        fixedChromeHeight: headerOffset + 26,
        weekCount: getCalendarMonthWeekCount(selectedDay, 0),
        defaultDayHeight: 72,
      }),
    [headerOffset, height, selectedDay],
  );
  const calendarHeight = useSharedValue(layout.calendarHeight);
  const dayHeight = useSharedValue(layout.dayHeight);
  const detailMonthPageLayouts = useMemo<DetailMonthPageLayouts>(() => {
    const byWeekCount = Object.fromEntries(
      [4, 5, 6].map(weekCount => [
        weekCount,
        resolveDetailMonthPanelLayout({
          viewportHeight: height,
          fixedChromeHeight: headerOffset + 26,
          weekCount,
          defaultDayHeight: 72,
        }),
      ]),
    );
    return {
      byWeekCount,
      previous: layout,
      current: layout,
      next: layout,
    };
  }, [headerOffset, height, layout]);
  const showPreviewMessage = (message: string) => () =>
    Alert.alert(message, '검토용 일정이며 저장되지 않습니다.');
  const agendaProps = {
    items: fixtureItems,
    loading: false,
    error:
      scenario === 'error'
        ? '일정을 불러오지 못했어요. 다시 시도해 주세요'
        : null,
    bottomInset: insets.bottom,
    onPressRetry: showPreviewMessage('다시 조회'),
    onOpenSchedule: showPreviewMessage('일정 열기'),
    onRequestScheduleActions: showPreviewMessage('일정 작업'),
    getScheduleSwipeActions: () => ({
      onEdit: showPreviewMessage('일정 수정'),
      onDelete: showPreviewMessage('일정 삭제'),
    }),
    onRequestViewMode: setViewMode,
    routeSetupRequiredCount: fixtureItems.filter(
      item => item.routeSetupRequired,
    ).length,
    onOpenRouteSetup: showPreviewMessage('경로 설정'),
  };
  const primaryPillWidth = viewMode === 'detail' ? 148 : 106;
  const menuWidth = menuOpen ? width - 32 : 150;

  return (
    <View style={[styles.root, { backgroundColor: colors.calendarBackground }]}>
      {viewMode === 'stack' ? (
        <>
          <CalendarWrapper
            selectedDay={selectedDay}
            focusedMonth={selectedDay}
            items={fixtureItems}
            calendarDaysByDate={
              scenario === 'dense' ? denseCalendarDays : undefined
            }
            viewMode="stack"
            firstDay={0}
            scrollRequest={0}
            onSelectDay={setSelectedDay}
            onOpenDay={setSelectedDay}
            onVisibleMonthChange={setVisibleMonth}
            headerOffset={insets.top + 56 + 24 + 68}
            bottomContentInset={insets.bottom + 70}
          />
          <View
            pointerEvents="none"
            style={[
              styles.stackHeader,
              {
                top: insets.top + 56 + 24,
                backgroundColor: colors.calendarBackground,
              },
            ]}
          >
            <Text
              style={[styles.stackMonthTitle, { color: colors.textPrimary }]}
            >
              {Number(visibleMonth.slice(5, 7))}월
            </Text>
            <View
              style={[styles.stackWeekdays, { borderColor: colors.border }]}
            >
              {['일', '월', '화', '수', '목', '금', '토'].map(day => (
                <Text
                  key={day}
                  style={[styles.weekday, { color: colors.textPrimary }]}
                >
                  {day}
                </Text>
              ))}
            </View>
          </View>
        </>
      ) : viewMode === 'detail' ? (
        <>
          <View style={{ height: layout.calendarHeight }}>
            <CalendarWrapper
              selectedDay={selectedDay}
              focusedMonth={selectedDay}
              items={fixtureItems}
              calendarDaysByDate={
                scenario === 'dense' ? denseCalendarDays : undefined
              }
              viewMode="detail"
              firstDay={0}
              scrollRequest={0}
              onSelectDay={setSelectedDay}
              onOpenDay={setSelectedDay}
              onVisibleMonthChange={() => undefined}
              headerOffset={headerOffset}
              animatedCalendarHeight={calendarHeight}
              animatedDayHeight={dayHeight}
              detailMonthPageLayouts={detailMonthPageLayouts}
            />
          </View>
          <SelectedDayAgendaPanel {...agendaProps} selectedDay={selectedDay} />
          <View
            pointerEvents="none"
            style={[styles.weekdays, { top: headerOffset - 18 }]}
          >
            {['일', '월', '화', '수', '목', '금', '토'].map(day => (
              <Text
                key={day}
                style={[styles.weekday, { color: colors.textSecondary }]}
              >
                {day}
              </Text>
            ))}
          </View>
        </>
      ) : (
        <View style={[styles.list, { paddingTop: insets.top + 56 + 16 }]}>
          <MonthAgendaList {...agendaProps} visibleMonth={selectedDay} />
        </View>
      )}
      <View
        pointerEvents="box-none"
        style={[styles.toolbar, { top: insets.top + 4 }]}
      >
        <LiquidGlassIconButton
          leadingSymbolName="chevron.left"
          label={viewMode === 'detail' ? '2026년 10월' : '2026년'}
          buttonWidth={primaryPillWidth}
          buttonHeight={44}
          colorScheme={mode}
          onPress={showPreviewMessage('연도 보기')}
          accessibilityLabel="2026년 전체 월 보기"
          style={[styles.primaryPill, { width: primaryPillWidth }]}
        />
      </View>
      <LiquidCalendarMenuPrototype
        selectedMode={viewMode}
        colorScheme={mode}
        searchExpandedWidth={width - 32}
        searchQuery={searchQuery}
        onSearch={() => setSearchOpen(true)}
        onSearchTextChange={setSearchQuery}
        onSearchClose={() => setSearchOpen(false)}
        onOpenChange={setMenuOpen}
        onSelect={next => {
          if (next === 'stack' || next === 'detail' || next === 'list')
            setViewMode(next);
        }}
        style={[styles.menu, { top: insets.top + 4, width: menuWidth }]}
      />
      {searchPreview && searchOpen && searchQuery.trim().length > 0 && (
        <View style={[styles.searchResults, { top: insets.top + 74 }]}>
          <CalendarSearchResults
            searchResults={fixtureItems.filter(item =>
              [item.title, item.category.title, item.locationName]
                .join(' ')
                .toLocaleLowerCase()
                .includes(searchQuery.trim().toLocaleLowerCase()),
            )}
            searchKeywordLength={searchQuery.trim().length}
            searchLoading={false}
            searchError={scenario === 'error' ? '검토용 검색 오류' : null}
            onRetry={showPreviewMessage('검색 다시 시도')}
            onOpenSchedule={showPreviewMessage('일정 열기')}
          />
        </View>
      )}
      <GlobalFloatingActionBar
        bottomInset={insets.bottom}
        leftActions={[
          {
            key: 'today',
            label: '오늘',
            accessibilityLabel: '오늘로 이동',
            onPress: () => setSelectedDay(DAY),
          },
        ]}
        rightActions={[
          {
            key: 'calendar',
            icon: SCHEDULE_ICONS.calendar,
            accessibilityLabel: '캘린더 선택',
            onPress: showPreviewMessage('캘린더 선택'),
          },
          {
            key: 'notification',
            icon: SCHEDULE_ICONS.notifications,
            accessibilityLabel: '알림함',
            onPress: showPreviewMessage('알림함'),
          },
          {
            key: 'inbox',
            icon: SCHEDULE_ICONS.inbox,
            badgeCount: scenario === 'stress' ? 3 : undefined,
            emphasized: scenario === 'stress',
            accessibilityLabel: '공유함',
            onPress: showPreviewMessage('공유함'),
          },
          {
            key: 'account',
            icon: SCHEDULE_ICONS.account,
            accessibilityLabel: '내 정보 및 설정',
            onPress: showPreviewMessage('내 정보 및 설정'),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  searchResults: { position: 'absolute', left: 16, right: 16, zIndex: 72 },
  list: { flex: 1 },
  primaryPill: { height: 44 },
  stackHeader: { position: 'absolute', left: 0, right: 0, height: 68 },
  stackMonthTitle: {
    height: 50,
    paddingHorizontal: 20,
    fontSize: 33,
    fontWeight: '700',
  },
  stackWeekdays: {
    height: 18,
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbar: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 70,
  },
  menu: { position: 'absolute', right: 16, height: 400, zIndex: 71 },
  weekdays: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: 18,
    flexDirection: 'row',
  },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 16,
  },
});
