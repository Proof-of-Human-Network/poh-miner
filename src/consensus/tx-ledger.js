/**
 * Canonical transaction ledger — replays coinbase + transfers with spent-tx dedup.
 *
 * Invariant: sum(all wallet balances) === sum(coinbase.totalNewSupply) across the chain.
 * Fees are zero-sum (sender → miner) and do not change total supply.
 */

import { DAITransaction } from '../core/transaction.js';
import { Wallet, computeTxFieldsHash } from '../wallet/wallet.js';
import { ESCROW_ADDRESS } from '../p2p/escrow.js';
import { p2pTransitionKey } from '../p2p/transitions.js';
import { normalizeCurrency, isKnownAsset, STABLE_TICKERS } from '../assets.js';

export class TxLedgerState {
  constructor() {
    /** @type {Map<string, number>} DAI balances (μDAI) */
    this.balances = new Map();
    /** @type {Map<string, Map<string, number>>} ticker → (address → raw units). Non-DAI assets only. */
    this.assetBalances = new Map();
    /** @type {Map<string, number>} */
    this.nonces = new Map();
    /** @type {Map<string, string>} */
    this.signingKeys = new Map();
    this.spentTxHashes = new Set();
    /** @type {Set<string>} p2pTransitionKey values already applied (idempotent replay). */
    this.appliedP2PKeys = new Set();
    this.totalMinted = 0;
    /** @type {Map<string, number>} ticker → total raw units minted (genesis allocations only) */
    this.totalMintedAssets = new Map();
    /** μDAI minted in coinbase but not credited due to historical floor-division splits */
    this.coinbaseDust = 0;
  }

  clone() {
    const copy = new TxLedgerState();
    copy.balances = new Map(this.balances);
    copy.assetBalances = new Map([...this.assetBalances].map(([t, m]) => [t, new Map(m)]));
    copy.nonces = new Map(this.nonces);
    copy.signingKeys = new Map(this.signingKeys);
    copy.spentTxHashes = new Set(this.spentTxHashes);
    copy.appliedP2PKeys = new Set(this.appliedP2PKeys);
    copy.totalMinted = this.totalMinted;
    copy.totalMintedAssets = new Map(this.totalMintedAssets);
    copy.coinbaseDust = this.coinbaseDust;
    return copy;
  }

  getBalance(address, currency = 'DAI') {
    const cur = normalizeCurrency(currency);
    if (cur === 'DAI') return this.balances.get(address) || 0;
    const m = this.assetBalances.get(cur);
    return m ? (m.get(address) || 0) : 0;
  }

  /** All non-DAI holdings for an address: { ticker: rawInt } (only non-zero). */
  getAssetBalances(address) {
    const out = {};
    for (const [t, m] of this.assetBalances) {
      const v = m.get(address) || 0;
      if (v > 0) out[t] = v;
    }
    return out;
  }

  getNonce(address) {
    return this.nonces.get(address) || 0;
  }

  _credit(address, amount, currency = 'DAI') {
    if (!address || amount <= 0) return;
    const cur = normalizeCurrency(currency);
    if (cur === 'DAI') {
      this.balances.set(address, (this.balances.get(address) || 0) + amount);
      return;
    }
    let m = this.assetBalances.get(cur);
    if (!m) { m = new Map(); this.assetBalances.set(cur, m); }
    m.set(address, (m.get(address) || 0) + amount);
  }

  _debit(address, amount, currency = 'DAI') {
    if (!address || amount <= 0) return true;
    const bal = this.getBalance(address, currency);
    if (bal < amount) return false;
    const cur = normalizeCurrency(currency);
    if (cur === 'DAI') this.balances.set(address, bal - amount);
    else this.assetBalances.get(cur).set(address, bal - amount);
    return true;
  }

  applyCoinbase(block) {
    const coinbase = block.coinbaseReward;
    if (!coinbase || !block.minerWallet) return;

    let credited = 0;
    if (coinbase.totalNewSupply > 0) {
      this.totalMinted += coinbase.totalNewSupply;
    }
    if (coinbase.proposerReward > 0) {
      this._credit(block.minerWallet, coinbase.proposerReward);
      credited += coinbase.proposerReward;
    }
    for (const worker of (coinbase.workerRewards || [])) {
      if (worker.workerId && worker.amount > 0) {
        this._credit(worker.workerId, worker.amount);
        credited += worker.amount;
      }
    }
    const dust = (coinbase.totalNewSupply || 0) - credited;
    if (dust > 0) this.coinbaseDust += dust;
  }

