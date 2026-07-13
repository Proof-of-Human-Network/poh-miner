/**
 * Coinbase validation — never trust gossiped reward amounts.
 *
 * Two regimes, selected by block height:
 *   • height <= REWARD_V2_HEIGHT — legacy 60/40 split (keeps existing history valid).
 *   • height >  REWARD_V2_HEIGHT — reward model v2: the block subsidy goes to AI
 *     workers weighted by delivered compute, with a small proposer cut, and idle
 *     blocks mint only a small keepalive. See src/rewards/reward.js.
 */

import {
  calculateBlockRewards,
  workTokens,
  BLOCK_REWARD_UPOH,
  KEEPALIVE_UPOH,
  PROPOSER_CUT,
  REWARD_V2_HEIGHT,
} from '../rewards/reward.js';
import { ScanResult } from '../core/scanRequest.js';

function totals(coinbase) {
  const workerTotal = (coinbase.workerRewards || []).reduce((s, w) => s + (w.amount || 0), 0);
  const proposer = coinbase.proposerReward || 0;
  return { workerTotal, proposer, sum: proposer + workerTotal };
}

function proofHashFromResult(r) {
  try {
    const sr = r instanceof ScanResult ? r : new ScanResult(r);
    return sr.getResultHash();
  } catch {
    return r.requestId || 'work-unknown';
  }
}

function workSubmissionsFromBlock(block) {
  return (block.scanResults || []).map((r, i) => ({
    nodeId: r.minerWallet || r.nodeId,
    requestId: r.requestId,
    proofHash: proofHashFromResult(r) || r.requestId || `work-${i}`,
    // Deterministic compute weight — recomputed from the same hashed block fields
    // the proposer used, so no self-reported token count is ever trusted.
    tokens: workTokens(r),
  })).filter(w => w.nodeId && w.requestId);
}

// Compare actual vs expected worker rewards as a multiset keyed by the (unique per
// job) work proof hash. Handles the same wallet appearing in multiple jobs.
function compareWorkers(actual, expected) {
  if (actual.length !== expected.length) return 'worker reward count mismatch';
  const byHash = new Map();
  for (const e of expected) byHash.set(e.workProofHash, e);
  for (const a of actual) {
    const e = byHash.get(a.workProofHash);
    if (!e) return 'unexpected worker proof hash';
    if (a.workerId !== e.workerId) return 'worker id mismatch';
    if (a.amount !== e.amount) return 'worker reward amount mismatch';
    byHash.delete(a.workProofHash);
  }
  return null;
}

// ── Legacy (pre-v2) rule — kept verbatim so historical blocks stay valid ──
function validateLegacy(block, coinbase, workSubmissions, proposer, sum) {
  if (coinbase.totalNewSupply !== BLOCK_REWARD_UPOH) {
    return { valid: false, reason: `invalid totalNewSupply (${coinbase.totalNewSupply})` };
  }
  if (sum > BLOCK_REWARD_UPOH) {
    return { valid: false, reason: 'coinbase exceeds block reward' };
  }

  if (workSubmissions.length > 0) {
    const expected = calculateBlockRewards(workSubmissions, block.height, []);
    if (proposer > expected.proposerReward) {
      return { valid: false, reason: 'proposer reward too high for work' };
    }
    const actualWorkers = coinbase.workerRewards || [];
    const expectedWorkers = expected.workerRewards || [];
    if (actualWorkers.length !== expectedWorkers.length) {
      return { valid: false, reason: 'worker reward count mismatch' };
    }
    for (const exp of expectedWorkers) {
      const act = actualWorkers.find(w => w.workerId === exp.workerId);
      if (!act || act.amount !== exp.amount) {
        return { valid: false, reason: 'worker reward amount mismatch' };
      }
      if (act.workProofHash !== exp.workProofHash) {
        return { valid: false, reason: 'work proof hash mismatch' };
      }
    }
    return { valid: true };
  }

  const workers = coinbase.workerRewards || [];
  if (workers.length === 0) {
    if (proposer > BLOCK_REWARD_UPOH) {
      return { valid: false, reason: 'empty block proposer reward exceeds block reward' };
    }
    return { valid: true };
  }

  const expectedProposer = Math.floor(BLOCK_REWARD_UPOH * 0.6);
  const perWorker = Math.floor((BLOCK_REWARD_UPOH * 0.4) / workers.length);
  if (proposer !== expectedProposer) {
    return { valid: false, reason: 'keepalive proposer share invalid' };
  }
  for (const w of workers) {
    if (w.amount !== perWorker) {
      return { valid: false, reason: 'keepalive worker share invalid' };
    }
    if (!String(w.workProofHash || '').startsWith(`keepalive:${block.height}:`)) {
      return { valid: false, reason: 'invalid keepalive work proof' };
    }
    if (w.workerId === block.minerWallet) {
      return { valid: false, reason: 'proposer cannot be keepalive worker' };
    }
  }
  return { valid: true };
}

