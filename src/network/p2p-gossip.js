/**
 * P2P Gossip — real network broadcast to known peers.
 *
 * Replaces SimpleGossip's local-only pub/sub with actual HTTP delivery.
 * Each message is wrapped in an envelope with a unique ID and TTL so
 * receiving nodes can relay it further without infinite loops.
 *
 * Protocol:
 *   Publisher calls publish(topic, message)
 *     → wraps in envelope { id, topic, message, from, ts, ttl }
 *     → delivers locally via listeners
 *     → POSTs envelope to every known peer's POST /gossip endpoint
 *
 *   Receiving node calls receive(envelope)
 *     → deduplicates by envelope.id
 *     → delivers locally
 *     → if ttl > 1, relays to peers not in the seen-from set (TTL - 1)
 *
 * Peers are provided via a live getter so the gossip layer always uses
 * the current peer list without needing to be re-initialized.
 */

import crypto from 'crypto';

const SEEN_TTL_MS = 5 * 60 * 1000;   // evict seen IDs after 5 min
const DEFAULT_TTL = 4;                 // max hops
const BROADCAST_TIMEOUT_MS = 4000;

export class P2PGossip {
  constructor(nodeId, getPeers) {
    this.nodeId = nodeId;
    this.getPeers = getPeers;          // () => [{ host, walletApiPort, wallet }]
    this.listeners = new Map();        // topic → [handler]
    this.seen = new Map();             // envId → timestamp
    this._evictInterval = setInterval(() => this._evictSeen(), 60_000);
    console.log(`[Gossip] P2P gossip initialized for ${nodeId?.slice(0, 10)}`);
  }

  subscribe(topic, handler) {
    if (!this.listeners.has(topic)) this.listeners.set(topic, []);
    this.listeners.get(topic).push(handler);
  }

  // Publish a new message originating from this node
  async publish(topic, message) {
    const envelope = {
      id: crypto.randomUUID(),
      topic,
      message,
      from: this.nodeId,
      ts: Date.now(),
      ttl: DEFAULT_TTL,
      path: [this.nodeId],  // track relay path for loop avoidance
    };
    this.seen.set(envelope.id, Date.now());
    this._deliverLocal(topic, message, this.nodeId);
    await this._broadcast(envelope, null);
  }

  // Called by the wallet API server when POST /gossip is received from a peer
  async receive(envelope) {
    if (!envelope?.id || !envelope?.topic) return;
    if (this.seen.has(envelope.id)) return;

    this.seen.set(envelope.id, Date.now());
    this._deliverLocal(envelope.topic, envelope.message, envelope.from);

    // Relay with decremented TTL
    if ((envelope.ttl ?? 0) > 1) {
      const relay = {
        ...envelope,
        ttl: envelope.ttl - 1,
        path: [...(envelope.path || []), this.nodeId],
      };
      await this._broadcast(relay, envelope.from);
    }
  }

  _deliverLocal(topic, message, from) {
    const handlers = this.listeners.get(topic) || [];
    for (const h of handlers) {
      try { h(message, from); } catch { /* handler errors must not break gossip */ }
    }
  }

  async _broadcast(envelope, skipWallet) {
    const peers = (this.getPeers?.() || []).filter(p =>
      p.wallet !== skipWallet &&
      !(envelope.path || []).includes(p.wallet)
    );
    if (!peers.length) return;

    await Promise.allSettled(peers.map(peer =>
      this._sendToPeer(peer, envelope)
    ));
  }

  async _sendToPeer(peer, envelope) {
    try {
      const url = `http://${peer.host}:${peer.walletApiPort}/gossip`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), BROADCAST_TIMEOUT_MS);
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
    } catch { /* unreachable peer — silently skip */ }
  }

  _evictSeen() {
    const cutoff = Date.now() - SEEN_TTL_MS;
    for (const [id, ts] of this.seen) {
      if (ts < cutoff) this.seen.delete(id);
    }
  }

  destroy() {
    clearInterval(this._evictInterval);
  }
}