  /**
   * Validate and apply a single transfer. Returns { valid, reason?, tx? }.
   */
  validateAndApplyTransaction(txData) {
    let tx;
    try {
      tx = txData instanceof DAITransaction ? txData : DAITransaction.fromJSON(txData);
    } catch {
      return { valid: false, reason: 'malformed transaction' };
    }

    if (!tx.txHash) {
      return { valid: false, reason: 'missing txHash' };
    }

    if (this.spentTxHashes.has(tx.txHash)) {
      return { valid: false, reason: `tx already spent (${tx.txHash.slice(0, 12)})` };
    }

    // Cheap structural checks first (fields + currency), then crypto.
    if (!tx.from || !tx.to || tx.amount <= 0) {
      return { valid: false, reason: 'invalid tx fields' };
    }

    const txCur = normalizeCurrency(tx.currency);
    if (txCur !== 'DAI' && !isKnownAsset(txCur)) {
      return { valid: false, reason: `unknown currency ${txCur}` };
    }

    if (!tx.verify()) {
      return { valid: false, reason: 'invalid tx signature' };
    }

    if (tx.txHash !== computeTxFieldsHash(tx)) {
      return { valid: false, reason: 'txHash does not match transaction fields' };
    }

    const expectedNonce = this.getNonce(tx.from) + 1;
    if (tx.nonce !== expectedNonce) {
      return { valid: false, reason: `invalid nonce: expected ${expectedNonce}, got ${tx.nonce}` };
    }

    if (!tx.signingPublicKey) {
      return { valid: false, reason: 'missing signing public key' };
    }

    const knownKey = this.signingKeys.get(tx.from);
    if (knownKey) {
      if (tx.signingPublicKey !== knownKey) {
        return { valid: false, reason: 'signing key mismatch' };
      }
      if (!Wallet.verifySignature(knownKey, tx.txHash, tx.signature)) {
        return { valid: false, reason: 'invalid signature' };
      }
    } else if (!Wallet.verifySignature(tx.signingPublicKey, tx.txHash, tx.signature)) {
      return { valid: false, reason: 'invalid signature' };
    } else {
      // First seen sender — bind the signing key (matches WalletManager stub registration).
      this.signingKeys.set(tx.from, tx.signingPublicKey);
    }

    const total = tx.amount + (tx.fee || 0);
    if (this.getBalance(tx.from, txCur) < total) {
      return { valid: false, reason: 'insufficient balance' };
    }

    this._debit(tx.from, total, txCur);
    this.nonces.set(tx.from, tx.nonce);
    this._credit(tx.to, tx.amount, txCur);
    this.spentTxHashes.add(tx.txHash);

    return { valid: true, tx };
  }

  /**
   * Replay coinbase + block transactions.
   * strict=true rejects the block if any tx is invalid/replayed.
   * strict=false skips invalid txs (for rebuilding balances from legacy spam blocks).
   * skipVerify=true skips crypto signature checks — safe for chain replay where txs
   *   are already validated on chain; avoids 100k+ crypto ops on startup.
   */
  /**
   * Migration genesis: credit each snapshotted balance and seed its nonce, minting
   * exactly the distributed total. Makes the carried-over balances canonical ledger
   * state (survives _rebuildBalancesFromChain), unlike config.genesisAlloc which is
   * applied outside the ledger and wiped on rebuild.
   */
  applyGenesisAllocations(block) {
    const allocs = block.genesisAllocations;
    if (!Array.isArray(allocs) || !allocs.length) return;
    for (const a of allocs) {
      if (!a || !a.address) continue;
      const bal = Number(a.balance) || 0;
      if (bal > 0) { this._credit(a.address, bal); this.totalMinted += bal; }
      // Per-asset allocations (stablecoin genesis mint to the treasury).
      // The ONLY place non-DAI supply enters the ledger — no runtime mint.
      if (a.assets && typeof a.assets === 'object') {
        for (const [ticker, rawV] of Object.entries(a.assets)) {
          const v = Number(rawV) || 0;
          if (v <= 0) continue;
          this._credit(a.address, v, ticker);
          this.totalMintedAssets.set(ticker, (this.totalMintedAssets.get(ticker) || 0) + v);
        }
      }
      const nonce = Number(a.nonce) || 0;
      if (nonce > 0) this.nonces.set(a.address, nonce);
    }
  }

