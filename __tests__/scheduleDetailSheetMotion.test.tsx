import React from 'react';
import { Animated, type LayoutChangeEvent } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { useSystemReduceMotion } from '../src/modules/performance/useSystemReduceMotion';
import { useScheduleDetailSheetController } from '../src/routeSupport/schedule/useScheduleDetailSheetController';

jest.mock('../src/modules/performance/useSystemReduceMotion', () => ({
  useSystemReduceMotion: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

it('keeps the compact guidance content above the safe area and reports the visible sheet after expansion', async () => {
  jest.mocked(useSystemReduceMotion).mockReturnValue(true);
  let sheet!: ReturnType<typeof useScheduleDetailSheetController>;
  function Sheet({ bottomInset }: { bottomInset: number }) {
    sheet = useScheduleDetailSheetController({
      windowHeight: 840, bottomInset, previewEnabled: false, guidanceNavigation: true,
      initialSheetMode: 'compact', initialParticipantsExpanded: false,
    });
    return null;
  }
  let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = TestRenderer.create(<Sheet bottomInset={0} />); });
    const withoutSafeArea = sheet.sheetMinHeight;
    await act(async () => { renderer.update(<Sheet bottomInset={34} />); });
    expect(sheet.sheetMinHeight - withoutSafeArea).toBe(34);
    expect(sheet.sheetVisibleHeight).toBe(sheet.sheetMinHeight);
    await act(async () => { sheet.handleCompactContentSizeChange(375, 250); });
    expect(sheet.sheetMinHeight).toBeGreaterThanOrEqual(250 + 34);
    const compactHeight = sheet.sheetVisibleHeight;
    await act(async () => { sheet.setExpandedContentHeight(500); sheet.snapSheet('expanded'); });
    expect(sheet.sheetVisibleHeight).toBeGreaterThan(compactHeight);
    expect(sheet.sheetVisibleHeight).toBeLessThan(640);
    await act(async () => { sheet.snapSheet('compact'); });
    expect(sheet.sheetVisibleHeight).toBe(compactHeight);
  } finally {
    await act(async () => renderer?.unmount());
    jest.mocked(useSystemReduceMotion).mockReset();
  }
});

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
