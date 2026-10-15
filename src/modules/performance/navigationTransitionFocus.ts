type FocusListener = (route: string) => void;

const focusListeners = new Set<FocusListener>();

/** Called by a destination layout commit so the root shell can hand off safely. */
export function notifyNavigationDestinationFocused(route: string) {
  for (const listener of focusListeners) listener(route);
}

export function subscribeToFocusedDestination(listener: FocusListener) {
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
}
