'use strict';

/**
 * Resilient-download helpers.
 *
 * Every heavy dependency this project fetches (the Electron binary, the Ollama
 * installer, the LLM model) is downloaded over the network. On an unstable or
 * slow connection a single dropped request wastes all progress and surfaces a
 * confusing error. These helpers add retry + exponential backoff so transient
 * drops recover automatically.
 *
 * CommonJS so it can be `require()`d from both `electron/main.cjs` (CJS) and
 * `start.js` (ESM, via createRequire).
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exponential backoff with full jitter, capped at maxMs.
 * @param {number} attempt zero-based attempt index
 * @param {{baseMs?: number, maxMs?: number, random?: () => number}} [opts]
 * @returns {number} delay in milliseconds
 */
function computeBackoff(attempt, opts = {}) {
  const { baseMs = 1000, maxMs = 15000, random = Math.random } = opts;
  const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  // Full jitter: random point in [exp/2, exp] keeps a sensible floor while
  // spreading out retries so they don't all hammer the server at once.
  return Math.round(exp / 2 + random() * (exp / 2));
}

/**
 * Run an async function, retrying when it throws or returns a non-success value.
 *
 * @template T
 * @param {(attempt: number) => Promise<T>} fn called with the 1-based attempt number
 * @param {object} [opts]
 * @param {number} [opts.attempts=10] maximum number of tries
 * @param {number} [opts.baseMs=1000] backoff base
 * @param {number} [opts.maxMs=15000] backoff cap
 * @param {(result: T) => boolean} [opts.isSuccess] treat a returned value as success (default: truthy)
 * @param {(info: {attempt: number, nextDelayMs: number, error: Error|null}) => void} [opts.onRetry]
 * @param {(ms: number) => Promise<void>} [opts.sleepFn] injectable sleep (for tests)
 * @returns {Promise<T>} the first successful result
 * @throws the last error when every attempt fails
 */
async function withRetry(fn, opts = {}) {
  const {
    attempts = 10,
    baseMs = 1000,
    maxMs = 15000,
    isSuccess = (r) => !!r,
    onRetry = () => {},
    sleepFn = sleep,
  } = opts;

  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await fn(i + 1);
      if (isSuccess(result)) return result;
      lastError = new Error('attempt did not report success');
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    if (i < attempts - 1) {
      const nextDelayMs = computeBackoff(i, { baseMs, maxMs });
      try { onRetry({ attempt: i + 1, nextDelayMs, error: lastError }); } catch {}
      await sleepFn(nextDelayMs);
    }
  }
  throw lastError || new Error('withRetry: all attempts failed');
}

module.exports = { withRetry, computeBackoff, sleep };
