/**
 * Published Signals Transaction (future on-chain mechanism)
 *
 * When a new verified signal/method is accepted on proofofhuman.ge,
 * it can be emitted as a "published signals transaction".
 *
 * Miners include these in blocks via `stateTransitions`.
 * This provides a decentralized, fault-tolerant source of truth
 * for the exact set of signals every miner must use.
 *
 * Format (proposed):
 * {
 *   type: 'methods-update' | 'methods-weight-update',
 *   hash: string,                    // deterministic hash of the methods array
 *   count: number,
 *   source: 'proofofhuman.ge' | 'governance',
 *   timestamp: number,
 *   signature?: string,              // optional governance signature
 *   cid?: string,                    // IPFS CID of the full list (future)
 * }
 */

export class SignalsTransaction {
  constructor({ type, hash, count, source, timestamp, signature, cid }) {
    this.type = type;
    this.hash = hash;
    this.count = count;
    this.source = source;
    this.timestamp = timestamp || Date.now();
    this.signature = signature;
    this.cid = cid;
  }
}

export default SignalsTransaction;
