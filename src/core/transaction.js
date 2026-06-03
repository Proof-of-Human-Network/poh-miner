/**
 * PoH Formal Transaction — account-model with nonces.
 *
 * Double-spend protection in an account model requires:
 *   1. Nonces  — each account has a monotonically increasing tx counter.
 *      A tx is valid only if tx.nonce === account.nonce + 1.
 *      This prevents replay attacks (same signed tx submitted twice).
 *
 *   2. Pending balance lock — when a tx enters the mempool, its amount
 *      is "locked" so the sender cannot spend the same coins in a second
 *      concurrent tx before the first is mined.
 *
 *   3. Signature — only the holder of the private key can produce a valid
 *      signature over (from, to, amount, fee, nonce, timestamp).
 *
 * This matches Ethereum's account-nonce model (not Bitcoin's UTXO model).
 */

import crypto from 'crypto';
import { Wallet } from '../wallet/wallet.js';

export class PoHTransaction {
  constructor({ from, to, amount, fee = 0, nonce, timestamp, memo = '', txHash, signature, signingPublicKey }) {
    this.from      = from;
    this.to        = to;
    this.amount    = amount;   // μPOH
    this.fee       = fee;      // μPOH paid to block proposer
    this.nonce     = nonce;    // sender's account nonce at submission time
    this.timestamp = timestamp || Date.now();
    this.memo      = memo;
    this.signature        = signature || null;
    this.signingPublicKey = signingPublicKey || null;
    this.txHash = txHash || this._computeHash();
  }

  _computeHash() {
    const payload = JSON.stringify({
      from: this.from,
      to: this.to,
      amount: this.amount,
      fee: this.fee,
      nonce: this.nonce,
      timestamp: this.timestamp,
      memo: this.memo,
    });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  sign(identityWallet) {
    this.signature        = identityWallet.sign(this.txHash);
    this.signingPublicKey = identityWallet.signingPublicKey;
    return this;
  }

  verify() {
    if (!this.signature || !this.signingPublicKey) return false;
    return Wallet.verifySignature(this.signingPublicKey, this.txHash, this.signature);
  }

  toJSON() { return { ...this }; }

  static fromJSON(data) {
    return new PoHTransaction(data);
  }
}

/**
 * TxMempool — pending transaction pool with nonce + balance validation.
 *
 * Maintains a pendingOut map so a sender's available balance is reduced
 * immediately on tx submission, preventing concurrent double-spends even
 * before the tx is mined.
 */
export class TxMempool {
  constructor(walletManager) {
    this.walletManager = walletManager;
    this.txs = new Map();            // txHash → PoHTransaction
    this.pendingOut = new Map();     // address → total μPOH locked in mempool
    this.accountPendingNonce = new Map(); // address → highest pending nonce
  }

  // Returns true and adds to pool, or returns { error } string on rejection.
  submit(tx) {
    if (!(tx instanceof PoHTransaction)) tx = PoHTransaction.fromJSON(tx);

    if (this.txs.has(tx.txHash)) return { error: 'duplicate tx' };
    if (!tx.verify())             return { error: 'invalid signature' };
    if (tx.amount <= 0)           return { error: 'amount must be positive' };

    // Nonce check: must equal current confirmed nonce + 1 + any pending nonces
    const confirmedNonce  = this.walletManager.getNonce(tx.from);
    const highestPending  = this.accountPendingNonce.get(tx.from) ?? confirmedNonce;
    if (tx.nonce !== highestPending + 1) {
      return { error: `invalid nonce: expected ${highestPending + 1}, got ${tx.nonce}` };
    }

    // Balance check: confirmed balance minus already-locked pending outgoing
    const confirmed  = this.walletManager.getBalance(tx.from);
    const locked     = this.pendingOut.get(tx.from) || 0;
    const available  = confirmed - locked;
    if (available < tx.amount + tx.fee) {
      return { error: `insufficient balance: available ${available}, need ${tx.amount + tx.fee}` };
    }

    this.txs.set(tx.txHash, tx);
    this.pendingOut.set(tx.from, locked + tx.amount + tx.fee);
    this.accountPendingNonce.set(tx.from, tx.nonce);
    return true;
  }

  // Called when a block is applied — remove mined txs, release locks
  onBlockApplied(txHashes) {
    for (const hash of txHashes) {
      const tx = this.txs.get(hash);
      if (!tx) continue;
      this.txs.delete(hash);
      const locked = this.pendingOut.get(tx.from) || 0;
      this.pendingOut.set(tx.from, Math.max(0, locked - tx.amount - tx.fee));
    }
    // Recompute highest pending nonces
    this.accountPendingNonce.clear();
    for (const tx of this.txs.values()) {
      const cur = this.accountPendingNonce.get(tx.from) ?? 0;
      if (tx.nonce > cur) this.accountPendingNonce.set(tx.from, tx.nonce);
    }
  }

  // Return txs ordered by fee desc (highest priority first)
  getPending(limit = 50) {
    return [...this.txs.values()]
      .sort((a, b) => b.fee - a.fee)
      .slice(0, limit);
  }

  size() { return this.txs.size; }
}
