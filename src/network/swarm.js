/**
 * DAISwarm — Hyperswarm transport for peer gossip and chain RPC.
 *
 * Why this exists: the HTTP peer path can only dial nodes that are publicly
 * reachable, and essentially no home node is. Everything therefore had to be
 * relayed through a bootnode, which made that bootnode a hard single point of
 * failure for every packet between every pair of nodes.
 *
 * HyperDHT addresses peers by public key rather than IP and hole-punches a
 * direct UDP path between two nodes that are both behind NAT, anywhere in the
 * world. The pairs punching cannot reach (symmetric NAT, some CGNAT) fall back
 * to a relay automatically. Discovery is a DHT lookup, not a bootnode query.
 *
 * This module is a transport only. It does not verify identity or dedupe:
 * envelopes stay signed and deduped by P2PGossip exactly as over HTTP, so the
 * two transports can run side by side during migration.
 *
 * Wire format: one protomux channel per concern, length-prefixed JSON frames.
 * JSON keeps this readable and matches what the HTTP path already speaks; the
 * framing is binary so a message can never be split across reads.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Hyperswarm from 'hyperswarm';

// Domain separation: the swarm keypair is derived from, but never equal to, the
// wallet signing key. Reusing one ed25519 key across two protocols (message
// signatures and Noise handshakes) invites cross-protocol attacks, and the
// binding we actually care about is proven at the message layer anyway.
const SWARM_KEY_INFO = 'dai-swarm-noise-v1';
const TOPIC_INFO = 'dai-swarm-topic-v1';

const GOSSIP_PROTOCOL = 'dai/gossip/1';
const RPC_PROTOCOL = 'dai/rpc/1';
const RPC_TIMEOUT_MS = 20000;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** Deterministic 32-byte seed from the node's ed25519 signing private key. */
export function deriveSwarmSeed(signingPrivateKey) {
  if (!signingPrivateKey) return null;
  const material = Buffer.from(String(signingPrivateKey), 'utf8');
  return Buffer.from(crypto.hkdfSync('sha256', material, Buffer.alloc(0), Buffer.from(SWARM_KEY_INFO), 32));
}

/** The 32-byte swarm topic every node on the same network joins. */
export function deriveTopic(networkId = 'dai-mainnet') {
  return Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(String(networkId)), Buffer.alloc(0), Buffer.from(TOPIC_INFO), 32),
  );
}

export class DAISwarm {
  /**
   * @param opts.signingPrivateKey  wallet signing key — seeds the swarm identity
   * @param opts.networkId          topic namespace; nodes only meet within one
   * @param opts.bootstrap          DHT bootstrap nodes (omit for the defaults)
   * @param opts.onEnvelope         called with each received gossip envelope
   */
  constructor({ signingPrivateKey, networkId = 'dai-mainnet', bootstrap = null, onEnvelope = null, onRequest = null, nodesFile = null } = {}) {
    this.networkId = networkId;
    this.onEnvelope = onEnvelope;
    // onRequest(path) -> Promise<any>. Lets a peer read our chain directly
    // instead of going through a bootnode's HTTP API.
    this.onRequest = onRequest;
    this._rpcSeq = 0;
    this._pending = new Map(); // rpc id -> { resolve, timer }
    this.topic = deriveTopic(networkId);
    this._seed = deriveSwarmSeed(signingPrivateKey);
    this._bootstrap = bootstrap;
    // Known-good DHT nodes cached on disk. With these, a restart rejoins the
    // network without contacting any bootstrap server at all — bootstrap then
    // only matters for a genuinely first run.
    this._nodesFile = nodesFile;
    this.swarm = null;
    this.connections = new Set();
    this._started = false;
  }

  /** Hex swarm public key — this node's address on the DHT. */
  get publicKey() {
    return this.swarm?.keyPair?.publicKey?.toString('hex') || null;
  }

  get peerCount() {
    return this.connections.size;
  }

  async start() {
    if (this._started) return;
    if (!this._seed) throw new Error('DAISwarm requires a signing private key');
    this._started = true;

    const hcCrypto = (await import('hypercore-crypto')).default;
    const keyPair = hcCrypto.keyPair(this._seed);

    const opts = { keyPair };
    if (this._bootstrap) opts.bootstrap = this._bootstrap;
    const cached = this._loadNodes();
    if (cached.length) {
      opts.nodes = cached;
      console.log(`[Swarm] Seeding DHT from ${cached.length} cached node(s) — no bootstrap needed.`);
    }
    this.swarm = new Hyperswarm(opts);

    this.swarm.on('connection', (conn, info) => this._onConnection(conn, info));

    // server:true so other nodes can find us; client:true so we find them.
    this.discovery = this.swarm.join(this.topic, { server: true, client: true });
    await this.discovery.flushed();
    console.log(`[Swarm] Joined ${this.networkId} as ${this.publicKey?.slice(0, 16)}… (topic ${this.topic.toString('hex').slice(0, 16)}…)`);

    // Refresh the cache periodically so it reflects nodes that are actually
    // responding, not whatever happened to be known at startup. unref() so this
    // timer never holds the process open on shutdown.
    this._persistTimer = setInterval(() => this._saveNodes(), 5 * 60 * 1000);
    this._persistTimer.unref?.();
  }

