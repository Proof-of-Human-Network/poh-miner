/**
 * Proof of Work for the PoH Miner Network.
 *
 * Real competitive PoW: all miners mine simultaneously; the first to find
 * a valid nonce wins the block. Mining aborts immediately when a new valid
 * block arrives from the network (via AbortSignal), preventing wasted work.
 *
 * Uses synchronous Node.js crypto (SHA-256) so the hot loop is as fast
 * as possible. Yields to the event loop every YIELD_EVERY hashes so
 * incoming gossip blocks and scan jobs are never blocked.
 *
 * Difficulty target: hash must start with `difficulty` zero hex chars.
 * Difficulty adjustment targets a 60-second average block time.
 */

import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import path from 'path';
import { blockHashInput } from './block-hash.js';

const YIELD_EVERY = 2000;         // yield to event loop this often
const TARGET_BLOCK_TIME_MS = 60_000;
const MINING_WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mining-worker.js');
// Hard floor on block cadence: miners never finalize a block sooner than this
// after its parent. PoW difficulty is quantized (16× per hex-zero step) so it
// cannot pin an exact cadence on its own; this gate holds the network to at most
// one block per minute regardless of hashrate. Enforced miner-side (pacing), not
// as a validation rule, so historical blocks are never retroactively rejected.
export const MIN_BLOCK_SPACING_MS = 60_000;
const ADJUSTMENT_WINDOW = 10;    // blocks
export const MIN_DIFFICULTY = 3;        // 3 hex zeros — floor kept low so PoW does not starve the main-thread HTTP API on this hashrate-limited testnet
export const MAX_DIFFICULTY = 20;

export async function mineBlock(block, difficulty, abortSignal) {
  block.difficulty = difficulty;
  block.nonce = 0;

  let attempts = 0;

  while (true) {
    if (abortSignal?.aborted) return null;   // new block arrived — give up

    if (block.meetsDifficultySync()) break;

    block.nonce++;
    attempts++;

    // Yield to event loop periodically (keeps gossip + scan handlers alive)
    if (attempts % YIELD_EVERY === 0) {
      await new Promise(r => setImmediate(r));
      if (abortSignal?.aborted) return null;
    }

    // Progress logged only at completion — no per-attempt spam
  }

  return attempts;
}

/**
 * Mine on a worker thread so the main event loop (HTTP API, gossip, sync) stays
 * responsive instead of being starved by the 100%-CPU hash grind. Sets
 * `block.nonce` to the solved value and returns the attempt count, or null if
 * aborted (a competing block arrived) or the worker fails.
 *
 * The worker hashes over the same serialization as block.getHashSync() (shared
 * consensus/block-hash.js), so the returned nonce verifies on the main thread.
 */
export function mineBlockThreaded(block, difficulty, abortSignal) {
  block.difficulty = difficulty;
  block.nonce = 0;
  if (abortSignal?.aborted) return Promise.resolve(null);

  return new Promise((resolve) => {
    // Pass only the fields the hash covers (a PohBlock's methods can't be cloned).
    // blockHashInput's key order + the extra `difficulty` are harmless to include.
    const blockData = JSON.parse(blockHashInput(block));
    let worker;
    try {
      worker = new Worker(MINING_WORKER_PATH, { workerData: { block: blockData, difficulty, startNonce: 0 } });
    } catch (e) {
      // worker_threads unavailable — fall back to the in-loop miner.
      return resolve(mineBlock(block, difficulty, abortSignal));
    }

    let settled = false;
    const onAbort = () => { try { worker.postMessage('abort'); } catch { /* */ } };
    const finish = (val) => {
      if (settled) return;
      settled = true;
      abortSignal?.removeEventListener?.('abort', onAbort);
      worker.terminate().catch(() => {});
      resolve(val);
    };

    if (abortSignal) abortSignal.addEventListener('abort', onAbort, { once: true });
    worker.on('message', (m) => {
      if (m?.found) { block.nonce = m.nonce; finish(m.attempts); }
      else finish(null); // aborted
    });
    worker.on('error', () => finish(null));
    worker.on('exit', () => finish(null));
  });
}

// Flag-day for the difficulty-floor reduction (5 -> 3). Blocks at or below this height
// were mined under the legacy floor of 5 and MUST keep validating against it; blocks
// above use MIN_DIFFICULTY. Without this gate, lowering MIN_DIFFICULTY retroactively
// invalidates the legacy blocks ("difficulty mismatch") and forks the chain.
export const DIFFICULTY_REDUCTION_HEIGHT = 270;
const LEGACY_MIN_DIFFICULTY = 5;
function difficultyFloor(height) {
  return height > DIFFICULTY_REDUCTION_HEIGHT ? MIN_DIFFICULTY : LEGACY_MIN_DIFFICULTY;
}

export function getNextDifficulty(lastBlocks) {
  // Before the adjustment window is full, preserve the current difficulty
  // rather than resetting to MIN — prevents blocks racing past MIN on a fresh chain.
  const tip = lastBlocks.length ? lastBlocks[lastBlocks.length - 1] : null;
  // Height of the block whose difficulty we are computing (one past the tip).
  const targetHeight = (typeof tip?.height === 'number' ? tip.height : lastBlocks.length - 1) + 1;
  const floor = difficultyFloor(targetHeight);
  const current = tip?.difficulty
    ? Math.max(floor, tip.difficulty)
    : floor;

  if (lastBlocks.length < ADJUSTMENT_WINDOW + 1) return current;

  const window = lastBlocks.slice(-(ADJUSTMENT_WINDOW + 1));
  const elapsed = window[window.length - 1].timestamp - window[0].timestamp;
  const avgMs = elapsed / ADJUSTMENT_WINDOW;

  // Step by 2 when extremely off-target so difficulty converges in minutes rather than hours.
  // Each hex-zero step changes expected time by 16×, so a single +1 step when blocks are
  // at 2s (vs 30s target) still leaves them at 32s after the jump — fine to do aggressively.
  if (avgMs < TARGET_BLOCK_TIME_MS * 0.1)  return Math.min(MAX_DIFFICULTY, current + 2); // <1s → jump 2
  if (avgMs < TARGET_BLOCK_TIME_MS * 0.5)  return Math.min(MAX_DIFFICULTY, current + 1); // <5s → jump 1
  if (avgMs > TARGET_BLOCK_TIME_MS * 4.0)  return Math.max(floor, current - 2); // >40s → drop 2
  if (avgMs > TARGET_BLOCK_TIME_MS * 2.0)  return Math.max(floor, current - 1); // >20s → drop 1
  return current;
}
