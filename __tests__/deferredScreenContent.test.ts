import { scheduleDeferredScreenContent } from '../src/modules/performance/useDeferredScreenContent';

describe('deferred screen content', () => {
  const callbacks = new Map<number, (timestamp: number) => void>();
  let nextFrameId = 1;

  beforeEach(() => {
    callbacks.clear();
    nextFrameId = 1;
    globalThis.requestAnimationFrame = jest.fn(callback => {
      const id = nextFrameId++;
      callbacks.set(id, callback);
      return id;
    });
    globalThis.cancelAnimationFrame = jest.fn(id => callbacks.delete(id));
  });

  it('keeps the shell through the first frame before mounting full content', () => {
    const onReady = jest.fn();
    scheduleDeferredScreenContent(onReady);

    callbacks.get(1)?.(16);
    expect(onReady).not.toHaveBeenCalled();
    callbacks.get(2)?.(32);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('does not mount content after cancellation', () => {
    const onReady = jest.fn();
    const task = scheduleDeferredScreenContent(onReady);
    callbacks.get(1)?.(16);
    task.cancel();
    callbacks.get(2)?.(32);
    expect(onReady).not.toHaveBeenCalled();
  });
});