  /** Read the cached DHT node list. A corrupt or missing file is not an error. */
  _loadNodes() {
    if (!this._nodesFile) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(this._nodesFile, 'utf8'));
      if (!Array.isArray(raw)) return [];
      return raw
        .filter(n => n && typeof n.host === 'string' && Number.isInteger(n.port))
        .slice(0, 100);
    } catch { return []; }
  }

  _saveNodes() {
    if (!this._nodesFile || !this.swarm?.dht) return;
    try {
      const nodes = this.swarm.dht.toArray().slice(0, 100);
      if (!nodes.length) return;   // never overwrite a good cache with nothing
      fs.mkdirSync(path.dirname(this._nodesFile), { recursive: true });
      fs.writeFileSync(this._nodesFile, JSON.stringify(nodes));
    } catch { /* cache is best-effort */ }
  }

  _onConnection(conn, info) {
    this.connections.add(conn);
    const remote = conn.remotePublicKey?.toString('hex').slice(0, 16) || 'unknown';
    console.log(`[Swarm] Peer connected: ${remote}… (${this.connections.size} total)`);

    conn.on('error', () => { /* a dropped peer is normal; cleanup runs on close */ });
    conn.on('close', () => {
      this.connections.delete(conn);
      console.log(`[Swarm] Peer disconnected: ${remote}… (${this.connections.size} total)`);
    });

    this._readFrames(conn);
  }

  /**
   * Length-prefixed frame reader. A stream read can deliver a partial message or
   * several at once, so frames are reassembled from a running buffer rather than
   * assuming one read equals one message.
   */
  _readFrames(conn) {
    let buf = Buffer.alloc(0);
    conn.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        // A corrupt or hostile length would otherwise let one peer pin unbounded memory.
        if (len > MAX_FRAME_BYTES) { conn.destroy(); return; }
        if (buf.length < 4 + len) break;
        const frame = buf.subarray(4, 4 + len);
        buf = buf.subarray(4 + len);
        this._handleFrame(conn, frame);
      }
    });
  }

  _handleFrame(conn, frame) {
    let msg;
    try { msg = JSON.parse(frame.toString('utf8')); }
    catch { return; } // malformed frame — ignore, keep the connection
    if (msg?.protocol === GOSSIP_PROTOCOL && msg.envelope) {
      try { this.onEnvelope?.(msg.envelope, conn); }
      catch { /* handler errors must not kill the transport */ }
      return;
    }
    if (msg?.protocol === RPC_PROTOCOL && msg.rpc) this._handleRpc(conn, msg.rpc);
  }

  _handleRpc(conn, rpc) {
    // A reply to something we asked for.
    if (rpc.res) {
      const waiting = this._pending.get(rpc.id);
      if (!waiting) return; // already timed out
      clearTimeout(waiting.timer);
      this._pending.delete(rpc.id);
      waiting.resolve(rpc.ok ? rpc.body : null);
      return;
    }
    // A request from a peer. Always answer, even on failure, so the caller
    // fails fast instead of waiting out its timeout.
    if (!rpc.path) return;
    Promise.resolve()
      .then(() => this.onRequest?.(rpc.path))
      .then(body => ({ ok: body != null, body: body ?? null }))
      .catch(() => ({ ok: false, body: null }))
      .then(({ ok, body }) => {
        try { conn.write(this._frame({ protocol: RPC_PROTOCOL, rpc: { id: rpc.id, res: true, ok, body } })); }
        catch { /* peer vanished mid-reply */ }
      });
  }

  /** Ask one connected peer for `path`. Resolves null on failure or timeout. */
  request(conn, path, timeoutMs = RPC_TIMEOUT_MS) {
    return new Promise((resolve) => {
      const id = `${++this._rpcSeq}`;
      // A peer that never replies must not leak this entry forever.
      const timer = setTimeout(() => { this._pending.delete(id); resolve(null); }, timeoutMs);
      this._pending.set(id, { resolve, timer });
      try {
        conn.write(this._frame({ protocol: RPC_PROTOCOL, rpc: { id, path } }));
      } catch {
        clearTimeout(timer);
        this._pending.delete(id);
        resolve(null);
      }
    });
  }

  /** Connected peers as sync candidates, each able to serve chain reads. */
  syncCandidates() {
    return [...this.connections].map(conn => ({
      label: `swarm:${conn.remotePublicKey?.toString('hex').slice(0, 8) || '?'}`,
      swarm: true,
      get: (path, timeoutMs) => this.request(conn, path, timeoutMs),
    }));
  }

  _frame(obj) {
    const body = Buffer.from(JSON.stringify(obj), 'utf8');
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length, 0);
    return Buffer.concat([head, body]);
  }

  /**
   * Send an envelope to every connected peer except `skipConn` (the peer it came
   * from). Returns how many peers it was written to.
   */
  broadcast(envelope, skipConn = null) {
    if (!this.connections.size) return 0;
    const frame = this._frame({ protocol: GOSSIP_PROTOCOL, envelope });
    let sent = 0;
    for (const conn of this.connections) {
      if (conn === skipConn) continue;
      try { conn.write(frame); sent++; }
      catch { /* peer went away mid-write; its close handler cleans up */ }
    }
    return sent;
  }

  async destroy() {
    if (!this.swarm) return;
    clearInterval(this._persistTimer);
    this._saveNodes();   // capture a fresh cache on the way down
    try { await this.swarm.destroy(); } catch { /* already down */ }
    this.connections.clear();
    this.swarm = null;
    this._started = false;
  }
}
