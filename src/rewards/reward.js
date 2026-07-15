/**
 * PoH Miner Network - Native Reward / Coinbase Model
 *
 * Goal: Make POH tokens feel "produced" in blocks, similar to Bitcoin coinbase.
 * This is a simplified model for the current JS simulation.
 */

import { estimateTokens } from '../jobs/gas-estimator.js';

export class RewardOutput {
  constructor({
    id,                    // Unique output id (e.g., `${blockHeight}:${index}`)
    amount,                // Amount in smallest POH units
    owner,                 // Wallet or work proof identifier that can claim this
    maturityHeight = 0,    // Block height after which this can be spent (like BTC coinbase)
    workProofHash = null,  // Hash of the useful work that earned this reward
  }) {
    this.id = id;
    this.amount = amount;
    this.owner = owner;
    this.maturityHeight = maturityHeight;
    this.workProofHash = workProofHash;
    this.createdAtHeight = null; // set when block is produced
  }
}

export class CoinbaseReward {
  constructor({
    blockHeight,
    proposerReward = 0,    // Reward to the node that proposed the block
    workerRewards = [],    // Array of RewardOutput for nodes that did useful work
    totalNewSupply = 0,    // Total newly minted in this block
  }) {
    this.blockHeight = blockHeight;
    this.proposerReward = proposerReward;
    this.workerRewards = workerRewards;
    this.totalNewSupply = totalNewSupply;
  }

  /**
   * Create reward outputs that will be included in the block.
   * This is where the token is "produced".
   */
  generateOutputs() {
    const outputs = [];

    if (this.proposerReward > 0) {
      outputs.push(new RewardOutput({
        id: `${this.blockHeight}:proposer`,
        amount: this.proposerReward,
        owner: 'block-proposer',
        maturityHeight: this.blockHeight + 100, // 100 block maturity like BTC
      }));
    }

    this.workerRewards.forEach((worker, index) => {
      outputs.push(new RewardOutput({
        id: `${this.blockHeight}:worker:${index}`,
        amount: worker.amount,
        owner: worker.workerId,
        maturityHeight: this.blockHeight + 50,
        workProofHash: worker.workProofHash,
      }));
    });

    return outputs;
  }
}

/**
 * Fixed block reward: exactly 1 POH per block.
 * Internally represented as micro-POH (1 POH = 1_000_000_000 μPOH) so that
 * integer splits don't floor to zero when dividing fractions of 1.
 *
 * Protection: Only high-quality work (validated via validateResultWork)
 * should be allowed to contribute to or benefit from block rewards.
 */
export const POH_DECIMALS = 1_000_000_000; // 1 POH = 1e9 micro-POH
export const BLOCK_REWARD_POH = 1; // human-readable display value
export const BLOCK_REWARD_UPOH = BLOCK_REWARD_POH * POH_DECIMALS; // 1_000_000_000 μPOH

/** Public skill deploy / proposal fee (escrowed for network code audit). */
export const SKILL_PROPOSE_FEE_POH = 1;
export const SKILL_PROPOSE_FEE_UPOH = SKILL_PROPOSE_FEE_POH * POH_DECIMALS;

/** Community stake required before a proposed skill graduates to active. */
export const SKILL_GRADUATION_THRESHOLD_POH = 10;
export const SKILL_GRADUATION_THRESHOLD_UPOH = SKILL_GRADUATION_THRESHOLD_POH * POH_DECIMALS;

// ── Reward model v2 ──────────────────────────────────────────────────────────
// The network's product is AI compute, so the block subsidy should flow to the
// nodes that completed jobs — weighted by the compute they delivered — not to
// whoever won the PoW race. Below constants are CONSENSUS-CRITICAL: they must be
// identical on every node (imported by both the proposer and coinbase-validator).
// Do NOT make them per-node config — divergence forks the chain.

/** Proposer keeps this fraction (for PoW + assembling the block); the rest is
 *  split among AI workers by delivered compute. */
export const PROPOSER_CUT = 0.10;

/** A block with no real AI work mints only this small keepalive (not a full POH),
 *  so emission tracks demand. */
export const KEEPALIVE_UPOH = Math.floor(0.05 * POH_DECIMALS);

/**
 * Height at which reward model v2 activates. Blocks with height <= this validate
 * under the legacy 60/40 rule (so existing history stays valid); blocks above it
 * use v2. FLAG-DAY: pinned to (chain tip + ~10) at the coordinated 2026-07-13
 * deploy — every node must be on this build before the chain reaches this height.
 */
export const REWARD_V2_HEIGHT = 0;

