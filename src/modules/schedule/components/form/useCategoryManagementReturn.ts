import { usePathname } from 'expo-router';
import { useEffect, useRef, type RefObject } from 'react';
import { AccessibilityInfo, Keyboard, type View } from 'react-native';

const categoryManagerPath = '/schedule/categories' as const;

export function scheduleFormCategoryManagerRoute(calendarId?: number | null, calendarTitle?: string) {
  return {
    pathname: categoryManagerPath,
    params: {
      returnTo: 'schedule-form',
      ...(typeof calendarId === 'number' && { calendarId: String(calendarId), calendarTitle }),
    },
  };
}

/** Keep the draft mounted and restore focus after the manager has actually opened and closed. */
export function useCategoryManagementReturn(categoryTrigger: RefObject<View | null>, enabled = true) {
  const pathname = usePathname();
  const visit = useRef<{ source: string; opened: boolean } | null>(null);

  useEffect(() => {
    const pending = visit.current;
    if (!enabled) {
      visit.current = null;
      return;
    }
    if (!pending) return;
    if (pathname === categoryManagerPath) {
      pending.opened = true;
      return;
    }
    if (!pending.opened || pathname !== pending.source) return;
    const frame = requestAnimationFrame(() => {
      if (visit.current !== pending) return;
      visit.current = null;
      if (categoryTrigger.current) AccessibilityInfo.sendAccessibilityEvent?.(categoryTrigger.current, 'focus');
    });
    return () => cancelAnimationFrame(frame);
  }, [categoryTrigger, enabled, pathname]);

  return (open: () => void) => {
    Keyboard.dismiss();
    visit.current = { source: pathname, opened: false };
    open();
  };
}
