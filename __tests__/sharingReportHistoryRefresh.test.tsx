import React from 'react';
import { Dimensions, RefreshControl, ScrollView, Text, View } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import SharingReportHistoryScreen from '../app/share/reports';
import { getMySharingReports, type SharingReport } from '../src/api/sharingSafety';
import { ThemeProvider } from '../src/modules/theme/ThemeContext';
import {
  createSceneActivityStore,
  PreMountedSceneActivityContext,
} from '../src/modules/performance/preMountedSceneActivity';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), useRouter: () => ({}) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('../src/modules/performance/useScreenFirstPaintPerformance', () => ({
  useScreenFirstPaintPerformance: () => undefined,
}));
jest.mock('../src/api/sharingSafety', () => ({ getMySharingReports: jest.fn() }));

const report: SharingReport = {
  id: 1, reportedMemberId: 2, resourceType: 'SCHEDULE', resourceId: 3,
  reason: 'SPAM', status: 'SUBMITTED', details: '읽고 있는 신고 내용',
};

test('reads reports when the pre-mounted scene opens and refreshes when it reopens', async () => {
  const load = jest.mocked(getMySharingReports);
  load.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([report]);
  const activity = createSceneActivityStore();
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ThemeProvider>
        <PreMountedSceneActivityContext.Provider value={activity}>
          <SharingReportHistoryScreen />
        </PreMountedSceneActivityContext.Provider>
      </ThemeProvider>,
    );
  });
  try {
    expect(load).not.toHaveBeenCalled();
    await act(async () => activity.setActive(true));
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => activity.setActive(false));
    await act(async () => activity.setActive(true));
    expect(load).toHaveBeenCalledTimes(2);
    expect(renderer.root.findAll(node => node.props.accessibilityLabel?.startsWith('스팸,')).length).toBeGreaterThan(0);
  } finally {
    await act(async () => renderer.unmount());
  }
});

test('keeps report details open and exposes refresh recovery outside the scroll view', async () => {
  const load = jest.mocked(getMySharingReports);
  load.mockReset();
  let failRefresh!: (error: Error) => void;
  load.mockResolvedValueOnce([report]).mockImplementationOnce(() => new Promise((_, reject) => {
    failRefresh = reject;
  })).mockResolvedValueOnce([report]);
  const getDimensions = Dimensions.get.bind(Dimensions);
  const dimensions = jest.spyOn(Dimensions, 'get').mockImplementation(name => ({
    ...getDimensions(name), fontScale: 1,
  }));
  let renderer!: ReactTestRenderer;

  await act(async () => {
    renderer = TestRenderer.create(<ThemeProvider><SharingReportHistoryScreen /></ThemeProvider>);
  });
  try {
    const row = renderer.root.findAll(node => node.props.accessibilityLabel?.startsWith('스팸,'))[0];
    await act(async () => row.props.onPress());
    const refresh = renderer.root.findAllByProps({ accessibilityLabel: '신고 내역 새로고침' })[0];
    await act(async () => {
      refresh.props.onPress();
      renderer.root.findByType(RefreshControl).props.onRefresh();
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(renderer.root.findByType(RefreshControl).props.refreshing).toBe(false);
    await act(async () => failRefresh(new Error('다시 불러오지 못했어요')));
    const scroll = renderer.root.findByType(ScrollView);
    const hasText = (value: string) => renderer.root.findAllByType(Text).some(text => text.props.children === value);
    const failureMessage = '신고 내역을 새로고침하지 못했어요.';
    expect(hasText('읽고 있는 신고 내용')).toBe(true);
    expect(hasText(failureMessage)).toBe(true);
    expect(scroll.findAllByProps({ testID: 'sharing-reports-refresh-retry' })).toHaveLength(0);
    const retry = renderer.root.findAllByProps({ testID: 'sharing-reports-refresh-retry' })[0];
    await act(async () => retry.props.onPress());
    expect(load).toHaveBeenCalledTimes(3);
    expect(row.props.accessibilityState.expanded).toBe(true);
    expect(hasText(failureMessage)).toBe(false);
    expect(hasText('신고 내역을 새로고침했어요.')).toBe(true);
  } finally {
    await act(async () => renderer.unmount());
    dimensions.mockRestore();
  }
});

test('retries a failed first load and shows the empty history after recovery', async () => {
  const load = jest.mocked(getMySharingReports);
  load.mockReset().mockRejectedValueOnce(new Error('Network failure')).mockResolvedValueOnce([]);
  const getDimensions = Dimensions.get.bind(Dimensions);
  const dimensions = jest.spyOn(Dimensions, 'get').mockImplementation(name => ({
    ...getDimensions(name), fontScale: 1,
  }));
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ThemeProvider><SharingReportHistoryScreen /></ThemeProvider>);
  });
  const containsText = (value: string) =>
    renderer.root.findAllByType(Text).some(text => text.props.children === value);
  try {
    expect(containsText('신고 내역을 불러오지 못했어요.')).toBe(true);
    expect(containsText('접수한 신고가 없어요')).toBe(false);
    const retry = renderer.root.findAllByProps({ accessibilityLabel: '다시 시도' })[0];
    await act(async () => retry.props.onPress());
    expect(load).toHaveBeenCalledTimes(2);
    expect(containsText('신고 내역을 불러오지 못했어요.')).toBe(false);
    expect(containsText('접수한 신고가 없어요')).toBe(true);
  } finally {
    await act(async () => renderer.unmount());
    dimensions.mockRestore();
  }
});

test('keeps the tapped report at its visible position when an earlier report closes', async () => {
  jest.mocked(getMySharingReports).mockReset().mockResolvedValue([
    report,
    { ...report, id: 2, reason: 'PRIVACY_CONCERN' },
  ]);
  const getDimensions = Dimensions.get.bind(Dimensions);
  const dimensions = jest.spyOn(Dimensions, 'get').mockImplementation(name => ({
    ...getDimensions(name), fontScale: 1,
  }));
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ThemeProvider><SharingReportHistoryScreen /></ThemeProvider>);
  });
  try {
    const row = (reason: string) => renderer.root.findAll(node => node.props.accessibilityLabel?.startsWith(reason))[0];
    const layoutRow = (id: number, y: number) => {
      const element = renderer.root.findAllByType(View).find(view => view.props.testID === `sharing-report-row-${id}`);
      element!.props.onLayout({ nativeEvent: { layout: { y } } });
    };
    const scroll = renderer.root.findByType(ScrollView);

    await act(async () => row('스팸,').props.onPress());
    await act(async () => {
      layoutRow(1, 30);
      layoutRow(2, 510);
      scroll.props.onScroll({ nativeEvent: { contentOffset: { y: 430 } } });
      row('개인정보 우려,').props.onPress();
    });
    expect(row('스팸,').props.accessibilityState.expanded).toBe(false);
    expect(row('개인정보 우려,').props.accessibilityState.expanded).toBe(true);

    await act(async () => layoutRow(2, 110));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 30, animated: false });
  } finally {
    await act(async () => renderer.unmount());
    scrollTo.mockRestore();
    dimensions.mockRestore();
  }
});
