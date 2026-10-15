import { createContext, useContext, useSyncExternalStore } from 'react';

/** Native scene visibility changes without a navigation focus event. */
export function createSceneActivityStore() {
  let active = false;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => active,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setActive(next: boolean) {
      if (active === next) return;
      active = next;
      listeners.forEach(listener => listener());
    },
  };
}

export type SceneActivityStore = ReturnType<typeof createSceneActivityStore>;
export const PreMountedSceneActivityContext = createContext<SceneActivityStore | null>(null);
const routedSnapshot = () => undefined;
const routedSubscribe = () => () => {};

/** undefined means a normal routed screen should use navigation focus. */
export function usePreMountedSceneActivity(): boolean | undefined {
  const store = useContext(PreMountedSceneActivityContext);
  return useSyncExternalStore(
    store?.subscribe ?? routedSubscribe,
    store?.getSnapshot ?? routedSnapshot,
    store?.getSnapshot ?? routedSnapshot,
  );
}
