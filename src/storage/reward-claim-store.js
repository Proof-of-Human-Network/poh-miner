/**
 * RewardClaimStore
 * 
 * Persists which worker rewards this node has already claimed.
 * Prevents double-crediting on re-syncs or duplicate block deliveries.
 *
 * Stored at: ~/.poh-miner/rewards/claimed.json
 */

import fs from 'fs';
import path from 'path';

const DEFAULT_REWARD_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.poh-miner',
  'rewards'
);

export class RewardClaimStore {
  constructor(dataDir = DEFAULT_REWARD_DIR) {
    this.dataDir = dataDir;
    this.claimFile = path.join(dataDir, 'claimed.json');

    this.claimed = new Set(); // in-memory Set for fast lookup

    this._ensureDir();
    this._load();
  }

  _ensureDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  _load() {
    if (!fs.existsSync(this.claimFile)) {
      this._save(); // create empty file
      return;
    }

    try {
      const data = JSON.parse(fs.readFileSync(this.claimFile, 'utf8'));
      if (Array.isArray(data.claimed)) {
        this.claimed = new Set(data.claimed);
      }
    } catch (err) {
      console.warn('[RewardClaimStore] Failed to load claimed rewards, starting fresh:', err.message);
      this.claimed = new Set();
    }
  }

  _save() {
    try {
      const data = {
        claimed: Array.from(this.claimed),
        lastUpdated: Date.now(),
      };
      fs.writeFileSync(this.claimFile, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[RewardClaimStore] Failed to save claimed rewards:', err.message);
    }
  }

  /**
   * Check if this reward has already been claimed.
   * @param {string} claimKey - e.g. `${blockHeight}:${workProofHash}`
   */
  isClaimed(claimKey) {
    return this.claimed.has(claimKey);
  }

  /**
   * Mark a reward as claimed and persist.
   */
  markClaimed(claimKey) {
    if (!claimKey) return;
    if (!this.claimed.has(claimKey)) {
      this.claimed.add(claimKey);
      this._save();
    }
  }

  /**
   * Atomically check and claim in one step. Returns true if newly claimed.
   */
  claimIfNotAlready(claimKey) {
    if (!claimKey || this.isClaimed(claimKey)) {
      return false;
    }
    this.markClaimed(claimKey);
    return true;
  }

  /**
   * Remove a claim (used during reorg so rewards can be re-earned on the new chain).
   */
  unclaim(claimKey) {
    if (claimKey && this.claimed.has(claimKey)) {
      this.claimed.delete(claimKey);
      this._save();
    }
  }

  /**
   * Wipe all claims (used when rebuilding balance state from scratch after fork recovery).
   */
  reset() {
    this.claimed = new Set();
    this._save();
  }

  /**
   * Generate a consistent claim key for a worker reward.
   */
  static makeClaimKey(blockHeight, workProofHash) {
    return `${blockHeight}:${workProofHash || 'unknown'}`;
  }
}
