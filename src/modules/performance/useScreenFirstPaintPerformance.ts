import { useLayoutEffect } from 'react';
import { useIsFocused } from '@react-navigation/native';

import {
  finishNavigationAfterFrames,
  markNavigationRouteReady,
} from './navigationPerformance';
import { notifyNavigationDestinationFocused } from './navigationTransitionFocus';

export type FirstPaintMeasurementTask = {
  cancel(): void;
};

/**
 * Marks the destination on the first frame requested by the focused screen.
 * The following frame completes the sample, keeping native transition timing
 * separate from the first usable screen frame.
 */
export function scheduleScreenFirstPaintMeasurement(
  route: string,
): FirstPaintMeasurementTask {
  let cancelled = false;
  let completionFrame: number | undefined;
  const paintFrame = requestAnimationFrame(paintAt => {
    if (cancelled) return;
    const pendingId = markNavigationRouteReady(route, paintAt);
    if (pendingId === undefined) return;
    completionFrame = requestAnimationFrame(completedAt => {
      if (!cancelled) finishNavigationAfterFrames(pendingId, completedAt);
    });
  });

  return {
    cancel() {
      cancelled = true;
      cancelAnimationFrame(paintFrame);
      if (completionFrame !== undefined) cancelAnimationFrame(completionFrame);
    },
  };
}

/** Records every focus, including a retained screen revealed by goBack. */
export function useScreenFirstPaintPerformance(route: string) {
  const isFocused = useIsFocused();

  useLayoutEffect(() => {
    if (!isFocused) return;

    notifyNavigationDestinationFocused(route);
    // Register before the focused commit is painted. A passive focus effect can
    // run after that frame and overstate first-paint time by one or more frames.
    const task = scheduleScreenFirstPaintMeasurement(route);
    return () => task.cancel();
  }, [isFocused, route]);
}
