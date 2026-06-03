/**
 * IPFSSync — periodic chain + brain state pinning and CID sharing.
 *
 * Runs two independent intervals:
 *   - Chain snapshot: every CHAIN_SNAP_EVERY blocks (default 100)
 *   - Brain state:    every BRAIN_SNAP_EVERY ms   (default 30 min)
 *
 * After each successful pin, the CID is pushed to all configured bootnodes
 * so peers can discover it via GET /ipfs/latest.
 *
 * On startup, pulls the latest known CIDs from the bootnode and checks
 * if we should bootstrap our chain or brain from IPFS instead of (or in
 * addition to) the normal HTTP sync path.
 */

import { IPFSStore } from './ipfs-store.js';
import { getBrainDataDir } from '../compute/adapters/real-poh.js';

const CHAIN_SNAP_EVERY  = 100;   // blocks between chain snapshots
const BRAIN_SNAP_MS     = 30 * 60 * 1000; // 30 minutes
const PUSH_TIMEOUT_MS   = 8_000;

export class IPFSSync {
  constructor({ chain, bootnodes = [], identityWallet = null, storeOpts = {} } = {}) {
    this.chain          = chain;        // live reference — always current
    this.bootnodes      = bootnodes;
    this.identityWallet = identityWallet;
    this.store          = new IPFSStore(storeOpts);
    this.lastChainSnap  = 0;            // block height of last chain snapshot
    this.latestCIDs     = { chain: null, brain: null };
    this._brainInterval = null;
  }

  // ── Startup bootstrap ─────────────────────────────────────────────────────

  /**
   * Pull latest known CIDs from the bootnode. Returns { chain, brain } CIDs.
   * If no bootnode responds, returns the local latestCIDs (may be null).
   */
  async fetchLatestCIDs() {
    for (const bn of this.bootnodes) {
      const base = bn.endsWith('/') ? bn : bn + '/';
      try {
        const res = await fetch(`${base}ipfs/latest`, {
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (data.chain?.cid) this.latestCIDs.chain = data.chain.cid;
        if (data.brain?.cid) this.latestCIDs.brain = data.brain.cid;
        console.log(`[IPFSSync] Latest CIDs from ${bn}: chain=${data.chain?.cid?.slice(0,16) ?? 'none'} brain=${data.brain?.cid?.slice(0,16) ?? 'none'}`);
        return this.latestCIDs;
      } catch { /* try next bootnode */ }
    }
    return this.latestCIDs;
  }

  /**
   * Try to bootstrap the chain from IPFS if the bootnode chain CID is known
   * and our local chain is shorter than the snapshot.
   * Returns the deserialized block array (caller applies it to this.chain),
   * or null if no useful data was found.
   */
  async fetchChainSnapshot() {
    const cid = this.latestCIDs.chain;
    if (!cid) return null;
    try {
      const snap = await this.store.getJSON(cid);
      if (!snap?.blocks?.length) return null;
      const localHeight = this.chain.length ? this.chain[this.chain.length - 1].height : -1;
      if (snap.height <= localHeight) return null;
      console.log(`[IPFSSync] Chain snapshot from IPFS: height=${snap.height} blocks=${snap.blockCount} cid=${cid.slice(0,20)}`);
      return snap;
    } catch { return null; }
  }

  /**
   * Fetch the brain state snapshot from IPFS and return it.
   * Caller decides whether to apply the weights.
   */
  async fetchBrainSnapshot() {
    const cid = this.latestCIDs.brain;
    if (!cid) return null;
    try {
      const snap = await this.store.getJSON(cid);
      if (!snap?.weights) return null;
      console.log(`[IPFSSync] Brain snapshot from IPFS: ${Object.keys(snap.weights).length} weights, ${snap.feedbackCount} feedbacks`);
      return snap;
    } catch { return null; }
  }

  // ── Periodic pinning ──────────────────────────────────────────────────────

  /** Called from _appendBlock — triggers snapshot if enough blocks have passed */
  async onBlockAppended(block) {
    if (block.height - this.lastChainSnap < CHAIN_SNAP_EVERY) return;
    await this._snapChain();
  }

  /** Called after brain state is updated (feedback, vote, consolidate) */
  async onBrainUpdated() {
    await this._snapBrain();
  }

  startPeriodicBrainSync() {
    this._brainInterval = setInterval(() => this._snapBrain(), BRAIN_SNAP_MS);
  }

  stop() {
    if (this._brainInterval) clearInterval(this._brainInterval);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  async _snapChain() {
    try {
      const cid = await this.store.addChainSnapshot(this.chain);
      if (!cid) return;
      this.latestCIDs.chain = cid;
      this.lastChainSnap = this.chain[this.chain.length - 1]?.height ?? 0;
      console.log(`[IPFSSync] Chain snapshot pinned: ${cid.slice(0, 20)}… (height ${this.lastChainSnap})`);
      await this._pushCIDs({ chain: cid });
    } catch (e) {
      console.warn('[IPFSSync] Chain snapshot failed:', e.message);
    }
  }

  async _snapBrain() {
    const brainDir = getBrainDataDir();
    if (!brainDir) return;
    try {
      const cid = await this.store.addBrainState(brainDir);
      if (!cid) return;
      this.latestCIDs.brain = cid;
      console.log(`[IPFSSync] Brain state pinned: ${cid.slice(0, 20)}…`);
      await this._pushCIDs({ brain: cid });
    } catch (e) {
      console.warn('[IPFSSync] Brain snapshot failed:', e.message);
    }
  }

  async _pushCIDs(updates) {
    const payload = {
      ...updates,
      minerWallet: this.identityWallet?.address,
      ts: Date.now(),
    };
    // Optionally sign so bootnode can verify authenticity
    if (this.identityWallet?.sign) {
      payload.signature = this.identityWallet.sign(JSON.stringify({
        ...updates,
        minerWallet: payload.minerWallet,
        ts: payload.ts,
      }));
      payload.signingPublicKey = this.identityWallet.signingPublicKey;
    }

    await Promise.allSettled(this.bootnodes.map(async bn => {
      const base = bn.endsWith('/') ? bn : bn + '/';
      try {
        await fetch(`${base}ipfs/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
        });
      } catch { /* bootnode unreachable */ }
    }));
  }
}
