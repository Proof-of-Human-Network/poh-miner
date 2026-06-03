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
 * Difficulty adjustment targets 30-second average block time.
 */

const YIELD_EVERY = 2000;         // yield to event loop this often
const TARGET_BLOCK_TIME_MS = 30_000;
const ADJUSTMENT_WINDOW = 10;    // blocks
const MIN_DIFFICULTY = 5;        // 5 leading hex zeros ≈ 1M hashes avg (~5-15 s in JS)
const MAX_DIFFICULTY = 20;

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

    if (attempts % 100_000 === 0) {
      console.log(`[PoW] Mining block #${block.height} attempt ${attempts} nonce=${block.nonce}`);
    }
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

  if (avgMs < TARGET_BLOCK_TIME_MS * 0.5) return Math.min(MAX_DIFFICULTY, current + 1);
  if (avgMs > TARGET_BLOCK_TIME_MS * 2.0) return Math.max(MIN_DIFFICULTY, current - 1);
  return current;
}
