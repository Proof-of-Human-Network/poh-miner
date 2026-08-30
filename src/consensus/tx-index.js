/**
 * Chain-derived transaction index.
 *
 * Wallet history used to be read from an in-memory list of what the local node
 * itself had submitted, so only the node that broadcast a transfer could report
 * it. The recipient's node — and every public node — returned an empty history
 * for a transfer that was plainly on-chain and already reflected in the balance.
 *
 * Balances never had this problem because they are replayed from the chain. This
 * does the same for history: any node with the chain answers identically, and a
 * transaction is visible to both sides the moment it is mined.
 *
 * Held in memory and rebuilt from the chain, like the ledger it mirrors. Entries
 * are capped per address so a hot wallet cannot grow it without bound.
 */

const MAX_PER_ADDRESS = 500;

/** Normalised record for one on-chain movement. */
function transferEntry(tx, block) {
  return {
    id: tx.txHash || tx.id || null,
    type: 'transfer',
    from: tx.from,
    to: tx.to,
    amount: tx.amount,
    fee: tx.fee || 0,
    currency: tx.currency || 'DAI',
    memo: tx.memo || '',
    timestamp: tx.timestamp ?? block.timestamp,
    blockHeight: block.height,
    status: 'mined',
  };
}

function rewardEntry(address, amount, kind, block) {
  return {
    // Coinbase credits have no hash of their own; make one that is stable and
    // unique per (block, recipient, kind) so clients can key off it safely.
    id: `coinbase-${block.height}-${kind}-${address}`,
    type: 'reward',
    from: null,
    to: address,
    amount,
    fee: 0,
    currency: 'DAI',
    memo: kind,
    timestamp: block.timestamp,
    blockHeight: block.height,
    status: 'mined',
  };
}

export class TxIndex {
  constructor() {
    this.byAddress = new Map();   // address -> entry[] (oldest first)
    this.byId = new Map();        // tx id -> entry
  }

  _push(address, entry) {
    if (!address) return;
    let list = this.byAddress.get(address);
    if (!list) { list = []; this.byAddress.set(address, list); }
    list.push(entry);
    if (list.length > MAX_PER_ADDRESS) list.shift();
  }

  addBlock(block) {
    if (!block) return;

    for (const tx of (block.transactions || [])) {
      if (!tx?.from || !tx?.to) continue;
      const entry = transferEntry(tx, block);
      if (entry.id) this.byId.set(entry.id, entry);
      this._push(tx.from, entry);
      // Both sides are indexed, which is the whole point: the recipient never
      // submitted anything, so nothing else would ever record it for them.
      if (tx.to !== tx.from) this._push(tx.to, entry);
    }

    const cb = block.coinbaseReward;
    if (cb && block.minerWallet) {
      if (cb.proposerReward > 0) {
        const e = rewardEntry(block.minerWallet, cb.proposerReward, 'proposer', block);
        this.byId.set(e.id, e);
        this._push(block.minerWallet, e);
      }
      for (const w of (cb.workerRewards || [])) {
        if (!w?.workerId || !(w.amount > 0)) continue;
        const e = rewardEntry(w.workerId, w.amount, 'worker', block);
        this.byId.set(e.id, e);
        this._push(w.workerId, e);
      }
    }
  }

  /** Rebuild from scratch — call wherever the ledger is rebuilt. */
  rebuild(chain) {
    this.byAddress.clear();
    this.byId.clear();
    for (const block of (chain || [])) this.addBlock(block);
    return this;
  }

  /** Newest first, which is what a wallet UI wants. */
  forAddress(address, limit = 50) {
    const list = this.byAddress.get(address) || [];
    return list.slice(-Math.max(1, limit)).reverse();
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  stats() {
    return { addresses: this.byAddress.size, transactions: this.byId.size };
  }
}
