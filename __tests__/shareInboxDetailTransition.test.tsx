import React from 'react';
import { Animated, Text } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import InboxDestinationTransition from '../src/routeSupport/share/InboxDestinationTransition';
import { registerNotificationInboxReturn } from '../src/routeSupport/share/notificationInboxReturn';

const mockNavigation = { dispatch: jest.fn() };
const mockPreventRemove = jest.fn();
let mockReduceMotion = false;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  usePreventRemove: (...args: unknown[]) => mockPreventRemove(...args),
}));
jest.mock('../src/modules/performance/useSystemReduceMotion', () => ({
  useSystemReduceMotion: () => mockReduceMotion,
}));

describe('share inbox detail transition', () => {
  let renderer: ReactTestRenderer;
  let completeExit: ((result: { finished: boolean }) => void) | undefined;
  const mockAnimation = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    mockReduceMotion = false;
    completeExit = undefined;
    jest.spyOn(Animated, 'timing').mockReturnValue(mockAnimation);
    jest.spyOn(Animated, 'parallel').mockReturnValue(mockAnimation);
    mockAnimation.start.mockImplementation(callback => { completeExit = callback; });
  });

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    jest.restoreAllMocks();
  });

  const renderTransition = async (editing = false, source: 'share' | 'notification' = 'share', notificationInboxKey?: string) => {
    await act(async () => {
      renderer = TestRenderer.create(
        <InboxDestinationTransition source={source} editing={editing} notificationInboxKey={notificationInboxKey}>
          <Text>일정 상세</Text>
        </InboxDestinationTransition>,
      );
    });
  };

  it('opens in 240 ms and dispatches the original back action after one 180 ms exit', async () => {
    await renderTransition();
    expect(jest.mocked(Animated.timing).mock.calls.map(([, config]) => [config.duration, config.toValue]))
      .toEqual([[240, 0], [240, 1]]);
    const action = { type: 'GO_BACK', source: 'received-detail' };
    const close = mockPreventRemove.mock.lastCall?.[1] as (event: { data: { action: typeof action } }) => void;
    act(() => {
      close({ data: { action } });
      close({ data: { action } });
    });
    expect(jest.mocked(Animated.timing).mock.calls.slice(2).map(([, config]) => [config.duration, config.toValue]))
      .toEqual([[180, 12], [180, 0]]);
    expect(mockNavigation.dispatch).not.toHaveBeenCalled();
    act(() => completeExit?.({ finished: true }));
    expect(mockNavigation.dispatch).toHaveBeenCalledTimes(1);
    expect(mockNavigation.dispatch).toHaveBeenCalledWith(action);
  });

  it('opens notification destinations in 240 ms and pops after the source inbox return', async () => {
    const playReturn = jest.fn();
    const unregister = registerNotificationInboxReturn('inbox', playReturn);
    try {
      await renderTransition(false, 'notification', 'inbox');
      expect(jest.mocked(Animated.timing).mock.calls.map(([, config]) => [config.duration, config.toValue]))
        .toEqual([[240, 0], [240, 1]]);
      expect(mockPreventRemove.mock.lastCall?.[0]).toBe(true);
      const action = { type: 'GO_BACK', source: 'notification-destination' };
      const close = mockPreventRemove.mock.lastCall?.[1] as (event: { data: { action: typeof action } }) => void;
      act(() => close({ data: { action } }));
      expect(playReturn).toHaveBeenCalledTimes(1);
      expect(mockNavigation.dispatch).not.toHaveBeenCalled();
      act(() => playReturn.mock.lastCall?.[0]());
      expect(mockNavigation.dispatch).toHaveBeenCalledWith(action);
    } finally {
      unregister();
    }
  });

  it('lets the editor handle back actions and skips animation when Reduce Motion is enabled', async () => {
    await renderTransition(true);
    expect(mockPreventRemove.mock.lastCall?.[0]).toBe(false);
    expect(Animated.timing).toHaveBeenCalledTimes(2);
    await act(async () => renderer.unmount());
    jest.mocked(Animated.timing).mockClear();

    mockReduceMotion = true;
    await renderTransition();
    expect(mockPreventRemove.mock.lastCall?.[0]).toBe(false);
    expect(Animated.timing).not.toHaveBeenCalled();
  });
});
