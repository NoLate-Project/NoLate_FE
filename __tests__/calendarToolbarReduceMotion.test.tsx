import React from 'react';
import { Animated, Keyboard } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { useScheduleIndexToolbarActions } from '../src/modules/schedule/hooks/useScheduleIndexToolbarActions';
import { useScheduleIndexToolbarPresentation } from '../src/modules/schedule/hooks/useScheduleIndexToolbarPresentation';

jest.mock('expo-router', () => ({}));
jest.mock('../src/modules/performance/ImmediateNavigationTransition', () => ({
  useImmediateNavigationTransition: () => ({ runWithTransitionShell: jest.fn() }),
}));
jest.mock('../src/api/schedule', () => ({ parseScheduleText: jest.fn() }));
jest.mock('../src/modules/schedule/scheduleCreateMutation', () => ({ createScheduleForAddItem: jest.fn() }));
jest.mock('../src/modules/schedule/calendarScheduleCache', () => ({}));
jest.mock('../src/modules/schedule/quickInputExtraction', () => ({}));

type Options = Parameters<typeof useScheduleIndexToolbarActions>[0];
type PresentationOptions = Parameters<typeof useScheduleIndexToolbarPresentation>[0];

describe('calendar toolbar reduced motion', () => {
  let renderer: ReactTestRenderer | undefined;
  let actions: ReturnType<typeof useScheduleIndexToolbarActions>;
  let options: Options;
  let frames: Map<number, (time: number) => void>;
  let sequence: number;

  function Harness() {
    actions = useScheduleIndexToolbarActions(options);
    return null;
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    frames = new Map();
    sequence = 0;
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation(callback => {
      const id = ++sequence;
      frames.set(id, callback);
      return id;
    });
    jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
    jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    options = {
      activeToolbarMenu: null,
      isSearchToolbarOpen: false,
      reduceMotionEnabled: true,
      usesLiquidViewModeControl: false,
      searchToolbarProgress: new Animated.Value(0),
      toolbarDropdownProgress: new Animated.Value(0),
      searchInputRef: { current: null },
      setActiveToolbarMenu: jest.fn(),
      setToolbarMenuClosing: jest.fn(),
      setSearchQuery: jest.fn(),
      requestCloseLiquidPrototype: jest.fn(),
    } as unknown as Options;
  });

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    jest.restoreAllMocks();
  });

  async function render() {
    await act(async () => { renderer = TestRenderer.create(<Harness />); });
  }

  function numeric(value: Animated.Value) {
    return (value as Animated.Value & { __getValue(): number }).__getValue();
  }

  it('opens, closes and reopens the fallback without a spring or width morph', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    const spring = jest.spyOn(Animated, 'spring');
    await render();
    act(() => actions.openToolbarMenu('add'));
    expect(options.setActiveToolbarMenu).toHaveBeenLastCalledWith('add');
    expect(numeric(options.toolbarDropdownProgress)).toBe(1);
    options = { ...options, activeToolbarMenu: 'add' };
    await act(async () => renderer?.update(<Harness />));
    act(() => actions.closeToolbarMenu());
    expect(options.setActiveToolbarMenu).toHaveBeenLastCalledWith(null);
    expect(numeric(options.toolbarDropdownProgress)).toBe(0);
    options = { ...options, activeToolbarMenu: null };
    await act(async () => renderer?.update(<Harness />));
    act(() => actions.openSearchToolbar());
    expect(options.setActiveToolbarMenu).toHaveBeenLastCalledWith('search');
    expect(numeric(options.searchToolbarProgress)).toBe(1);
    expect(timing).not.toHaveBeenCalled();
    expect(spring).not.toHaveBeenCalled();
  });

  it('cancels a pending normal entrance when Reduce Motion is enabled', async () => {
    options.reduceMotionEnabled = false;
    const timing = jest.spyOn(Animated, 'timing');
    const spring = jest.spyOn(Animated, 'spring');
    await render();
    act(() => actions.openToolbarMenu('add'));
    expect(frames.size).toBe(1);
    options = { ...options, activeToolbarMenu: 'add', reduceMotionEnabled: true };
    await act(async () => renderer?.update(<Harness />));
    expect(frames.size).toBe(0);
    expect(numeric(options.toolbarDropdownProgress)).toBe(1);
    expect(timing).not.toHaveBeenCalled();
    expect(spring).not.toHaveBeenCalled();
  });

  it('leaves native Liquid control values to the native presenter', async () => {
    options.usesLiquidViewModeControl = true;
    options.searchToolbarProgress.setValue(0.4);
    options.toolbarDropdownProgress.setValue(0.7);
    await render();
    expect(numeric(options.searchToolbarProgress)).toBe(0.4);
    expect(numeric(options.toolbarDropdownProgress)).toBe(0.7);
  });

  it('uses the final control geometry even halfway through an interrupted entrance', async () => {
    let presentation: ReturnType<typeof useScheduleIndexToolbarPresentation> | undefined;
    const props = {
      reduceMotionEnabled: true,
      toolbarDropdownProgress: new Animated.Value(0.5),
      searchToolbarProgress: new Animated.Value(0.5),
      monthCalendarTransitionProgress: new Animated.Value(1),
      todayFocusOpacity: new Animated.Value(1),
      searchHeaderTargetWidth: 340,
      retainedMonthAgendaPanelKind: 'detail',
      calendarViewMode: 'detail',
      calendarDepth: 'month',
      firstDay: 0,
      visibleMonth: '2026-11',
    } as PresentationOptions;
    function Presentation() {
      presentation = useScheduleIndexToolbarPresentation(props);
      return null;
    }
    await act(async () => { renderer = TestRenderer.create(<Presentation />); });
    expect(presentation).toMatchObject({
      dropdownScaleX: 1, dropdownScaleY: 1, dropdownTranslateY: 0,
      viewDropdownScaleX: 1, viewDropdownScaleY: 1, viewDropdownTranslateY: 0,
      searchHeaderWidth: 340, searchFieldContentTranslateX: 0, searchFieldContentTranslateY: 0,
    });
  });
});
