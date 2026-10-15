import React from 'react';
import { Ionicons } from '@expo/vector-icons';

import { SCHEDULE_ICONS, SCHEDULE_ICON_SIZES } from '../shared/ScheduleIcon';
import type { CalendarViewMode } from './viewMode';

type Props = {
  mode: CalendarViewMode;
  color: string;
  size?: number;
  toolbar?: boolean;
};

const ICON_BY_MODE = {
  stack: SCHEDULE_ICONS.stack,
  detail: SCHEDULE_ICONS.detail,
  week: SCHEDULE_ICONS.calendar,
  list: SCHEDULE_ICONS.list,
} as const;

export default function CalendarViewModeGlyph({
  mode,
  color,
  size,
  toolbar = false,
}: Props) {
  return (
    <Ionicons
      accessible={false}
      name={toolbar ? SCHEDULE_ICONS.view : ICON_BY_MODE[mode]}
      size={size ?? SCHEDULE_ICON_SIZES[toolbar ? 'toolbar' : 'menu']}
      color={color}
    />
  );
}
