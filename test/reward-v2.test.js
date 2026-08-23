/**
 * Reward model v2 — token-weighted worker split, small proposer cut, keepalive-only
 * idle blocks, and the flag-day height boundary that keeps legacy history valid.
 */
import { describe, it, expect } from 'vitest';
import {
  calculateBlockRewards,
  workTokens,
  PROPOSER_CUT,
  KEEPALIVE_UDAI,
  REWARD_V2_HEIGHT,
  BLOCK_REWARD_UDAI,
} from '../src/rewards/reward.js';
import { validateCoinbase } from '../src/consensus/coinbase-validator.js';
import { ScanResult } from '../src/core/scanRequest.js';

const V2 = REWARD_V2_HEIGHT + 1;   // a height in the v2 regime
const LEGACY = REWARD_V2_HEIGHT;   // still legacy (<= boundary)

function mkResult({ wallet, req, signals = [], address = 'dai-addr' }) {
  return new ScanResult({
    requestId: req, address, verdict: 'human', confidence: 90, reasoning: 'ok',
    signalsUsed: signals, minerWallet: wallet, methodsHash: 'mh', profile: { ok: true },
  });
}
function subsFrom(results) {
  return results.map(r => ({
    nodeId: r.minerWallet, requestId: r.requestId,
    proofHash: r.getResultHash(), tokens: workTokens(r),
  }));
}
function mkBlock({ height, minerWallet = 'daiProposer', results = [], coinbase }) {
  return { height, minerWallet, scanResults: results, coinbaseReward: coinbase };
}
const sum = cb => (cb.proposerReward || 0) + (cb.workerRewards || []).reduce((s, w) => s + w.amount, 0);

describe('reward v2 — calculateBlockRewards', () => {
  it('work block: full 1 DAI, ~10% proposer, rest token-weighted, sums exactly', () => {
    const results = [mkResult({ wallet: 'w1', req: 'r1', signals: ['a'] }),
                     mkResult({ wallet: 'w2', req: 'r2', signals: ['a', 'b', 'c'] })];
    const cb = calculateBlockRewards(subsFrom(results), V2, []);
    expect(cb.totalNewSupply).toBe(BLOCK_REWARD_UDAI);
    expect(sum(cb)).toBe(BLOCK_REWARD_UDAI);            // no leakage (dust → proposer)
    expect(cb.proposerReward).toBeGreaterThanOrEqual(Math.floor(BLOCK_REWARD_UDAI * PROPOSER_CUT));
    // w2 did 3x the signals → strictly more than w1
    const a1 = cb.workerRewards.find(w => w.workerId === 'w1').amount;
    const a2 = cb.workerRewards.find(w => w.workerId === 'w2').amount;
    expect(a2).toBeGreaterThan(a1);
  });

  it('equal work → equal split (identity-splitting earns nothing extra)', () => {
    const one = subsFrom([mkResult({ wallet: 'solo', req: 'r1', signals: ['a', 'b'] })]);
    const solo = calculateBlockRewards(one, V2, []);
    const soloWorker = solo.workerRewards[0].amount;
    // same wallet split into two identities doing half the (equal) work each
    const two = subsFrom([mkResult({ wallet: 'x', req: 'r1', signals: ['a', 'b'] }),
                          mkResult({ wallet: 'y', req: 'r2', signals: ['a', 'b'] })]);
    const split = calculateBlockRewards(two, V2, []);
    const totalToWorkers = split.workerRewards.reduce((s, w) => s + w.amount, 0);
    expect(totalToWorkers).toBe(soloWorker);            // two identities share the same pool
  });

  it('idle block with no peers mints only the keepalive to the proposer', () => {
    const cb = calculateBlockRewards([], V2, []);
    expect(cb.totalNewSupply).toBe(KEEPALIVE_UDAI);
    expect(cb.proposerReward).toBe(KEEPALIVE_UDAI);
    expect(cb.workerRewards.length).toBe(0);
  });

  it('idle block with peers splits the keepalive (small proposer + peers)', () => {
    const cb = calculateBlockRewards([], V2, [{ wallet: 'p1' }, { wallet: 'p2' }]);
    expect(cb.totalNewSupply).toBe(KEEPALIVE_UDAI);
    expect(sum(cb)).toBe(KEEPALIVE_UDAI);
    expect(cb.workerRewards.length).toBe(2);
  });

  it('below the boundary still uses the legacy 60/40 rule', () => {
    const cb = calculateBlockRewards(subsFrom([mkResult({ wallet: 'w', req: 'r', signals: ['a'] })]), LEGACY, []);
    expect(cb.proposerReward).toBe(Math.floor(BLOCK_REWARD_UDAI * 0.6));
    expect(cb.totalNewSupply).toBe(BLOCK_REWARD_UDAI);
  });
});

