import React from 'react';
import { Dimensions, RefreshControl, ScrollView, Text } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import BlockedSharingMembersScreen from '../app/share/blocked';
import { getBlockedSharingMembers } from '../src/api/sharingSafety';
import { ThemeProvider } from '../src/modules/theme/ThemeContext';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), useRouter: () => ({}) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34 }),
}));
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  const transition = { duration: () => ({ reduceMotion: () => ({}) }) };
  return {
    __esModule: true,
    default: { View },
    FadeIn: transition,
    LinearTransition: transition,
    SlideInDown: transition,
    ReduceMotion: { System: 'system' },
    useReducedMotion: () => true,
  };
});
jest.mock('../src/ui/BrandedLoader', () => ({ BrandedLoadingState: () => null }));
jest.mock('../src/modules/notification/departureAlarmMutationRecovery', () => ({
  recoverDepartureAlarmsAfterMutation: jest.fn(),
}));
jest.mock('../src/modules/performance/useScreenFirstPaintPerformance', () => ({
  useScreenFirstPaintPerformance: () => undefined,
}));
jest.mock('../src/api/sharingSafety', () => ({
  getBlockedSharingMembers: jest.fn(),
  unblockSharingMember: jest.fn(),
}));

test('keeps blocked rows visible and retries a failed refresh from outside the scroll view', async () => {
  const load = jest.mocked(getBlockedSharingMembers);
  const member = { memberId: 3, name: '검토 사용자' };
  let completeRetry!: (members: typeof member[]) => void;
  load.mockResolvedValueOnce([member]).mockRejectedValueOnce(new Error('Network failure'))
    .mockImplementationOnce(() => new Promise(resolve => { completeRetry = resolve; }));
  const getDimensions = Dimensions.get.bind(Dimensions);
  const dimensions = jest.spyOn(Dimensions, 'get').mockImplementation(name => ({
    ...getDimensions(name), fontScale: 1,
  }));
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = TestRenderer.create(<ThemeProvider><BlockedSharingMembersScreen /></ThemeProvider>);
    });
    const root = renderer!.root;
    const retryID = { testID: 'sharing-blocks-refresh-retry' };
    const memberAction = { accessibilityLabel: '검토 사용자 차단 해제' };
    const refresh = root.findByType(RefreshControl);
    await act(async () => refresh.props.onRefresh());

    expect(root.findAllByProps(memberAction).length).toBeGreaterThan(0);
    expect(root.findByType(ScrollView).findAllByProps(retryID)).toHaveLength(0);
    await act(async () => root.findAllByProps(retryID)[0].props.onPress());

    expect(load).toHaveBeenCalledTimes(3);
    expect(root.findAllByProps(retryID)[0].props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(refresh.props.refreshing).toBe(false);
    await act(async () => completeRetry([member]));

    expect(root.findAllByProps(retryID)).toHaveLength(0);
    expect(root.findAllByType(Text).some(text => text.props.children === '검토 사용자')).toBe(true);
  } finally {
    await act(async () => renderer?.unmount());
    dimensions.mockRestore();
  }
});
