/**
 * BrainSync — synchronizes LLM brain state across all miners.
 *
 * Two complementary mechanisms:
 *   1. Real-time push: when this node records feedback/votes, sign the event
 *      and broadcast it directly to all known peers + bootnode.
 *   2. Bootstrap pull: on startup (and periodically), pull accumulated events
 *      from the bootnode since our last sync timestamp.
 *
 * Events are signed with the miner's identity wallet so receivers can verify
 * authenticity. Deduplication is by eventHash (content hash) so the same
 * event arriving from multiple paths is only applied once.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const MAX_SEEN_HASHES = 5000;
const SYNC_STATE_FILE = 'brain_sync.json';
const BROADCAST_TIMEOUT_MS = 5000;
const BOOTNODE_TIMEOUT_MS = 10000;

export class BrainSync {
  constructor({ brainDataDir, identityWallet, walletApiPort = 3456 }) {
    this.brainDataDir = brainDataDir;
    this.identityWallet = identityWallet;
    this.walletApiPort = walletApiPort;
    this.syncStateFile = path.join(brainDataDir, SYNC_STATE_FILE);
    this.seenHashes = new Set();
    this.lastSyncTs = 0;
    this._loadState();
  }

  _loadState() {
    try {
      if (fs.existsSync(this.syncStateFile)) {
        const s = JSON.parse(fs.readFileSync(this.syncStateFile, 'utf8'));
        this.lastSyncTs = s.lastSyncTs || 0;
        (s.seenHashes || []).forEach(h => this.seenHashes.add(h));
      }
    } catch { /* start fresh */ }
  }

  _saveState() {
    try {
      const arr = Array.from(this.seenHashes);
      fs.writeFileSync(this.syncStateFile, JSON.stringify({
        lastSyncTs: this.lastSyncTs,
        seenHashes: arr.slice(-MAX_SEEN_HASHES),
      }));
    } catch { /* non-fatal */ }
  }

  // ── Event creation ────────────────────────────────────────────────────────────

  createEvent(type, data) {
    const ts = Date.now();
    const minerWallet = this.identityWallet?.address || 'unknown';
    const canonical = JSON.stringify({ type, data, ts, minerWallet });
    const eventHash = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 24);

    const event = { type, data, ts, minerWallet, eventHash };

    if (this.identityWallet && typeof this.identityWallet.sign === 'function') {
      event.signature = this.identityWallet.sign(canonical);
      event.signingPublicKey = this.identityWallet.signingPublicKey;
    }

    return event;
  }

  // ── Event application ─────────────────────────────────────────────────────────

  async applyEvent(event, brain) {
    if (!event?.type || !event?.data || !event?.eventHash) return false;

    // Deduplicate
    if (this.seenHashes.has(event.eventHash)) return false;

    try {
      if (event.type === 'feedback') {
        const { address, aiVerdict, correction, comment, signals } = event.data;
        if (!address || !aiVerdict || !correction) return false;
        if (brain?.onVerdictFeedback) {
          await brain.onVerdictFeedback(address, aiVerdict, correction, comment || '', signals || []);
        }
      } else if (event.type === 'weight_update') {
        const { method, voteType, vote, stakeWeight, feedback: fb } = event.data;
        if (!method || !voteType || !vote) return false;
        if (brain?.onVote) {
          await brain.onVote(method, voteType, vote, stakeWeight || 1, fb || null);
        }
      } else {
        return false;
      }

      this.seenHashes.add(event.eventHash);
      if (this.seenHashes.size > MAX_SEEN_HASHES) {
        const arr = Array.from(this.seenHashes);
        this.seenHashes = new Set(arr.slice(-MAX_SEEN_HASHES));
      }
      this._saveState();
      return true;
    } catch (err) {
      console.warn('[BrainSync] Failed to apply event:', err.message);
      return false;
    }
  }

  // ── Network broadcast ─────────────────────────────────────────────────────────

  async broadcastToPeers(event, peers) {
    if (!peers?.length) return;
    await Promise.allSettled(peers.map(async (peer) => {
      try {
        await fetch(`http://${peer.host}:${peer.walletApiPort}/api/brain/sync/event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(BROADCAST_TIMEOUT_MS),
        });
      } catch { /* unreachable peer — ignore */ }
    }));
  }

  async pushToBootnodes(event, bootnodes) {
    await Promise.allSettled((bootnodes || []).map(async (bootnode) => {
      const base = bootnode.endsWith('/') ? bootnode : bootnode + '/';
      try {
        await fetch(`${base}brain/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(BROADCAST_TIMEOUT_MS),
        });
      } catch { /* bootnode unreachable */ }
    }));
  }

  // Convenience: broadcast event to both peers and bootnodes
  async broadcast(event, peers, bootnodes) {
    await Promise.allSettled([
      this.broadcastToPeers(event, peers),
      this.pushToBootnodes(event, bootnodes),
    ]);
  }

  // ── Bootstrap pull ────────────────────────────────────────────────────────────

  async pullFromBootnodes(bootnodes, brain) {
    for (const bootnode of (bootnodes || [])) {
      const base = bootnode.endsWith('/') ? bootnode : bootnode + '/';
      try {
        const res = await fetch(`${base}brain/events?since=${this.lastSyncTs}`, {
          signal: AbortSignal.timeout(BOOTNODE_TIMEOUT_MS),
        });
        if (!res.ok) continue;

        const { events = [] } = await res.json();
        if (!events.length) break;

        let applied = 0;
        for (const event of events) {
          if (await this.applyEvent(event, brain)) applied++;
        }

        const maxTs = Math.max(...events.map(e => e.ts || 0));
        if (maxTs > this.lastSyncTs) {
          this.lastSyncTs = maxTs;
          this._saveState();
        }

        console.log(`[BrainSync] Pulled ${events.length} events from ${bootnode} — applied ${applied} new`);
        break;
      } catch { /* try next bootnode */ }
    }
  }

  // ── Helper: publish a feedback event ─────────────────────────────────────────

  async publishFeedback({ address, aiVerdict, correction, comment, signals }, peers, bootnodes) {
    const event = this.createEvent('feedback', { address, aiVerdict, correction, comment, signals });
    this.seenHashes.add(event.eventHash); // mark as seen so we don't re-apply our own
    await this.broadcast(event, peers, bootnodes);
    return event;
  }

  async publishWeightUpdate({ method, voteType, vote, stakeWeight, feedback }, peers, bootnodes) {
    const event = this.createEvent('weight_update', { method, voteType, vote, stakeWeight, feedback });
    this.seenHashes.add(event.eventHash);
    await this.broadcast(event, peers, bootnodes);
    return event;
  }
}
