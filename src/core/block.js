/**
 * PoH Miner Network - Core Block Structure
 *
 * This defines what a block looks like in the decentralized PoW network
 * run by miners.
 */

export class PohBlock {
  constructor({
    height,
    previousHash,
    timestamp,
    minerWallet,           // The winning miner's Solana address
    scanResults = [],      // Array of { requestId, resultHash, winnerSignature, fee }
    stateTransitions = [], // SignalsTransaction (new methods), weight updates, brain deltas, etc.

    coinbaseReward = null, // CoinbaseReward instance (native token production)
    nonce = 0,
    difficulty = 0,
  }) {
    this.height = height;
    this.previousHash = previousHash;
    this.timestamp = timestamp;
    this.minerWallet = minerWallet;
    this.scanResults = scanResults;
    this.stateTransitions = stateTransitions;

    this.coinbaseReward = coinbaseReward;
    this.nonce = nonce;
    this.difficulty = difficulty;
  }

  /**
   * Compute the block hash (for PoW and chain linking)
   */
  async getHash() {
    const data = JSON.stringify({
      height: this.height,
      previousHash: this.previousHash,
      timestamp: this.timestamp,
      minerWallet: this.minerWallet,
      scanResults: this.scanResults,
      stateTransitions: this.stateTransitions,

      coinbaseReward: this.coinbaseReward ? {
        totalNewSupply: this.coinbaseReward.totalNewSupply,
        proposerReward: this.coinbaseReward.proposerReward,
      } : null,
      nonce: this.nonce,
    });

    // Simple SHA256 for now (can be upgraded to more PoW-friendly later)
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Check if this block satisfies the current difficulty target
   */
  async meetsDifficulty() {
    const hash = await this.getHash();
    const target = '0'.repeat(this.difficulty);
    return hash.startsWith(target);
  }

  toJSON() {
    return { ...this };
  }

  static fromJSON(json) {
    return new PohBlock(json);
  }
}
