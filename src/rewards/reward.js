/**
 * PoH Miner Network - Native Reward / Coinbase Model
 *
 * Goal: Make POH tokens feel "produced" in blocks, similar to Bitcoin coinbase.
 * This is a simplified model for the current JS simulation.
 */

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
 *
 * Protection: Only high-quality work (validated via validateResultWork)
 * should be allowed to contribute to or benefit from block rewards.
 */
export const BLOCK_REWARD_POH = 1; // Fixed 1 POH per block

export function calculateBlockRewards(validWorkSubmissions = [], blockHeight = 0) {
  // Always fixed reward
  const totalNewSupply = BLOCK_REWARD_POH;

  // For now: 60% to block proposer, 40% split among nodes that contributed *valid* work
  const proposerShare = 0.6;
  const workerShare = 0.4;

  const proposerReward = Math.floor(totalNewSupply * proposerShare);

  let workerRewards = [];

  if (validWorkSubmissions.length > 0) {
    const perWorker = Math.floor((totalNewSupply * workerShare) / validWorkSubmissions.length);

    workerRewards = validWorkSubmissions.map((work, i) => ({
      workerId: work.nodeId || work.minerWallet,
      amount: perWorker,
      workProofHash: work.proofHash || work.requestId || `work-${i}`,
    }));
  }

  return new CoinbaseReward({
    blockHeight,
    proposerReward,
    workerRewards,
    totalNewSupply,
  });
}
