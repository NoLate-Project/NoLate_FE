import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Ionicons } from '@expo/vector-icons';

import useNativeCalendarIcons from '../src/modules/schedule/components/calendar/useNativeCalendarIcons';
import CalendarViewModeGlyph from '../src/modules/schedule/components/calendar/CalendarViewModeGlyph';
import { SCHEDULE_ICONS } from '../src/modules/schedule/components/shared/ScheduleIcon';

jest.mock('@expo/vector-icons', () => {
  const ReactModule = jest.requireActual('react');
  const Icon = Object.assign(
    (props: Record<string, unknown>) =>
      ReactModule.createElement('Ionicons', props),
    {
      loadFont: jest.fn(),
      getFontFamily: () => 'ionicons',
      glyphMap: jest.requireActual(
        '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json',
      ),
    },
  );
  return { Ionicons: Icon };
});

function NativeIconProbe() {
  const icons = useNativeCalendarIcons();
  return React.createElement('NativeIconProbe', { icons });
}

describe('main calendar icon bridge', () => {
  let renderer: ReactTestRenderer | undefined;
  const loadFont = Ionicons.loadFont as jest.Mock;

  beforeAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    jest.clearAllMocks();
  });

  test('keeps native fallback icons when font registration fails', async () => {
    loadFont.mockRejectedValueOnce(new Error('font unavailable'));
    await act(async () => {
      renderer = TestRenderer.create(<NativeIconProbe />);
    });
    expect(
      renderer!.root.findByType('NativeIconProbe' as React.ElementType).props
        .icons,
    ).toBeUndefined();
  });

  test('registers once and supplies the same glyphs to native glass controls', async () => {
    loadFont.mockResolvedValue(undefined);
    await act(async () => {
      renderer = TestRenderer.create(
        <>
          <NativeIconProbe />
          <NativeIconProbe />
        </>,
      );
    });
    const probes = renderer!.root.findAllByType(
      'NativeIconProbe' as React.ElementType,
    );
    const icons = probes[0].props.icons;
    expect(loadFont).toHaveBeenCalledTimes(1);
    expect(probes[1].props.icons).toBe(icons);
    expect(icons.fontFamily).toBe('ionicons');
    for (const [nativeName, iconName] of [
      ['toolbar.view', SCHEDULE_ICONS.view],
      ['view.detail', SCHEDULE_ICONS.detail],
      ['view.list', SCHEDULE_ICONS.list],
      ['magnifyingglass', SCHEDULE_ICONS.search],
      ['envelope', SCHEDULE_ICONS.inbox],
    ] as const) {
      expect(icons[nativeName]).toBe(
        String.fromCodePoint(Number(Ionicons.glyphMap[iconName])),
      );
    }
  });

  test('view toolbar keeps one outline icon across all three modes', async () => {
    await act(async () => {
      renderer = TestRenderer.create(
        <>
          {(['stack', 'detail', 'list'] as const).map(mode => (
            <CalendarViewModeGlyph
              key={mode}
              mode={mode}
              color="#000"
              toolbar
            />
          ))}
        </>,
      );
    });
    const icons = renderer!.root.findAllByType('Ionicons' as React.ElementType);
    expect(icons).toHaveLength(3);
    expect(
      icons.every(
        icon =>
          icon.props.name === SCHEDULE_ICONS.view && icon.props.size === 22,
      ),
    ).toBe(true);
  });
});
