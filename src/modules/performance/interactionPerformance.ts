import type {
  InteractionPerformanceKind,
  InteractionPerformanceOperation,
  InteractionPerformanceOutcome,
} from '../../api/performance';

export type InteractionPerformanceMeasurement = {
  route: string;
  operation: InteractionPerformanceOperation;
  kind: InteractionPerformanceKind;
  outcome: InteractionPerformanceOutcome;
  durationMs: number;
  startedAtEpochMs: number;
};

type InteractionPerformanceSink = (
  measurement: InteractionPerformanceMeasurement,
) => void;

let performanceSink: InteractionPerformanceSink | undefined;

export function setInteractionPerformanceSink(
  sink: InteractionPerformanceSink,
) {
  performanceSink = sink;
  return () => {
    if (performanceSink === sink) performanceSink = undefined;
  };
}

function monotonicNow() {
  const runtimePerformance = (
    globalThis as typeof globalThis & { performance?: { now?: () => number } }
  ).performance;
  return typeof runtimePerformance?.now === 'function'
    ? runtimePerformance.now()
    : Date.now();
}

export type PerformanceInteractionTimer = {
  finish: (outcome?: InteractionPerformanceOutcome) => number;
};

export function beginPerformanceInteraction(
  operation: InteractionPerformanceOperation,
  route: string,
  kind: InteractionPerformanceKind = 'INTERACTION',
): PerformanceInteractionTimer {
  const startedAt = monotonicNow();
  const startedAtEpochMs = Date.now();
  let finished = false;

  return {
    finish(outcome = 'SUCCESS') {
      if (finished) return 0;
      finished = true;
      const durationMs = Math.max(0, Math.round(monotonicNow() - startedAt));
      performanceSink?.({
        route,
        operation,
        kind,
        outcome,
        durationMs,
        startedAtEpochMs,
      });
      return durationMs;
    },
  };
}

export async function measurePerformanceInteraction<T>(
  operation: InteractionPerformanceOperation,
  route: string,
  task: () => Promise<T>,
  kind: InteractionPerformanceKind = 'INTERACTION',
): Promise<T> {
  const timer = beginPerformanceInteraction(operation, route, kind);
  try {
    const result = await task();
    timer.finish('SUCCESS');
    return result;
  } catch (error) {
    timer.finish('ERROR');
    throw error;
  }
}
