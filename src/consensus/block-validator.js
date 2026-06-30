/**
 * Block validation — never trust gossiped chainWork, difficulty, or coinbase claims.
 */

import { computeChainWork } from './chain-selection.js';
import { getNextDifficulty, MIN_DIFFICULTY, MAX_DIFFICULTY } from './pow.js';
import { validateCoinbase } from './coinbase-validator.js';
import { TxLedgerState, validateBlockLedger } from './tx-ledger.js';

export const MAX_BLOCK_TIMESTAMP_DRIFT_MS = 2 * 60 * 60 * 1000;

export function blockHash(block) {
  return block?.blockHash || block?.getHashSync?.() || null;
}

export function findParentBlock(chain, block) {
  if (!block?.previousHash || !Array.isArray(chain)) return null;
  return chain.find(b => blockHash(b) === block.previousHash) ?? null;
}

export function validateBlockTimestamp(block, parent = null) {
  if (block.height === 0) return { valid: true };
  const now = Date.now();
  if (block.timestamp > now + MAX_BLOCK_TIMESTAMP_DRIFT_MS) {
    return { valid: false, reason: 'timestamp too far in future' };
  }
  if (parent && block.timestamp <= parent.timestamp) {
    return { valid: false, reason: 'timestamp not after parent' };
  }
  return { valid: true };
}

export function validateBlockSignature(block) {
  if (block.height === 0) return { valid: true };
  if (!block.minerSignature || !block.minerSigningPublicKey) {
    return { valid: false, reason: 'missing miner signature' };
  }
  if (!block.verifySignature()) {
    return { valid: false, reason: 'invalid miner signature' };
  }
  return { valid: true };
}

/** PoW + bounds only — used for orphans whose parent is not yet local. */
export function validateBlockPowOnly(block) {
  if (!block || typeof block.height !== 'number') {
    return { valid: false, reason: 'invalid block' };
  }
  if (block.height === 0) return { valid: true };

  const difficulty = block.difficulty ?? 0;
  if (difficulty < MIN_DIFFICULTY || difficulty > MAX_DIFFICULTY) {
    return { valid: false, reason: `difficulty out of bounds (${difficulty})` };
  }
  if (!block.meetsDifficultySync()) {
    return { valid: false, reason: 'invalid proof of work' };
  }
  return { valid: true };
}

/**
 * Full validation against a known parent and chain prefix (genesis → parent).
 * Overwrites block.chainWork with the locally computed value.
 */
export function validateBlock(block, { parent = null, chainPrefix = [] } = {}) {
  if (!block || typeof block.height !== 'number') {
    return { valid: false, reason: 'invalid block' };
  }

  if (block.height === 0) {
    block.chainWork = computeChainWork('0', block.difficulty ?? 0);
    return { valid: true };
  }

  if (!parent) {
    return { valid: false, reason: 'missing parent' };
  }

  if (block.previousHash !== blockHash(parent)) {
    return { valid: false, reason: 'previousHash mismatch' };
  }

  if (block.height !== parent.height + 1) {
    return { valid: false, reason: 'height mismatch' };
  }

  const pow = validateBlockPowOnly(block);
  if (!pow.valid) return pow;

  const prefix = chainPrefix.length ? chainPrefix : [parent];
  const expectedDifficulty = getNextDifficulty(prefix);
  if (block.difficulty !== expectedDifficulty) {
    return { valid: false, reason: `difficulty mismatch (got ${block.difficulty}, expected ${expectedDifficulty})` };
  }

  block.chainWork = computeChainWork(parent.chainWork, block.difficulty);
  return { valid: true };
}

/** Consensus + economic checks (sync). */
export function validateBlockExtended(block, context = {}) {
  const base = validateBlock(block, context);
  if (!base.valid) return base;

  const ts = validateBlockTimestamp(block, context.parent);
  if (!ts.valid) return ts;

  const sig = validateBlockSignature(block);
  if (!sig.valid) return sig;

  const coinbase = validateCoinbase(block);
  if (!coinbase.valid) return coinbase;

  // Transaction ledger: reject replayed or invalid transfers in new blocks.
  const { ledger = null, strictTx = true } = context;
  if (ledger && block.height > 0) {
    const txCheck = validateBlockLedger(block, ledger, { strict: strictTx });
    if (!txCheck.valid) return txCheck;
  }

  return { valid: true };
}

/** Validate a contiguous segment extending an existing canonical prefix. */
export function validateBlockChain(blocks, existingPrefix = [], { extended = true, strictTx = false } = {}) {
  const chain = [...existingPrefix];
  const ledger = new TxLedgerState();
  for (const b of existingPrefix) {
    ledger.applyBlock(b, { strict: false });
  }

  for (const block of blocks) {
    const parent = chain[chain.length - 1] ?? null;
    const result = extended
      ? validateBlockExtended(block, { parent, chainPrefix: chain, ledger, strictTx })
      : validateBlock(block, { parent, chainPrefix: chain });
    if (!result.valid) {
      return { valid: false, reason: result.reason, block, height: block?.height };
    }
    // Advance ledger for the next block's tx checks.
    ledger.applyBlock(block, { strict: false });
    chain.push(block);
  }
  return { valid: true, chain };
}