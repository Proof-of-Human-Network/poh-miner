/**
 * Canonical block-hash serialization — the single source of truth for the bytes
 * a block's PoW hashes over. Shared by PohBlock.getHashSync() and the mining
 * worker thread so a nonce solved off-thread produces a hash that is byte-for-byte
 * identical to what the main thread verifies. Any divergence here would make the
 * worker "solve" blocks that fail verification, so both callers MUST use this.
 *
 * Only `nonce` changes during mining; every other field is fixed once the block
 * is built.
 */

import crypto from 'crypto';

export function blockHashInput(b) {
  return JSON.stringify({
    height: b.height,
    previousHash: b.previousHash,
    timestamp: b.timestamp,
    minerWallet: b.minerWallet,
    scanResults: b.scanResults,
    stateTransitions: b.stateTransitions,
    transactions: b.transactions,
    coinbaseReward: b.coinbaseReward ? {
      blockHeight: b.coinbaseReward.blockHeight,
      totalNewSupply: b.coinbaseReward.totalNewSupply,
      proposerReward: b.coinbaseReward.proposerReward,
      workerRewards: (b.coinbaseReward.workerRewards || []).map(w => ({
        workerId: w.workerId,
        amount: w.amount,
        workProofHash: w.workProofHash,
      })),
    } : null,
    stateRoot: b.stateRoot,
    brainStateRoot: b.brainStateRoot,
    // Migration-genesis balance/nonce distribution. Included in the hash ONLY when
    // present, so (a) every ordinary block hashes exactly as before, and (b) a
    // genesis carrying allocations gets a distinct hash → a fresh chain identity.
    ...(Array.isArray(b.genesisAllocations) && b.genesisAllocations.length
      ? { genesisAllocations: b.genesisAllocations }
      : {}),
    nonce: b.nonce,
  });
}

export function blockHashOf(b) {
  return crypto.createHash('sha256').update(blockHashInput(b)).digest('hex');
}