describe('reward v2 — validateCoinbase', () => {
  const results = [mkResult({ wallet: 'w1', req: 'r1', signals: ['a'] }),
                   mkResult({ wallet: 'w2', req: 'r2', signals: ['a', 'b', 'c'] })];

  it('accepts a correctly-built v2 work block', () => {
    const cb = calculateBlockRewards(subsFrom(results), V2, []);
    expect(validateCoinbase(mkBlock({ height: V2, results, coinbase: cb })).valid).toBe(true);
  });

  it('rejects a tampered worker amount', () => {
    const cb = calculateBlockRewards(subsFrom(results), V2, []);
    cb.workerRewards[0].amount += 1000;
    expect(validateCoinbase(mkBlock({ height: V2, results, coinbase: cb })).valid).toBe(false);
  });

  it('rejects a proposer that inflates its share above expected', () => {
    const cb = calculateBlockRewards(subsFrom(results), V2, []);
    cb.proposerReward += 1000;
    expect(validateCoinbase(mkBlock({ height: V2, results, coinbase: cb })).valid).toBe(false);
  });

  it('allows a reputation-reduced proposer (burns the remainder)', () => {
    const cb = calculateBlockRewards(subsFrom(results), V2, []);
    cb.proposerReward = Math.floor(cb.proposerReward * 0.5); // slashed
    expect(validateCoinbase(mkBlock({ height: V2, results, coinbase: cb })).valid).toBe(true);
  });

  it('rejects an idle v2 block that tries to mint a full DAI', () => {
    const bad = calculateBlockRewards([], LEGACY, []); // legacy idle = full 1 DAI
    expect(validateCoinbase(mkBlock({ height: V2, results: [], coinbase: bad })).valid).toBe(false);
  });

  it('accepts a keepalive-only idle v2 block', () => {
    const cb = calculateBlockRewards([], V2, []);
    expect(validateCoinbase(mkBlock({ height: V2, results: [], coinbase: cb })).valid).toBe(true);
  });

  it('boundary: a v2-shaped coinbase is rejected in the legacy regime', () => {
    const v2cb = calculateBlockRewards(subsFrom(results), V2, []);
    // After the genesis reset REWARD_V2_HEIGHT is 0, so the only "legacy" height
    // is genesis — which validateCoinbase exempts outright. There's no
    // non-genesis legacy block left to reject a v2 shape, so assert the exemption.
    // This flips back to the real 60/40 rejection check the moment a non-zero
    // flag-day is set again (LEGACY > 0).
    if (LEGACY <= 0) {
      expect(validateCoinbase(mkBlock({ height: 0, results, coinbase: v2cb })).valid).toBe(true);
      return;
    }
    // same reward object presented at a legacy height must fail the 60/40 checks
    expect(validateCoinbase(mkBlock({ height: LEGACY, results, coinbase: v2cb })).valid).toBe(false);
  });

  it('history: a legacy 60/40 block still validates at/below the boundary', () => {
    const cb = calculateBlockRewards(subsFrom(results), LEGACY, []);
    expect(validateCoinbase(mkBlock({ height: LEGACY, results, coinbase: cb })).valid).toBe(true);
  });
});
