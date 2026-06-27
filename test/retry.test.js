import { describe, it, expect, vi } from 'vitest';
import retry from '../src/lib/retry.cjs';

const { withRetry, computeBackoff } = retry;

// No real waiting in tests.
const noSleep = () => Promise.resolve();

describe('computeBackoff', () => {
  it('grows exponentially and stays within [exp/2, exp]', () => {
    for (const attempt of [0, 1, 2, 3]) {
      const exp = Math.min(15000, 1000 * 2 ** attempt);
      const d = computeBackoff(attempt, { random: () => 0.5 });
      expect(d).toBeGreaterThanOrEqual(exp / 2);
      expect(d).toBeLessThanOrEqual(exp);
    }
  });

  it('caps at maxMs', () => {
    const d = computeBackoff(20, { baseMs: 1000, maxMs: 5000, random: () => 1 });
    expect(d).toBeLessThanOrEqual(5000);
  });

  it('floor is exp/2 with random=0', () => {
    expect(computeBackoff(0, { baseMs: 1000, maxMs: 15000, random: () => 0 })).toBe(500);
  });
});

describe('withRetry', () => {
  it('returns immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { sleepFn: noSleep });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on thrown errors, then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('drop 1'))
      .mockRejectedValueOnce(new Error('drop 2'))
      .mockResolvedValue('done');
    const onRetry = vi.fn();
    const result = await withRetry(fn, { sleepFn: noSleep, onRetry });
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('retries when isSuccess rejects the result', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    const result = await withRetry(fn, { sleepFn: noSleep, isSuccess: (r) => r.ok });
    expect(result).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws the last error after exhausting attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always down'));
    await expect(withRetry(fn, { attempts: 3, sleepFn: noSleep })).rejects.toThrow('always down');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('passes the 1-based attempt number to fn', async () => {
    const seen = [];
    const fn = vi.fn(async (attempt) => { seen.push(attempt); if (attempt < 3) throw new Error('retry'); return 'ok'; });
    await withRetry(fn, { sleepFn: noSleep });
    expect(seen).toEqual([1, 2, 3]);
  });

  it('does not sleep after the final failed attempt', async () => {
    const sleepFn = vi.fn(() => Promise.resolve());
    const fn = vi.fn().mockRejectedValue(new Error('down'));
    await expect(withRetry(fn, { attempts: 3, sleepFn })).rejects.toThrow();
    // 3 attempts → only 2 inter-attempt waits.
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });
});
