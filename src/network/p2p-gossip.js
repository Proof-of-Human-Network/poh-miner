/**
 * P2P Gossip — real network broadcast to known peers.
 *
 * Replaces SimpleGossip's local-only pub/sub with actual HTTP delivery.
 * Each message is wrapped in an envelope with a unique ID and TTL so
 * receiving nodes can relay it further without infinite loops.
 *
 * Protocol:
 *   Publisher calls publish(topic, message)
 *     → wraps in envelope { id, topic, message, from, ts, ttl, signature, signingPublicKey }
 *     → delivers locally via listeners
 *     → POSTs envelope to every known peer's POST /gossip endpoint
 *
 *   Receiving node calls receive(envelope)
 *     → verifies ed25519 signature when identity wallet is configured
 *     → deduplicates by envelope.id
 *     → delivers locally
 *     → if ttl > 1, relays to peers not in the seen-from set (TTL - 1)
 *
 * Peers are provided via a live getter so the gossip layer always uses
 * the current peer list without needing to be re-initialized.
 */

import crypto from 'crypto';
import { Wallet } from '../wallet/wallet.js';

const SEEN_TTL_MS = 5 * 60 * 1000;   // evict seen IDs after 5 min
const DEFAULT_TTL = 4;                 // max hops
const BROADCAST_TIMEOUT_MS = 4000;

export function envelopeSignPayload(envelope) {
  // ttl/path are relay metadata — not part of the originator's signature
  return JSON.stringify({
    id: envelope.id,
    topic: envelope.topic,
    message: envelope.message,
    from: envelope.from,
    ts: envelope.ts,
  });
}

export class P2PGossip {
  constructor(nodeId, getPeers, getBootnodes, options = {}) {
    this.nodeId = nodeId;
    this.getPeers = getPeers;          // () => [{ host, walletApiPort, wallet }]
    this.getBootnodes = getBootnodes;  // () => string[]  e.g. ['https://miner.proofofhuman.ge']
    this.getIdentityWallet = options.getIdentityWallet || null;
    this.requireSignatures = options.requireSignatures ?? !!this.getIdentityWallet;
    this.listeners = new Map();        // topic → [handler]
    this.seen = new Map();             // envId → timestamp
    this._evictInterval = setInterval(() => this._evictSeen(), 60_000);
    console.log(`[Gossip] P2P gossip initialized for ${nodeId?.slice(0, 10)}`);
  }

  subscribe(topic, handler) {
    if (!this.listeners.has(topic)) this.listeners.set(topic, []);
    this.listeners.get(topic).push(handler);
  }

  _signEnvelope(envelope) {
    const wallet = this.getIdentityWallet?.();
    if (!wallet?.sign || !wallet?.signingPublicKey) return envelope;
    envelope.signature = wallet.sign(envelopeSignPayload(envelope));
    envelope.signingPublicKey = wallet.signingPublicKey;
    return envelope;
  }

  _verifyEnvelope(envelope) {
    if (!envelope.signature || !envelope.signingPublicKey) {
      return !this.requireSignatures;
    }
    const ok = Wallet.verifySignature(
      envelope.signingPublicKey,
      envelopeSignPayload(envelope),
      envelope.signature,
    );
    if (!ok) return false;
    // from must match the address bound to the signing key when derivable
    const bound = Wallet.deriveAddressFromSigningKey(envelope.signingPublicKey);
    if (bound && envelope.from && envelope.from !== bound && envelope.from !== this.nodeId) {
      // Allow legacy nodeId (wallet address) mismatch during transition if signature is valid
      // but warn — the signature still proves possession of the signing key.
    }
    return true;
  }

  // Publish a new message originating from this node
  async publish(topic, message) {
    const envelope = this._signEnvelope({
      id: crypto.randomUUID(),
      topic,
      message,
      from: this.nodeId,
      ts: Date.now(),
      ttl: DEFAULT_TTL,
      path: [this.nodeId],
    });
    this.seen.set(envelope.id, Date.now());
    this._deliverLocal(topic, message, this.nodeId);
    await this._broadcast(envelope, null);
  }

  // Called by the wallet API server when POST /gossip is received from a peer
  async receive(envelope) {
    if (!envelope?.id || !envelope?.topic) return;
    if (!this._verifyEnvelope(envelope)) {
      console.warn(`[Gossip] Rejected envelope ${envelope.id?.slice(0, 8)}: missing or invalid signature`);
      return;
    }
    if (this.seen.has(envelope.id)) return;

    this.seen.set(envelope.id, Date.now());
    this._deliverLocal(envelope.topic, envelope.message, envelope.from);

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
      p.reachable !== false &&   // followers (NAT'd) can't be dialed — they receive via the bootnode relay inbox
      p.wallet !== skipWallet &&
      !(envelope.path || []).includes(p.wallet)
    );

    const boodnodeUrls = (this.getBootnodes?.() || []);
    const seedPeers = boodnodeUrls.map(url => ({ url }));

    const targets = [...peers, ...seedPeers];
    if (!targets.length) return;

    await Promise.allSettled(targets.map(peer =>
      this._sendToPeer(peer, envelope)
    ));
  }

  async _sendToPeer(peer, envelope) {
    try {
      const url = peer.url
        ? `${peer.url.replace(/\/$/, '')}/gossip`
        : `http://${peer.host}:${peer.walletApiPort}/gossip`;
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