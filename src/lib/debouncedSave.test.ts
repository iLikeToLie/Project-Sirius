import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debouncedSave } from './debouncedSave';

describe('debouncedSave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves only the latest edit after 400 ms of inactivity', () => {
    const save = vi.fn();
    const { schedule } = debouncedSave(save);
    schedule('first');
    vi.advanceTimersByTime(300);
    schedule('latest');
    vi.advanceTimersByTime(399);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledExactlyOnceWith('latest');
  });

  it('flushes the latest edit immediately and clears its pending timer', () => {
    const save = vi.fn();
    const { schedule, flush } = debouncedSave(save);
    schedule('first');
    schedule('latest');
    flush();
    expect(save).toHaveBeenCalledExactlyOnceWith('latest');
    flush();
    vi.runAllTimers();
    expect(save).toHaveBeenCalledTimes(1);
    schedule('next');
    vi.advanceTimersByTime(400);
    expect(save).toHaveBeenLastCalledWith('next');
  });
});
