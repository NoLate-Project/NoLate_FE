import {
  beginPerformanceInteraction,
  measurePerformanceInteraction,
  setInteractionPerformanceSink,
} from '../src/modules/performance/interactionPerformance';

describe('interactionPerformance', () => {
  it('records a timer only once', () => {
    const sink = jest.fn();
    const clearSink = setInteractionPerformanceSink(sink);
    const timer = beginPerformanceInteraction(
      'calendar.list_load',
      '/schedule/calendars',
      'NETWORK',
    );

    expect(timer.finish()).toBeGreaterThanOrEqual(0);
    expect(timer.finish()).toBe(0);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'calendar.list_load',
        route: '/schedule/calendars',
        kind: 'NETWORK',
        outcome: 'SUCCESS',
      }),
    );
    clearSink();
  });

  it('records failed asynchronous work and rethrows the original error', async () => {
    const sink = jest.fn();
    const clearSink = setInteractionPerformanceSink(sink);
    const failure = new Error('route provider unavailable');

    await expect(
      measurePerformanceInteraction(
        'route.search',
        '/schedule/route-planner',
        async () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);

    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'route.search',
        outcome: 'ERROR',
      }),
    );
    clearSink();
  });
});