// ── Reward model v2 — token-weighted worker split + keepalive-only idle blocks ──
function validateV2(block, coinbase, workSubmissions, proposer, sum) {
  // Real AI work present → full block reward, split by delivered compute.
  if (workSubmissions.length > 0) {
    if (coinbase.totalNewSupply !== BLOCK_REWARD_UPOH) {
      return { valid: false, reason: `v2 work-block totalNewSupply must be ${BLOCK_REWARD_UPOH}` };
    }
    if (sum > BLOCK_REWARD_UPOH) {
      return { valid: false, reason: 'coinbase exceeds block reward' };
    }
    const expected = calculateBlockRewards(workSubmissions, block.height, []);
    if (proposer > expected.proposerReward) {
      return { valid: false, reason: 'proposer reward too high for work' };
    }
    const mismatch = compareWorkers(coinbase.workerRewards || [], expected.workerRewards || []);
    if (mismatch) return { valid: false, reason: mismatch };
    return { valid: true };
  }

  // No real work → only a small keepalive is minted (emission tracks demand).
  if (coinbase.totalNewSupply !== KEEPALIVE_UPOH) {
    return { valid: false, reason: `v2 idle-block totalNewSupply must be ${KEEPALIVE_UPOH}` };
  }
  if (sum > KEEPALIVE_UPOH) {
    return { valid: false, reason: 'keepalive exceeds cap' };
  }
  const workers = coinbase.workerRewards || [];
  if (workers.length === 0) {
    if (proposer > KEEPALIVE_UPOH) {
      return { valid: false, reason: 'idle proposer reward exceeds keepalive' };
    }
    return { valid: true };
  }
  const expectedProposer = Math.floor(KEEPALIVE_UPOH * PROPOSER_CUT);
  const pool = KEEPALIVE_UPOH - expectedProposer;
  const perWorker = Math.floor(pool / workers.length);
  if (proposer > expectedProposer) {
    return { valid: false, reason: 'keepalive proposer share invalid' };
  }
  for (const w of workers) {
    if (w.amount !== perWorker) {
      return { valid: false, reason: 'keepalive worker share invalid' };
    }
    if (!String(w.workProofHash || '').startsWith(`keepalive:${block.height}:`)) {
      return { valid: false, reason: 'invalid keepalive work proof' };
    }
    if (w.workerId === block.minerWallet) {
      return { valid: false, reason: 'proposer cannot be keepalive worker' };
    }
  }
  return { valid: true };
}

export function validateCoinbase(block) {
  if (block.height === 0) return { valid: true };

  const coinbase = block.coinbaseReward;
  if (!coinbase) return { valid: false, reason: 'missing coinbase' };

  const { proposer, sum } = totals(coinbase);
  const workSubmissions = workSubmissionsFromBlock(block);

  return (block.height <= REWARD_V2_HEIGHT)
    ? validateLegacy(block, coinbase, workSubmissions, proposer, sum)
    : validateV2(block, coinbase, workSubmissions, proposer, sum);
}
