/**
 * POH Reward Distribution for the Miner Network
 *
 * Block rewards + scan fees are distributed to miners who:
 * - Produced the block
 * - Won the first-come-first-serve computation race for scans
 * - (Future) Submitted hardware attestation / uptime proofs
 */

import { BLOCK_REWARD_POH } from './reward.js';

export function calculateBlockReward(height) {
  // Fixed 1 POH per block (no halving for simplicity in this phase)
  return BLOCK_REWARD_POH;
}

export function distributeRewards(block, totalFees = 0) {
  const reward = calculateBlockReward(block.height);
  const total = reward + totalFees;

  // Only valid work results should be considered here in a real impl
  const distribution = {};

  if (block.minerWallet) {
    distribution[block.minerWallet] = Math.floor(total * 0.7); // 70% to block producer
  }

  // TODO: Distribute remaining to miners whose *validated* ScanResults were included

  return distribution;
}
