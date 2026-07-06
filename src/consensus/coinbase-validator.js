/**
 * Coinbase validation — never trust gossiped reward amounts.
 */

import { calculateBlockRewards, BLOCK_REWARD_UPOH } from '../rewards/reward.js';
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
  })).filter(w => w.nodeId && w.requestId);
}

export function validateCoinbase(block) {
  if (block.height === 0) return { valid: true };

  const coinbase = block.coinbaseReward;
  if (!coinbase) return { valid: false, reason: 'missing coinbase' };

  if (coinbase.totalNewSupply !== BLOCK_REWARD_UPOH) {
    return { valid: false, reason: `invalid totalNewSupply (${coinbase.totalNewSupply})` };
  }

  const { workerTotal, proposer, sum } = totals(coinbase);
  if (sum > BLOCK_REWARD_UPOH) {
    return { valid: false, reason: 'coinbase exceeds block reward' };
  }

  const workSubmissions = workSubmissionsFromBlock(block);

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
    // Empty block: the proposer may take AT MOST the full reward. Taking less
    // (e.g. a reputation-reduced proposer that burns the remainder) is allowed —
    // otherwise such a block is un-syncable by every validating peer and stalls
    // the chain. Taking MORE than the full reward is rejected.
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