  applyBlock(block, { strict = true, skipVerify = false } = {}) {
    this.applyGenesisAllocations(block);
    this.applyCoinbase(block);

    for (const txData of (block.transactions || [])) {
      const result = skipVerify
        ? this._applyTransactionTrusted(txData)
        : this.validateAndApplyTransaction(txData);
      if (!result.valid) {
        if (strict) {
          return {
            valid: false,
            reason: `block #${block.height} tx invalid: ${result.reason}`,
          };
        }
        continue;
      }
      const { tx } = result;
      if (tx.fee > 0 && block.minerWallet) {
        // Fee accrues in the tx's own currency — the miner receives what was paid.
        this._credit(block.minerWallet, tx.fee, normalizeCurrency(tx.currency));
      }
    }

    return { valid: true };
  }

  /** Apply a transaction without signature/hash verification — only for chain replay. */
  _applyTransactionTrusted(txData) {
    let tx;
    try {
      tx = txData instanceof DAITransaction ? txData : DAITransaction.fromJSON(txData);
    } catch {
      return { valid: false, reason: 'malformed transaction' };
    }
    if (!tx.from || !tx.to || tx.amount <= 0) return { valid: false, reason: 'invalid tx fields' };
    if (this.spentTxHashes.has(tx.txHash)) return { valid: false, reason: 'already spent' };
    const txCur = normalizeCurrency(tx.currency);
    const total = tx.amount + (tx.fee || 0);
    if (this.getBalance(tx.from, txCur) < total) return { valid: false, reason: 'insufficient balance' };
    this._debit(tx.from, total, txCur);
    this.nonces.set(tx.from, tx.nonce);
    if (tx.signingPublicKey) this.signingKeys.set(tx.from, tx.signingPublicKey);
    this._credit(tx.to, tx.amount, txCur);
    this.spentTxHashes.add(tx.txHash);
    return { valid: true, tx };
  }

  applyP2PEscrowTransition(t) {
    const key = p2pTransitionKey(t);
    if (key && this.appliedP2PKeys.has(key)) return true;
    // Legacy transitions carry no baseAsset → DAI. New ones set it when non-DAI.
    const base = normalizeCurrency(t.baseAsset);
    if (t.type === 'p2p-order-created' && t.side === 'sell' && t.escrowLocked) {
      if (!this._debit(t.maker, t.daiAmount, base)) return false;
      this._credit(ESCROW_ADDRESS, t.daiAmount, base);
    } else if (t.type === 'p2p-order-cancelled' && t.side === 'sell' && t.escrowLocked) {
      if (!this._debit(ESCROW_ADDRESS, t.daiAmount, base)) return false;
      this._credit(t.maker, t.daiAmount, base);
    } else if (t.type === 'p2p-trade-created' && t.orderSide === 'buy') {
      if (!this._debit(t.taker, t.daiAmount, base)) return false;
      this._credit(ESCROW_ADDRESS, t.daiAmount, base);
    } else if (t.type === 'p2p-trade-release') {
      const totalFromEscrow = t.daiAmount + (t.referralFee || 0);
      if (!this._debit(ESCROW_ADDRESS, totalFromEscrow, base)) return false;
      this._credit(t.recipient, t.daiAmount, base);
      if (t.referralFee > 0 && t.referrer) this._credit(t.referrer, t.referralFee, base);
    } else if (t.type === 'p2p-trade-cancel' && t.escrowLocked) {
      if (!this._debit(ESCROW_ADDRESS, t.daiAmount, base)) return false;
      this._credit(t.locker, t.daiAmount, base);
    } else if (t.type === 'p2p-swap-filled') {
      // Atomic on-chain swap: base leg sits in escrow (locked at order create);
      // quote leg moves taker → maker in the same transition. ALL legs must
      // succeed or the whole transition is a no-op (validated before mutating).
      const quote = normalizeCurrency(t.quoteAsset);
      const refFee = t.referralFee || 0;
      const escrowNeeded = (t.baseAmount || 0);
      if (!(t.baseAmount > 0) || !(t.quoteAmount > 0)) return false;
      if (this.getBalance(ESCROW_ADDRESS, base) < escrowNeeded) return false;
      if (this.getBalance(t.taker, quote) < t.quoteAmount) return false;
      // Mutate only after every precondition passed → atomicity.
      this._debit(t.taker, t.quoteAmount, quote);
      this._credit(t.quoteRecipient || t.maker, t.quoteAmount, quote);
      this._debit(ESCROW_ADDRESS, escrowNeeded, base);
      this._credit(t.baseRecipient || t.taker, escrowNeeded - refFee, base);
      if (refFee > 0 && t.referrer) this._credit(t.referrer, refFee, base);
    }
    if (key) this.appliedP2PKeys.add(key);
    return true;
  }

