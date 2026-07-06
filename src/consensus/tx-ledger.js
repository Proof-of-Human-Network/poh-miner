/**
 * Canonical transaction ledger — replays coinbase + transfers with spent-tx dedup.
 *
 * Invariant: sum(all wallet balances) === sum(coinbase.totalNewSupply) across the chain.
 * Fees are zero-sum (sender → miner) and do not change total supply.
 */

import { PoHTransaction } from '../core/transaction.js';
import { Wallet, computeTxFieldsHash } from '../wallet/wallet.js';
import { ESCROW_ADDRESS } from '../p2p/escrow.js';

export class TxLedgerState {
  constructor() {
    /** @type {Map<string, number>} */
    this.balances = new Map();
    /** @type {Map<string, number>} */
    this.nonces = new Map();
    /** @type {Map<string, string>} */
    this.signingKeys = new Map();
    this.spentTxHashes = new Set();
    this.totalMinted = 0;
    /** μPOH minted in coinbase but not credited due to historical floor-division splits */
    this.coinbaseDust = 0;
  }

  clone() {
    const copy = new TxLedgerState();
    copy.balances = new Map(this.balances);
    copy.nonces = new Map(this.nonces);
    copy.signingKeys = new Map(this.signingKeys);
    copy.spentTxHashes = new Set(this.spentTxHashes);
    copy.totalMinted = this.totalMinted;
    copy.coinbaseDust = this.coinbaseDust;
    return copy;
  }

  getBalance(address) {
    return this.balances.get(address) || 0;
  }

  getNonce(address) {
    return this.nonces.get(address) || 0;
  }

  _credit(address, amount) {
    if (!address || amount <= 0) return;
    this.balances.set(address, this.getBalance(address) + amount);
  }

  _debit(address, amount) {
    if (!address || amount <= 0) return true;
    const bal = this.getBalance(address);
    if (bal < amount) return false;
    this.balances.set(address, bal - amount);
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
      tx = txData instanceof PoHTransaction ? txData : PoHTransaction.fromJSON(txData);
    } catch {
      return { valid: false, reason: 'malformed transaction' };
    }

    if (!tx.txHash) {
      return { valid: false, reason: 'missing txHash' };
    }

    if (this.spentTxHashes.has(tx.txHash)) {
      return { valid: false, reason: `tx already spent (${tx.txHash.slice(0, 12)})` };
    }

    if (!tx.verify()) {
      return { valid: false, reason: 'invalid tx signature' };
    }

    if (tx.txHash !== computeTxFieldsHash(tx)) {
      return { valid: false, reason: 'txHash does not match transaction fields' };
    }

    if (!tx.from || !tx.to || tx.amount <= 0) {
      return { valid: false, reason: 'invalid tx fields' };
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
    if (this.getBalance(tx.from) < total) {
      return { valid: false, reason: 'insufficient balance' };
    }

    this.balances.set(tx.from, this.getBalance(tx.from) - total);
    this.nonces.set(tx.from, tx.nonce);
    this._credit(tx.to, tx.amount);
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
  applyBlock(block, { strict = true, skipVerify = false } = {}) {
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
        this._credit(block.minerWallet, tx.fee);
      }
    }

    return { valid: true };
  }

  /** Apply a transaction without signature/hash verification — only for chain replay. */
  _applyTransactionTrusted(txData) {
    let tx;
    try {
      tx = txData instanceof PoHTransaction ? txData : PoHTransaction.fromJSON(txData);
    } catch {
      return { valid: false, reason: 'malformed transaction' };
    }
    if (!tx.from || !tx.to || tx.amount <= 0) return { valid: false, reason: 'invalid tx fields' };
    if (this.spentTxHashes.has(tx.txHash)) return { valid: false, reason: 'already spent' };
    const total = tx.amount + (tx.fee || 0);
    if (this.getBalance(tx.from) < total) return { valid: false, reason: 'insufficient balance' };
    this.balances.set(tx.from, this.getBalance(tx.from) - total);
    this.nonces.set(tx.from, tx.nonce);
    if (tx.signingPublicKey) this.signingKeys.set(tx.from, tx.signingPublicKey);
    this._credit(tx.to, tx.amount);
    this.spentTxHashes.add(tx.txHash);
    return { valid: true, tx };
  }

  applyP2PEscrowTransition(t) {
    if (t.type === 'p2p-order-created' && t.side === 'sell' && t.escrowLocked) {
      if (!this._debit(t.maker, t.pohAmount)) return false;
      this._credit(ESCROW_ADDRESS, t.pohAmount);
    } else if (t.type === 'p2p-order-cancelled' && t.side === 'sell' && t.escrowLocked) {
      if (!this._debit(ESCROW_ADDRESS, t.pohAmount)) return false;
      this._credit(t.maker, t.pohAmount);
    } else if (t.type === 'p2p-trade-created' && t.orderSide === 'buy') {
      if (!this._debit(t.taker, t.pohAmount)) return false;
      this._credit(ESCROW_ADDRESS, t.pohAmount);
    } else if (t.type === 'p2p-trade-release') {
      const totalFromEscrow = t.pohAmount + (t.referralFee || 0);
      if (!this._debit(ESCROW_ADDRESS, totalFromEscrow)) return false;
      this._credit(t.recipient, t.pohAmount);
      if (t.referralFee > 0 && t.referrer) this._credit(t.referrer, t.referralFee);
    } else if (t.type === 'p2p-trade-cancel' && t.escrowLocked) {
      if (!this._debit(ESCROW_ADDRESS, t.pohAmount)) return false;
      this._credit(t.locker, t.pohAmount);
    }
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
    const ok = totalBalances + this.coinbaseDust === this.totalMinted;
    return {
      ok,
      totalMinted: this.totalMinted,
      totalBalances,
      coinbaseDust: this.coinbaseDust,
      delta: totalBalances - this.totalMinted,
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