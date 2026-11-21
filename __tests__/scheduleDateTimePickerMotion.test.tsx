import React, { useState } from 'react';
import { Animated } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { useScheduleAddPickerAnimation } from '../src/modules/schedule/components/form/useScheduleAddPickerAnimation';
import { useScheduleDateTimePickerAnimation } from '../src/modules/schedule/screens/useScheduleEditPickerAnimations';
import { type PickerType } from '../src/modules/schedule/components/form/scheduleAddModalModel';

let mockReduceMotion = false;
jest.mock('../src/modules/performance/useSystemReduceMotion', () => ({
  useSystemReduceMotion: () => mockReduceMotion,
}));

type PickerState = ReturnType<typeof useScheduleDateTimePickerAnimation>;

function value(animated: Animated.Value) {
  return (animated as Animated.Value & { __getValue: () => number }).__getValue();
}

describe.each(['create', 'edit'] as const)('%s date/time picker motion', mode => {
  let renderer: ReactTestRenderer;
  let state: PickerState;
  function CreatePicker() {
    const [picker, setPicker] = useState<PickerType | null>(null);
    const [displayPicker, setDisplayPicker] = useState<PickerType | null>(null);
    const motion = useScheduleAddPickerAnimation({ picker, setDisplayPicker });
    state = { picker, setPicker, displayPicker, togglePicker: setPicker, ...motion };
    return null;
  }
  function EditPicker() {
    state = useScheduleDateTimePickerAnimation();
    return null;
  }
  const Harness = mode === 'create' ? CreatePicker : EditPicker;
  const choose = async (picker: PickerType | null) => {
    await act(async () => state.setPicker(picker));
  };
  const advance = async (milliseconds: number) => {
    await act(async () => jest.advanceTimersByTime(milliseconds));
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    mockReduceMotion = false;
    await act(async () => { renderer = TestRenderer.create(<Harness />); });
    await choose('startDate');
    await advance(1800);
  });
  afterEach(async () => {
    await act(async () => renderer.unmount());
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('keeps the picker closed when closing during a date-to-time fade', async () => {
    await choose('startTime');
    await advance(40);
    await choose(null);
    await advance(1800);
    expect(state.picker).toBeNull();
    expect(state.displayPicker).toBeNull();
    expect(value(state.heightAnim)).toBe(0);
    expect(value(state.outerOpacity)).toBe(0);
  });

  it('uses the latest time field after an interrupted date-to-time fade', async () => {
    await choose('startTime');
    await advance(40);
    await choose('endTime');
    await advance(1800);
    expect(state.displayPicker).toBe('endTime');
    expect(value(state.heightAnim)).toBeCloseTo(216, 0);
    expect(value(state.outerOpacity)).toBe(1);
    expect(value(state.contentFade)).toBe(1);
  });

  it('compares the next picker with the content still on screen', async () => {
    await choose('startTime');
    await advance(40);
    await choose('endDate');
    expect(state.displayPicker).toBe('endDate');
    expect(value(state.contentFade)).toBe(1);
    await advance(1800);
    expect(state.displayPicker).toBe('endDate');
    expect(value(state.heightAnim)).toBeCloseTo(312, 0);
  });

  it('reopens during closing without retaining a faded or stale picker', async () => {
    await choose('startTime');
    await advance(160);
    await choose(null);
    await advance(50);
    await choose('endDate');
    await advance(1800);
    expect(state.displayPicker).toBe('endDate');
    expect(value(state.heightAnim)).toBeCloseTo(312, 0);
    expect(value(state.outerOpacity)).toBe(1);
    expect(value(state.contentFade)).toBe(1);
  });

  it('settles immediately when Reduce Motion changes during a transition', async () => {
    await choose('startTime');
    await advance(40);
    mockReduceMotion = true;
    await act(async () => renderer.update(<Harness />));
    expect(state.displayPicker).toBe('startTime');
    expect(value(state.heightAnim)).toBe(216);
    expect(value(state.outerOpacity)).toBe(1);
    expect(value(state.contentFade)).toBe(1);
    await choose(null);
    expect(state.displayPicker).toBeNull();
    expect(value(state.heightAnim)).toBe(0);
    await advance(1800);
    expect(state.displayPicker).toBeNull();
  });
});
