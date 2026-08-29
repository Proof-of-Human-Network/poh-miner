/**
 * PairingRelay — ephemeral rendezvous for browser ↔ signer sessions.
 *
 * aist.exchange runs in a browser, which must never hold a DAI signing key: the
 * same key signs on-chain transfers and authorises escrow release, so one XSS
 * would be total loss. Instead the browser keeps a throwaway session key and
 * asks a real signer (the mobile wallet, or the user's own desktop node) to sign
 * each action. This class is the postbox those two sides use to find each other.
 *
 * The relay is deliberately dumb and untrusted:
 *   - Payloads are sealed to the session key. The relay cannot read them.
 *   - The topic IS the capability. It must be 32 random bytes, supplied by the
 *     browser and transferred out-of-band (QR code or connection link).
 *   - Nothing is authenticated, because there is no identity yet — that is the
 *     chicken-and-egg this exists to solve.
 *
 * Being unauthenticated makes this a denial-of-service surface, so every
 * dimension is capped: topic count, messages per topic, payload size, and age.
 * Bounds are enforced on write, and expiry is checked lazily on access so a
 * quiet node does no periodic work.
 */

const TOPIC_RE = /^[0-9a-f]{64}$/;

// Worst-case memory is the product of these three, so they are chosen together:
// 500 x 16 x 8KB = 64MB if every slot on the node were filled by an attacker.
export const PAIRING_LIMITS = {
  MAX_TOPICS: 500,           // total concurrent sessions this node will host
  MAX_MESSAGES: 16,          // per topic; a handshake needs a handful
  MAX_PAYLOAD_BYTES: 8 * 1024, // a sealed auth payload is ~1KB; 8KB is generous
  TTL_MS: 10 * 60 * 1000,    // idle topics are dropped
  MAX_WAIT_MS: 25 * 1000,    // long-poll ceiling, kept under proxy read timeouts
};

export class PairingRelay {
  constructor(limits = {}) {
    this.limits = { ...PAIRING_LIMITS, ...limits };
    this.topics = new Map(); // topic -> { messages: [{seq, from, payload, ts}], seq, updatedAt }
    this._waiters = new Map(); // topic -> Set<resolve>
  }

  static isValidTopic(topic) {
    return typeof topic === 'string' && TOPIC_RE.test(topic);
  }

  /** Drop topics that have gone idle past the TTL. Called on every access. */
  _sweep() {
    const cutoff = Date.now() - this.limits.TTL_MS;
    for (const [topic, entry] of this.topics) {
      if (entry.updatedAt < cutoff) {
        this.topics.delete(topic);
        this._wake(topic); // release any long-poll still parked on it
      }
    }
  }

  _wake(topic) {
    const set = this._waiters.get(topic);
    if (!set) return;
    for (const resolve of set) { try { resolve(); } catch { /* ignore */ } }
    this._waiters.delete(topic);
  }

  /**
   * Append one sealed message. Returns { error } rather than throwing so the
   * HTTP layer can map failures to status codes without a try/catch.
   */
  publish(topic, from, payload) {
    if (!PairingRelay.isValidTopic(topic)) return { error: 'topic must be 64 hex chars' };
    if (from !== 'browser' && from !== 'signer') return { error: 'from must be browser or signer' };
    if (typeof payload !== 'string' || !payload) return { error: 'payload required' };
    if (Buffer.byteLength(payload, 'utf8') > this.limits.MAX_PAYLOAD_BYTES) {
      return { error: 'payload too large' };
    }

    this._sweep();

    let entry = this.topics.get(topic);
    if (!entry) {
      // Refuse new topics rather than evicting live ones: dropping an existing
      // session to admit an attacker's would turn a flood into a way to break
      // other people's pairings.
      if (this.topics.size >= this.limits.MAX_TOPICS) return { error: 'relay at capacity' };
      entry = { messages: [], seq: 0, updatedAt: Date.now() };
      this.topics.set(topic, entry);
    }

    entry.seq += 1;
    entry.messages.push({ seq: entry.seq, from, payload, ts: Date.now() });
    if (entry.messages.length > this.limits.MAX_MESSAGES) entry.messages.shift();
    entry.updatedAt = Date.now();

    this._wake(topic);
    return { ok: true, seq: entry.seq };
  }

  /** Messages newer than `since`. Never returns the caller's own side back. */
  poll(topic, since = 0, exclude = null) {
    if (!PairingRelay.isValidTopic(topic)) return { error: 'topic must be 64 hex chars' };
    this._sweep();
    const entry = this.topics.get(topic);
    if (!entry) return { messages: [], seq: 0 };
    const messages = entry.messages
      .filter(m => m.seq > since && (!exclude || m.from !== exclude));
    return { messages, seq: entry.seq };
  }

  /**
   * Long-poll: resolve as soon as something newer arrives, or after `waitMs`.
   * Keeps the browser from hammering the node between handshake steps.
   */
  async wait(topic, since = 0, waitMs = 25000, exclude = null) {
    const first = this.poll(topic, since, exclude);
    if (first.error || first.messages.length) return first;

    const capped = Math.min(Math.max(0, waitMs), this.limits.MAX_WAIT_MS);
    await new Promise((resolve) => {
      const timer = setTimeout(() => { cleanup(); resolve(); }, capped);
      const done = () => { clearTimeout(timer); cleanup(); resolve(); };
      const cleanup = () => this._waiters.get(topic)?.delete(done);
      if (!this._waiters.has(topic)) this._waiters.set(topic, new Set());
      this._waiters.get(topic).add(done);
    });
    return this.poll(topic, since, exclude);
  }

  /** Explicit teardown when a session ends, so keys aren't left sitting around. */
  close(topic) {
    const existed = this.topics.delete(topic);
    this._wake(topic);
    return { ok: true, existed };
  }

  stats() {
    this._sweep();
    let messages = 0;
    for (const e of this.topics.values()) messages += e.messages.length;
    return { topics: this.topics.size, messages, limits: this.limits };
  }
}