  totalBalances() {
    let sum = 0;
    for (const v of this.balances.values()) sum += v;
    return sum;
  }

  /** Active wallets = any address with balance > 0 or nonce > 0 */
  activeWalletCount() {
    const addrs = new Set([...this.balances.keys(), ...this.nonces.keys()]);
    return addrs.size;
  }

  /**
   * Supply invariant: credited balances + historical coinbase dust === total minted.
   * Transfers and fees are zero-sum; P2P escrow moves funds between accounts.
   */
  checkSupplyInvariant() {
    const totalBalances = this.totalBalances();
    const daiOk = totalBalances + this.coinbaseDust === this.totalMinted;
    // Per-asset invariant: stablecoins are minted ONLY in genesis allocations and
    // never enter coinbase, so circulating raw units must equal exactly what was
    // minted. They are deliberately NOT summed into the DAI pot.
    const assets = {};
    let assetsOk = true;
    const tickers = new Set([...this.totalMintedAssets.keys(), ...this.assetBalances.keys()]);
    for (const t of tickers) {
      let sum = 0;
      const m = this.assetBalances.get(t);
      if (m) for (const v of m.values()) sum += v;
      const minted = this.totalMintedAssets.get(t) || 0;
      const ok = sum === minted;
      if (!ok) assetsOk = false;
      assets[t] = { ok, totalMinted: minted, totalBalances: sum, delta: sum - minted };
    }
    return {
      ok: daiOk && assetsOk,
      totalMinted: this.totalMinted,
      totalBalances,
      coinbaseDust: this.coinbaseDust,
      delta: totalBalances - this.totalMinted,
      assets,
    };
  }
}

/** Replay a chain into a fresh ledger (lenient tx mode for legacy blocks). */
export function replayChainLedger(chain, { applyP2P = false } = {}) {
  const ledger = new TxLedgerState();
  for (const block of chain) {
    ledger.applyBlock(block, { strict: false, skipVerify: true });
    if (applyP2P) {
      for (const t of (block.stateTransitions || [])) {
        ledger.applyP2PEscrowTransition(t);
      }
    }
  }
  return ledger;
}

/** Async variant of replayChainLedger — yields every 2000 blocks so HTTP stays live.
 *  Uses skipVerify=true: transactions are already on-chain so crypto re-validation is wasted work. */
export async function replayChainLedgerAsync(chain, { applyP2P = false } = {}) {
  const ledger = new TxLedgerState();
  for (let i = 0; i < chain.length; i++) {
    const block = chain[i];
    ledger.applyBlock(block, { strict: false, skipVerify: true });
    if (applyP2P) {
      for (const t of (block.stateTransitions || [])) {
        ledger.applyP2PEscrowTransition(t);
      }
    }
    if ((i + 1) % 2000 === 0) await new Promise(r => setImmediate(r));
  }
  return ledger;
}

/** Build a ledger snapshot and validate new block txs against it (strict). */
export function validateBlockLedger(block, ledger, { strict = true } = {}) {
  const trial = ledger.clone();
  return trial.applyBlock(block, { strict });
}