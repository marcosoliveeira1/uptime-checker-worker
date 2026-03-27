import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TickScheduler } from './tick-scheduler';

describe('TickScheduler', () => {
  let scheduler: TickScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    scheduler = new TickScheduler(1000, 50);
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
  });

  it('should add a monitor and track active count', () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    scheduler.add(1, 5000, callback);
    expect(scheduler.getActiveCount()).toBe(1);
  });

  it('should remove a monitor', () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    scheduler.add(1, 5000, callback);
    scheduler.remove(1);
    expect(scheduler.getActiveCount()).toBe(0);
  });

  it('should update a monitor interval', () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    scheduler.add(1, 5000, callback);
    scheduler.update(1, 10000);
    expect(scheduler.getActiveCount()).toBe(1);
  });

  it('should not throw when updating unknown monitor', () => {
    expect(() => scheduler.update(999, 5000)).not.toThrow();
  });

  it('should fire callback when monitor is due', async () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    scheduler.add(1, 2000, callback);
    scheduler.start();

    // Advance past interval (2s) + one tick (1s)
    await vi.advanceTimersByTimeAsync(3000);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should not fire callback before interval', async () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    scheduler.add(1, 5000, callback);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(3000);

    expect(callback).not.toHaveBeenCalled();
  });

  it('should respect maxConcurrentChecks', async () => {
    const scheduler2 = new TickScheduler(1000, 2);
    let activeCount = 0;
    let maxActive = 0;

    const slowCallback = vi.fn(async () => {
      activeCount++;
      maxActive = Math.max(maxActive, activeCount);
      await new Promise((r) => setTimeout(r, 3000));
      activeCount--;
    });

    scheduler2.add(1, 1000, slowCallback);
    scheduler2.add(2, 1000, slowCallback);
    scheduler2.add(3, 1000, slowCallback);
    scheduler2.start();

    await vi.advanceTimersByTimeAsync(2000);

    // Only 2 should run concurrently (maxConcurrentChecks = 2)
    expect(maxActive).toBeLessThanOrEqual(2);

    scheduler2.stop();
  });

  it('should stop the scheduler', async () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    scheduler.add(1, 1000, callback);
    scheduler.start();
    scheduler.stop();

    await vi.advanceTimersByTimeAsync(5000);

    expect(callback).not.toHaveBeenCalled();
  });

  it('should report active checks', () => {
    expect(scheduler.getActiveChecks()).toBe(0);
  });

  it('should report isRunning', () => {
    expect(scheduler.isRunning()).toBe(false);
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('should handle callback rejection gracefully', async () => {
    const failingCallback = vi.fn().mockRejectedValue(new Error('Callback failed'));
    scheduler.add(1, 1000, failingCallback);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(2000);

    expect(failingCallback).toHaveBeenCalled();
    expect(scheduler.getActiveChecks()).toBe(0);
  });

  it('should prioritize monitors with earliest intervals', async () => {
    const callback1 = vi.fn().mockResolvedValue(undefined);
    const callback2 = vi.fn().mockResolvedValue(undefined);

    scheduler.add(1, 5000, callback1);
    scheduler.add(2, 2000, callback2);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(3000);

    // Monitor 2 with shorter interval fires first
    expect(callback2.mock.invocationCallOrder[0]).toBeLessThan(callback1.mock.invocationCallOrder[0] || Infinity);
  });

  it('should handle start when already started', () => {
    scheduler.start();
    const timer1 = (scheduler as any).tickTimer;

    scheduler.start();
    const timer2 = (scheduler as any).tickTimer;

    // Should be the same timer (no duplicate start)
    expect(timer1).toBe(timer2);
  });

  it('should handle remove of non-existent monitor gracefully', () => {
    expect(() => scheduler.remove(999)).not.toThrow();
  });

  it('should execute oldest due monitors first when respecting concurrency', async () => {
    const scheduler2 = new TickScheduler(100, 1);
    const execOrder: number[] = [];

    scheduler2.add(1, 100, async () => {
      execOrder.push(1);
      await new Promise((r) => setTimeout(r, 150));
    });
    scheduler2.add(2, 100, async () => {
      execOrder.push(2);
      await new Promise((r) => setTimeout(r, 150));
    });

    scheduler2.start();
    await vi.advanceTimersByTimeAsync(500);

    expect(execOrder[0]).toBe(1);
    scheduler2.stop();
  });
});
