import React from 'react';
import { Animated, type LayoutChangeEvent } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { useSystemReduceMotion } from '../src/modules/performance/useSystemReduceMotion';
import { useScheduleDetailSheetController } from '../src/routeSupport/schedule/useScheduleDetailSheetController';

jest.mock('../src/modules/performance/useSystemReduceMotion', () => ({
  useSystemReduceMotion: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

it('keeps the sheet moving when the departure header changes the snap position', async () => {
  const motion = jest.mocked(useSystemReduceMotion);
  motion.mockReturnValue(false);
  const spring = jest.spyOn(Animated, 'spring').mockReturnValue({
    start: jest.fn(), stop: jest.fn(), reset: jest.fn(),
  });
  let renderer: ReactTestRenderer | undefined;
  let sheet: ReturnType<typeof useScheduleDetailSheetController>;

  function SheetHarness({ windowHeight }: { windowHeight: number }) {
    sheet = useScheduleDetailSheetController({
      windowHeight,
      bottomInset: 24,
      previewEnabled: false,
      initialSheetMode: 'compact',
      initialParticipantsExpanded: false,
    });
    return null;
  }

  try {
    await act(async () => { renderer = TestRenderer.create(<SheetHarness windowHeight={840} />); });
    await act(async () => { sheet.setExpandedContentHeight(430); });
    const jump = jest.spyOn(sheet!.sheetTranslateY, 'setValue');

    await act(async () => { sheet.snapSheet('expanded'); });
    const originalTarget = spring.mock.calls[0][1].toValue;
    await act(async () => {
      sheet.handleSheetHeaderLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 375, height: 94 } },
      } as LayoutChangeEvent);
    });
    expect(jump).not.toHaveBeenCalled();
    expect(spring).toHaveBeenCalledTimes(2);
    const measuredTarget = spring.mock.calls[1][1].toValue;
    expect(measuredTarget).not.toEqual(originalTarget);

    await act(async () => { sheet.handleCompactContentSizeChange(375, 260); });
    expect(spring).toHaveBeenCalledTimes(2);
    expect(jump).not.toHaveBeenCalled();

    motion.mockReturnValue(true);
    await act(async () => { renderer!.update(<SheetHarness windowHeight={840} />); });
    expect(jump).toHaveBeenLastCalledWith(measuredTarget);
  } finally {
    await act(async () => renderer?.unmount());
    motion.mockReset();
    jest.restoreAllMocks();
  }
});
