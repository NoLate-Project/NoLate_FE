import React from 'react';
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { AccessibilityInfo, Dimensions, ScrollView, StyleSheet, Text } from 'react-native';
import CalendarSearchResults from '../src/modules/schedule/components/list/CalendarSearchResults';
import { ThemeProvider } from '../src/modules/theme/ThemeContext';
import type { ScheduleItem } from '../src/modules/schedule/types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

function measuredDateHeader(heading: ReactTestInstance) {
  let wrapper = heading.parent;
  while (wrapper && typeof wrapper.props.onLayout !== 'function') {
    wrapper = wrapper.parent;
  }
  return wrapper;
}

const item: ScheduleItem = {
  id: 'search-meeting',
  title: '프로덕트 주간 회의',
  startAt: '2026-10-12T14:00:00',
  endAt: '2026-10-12T15:00:00',
  category: { id: 'work', title: '업무', color: '#4C88FF' },
  locationName: '성수 오피스',
};

describe('calendar search results', () => {
  let renderer: ReactTestRenderer | undefined;
  const getDimensions = Dimensions.get.bind(Dimensions);
  beforeEach(() => {
    jest.spyOn(Dimensions, 'get').mockImplementation(name => ({
      ...getDimensions(name),
      fontScale: 1,
    }));
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    jest.restoreAllMocks();
  });
  async function render(
    overrides: Partial<React.ComponentProps<typeof CalendarSearchResults>> = {},
  ) {
    const onRetry = jest.fn();
    const onOpenSchedule = jest.fn();
    await act(async () => {
      renderer = TestRenderer.create(
        <ThemeProvider>
          <CalendarSearchResults
            searchResults={[item]}
            searchLoading={false}
            searchError={null}
            searchKeywordLength={2}
            onRetry={onRetry}
            onOpenSchedule={onOpenSchedule}
            {...overrides}
          />
        </ThemeProvider>,
      );
    });
    const labels = () =>
      renderer!.root
        .findAllByType(Text)
        .map(node => node.props.children)
        .flat()
        .join(' ');
    return { root: renderer!.root, labels, onRetry, onOpenSchedule };
  }
  test('shows the original compact date and start time, then opens the exact schedule', async () => {
    const { root, labels, onOpenSchedule } = await render();
    expect(labels()).toContain('10월 12일 (월)');
    expect(labels()).toContain('오후 2:00');
    const row = root.findAll(
      node =>
        node.props.accessibilityRole === 'button' &&
        String(node.props.accessibilityLabel).startsWith(item.title),
    )[0];
    act(() => row.props.onPress());
    expect(onOpenSchedule).toHaveBeenCalledWith('search-meeting');
  });
  test('does not expose stale results while loading', async () => {
    const { labels } = await render({ searchLoading: true });
    expect(labels()).toContain('일정을 찾고 있어요');
    expect(labels()).not.toContain(item.title);
  });
  test('keeps the same result list on detail return and resets it for a different query', async () => {
    const view = (searchQuery: string, isFocused: boolean) => (
      <ThemeProvider>
        <CalendarSearchResults searchResults={[item]} searchLoading={false} searchError={null}
          searchKeywordLength={searchQuery.length} searchQuery={searchQuery} isFocused={isFocused}
          onRetry={jest.fn()} onOpenSchedule={jest.fn()} />
      </ThemeProvider>
    );
    await act(async () => { renderer = TestRenderer.create(view('회의', true)); });
    const list = renderer!.root.findByType(ScrollView);
    await act(async () => { renderer!.update(view('회의', false)); });
    await act(async () => { renderer!.update(view('회의', true)); });
    expect(renderer!.root.findByType(ScrollView)).toBe(list);
    await act(async () => { renderer!.update(view('프로덕트', true)); });
    expect(renderer!.root.findByType(ScrollView)).not.toBe(list);
  });
  test('retry replaces stale results and invokes the supplied retry action', async () => {
    const { root, labels, onRetry } = await render({ searchError: 'failed' });
    expect(labels()).not.toContain(item.title);
    act(() =>
      root
        .findByProps({ accessibilityLabel: '일정 검색 다시 시도' })
        .props.onPress(),
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  test('groups results by date, keeps the headings sticky, and shows the result count', async () => {
    const { root, labels } = await render({
      searchResults: [item, { ...item, id: 'same-day' }, { ...item, id: 'next-day', startAt: '2026-10-13T10:00:00' }],
    });
    expect(root.findByType(ScrollView).props.stickyHeaderIndices).toEqual([0, 3]);
    const headings = root.findAllByType(Text).filter(node => node.props.accessibilityRole === 'header');
    expect(headings).toHaveLength(2);
    for (const heading of headings) {
      expect(StyleSheet.flatten(heading.props.style)).toEqual(expect.objectContaining({ color: '#6e6e73' }));
      expect(StyleSheet.flatten(measuredDateHeader(heading)?.props.style)).toEqual({ backgroundColor: '#fff' });
    }
    expect(labels()).toContain('검색 결과 3개');
    await act(async () => renderer?.unmount());
    const withCalendarContext = await render({ countInCalendarContext: true });
    expect(withCalendarContext.labels()).not.toContain('검색 결과 1개');
    const datedCount = withCalendarContext.root.findByProps({ testID: 'calendar-search-result-count' });
    expect(datedCount.props.accessibilityLabel).toBe('검색 결과 1개');
    expect(datedCount.parent?.findByProps({ accessibilityRole: 'header' }).props.children).toBe('10월 12일 (월)');
  });

  test('puts the complete local date and time under each title at large text sizes', async () => {
    jest.mocked(Dimensions.get).mockImplementation(name => ({
      ...getDimensions(name),
      fontScale: 2,
    }));
    const { root, labels } = await render({
      countInCalendarContext: true,
      searchResults: [item, { ...item, id: 'same-day', allDay: true }],
    });
    expect(root.findByType(ScrollView).props.stickyHeaderIndices).toEqual([]);
    expect(labels()).toContain('10월 12일 (월) · 오후 2:00');
    expect(labels()).toContain('10월 12일 (월) · 종일');
    expect(labels()).toContain('검색 결과 2개');
  });

  test('distinguishes dates across years in visible headings and spoken row labels', async () => {
    const { root, labels } = await render({
      searchResults: [item, { ...item, id: 'next-year', startAt: '2027-10-12T14:00:00' }],
    });
    expect(labels()).toContain('2026년 10월 12일 (월)');
    expect(labels()).toContain('2027년 10월 12일 (화)');
    expect(root.findAllByProps({
      accessibilityLabel: '프로덕트 주간 회의, 2027년 10월 12일 (화), 오후 2:00',
    }).length).toBeGreaterThan(0);
  });

  test('reveals the measured row below its sticky date when an edit changes its group', async () => {
    const measureLayout = jest.fn((_content, onSuccess) => onSuccess(0, 306));
    const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => {});
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
    let returnFrame: ((timestamp: number) => void) | undefined;
    jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {
      returnFrame = callback;
      return 1;
    });
    const view = (isFocused: boolean, startAt: string) => (
      <ThemeProvider>
        <CalendarSearchResults searchResults={[{ ...item, startAt }]} searchLoading={false} searchError={null}
          searchKeywordLength={2} searchQuery="회의" isFocused={isFocused} reduceMotionEnabled
          onRetry={jest.fn()} onOpenSchedule={jest.fn()} />
      </ThemeProvider>
    );
    await act(async () => {
      renderer = TestRenderer.create(view(true, item.startAt), {
        createNodeMock: () => ({ measureLayout }),
      });
    });
    const root = renderer!.root;
    const row = root.findByProps({ accessibilityLabel: '프로덕트 주간 회의, 10월 12일 (월), 오후 2:00' });
    await act(async () => row.props.onPress());
    await act(async () => renderer!.update(view(false, item.startAt)));
    await act(async () => renderer!.update(view(true, '2026-10-18T14:00:00')));
    const updatedRow = root.findByProps({ accessibilityLabel: '프로덕트 주간 회의, 10월 18일 (일), 오후 2:00' });
    root.findByType(ScrollView).props.innerViewRef.current = {};
    updatedRow.props.ref({ measureLayout, _nativeTag: 42 });
    const heading = root.findAllByType(Text).find(node => node.props.accessibilityRole === 'header');
    act(() => measuredDateHeader(heading!)!.props.onLayout({ nativeEvent: { layout: { height: 42 } } }));
    expect(returnFrame).toBeDefined();
    act(() => returnFrame?.(0));
    expect(measureLayout).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 264, animated: false });
    expect(focus).toHaveBeenCalledWith(42);
  });

  test('waits for refreshed search results before reporting that an opened item was removed', async () => {
    const view = (isFocused: boolean, searchLoading: boolean, searchResults: ScheduleItem[]) => (
      <ThemeProvider>
        <CalendarSearchResults searchResults={searchResults} searchLoading={searchLoading} searchError={null}
          searchKeywordLength={2} searchQuery="회의" isFocused={isFocused} reduceMotionEnabled
          onRetry={jest.fn()} onOpenSchedule={jest.fn()} />
      </ThemeProvider>
    );
    await act(async () => { renderer = TestRenderer.create(view(true, false, [item])); });
    const root = renderer!.root;
    const row = root.findByProps({ accessibilityLabel: '프로덕트 주간 회의, 10월 12일 (월), 오후 2:00' });
    await act(async () => row.props.onPress());
    await act(async () => renderer!.update(view(false, true, [])));
    await act(async () => renderer!.update(view(true, true, [])));
    const notice = '방금 본 일정이 현재 검색 결과에서 빠졌어요.';
    expect(root.findAllByProps({ children: notice })).toHaveLength(0);
    await act(async () => renderer!.update(view(true, false, [])));
    expect(root.findAllByProps({ children: notice }).length).toBeGreaterThan(0);
  });
  test('short and empty searches have distinct guidance', async () => {
    let result = await render({ searchKeywordLength: 1 });
    expect(result.labels()).toContain('두 글자 이상 입력해 주세요');
    expect(result.labels()).not.toContain(item.title);
    act(() => renderer?.unmount());
    result = await render({ searchResults: [] });
    expect(result.labels()).toContain('일치하는 일정이 없어요');
  });
  test('respects all-day and absent end-time semantics', async () => {
    const { labels } = await render({
      searchResults: [
        { ...item, allDay: true },
        { ...item, id: 'no-end', hasEndTime: false },
      ],
    });
    expect(labels()).toContain('종일');
    expect(labels()).not.toContain('오후 3:00');
  });
  test('explains a place match and leaves out unrelated location information', async () => {
    const { labels, root } = await render({ searchQuery: ' 성수 ' });
    expect(labels()).toContain('성수 오피스');
    expect(root.findAll(node => node.props.accessibilityLabel?.includes('성수 오피스')).length).toBeGreaterThan(0);
    await act(async () => renderer?.unmount());
    const byTitle = await render({ searchQuery: '주간 회의' });
    expect(byTitle.labels()).not.toContain('성수 오피스');
  });

  test('highlights each literal title match while preserving its original case and spacing', async () => {
    const title = '계획 C++  회의, c++ 회의';
    const { root } = await render({
      searchQuery: 'C++ 회의',
      searchResults: [{ ...item, title }],
    });
    const matches = root.findAllByType(Text).filter(node => node.props.style?.color === '#1959DB');
    expect(matches.map(node => node.props.children)).toEqual(['C++  회의', 'c++ 회의']);
    expect(root.findAllByProps({ accessibilityLabel: `${title}, 10월 12일 (월), 오후 2:00` }).length).toBeGreaterThan(0);
  });
});
