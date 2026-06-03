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
 * Internally represented as micro-POH (1 POH = 1_000_000_000 μPOH) so that
 * integer splits don't floor to zero when dividing fractions of 1.
 *
 * Protection: Only high-quality work (validated via validateResultWork)
 * should be allowed to contribute to or benefit from block rewards.
 */
export const POH_DECIMALS = 1_000_000_000; // 1 POH = 1e9 micro-POH
export const BLOCK_REWARD_POH = 1; // human-readable display value
export const BLOCK_REWARD_UPOH = BLOCK_REWARD_POH * POH_DECIMALS; // 1_000_000_000 μPOH

/**
 * @param validWorkSubmissions  Array of { nodeId|minerWallet, proofHash|requestId }
 * @param blockHeight           Current block height
 * @param activePeers           Array of { wallet } — peers to share the keepalive
 *                              reward with when there is no compute work.
 *                              The block proposer should be excluded from this list
 *                              (they already receive the proposer share).
 */
export function calculateBlockRewards(validWorkSubmissions = [], blockHeight = 0, activePeers = []) {
  const totalNewSupply = BLOCK_REWARD_UPOH;

  let proposerReward;
  let workerRewards = [];

  if (validWorkSubmissions.length > 0) {
    // Compute block: 60% to proposer, 40% split evenly among workers
    proposerReward = Math.floor(totalNewSupply * 0.6);
    const perWorker = Math.floor((totalNewSupply * 0.4) / validWorkSubmissions.length);
    workerRewards = validWorkSubmissions.map((work, i) => ({
      workerId:      work.nodeId || work.minerWallet,
      amount:        perWorker,
      workProofHash: work.proofHash || work.requestId || `work-${i}`,
    }));
  } else if (activePeers.length > 0) {
    // Empty block with known active peers:
    // 60% to proposer for doing PoW, 40% split as keepalive among active peers.
    proposerReward = Math.floor(totalNewSupply * 0.6);
    const perPeer = Math.floor((totalNewSupply * 0.4) / activePeers.length);
    workerRewards = activePeers.map((peer, i) => ({
      workerId:      peer.wallet,
      amount:        perPeer,
      workProofHash: `keepalive:${blockHeight}:${peer.wallet}`,
    }));
  } else {
    // Empty block, no known peers — full reward to proposer
    proposerReward = totalNewSupply;
  }

  return new CoinbaseReward({
    blockHeight,
    proposerReward,
    workerRewards,
    totalNewSupply,
  });
}
