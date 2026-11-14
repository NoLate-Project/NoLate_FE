import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { ScrollView, Text } from 'react-native';
import CalendarSearchResults from '../src/modules/schedule/components/list/CalendarSearchResults';
import { ThemeProvider } from '../src/modules/theme/ThemeContext';
import type { ScheduleItem } from '../src/modules/schedule/types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
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
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
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
});
