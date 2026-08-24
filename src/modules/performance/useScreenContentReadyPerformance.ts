import { useEffect, useRef } from 'react';
import type { InteractionPerformanceOperation } from '../../api/performance';

import {
  beginPerformanceInteraction,
  type PerformanceInteractionTimer,
} from './interactionPerformance';

/** Measures component mount to the first usable content state exactly once per mount. */
export function useScreenContentReadyPerformance(
  operation: InteractionPerformanceOperation,
  route: string,
  ready: boolean,
) {
  const timerRef = useRef<PerformanceInteractionTimer | null>(null);
  const completedRef = useRef(false);
  if (timerRef.current === null) {
    timerRef.current = beginPerformanceInteraction(
      operation,
      route,
      'CONTENT_READY',
    );
  }

  useEffect(() => {
    if (!ready || completedRef.current) return;
    completedRef.current = true;
    timerRef.current?.finish('SUCCESS');
  }, [ready]);

  useEffect(
    () => () => {
      if (!completedRef.current) timerRef.current?.finish('CANCELLED');
    },
    [],
  );
}
