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

const YIELD_EVERY = 2000;         // yield to event loop this often
const TARGET_BLOCK_TIME_MS = 60_000;
// Hard floor on block cadence: miners never finalize a block sooner than this
// after its parent. PoW difficulty is quantized (16× per hex-zero step) so it
// cannot pin an exact cadence on its own; this gate holds the network to at most
// one block per minute regardless of hashrate. Enforced miner-side (pacing), not
// as a validation rule, so historical blocks are never retroactively rejected.
export const MIN_BLOCK_SPACING_MS = 60_000;
const ADJUSTMENT_WINDOW = 10;    // blocks
export const MIN_DIFFICULTY = 5;        // 5 leading hex zeros ≈ 1M hashes avg (~5-15 s in JS)
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

export function getNextDifficulty(lastBlocks) {
  // Before the adjustment window is full, preserve the current difficulty
  // rather than resetting to MIN — prevents blocks racing past MIN on a fresh chain.
  const tip = lastBlocks.length ? lastBlocks[lastBlocks.length - 1] : null;
  const current = tip?.difficulty
    ? Math.max(MIN_DIFFICULTY, tip.difficulty)
    : MIN_DIFFICULTY;

  if (lastBlocks.length < ADJUSTMENT_WINDOW + 1) return current;

  const window = lastBlocks.slice(-(ADJUSTMENT_WINDOW + 1));
  const elapsed = window[window.length - 1].timestamp - window[0].timestamp;
  const avgMs = elapsed / ADJUSTMENT_WINDOW;

  // Step by 2 when extremely off-target so difficulty converges in minutes rather than hours.
  // Each hex-zero step changes expected time by 16×, so a single +1 step when blocks are
  // at 2s (vs 30s target) still leaves them at 32s after the jump — fine to do aggressively.
  if (avgMs < TARGET_BLOCK_TIME_MS * 0.1)  return Math.min(MAX_DIFFICULTY, current + 2); // <1s → jump 2
  if (avgMs < TARGET_BLOCK_TIME_MS * 0.5)  return Math.min(MAX_DIFFICULTY, current + 1); // <5s → jump 1
  if (avgMs > TARGET_BLOCK_TIME_MS * 4.0)  return Math.max(MIN_DIFFICULTY, current - 2); // >40s → drop 2
  if (avgMs > TARGET_BLOCK_TIME_MS * 2.0)  return Math.max(MIN_DIFFICULTY, current - 1); // >20s → drop 1
  return current;
}
