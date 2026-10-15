import {
  beginNavigationMeasurement,
  resetNavigationPerformanceForTests,
  setNavigationPerformanceSink,
} from '../src/modules/performance/navigationPerformance';
import { scheduleScreenFirstPaintMeasurement } from '../src/modules/performance/useScreenFirstPaintPerformance';

jest.mock('@react-navigation/native', () => ({
  useIsFocused: jest.fn(() => true),
}));

describe('screen first-paint performance', () => {
  const callbacks = new Map<number, (timestamp: number) => void>();
  let nextFrameId = 1;

  beforeEach(() => {
    resetNavigationPerformanceForTests();
    callbacks.clear();
    nextFrameId = 1;
    globalThis.requestAnimationFrame = jest.fn(callback => {
      const id = nextFrameId++;
      callbacks.set(id, callback);
      return id;
    });
    globalThis.cancelAnimationFrame = jest.fn(id => {
      callbacks.delete(id);
    });
  });

  it('records the focused screen paint and following stable frame', () => {
    const sink = jest.fn();
    setNavigationPerformanceSink(sink);
    beginNavigationMeasurement('PUSH', '/schedule', '/profile', 100, 1_000);

    scheduleScreenFirstPaintMeasurement('/profile');
    callbacks.get(1)?.(116);
    callbacks.get(2)?.(132);

    expect(sink).toHaveBeenCalledWith(expect.objectContaining({
      fromRoute: '/schedule',
      toRoute: '/profile',
      routeReadyMs: 16,
      totalMs: 32,
      completedBy: 'frame',
    }));
  });

  it('cancels both pending frames when the screen loses focus', () => {
    const task = scheduleScreenFirstPaintMeasurement('/profile');
    task.cancel();

    expect(globalThis.cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(callbacks.size).toBe(0);
  });
});
