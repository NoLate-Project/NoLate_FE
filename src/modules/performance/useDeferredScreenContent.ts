import { useEffect, useState } from 'react';

export type DeferredScreenContentTask = {
  cancel(): void;
};

/** Keeps the lightweight route shell visible for one painted frame. */
export function scheduleDeferredScreenContent(
  onReady: () => void,
): DeferredScreenContentTask {
  let cancelled = false;
  let contentFrame: number | undefined;
  const shellFrame = requestAnimationFrame(() => {
    contentFrame = requestAnimationFrame(() => {
      if (!cancelled) onReady();
    });
  });

  return {
    cancel() {
      cancelled = true;
      cancelAnimationFrame(shellFrame);
      if (contentFrame !== undefined) cancelAnimationFrame(contentFrame);
    },
  };
}

/** Defers expensive screen controllers until after the route shell has painted. */
export function useDeferredScreenContent() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const task = scheduleDeferredScreenContent(() => setReady(true));
    return () => task.cancel();
  }, []);

  return ready;
}
