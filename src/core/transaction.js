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
  constructor({ from, to, amount, fee = 0, nonce, timestamp, memo = '', currency, txHash, signature, signingPublicKey }) {
    this.from      = from;
    this.to        = to;
    this.amount    = amount;   // raw units of `currency` (μPOH when POH)
    this.fee       = fee;      // raw units of `currency`, paid to block proposer
    this.nonce     = nonce;    // sender's account nonce at submission time
    this.timestamp = timestamp || Date.now();
    this.memo      = memo;
    // Asset ticker. POH (or absent) means the native asset; normalized so the
    // field NEVER appears as 'POH' explicitly — it is simply omitted, keeping
    // every historical tx hash and signature byte-identical.
    this.currency  = (currency && currency !== 'POH') ? currency : undefined;
    this.signature        = signature || null;
    this.signingPublicKey = signingPublicKey || null;
    this.txHash = txHash || this._computeHash();
  }

  _computeHash() {
    // KEEP IN SYNC with computeTxFieldsHash (src/wallet/wallet.js), the mobile
    // wallet signer and SDK signers. `currency` enters the preimage ONLY when
    // non-POH (appended after memo) — legacy POH txs hash exactly as before.
    const payload = JSON.stringify({
      from: this.from,
      to: this.to,
      amount: this.amount,
      fee: this.fee,
      nonce: this.nonce,
      timestamp: this.timestamp,
      memo: this.memo,
      ...(this.currency ? { currency: this.currency } : {}),
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
    // The signature only proves the signer signed *some* hash string — it says nothing
    // about whether that hash matches this transaction's real from/to/amount/fee/nonce/
    // timestamp/memo. Recompute and compare first, or a forged tx could reuse a valid
    // signature+hash pair lifted from a smaller/differently-routed past transaction by
    // the same sender while carrying an attacker-chosen amount/recipient.
    if (this.txHash !== this._computeHash()) return false;
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
  constructor(walletManager, getLedger = null) {
    this.walletManager = walletManager;
    // Optional accessor for the canonical in-memory ledger. When set, confirmed
    // balance/nonce come from it (never drifts from the chain) instead of the
    // per-wallet cache files, keeping submit validation consistent with what
    // /api/wallet/balance and /nonce report.
    this.getLedger = getLedger;
    this.txs = new Map();            // txHash → PoHTransaction
    // "address:currency" → total raw units locked in mempool. Per-asset keying so
    // a pending aiGEL send never locks the sender's POH (and vice versa).
    this.pendingOut = new Map();
    this.accountPendingNonce = new Map(); // address → highest pending nonce
    this.spentTxHashes = new Set();  // txHashes already mined on canonical chain
  }

  static _cur(tx) { return tx.currency || 'POH'; }
  static _lockKey(address, currency) { return `${address}:${currency || 'POH'}`; }

  _confirmedNonce(address) {
    const ledger = this.getLedger?.();
    return ledger ? ledger.getNonce(address) : this.walletManager.getNonce(address);
  }

  _confirmedBalance(address, currency = 'POH') {
    const ledger = this.getLedger?.();
    if (ledger) return ledger.getBalance(address, currency);
    return currency === 'POH'
      ? this.walletManager.getBalance(address)
      : this.walletManager.getAssetBalance(address, currency);
  }

  setSpentTxHashes(hashes) {
    this.spentTxHashes = new Set(hashes || []);
    this._purgeSpent();
  }

  markSpent(txHashes) {
    for (const h of txHashes || []) {
      if (h) this.spentTxHashes.add(h);
    }
    this._purgeSpent();
  }

  _purgeSpent() {
    for (const hash of [...this.txs.keys()]) {
      if (this.spentTxHashes.has(hash)) {
        const tx = this.txs.get(hash);
        this.txs.delete(hash);
        if (tx) {
          const key = TxMempool._lockKey(tx.from, TxMempool._cur(tx));
          const locked = this.pendingOut.get(key) || 0;
          this.pendingOut.set(key, Math.max(0, locked - tx.amount - tx.fee));
        }
      }
    }
    this.accountPendingNonce.clear();
    for (const tx of this.txs.values()) {
      const cur = this.accountPendingNonce.get(tx.from) ?? 0;
      if (tx.nonce > cur) this.accountPendingNonce.set(tx.from, tx.nonce);
    }
  }

  // Returns true and adds to pool, or returns { error } string on rejection.
  submit(tx) {
    if (!(tx instanceof PoHTransaction)) tx = PoHTransaction.fromJSON(tx);

    if (this.spentTxHashes.has(tx.txHash)) return { error: 'tx already mined' };
    if (this.txs.has(tx.txHash)) return { error: 'duplicate tx' };
    if (!tx.verify())             return { error: 'invalid signature' };
    if (tx.amount <= 0)           return { error: 'amount must be positive' };

    // Nonce check: must equal current confirmed nonce + 1 + any pending nonces
    const confirmedNonce  = this._confirmedNonce(tx.from);
    const highestPending  = this.accountPendingNonce.get(tx.from) ?? confirmedNonce;
    if (tx.nonce !== highestPending + 1) {
      return { error: `invalid nonce: expected ${highestPending + 1}, got ${tx.nonce}` };
    }

    // Balance check: confirmed balance minus already-locked pending outgoing,
    // in the transaction's own currency.
    const cur        = TxMempool._cur(tx);
    const key        = TxMempool._lockKey(tx.from, cur);
    const confirmed  = this._confirmedBalance(tx.from, cur);
    const locked     = this.pendingOut.get(key) || 0;
    const available  = confirmed - locked;
    if (available < tx.amount + tx.fee) {
      return { error: `insufficient balance: available ${available} ${cur}, need ${tx.amount + tx.fee}` };
    }

    this.txs.set(tx.txHash, tx);
    this.pendingOut.set(key, locked + tx.amount + tx.fee);
    this.accountPendingNonce.set(tx.from, tx.nonce);
    return true;
  }

  // Called when a block is applied — remove mined txs, release locks
  onBlockApplied(txHashes) {
    for (const hash of txHashes) {
      const tx = this.txs.get(hash);
      if (!tx) continue;
      this.txs.delete(hash);
      const key = TxMempool._lockKey(tx.from, TxMempool._cur(tx));
      const locked = this.pendingOut.get(key) || 0;
      this.pendingOut.set(key, Math.max(0, locked - tx.amount - tx.fee));
    }
    // Recompute highest pending nonces
    this.accountPendingNonce.clear();
    for (const tx of this.txs.values()) {
      const cur = this.accountPendingNonce.get(tx.from) ?? 0;
      if (tx.nonce > cur) this.accountPendingNonce.set(tx.from, tx.nonce);
    }
  }

  // Return txs ordered by fee desc (highest priority first), excluding already-mined hashes.
  getPending(limit = 50) {
    return [...this.txs.values()]
      .filter(tx => !this.spentTxHashes.has(tx.txHash))
      .sort((a, b) => b.fee - a.fee)
      .slice(0, limit);
  }

  size() { return this.txs.size; }
}
