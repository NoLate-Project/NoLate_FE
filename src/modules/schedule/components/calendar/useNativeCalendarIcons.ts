import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { SCHEDULE_ICONS, type ScheduleIconName } from '../shared/ScheduleIcon';

// Existing SF identifiers adapt to the same Ionicons glyphs used by React Native.
const NATIVE_ICON_ROLES: Record<string, ScheduleIconName> = {
  'toolbar.view': 'view',
  'view.stack': 'stack',
  'view.detail': 'detail',
  'view.list': 'list',
  'view.day': 'calendar',
  'view.multi': 'multiDay',
  magnifyingglass: 'search',
  plus: 'add',
  'chevron.left': 'back',
  'xmark.circle.fill': 'clear',
  xmark: 'close',
  checkmark: 'check',
  bolt: 'quickAdd',
  'square.and.pencil': 'edit',
  tag: 'category',
  'calendar.badge.plus': 'calendar',
  'person.circle': 'account',
  envelope: 'inbox',
  bell: 'notifications',
  calendar: 'calendar',
};

let loadedIcons: Record<string, string> | undefined;
let loadingIcons: Promise<Record<string, string>> | undefined;

export default function useNativeCalendarIcons() {
  const [icons, setIcons] = useState(loadedIcons);

  useEffect(() => {
    if (Platform.OS !== 'ios' || typeof Ionicons.loadFont !== 'function')
      return;
    if (loadedIcons) {
      setIcons(loadedIcons);
      return;
    }
    let active = true;
    loadingIcons ??= Ionicons.loadFont()
      .then(() => {
        loadedIcons = {
          fontFamily: Ionicons.getFontFamily(),
          ...Object.fromEntries(
            Object.entries(NATIVE_ICON_ROLES).map(([symbol, role]) => {
              const glyph = Ionicons.glyphMap[SCHEDULE_ICONS[role]];
              return [
                symbol,
                typeof glyph === 'number' ? String.fromCodePoint(glyph) : glyph,
              ];
            }),
          ),
        };
        return loadedIcons;
      })
      .catch((error: unknown) => {
        loadingIcons = undefined;
        throw error;
      });
    loadingIcons
      .then(value => {
        if (active) setIcons(value);
      })
      .catch(() => {
        // Native SF symbols remain visible if the font cannot load.
      });
    return () => {
      active = false;
    };
  }, []);

  return icons;
}
