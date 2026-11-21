import React from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { useCalendarImportController } from '../src/routeSupport/onboarding/useCalendarImportController';

jest.mock('@react-navigation/native', () => ({ usePreventRemove: jest.fn() }));
jest.mock('expo-application', () => ({ applicationId: 'dev.nolate.test' }));
jest.mock('expo-auth-session', () => ({
  makeRedirectUri: () => 'nolate://oauthredirect',
  useAuthRequest: () => [null, null, jest.fn()],
}));
jest.mock('expo-auth-session/providers/google', () => ({ discovery: {} }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), useRouter: () => ({}) }));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../src/modules/auth/AuthContext', () => ({
  useAuth: () => ({ isCurationCompleted: false, syncAuthentication: jest.fn() }),
}));
jest.mock('../src/modules/onboarding/deviceCalendarImport', () => ({
  getCalendarProviderLabel: () => 'Apple', getDefaultSelectedCandidateIds: () => new Set(),
}));
jest.mock('../src/modules/onboarding/googleCalendarImport', () => ({
  createGoogleCalendarAuthRequestConfig: () => ({}), GOOGLE_CALENDAR_CLIENT_ID: 'test',
}));
jest.mock('../src/modules/schedule/favoriteDeparture', () => ({
  getFavoriteDeparturePlaces: async () => [], hasFavoriteDepartureCoords: () => false,
}));
jest.mock('../src/modules/schedule/store', () => ({
  useScheduleStore: () => ({ state: { categories: [] }, dispatch: jest.fn() }),
}));
jest.mock('../src/modules/theme/ThemeContext', () => ({
  useTheme: () => ({ colors: {}, mode: 'light' }),
}));
jest.mock('../src/routeSupport/onboarding/calendarImportStyles', () => ({
  createCalendarImportStyles: () => ({}),
}));
jest.mock('../src/routeSupport/onboarding/calendarImportActions', () => ({
  createCalendarImportActions: () => ({ importSelectedSchedules: jest.fn() }),
}));
jest.mock('../src/routeSupport/onboarding/calendarImportScanActions', () => ({
  createCalendarImportScanActions: () => ({ scanCalendars: jest.fn() }),
}));
jest.mock('../src/routeSupport/onboarding/useCalendarImportSupportActions', () => {
  const loadCategories = async () => undefined;
  return { useCalendarImportSupportActions: () => ({ loadCategories }) };
});
jest.mock('../src/routeSupport/onboarding/calendarImportModel', () => ({
  buildCalendarConsentItems: () => [], buildCalendarProviderOptions: () => [],
  buildCandidateSourceGroups: () => [], isCalendarRouteCandidate: () => false,
  motionStepIndex: (step: string) => ['intro', 'provider', 'permission'].indexOf(step),
  CANDIDATE_PAGE_SIZE: 20, STEP_MOTION_DURATION_MS: 220,
}));

describe('calendar import motion preference changes', () => {
  let renderer: ReactTestRenderer;
  let controller: ReturnType<typeof useCalendarImportController>;
  let changeReduceMotion: (enabled: boolean) => void;
  let timing: jest.SpyInstance;
  let scrollTo: jest.Mock;
  let animationFinished: ((result: { finished: boolean }) => void) | undefined;
  const stop = jest.fn();

  function Harness() {
    controller = useCalendarImportController();
    return null;
  }

  beforeEach(async () => {
    jest.useFakeTimers();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    scrollTo = jest.fn();
    stop.mockClear();
    animationFinished = undefined;
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', () => undefined);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((name, callback) => {
      expect(name).toBe('reduceMotionChanged');
      changeReduceMotion = callback as unknown as typeof changeReduceMotion;
      return subscription;
    });
    timing = jest.spyOn(Animated, 'timing').mockImplementation(() => ({
      start: callback => { animationFinished = callback; }, stop, reset: jest.fn(),
    }));
    await act(async () => { renderer = TestRenderer.create(<Harness />); });
    controller!.scrollViewRef.current = { scrollTo } as never;
    act(() => { jest.runOnlyPendingTimers(); });
    timing.mockClear();
    scrollTo.mockClear();
  });

  afterEach(() => {
    act(() => { renderer.unmount(); });
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('changing Reduce Motion on the same step preserves the viewport and settled page', () => {
    act(() => { controller!.goToStep('provider'); });
    act(() => { jest.runOnlyPendingTimers(); });
    expect(timing).toHaveBeenCalledTimes(1);
    act(() => { animationFinished?.({ finished: true }); });
    controller!.trackScroll(180);
    timing.mockClear();
    scrollTo.mockClear();

    act(() => { changeReduceMotion(true); });
    act(() => { changeReduceMotion(false); });
    act(() => { jest.runOnlyPendingTimers(); });

    expect(controller!.step).toBe('provider');
    expect(timing).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    expect((controller!.stepMotionStyle.opacity as Animated.Value & { __getValue(): number }).__getValue()).toBe(1);

    act(() => { controller!.goToStep('permission'); });
    expect(timing).toHaveBeenCalledTimes(1);
    expect(timing.mock.calls[0][1]).toMatchObject({ duration: 220, useNativeDriver: true });
  });

  test('enabling Reduce Motion during a transition settles without starting a second transition', () => {
    act(() => { controller!.goToStep('provider'); });
    expect(timing).toHaveBeenCalledTimes(1);
    act(() => { changeReduceMotion(true); });
    expect(stop).toHaveBeenCalledTimes(1);
    expect((controller!.stepMotionStyle.opacity as Animated.Value & { __getValue(): number }).__getValue()).toBe(1);
    act(() => { changeReduceMotion(false); });
    expect(timing).toHaveBeenCalledTimes(1);
    act(() => { jest.runOnlyPendingTimers(); });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 0, animated: false });
    controller!.trackScroll(120);
    act(() => { controller!.goToStep('permission'); });
    act(() => { jest.runOnlyPendingTimers(); });
    act(() => { controller!.goToStep('provider'); });
    act(() => { jest.runOnlyPendingTimers(); });
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 120, animated: false });
  });
});
