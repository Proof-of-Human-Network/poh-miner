/**
 * Lightweight Proof of Work for the PoH Miner Network
 *
 * This is intentionally simple at the beginning.
 * The real "work" is the useful computation (verdicts, profiles, brain updates).
 * The PoW here is mostly anti-spam + Sybil resistance.
 */

export async function mineBlock(block, difficulty) {
  block.difficulty = difficulty;
  let attempts = 0;

  while (!(await block.meetsDifficulty())) {
    block.nonce++;
    attempts++;

    if (attempts % 10000 === 0) {
      console.log(`Mining... attempts=${attempts}, nonce=${block.nonce}`);
    }

    // Prevent infinite loop in dev
    if (attempts > 1_000_000) break;
  }

  return attempts;
}

export function getNextDifficulty(lastBlocks) {
  // Very naive difficulty adjustment
  if (lastBlocks.length < 10) return 4;

  const recent = lastBlocks.slice(-10);
  const avgTime = (recent[recent.length-1].timestamp - recent[0].timestamp) / recent.length;

  if (avgTime < 8000) return recent[0].difficulty + 1;
  if (avgTime > 25000) return Math.max(3, recent[0].difficulty - 1);
  return recent[0].difficulty;
}
