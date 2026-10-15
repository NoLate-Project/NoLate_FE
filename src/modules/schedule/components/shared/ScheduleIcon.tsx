import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import type { TravelMode } from '../../types';

/** Main calendar icons share a family and role sizes across JS and native glass. */
export const SCHEDULE_ICONS = {
  view: 'albums-outline',
  stack: 'layers-outline',
  detail: 'reader-outline',
  list: 'list-outline',
  calendar: 'calendar-outline',
  multiDay: 'copy-outline',
  search: 'search-outline',
  add: 'add-outline',
  notifications: 'notifications-outline',
  inbox: 'mail-outline',
  account: 'person-circle-outline',
  location: 'location-outline',
  departure: 'navigate-outline',
  shared: 'people-outline',
  filter: 'funnel-outline',
  back: 'chevron-back-outline',
  forward: 'chevron-forward-outline',
  down: 'chevron-down-outline',
  close: 'close-outline',
  clear: 'close-circle-outline',
  check: 'checkmark-outline',
  refresh: 'refresh-outline',
  quickAdd: 'flash-outline',
  edit: 'pencil-outline',
  delete: 'trash-outline',
  category: 'pricetag-outline',
  walk: 'walk-outline',
  transit: 'bus-outline',
  car: 'car-outline',
  bike: 'bicycle-outline',
  text: 'text-outline',
  image: 'image-outline',
  microphone: 'mic-outline',
  time: 'time-outline',
  memo: 'document-text-outline',
} as const satisfies Record<
  string,
  React.ComponentProps<typeof Ionicons>['name']
>;

export const SCHEDULE_ICON_SIZES = {
  toolbar: 22,
  menu: 20,
  metadata: 16,
  calendarMarker: 10,
  formControl: 18,
} as const;
export type ScheduleIconName = keyof typeof SCHEDULE_ICONS;

export const SCHEDULE_TRAVEL_ICONS: Record<TravelMode, ScheduleIconName> = {
  TRANSIT: 'transit',
  CAR: 'car',
  WALK: 'walk',
  BIKE: 'bike',
  ETC: 'departure',
};

type Props = Omit<
  React.ComponentProps<typeof Ionicons>,
  'name' | 'size' | 'role'
> & {
  name: ScheduleIconName;
  role?: keyof typeof SCHEDULE_ICON_SIZES;
};

export default function ScheduleIcon({
  name,
  role = 'metadata',
  ...props
}: Props) {
  return (
    <Ionicons
      accessible={false}
      {...props}
      name={SCHEDULE_ICONS[name]}
      size={SCHEDULE_ICON_SIZES[role]}
    />
  );
}
