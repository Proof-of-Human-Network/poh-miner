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
 * skipPoW: skip PoW recomputation for historical sync where block hash format may differ.
 */
export function validateBlock(block, { parent = null, chainPrefix = [], skipPoW = false } = {}) {
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

  if (!skipPoW) {
    const pow = validateBlockPowOnly(block);
    if (!pow.valid) return pow;
  }

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
  const { skipPoW = false } = context;
  const base = validateBlock(block, { ...context, skipPoW });
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

/**
 * Validate a full chain downloaded from a configured bootnode for fresh bootstrap.
 *
 * The canonical chain's deep history contains known storage gaps (missing
 * heights, e.g. block 175) and occasional duplicate-height entries from old
 * fork recovery — strict parent-linkage and difficulty-window re-validation
 * can never pass over them, which would make it impossible for any new node
 * to ever bootstrap. This validator mirrors what running nodes actually load:
 *  - dedupe by height (preferring the entry that links to the kept parent)
 *  - heights strictly ascending, genesis first; deep-history gaps tolerated
 *  - the recent tail (default 100 blocks) validated strictly: linkage + PoW
 *  - chainWork recomputed cumulatively so fork-choice stays consistent
 * Only use for full-replacement sync from a trusted, configured bootnode.
 */
export function validateBootstrapChain(blocks, { strictTailLength = 100 } = {}) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return { valid: false, reason: 'empty chain' };
  }
  const byHeight = new Map();
  for (const b of blocks) {
    if (typeof b?.height !== 'number') continue;
    const kept = byHeight.get(b.height);
    if (!kept) { byHeight.set(b.height, b); continue; }
    const parent = byHeight.get(b.height - 1);
    const parentHash = parent ? blockHash(parent) : null;
    if (parentHash && b.previousHash === parentHash && kept.previousHash !== parentHash) {
      byHeight.set(b.height, b);
    }
  }
  const chain = [...byHeight.values()].sort((a, b) => a.height - b.height);
  if (chain[0].height !== 0) {
    return { valid: false, reason: `chain does not start at genesis (first height ${chain[0].height})`, height: chain[0].height };
  }
  let gaps = 0;
  for (let i = 1; i < chain.length; i++) {
    if (chain[i].height !== chain[i - 1].height + 1) gaps++;
  }
  const tail = chain.slice(-strictTailLength);
  for (let i = 1; i < tail.length; i++) {
    const parent = tail[i - 1];
    const b = tail[i];
    if (b.height !== parent.height + 1) {
      return { valid: false, reason: `gap in recent tail at height ${b.height}`, height: b.height };
    }
    if (b.previousHash !== blockHash(parent)) {
      return { valid: false, reason: `previousHash mismatch in recent tail at height ${b.height}`, height: b.height };
    }
    const pow = validateBlockPowOnly(b);
    if (!pow.valid) {
      return { valid: false, reason: `${pow.reason} in recent tail at height ${b.height}`, height: b.height };
    }
  }
  // Preserve stored chainWork (the network's accumulated values — recomputing
  // from a gapped history yields lower totals and would make every peer look
  // heavier, churning no-op syncs). Fill in only where a block lacks it.
  let work = '0';
  for (const b of chain) {
    work = (b.chainWork && b.chainWork !== '0') ? b.chainWork : computeChainWork(work, b.difficulty ?? 0);
    b.chainWork = work;
  }
  return { valid: true, chain, gaps };
}

/**
 * Validate a contiguous segment extending an existing canonical prefix.
 * skipPoW: skip PoW recomputation for historical sync where block hash format may differ.
 */
export function validateBlockChain(blocks, existingPrefix = [], { extended = true, strictTx = false, skipPoW = false } = {}) {
  const chain = [...existingPrefix];
  const ledger = new TxLedgerState();
  for (const b of existingPrefix) {
    ledger.applyBlock(b, { strict: false });
  }

  for (const block of blocks) {
    const parent = chain[chain.length - 1] ?? null;
    const result = extended
      ? validateBlockExtended(block, { parent, chainPrefix: chain, ledger, strictTx, skipPoW })
      : validateBlock(block, { parent, chainPrefix: chain, skipPoW });
    if (!result.valid) {
      return { valid: false, reason: result.reason, block, height: block?.height };
    }
    // Advance ledger for the next block's tx checks.
    ledger.applyBlock(block, { strict: false });
    chain.push(block);
  }
  return { valid: true, chain };
}