/**
 * PoH Miner Network - Core Block Structure
 */

import crypto from 'crypto';
import { Wallet } from '../wallet/wallet.js';

export class PohBlock {
  constructor({
    height,
    previousHash,
    timestamp,
    minerWallet,
    scanResults = [],
    stateTransitions = [],
    transactions = [],     // formal PoHTransaction objects (Fix 4)
    coinbaseReward = null,
    nonce = 0,
    difficulty = 0,
    chainWork = '0',       // cumulative difficulty as hex bigint string (Fix 3)
    minerSignature = null, // ed25519 signature over block hash (Fix 2)
    minerSigningPublicKey = null,
    stateRoot = null,      // SHA-256 of sorted {address,balance,nonce} at this height
    brainStateRoot = null, // SHA-256 of weights.json + pools.json at this height
  }) {
    this.height = height;
    this.previousHash = previousHash;
    this.timestamp = timestamp;
    this.minerWallet = minerWallet;
    this.scanResults = scanResults;
    this.stateTransitions = stateTransitions;
    this.transactions = transactions;
    this.coinbaseReward = coinbaseReward;
    this.nonce = nonce;
    this.difficulty = difficulty;
    this.chainWork = chainWork;
    this.minerSignature = minerSignature;
    this.minerSigningPublicKey = minerSigningPublicKey;
    this.stateRoot = stateRoot;
    this.brainStateRoot = brainStateRoot;
  }

  // Layer 5: skillResults is the canonical name; scanResults kept for on-disk compat
  get skillResults() { return this.scanResults; }
  set skillResults(v) { this.scanResults = v; }

  // Synchronous SHA-256 (Node.js crypto) — used in the hot PoW loop
  getHashSync() {
    const data = JSON.stringify({
      height: this.height,
      previousHash: this.previousHash,
      timestamp: this.timestamp,
      minerWallet: this.minerWallet,
      scanResults: this.scanResults,
      stateTransitions: this.stateTransitions,
      transactions: this.transactions,
      coinbaseReward: this.coinbaseReward ? {
        blockHeight: this.coinbaseReward.blockHeight,
        totalNewSupply: this.coinbaseReward.totalNewSupply,
        proposerReward: this.coinbaseReward.proposerReward,
        workerRewards: (this.coinbaseReward.workerRewards || []).map(w => ({
          workerId: w.workerId,
          amount: w.amount,
          workProofHash: w.workProofHash,
        })),
      } : null,
      stateRoot: this.stateRoot,
      brainStateRoot: this.brainStateRoot,
      nonce: this.nonce,
    });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  // Async alias kept for external callers that await it
  async getHash() {
    return this.getHashSync();
  }

  meetsDifficultySync() {
    const hash = this.getHashSync();
    return hash.startsWith('0'.repeat(this.difficulty));
  }

  async meetsDifficulty() {
    return this.meetsDifficultySync();
  }

  // Sign the block with the proposer's identity wallet.
  // Called after the block hash is stable (PoW solved, nonce fixed).
  sign(identityWallet) {
    const hash = this.getHashSync();
    this.minerSignature = identityWallet.sign(hash);
    this.minerSigningPublicKey = identityWallet.signingPublicKey;
    return this;
  }

  // Verify the proposer's signature over the block hash.
  verifySignature() {
    if (!this.minerSignature || !this.minerSigningPublicKey) return false;
    return Wallet.verifySignature(
      this.minerSigningPublicKey,
      this.getHashSync(),
      this.minerSignature
    );
  }

  toJSON() {
    return { ...this };
  }

  static fromJSON(json) {
    return new PohBlock(json);
  }
}
