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
import fs from 'fs';
import path from 'path';
import os from 'os';

const CHAIN_SNAP_EVERY  = 100;
const BRAIN_SNAP_MS     = 30 * 60 * 1000;
const PUSH_TIMEOUT_MS   = 8_000;

// Local cache file — stores the last known CIDs so the node survives
// a bootnode outage across restarts.
const CID_CACHE_FILE = path.join(os.homedir(), '.poh-miner', 'ipfs_cid_cache.json');

function loadCIDCache() {
  try {
    if (fs.existsSync(CID_CACHE_FILE)) return JSON.parse(fs.readFileSync(CID_CACHE_FILE, 'utf8'));
  } catch { /* ignore */ }
  return { chain: null, brain: null, peers: null };
}

function saveCIDCache(cids) {
  try {
    fs.mkdirSync(path.dirname(CID_CACHE_FILE), { recursive: true });
    fs.writeFileSync(CID_CACHE_FILE, JSON.stringify(cids, null, 2));
  } catch { /* non-fatal */ }
}

export class IPFSSync {
  constructor({ chain, bootnodes = [], identityWallet = null, storeOpts = {} } = {}) {
    this.chain          = chain;
    this.bootnodes      = bootnodes;
    this.identityWallet = identityWallet;
    this.store          = new IPFSStore(storeOpts);
    this.lastChainSnap  = 0;
    this.latestCIDs     = loadCIDCache(); // seed from disk so fallback works immediately
    this._brainInterval = null;
  }

  // ── Startup bootstrap ─────────────────────────────────────────────────────

  /**
   * Pull latest known CIDs from the bootnode.
   * Also persists them locally so they survive across restarts.
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
        if (data.peers?.cid) this.latestCIDs.peers = data.peers.cid;
        saveCIDCache(this.latestCIDs);
        console.log(`[IPFSSync] Latest CIDs from ${bn}: chain=${data.chain?.cid?.slice(0,16) ?? 'none'} brain=${data.brain?.cid?.slice(0,16) ?? 'none'} peers=${data.peers?.cid?.slice(0,16) ?? 'none'}`);
        return this.latestCIDs;
      } catch { /* try next bootnode */ }
    }
    // Bootnode unreachable — return cached CIDs from disk
    if (this.latestCIDs.peers || this.latestCIDs.chain) {
      console.log('[IPFSSync] Bootnode unreachable — using cached CIDs for peer discovery and chain catch-up');
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
    if (!brainDir) return null;
    try {
      const cid = await this.store.addBrainState(brainDir);
      if (!cid) return null;
      this.latestCIDs.brain = cid;
      console.log(`[IPFSSync] Brain state pinned: ${cid.slice(0, 20)}…`);
      await this._pushCIDs({ brain: cid });
      return cid;
    } catch (e) {
      console.warn('[IPFSSync] Brain snapshot failed:', e.message);
      return null;
    }
  }

  // ── Peer record ───────────────────────────────────────────────────────────

  /**
   * Pin this miner's own peer record to IPFS and push the CID to the bootnode.
   * Called once after successful bootnode registration.
   *
   * peerInfo: { wallet, host, walletApiPort, region, methodsHash }
   */
  async publishPeerRecord(peerInfo) {
    try {
      const record = {
        ...peerInfo,
        ts: Date.now(),
        version: 1,
      };
      if (this.identityWallet?.sign) {
        const toSign = JSON.stringify({ wallet: record.wallet, host: record.host, walletApiPort: record.walletApiPort, ts: record.ts });
        record.signature        = this.identityWallet.sign(toSign);
        record.signingPublicKey = this.identityWallet.signingPublicKey;
      }
      const cid = await this.store.add(record, 'peer-record.json');
      if (!cid) return null;
      this.latestCIDs.selfPeer = cid;
      saveCIDCache(this.latestCIDs);
      console.log(`[IPFSSync] Peer record pinned: ${cid.slice(0, 20)}…`);
      await this._pushCIDs({ selfPeer: cid });
      return cid;
    } catch (e) {
      console.warn('[IPFSSync] Peer record pin failed:', e.message);
      return null;
    }
  }

  /**
   * Fetch the peer directory from IPFS using the cached (or bootnode-supplied) CID.
   * Returns an array of { wallet, host, walletApiPort, region } peer objects,
   * or [] if the directory is unreachable.
   *
   * Used as a fallback when all bootnodes are unreachable.
   */
  async fetchPeerDirectory(selfWallet) {
    const cid = this.latestCIDs.peers;
    if (!cid) {
      console.warn('[IPFSSync] No peer directory CID cached — cannot use IPFS fallback');
      return [];
    }
    try {
      const data = await this.store.getJSON(cid);
      if (!Array.isArray(data?.peers)) return [];
      const peers = data.peers.filter(p => p.wallet !== selfWallet && p.host && p.walletApiPort);
      console.log(`[IPFSSync] Peer directory from IPFS (${cid.slice(0,16)}…): ${peers.length} peers`);
      return peers;
    } catch (e) {
      console.warn('[IPFSSync] Peer directory fetch failed:', e.message);
      return [];
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