/**
 * Deterministic compute weight for one work result, derived ONLY from fields that
 * live in the block (and are therefore hashed): the number of signals evaluated and
 * the scanned address. Never uses self-reported/runtime token counts — those aren't
 * deterministic across nodes and would be gameable. Both the proposer and every
 * validator compute this identically from block.scanResults.
 */
export function workTokens(result) {
  const signals = Array.isArray(result?.signalsUsed) ? result.signalsUsed.length : 0;
  return estimateTokens(signals, result?.address || null);
}

/** Legacy (pre-v2) coinbase: 60% proposer / 40% split evenly among workers/peers. */
function legacyBlockRewards(validWorkSubmissions, blockHeight, activePeers) {
  const totalNewSupply = BLOCK_REWARD_UPOH;
  let proposerReward;
  let workerRewards = [];

  if (validWorkSubmissions.length > 0) {
    proposerReward = Math.floor(totalNewSupply * 0.6);
    const perWorker = Math.floor((totalNewSupply * 0.4) / validWorkSubmissions.length);
    workerRewards = validWorkSubmissions.map((work, i) => ({
      workerId:      work.nodeId || work.minerWallet,
      amount:        perWorker,
      workProofHash: work.proofHash || work.requestId || `work-${i}`,
    }));
  } else if (activePeers.length > 0) {
    proposerReward = Math.floor(totalNewSupply * 0.6);
    const perPeer = Math.floor((totalNewSupply * 0.4) / activePeers.length);
    workerRewards = activePeers.map((peer, i) => ({
      workerId:      peer.wallet,
      amount:        perPeer,
      workProofHash: `keepalive:${blockHeight}:${peer.wallet}`,
    }));
  } else {
    proposerReward = totalNewSupply;
  }

  return new CoinbaseReward({ blockHeight, proposerReward, workerRewards, totalNewSupply });
}

/**
 * @param validWorkSubmissions  Array of { nodeId|minerWallet, proofHash|requestId, tokens }
 *                              `tokens` is the deterministic weight from workTokens();
 *                              callers (proposer + validator) must set it identically.
 * @param blockHeight           Current block height (selects legacy vs v2 rule)
 * @param activePeers           Array of { wallet } to share the keepalive reward with
 *                              when there is no compute work (proposer excluded).
 */
export function calculateBlockRewards(validWorkSubmissions = [], blockHeight = 0, activePeers = []) {
  // History (and any block up to the flag-day boundary) keeps the old rule.
  if (blockHeight <= REWARD_V2_HEIGHT) {
    return legacyBlockRewards(validWorkSubmissions, blockHeight, activePeers);
  }

  // ── v2: pay AI workers by delivered compute, tiny proposer cut ──
  if (validWorkSubmissions.length > 0) {
    const totalNewSupply = BLOCK_REWARD_UPOH;
    let proposerReward   = Math.floor(totalNewSupply * PROPOSER_CUT);
    const workerPool     = totalNewSupply - proposerReward;

    const weights = validWorkSubmissions.map(w => Math.max(1, w.tokens || 1));
    const weightSum = weights.reduce((a, b) => a + b, 0);

    let distributed = 0;
    const workerRewards = validWorkSubmissions.map((work, i) => {
      const amount = Math.floor((workerPool * weights[i]) / weightSum);
      distributed += amount;
      return {
        workerId:      work.nodeId || work.minerWallet,
        amount,
        workProofHash: work.proofHash || work.requestId || `work-${i}`,
      };
    });
    // Floor-division dust goes to the proposer so Σ === totalNewSupply exactly.
    proposerReward += workerPool - distributed;

    return new CoinbaseReward({ blockHeight, proposerReward, workerRewards, totalNewSupply });
  }

  // No real work → mint only a small keepalive (emission tracks demand).
  const totalNewSupply = KEEPALIVE_UPOH;
  if (activePeers.length > 0) {
    let proposerReward = Math.floor(totalNewSupply * PROPOSER_CUT);
    const pool = totalNewSupply - proposerReward;
    const perPeer = Math.floor(pool / activePeers.length);
    const workerRewards = activePeers.map(peer => ({
      workerId:      peer.wallet,
      amount:        perPeer,
      workProofHash: `keepalive:${blockHeight}:${peer.wallet}`,
    }));
    proposerReward += pool - perPeer * activePeers.length; // dust to proposer
    return new CoinbaseReward({ blockHeight, proposerReward, workerRewards, totalNewSupply });
  }
  return new CoinbaseReward({ blockHeight, proposerReward: totalNewSupply, workerRewards: [], totalNewSupply });
}
